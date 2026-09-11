import { z } from "zod";
import { chatJson, FAST_MODEL } from "../services/llm.js";
import { langName, scriptNote } from "../lib/langs.js";

// Onboarding placement mini-test: generate level-appropriate {source} vocabulary
// grouped into a few themes, so the learner can tap the words they DON'T know and
// turn exactly those into their starter deck. The deck is empty at first run, so
// there's nothing to dedupe against — one cheap qwen-flash call, no DB read.
const starterClustersSchema = z.object({
  clusters: z
    .array(
      z.object({
        theme: z.string().default(""), // label in the learner's OWN language
        words: z.array(z.string()).min(1).max(14).default([]), // words in the studied language
      }),
    )
    .default([]),
});

export async function suggestStarterClusters(params: {
  sourceLang: string;
  targetLang: string;
  level?: string;
  clusters?: number;
  perCluster?: number;
}): Promise<{ clusters: { theme: string; words: string[] }[] }> {
  const source = langName(params.sourceLang);
  const target = langName(params.targetLang);
  const clusterCount = Math.min(6, Math.max(2, params.clusters ?? 4));
  const per = Math.min(12, Math.max(3, params.perCluster ?? 7));
  const level = params.level?.trim() || "B1";

  const result = await chatJson({
    system:
      `You are a ${source} tutor building a short placement mini-test for a ${target}-speaking learner ` +
      `who says their level is ${level} (CEFR). Produce ${clusterCount} themed clusters of ${source} vocabulary ` +
      `that a ${level} learner plausibly encounters. Across the words, span the level — mix a few clearly-easier ` +
      `items with a few genuinely ${level}-and-above ones — so the test can tell what the learner already knows. ` +
      `Each cluster: "theme" = a short label (1-3 words) written in ${target} (the learner's own language); ` +
      `"words" = ${per} ${source} words or short phrases belonging to that theme. ` +
      `Use everyday, useful vocabulary (not obscure). Do not repeat a word across clusters. ` +
      scriptNote(params.sourceLang) +
      'Respond as JSON: {"clusters":[{"theme": string, "words": string[]}]}.',
    user: `Level ${level}, ${clusterCount} clusters of ${per} ${source} words. Theme labels in ${target}.`,
    schema: starterClustersSchema,
    label: "words.starterCandidates",
    model: FAST_MODEL,
  });

  const clusters = (result.clusters ?? [])
    .map((c) => ({
      theme: (c.theme ?? "").trim(),
      words: (c.words ?? []).map((w) => w.trim()).filter(Boolean).slice(0, per),
    }))
    .filter((c) => c.words.length > 0)
    .slice(0, clusterCount);

  return { clusters };
}
