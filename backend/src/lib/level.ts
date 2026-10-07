// A learner's level as requests carry it: CEFR ("B2") for most languages, the HSK
// level ("4"; "7" is the 7–9 band) for Chinese, which is levelled in HSK and never
// A1–C2 (PLAN-examples Part 2). A client from before that may still send CEFR for
// Chinese, so either scale is read; prompts then name it on the language's own one.

export const HSK_FOR_CEFR: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];
// The other way, for rules written per CEFR band (levelGuide): HSK 5 and 6 are both C1.
const CEFR_FOR_HSK: Record<number, string> = { 1: "A1", 2: "A2", 3: "B1", 4: "B2", 5: "C1", 6: "C1", 7: "C2" };

export const isHskLang = (lang?: string | null) => lang === "zh" || lang === "zh-Hant";

/** The HSK level (1–7) a level names on either scale, else null. */
export function hskOf(level?: string | null): number | null {
  const s = (level ?? "").trim().toUpperCase().replace(/^HSK\s*/, "");
  if (/^[1-7]$/.test(s)) return Number(s);
  if (/^7\s*[-–]\s*9$/.test(s)) return 7;
  return HSK_FOR_CEFR[s] ?? null;
}

/** The CEFR band a level names on either scale, else null. */
export function cefrOf(level?: string | null): string | null {
  const s = (level ?? "").trim().toUpperCase();
  if (CEFR.includes(s)) return s;
  const n = hskOf(s);
  return n ? CEFR_FOR_HSK[n] : null;
}

/** A level as a reader text stores and shows it: "HSK 4" for Chinese, "B2" otherwise; null when none. */
export function levelTag(level: string | null | undefined, sourceLang?: string | null): string | null {
  if (isHskLang(sourceLang)) return levelName(level, sourceLang);
  return level?.trim().toUpperCase() || null;
}

/** How a prompt names the level: "HSK 4" / "HSK 7–9" for Chinese, "CEFR B2" otherwise; null when there is none. */
export function levelName(level: string | null | undefined, sourceLang?: string | null): string | null {
  if (isHskLang(sourceLang)) {
    const n = hskOf(level);
    return n ? (n === 7 ? "HSK 7–9" : `HSK ${n}`) : null;
  }
  const c = cefrOf(level);
  return c ? `CEFR ${c}` : null;
}
