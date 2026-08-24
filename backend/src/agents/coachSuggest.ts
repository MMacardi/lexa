import { z } from "zod";
import { prisma } from "../services/db.js";
import { chatJson } from "../services/llm.js";
import { langName, scriptNote } from "../lib/langs.js";

// Coach "Daily picks": suggest useful, level-appropriate words the learner does
// NOT already have. Architecture on purpose: we assemble the context ourselves
// (the learner's deck for this language, from our DB — free) and make ONE focused
// structured call, then POST-FILTER the result against the real deck. So the
// quality doesn't depend on the model perfectly honouring "avoid this list" — even
// if it repeats a word we own, we drop it. Cheap (1 call) and reliable.

const picksSchema = z.object({
  picks: z
    .array(z.object({ word: z.string(), reason: z.string().default("") }))
    .default([]),
});

export async function suggestDailyPicks(params: {
  telegramId: string;
  sourceLang: string;
  targetLang: string;
  level?: string;
  count?: number;
}): Promise<{ picks: { word: string; reason: string }[] }> {
  const source = langName(params.sourceLang);
  const target = langName(params.targetLang);
  const count = Math.min(20, Math.max(3, params.count ?? 8));

  const user = await prisma.user.findUnique({ where: { telegramId: params.telegramId }, select: { id: true } });
  const owned = user
    ? await prisma.word.findMany({ where: { userId: user.id, sourceLang: params.sourceLang }, select: { word: true } })
    : [];
  const known = owned.map((w) => w.word.trim().toLowerCase());
  const knownSet = new Set(known);
  // Cap the list we put in the prompt (a huge deck would bloat it); the post-filter
  // below still catches anything the model repeats beyond the cap.
  const knownForPrompt = known.slice(0, 400);

  const levelLine = params.level ? `The learner's level is ${params.level}. Match it — not too easy, not too advanced. ` : "";

  const result = await chatJson({
    system:
      `You are a ${source} tutor for a ${target} speaker. ${levelLine}` +
      `Suggest ${count} genuinely useful ${source} words or short phrases the learner should know at their level — ` +
      `high-frequency and practical, a natural mix of parts of speech (not obscure or repetitive). ` +
      `Do NOT suggest anything already in the learner's list. For EACH, give a very short reason it's worth learning, ` +
      `written in ${target}. ` +
      scriptNote(params.sourceLang) +
      'Respond as JSON: {"picks":[{"word": string, "reason": string}]}.',
    user: `Already known (do not suggest any of these): ${knownForPrompt.join(", ") || "(none yet)"}`,
    schema: picksSchema,
    label: "coach.picks",
  });

  const picks = (result.picks ?? [])
    .map((p) => ({ word: p.word.trim(), reason: (p.reason ?? "").trim() }))
    .filter((p) => p.word && !knownSet.has(p.word.toLowerCase()))
    .slice(0, count);
  return { picks };
}
