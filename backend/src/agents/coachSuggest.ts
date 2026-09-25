import { z } from "zod";
import { prisma } from "../services/db.js";
import { chatJson } from "../services/llm.js";
import { getProfile, profilePreamble } from "../services/coachMemory.js";
import { langName, scriptNote } from "../lib/langs.js";
import { asHskVersion, HSK_MAX_LEVEL, hskLevelWords, hskTagFor, normalizeHanzi, type HskVersion } from "../services/hsk.js";

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

type Candidate = { word: string; level: number; missed: boolean };

function shuffle<T>(pool: T[]): T[] {
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// The words the model may pick from: the target level first, but not fenced in
// by it — personalization is the point of these picks, and a level is not a
// learner. Minus what they have or said they know, freshly shuffled each call so
// "New picks" draws a different slice.
//   - Below the target: basics they're missing. The check samples every level up
//     to the target, so it says which ones: each word they tapped as unknown
//     (marked, so the model weighs it), plus a sample of any level where they
//     missed a third or more. With no check, the level just below, as before.
//   - One level up, a handful, for a word the goal really needs (a student going
//     to China needs 签证 whatever its level). Capped in the prompt and after it.
function hskCandidates(
  version: HskVersion,
  target: number,
  known: Set<string>,
  checked: { word: string; known: boolean }[],
): Candidate[] {
  const fresh = (n: number) => shuffle(hskLevelWords(version, n).map((w) => w.word).filter((w) => !known.has(w)));
  const out: Candidate[] = fresh(target)
    .slice(0, 100)
    .map((word) => ({ word, level: target, missed: false }));
  const answered = new Map<number, { asked: number; missed: string[] }>();
  for (const a of checked) {
    const n = hskTagFor(a.word)?.[version];
    if (!n || n >= target) continue;
    const row = answered.get(n) ?? { asked: 0, missed: [] };
    row.asked++;
    if (!a.known) row.missed.push(normalizeHanzi(a.word));
    answered.set(n, row);
  }
  for (let n = target - 1; n >= 1; n--) {
    const row = answered.get(n);
    const missed = (row?.missed ?? []).filter((w) => !known.has(w));
    for (const word of missed) out.push({ word, level: n, missed: true });
    const weak = row ? row.missed.length / row.asked >= 1 / 3 : n === target - 1 && answered.size === 0;
    if (weak) {
      for (const word of fresh(n).filter((w) => !missed.includes(w)).slice(0, 25)) out.push({ word, level: n, missed: false });
    }
  }
  if (target < HSK_MAX_LEVEL[version]) {
    for (const word of fresh(target + 1).slice(0, 20)) out.push({ word, level: target + 1, missed: false });
  }
  return out;
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
  const [owned, checked] = user
    ? await Promise.all([
        prisma.word.findMany({
          where: { userId: user.id, sourceLang: params.sourceLang },
          select: { word: true },
          orderBy: { createdAt: "desc" },
        }),
        // The HSK check's answers. "I know this" (there or in the daily words) is
        // not a card, but still not new; "I don't" marks a basic worth picking.
        prisma.placementAnswer.findMany({
          where: { userId: user.id, sourceLang: params.sourceLang },
          select: { word: true, known: true },
        }),
      ])
    : [[], []];
  const toldKnown = checked.filter((a) => a.known);
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
  // Their picks come FROM the list (hskCandidates), and the model only chooses
  // what fits the goal. Asked merely to "aim at HSK 4", it handed a learner who
  // said "work" HSK 7–9 business words (部署, 拟定, 兼顾); a list can't drift.
  const hskLevel = user?.hskTarget ?? 0;
  const candidates = hskVersion ? hskCandidates(hskVersion, hskLevel, knownSet, checked) : null;
  const candidateLevel = new Map((candidates ?? []).map((c) => [c.word, c.level]));
  // Above the target is the exception: one or two of a set, never the bulk.
  const maxAbove = count >= 6 ? 2 : 1;
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
          `interests — useful, a natural mix of parts of speech. Use ONLY words from that list, written exactly as there ` +
          `(without the level tag). Each candidate is tagged with its HSK level; * marks a word the learner said they ` +
          `don't know in their level check. Most picks should be HSK ${hskName} words. Take a lower-level word when it ` +
          `is marked * or the goal needs it — a missing basic matters more than one more hard word. Take at most ` +
          `${maxAbove} word${maxAbove > 1 ? "s" : ""} above HSK ${hskName}, and only when the goal or interests clearly call for it. `
        : `Suggest ${count} genuinely useful ${source} words or short phrases the learner should know at their level — ` +
          `high-frequency and practical, a natural mix of parts of speech (not obscure or repetitive). ` +
          `Do NOT suggest anything already in the learner's list. `) +
      `For EACH word give: "meaning" — its short ` +
      `${target} translation/definition (a few words); and "reason" — a very short note on why it's worth ` +
      `learning, also in ${target}. ` +
      scriptNote(params.sourceLang) +
      'Respond as JSON: {"picks":[{"word": string, "meaning": string, "reason": string}]}.',
    user: candidates
      ? `Candidates: ${candidates.map((c) => `${c.word}(HSK ${c.level === 7 ? "7–9" : c.level})${c.missed ? "*" : ""}`).join(", ")}`
      : `Already known (do not suggest any of these): ${knownForPrompt.join(", ") || "(none yet)"}`,
    schema: picksSchema,
    label: "coach.picks",
  });

  let above = 0;
  const picks = (result.picks ?? [])
    // A model that echoes the tag ("签证(HSK 5)") still means the word.
    .map((p) => ({ word: p.word.replace(/\s*\(HSK[^)]*\)\*?$/, "").trim(), meaning: (p.meaning ?? "").trim(), reason: (p.reason ?? "").trim() }))
    .filter((p) => p.word && !knownSet.has(p.word.toLowerCase()))
    .filter((p) => !candidates || candidateLevel.has(p.word))
    .filter((p) => !candidates || candidateLevel.get(p.word)! <= hskLevel || ++above <= maxAbove)
    .slice(0, count)
    .map((p) => {
      const hsk = hskVersion ? hskTagFor(p.word)?.[hskVersion] : undefined;
      return hsk ? { ...p, hsk } : p;
    });
  return { picks };
}
