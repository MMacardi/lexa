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

export async function listTexts(telegramId: string, q?: string) {
  const uid = await userId(telegramId);
  if (!uid) return [];
  const query = q?.trim();
  const rows = await prisma.readerText.findMany({
    where: {
      userId: uid,
      ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { content: { contains: query, mode: "insensitive" } }] } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, content: true, status: true, sourceLang: true, targetLang: true, updatedAt: true },
  });
  // Return a short snippet for the list, full content only when opening one.
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: r.content.slice(0, 140),
    status: r.status,
    sourceLang: r.sourceLang,
    targetLang: r.targetLang,
    updatedAt: r.updatedAt,
  }));
}

export async function getText(telegramId: string, id: string) {
  const uid = await userId(telegramId);
  if (!uid) return null;
  return prisma.readerText.findFirst({ where: { id, userId: uid } });
}

export async function createText(
  telegramId: string,
  data: { title: string; content: string; sourceLang?: string; targetLang?: string },
) {
  const uid = await userId(telegramId);
  if (!uid) throw new Error("Account not found");
  const title = data.title.trim() || data.content.trim().slice(0, 40) || "Untitled";
  return prisma.readerText.create({
    data: { userId: uid, title, content: data.content, sourceLang: data.sourceLang ?? null, targetLang: data.targetLang ?? null },
    select: { id: true, title: true },
  });
}

export async function updateText(
  telegramId: string,
  id: string,
  data: { title?: string; content?: string },
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
    },
    select: { id: true, title: true },
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
  const row = await prisma.readerText.create({
    data: {
      userId: uid,
      title: params.topic.slice(0, 60),
      content: "",
      status: "generating",
      sourceLang: params.sourceLang ?? null,
      targetLang: params.targetLang ?? null,
    },
    select: { id: true, title: true, status: true },
  });
  // Fire-and-forget: fill the row once the model responds.
  void (async () => {
    try {
      const { title, content } = await generateOne(params);
      await prisma.readerText.update({ where: { id: row.id }, data: { title, content, status: "ready" } });
    } catch (err) {
      console.error("reader generation failed:", err);
      await prisma.readerText.update({ where: { id: row.id }, data: { status: "failed" } }).catch(() => {});
    }
  })();
  return row;
}
