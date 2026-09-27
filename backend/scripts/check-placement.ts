// Proves "An adaptive check that catches overclaiming" (BACKLOG), and measures it.
//
// Part 1 needs no database: simulated learners — each with a true level, a
// habit of claiming words they don't know, and a fixed set of words they really
// know — take the old fixed 24-word check and the new adaptive one. Each check
// then prices the words it never asked (the plan's estimate, the mark's
// estimate), and that is scored against the words the learner really knows: how
// far off the count is, and how well the level's share predicts each held-out
// word (Brier score: 0 is perfect, 0.25 is a coin). The numbers are printed so
// the item's "Proof" can quote them; the asserts only guard the direction.
//
// Part 2 is the account: made-up words saved apart and never counted, the plan
// discounted by them the same way before and after sign-in, the mark's estimate
// agreeing with the plan, and first-review grades moving the sample afterwards.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-placement.ts
import { prisma } from "../src/services/db.js";
import { hskCheckWords, hskLevelWords, hskTagFor, learnerStatus, readinessForUser, type HskVersion } from "../src/services/hsk.js";
import { cedictKnows } from "../src/services/cedict.js";
import { savePlacementAnswers } from "../src/services/learnerPrefs.js";
import { deleteAccount } from "../src/services/accountData.js";
import {
  CHECK_SCREENS,
  checkResult,
  correctForGuessing,
  falseAlarmRate,
  nextCheckScreen,
  type DoneScreen,
} from "../src/services/placementCheck.js";
import { evidenceFrom, guestPlan, levelRates, planForUser, withEstimate } from "../src/services/studyPlan.js";

const TG = `test-placement-${Date.now()}`;
const TODAY = "2026-09-27";
const V: HskVersion = "3.0";
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// Seeded, so the adaptive check's column is reproducible and a regression shows up
// as a changed number. The old check draws its own random offset, so its column
// moves a little between runs. RUNS=100 for a steadier comparison.
function rng(seed: number) {
  let h = seed >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Simulated learners ---

// `theta`: the level where half the words are known; a real HSK 4 learner (≈4.6)
// knows ~95% of HSK 3, ~77% of HSK 4, ~30% of HSK 5. `g`: how often they claim
// a word they don't know — and a made-up one (a careful learner still slips on
// ~5% of those). `claim`: the level they say they have; `target`: their goal.
type Profile = { name: string; theta: number; g: number; claim: number; target: number };
type Learner = Profile & { knows: Set<string>; rand: () => number };

const SLOPE = 2;
const pKnow = (theta: number, level: number) => 1 / (1 + Math.exp(SLOPE * (level - theta)));

function makeLearner(p: Profile, seed: number): Learner {
  const rand = rng(seed);
  const knows = new Set<string>();
  for (let n = 1; n <= 7; n++) for (const w of hskLevelWords(V, n)) if (rand() < pKnow(p.theta, n)) knows.add(w.word);
  return { ...p, knows, rand };
}

// "I know it" on a real word: known, or claimed anyway. On a made-up one: claimed.
const claims = (l: Learner, word: string) =>
  hskTagFor(word) ? l.knows.has(word) || l.rand() < l.g : l.rand() < Math.max(l.g, 0.05);

/** The adaptive check, answered as this learner would, with the meaning question the page asks. */
function adaptive(l: Learner): { done: DoneScreen[]; words: string[] } {
  const done: DoneScreen[] = [];
  const words: string[] = [];
  for (;;) {
    const screen = nextCheckScreen({ version: V, target: l.target, claimed: l.claim, native: "ru", done, rand: l.rand });
    if (!screen) break;
    const answers = screen.words.map((w) => ({ word: w.word, known: claims(l, w.word) }));
    words.push(...screen.words.map((w) => w.word));
    // The page asks one claimed word back when three are claimed: right if known,
    // else a guess among four.
    const askable = screen.words.filter((w, i) => answers[i].known && w.meaning);
    let probe: DoneScreen["probe"] = null;
    if (askable.length >= 3 && screen.senses.length >= 3) {
      const w = askable[Math.floor(l.rand() * askable.length)].word;
      probe = { word: w, right: l.knows.has(w) || l.rand() < 0.25 };
    }
    done.push({ level: screen.level, answers, probe });
  }
  return { done, words };
}

type Score = { countErr: number; brier: number; hit: number; l4?: number };

/**
 * How well one check's answers price the words it never asked, up to the
 * target: the plan's estimate of words known vs the truth, and each held-out
 * word's level share as a prediction of whether it is known.
 */
function score(l: Learner, known: string[], unknown: string[], fakes?: { shown: number; claimed: number }): Score {
  const plan = guestPlan({ version: V, level: l.target, known: l.claim, answers: { known, unknown }, fakes, today: TODAY, examDate: null, daily: 10 });
  const said = new Map<string, boolean>([...known.map((w) => [w, true] as const), ...unknown.map((w) => [w, false] as const)]);
  const rates = levelRates(evidenceFrom(V, said, (w) => said.get(w) === true), falseAlarmRate(fakes?.shown ?? 0, fakes?.claimed ?? 0));
  let truth = 0;
  let sq = 0;
  let hits = 0;
  let held = 0;
  for (let n = 1; n <= l.target; n++) {
    for (const w of hskLevelWords(V, n)) {
      const k = l.knows.has(w.word);
      if (k) truth++;
      if (said.has(w.word)) continue;
      const p = rates.get(n) ?? 0;
      sq += (p - (k ? 1 : 0)) ** 2;
      if (p >= 0.5 === k) hits++;
      held++;
    }
  }
  return { countErr: Math.abs(plan.total - plan.left - truth), brier: sq / held, hit: hits / held, l4: rates.get(4) ?? 0 };
}

const PROFILES: Profile[] = [
  { name: "HSK 2, honest", theta: 2.6, g: 0, claim: 2, target: 3 },
  { name: "HSK 3, honest", theta: 3.6, g: 0, claim: 3, target: 4 },
  { name: "HSK 3, says HSK 4", theta: 3.6, g: 0.15, claim: 4, target: 4 },
  { name: "HSK 4, honest", theta: 4.6, g: 0, claim: 4, target: 4 },
  { name: "HSK 4, aims at 5", theta: 4.6, g: 0.05, claim: 4, target: 5 },
  { name: "HSK 5, honest", theta: 5.6, g: 0, claim: 5, target: 6 },
  { name: "HSK 2, overclaims", theta: 2.6, g: 0.4, claim: 4, target: 4 },
  { name: "HSK 4, overclaims", theta: 4.6, g: 0.4, claim: 5, target: 5 },
];
const RUNS = Number(process.env.RUNS) || 30;

function simulate() {
  console.log("\n— Part 1: simulated learners, words the check never asked —");
  console.log("profile                 | words off: old / new (no fakes) / new | Brier old / new | right old / new");
  const all = { old: 0, raw: 0, neu: 0, bOld: 0, bNew: 0, hOld: 0, hNew: 0, n: 0 };
  const over = { raw: 0, neu: 0, n: 0 };
  const l4: Record<string, number> = {};
  let structural = true;
  for (const [pi, p] of PROFILES.entries()) {
    const acc = { old: 0, raw: 0, neu: 0, bOld: 0, bNew: 0, hOld: 0, hNew: 0, l4: 0 };
    for (let r = 0; r < RUNS; r++) {
      const l = makeLearner(p, 1000 * pi + r);
      // The old check: 24 words spread evenly over 1..target, no made-up words.
      const fixed = hskCheckWords(V, p.target, 24).map((w) => w.word);
      const oldAns = fixed.map((w) => ({ word: w, known: claims(l, w) }));
      const sOld = score(l, oldAns.filter((a) => a.known).map((a) => a.word), oldAns.filter((a) => !a.known).map((a) => a.word));

      const { done, words } = adaptive(l);
      const res = checkResult(V, done);
      const sRaw = score(l, res.known, res.unknown);
      const sNew = score(l, res.known, res.unknown, res.fakes);

      // The shape of the check itself, every run.
      const fakes = words.filter((w) => !hskTagFor(w));
      structural &&=
        done.length <= CHECK_SCREENS &&
        new Set(words).size === words.length &&
        fakes.length === done.length &&
        fakes.every((w) => !cedictKnows(w) && w.length === 2);

      acc.old += sOld.countErr;
      acc.raw += sRaw.countErr;
      acc.neu += sNew.countErr;
      acc.bOld += sOld.brier;
      acc.bNew += sNew.brier;
      acc.hOld += sOld.hit;
      acc.hNew += sNew.hit;
      acc.l4 += sNew.l4 ?? 0;
    }
    const m = (x: number) => x / RUNS;
    console.log(
      `${p.name.padEnd(23)} | ${String(Math.round(m(acc.old))).padStart(5)} / ${String(Math.round(m(acc.raw))).padStart(5)} / ${String(Math.round(m(acc.neu))).padStart(5)}             | ${m(acc.bOld).toFixed(3)} / ${m(acc.bNew).toFixed(3)}   | ${(m(acc.hOld) * 100).toFixed(0)}% / ${(m(acc.hNew) * 100).toFixed(0)}%`,
    );
    l4[p.name] = m(acc.l4);
    all.old += acc.old;
    all.raw += acc.raw;
    all.neu += acc.neu;
    all.bOld += acc.bOld;
    all.bNew += acc.bNew;
    all.hOld += acc.hOld;
    all.hNew += acc.hNew;
    all.n += RUNS;
    if (p.g >= 0.4) {
      over.raw += acc.raw;
      over.neu += acc.neu;
      over.n += RUNS;
    }
  }
  const m = (x: number) => x / all.n;
  console.log(
    `${"all".padEnd(23)} | ${String(Math.round(m(all.old))).padStart(5)} / ${String(Math.round(m(all.raw))).padStart(5)} / ${String(Math.round(m(all.neu))).padStart(5)}             | ${m(all.bOld).toFixed(3)} / ${m(all.bNew).toFixed(3)}   | ${(m(all.hOld) * 100).toFixed(0)}% / ${(m(all.hNew) * 100).toFixed(0)}%\n`,
  );

  check(structural, `every run: at most ${CHECK_SCREENS} screens, no word twice, one made-up word a screen, none of them in CC-CEDICT`);
  check(
    l4["HSK 4, honest"] - l4["HSK 3, says HSK 4"] >= 0.3,
    `an HSK 3 who says "HSK 4" and a real HSK 4 end up apart on HSK 4 (${(l4["HSK 3, says HSK 4"] * 100).toFixed(0)}% vs ${(l4["HSK 4, honest"] * 100).toFixed(0)}%)`,
  );
  check(m(all.neu) < m(all.old), `the adaptive check is closer on the words it never asked (${Math.round(m(all.neu))} vs ${Math.round(m(all.old))} words off)`);
  check(m(all.bNew) < m(all.bOld), `…and predicts each held-out word better (Brier ${m(all.bNew).toFixed(3)} vs ${m(all.bOld).toFixed(3)})`);
  check(over.neu < over.raw, `the made-up words pull an overclaimer's estimate back (${Math.round(over.neu / over.n)} vs ${Math.round(over.raw / over.n)} words off without them)`);

  // The correction itself: no false alarm leaves the share alone; 60% claimed by someone
  // who claims 40% of made-up words is 33% known.
  check(
    correctForGuessing(0.8, 0) === 0.8 && Math.abs(correctForGuessing(0.6, 0.4) - 1 / 3) < 1e-9,
    `no made-up word claimed: the share stands; 60% claimed at a 40% false-alarm rate reads as ${Math.round(correctForGuessing(0.6, 0.4) * 100)}%`,
  );
}

async function account() {
  console.log("— Part 2: the account —");
  await prisma.user.create({ data: { telegramId: TG, firstName: "Placement", hskVersion: V, hskTarget: 4, dailyGoal: 10, invited: true } });
  const l4 = hskLevelWords(V, 4).map((w) => w.word);
  const known = l4.slice(0, 8);
  const unknown = l4.slice(8, 12);
  // Two made-up words claimed of five: the first is forgiven, so g = 1/5.
  const fakeKnown = ["书电", "饭跑"];
  const fakeUnknown = ["鱼门", "花读", "楼雨"];
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", known, unknown, fakes: { known: fakeKnown, unknown: fakeUnknown } });

  const rows = await prisma.placementAnswer.findMany({ where: { user: { telegramId: TG } }, select: { word: true, fake: true } });
  check(rows.filter((r) => r.fake).length === 5 && rows.filter((r) => !r.fake).length === 12, "made-up words are saved apart from the real answers");
  const status = await learnerStatus(TG);
  check(!fakeKnown.some((w) => status.has(w)), "…and a claimed one never counts as a word the learner has");

  const acct = await planForUser(TG, TODAY);
  const guest = guestPlan({ version: V, level: 4, known: 4, answers: { known, unknown }, fakes: { shown: 5, claimed: 2 }, today: TODAY, examDate: null, daily: 10 });
  const honest = guestPlan({ version: V, level: 4, known: 4, answers: { known, unknown }, today: TODAY, examDate: null, daily: 10 });
  check(acct.left === guest.left, `the account's plan is the guest's plan from the same answers and made-up words (${acct.left} / ${guest.left})`);
  check(guest.left > honest.left, `…and the claimed made-up word leaves more to learn than the same taps without it (${guest.left} vs ${honest.left})`);

  const mark = await withEstimate(TG, await readinessForUser(TG));
  check(mark.recognise === 8, `the mark still counts what was measured: 8 (${mark.recognise})`);
  check(mark.estimate === acct.total - acct.left, `…its estimate is the plan's words known (${mark.estimate} = ${acct.total} − ${acct.left})`);
  check(mark.levels.every((l) => l.estimate >= l.recognise || l.level > 4), "…and no level is estimated below what was measured");

  // Never over: a word answered "don't know" whose card was then recalled on
  // first sight moves to known; a captured word with no answer changes nothing.
  const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: TG }, select: { id: true } });
  const later = new Date(Date.now() + 60_000);
  const recalled = await prisma.word.create({ data: { userId: user.id, word: unknown[0], sourceLang: "zh", targetLang: "ru" } });
  await prisma.reviewEvent.create({ data: { userId: user.id, wordId: recalled.id, grade: 3, source: "review", createdAt: later } });
  const captured = await prisma.word.create({ data: { userId: user.id, word: l4[40], sourceLang: "zh", targetLang: "ru" } });
  await prisma.reviewEvent.create({ data: { userId: user.id, wordId: captured.id, grade: 1, source: "review", createdAt: later } });
  const moved = await planForUser(TG, TODAY);
  const expected = guestPlan({
    version: V,
    level: 4,
    known: 4,
    answers: { known: [...known, unknown[0]], unknown: unknown.slice(1) },
    fakes: { shown: 5, claimed: 2 },
    today: TODAY,
    examDate: null,
    daily: 10,
  });
  // The guest has no cards, so the captured word counts as open there; the account's
  // one fewer open word is priced at the level's rate, hence the tolerance of one.
  check(Math.abs(moved.left - expected.left) <= 1 && moved.left < acct.left, `a first review recalled turns a "don't know" into known (${acct.left} → ${moved.left}, expected ~${expected.left})`);

  // Taken from the daily words: nothing until the first review, then the grade.
  // The first taken word was tapped "don't know" in the check: the tap stays.
  const taken = [unknown[1], l4[50], l4[51]];
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", known: [], unknown: [], took: taken });
  const tookRows = await prisma.placementAnswer.findMany({ where: { user: { telegramId: TG }, word: { in: taken } }, select: { word: true, took: true } });
  check(
    tookRows.length === 3 && tookRows.find((r) => r.word === unknown[1])?.took === false,
    "taking daily words records them, without overwriting a word tapped in the check",
  );
  for (const w of taken.slice(1)) await prisma.word.create({ data: { userId: user.id, word: w, sourceLang: "zh", targetLang: "ru" } });
  const pending = await planForUser(TG, TODAY);
  // Only the two cards move it (a card counts as met, as ever): the taken words
  // themselves stay out of the sample, which would otherwise drop the level's rate.
  check(Math.abs(pending.left - moved.left) <= 2, `…and a taken word says nothing before its first review (${moved.left} → ${pending.left})`);
  const forgot = await prisma.word.findFirstOrThrow({ where: { userId: user.id, word: l4[50] } });
  await prisma.reviewEvent.create({ data: { userId: user.id, wordId: forgot.id, grade: 1, source: "review", createdAt: later } });
  const knew = await prisma.word.findFirstOrThrow({ where: { userId: user.id, word: l4[51] } });
  await prisma.reviewEvent.create({ data: { userId: user.id, wordId: knew.id, grade: 4, source: "review", createdAt: later } });
  const graded = await planForUser(TG, TODAY);
  const both = guestPlan({
    version: V,
    level: 4,
    known: 4,
    answers: { known: [...known, unknown[0], l4[51]], unknown: [...unknown.slice(1), l4[50]] },
    fakes: { shown: 5, claimed: 2 },
    today: TODAY,
    examDate: null,
    daily: 10,
  });
  check(Math.abs(graded.left - both.left) <= 3, `…then Again counts as unknown and Easy as known (${graded.left}, expected ~${both.left})`);

  // An account's check skips what it already has a card or an answer for.
  const answered = new Set(rows.map((r) => r.word));
  const screen = nextCheckScreen({ version: V, target: 4, claimed: 4, native: "ru", done: [], skip: (w) => status.has(w) || answered.has(w) || w === l4[40] });
  check(!!screen && screen.words.every((w) => !answered.has(w.word)), "an account's check never asks a word it already has an answer for");
}

async function main() {
  simulate();
  await account();
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    await deleteAccount(TG).catch(() => {});
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
  });
