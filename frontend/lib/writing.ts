import type { Word } from "@/lib/api";

// Which words the writing mode (/write) takes, and when — shared with Today, so
// the count on Today is the one the writing setup shows.

const HAN = /\p{Script=Han}/u;

// Writing is slow (half a minute a word): fewer new words a session than Flashcards takes.
export const WRITE_NEW_PER_SESSION = 10;
export const SECONDS_PER_WRITE = 30;

export const canWrite = (w: Word) => w.sourceLang === "zh" && HAN.test(w.word) && !!w.meaningZh;

/** Never graded in writing: traced first, and not "due" — every Chinese word starts out new. */
export const isNewToWrite = (w: Word) => w.writeStability == null;

/** On the writing schedule and due now. */
export const isDueToWrite = (w: Word) =>
  !isNewToWrite(w) && (!w.writeDue || new Date(w.writeDue).getTime() <= Date.now());

export const writeMinutes = (n: number) => Math.max(1, Math.round((n * SECONDS_PER_WRITE) / 60));
