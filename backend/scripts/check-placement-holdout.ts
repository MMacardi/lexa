// The real-data half of "An adaptive check that catches overclaiming" (BACKLOG,
// Proof): how well an account's check predicted the words it never asked.
//
// No extra bookkeeping needed. The check answers its words in one save; every
// answer after that — a sweep (which never re-asks a word already answered), an
// "I know it" in the daily words, a taken word's first review — is about a word
// the check didn't ask. So the account splits in time: the level rates as they
// stood right after the check (the same `levelRates` the plan and the mark use)
// predict every later answer, and the report says how often they were right.
//
//   cd backend && npx tsx scripts/check-placement-holdout.ts
//     no argument: a self-test on a throwaway local account (seeded, scored, deleted)
//   cd backend && npx tsx scripts/check-placement-holdout.ts <telegramId> [--since 2026-09-27T12:00]
//     read-only report on one account; the split is its last check unless --since says otherwise
import { prisma } from "../src/services/db.js";
import { asHskVersion, hskLevelWords, hskTagFor, normalizeHanzi, type HskVersion } from "../src/services/hsk.js";
import { savePlacementAnswers } from "../src/services/learnerPrefs.js";
import { deleteAccount } from "../src/services/accountData.js";
import { checkResult, falseAlarmRate, nextCheckScreen, type DoneScreen } from "../src/services/placementCheck.js";
import { evidenceFrom, firstReviews, levelRates } from "../src/services/studyPlan.js";

type Answer = { word: string; known: boolean; fake: boolean; took: boolean; createdAt: Date };
type First = Map<string, { at: Date; recalled: boolean }>;
type LevelScore = { level: number; n: number; predicted: number; actual: number; brier: number; right: number };
type Report = { trainedOn: number; fakes: { shown: number; claimed: number }; heldOut: number; levels: LevelScore[]; brier: number; right: number };

/** The rates as they stood at `split`, scored on every answer given after it. */
function holdout(version: HskVersion, answers: Answer[], firsts: First, split: Date): Report {
  const said = new Map<string, boolean>();
  let shown = 0;
  let claimed = 0;
  let trainedOn = 0;
  for (const a of answers.filter((x) => x.createdAt <= split)) {
    if (a.fake) {
      shown++;
      if (a.known) claimed++;
      continue;
    }
    const w = normalizeHanzi(a.word);
    const f = firsts.get(w);
    const reviewed = f && f.at <= split;
    if (a.took) {
      if (reviewed) said.set(w, f.recalled);
      continue;
    }
    said.set(w, reviewed && f.at > a.createdAt ? f.recalled : a.known);
    trainedOn++;
  }
  const rates = levelRates(evidenceFrom(version, said, () => false), falseAlarmRate(shown, claimed));

  // What each later answer turned out to be: the answer, or the first review
  // after it; a taken word only once it has been reviewed.
  const byLevel = new Map<number, { p: number; y: number[] }>();
  for (const a of answers.filter((x) => x.createdAt > split && !x.fake)) {
    const w = normalizeHanzi(a.word);
    if (said.has(w)) continue; // asked before the split: not held out
    const level = hskTagFor(w)?.[version];
    if (!level) continue;
    const f = firsts.get(w);
    const truth = a.took ? (f ? f.recalled : null) : f && f.at > a.createdAt ? f.recalled : a.known;
    if (truth === null) continue;
    const row = byLevel.get(level) ?? { p: rates.get(level) ?? 0, y: [] };
    row.y.push(truth ? 1 : 0);
    byLevel.set(level, row);
  }
  const levels: LevelScore[] = [...byLevel]
    .sort((a, b) => a[0] - b[0])
    .map(([level, { p, y }]) => ({
      level,
      n: y.length,
      predicted: p,
      actual: y.reduce((s, v) => s + v, 0) / y.length,
      brier: y.reduce((s, v) => s + (p - v) ** 2, 0) / y.length,
      right: y.filter((v) => (p >= 0.5 ? 1 : 0) === v).length / y.length,
    }));
  const heldOut = levels.reduce((s, l) => s + l.n, 0);
  const avg = (pick: (l: LevelScore) => number) => (heldOut ? levels.reduce((s, l) => s + pick(l) * l.n, 0) / heldOut : 0);
  return { trainedOn, fakes: { shown, claimed }, heldOut, levels, brier: avg((l) => l.brier), right: avg((l) => l.right) };
}

// Per level the check predicts one share, so the headline is that share against
// what the later answers showed, in words off. Brier is there with its floor: a
// single share can't beat actual × (1 − actual) on the words of one level.
function print(r: Report, split: Date) {
  const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(5);
  console.log(`split at ${split.toISOString()}: trained on ${r.trainedOn} answers, made-up words ${r.fakes.claimed}/${r.fakes.shown} claimed`);
  console.log(`held out: ${r.heldOut} later answers`);
  console.log("level   answers  predicted  actual  words off   Brier (floor)  right");
  for (const l of r.levels) {
    const name = l.level === 7 ? "7–9" : String(l.level);
    const off = Math.round(Math.abs(l.predicted - l.actual) * l.n);
    console.log(
      `HSK ${name.padEnd(4)} ${String(l.n).padStart(6)}  ${pct(l.predicted)}      ${pct(l.actual)}  ${String(off).padStart(8)}   ${l.brier.toFixed(3)} (${(l.actual * (1 - l.actual)).toFixed(3)})  ${pct(l.right)}`,
    );
  }
  const off = r.levels.reduce((s, l) => s + Math.abs(l.predicted - l.actual) * l.n, 0);
  console.log(`all      ${String(r.heldOut).padStart(6)}                     ${String(Math.round(off)).padStart(8)}   ${r.brier.toFixed(3)}          ${pct(r.right)}`);
}

async function load(telegramId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { telegramId }, select: { id: true, hskVersion: true, hskTarget: true } });
  const [answers, firsts] = await Promise.all([
    prisma.placementAnswer.findMany({
      where: { userId: user.id, sourceLang: "zh" },
      select: { word: true, known: true, fake: true, took: true, createdAt: true },
    }),
    firstReviews(user.id),
  ]);
  return { user, answers, firsts, version: asHskVersion(user.hskVersion) ?? "3.0" };
}

/** Right after the last check: its made-up words are saved with its answers, in one go. */
function lastCheck(answers: Answer[]): Date | null {
  const fakes = answers.filter((a) => a.fake).map((a) => a.createdAt.getTime());
  return fakes.length ? new Date(Math.max(...fakes) + 1000) : null;
}

async function report(telegramId: string, since?: string) {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, "");
  console.log(`reading ${telegramId} on ${host} (read-only)`);
  const { answers, firsts, version } = await load(telegramId);
  const split = since ? new Date(since) : lastCheck(answers);
  if (!split || Number.isNaN(split.getTime())) {
    console.log("No check with made-up words on this account: pass --since <the check's time>.");
    return;
  }
  print(holdout(version, answers, firsts, split), split);
}

// --- Self-test: a learner who knows HSK 1–3 and a third of HSK 4 takes the
// check, sweeps HSK 4 later, and takes two daily words that get reviewed. ---

const TG = `test-holdout-${Date.now()}`;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

async function selfTest() {
  const V: HskVersion = "3.0";
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const knows = new Set<string>();
  const share: Record<number, number> = { 1: 0.98, 2: 0.95, 3: 0.85, 4: 0.33 };
  for (let n = 1; n <= 4; n++) for (const w of hskLevelWords(V, n)) if (rand() < share[n]) knows.add(w.word);

  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Holdout", hskVersion: V, hskTarget: 4, invited: true } });
  // The check, answered honestly, saved the way the page saves it.
  const done: DoneScreen[] = [];
  for (let screen = nextCheckScreen({ version: V, target: 4, claimed: 4, native: "ru", done, rand }); screen; ) {
    done.push({ level: screen.level, answers: screen.words.map((w) => ({ word: w.word, known: knows.has(w.word) })), probe: null });
    screen = nextCheckScreen({ version: V, target: 4, claimed: 4, native: "ru", done, rand });
  }
  const res = checkResult(V, done);
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", known: res.known, unknown: res.unknown, fakes: { known: res.fakeKnown, unknown: res.fakeUnknown } });
  await new Promise((r) => setTimeout(r, 1500));

  // Later: a sweep of what's left of HSK 4, and two taken daily words, reviewed.
  const asked = new Set([...res.known, ...res.unknown]);
  const rest = hskLevelWords(V, 4).map((w) => w.word).filter((w) => !asked.has(w));
  const [a, b, ...swept] = rest;
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", known: swept.filter((w) => knows.has(w)), unknown: swept.filter((w) => !knows.has(w)) });
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", known: [], unknown: [], took: [a, b] });
  const later = new Date(Date.now() + 60_000);
  for (const [w, grade] of [[a, 1], [b, 3]] as const) {
    const card = await prisma.word.create({ data: { userId: user.id, word: w, sourceLang: "zh", targetLang: "ru" } });
    await prisma.reviewEvent.create({ data: { userId: user.id, wordId: card.id, grade, source: "review", createdAt: later } });
  }

  const { answers, firsts } = await load(TG);
  const split = lastCheck(answers)!;
  const r = holdout(V, answers, firsts, split);
  print(r, split);
  const l4 = r.levels.find((l) => l.level === 4);
  check(r.trainedOn === res.asked, `the split keeps the check's ${res.asked} answers on the training side (${r.trainedOn})`);
  check(r.heldOut === rest.length && r.levels.length === 1, `every later answer is held out, all of them HSK 4 (${r.heldOut} of ${rest.length})`);
  const actual4 = rest.filter((w, i) => (i === 0 ? false : i === 1 ? true : knows.has(w))).length / rest.length;
  check(!!l4 && Math.abs(l4.actual - actual4) < 1e-9, "…a taken word counts as its first review said (Again: no, Good: yes)");
  check(!!l4 && Math.abs(l4.predicted - l4.actual) < 0.2, `the check's HSK 4 rate predicts the sweep within 20 points (${Math.round((l4?.predicted ?? 0) * 100)}% vs ${Math.round((l4?.actual ?? 0) * 100)}%)`);
  check(r.brier < 0.25, `…and beats a coin on the held-out words (Brier ${r.brier.toFixed(3)})`);
}

const [arg, flag, since] = process.argv.slice(2);
(arg ? report(arg, flag === "--since" ? since : undefined) : selfTest())
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    if (!arg) await deleteAccount(TG).catch(() => {});
    await prisma.$disconnect();
    if (!arg) console.log(failures ? `\n${failures} failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
  });
