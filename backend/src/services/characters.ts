import { prisma } from "./db.js";
import { cedictCard, cedictLookup, readingGloss, toneMarked } from "./cedict.js";
import { defaultMeaning } from "./lookup.js";
import { cachedDictionary, localizedDictionary } from "./localizedDictionary.js";
import { hskPage, readsAs } from "./wordPages.js";
import { asHskVersion, hskFrequency, hskTagFor, hskWordsWith, normalizeHanzi, type HskTag, type HskVersion } from "./hsk.js";

// The word page's Characters block (learning audit 8e): each character of a
// Chinese word with its reading and meaning, and the HSK words built on it, the
// easiest first and the learner's own cards marked. Between HSK 4 and 5 (about
// 1,200 → 2,500 words) the characters are what let a learner guess a new word
// and keep it: the 电 of 电脑 is the 电 of 电视, 电话 and 电影. Dictionary and
// list data first; missing Russian glosses use the shared dictionary adaptation.

export type CharWord = {
  word: string;
  pinyin: string;
  meaning: string;
  english: boolean; // no localized meaning yet; Russian responses keep it empty
  level: number | null; // on the learner's list
  id?: string; // the learner's card for it
};
export type CharInfo = CharWord & { words: CharWord[] };

const WORDS_PER_CHAR = 6;

// A tone mark on any vowel: a syllable without one is a neutral tone.
const TONED = /[̀́̄̌]/;

async function russianMeaning(word: string, reading: string, own: string, localize: boolean) {
  if (readsAs(word, reading, own)) {
    const meaning = defaultMeaning(word, "ru");
    if (meaning) return meaning;
  }
  const prepared = hskPage(word, "ru")?.s.filter((s) => readsAs(word, s.r, reading)).map((s) => s.m).join("; ");
  if (prepared) return prepared;
  const adapted = await (localize ? localizedDictionary(word, "ru") : cachedDictionary(word, "ru"));
  return adapted?.senses.filter((s) => readsAs(word, s.reading ?? adapted.phonetic, reading))
    .map((s) => s.meaning).join("; ") || "";
}

// Match the reading in the word, including alternate readings (长大 zhǎng),
// while keeping neutral tones and 一/不's tone changes on their usual reading.
async function charReading(ch: string, said: string | undefined, lang: string, localize: boolean) {
  const card = await cedictCard(ch, { count: false });
  const ru = defaultMeaning(ch, lang);
  const own = { pinyin: card?.phonetic ?? "", meaning: ru ?? card?.gloss ?? "", english: !ru && Boolean(card?.gloss) };
  const s = said?.toLowerCase();
  const other = s && TONED.test(s.normalize("NFD")) && !/[一不]/.test(ch) && s !== own.pinyin.toLowerCase()
    ? cedictLookup(ch, { count: false })?.readings.find(
        (r) => r.pinyin[0] === r.pinyin[0].toLowerCase() && toneMarked(r.pinyin) === s,
      ) : undefined;
  const gloss = other ? readingGloss(other) : "";
  const result = gloss ? { pinyin: s!, meaning: gloss, english: true } : own;
  if (lang !== "ru") return result;
  const meaning = await russianMeaning(ch, result.pinyin, own.pinyin, localize);
  return { pinyin: result.pinyin, meaning, english: !meaning && Boolean(result.meaning) };
}

// The words on the lists built on a character: the learner's list first, by
// level, then the most used; a word only on the other list after those.
function wordsWith(ch: string, head: string, version: HskVersion) {
  const other: HskVersion = version === "3.0" ? "2.0" : "3.0";
  const rank = (t: HskTag) => t[version] ?? (t[other] ?? 9) + 0.5;
  return hskWordsWith(ch)
    .filter((e) => e.word !== ch && e.word !== head)
    .sort((a, b) => rank(a.levels) - rank(b.levels) || hskFrequency(b.word) - hskFrequency(a.word))
    .slice(0, WORDS_PER_CHAR)
    .map((e) => e.word);
}

/** The Characters block for a learner's word; [] for a word with no hanzi. */
export async function wordCharacters(telegramId: string, word: string, phonetic: string, lang: string, localize = false): Promise<CharInfo[]> {
  const head = normalizeHanzi(word);
  const chars = Array.from(head);
  if (!chars.length || chars.length > 8) return [];
  // The card's pinyin, syllable by syllable, when it lines up with the characters.
  const syllables = phonetic.trim().split(/\s+/);
  const said = syllables.length === chars.length ? syllables : [];
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true, hskVersion: true } });
  const version = asHskVersion(user?.hskVersion) ?? "3.0";

  // 妈妈, 谢谢: each character once.
  const picked = chars
    .map((ch, i) => ({ ch, said: said[i], words: wordsWith(ch, head, version) }))
    .filter((p, i) => chars.indexOf(p.ch) === i);

  // The learner's own cards among them, in their language when there are several.
  const wanted = [...new Set(picked.flatMap((p) => [p.ch, ...p.words]))];
  const cards = user
    ? await prisma.word.findMany({
        where: { userId: user.id, sourceLang: "zh", word: { in: wanted } },
        select: { id: true, word: true, targetLang: true, meaningZh: true },
      })
    : [];
  const owned = new Map<string, (typeof cards)[number]>();
  for (const c of cards) if (!owned.has(c.word) || c.targetLang === lang) owned.set(c.word, c);

  const level = (w: string) => hskTagFor(w)?.[version] ?? null;
  const describe = async (w: string): Promise<CharWord> => {
    const card = await cedictCard(w, { count: false });
    const mine = owned.get(w);
    const saved = mine?.targetLang === lang && mine.meaningZh?.trim();
    const ru = lang === "ru"
      ? (saved && /[а-яё]/i.test(saved) ? saved : await russianMeaning(w, card?.phonetic ?? "", card?.phonetic ?? "", localize))
      : saved || defaultMeaning(w, lang);
    return {
      word: w,
      pinyin: card?.phonetic ?? "",
      meaning: ru || (lang === "ru" ? "" : card?.gloss) || "",
      english: !ru && Boolean(card?.gloss),
      level: level(w),
      ...(mine ? { id: mine.id } : {}),
    };
  };
  return Promise.all(
    picked.map(async (p) => {
      const mine = owned.get(p.ch);
      return {
        word: p.ch,
        ...(await charReading(p.ch, p.said, lang, localize)),
        level: level(p.ch),
        ...(mine ? { id: mine.id } : {}),
        words: await Promise.all(p.words.map(describe)),
      };
    }),
  );
}
