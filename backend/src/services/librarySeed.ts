import { prisma } from "./db.js";
import { LIBRARY_DECKS } from "../seed/libraryDecks.js";

// The Onomika Library: a system account that owns the curated starter decks in
// the Community tab. Its telegramId can't be produced by any sign-in provider, so
// nobody can log in as it, and the UI shows it as "Onomika Library" + Official.
export const LIBRARY_TELEGRAM_ID = "onomika-library";
export const LIBRARY_NAME = "Onomika Library";

/**
 * Create or refresh the library decks. Idempotent and cheap on every boot: a deck
 * whose stored seedVersion matches is skipped; an edited deck (version bumped) is
 * rebuilt in place, so its id, share links and "added by N" counters survive.
 */
export async function seedLibrary(): Promise<void> {
  const lib = await prisma.user.upsert({
    where: { telegramId: LIBRARY_TELEGRAM_ID },
    create: { telegramId: LIBRARY_TELEGRAM_ID, displayName: LIBRARY_NAME, authVia: "system" },
    update: {},
  });

  for (const deck of LIBRARY_DECKS) {
    for (const target of deck.targets) {
      const slug = `${deck.slug}-${target}`;
      const existing = await prisma.collection.findUnique({ where: { slug } });
      if (existing?.seedVersion === deck.version) continue;

      const meta = {
        name: deck.name[target],
        description: deck.description[target] ?? null,
        // A library deck the admin delisted stays out of Community across reseeds.
        visibility: existing?.delistedAt ? "private" : "public",
        mikaPick: Boolean(deck.mikaPick),
        seedVersion: deck.version,
      };
      const col = existing
        ? await prisma.collection.update({ where: { id: existing.id }, data: meta })
        : await prisma.collection.create({ data: { ...meta, userId: lib.id, slug } });

      // Rebuild the word list (the library's own cards only; learners' copies are
      // separate rows and are never touched).
      if (existing) {
        await prisma.word.deleteMany({ where: { userId: lib.id, collections: { some: { id: col.id } } } });
      }
      for (const w of deck.words) {
        await prisma.word.create({
          data: {
            userId: lib.id,
            word: w.w,
            sourceLang: deck.sourceLang,
            targetLang: target,
            phonetic: w.ph ?? null,
            partOfSpeech: w.pos ?? null,
            meaningZh: w.m[target] ?? null,
            synonyms: w.syn ?? [],
            collocations: [],
            antonyms: [],
            collections: { connect: { id: col.id } },
            examples: {
              create: { sentenceEn: w.ex, sentenceZh: w.exT[target] ?? "", sourceName: LIBRARY_NAME, sourceUrl: "" },
            },
          },
        });
      }
      console.log(`[library] seeded ${slug} v${deck.version} (${deck.words.length} words)`);
    }
  }
}
