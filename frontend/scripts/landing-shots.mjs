// The landing's phone screenshots, taken from the real app (FocusLanding.tsx shows them):
// a guest runs the questions and the check to the plan, signs in, and the new account's
// Today, Reader, Flashcards, Writing and a chat with Mika are photographed in ru, en and zh.
// The check is answered like a learner around HSK 3 aiming at HSK 4: the made-up words
// (the check sends them with no meaning) are tapped, three real words on each screen
// above HSK 3, and every meaning question is answered right — so the plan comes out the
// same on every run.
//
// Local Docker only (dev sign-in), with Chrome and frontend's npm dependencies installed.
// The Reader gloss and Mika chat cost a few model calls (under ~¥0.05). From the repo root:
//   node frontend/scripts/landing-shots.mjs [shot,shot…]
// Reuse a local demo account when refreshing individual screens:
//   node frontend/scripts/landing-shots.mjs reader,mika --demo-account=landing-demo-<timestamp>
// Shots: plan, today, reader, review, write, mika (default all). Writes
// frontend/public/landing/<shot>-<locale>.webp, 600 px wide.
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
import { chromium, devices } from "playwright-core";
import sharp from "sharp";

const APP = "http://localhost:3001";
const API = "http://localhost:3000";
const OUT = path.join(here, "../public/landing");
const ONLY = process.argv[2] ? process.argv[2].split(",") : null;
const SHOTS = ["plan", "today", "reader", "review", "write", "mika"];
if (ONLY?.some((s) => !SHOTS.includes(s))) throw new Error(`Choose shots from: ${SHOTS.join(", ")}`);
const want = (s) => !ONLY || ONLY.includes(s);
const demoAccount = process.argv.find((arg) => arg.startsWith("--demo-account="))?.split("=")[1];
if (demoAccount && !/^landing-demo-\d+$/.test(demoAccount)) throw new Error("Only a local landing-demo account can be reused");
if (demoAccount && want("plan")) throw new Error("The guest plan needs a fresh onboarding run");
const LOCALES = ["ru", "en", "zh"];
const LANG_LABEL = { ru: "RU", en: "EN", zh: "中" };
fs.mkdirSync(OUT, { recursive: true });

// A short text an HSK 3–4 learner meets, written for this script.
const READER_TEXT =
  "周末我和朋友去了一家新开的饭馆。菜单上的菜很多，服务员给我们推荐了他们的特色菜。我们点了饺子和一碗面条，味道都很不错。吃完饭，我们去附近的市场买了一些水果。";
const READER_TAP = "推荐";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The Next dev badge and the service worker's update toast are not the app.
const HIDE_DEV = "nextjs-portal{display:none!important}";

async function shot(page, name, locale) {
  await page.addStyleTag({ content: HIDE_DEV }).catch(() => {});
  await sleep(400);
  const png = await page.screenshot({ type: "png" });
  const file = path.join(OUT, `${name}-${locale}.webp`);
  await sharp(png).resize({ width: 600 }).webp({ quality: 80 }).toFile(file);
  console.log("  wrote", path.relative(process.cwd(), file), Math.round(fs.statSync(file).size / 1024) + " KB");
}

// The first visible button whose text starts with one of `labels`.
async function click(page, labels, { timeout = 20000, exact = false } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate(
      ({ labels, exact }) => {
        const el = [...document.querySelectorAll("button, a, [role=button]")].find((b) => {
          const r = b.getBoundingClientRect();
          if (!r.width || !r.height || b.disabled) return false;
          const t = (b.innerText || "").trim();
          return labels.some((l) => (exact ? t === l : t.startsWith(l)));
        });
        if (!el) return false;
        el.click();
        return true;
      },
      { labels, exact },
    );
    if (ok) {
      // Let React commit before the next choice or a second "Дальше" click.
      await sleep(150);
      return true;
    }
    await sleep(300);
  }
  const body = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => "");
  throw new Error(`no button: ${labels.join(" / ")}, the page says:\n${body}`);
}

async function waitText(page, text, timeout = 60000) {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout });
  } catch (e) {
    const body = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => "");
    throw new Error(`waiting for «${text}», the page says:\n${body}`);
  }
}

async function setLocaleLive(page, locale) {
  // The guest screens carry the language menu; switching it keeps the screen's state.
  await click(page, ["RU", "EN", "中"], { exact: true });
  await sleep(300);
  await click(page, [LANG_LABEL[locale]], { exact: true });
  await sleep(900);
}

// Keep the temporary browser profile inside this workspace, never a personal profile.
const tmp = path.resolve(here, "../../.review/browser-tmp");
fs.mkdirSync(tmp, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome", env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp } });
try {
const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, locale: "ru-RU", serviceWorkers: "block" });
await ctx.addInitScript(() => {
  try {
    if (!localStorage.getItem("lexa.locale")) localStorage.setItem("lexa.locale", "ru");
    localStorage.setItem("lexa.theme", "light");
    localStorage.setItem("lexa.examplePinyin", "1");
  } catch {}
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message.slice(0, 160)));

// --- The guest: questions, the check, the plan --------------------------------------
// Meanings of the words on the current check screen, by word; null = made up.
const checkWords = new Map();
page.on("response", async (res) => {
  if (!res.url().includes("/api/public/hsk/check")) return;
  try {
    const j = await res.json();
    if (j.screen) {
      checkWords.clear();
      checkWords.set("__level", j.screen.level);
      for (const w of j.screen.words) checkWords.set(w.word, w.meaning);
    }
  } catch {}
});

if (!demoAccount) {
console.log("guest");
await page.goto(APP + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("[data-cta]", { timeout: 90000 });
await page.click("[data-cta]");
await click(page, ["Бытовые темы"]);
await waitText(page, "К какому уровню HSK идёшь?");
await click(page, ["HSK 4"], { exact: true });
await click(page, ["Дальше"], { exact: true }); // no exam date: «Пока без даты»

// The check: five screens, maybe a meaning question after each.
for (let i = 0; i < 12; i++) {
  await sleep(1500);
  const body = await page.evaluate(() => document.body.innerText);
  if (body.includes("Сколько времени в день?")) break;
  if (body.includes("Что оно значит?")) {
    // The word asked is the big one above the options; answer with its meaning.
    const asked = [...checkWords.keys()].find((w) => w !== "__level" && body.includes(`Что оно значит?\n\n${w}\n`));
    const meaning = asked ? checkWords.get(asked) : null;
    if (meaning) await click(page, [meaning], { exact: true });
    else await click(page, ["Следующий экран"]);
    continue;
  }
  if (!/ЭКРАН \d ИЗ \d/.test(body)) {
    await click(page, ["Следующий экран", "Показать результат"], { timeout: 4000 }).catch(() => {});
    continue;
  }
  const level = checkWords.get("__level") ?? 3;
  const fakes = [...checkWords.entries()].filter(([w, m]) => w !== "__level" && m === null).map(([w]) => w);
  const real = [...checkWords.entries()].filter(([w, m]) => w !== "__level" && m !== null).map(([w]) => w);
  const tap = [...fakes, ...(level >= 4 ? real.slice(0, 3) : [])];
  for (const w of tap) {
    await page.evaluate((w) => {
      const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim().split("\n")[0] === w);
      b?.click();
    }, w);
    await sleep(150);
  }
  await click(page, ["Дальше", "Показать результат"], { exact: true });
}
await waitText(page, "Сколько времени в день?");
await click(page, ["15 мин"]); // a pace moves on by itself
await waitText(page, "Зачем тебе китайский?");
await click(page, ["Сдать HSK"], { exact: true });
await click(page, ["Путешествия"], { exact: true });
await click(page, ["Дальше"], { exact: true });
await waitText(page, "Что тебе интересно?");
await click(page, ["Путешествия"], { exact: true });
await click(page, ["Еда и кулинария"], { exact: true });
await click(page, ["Дальше"], { exact: true });
await waitText(page, "Твой план готов", 90000);
await sleep(1500);
if (want("plan")) {
  for (const locale of LOCALES) {
    await setLocaleLive(page, locale);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "plan", locale);
  }
  await setLocaleLive(page, "ru");
}
}

// --- Sign in: the guest plan lands on a new account ---------------------------------
if (SHOTS.slice(1).some(want)) {
console.log("account");
if (!demoAccount) {
  await click(page, ["Пропустить и войти"]);
  await sleep(1500);
}
const demoId = demoAccount || `landing-demo-${Date.now()}`;
const r = await ctx.request.post(API + "/api/auth/dev", { data: { telegramId: demoId } });
if (!r.ok()) throw new Error(`dev login ${r.status()}`);
// Locally there is no beta code to mark the account invited (lib/gate.ts); the
// Docker database does it directly.
execFileSync("docker", ["exec", "onomika-postgres", "psql", "-U", "vocab", "-d", "vocab", "-c", `update "User" set invited = true where "telegramId" = '${demoId}'`]);
await page.goto(APP + "/", { waitUntil: "domcontentloaded" });
if (!demoAccount) await click(page, ["Продолжить"], { exact: true, timeout: 120000 });
await sleep(4000);
console.log("  account", demoId);

async function inLocale(locale, fn) {
  await page.evaluate((l) => localStorage.setItem("lexa.locale", l), locale);
  await fn(locale);
}

// Today: the day's words, the card's top under the app header.
if (want("today")) {
  for (const locale of LOCALES) {
    await inLocale(locale, async (l) => {
      await page.goto(APP + "/", { waitUntil: "domcontentloaded" });
      await sleep(5000);
      await page.evaluate(() => {
        const h = [...document.querySelectorAll("h2, h3")].find((x) => /HSK \d/.test(x.innerText) && x.closest("section, div"));
        const card = h?.closest("[class*='rounded']") ?? h;
        if (card) window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 70);
      });
      await shot(page, "today", l);
    });
  }
}

// Reader: a real pasted passage and its real dictionary popup.
if (want("reader")) {
  for (const locale of LOCALES) {
    await inLocale(locale, async (l) => {
      await page.goto(APP + "/reader", { waitUntil: "domcontentloaded" });
      await page.locator("textarea").first().fill(READER_TEXT);
      await click(page, ["Читать", "Read", "开始阅读"], { exact: true });
      await page.waitForSelector("span[role=button]", { timeout: 30000 });
      const ruby = page.getByRole("button", { name: /Транскрипция|Pinyin|拼音/, exact: true });
      if (await ruby.count() && await ruby.first().isVisible()) await ruby.first().click();
      const token = page.locator("span[role=button]").filter({ hasText: new RegExp([...READER_TAP].join(".*")) }).first();
      await token.click();
      await sleep(3000);
      // Keep the app's scroll adjustment: it lifts the selected word above the dock.
      const dock = page.locator("div.fixed").filter({ has: page.getByRole("button", { name: /Добавить 1|Add 1|加入 1/ }) }).last();
      const wordBox = await token.boundingBox();
      const dockBox = await dock.boundingBox();
      if (!wordBox || !dockBox || wordBox.y + wordBox.height + 12 > dockBox.y) {
        throw new Error(`Reader ${l}: the word must stay visible above its popup`);
      }
      await shot(page, "reader", l);
    });
  }
}

// Flashcards: start the account's real session and turn its first card over.
if (want("review")) {
  for (const locale of LOCALES) {
    await inLocale(locale, async (l) => {
      await page.goto(APP + "/review", { waitUntil: "domcontentloaded" });
      await click(page, ["Начать —", "Start —", "开始 —"]);
      await page.locator(".flip-scene").waitFor({ state: "visible" });
      await page.locator(".flip-face").first().click({ position: { x: 80, y: 120 } });
      await page.locator(".flip-card.is-flipped").waitFor();
      await sleep(1000);
      await shot(page, "review", l);
    });
  }
}

// Writing: the actual trace grid, before recording a grade.
if (want("write")) {
  for (const locale of LOCALES) {
    await inLocale(locale, async (l) => {
      await page.goto(APP + "/write", { waitUntil: "domcontentloaded" });
      await click(page, ["Начать —", "Start —", "开始 —"]);
      await page.locator("[data-square]").waitFor({ state: "visible", timeout: 60000 });
      await sleep(1500);
      await shot(page, "write", l);
    });
  }
}

// Mika's actual Chinese conversation practice, entered from her welcome screen.
// A fresh café exchange per locale: Mika opens, the learner orders, Mika replies.
if (want("mika")) {
  async function practiceReply(action) {
    const reply = page.waitForResponse((r) => r.url().includes("/api/coach/chat") && r.request().method() === "POST", { timeout: 90000 });
    await action();
    const response = await reply;
    if (!response.ok()) throw new Error(`Mika practice: ${response.status()}`);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    const result = events.find((event) => event.type === "final")?.result;
    if (!result?.say || !/\p{Script=Han}/u.test(result.say) || events.some((event) => event.type === "error")) {
      throw new Error("Mika practice must finish with a Chinese reply");
    }
    await page.locator("textarea:not([disabled])").waitFor();
    await sleep(1000);
  }
  for (const locale of LOCALES) {
    await inLocale(locale, async (l) => {
      await page.goto(APP + "/mika", { waitUntil: "domcontentloaded" });
      await page.getByRole("link", { name: /Разговор по-китайски|Chat in Chinese|用中文聊天/ }).first().click();
      await page.getByRole("button", { name: /HSK/ }).first().click();
      await page.getByRole("button", { name: "HSK 2", exact: true }).click();
      await page.locator('input[maxlength="120"]').fill("Заказ в кафе. Ты бариста, я заказываю кофе. По одной короткой реплике.");
      await practiceReply(() => click(page, ["Начать беседу", "Start chatting", "开始聊天"], { exact: true }));
      await page.locator("textarea").fill("你好！我要一杯咖啡，不要糖。");
      await practiceReply(() => page.locator('button[type="submit"]').click());
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(600);
      const learner = await page.locator(".anim-msg.justify-end").last().boundingBox();
      const reply = await page.locator(".anim-msg.justify-start").last().boundingBox();
      const composer = await page.locator("textarea").boundingBox();
      if (!learner || !reply || !composer || learner.y < 60 || reply.y + reply.height > composer.y - 8) {
        throw new Error(`Mika ${l}: the learner's reply and Mika's response must both be visible`);
      }
      await shot(page, "mika", l);
    });
  }
}
}
console.log("done");
} finally {
  await browser.close();
}
