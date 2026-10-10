import { prisma } from "./db.js";
import { cedictCard, cedictLookup, readingGloss, toneMarked } from "./cedict.js";
import { defaultMeaning } from "./lookup.js";
import { asHskVersion, hskFrequency, hskTagFor, hskWordsWith, normalizeHanzi, type HskTag, type HskVersion } from "./hsk.js";

// The word page's Characters block (learning audit 8e): each character of a
// Chinese word with its reading and meaning, and the HSK words built on it, the
// easiest first and the learner's own cards marked. Between HSK 4 and 5 (about
// 1,200 → 2,500 words) the characters are what let a learner guess a new word
// and keep it: the 电 of 电脑 is the 电 of 电视, 电话 and 电影. Dictionary and
// list data only, no model call.

export type CharWord = {
  word: string;
  pinyin: string;
  meaning: string;
  english: boolean; // the dictionary's English: nothing in the learner's language
  level: number | null; // on the learner's list
  id?: string; // the learner's card for it
};
export type CharInfo = CharWord & { words: CharWord[] };

const WORDS_PER_CHAR = 6;

// A tone mark on any vowel: a syllable without one is a neutral tone.
const TONED = /[̀́̄̌]/;

/**
 * The character as the word reads it. Usually its own reading and meaning, but a
 * word may use another one: 觉 is jiào in 睡觉 and jué alone, 好 is hào in 爱好,
 * 长 zhǎng in 长大. Then that reading with its gloss, since the default meaning
 * belongs to the other. A neutral tone (西 in 东西) and 一/不's tone changes are
 * the character's own reading said in passing, not another one.
 */
async function charReading(ch: string, said: string | undefined, lang: string) {
  const card = await cedictCard(ch, { count: false });
  const ru = defaultMeaning(ch, lang);
  const own = { pinyin: card?.phonetic ?? "", meaning: ru ?? card?.gloss ?? "", english: !ru && Boolean(card?.gloss) };
  const s = said?.toLowerCase();
  if (!s || !TONED.test(s.normalize("NFD")) || /[一不]/.test(ch) || s === own.pinyin.toLowerCase()) return own;
  const other = cedictLookup(ch, { count: false })?.readings.find(
    (r) => r.pinyin[0] === r.pinyin[0].toLowerCase() && toneMarked(r.pinyin) === s,
  );
  const gloss = other ? readingGloss(other) : "";
  return gloss ? { pinyin: s, meaning: gloss, english: true } : own;
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
export async function wordCharacters(telegramId: string, word: string, phonetic: string, lang: string): Promise<CharInfo[]> {
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
    const ru = (mine?.targetLang === lang && mine.meaningZh?.trim()) || defaultMeaning(w, lang);
    return {
      word: w,
      pinyin: card?.phonetic ?? "",
      meaning: ru || card?.gloss || "",
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
        ...(await charReading(p.ch, p.said, lang)),
        level: level(p.ch),
        ...(mine ? { id: mine.id } : {}),
        words: await Promise.all(p.words.map(describe)),
      };
    }),
  );
}
