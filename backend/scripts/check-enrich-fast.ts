// Proves the cheaper, faster enrichment for HSK words (PLAN-examples Part 3):
//  1. an HSK word's card has its page's part of speech, synonyms, antonyms and
//     phrases the moment it is made, before any model call;
//  2. the import job then spends no full dictionary entry on it — at most one
//     example-only call (where the pool's sentence doesn't serve) and the editor's
//     read of it — while a word off the lists keeps the full call;
//  3. the job works three cards at a time and finishes with every card counted.
//
// The model is a fake OpenAI-compatible server started here (BAILIAN_BASE_URL),
// so the run costs nothing and every call is counted by its usage label.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-enrich-fast.ts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const calls: string[] = []; // usage labels, in order
const examplePrompts: string[] = [];
let inFlight = 0;
let maxInFlight = 0;

// A sentence the segmenter keeps the word whole in, whatever the word.
const sentenceFor = (word: string) => `老师说“${word}”这个词很常用。`;

function reply(system: string, user: string): unknown {
  if (system.startsWith("You write example sentences")) examplePrompts.push(system);
  if (system.startsWith("You write example sentences"))
    return { example: sentenceFor(user), exampleTranslation: "Учитель сказал, что это слово частое." };
  if (system.includes("dictionary. For the given"))
    return {
      phonetic: "",
      partOfSpeech: "существительное",
      meaningZh: "блокчейн",
      collocations: [`${user}技术`],
      synonyms: [],
      antonyms: [],
      example: system.includes('"example": ONE natural') ? sentenceFor(user) : "",
      exampleTranslation: system.includes('"example": ONE natural') ? "Перевод." : "",
    };
  if (system.includes("native Mandarin editor")) return { natural: true };
  return {};
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const msgs = (JSON.parse(body).messages ?? []) as { role: string; content: string }[];
    const system = msgs.find((m) => m.role === "system")?.content ?? "";
    const user = msgs.find((m) => m.role === "user")?.content ?? "";
    // Long enough for three cards' calls to overlap when they run together.
    setTimeout(() => {
      inFlight--;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "fake",
          object: "chat.completion",
          created: 0,
          model: "fake",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(reply(system, user)) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    }, 300);
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
// Before anything reads env: dotenv leaves a variable that is already set alone.
process.env.BAILIAN_API_KEY = "fake";
process.env.BAILIAN_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

// Count calls by the label llm.ts logs for each.
const log = console.log;
console.log = (...args: unknown[]) => {
  const m = typeof args[0] === "string" && /^\[llm usage\] (.+?) in=/.exec(args[0]);
  if (m) calls.push(m[1]);
  else log(...args);
};

const { prisma } = await import("../src/services/db.js");
const { importWordsForUser } = await import("../src/services/importWords.js");
const { processImportJob } = await import("../src/services/importWorker.js");
const { hskPage } = await import("../src/services/wordPages.js");
const { deleteAccount } = await import("../src/services/accountData.js");

const TG = `test-enrich-fast-${Date.now()}`;
const TG2 = `${TG}-themes`;
let failures = 0;
function check(ok: boolean, what: string) {
  log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const item = (word: string, meaning = "") => ({ word, meaning, example: "", exampleTranslation: "", synonyms: [] });
const count = (label: string) => calls.filter((c) => c === label).length;

const HSK = ["却", "通过", "教育", "各", "记者", "朋友"];
const OFF = "区块链"; // a topic word: off the lists, it comes with its meaning

/** An HSK 4 learner on the 2.0 list (the author), with interests or none. */
async function learner(telegramId: string, interests?: string) {
  const user = await prisma.user.create({
    data: { telegramId, firstName: "Fast", nativeLang: "ru", hskTarget: 4, hskVersion: "2.0", levels: { zh: "B2" } },
  });
  if (interests) await prisma.coachMemory.create({ data: { userId: user.id, lang: "zh", interests } });
}

/** Today's add: the cards at once, then the job — claimed here so a running server's worker can't take it. */
async function add(telegramId: string, words: string[], beforeJob?: () => Promise<void>) {
  calls.length = 0;
  maxInFlight = 0;
  const r = await importWordsForUser({
    telegramId,
    sourceLang: "zh",
    targetLang: "ru",
    items: words.map((w) => (w === OFF ? item(w, "блокчейн") : item(w))),
    generateDetails: true,
    generateExamples: true,
    level: "4",
    exampleStyle: "casual",
    exampleSource: "ai",
  });
  check(r.created === words.length && Boolean(r.job), `${r.created} cards made, job ${r.job?.id}`);
  check(calls.length === 0, `no model call on the add itself (${calls.join(", ") || "none"})`);
  await beforeJob?.();
  const claim = await prisma.importJob.updateMany({
    where: { id: r.job!.id, status: "queued" },
    data: { status: "processing", startedAt: new Date(), leaseUntil: new Date(Date.now() + 5 * 60_000) },
  });
  if (claim.count !== 1) throw new Error("another worker claimed the job first — stop the local backend and rerun");
  const t0 = Date.now();
  await processImportJob(await prisma.importJob.findUniqueOrThrow({ where: { id: r.job!.id } }));
  const ms = Date.now() - t0;
  const job = await prisma.importJob.findUniqueOrThrow({ where: { id: r.job!.id } });
  check(job.status === "completed" && job.processed === job.total, `job ${job.status}, ${job.processed}/${job.total} in ${ms} ms`);
  log(`     calls: ${calls.join(", ")}`);
  const cards = await prisma.word.findMany({ where: { user: { telegramId } }, include: { examples: true } });
  // The fake model's sentence, as against the pool's (both are "Onomika AI").
  return (w: string) => cards.find((c) => c.word === w)!.examples.filter((e) => e.sentenceEn === sentenceFor(w)).length;
}

async function main() {
  // A. No interests: their own sentence only where the pool's can't serve HSK 4.
  await learner(TG);
  const own = await add(TG, [...HSK, OFF], async () => {
    // 1. The page's details, before the job runs.
    const made = await prisma.word.findMany({ where: { user: { telegramId: TG } } });
    for (const w of HSK) {
      const card = made.find((c) => c.word === w)!;
      const page = hskPage(w, "ru")!;
      check(
        card.partOfSpeech === page.pos &&
          JSON.stringify(card.synonyms) === JSON.stringify(page.syn) &&
          JSON.stringify(card.antonyms) === JSON.stringify(page.ant),
        `${w}: ${card.partOfSpeech}, synonyms [${card.synonyms.join(" ")}], antonyms [${card.antonyms.join(" ")}] from its page at once`,
      );
      check(
        card.collocations.length > 0 && card.collocations.every((c) => page.s[0].p.some((p) => p.t === c)),
        `${w}: phrases ${card.collocations.join(", ")}`,
      );
    }
    const off = made.find((c) => c.word === OFF)!;
    check(!off.partOfSpeech && off.synonyms.length === 0, `${OFF}: off the lists, nothing until the model's call`);
  });
  const written = HSK.filter((w) => own(w) > 0);
  check(count("enrich") === 0, "no example-less full entry for any card");
  check(count("enrich(+example)") === 1, `one full entry, for ${OFF} (${count("enrich(+example)")})`);
  check(own(OFF) === 1, `${OFF} got its own example`);
  check(
    count("enrich(example only)") === written.length && written.length > 0,
    `example-only calls ${count("enrich(example only)")} = HSK cards given their own sentence (${written.join(" ")})`,
  );
  check(count("example.judge") === written.length + 1, `one editor's read per sentence written (${count("example.judge")})`);
  // 通过 tops out at HSK 2 in the pool on the 2.0 list: its own sentence is written at HSK 4.
  check(written.includes("通过"), "通过 gets its own sentence (the pool's best is HSK 2)");
  check(written.length < HSK.length, `the pool's sentence serves the rest with no call (${HSK.filter((w) => !written.includes(w)).join(" ")})`);
  const prompt = examplePrompts.find((p) => p.includes('"通过"')) ?? "";
  check(
    prompt.includes("for an HSK 4 learner (the HSK 2.0 word list)") && prompt.includes("on the learner's card") && !/CEFR/.test(prompt),
    "the example-only call aims at HSK 4 on the 2.0 list, in the card's sense, with no CEFR line",
  );

  // B. Interests set: every card gets its own sentence, one call and the read each,
  // and the cards run three at a time.
  await learner(TG2, "путешествия, кино");
  const own2 = await add(TG2, HSK);
  check(HSK.every((w) => own2(w) === 1), "each HSK card has its own sentence");
  check(
    count("enrich(example only)") === HSK.length && count("example.judge") === HSK.length && calls.length === 2 * HSK.length,
    `${calls.length} calls for ${HSK.length} cards: one example-only call and one read each`,
  );
  check(maxInFlight >= 2, `cards run together: up to ${maxInFlight} calls in flight`);
}

try {
  await main();
} finally {
  await deleteAccount(TG).catch(() => {});
  await deleteAccount(TG2).catch(() => {});
  await prisma.$disconnect();
  server.close();
}
log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
