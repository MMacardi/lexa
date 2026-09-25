import { z } from "zod";
import { prisma } from "../services/db.js";
import { chatJson } from "../services/llm.js";
import { getProfile, profilePreamble } from "../services/coachMemory.js";
import { langName, scriptNote } from "../lib/langs.js";
import { asHskVersion, hskLevelWords, hskTagFor } from "../services/hsk.js";

// Coach "Daily picks": suggest useful, level-appropriate words the learner does
// NOT already have. Architecture on purpose: we assemble the context ourselves
// (the learner's deck for this language, from our DB — free) and make ONE focused
// structured call, then POST-FILTER the result against the real deck. So the
// quality doesn't depend on the model perfectly honouring "avoid this list" — even
// if it repeats a word we own, we drop it. Cheap (1 call) and reliable.

const picksSchema = z.object({
  picks: z
    .array(z.object({ word: z.string(), meaning: z.string().default(""), reason: z.string().default("") }))
    .default([]),
});

// Up to 160 words of the target level and the one below it, minus what the
// learner has or said they know, in a fresh random order each call — so "New
// picks" draws from a different slice of the list every time.
function hskCandidates(version: "2.0" | "3.0", target: number, known: Set<string>): string[] {
  const pool = [...hskLevelWords(version, target), ...(target > 1 ? hskLevelWords(version, target - 1) : [])]
    .map((w) => w.word)
    .filter((w) => !known.has(w));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 160);
}

export async function suggestDailyPicks(params: {
  telegramId: string;
  sourceLang: string;
  targetLang: string;
  level?: string;
  count?: number;
  theme?: string;
}): Promise<{ picks: { word: string; meaning: string; reason: string; hsk?: number }[] }> {
  const source = langName(params.sourceLang);
  const target = langName(params.targetLang);
  const count = Math.min(20, Math.max(3, params.count ?? 8));

  const user = await prisma.user.findUnique({
    where: { telegramId: params.telegramId },
    select: { id: true, hskTarget: true, hskVersion: true },
  });
  const [owned, toldKnown] = user
    ? await Promise.all([
        prisma.word.findMany({
          where: { userId: user.id, sourceLang: params.sourceLang },
          select: { word: true },
          orderBy: { createdAt: "desc" },
        }),
        // "I know this" in the HSK check or the daily words: not a card, still not new.
        prisma.placementAnswer.findMany({
          where: { userId: user.id, sourceLang: params.sourceLang, known: true },
          select: { word: true },
        }),
      ])
    : [[], []];
  const known = owned.map((w) => w.word.trim().toLowerCase());
  const knownSet = new Set([...known, ...toldKnown.map((w) => w.word.trim().toLowerCase())]);
  // Cap the list we put in the prompt (a huge deck would bloat it); the post-filter
  // below still catches anything the model repeats beyond the cap.
  const knownForPrompt = known.slice(0, 400);
  // The most recent additions signal what the learner is into right now — use them
  // so the picks feel like a continuation, not a random word list (a real mentor
  // notices your current topic). An explicit theme, when given, takes priority.
  const recent = owned.slice(0, 15).map((w) => w.word);

  // A Chinese learner with an HSK target is measured against that list, not a
  // CEFR guess: aim the picks at it and tag each with its level.
  const zh = params.sourceLang === "zh" || params.sourceLang === "zh-Hant";
  const hskVersion = zh && user?.hskTarget ? (asHskVersion(user.hskVersion) ?? "3.0") : null;
  const hskName = user?.hskTarget === 7 ? "7–9" : String(user?.hskTarget ?? "");
  // Their picks come FROM the list: a shuffled sample of the target level and the
  // one below that they don't have yet, and the model only chooses what fits the
  // goal. Asked merely to "aim at HSK 4", it handed a learner who said "work"
  // HSK 7–9 business words (部署, 拟定, 兼顾); a list can't drift.
  const candidates = hskVersion ? hskCandidates(hskVersion, user!.hskTarget!, knownSet) : null;
  const levelLine = hskVersion
    ? `The learner is preparing for the HSK ${hskName} exam (HSK ${hskVersion} word list). `
    : params.level
      ? `The learner's level is ${params.level}. Match it — not too easy, not too advanced. `
      : "";
  const theme = params.theme?.trim();
  const focusLine = theme
    ? `Focus the picks on this topic the learner asked for: "${theme}". `
    : recent.length
      ? `The learner has recently been studying: ${recent.join(", ")}. Prefer words that connect to those ` +
        `topics/domains (natural next words, common collocations, same themes), while staying varied. `
      : "";

  const memory = profilePreamble(await getProfile(params.telegramId, params.sourceLang), params.sourceLang);

  const result = await chatJson({
    system:
      memory +
      `You are a ${source} tutor for a ${target} speaker. ${levelLine}${focusLine}` +
      (candidates
        ? `Choose the ${count} words from the candidate list in the user message that best fit the learner's goal and ` +
          `interests — useful, a natural mix of parts of speech. Use ONLY words from that list, written exactly as there. `
        : `Suggest ${count} genuinely useful ${source} words or short phrases the learner should know at their level — ` +
          `high-frequency and practical, a natural mix of parts of speech (not obscure or repetitive). ` +
          `Do NOT suggest anything already in the learner's list. `) +
      `For EACH word give: "meaning" — its short ` +
      `${target} translation/definition (a few words); and "reason" — a very short note on why it's worth ` +
      `learning, also in ${target}. ` +
      scriptNote(params.sourceLang) +
      'Respond as JSON: {"picks":[{"word": string, "meaning": string, "reason": string}]}.',
    user: candidates
      ? `Candidates: ${candidates.join(", ")}`
      : `Already known (do not suggest any of these): ${knownForPrompt.join(", ") || "(none yet)"}`,
    schema: picksSchema,
    label: "coach.picks",
  });

  const picks = (result.picks ?? [])
    .map((p) => ({ word: p.word.trim(), meaning: (p.meaning ?? "").trim(), reason: (p.reason ?? "").trim() }))
    .filter((p) => p.word && !knownSet.has(p.word.toLowerCase()))
    .filter((p) => !candidates || candidates.includes(p.word))
    .slice(0, count)
    .map((p) => {
      const hsk = hskVersion ? hskTagFor(p.word)?.[hskVersion] : undefined;
      return hsk ? { ...p, hsk } : p;
    });
  return { picks };
}
