import { prisma } from "./db.js";
import { fsrs, generatorParameters, createEmptyCard, type Card, type Grade, type State } from "ts-fsrs";
import { runExampleSearch } from "../agents/exampleSearch.js";
import { runTutor } from "../agents/tutor.js";
import { chatJson, chatJsonConversation, type ChatMessage } from "./llm.js";
import { normalizeLang } from "../lib/detect.js";
import { langName } from "../lib/langs.js";
import { explanationSchema, wordChatSchema, type WordChatResult } from "../lib/schemas.js";

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
  exampleStyle?: string;
}) {
  const user = await ensureUser(params.telegramId);
  const sourceLang = normalizeLang(params.word, params.sourceLang);
  const example = await runExampleSearch({
    userId: user.id,
    word: params.word,
    sourceLang,
    targetLang: params.targetLang,
    level: params.level,
    exampleStyle: params.exampleStyle,
  });
  await runTutor({
    wordId: example.wordId,
    word: params.word,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
  });

  return prisma.word.findUniqueOrThrow({
    where: { id: example.wordId },
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

  return prisma.word.findUniqueOrThrow({
    where: { id: wordRecord.id },
    include: {
      examples: { orderBy: { createdAt: "desc" } },
      collections: { select: { id: true, name: true } },
    },
  });
}

/** All of a user's saved words, newest first, each with its examples. */
export async function listWordsForUser(telegramId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return [];
  return prisma.word.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      examples: { orderBy: { createdAt: "desc" } },
      collections: { select: { id: true, name: true } },
    },
  });
}

/** A single word by id, with its examples. */
export async function getWord(id: string) {
  return prisma.word.findUnique({
    where: { id },
    include: {
      examples: { orderBy: { createdAt: "desc" } },
      collections: { select: { id: true, name: true } },
    },
  });
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
  opts: { exampleStyle?: string; level?: string; replace?: boolean } = {},
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

/**
 * Record a review: bump reviewCount and schedule the next review date using the
 * interval ladder above.
 */
// grade: 1=Again 2=Hard 3=Good 4=Easy (FSRS Rating).
export async function recordReview(id: string, grade: number = 3, retention?: number) {
  const word = await prisma.word.findUnique({ where: { id } });
  if (!word) return null;

  // Practicing counts toward activity/streak regardless of the grade.
  await prisma.reviewEvent.create({ data: { userId: word.userId } });

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

  const { card: next } = schedulerFor(retention).next(card, now, grade as Grade);

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
 * own language (the card's target language). Not stored (on-demand, one call).
 */
export async function explainWord(id: string): Promise<string> {
  const word = await prisma.word.findUnique({
    where: { id },
    select: { word: true, sourceLang: true, targetLang: true, meaningZh: true, partOfSpeech: true, synonyms: true },
  });
  if (!word) throw new Error("Word not found");

  const sourceName = langName(word.sourceLang);
  const targetName = langName(word.targetLang);
  const { explanation } = await chatJson({
    system:
      `You are a friendly ${sourceName} teacher. Explain the ${sourceName} word or phrase to a learner ` +
      `whose language is ${targetName}. Write ENTIRELY in ${targetName}, concise and practical (about 4-7 short sentences). ` +
      `Cover: what it really means and its nuance; when and how it's used; how it differs from close synonyms; ` +
      `register (formal/casual/slang); and one common mistake learners make. ` +
      `Do not just repeat the dictionary gloss. Respond as JSON: {"explanation": string}.`,
    user:
      `Word: ${word.word}\nMeaning: ${word.meaningZh ?? "—"}\nPart of speech: ${word.partOfSpeech ?? "—"}` +
      (word.synonyms.length ? `\nListed synonyms: ${word.synonyms.join(", ")}` : ""),
    schema: explanationSchema,
  });
  return explanation.trim();
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
        `ACTIONS: if the learner asks you to add synonyms or antonyms (or you clearly recommend some), ` +
        `put those ${sourceName} words in "addSynonyms" / "addAntonyms" (only genuine ones, in ${sourceName}, ` +
        `not already listed). Otherwise leave those arrays empty. ` +
        'Respond as JSON: {"answer": string, "addSynonyms": string[], "addAntonyms": string[]}.\n\n' +
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
  return {
    answer: result.answer.trim(),
    addSynonyms: (result.addSynonyms ?? []).filter((s) => s.trim() && !have.has(s.trim().toLowerCase())),
    addAntonyms: (result.addAntonyms ?? []).filter((s) => s.trim() && !have.has(s.trim().toLowerCase())),
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
    days: [] as { date: string; added: number; reviews: number }[],
    heat: [] as { date: string; count: number }[],
  };
  if (!user) return empty;

  const now = Date.now();
  const words = await prisma.word.findMany({
    where: { userId: user.id },
    select: { reviewCount: true, nextReviewAt: true, createdAt: true },
  });
  // Pull a wide window (for the heatmap); the 14-day chart is a subset of it.
  const HEAT_DAYS = 119; // 17 weeks
  const since = new Date(now - (HEAT_DAYS - 1) * 86400_000);
  since.setHours(0, 0, 0, 0);
  const events = await prisma.reviewEvent.findMany({
    where: { userId: user.id, createdAt: { gte: since } },
    select: { createdAt: true },
  });

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

  return { total, mastered, learning: total - mastered, due, trainedToday, streak, days, heat };
}

// ---------------- Collections (word sets like "IELTS", "adjectives") ----------------

/** A user's collections, each with how many words it holds. */
export async function listCollections(telegramId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return [];
  const cols = await prisma.collection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { words: true } } },
  });
  return cols.map((c) => ({ id: c.id, name: c.name, count: c._count.words }));
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

export async function renameCollection(id: string, name: string) {
  const c = await prisma.collection.update({ where: { id }, data: { name: name.trim() } });
  return { id: c.id, name: c.name };
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
