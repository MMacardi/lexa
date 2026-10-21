import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { WordSense } from "../lib/schemas.js";
import { cedictCard, cedictLookup, isMeaningGloss, mainReading, spokenReading } from "./cedict.js";
import { prisma } from "./db.js";
import { chatJson } from "./llm.js";
import { readsAs } from "./wordPages.js";

export type LocalizedDictionary = { phonetic: string; meaning: string; senses: WordSense[] };
const memory = new Map<string, LocalizedDictionary>();
const inflight = new Map<string, Promise<LocalizedDictionary>>();
const schema = z.object({ senses: z.array(z.object({
  reading: z.number().int(), glosses: z.array(z.number().int()).min(1),
  meaning: z.string().min(1), pos: z.string().default(""),
})).min(1).max(16) });

async function inventory(word: string, lang: string) {
  if (lang !== "ru") return null;
  const entry = cedictLookup(word, { count: false });
  if (!entry) return null;
  const main = (await mainReading(entry)).reading;
  const readings = [main, ...entry.readings.filter((r) => r !== main)]
    .map((r) => ({ pinyin: r.pinyin, glosses: r.glosses.filter(isMeaningGloss).slice(0, 24) }))
    .filter((r) => r.glosses.length).slice(0, 8);
  if (!readings.length) return null;
  const card = await cedictCard(word, { count: false });
  if (!card) return null;
  // New inventory or adaptation rules invalidate only the shared cache.
  const key = createHash("sha256").update(JSON.stringify([2, entry.word, lang, readings])).digest("hex");
  return { key, readings, phonetic: card.phonetic, word: entry.word };
}

function remember(key: string, entry: LocalizedDictionary) {
  if (memory.size >= 20_000) memory.delete(memory.keys().next().value!);
  memory.set(key, entry);
  return entry;
}

/** Read only: lookup and instant capture never wait for translation. */
export async function cachedDictionary(word: string, lang: string): Promise<LocalizedDictionary | null> {
  const inv = await inventory(word, lang);
  if (!inv) return null;
  const cached = memory.get(inv.key);
  if (cached) return cached;
  const row = await prisma.dictionaryAdaptation.findUnique({ where: { key: inv.key } });
  return row ? remember(inv.key, row.entry as unknown as LocalizedDictionary) : null;
}

/** One adaptation per dictionary inventory, shared by lookup, capture and detail. */
export async function localizedDictionary(word: string, lang: string): Promise<LocalizedDictionary | null> {
  const inv = await inventory(word, lang);
  if (!inv) return null;
  const cached = await cachedDictionary(word, lang);
  if (cached) return cached;
  const running = inflight.get(inv.key);
  if (running) return running;
  const task = (async () => {
    const result = await chatJson({
      system: 'Translate and group ONLY the supplied CC-CEDICT glosses into short Russian dictionary senses. ' +
        'Keep genuinely different senses and readings separate, but merge adjective/adverb variants. ' +
        'Write complete dictionary glosses: use Russian infinitives for actions with their complements. ' +
        'Preserve negation. Never return a fragment missing its action verb. ' +
        'Include the common senses of reading 0 first, then common alternate readings. Never invent a meaning. ' +
        'Each sense names its zero-based reading and source gloss indexes. meaning and pos must be Russian. ' +
        'No example sentences. Return JSON: {"senses":[{"reading":0,"glosses":[0],"meaning":"...","pos":"..."}]}',
      user: JSON.stringify({ word: inv.word, readings: inv.readings }),
      schema, label: "lookup.gloss",
    });
    const senses: WordSense[] = [];
    const defaults: string[] = [];
    for (const s of result.senses) {
      const reading = inv.readings[s.reading];
      if (!reading || s.glosses.some((i) => i < 0 || !reading.glosses[i]) || !/[а-яё]/i.test(s.meaning)) {
        throw new Error("Invalid localized dictionary sense");
      }
      if ((s.pos ?? "").includes("глагол") && s.glosses.every((i) => /^to\s/.test(reading.glosses[i])) &&
        !/[а-яё]+(?:ть(?:ся)?|ти(?:сь)?|чь(?:ся)?)(?=[^а-яё]|$)/i.test(s.meaning)) {
        throw new Error("Incomplete localized action gloss");
      }
      if (s.reading === 0) defaults.push(s.meaning.trim());
      const phonetic = await spokenReading(inv.word, reading.pinyin);
      senses.push({ meaning: s.meaning.trim(), pos: (s.pos ?? "").trim(), phrases: [], onCard: s.reading === 0,
        ...(!readsAs(inv.word, phonetic, inv.phonetic) ? { reading: phonetic } : {}) });
    }
    if (!defaults.length) throw new Error("Missing localized main reading");
    const entry = { phonetic: inv.phonetic, meaning: defaults.join("; "), senses };
    // A simultaneous request in another process also uses the first committed wording.
    const stored = await prisma.dictionaryAdaptation.upsert({ where: { key: inv.key },
      create: { key: inv.key, entry: entry as unknown as Prisma.InputJsonValue }, update: {} });
    return remember(inv.key, stored.entry as unknown as LocalizedDictionary);
  })();
  inflight.set(inv.key, task);
  try { return await task; } finally { inflight.delete(inv.key); }
}
