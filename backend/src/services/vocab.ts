import { prisma } from "./db.js";
import { fsrs, generatorParameters, createEmptyCard, type Card, type Grade, type State } from "ts-fsrs";
import { runExampleSearch } from "../agents/exampleSearch.js";
import { runTutor } from "../agents/tutor.js";
import { enrichWordEntry } from "../agents/enrich.js";
import { chatJson, chatJsonConversation, type ChatMessage } from "./llm.js";
import { normalizeLang } from "../lib/detect.js";
import { langName, scriptNote } from "../lib/langs.js";
import { Prisma } from "@prisma/client";
import { explanationSchema, familySchema, sensesSchema, wordChatSchema, type WordChatResult, type WordSense } from "../lib/schemas.js";
import { copiedCredits, mintShareCode, type Visibility } from "./community.js";
import { productionDays, productionSummary } from "./production.js";
import { hskTagFor } from "./hsk.js";
import { FOCUS } from "../lib/env.js";
import { cedictInventory, isChinese } from "./cedict.js";
import { track } from "./analytics.js";

// FSRS scheduler (Anki's modern default). Target retention 90%; fuzz spreads due
// dates so cards don't pile up on one day.
const DEFAULT_RETENTION = 0.9;
const scheduler = fsrs(generatorParameters({ request_retention: DEFAULT_RETENTION, enable_fuzz: true }));

// A learner can tune their desired retention (higher = shorter intervals, more
// reviews, fewer lapses). Reuse the default scheduler unless a custom value is
// given, clamped to a sane range.
function schedulerFor(retention?: number) {
  if (retention == null || Math.abs(retention - DEFAULT_RETENTION) < 1e-6) return scheduler;
  const r = Math.min(0.98, Math.max(0.7, retention));
  return fsrs(generatorParameters({ request_retention: r, enable_fuzz: true }));
}


/** Find or create the user that owns this telegramId. */
async function ensureUser(telegramId: string) {
  return prisma.user.upsert({
    where: { telegramId },
    create: { telegramId },
    update: {},
  });
}

// --- Ownership guards (authorization) ---
// Every :id route must confirm the caller actually owns the row before reading or
// mutating it; otherwise anyone with a valid session could touch another user's
// cards/collections by id (IDOR). These resolve the caller's user by telegramId
// (from the verified session) and check the resource's userId.
export async function userOwnsWord(wordId: string, telegramId: string | null | undefined): Promise<boolean> {
  if (!telegramId) return false;
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return false;
  const word = await prisma.word.findFirst({ where: { id: wordId, userId: user.id }, select: { id: true } });
  return Boolean(word);
}

export async function userOwnsCollection(collectionId: string, telegramId: string | null | undefined): Promise<boolean> {
  if (!telegramId) return false;
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return false;
  const col = await prisma.collection.findFirst({ where: { id: collectionId, userId: user.id }, select: { id: true } });
  return Boolean(col);
}

/**
 * Add a word for a user: run the Example Search Agent, then the Tutor Agent,
 * and return the fully populated word. Shared by the bot and the REST API.
 */
export async function addWordForUser(params: {
  telegramId: string;
  word: string;
  sourceLang?: string;
  targetLang?: string;
  level?: string;
  synonymLevel?: string; // tune the card's synonyms to a target CEFR level (exam prep)
  exampleStyle?: string;
  exampleSource?: string;
  exampleCount?: number; // how many examples to generate (1–2); default 1
  meaningPrompt?: string; // learner override for how the meaning is written
  sense?: string; // known-language word the learner typed (add-by-translation): the sense they want
  notes?: string; // learner's own notes, stored as typed
}) {
  const user = await ensureUser(params.telegramId);
  const sourceLang = normalizeLang(params.word, params.sourceLang);
  const targetLang = params.targetLang ?? "zh";
  const useWeb = !FOCUS && params.exampleSource === "web"; // web mining is off while focused (F7)
  const withExample = params.exampleStyle !== "none";
  const count = Math.max(1, Math.min(2, Math.round(params.exampleCount ?? 1)));
  const notes = params.notes?.trim() || null;

  let wordId: string;

  if (useWeb) {
    // Web-mined example: the sentence comes from a real search, so keep the
    // dedicated two-step agent, then the dictionary agent.
    const example = await runExampleSearch({
      userId: user.id,
      word: params.word,
      sourceLang,
      targetLang: params.targetLang,
      level: params.level,
      exampleStyle: params.exampleStyle,
      exampleSource: params.exampleSource,
    });
    wordId = example.wordId;
    if (notes) await prisma.word.update({ where: { id: wordId }, data: { notes } });
    await runTutor({ wordId, word: params.word, sourceLang: params.sourceLang, targetLang: params.targetLang, synonymLevel: params.synonymLevel });
  } else {
    // AI-composed (default) or "none": ONE combined call for the whole entry
    // (dictionary + example + translation) instead of three separate ones.
    const entry = await enrichWordEntry({
      word: params.word,
      sourceLang,
      targetLang,
      level: params.level,
      synonymLevel: params.synonymLevel,
      exampleStyle: params.exampleStyle,
      withExample,
      meaningInstruction: params.meaningPrompt,
      sense: params.sense,
    });
    const created = await prisma.word.create({
      data: {
        userId: user.id,
        word: params.word.trim().toLowerCase(),
        sourceLang,
        targetLang,
        phonetic: entry.phonetic || null,
        partOfSpeech: entry.partOfSpeech || null,
        meaningZh: entry.meaningZh || null,
        collocations: entry.collocations,
        synonyms: entry.synonyms,
        antonyms: entry.antonyms,
        notes,
        examples:
          withExample && entry.example
            ? {
                create: {
                  sentenceEn: entry.example,
                  sentenceZh: entry.exampleTranslation,
                  sourceName: "Onomika AI",
                  sourceUrl: "",
                  register: params.exampleStyle ?? "casual",
                  level: params.level ?? null,
                },
              }
            : undefined,
      },
      select: { id: true },
    });
    wordId = created.id;
  }

  // Extra examples: compose N-1 more, each avoiding the ones already there. Skipped
  // for the "no example" style.
  if (count > 1 && withExample) {
    for (let i = 1; i < count; i++) {
      await addExampleToWord(wordId, {
        exampleStyle: params.exampleStyle,
        exampleSource: params.exampleSource,
        level: params.level,
      }).catch(() => {
        /* one extra example failing shouldn't fail the whole add */
      });
    }
  }

  track("word_add", { telegramId: params.telegramId, props: { mode: "ai" } });

  return prisma.word.findUniqueOrThrow({
    where: { id: wordId },
    include: {
      examples: { orderBy: { createdAt: "desc" } },
      collections: { select: { id: true, name: true } },
    },
  });
}

/**
 * Add a word manually (no agents): the user provides the meaning, example and
 * source themselves. Useful when you don't want to spend an LLM call or want to
 * curate the entry by hand.
 */
export async function addWordManual(params: {
  telegramId: string;
  word: string;
  sourceLang?: string;
  targetLang?: string;
  phonetic?: string;
  partOfSpeech?: string;
  meaningZh?: string;
  collocations?: string[];
  synonyms?: string[];
  antonyms?: string[];
  notes?: string;
  example?: {
    sentenceEn: string;
    sentenceZh?: string;
    sourceName?: string;
    sourceUrl?: string;
  };
}) {
  const user = await ensureUser(params.telegramId);
  const word = params.word.trim().toLowerCase();

  const data = {
    sourceLang: normalizeLang(params.word, params.sourceLang),
    targetLang: params.targetLang ?? "zh",
    phonetic: params.phonetic ?? null,
    partOfSpeech: params.partOfSpeech ?? null,
    meaningZh: params.meaningZh ?? null,
    collocations: params.collocations ?? [],
    synonyms: params.synonyms ?? [],
    antonyms: params.antonyms ?? [],
    notes: params.notes?.trim() || null,
  };

  // Duplicates are allowed, so always create a new card rather than upserting
  // onto an existing same-spelling row.
  const wordRecord = await prisma.word.create({
    data: { userId: user.id, word, ...data },
  });

  if (params.example?.sentenceEn?.trim()) {
    await prisma.example.create({
      data: {
        wordId: wordRecord.id,
        sentenceEn: params.example.sentenceEn.trim(),
        sentenceZh: params.example.sentenceZh?.trim() ?? "",
        sourceName: params.example.sourceName?.trim() || "Manual entry",
        sourceUrl: params.example.sourceUrl?.trim() ?? "",
      },
    });
  }

  track("word_add", { telegramId: params.telegramId, props: { mode: "manual" } });

  return prisma.word.findUniqueOrThrow({
    where: { id: wordRecord.id },
    include: {
      examples: { orderBy: { createdAt: "desc" } },
      collections: { select: { id: true, name: true } },
    },
  });
}

/** All of a user's saved words, newest first, each with its examples. */
/**
 * The HSK level(s) this card sits at, as a field the client can render as a
 * badge. Derived on read rather than stored: it is a pure function of the
 * headword, so a card never goes stale when the lists are regenerated, and
 * nothing needs backfilling. Only Chinese cards can carry it.
 */
function withHskTag<T extends { word: string; sourceLang: string }>(w: T) {
  return { ...w, hsk: w.sourceLang === "zh" ? hskTagFor(w.word) : null };
}

export async function listWordsForUser(telegramId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return [];
  const words = await prisma.word.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      examples: { orderBy: { createdAt: "desc" } },
      collections: { select: { id: true, name: true } },
    },
  });
  return words.map(withHskTag);
}

/** A single word by id, with its examples. */
export async function getWord(id: string) {
  const word = await prisma.word.findUnique({
    where: { id },
    include: {
      examples: { orderBy: { createdAt: "desc" } },
      collections: { select: { id: true, name: true } },
    },
  });
  return word ? withHskTag(word) : null;
}

/** Append a ready-made example (e.g. one the tutor produced in chat) to a card. */
export async function addProvidedExample(id: string, sentenceEn: string, sentenceZh: string) {
  const word = await prisma.word.findUnique({ where: { id }, select: { id: true } });
  if (!word) throw new Error("Word not found");
  await prisma.example.create({
    data: { wordId: id, sentenceEn: sentenceEn.trim(), sentenceZh: (sentenceZh ?? "").trim(), sourceName: "Onomika AI", sourceUrl: "" },
  });
  return getWord(id);
}

/** How many AI-generated examples a card holds (the cap is two, second is Pro). */
export async function countAiExamples(id: string): Promise<number> {
  return prisma.example.count({ where: { wordId: id, sourceName: "Onomika AI" } });
}

/** Delete a word (its examples cascade via the schema's onDelete: Cascade). */
export async function deleteWord(id: string) {
  return prisma.word.delete({ where: { id } });
}

/**
 * Fetch a fresh example for an existing word via the Example Search Agent. When
 * `replace` is true, the word's current examples are cleared first (regenerate);
 * otherwise the new example is added alongside the existing ones.
 */
export async function addExampleToWord(
  id: string,
  opts: { exampleStyle?: string; exampleSource?: string; level?: string; replace?: boolean } = {},
) {
  const word = await prisma.word.findUnique({
    where: { id },
    select: {
      id: true,
      word: true,
      userId: true,
      sourceLang: true,
      targetLang: true,
      examples: { select: { sentenceEn: true } },
    },
  });
  if (!word) throw new Error("Word not found");

  if (opts.replace) {
    await prisma.example.deleteMany({ where: { wordId: id } });
  }
  await runExampleSearch({
    userId: word.userId,
    word: word.word,
    wordId: word.id,
    sourceLang: word.sourceLang,
    targetLang: word.targetLang,
    exampleStyle: opts.exampleStyle,
    exampleSource: opts.exampleSource,
    level: opts.level,
    // Adding another (not replacing) → avoid duplicating the current example(s).
    avoid: opts.replace ? [] : word.examples.map((e) => e.sentenceEn),
  });

  return prisma.word.findUniqueOrThrow({
    where: { id },
    include: {
      examples: { orderBy: { createdAt: "desc" } },
      collections: { select: { id: true, name: true } },
    },
  });
}

/** Edit a word's fields (and optionally its first example). */
export async function updateWord(
  id: string,
  fields: {
    word?: string;
    phonetic?: string | null;
    partOfSpeech?: string | null;
    meaningZh?: string | null;
    collocations?: string[];
    synonyms?: string[];
    antonyms?: string[];
    notes?: string | null;
    sourceLang?: string;
    targetLang?: string;
    // Which senses of the cached "Meanings" list the card tests, as indexes into
    // it. Stored on the senses themselves so the word page shows what the learner
    // picked instead of guessing it back out of the meaning text.
    senseIndexes?: number[];
    // Full desired set of examples. Rows with an id are updated, rows without
    // one are created, and any existing example missing from the list is deleted.
    examples?: {
      id?: string;
      sentenceEn: string;
      sentenceZh?: string;
      sourceName?: string;
    }[];
  },
) {
  const data: Record<string, unknown> = {};
  if (fields.word !== undefined) data.word = fields.word.trim().toLowerCase();
  for (const k of [
    "phonetic",
    "partOfSpeech",
    "meaningZh",
    "collocations",
    "synonyms",
    "antonyms",
    "notes",
    "sourceLang",
    "targetLang",
  ] as const) {
    if (fields[k] !== undefined) data[k] = fields[k];
  }
  // The cached AI explanation describes the word's meaning/usage, so any change to
  // those fields makes it stale — drop it and let the next open regenerate.
  if (["word", "meaningZh", "partOfSpeech", "synonyms", "antonyms"].some((k) => k in data)) {
    data.explainCache = null;
  }
  // Senses describe the word itself (not which one the card tests), so only a
  // new spelling or language pair invalidates them — not a meaningZh edit.
  if (["word", "sourceLang", "targetLang"].some((k) => k in data)) {
    data.senses = Prisma.DbNull;
  }
  // A hand-edited family counts as answered, so emptying it on purpose isn't
  // undone by the auto-fill on the next open.
  if (["synonyms", "antonyms"].some((k) => k in data)) {
    data.familyAt = new Date();
  }
  // Keep the cached senses' "tested on the card" flags in step with the meaning.
  // Reading them back out of the meaning text worked in Russian and lied in
  // Chinese, where senses share a head word (指出 / 指明，指出) and every sense
  // came out ticked, so the picks are written down instead — together with the
  // meaning they were made for, which tells a later read whether they still hold.
  if (!("senses" in data) && (fields.senseIndexes !== undefined || "meaningZh" in data)) {
    const cur = await prisma.word.findUnique({ where: { id }, select: { meaningZh: true, senses: true } });
    const stored = cur?.senses as StoredSenses | null;
    if (stored?.list?.length) {
      if (fields.senseIndexes !== undefined) {
        const picked = new Set(fields.senseIndexes);
        data.senses = {
          ...stored,
          list: stored.list.map((s, i) => ({ ...s, onCard: picked.has(i) })),
          for: ("meaningZh" in data ? (data.meaningZh as string | null) : cur?.meaningZh) ?? "",
        } as unknown as Prisma.InputJsonValue;
      } else if ((data.meaningZh ?? "") !== (cur?.meaningZh ?? "")) {
        // The meaning was rewritten by hand: whatever was ticked described the old
        // wording, so drop the picks rather than show a stale tick.
        const { for: _stale, ...rest } = stored;
        data.senses = {
          ...rest,
          list: stored.list.map((s) => ({ ...s, onCard: false })),
        } as unknown as Prisma.InputJsonValue;
      }
    }
  }
  // Duplicate spellings are allowed, so a rename can never collide.
  await prisma.word.update({ where: { id }, data });

  if (fields.examples !== undefined) {
    const rows = fields.examples.filter((e) => e.sentenceEn.trim());
    const keepIds = rows.map((e) => e.id).filter((x): x is string => Boolean(x));
    // Remove examples the user deleted from the list.
    await prisma.example.deleteMany({
      where: { wordId: id, ...(keepIds.length ? { id: { notIn: keepIds } } : {}) },
    });
    for (const e of rows) {
      if (e.id) {
        await prisma.example.update({
          where: { id: e.id },
          data: {
            sentenceEn: e.sentenceEn.trim(),
            sentenceZh: e.sentenceZh ?? "",
            sourceName: e.sourceName ?? "",
          },
        });
      } else {
        await prisma.example.create({
          data: {
            wordId: id,
            sentenceEn: e.sentenceEn.trim(),
            sentenceZh: e.sentenceZh ?? "",
            sourceName: e.sourceName || "Manual entry",
            sourceUrl: "",
          },
        });
      }
    }
  }

  return prisma.word.findUniqueOrThrow({
    where: { id },
    include: {
      examples: { orderBy: { createdAt: "desc" } },
      collections: { select: { id: true, name: true } },
    },
  });
}

// Where a grade came from. The scheduler treats them alike, but the learner model
// does not: "got it right when prompted" (review/quiz) is a weaker claim than
// "produced it in a sentence" (drill/scene/chat), and only the log can tell them
// apart afterwards.
export const REVIEW_SOURCES = ["review", "quiz", "drill", "scene", "chat"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

/** Narrow untrusted input to a known venue; anything else is a plain review. */
export function asReviewSource(v: unknown): ReviewSource {
  return (REVIEW_SOURCES as readonly string[]).includes(v as string) ? (v as ReviewSource) : "review";
}

/**
 * Record a review: bump reviewCount and schedule the next review date using the
 * interval ladder above.
 */
// grade: 1=Again 2=Hard 3=Good 4=Easy (FSRS Rating).
export async function recordReview(id: string, grade: number = 3, retention?: number, source: ReviewSource = "review") {
  const word = await prisma.word.findUnique({ where: { id }, include: { user: { select: { retention: true } } } });
  if (!word) return null;
  // The setting lives on the account now, so surfaces that can't read the browser
  // (the bot) schedule with the learner's own retention instead of the default.
  const desired = retention ?? word.user.retention ?? undefined;

  // Practicing counts toward activity/streak regardless of the grade. The word,
  // the grade and the venue go in the same row: this is the learner model's only
  // record of what actually happened and it cannot be reconstructed later.
  await prisma.reviewEvent.create({ data: { userId: word.userId, wordId: word.id, grade, source } });
  track("review", { props: { grade, source } });

  const now = new Date();
  // Reconstruct the FSRS card from stored state (or a fresh one if never reviewed).
  const card: Card =
    word.stability == null
      ? createEmptyCard(now)
      : {
          due: word.due ?? now,
          stability: word.stability,
          difficulty: word.difficulty ?? 0,
          elapsed_days: 0,
          scheduled_days: 0,
          learning_steps: word.learningSteps,
          reps: word.reps,
          lapses: word.lapses,
          state: word.state as State,
          last_review: word.lastReview ?? undefined,
        };

  const { card: next } = schedulerFor(desired).next(card, now, grade as Grade);

  return prisma.word.update({
    where: { id },
    data: {
      stability: next.stability,
      difficulty: next.difficulty,
      due: next.due,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      learningSteps: next.learning_steps ?? 0,
      lastReview: now,
      nextReviewAt: next.due, // keep the legacy due field in sync for isDue/stats
      // "mastery" counter advances only on Good/Easy.
      reviewCount: grade >= 3 ? word.reviewCount + 1 : word.reviewCount,
    },
  });
}

/**
 * On-demand AI explanation of a word: nuance, when to use it, how it differs
 * from close synonyms, register, and a common mistake — written in the learner's
 * own language (the card's target language). Cached on the card: the first call
 * generates + stores it, later opens return it for free (cleared on edits).
 */
export async function explainWord(id: string): Promise<string> {
  const word = await prisma.word.findUnique({
    where: { id },
    select: { word: true, sourceLang: true, targetLang: true, meaningZh: true, partOfSpeech: true, synonyms: true, explainCache: true },
  });
  if (!word) throw new Error("Word not found");
  if (word.explainCache?.trim()) return word.explainCache.trim();

  const sourceName = langName(word.sourceLang);
  const targetName = langName(word.targetLang);
  const { explanation } = await chatJson({
    system:
      `You are a friendly ${sourceName} teacher. Explain the ${sourceName} word or phrase to a learner ` +
      `whose language is ${targetName}. Write ENTIRELY in ${targetName}, concise and practical (about 4-7 short sentences). ` +
      `Cover: what it really means and its nuance; when and how it's used; how it differs from close synonyms; ` +
      `register (formal/casual/slang); and one common mistake learners make. ` +
      `Do not just repeat the dictionary gloss.` +
      scriptNote(word.sourceLang) +
      scriptNote(word.targetLang) +
      ` Respond as JSON: {"explanation": string}.`,
    user:
      `Word: ${word.word}\nMeaning: ${word.meaningZh ?? "—"}\nPart of speech: ${word.partOfSpeech ?? "—"}` +
      (word.synonyms.length ? `\nListed synonyms: ${word.synonyms.join(", ")}` : ""),
    schema: explanationSchema,
  });
  const text = explanation.trim();
  // Cache it on the card so re-opening the word is free.
  await prisma.word.update({ where: { id }, data: { explainCache: text } }).catch(() => {});
  return text;
}

// Bump when the senses prompt changes so cards regenerate on their next open.
const SENSES_VERSION = 5;

// How the sense list is cached on the card. `for` is the meaning the learner's
// picks (the onCard flags) were saved for — once the card's meaning moves on, the
// flags no longer describe it.
type StoredSenses = { v?: number; list?: WordSense[]; for?: string; grounded?: boolean };

/** A sense list plus whether CC-CEDICT stated the inventory (the word page credits it). */
export type SenseList = { senses: WordSense[]; grounded: boolean };

// The leading gloss of a sense or of one segment of a card's meaning:
// "指明，指出（位置、方向、人或物）" -> "指明", "показать, продемонстрировать" -> "показать".
const headGloss = (s: string) =>
  (s.replace(/\s*[(（][^)）]*[)）]/g, " ").split(/[;；,，、/]/)[0] ?? "").trim().toLowerCase();

/**
 * Which senses a card tests, worked out from its meaning — for cards the learner
 * has never picked by hand. The meaning is a list of glosses ("указать, отметить;
 * показать…"), so a sense is tested when one of those segments opens with its head
 * gloss. Matching on any shared word instead ticked every Chinese sense at once,
 * because they share one (指出 / 指明，指出): the card said 指出 and the page claimed
 * both senses were on it. When nothing is recognisable (a hand-written meaning),
 * the model's own flag from generation time stands.
 */
function flagByMeaning(list: WordSense[], meaning: string): WordSense[] {
  const heads = new Set(meaning.split(/[;；]/).map(headGloss).filter(Boolean));
  if (!heads.size) return list;
  const out = list.map((s) => ({ ...s, onCard: heads.has(headGloss(s.meaning)) }));
  return out.some((s) => s.onCard) ? out : list;
}

// Crude stem for comparing two glosses: enough to see that "внимательно" and
// "внимательный" (or "careful" and "carefully") are the same word in different
// grammatical clothes. A 6-char prefix beats a real stemmer here — it works the
// same for every target language and never needs a dictionary.
function glossStems(meaning: string): Set<string> {
  return new Set(
    meaning
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ") // "(о способе действия)" says nothing about the sense
      .split(/[,;/|]+|\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((w) => w.length > 2)
      .map((w) => w.slice(0, 6)),
  );
}

// Two senses are the same sense when their glosses say the same thing: equal stem
// sets, one contained in the other, or half the stems shared.
function sameSense(a: WordSense, b: WordSense): boolean {
  const x = glossStems(a.meaning);
  const y = glossStems(b.meaning);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((s) => y.has(s)).length;
  if (!shared) return false;
  return shared === x.size || shared === y.size || shared / new Set([...x, ...y]).size >= 0.5;
}

/**
 * Fold senses that differ only by part of speech into one row (仔细 = "внимательно"
 * as an adverb and "внимательный" as an adjective is one meaning, not two). The
 * surviving row keeps both parts of speech, the gloss terms the other row added,
 * and one phrase from each so both uses stay visible.
 */
function mergePosVariants(list: WordSense[]): WordSense[] {
  const out: WordSense[] = [];
  for (const s of list) {
    const twin = out.find((o) => sameSense(o, s));
    if (!twin) {
      out.push(s);
      continue;
    }
    // Head = the sense the card tests, so the ticked gloss survives verbatim.
    const [head, extra] = twin.onCard || !s.onCard ? [twin, s] : [s, twin];
    const seen = glossStems(head.meaning);
    const added = extra.meaning
      .split(/\s*[,;]\s*/)
      .filter((term) => term && ![...glossStems(term)].some((st) => seen.has(st)))
      .slice(0, 2);
    const pos = [...new Set([head.pos, extra.pos].filter(Boolean).map((p) => p!.toLowerCase()))].slice(0, 2);
    out[out.indexOf(twin)] = {
      pos: pos.join(" / "),
      meaning: [head.meaning, ...added].join(", "),
      onCard: head.onCard || extra.onCard,
      // One phrase per use reads better than two of the same shape.
      phrases: [head.phrases[0], extra.phrases[0], head.phrases[1]].filter(Boolean).slice(0, 2),
    };
  }
  return out;
}

/**
 * Pleco-style sense list for the word page: 1–4 common senses, each with a part
 * of speech, a short gloss in the learner's language and 1–2 short phrases.
 * Generated lazily on the first word-page open and cached on the card, so most
 * cards (never opened) cost nothing. The card's meaningZh stays what it tests.
 */
export async function wordSenses(id: string): Promise<SenseList> {
  const word = await prisma.word.findUnique({
    where: { id },
    select: { word: true, sourceLang: true, targetLang: true, meaningZh: true, partOfSpeech: true, senses: true },
  });
  if (!word) throw new Error("Word not found");
  // Stored as { v, list }; a cache from an older prompt version is regenerated.
  const stored = word.senses as StoredSenses | null;
  // A pick the learner made by hand is kept with the meaning it was made for and
  // stands as long as that meaning does; otherwise the ticks follow the card.
  if (stored?.v === SENSES_VERSION && stored.list?.length)
    return {
      senses: stored.for === (word.meaningZh ?? "") ? stored.list : flagByMeaning(stored.list, word.meaningZh ?? ""),
      grounded: stored.grounded === true,
    };

  const sourceName = langName(word.sourceLang);
  const targetName = langName(word.targetLang);
  const cjk = ["zh", "zh-Hant", "ja", "ko"].includes(word.sourceLang);
  // Chinese: the dictionary owns the inventory and the model only picks and
  // shortens (see services/cedict.ts). Anything CC-CEDICT doesn't cover, and
  // every other language, keeps the model-invented list below.
  const inventory = isChinese(word.sourceLang) ? cedictInventory(word.word) : null;
  const { senses } = await chatJson({
    system:
      `You are a bilingual ${sourceName}–${targetName} learner's dictionary (like Pleco or Oxford Learner's). ` +
      (inventory
        ? `Below is the word's sense inventory from CC-CEDICT, a ${sourceName}–English dictionary. It is AUTHORITATIVE: ` +
          `every sense you return must be one of these, and you must NOT add a sense that is not in the list, however plausible. ` +
          `Your job is to select, group and translate, never to invent.\n${inventory}\n` +
          `Group the numbered glosses into 1–4 senses for the learner: glosses that would take the same ${targetName} translation are ONE sense. ` +
          `Keep the dictionary's order, most frequent first. Drop glosses marked rare, literary, archaic, dialect, Taiwan-only or purely technical, ` +
          `and drop classifier-only, surname-only and cross-reference glosses ("variant of …", "see …") unless the word has nothing else. ` +
          `Ignore grammar labels like "(bound form)" — they are not part of the meaning. ` +
          `Write each sense's "meaning" in ${targetName} as a learner's dictionary would gloss it, not as a literal rendering of the English: ` +
          `the English is the dictionary's own target language, so it may read stiffly. `
        : `List the distinct senses of the ${sourceName} word or phrase for a learner whose language is ${targetName}. ` +
          `Split senses the way a dictionary does: whenever the word in a different use needs a DIFFERENT ${targetName} translation, ` +
          `that is a separate sense (e.g. Chinese 打开 → 1 открыть (дверь, книгу); 2 включить (свет, телевизор); 3 развернуть, раскрыть (карту, ситуацию)). ` +
          `Most everyday words have 2–4 such senses; give just one when the word really has a single use (e.g. 值得 = стоить (того)). Max 4, most frequent first. Never list two senses with the same or near-identical translation — that is one sense; merge them. ` +
          `Order the senses by how common each one is in ${sourceName} itself, so the same word gets the same order whatever the learner's language. ` +
          `Leave out rare, archaic, dialect and purely technical senses. `) +
      `Senses differ in MEANING, never in grammar: a word that works as both an adjective and an adverb, or that ${targetName} renders once as a verb and once as a noun, is ONE sense — put both labels in "pos" ("прилагательное / наречие") instead of splitting the row. ` +
      `E.g. 仔细 is one sense (внимательный, тщательный — and adverbially внимательно), not two. ` +
      `The card currently says it means "${word.meaningZh ?? ""}": that must be one of your senses, glossed with the same wording, and marked "onCard": true (all others false). ` +
      // Grounding can contradict a card written before it: the card's meaning may
      // be a sense the dictionary doesn't have. The inventory wins — a wrong gloss
      // is exactly what this is here to stop — and no sense is ticked.
      (inventory
        ? `The one exception: if the card's meaning matches NO sense in the inventory above, leave it out and set "onCard": false everywhere — never add a sense to justify it. `
        : "") +
      `For each sense: "pos" = the part of speech written in ${targetName}, lowercase (e.g. for Russian "глагол", "существительное"); ` +
      `"meaning" = a short ${targetName} gloss of THIS sense only, 1–4 words, near-synonyms separated by ", ", optionally a typical object in parentheses; ` +
      `"phrases" = 2 SHORT, natural ${sourceName} phrases or collocations using the word in exactly that sense (2–6 words, not full sentences), ` +
      `each with "translation" in ${targetName} and "reading" = ` +
      (cjk ? `its romanization (pinyin with tone marks for Chinese, romaji for Japanese, Revised Romanization for Korean).` : `"" (empty).`) +
      scriptNote(word.sourceLang) +
      scriptNote(word.targetLang) +
      ` Respond as JSON: {"senses": [{"pos": string, "meaning": string, "onCard": boolean, "phrases": [{"text": string, "reading": string, "translation": string}]}]}.`,
    user: `Word: ${word.word}
Part of speech on the card: ${word.partOfSpeech ?? "—"}`,
    schema: sensesSchema,
  });
  const clean = mergePosVariants(
    senses.map(
      (s): WordSense => ({
        pos: (s.pos ?? "").trim(),
        meaning: s.meaning.trim(),
        onCard: s.onCard === true,
        phrases: (s.phrases ?? [])
          .slice(0, 2)
          .map((p) => ({ text: p.text.trim(), reading: (p.reading ?? "").trim(), translation: (p.translation ?? "").trim() })),
      }),
      )
      .filter((s) => s.meaning),
  ).slice(0, 4);
  // A curated card often means several of these senses at once ("указать, отметить;
  // показать…"), while the model flags only the one it wrote the gloss from — so the
  // ticks are re-read off the card's meaning, exactly as they are on every later open.
  const flagged = flagByMeaning(clean, word.meaningZh ?? "");
  if (flagged.length) {
    await prisma.word
      .update({
        where: { id },
        data: {
          senses: { v: SENSES_VERSION, list: flagged, grounded: inventory !== null } as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
  }
  return { senses: flagged, grounded: inventory !== null };
}

/**
 * Fill in a card's word family (synonyms + antonyms) when it arrived without one.
 * Onomika Library decks are hand-written and carry empty lists, and a copy keeps
 * them, so those cards showed no family graph at all while AI-added cards showed a
 * full one. Asked once on the first word-page open and stored on the learner's own
 * card; `familyAt` records that we asked, so a word that genuinely has no antonyms
 * (most phrasal verbs) doesn't re-spend tokens on every open.
 */
export async function wordFamily(id: string): Promise<{ synonyms: string[]; antonyms: string[] }> {
  const word = await prisma.word.findUnique({
    where: { id },
    select: { word: true, sourceLang: true, targetLang: true, meaningZh: true, partOfSpeech: true, synonyms: true, antonyms: true, familyAt: true },
  });
  if (!word) throw new Error("Word not found");
  const have = { synonyms: word.synonyms, antonyms: word.antonyms };
  if (word.familyAt || have.synonyms.length || have.antonyms.length) return have;

  const sourceName = langName(word.sourceLang);
  const targetName = langName(word.targetLang);
  const { synonyms, antonyms } = await chatJson({
    system:
      `You are a bilingual ${sourceName}–${targetName} learner's dictionary. ` +
      `Give the close synonyms and the opposites of the ${sourceName} word or phrase, as ${sourceName} words — never ${targetName} ones. ` +
      `Up to 4 synonyms and up to 3 antonyms, common and everyday, matching the sense the card tests and its register. ` +
      `Only real, usable alternatives: return an empty list rather than a stretch — plenty of words (most phrasal verbs) have no true opposite. ` +
      `Single words or short phrases, no explanations.` +
      scriptNote(word.sourceLang) +
      ` Respond as JSON: {"synonyms": string[], "antonyms": string[]}.`,
    user: `Word: ${word.word}\nMeaning (${targetName}): ${word.meaningZh ?? "—"}\nPart of speech: ${word.partOfSpeech ?? "—"}`,
    schema: familySchema,
  });
  const self = word.word.trim().toLowerCase();
  const clean = (list: string[], max: number) =>
    [...new Set(list.map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== self))].slice(0, max);
  const out = { synonyms: clean(synonyms, 4), antonyms: clean(antonyms, 3) };
  await prisma.word.update({ where: { id }, data: { ...out, familyAt: new Date() } }).catch(() => {});
  return out;
}

/**
 * Follow-up mini-chat about a word. The client sends the visible conversation
 * (the first assistant turn is the AI explanation); we prepend a system prompt
 * with the card's context so answers stay grounded and in the learner's language.
 */
export async function askAboutWord(
  id: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<WordChatResult> {
  const word = await prisma.word.findUnique({
    where: { id },
    select: {
      word: true,
      sourceLang: true,
      targetLang: true,
      meaningZh: true,
      partOfSpeech: true,
      synonyms: true,
      antonyms: true,
      examples: { orderBy: { createdAt: "desc" }, take: 1, select: { sentenceEn: true } },
    },
  });
  if (!word) throw new Error("Word not found");

  const sourceName = langName(word.sourceLang);
  const targetName = langName(word.targetLang);
  const clipped = history.slice(-12).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 2000),
  })) as ChatMessage[];

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `You are a friendly ${sourceName} teacher helping a learner whose language is ${targetName}. ` +
        `The learner is asking follow-up questions about this ${sourceName} word/phrase. ` +
        `Answer in the "answer" field ENTIRELY in ${targetName}, concise and practical (a few short sentences). ` +
        `Give ${sourceName} examples where helpful. ` +
        `STAY STRICTLY ON TOPIC: only discuss this word/phrase and ${sourceName} language learning ` +
        `(meaning, usage, grammar, nuance, related words, pronunciation, examples). If the learner ` +
        `asks about anything unrelated (general knowledge, tech, people, etc.), politely decline in ` +
        `${targetName} and steer back to the word.\n\n` +
        `SELF-TEST: if the learner asks you to test/quiz them (or says they'll try to recall it), ask ONE ` +
        `short question about this word — e.g. use it in a sentence, give its meaning, or when to use it — ` +
        `and wait. When they answer, GRADE it warmly: say what was right, gently correct mistakes, and ` +
        `show one correct ${sourceName} example. Keep it short and encouraging.\n\n` +
        `ACTIONS: if the learner asks you to add synonyms or antonyms (or you clearly recommend some), ` +
        `put those ${sourceName} words in "addSynonyms" / "addAntonyms" (only genuine ones, in ${sourceName}, ` +
        `not already listed). If the learner explicitly asks to SAVE/ADD new vocabulary as its own ` +
        `card(s) — even words unrelated to this one — ALWAYS honor it (this is a valid learning action, ` +
        `not off-topic): put those ${sourceName} words in "addWords". ` +
        `If the learner asks to SAVE/ADD an example sentence to this card (e.g. "add this example", ` +
        `"save that sentence"), put it in "addExamples" as {sentence: the ${sourceName} sentence, ` +
        `translation: its ${targetName} translation}. Otherwise leave the arrays empty.` +
        scriptNote(word.sourceLang) +
        scriptNote(word.targetLang) +
        ' Respond as JSON: {"answer": string, "addSynonyms": string[], "addAntonyms": string[], "addWords": string[], "addExamples": {"sentence": string, "translation": string}[]}.\n\n' +
        `Word: ${word.word}\nMeaning: ${word.meaningZh ?? "—"}\nPart of speech: ${word.partOfSpeech ?? "—"}` +
        (word.synonyms.length ? `\nExisting synonyms: ${word.synonyms.join(", ")}` : "") +
        (word.antonyms.length ? `\nExisting antonyms: ${word.antonyms.join(", ")}` : "") +
        (word.examples[0]?.sentenceEn ? `\nExample: ${word.examples[0].sentenceEn}` : ""),
    },
    ...clipped,
  ];

  const result = await chatJsonConversation({ messages, schema: wordChatSchema, timeoutMs: 60000 });
  // Don't re-suggest words the card already has.
  const have = new Set([...word.synonyms, ...word.antonyms].map((s) => s.trim().toLowerCase()));
  const self = word.word.trim().toLowerCase();
  return {
    answer: result.answer.trim(),
    addSynonyms: (result.addSynonyms ?? []).filter((s) => s.trim() && !have.has(s.trim().toLowerCase())),
    addAntonyms: (result.addAntonyms ?? []).filter((s) => s.trim() && !have.has(s.trim().toLowerCase())),
    addWords: (result.addWords ?? []).filter((s) => s.trim() && s.trim().toLowerCase() !== self),
    addExamples: (result.addExamples ?? [])
      .filter((e) => e.sentence.trim())
      .map((e) => ({ sentence: e.sentence, translation: e.translation ?? "" })),
  };
}

/** Aggregated learning stats for the dashboard. */
export async function getStats(telegramId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  const empty = {
    total: 0,
    mastered: 0,
    learning: 0,
    due: 0,
    trainedToday: 0,
    streak: 0,
    reviews: 0,
    canUse: 0,
    canUseWeek: 0,
    tried: 0,
    languages: [] as string[],
    days: [] as { date: string; added: number; reviews: number }[],
    heat: [] as { date: string; count: number }[],
  };
  if (!user) return empty;

  const now = Date.now();
  const words = await prisma.word.findMany({
    where: { userId: user.id },
    select: { reviewCount: true, nextReviewAt: true, createdAt: true, sourceLang: true },
  });
  // Lifetime review count (every graded review logs an event) + the distinct
  // source languages the learner studies — both feed achievements & friend cards.
  const reviews = await prisma.reviewEvent.count({ where: { userId: user.id } });
  const languages = Array.from(new Set(words.map((w) => w.sourceLang))).sort();
  // Pull a wide window (for the heatmap); the 14-day chart is a subset of it.
  const HEAT_DAYS = 119; // 17 weeks
  const since = new Date(now - (HEAT_DAYS - 1) * 86400_000);
  since.setHours(0, 0, 0, 0);
  const events = await prisma.reviewEvent.findMany({
    where: { userId: user.id, createdAt: { gte: since } },
    select: { createdAt: true },
  });
  // Use-steps are practice too. They no longer write a ReviewEvent (F3 split the
  // ledgers), so a learner who only drills would otherwise lose their streak.
  const producedDays = await productionDays(user.id, since);
  const produced = await productionSummary(user.id);

  const total = words.length;
  const mastered = words.filter((w) => w.reviewCount >= 5).length;
  const due = words.filter((w) => !w.nextReviewAt || w.nextReviewAt.getTime() <= now).length;

  const key = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.toISOString().slice(0, 10);
  };
  const addedMap = new Map<string, number>();
  for (const w of words) addedMap.set(key(w.createdAt), (addedMap.get(key(w.createdAt)) ?? 0) + 1);
  const reviewMap = new Map<string, number>();
  for (const e of events) reviewMap.set(key(e.createdAt), (reviewMap.get(key(e.createdAt)) ?? 0) + 1);
  for (const d of producedDays) reviewMap.set(d, (reviewMap.get(d) ?? 0) + 1);

  const days: { date: string; added: number; reviews: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400_000);
    d.setHours(0, 0, 0, 0);
    const k = d.toISOString().slice(0, 10);
    days.push({ date: k, added: addedMap.get(k) ?? 0, reviews: reviewMap.get(k) ?? 0 });
  }

  // Wide heatmap series (reviews per day, last 119 days).
  const heat: { date: string; count: number }[] = [];
  for (let i = HEAT_DAYS - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400_000);
    d.setHours(0, 0, 0, 0);
    const k = d.toISOString().slice(0, 10);
    heat.push({ date: k, count: reviewMap.get(k) ?? 0 });
  }

  const todayKey = key(new Date(now));
  const trainedToday = reviewMap.get(todayKey) ?? 0;

  // streak: consecutive days (ending today or yesterday) with >=1 review
  let streak = 0;
  for (let i = 0; i < days.length; i++) {
    const day = days[days.length - 1 - i];
    if (day.reviews > 0) streak++;
    else if (i === 0) continue; // allow today to be empty without breaking
    else break;
  }

  return {
    total,
    mastered,
    learning: total - mastered,
    due,
    trainedToday,
    streak,
    reviews,
    canUse: produced.canUse,
    canUseWeek: produced.canUseWeek,
    tried: produced.tried,
    languages,
    days,
    heat,
  };
}

// ---------------- Collections (word sets like "IELTS", "adjectives") ----------------

/** A user's collections, each with how many words it holds + its sharing state. */
export async function listCollections(telegramId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return [];
  const cols = await prisma.collection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { words: true, adds: true } } },
  });
  const credits = await copiedCredits(cols.map((c) => c.copiedFromId).filter((id): id is string => Boolean(id)));
  return cols.map((c) => ({
    id: c.id,
    name: c.name,
    count: c._count.words,
    description: c.description,
    folderId: c.folderId,
    visibility: c.visibility,
    shareCode: c.shareCode,
    delisted: Boolean(c.delistedAt),
    learners: c._count.adds,
    copiedFrom: c.copiedFromId ? (credits.get(c.copiedFromId) ?? null) : null,
  }));
}

/** Create a named collection for a user. */
export async function createCollection(telegramId: string, name: string) {
  const user = await ensureUser(telegramId);
  try {
    const c = await prisma.collection.create({
      data: { userId: user.id, name: name.trim() },
    });
    return { id: c.id, name: c.name, count: 0 };
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      throw new Error(`You already have a collection called “${name.trim()}”.`);
    }
    throw err;
  }
}

/**
 * Owner edits: rename, description, folder and visibility. Sharing (any mode but
 * private) mints a share code the first time, so the owner can pass a link/code.
 */
export async function updateCollection(
  id: string,
  patch: { name?: string; description?: string | null; folderId?: string | null; visibility?: Visibility },
) {
  const current = await prisma.collection.findUniqueOrThrow({ where: { id }, select: { shareCode: true, delistedAt: true } });
  // A deck the admin took out of Community can't be republished there.
  if (patch.visibility === "public" && current.delistedAt) {
    throw Object.assign(new Error("This deck was removed from Community"), { code: "deck_delisted" });
  }
  const shareCode =
    patch.visibility && patch.visibility !== "private" && !current.shareCode ? await mintShareCode() : undefined;
  try {
    const c = await prisma.collection.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
        ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
        ...(patch.visibility ? { visibility: patch.visibility } : {}),
        ...(shareCode ? { shareCode } : {}),
      },
    });
    return { id: c.id, name: c.name, visibility: c.visibility, shareCode: c.shareCode, folderId: c.folderId, description: c.description };
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      throw new Error(`You already have a collection called “${patch.name?.trim()}”.`);
    }
    throw err;
  }
}

// ---------------- Folders (one level: folders hold collections, never folders) ----------------

export async function userOwnsFolder(folderId: string, telegramId: string | null | undefined): Promise<boolean> {
  if (!telegramId) return false;
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return false;
  const f = await prisma.folder.findFirst({ where: { id: folderId, userId: user.id }, select: { id: true } });
  return Boolean(f);
}

export async function listFolders(telegramId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return [];
  const rows = await prisma.folder.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } });
  return rows.map((f) => ({ id: f.id, name: f.name }));
}

function folderClash(err: unknown, name: string): never {
  if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
    throw new Error(`You already have a folder called “${name.trim()}”.`);
  }
  throw err;
}

export async function createFolder(telegramId: string, name: string) {
  const user = await ensureUser(telegramId);
  try {
    const f = await prisma.folder.create({ data: { userId: user.id, name: name.trim() } });
    return { id: f.id, name: f.name };
  } catch (err) {
    folderClash(err, name);
  }
}

export async function renameFolder(id: string, name: string) {
  try {
    const f = await prisma.folder.update({ where: { id }, data: { name: name.trim() } });
    return { id: f.id, name: f.name };
  } catch (err) {
    folderClash(err, name);
  }
}

/** Delete a folder; its collections fall back to "no folder" (SET NULL). */
export async function deleteFolder(id: string) {
  await prisma.folder.delete({ where: { id } });
  return { ok: true };
}

/** Delete a collection (words themselves are untouched). */
export async function deleteCollection(id: string) {
  return prisma.collection.delete({ where: { id } });
}

/** Add or remove a word from a collection. */
export async function setWordInCollection(collectionId: string, wordId: string, member: boolean) {
  await prisma.collection.update({
    where: { id: collectionId },
    data: { words: member ? { connect: { id: wordId } } : { disconnect: { id: wordId } } },
  });
  return { ok: true };
}
