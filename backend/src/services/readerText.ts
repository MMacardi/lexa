import { prisma } from "./db.js";
import { chatJson } from "./llm.js";
import { langName, scriptNote } from "../lib/langs.js";
import { z } from "zod";

// Saved Reader texts + an AI text generator. All list/mutations are scoped to the
// owner (resolved by telegramId, like the rest of vocab).

async function userId(telegramId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  return u?.id ?? null;
}

export async function listTexts(telegramId: string, q?: string, collection?: string) {
  const uid = await userId(telegramId);
  if (!uid) return [];
  const query = q?.trim();
  const coll = collection?.trim();
  const rows = await prisma.readerText.findMany({
    where: {
      userId: uid,
      ...(coll ? { collection: coll } : {}),
      ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { content: { contains: query, mode: "insensitive" } }] } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, content: true, status: true, collection: true, level: true, sourceLang: true, targetLang: true, updatedAt: true },
  });
  // Return a short snippet for the list, full content only when opening one.
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: r.content.slice(0, 140),
    status: r.status,
    collection: r.collection,
    level: r.level,
    sourceLang: r.sourceLang,
    targetLang: r.targetLang,
    updatedAt: r.updatedAt,
  }));
}

// Distinct non-empty collection names this user has used (for the library filter).
export async function listCollections(telegramId: string): Promise<string[]> {
  const uid = await userId(telegramId);
  if (!uid) return [];
  const rows = await prisma.readerText.findMany({
    where: { userId: uid, collection: { not: null } },
    distinct: ["collection"],
    orderBy: { collection: "asc" },
    select: { collection: true },
  });
  return rows.map((r) => r.collection!).filter((c) => c.trim());
}

export async function getText(telegramId: string, id: string) {
  const uid = await userId(telegramId);
  if (!uid) return null;
  return prisma.readerText.findFirst({ where: { id, userId: uid } });
}

// Ask the model for a short, natural title for a pasted text (the "let AI name
// it" option at save time). Best-effort: falls back to the first line on error.
async function titleFor(content: string, sourceLang?: string): Promise<string> {
  const source = langName(sourceLang ?? "en");
  const body = content.trim().slice(0, 1500);
  const fallback = body.slice(0, 40) || "Untitled";
  try {
    const r = await chatJson({
      system:
        `Give a short, natural ${source} title (3–6 words, no quotes, no trailing ` +
        `punctuation) for the ${source} text the user sends.` +
        scriptNote(sourceLang ?? "en") +
        ` Respond as JSON: {"title": string}.`,
      user: body,
      schema: z.object({ title: z.string().min(1).max(120) }),
      timeoutMs: 20000,
    });
    return r.title.trim() || fallback;
  } catch {
    return fallback;
  }
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

// Cheaply estimate a text's CEFR level in one short call. Best-effort.
async function estimateLevel(content: string, sourceLang?: string): Promise<string | null> {
  const source = langName(sourceLang ?? "en");
  try {
    const r = await chatJson({
      system:
        `Estimate the CEFR level of the ${source} text (one of A1, A2, B1, B2, C1, C2) ` +
        `by its vocabulary and grammar. Respond as JSON: {"level": string}.`,
      user: content.trim().slice(0, 1500),
      schema: z.object({ level: z.string().min(1).max(12) }),
      timeoutMs: 15000,
    });
    const lvl = r.level.trim().toUpperCase();
    return (LEVELS as readonly string[]).includes(lvl) ? lvl : null;
  } catch {
    return null;
  }
}

export async function createText(
  telegramId: string,
  data: {
    title: string;
    content: string;
    collection?: string;
    autoName?: boolean;
    translation?: string;
    clickedWords?: string[];
    estimateLevel?: boolean;
    level?: string;
    sourceLang?: string;
    targetLang?: string;
  },
) {
  const uid = await userId(telegramId);
  if (!uid) throw new Error("Account not found");
  const typed = data.title.trim();
  const title = typed || (data.autoName ? await titleFor(data.content, data.sourceLang) : data.content.trim().slice(0, 40) || "Untitled");
  const collection = data.collection?.trim() || null;
  // A level the user picked wins (no tokens); only estimate via the model when
  // asked to and none was provided.
  const level = data.level?.trim()
    ? data.level.trim().toUpperCase()
    : data.estimateLevel
      ? await estimateLevel(data.content, data.sourceLang)
      : null;
  return prisma.readerText.create({
    data: {
      userId: uid,
      title,
      content: data.content,
      collection,
      translation: data.translation?.trim() || null,
      clickedWords: data.clickedWords ?? [],
      level,
      sourceLang: data.sourceLang ?? null,
      targetLang: data.targetLang ?? null,
    },
    select: { id: true, title: true, level: true },
  });
}

export async function updateText(
  telegramId: string,
  id: string,
  data: {
    title?: string;
    content?: string;
    collection?: string | null;
    level?: string | null;
    translation?: string | null;
    clickedWords?: string[];
  },
) {
  const uid = await userId(telegramId);
  if (!uid) throw new Error("Account not found");
  const owned = await prisma.readerText.findFirst({ where: { id, userId: uid }, select: { id: true } });
  if (!owned) throw new Error("Text not found");
  return prisma.readerText.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title.trim() || "Untitled" } : {}),
      ...(data.content !== undefined ? { content: data.content } : {}),
      ...(data.collection !== undefined ? { collection: data.collection?.trim() || null } : {}),
      ...(data.level !== undefined ? { level: data.level?.trim().toUpperCase() || null } : {}),
      ...(data.translation !== undefined ? { translation: data.translation?.trim() || null } : {}),
      ...(data.clickedWords !== undefined ? { clickedWords: data.clickedWords } : {}),
    },
    select: { id: true, title: true, level: true },
  });
}

export async function deleteText(telegramId: string, id: string): Promise<void> {
  const uid = await userId(telegramId);
  if (!uid) throw new Error("Account not found");
  await prisma.readerText.deleteMany({ where: { id, userId: uid } });
}

const generatedSchema = z.object({ title: z.string().min(1).max(120), content: z.string().min(1) });

interface GenParams {
  topic: string;
  sourceLang?: string;
  targetLang?: string;
  level?: string;
}

async function generateOne(params: GenParams): Promise<{ title: string; content: string }> {
  const source = langName(params.sourceLang ?? "en");
  const levelLine = params.level
    ? `Write it for a CEFR ${params.level} learner — vocabulary and grammar they can mostly follow. `
    : "Keep it accessible for an intermediate learner. ";
  const result = await chatJson({
    system:
      `You are a ${source} writing assistant for a language learner. Write an original, engaging, ` +
      `coherent ${source} text (about 120–220 words, a few short paragraphs) on the user's topic. ` +
      levelLine +
      `Natural, correct ${source}; no title inside the body; no translation.` +
      scriptNote(params.sourceLang ?? "en") +
      ` Respond as JSON: {"title": a short ${source} title, "content": the text}.`,
    user: params.topic.slice(0, 300),
    schema: generatedSchema,
    timeoutMs: 60000,
  });
  return { title: result.title.trim(), content: result.content.trim() };
}

/**
 * Start generating a reading text in the BACKGROUND (like word enrichment): a row
 * is created immediately with status "generating", the model call runs after we
 * respond, and the row is filled in when ready. The client polls the row.
 */
export async function startGeneration(telegramId: string, params: GenParams) {
  const uid = await userId(telegramId);
  if (!uid) throw new Error("Account not found");
  // A level the learner picked is stored straight away (no tokens); otherwise we
  // estimate it from the finished text below.
  const chosenLevel = params.level?.trim().toUpperCase() || null;
  const row = await prisma.readerText.create({
    data: {
      userId: uid,
      title: params.topic.slice(0, 60),
      content: "",
      status: "generating",
      level: chosenLevel,
      sourceLang: params.sourceLang ?? null,
      targetLang: params.targetLang ?? null,
    },
    select: { id: true, title: true, status: true },
  });
  // Fire-and-forget: fill the row once the model responds.
  void (async () => {
    try {
      const { title, content } = await generateOne(params);
      // If the learner didn't pick a level, estimate it from the generated text.
      const level = chosenLevel ?? (await estimateLevel(content, params.sourceLang));
      await prisma.readerText.update({ where: { id: row.id }, data: { title, content, status: "ready", level } });
    } catch (err) {
      console.error("reader generation failed:", err);
      await prisma.readerText.update({ where: { id: row.id }, data: { status: "failed" } }).catch(() => {});
    }
  })();
  return row;
}
