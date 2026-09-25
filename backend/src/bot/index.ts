import { Telegraf, Markup, type Context } from "telegraf";
import { env } from "../lib/env.js";
import { addWordForUser, listWordsForUser, recordReview } from "../services/vocab.js";
import { recordProduction, asProductionError } from "../services/production.js";
import { tutorChat } from "../services/tutorChat.js";
import { coachDrill } from "../services/coachDrill.js";
import { getProfile, profilePreamble, rememberFromSession } from "../services/coachMemory.js";
import { transcribeAudio, ocrImage } from "../services/llm.js";
import { bindLoginToken } from "../services/loginLink.js";
import { langName } from "../lib/langs.js";
import { take } from "../lib/rateLimit.js";
import { takeMonthly } from "../lib/entitlements.js";
import { runAsUser } from "../lib/usageContext.js";
import {
  ensureBotUser,
  resolveUserPair,
  setUserPair,
  distinctPairsForUser,
  dueWordsForUser,
  dueCountForUser,
  drillWordsForUser,
  weakCountForUser,
  captureCandidates,
  ownedWord,
  getReminderHour,
  setReminderHour,
  getReminderDays,
  setReminderDays,
  usersToRemindAt,
  type Pair,
} from "../services/botTutor.js";

// Escape user/LLM text before putting it in an HTML-parse-mode message.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Per-chat scratch state (single instance): last words the tutor suggested (for
// the one-tap "add" button) and a short rolling chat history for context.
// An in-chat Coach practice session: the words being drilled + the rolling thread.
type PracticeState = {
  words: { id: string; word: string; meaning: string }[];
  pair: Pair;
  messages: { role: "user" | "assistant"; content: string }[];
  graded: Set<string>; // wordKeys already graded this session
  correct: number;
};
type ChatState = {
  suggested: string[];
  history: { role: "user" | "assistant"; content: string }[];
  practice?: PracticeState;
  /** Words a scanned photo offered, indexed by the `cap:<i>` buttons under it. */
  captured: string[];
};
const chatState = new Map<string, ChatState>();
const stateFor = (id: string): ChatState => {
  let s = chatState.get(id);
  if (!s) {
    s = { suggested: [], history: [], captured: [] };
    chatState.set(id, s);
  }
  return s;
};

// The account this update belongs to, resolved once per update by the middleware
// in createBot(). Never `ctx.from.id`: that is a Telegram identity, and the
// learner's account may be keyed on their email instead (see ensureBotUser).
const acct = (ctx: Context): string => (ctx.state as { account?: string }).account ?? String(ctx.from?.id ?? "");

function welcome(pair: Pair): string {
  return [
    "👋 <b>Onomika — твой персональный репетитор</b>",
    "",
    `Пара: <b>${esc(langName(pair.source))} → ${esc(langName(pair.target))}</b>`,
    "",
    "Что я умею:",
    "• <b>/review</b> — повторить карточки, которым пришло время, и закрыть день шагом на использование",
    "• <code>add &lt;слово&gt;</code> — сохранить слово с примером и разбором",
    "• <b>📷 фото страницы</b> — прочитаю её и предложу слова, которых у тебя ещё нет",
    "• <b>/list</b> — твои слова · <b>/due</b> — сколько ждёт повторения",
    "• <b>/remind 9</b> — напоминать о повторении каждый день в 9:00",
    "• просто напиши вопрос — объясню, приведу примеры, помогу с грамматикой",
    "",
    "👇 Популярные функции — на кнопках снизу.",
    "Сменить язык: <code>/lang en ru</code>",
  ].join("\n");
}

// ---- Card rendering ----
function cardFront(word: { word: string; phonetic: string | null; partOfSpeech: string | null }): string {
  const bits = [word.phonetic, word.partOfSpeech].filter(Boolean).map((b) => esc(String(b)));
  return [`🃏 <b>${esc(word.word)}</b>${bits.length ? " " + bits.join(" · ") : ""}`, "", "<i>Вспомни значение…</i>"].join("\n");
}

function cardBack(word: {
  word: string;
  phonetic: string | null;
  partOfSpeech: string | null;
  meaningZh: string | null;
  dictMeaning?: boolean;
  examples: { sentenceEn: string; sentenceZh: string }[];
}): string {
  const bits = [word.phonetic, word.partOfSpeech].filter(Boolean).map((b) => esc(String(b)));
  const lines = [`🃏 <b>${esc(word.word)}</b>${bits.length ? " " + bits.join(" · ") : ""}`];
  // Instant capture: until the model's meaning lands, this is CC-CEDICT's English,
  // and BY-SA wants the source named where the text is shown.
  if (word.meaningZh) lines.push(esc(word.meaningZh) + (word.dictMeaning ? " <i>(англ., CC-CEDICT)</i>" : ""));
  const ex = word.examples[0];
  if (ex) {
    lines.push("");
    lines.push(`<i>${esc(ex.sentenceEn)}</i>`);
    if (ex.sentenceZh) lines.push(esc(ex.sentenceZh));
  }
  return lines.join("\n");
}

const siteButton = () => Markup.button.url("🌐 Открыть сайт Onomika", env.FRONTEND_URL);

// Persistent reply keyboard: the popular functions as always-visible buttons
// under the input. Tapping one sends its label, caught by bot.hears below.
const BTN = {
  review: "▶️ Повторить",
  practice: "🎯 Практика",
  due: "⏰ Сколько ждёт",
  list: "📚 Мои слова",
  remind: "🔔 Напоминания",
  add: "➕ Добавить слово",
  lang: "🗣 Язык",
  site: "🌐 Сайт",
} as const;
const mainKeyboard = () =>
  Markup.keyboard([
    [BTN.review, BTN.practice],
    [BTN.due, BTN.list],
    [BTN.remind, BTN.add],
    [BTN.lang, BTN.site],
  ]).resize();

const showKeyboard = (id: string) =>
  Markup.inlineKeyboard([[Markup.button.callback("👁 Показать ответ", `rv:show:${id}`)]]);

const gradeKeyboard = (id: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("🔴 Забыл", `rv:g:${id}:1`),
      Markup.button.callback("🟠 Трудно", `rv:g:${id}:2`),
    ],
    [
      Markup.button.callback("🟢 Норм", `rv:g:${id}:3`),
      Markup.button.callback("🔵 Легко", `rv:g:${id}:4`),
    ],
    [Markup.button.callback("⏹ Закончить", "rv:stop")],
  ]);

// ---- Shared actions (used by both slash-commands and the reply-keyboard buttons) ----
async function replyReview(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  await sendNextCard(ctx, acct(ctx));
}

async function replyDue(ctx: Context): Promise<void> {
  if (!ctx.from) return;
  const telegramId = acct(ctx);
  const pair = await resolveUserPair(telegramId);
  const n = await dueCountForUser(telegramId, pair);
  if (n === 0) {
    await ctx.reply("🎉 Всё повторено — на сегодня ничего не ждёт.");
    return;
  }
  await ctx.replyWithHTML(
    `⏰ Ждёт повторения: <b>${n}</b>`,
    Markup.inlineKeyboard([[Markup.button.callback("▶️ Повторить", "rv:next")]]),
  );
}

const WORDS_PER_PAGE = 10;

// Render one page of the vocabulary + prev/next inline buttons. Paginating avoids
// Telegram's 4096-char message cap, which silently dropped big lists (looked hung).
function wordsPage(words: { word: string; meaningZh: string | null }[], page: number) {
  const pages = Math.max(1, Math.ceil(words.length / WORDS_PER_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = words.slice(p * WORDS_PER_PAGE, p * WORDS_PER_PAGE + WORDS_PER_PAGE);
  const body = slice
    .map((w, i) => `${p * WORDS_PER_PAGE + i + 1}. <b>${esc(w.word)}</b>${w.meaningZh ? " — " + esc(w.meaningZh) : ""}`)
    .join("\n");
  const text = `📚 <b>Твои слова (${words.length})</b> · стр. ${p + 1}/${pages}\n${body}`;
  const nav = [];
  if (p > 0) nav.push(Markup.button.callback("◀ Назад", `wl:${p - 1}`));
  if (p < pages - 1) nav.push(Markup.button.callback("Дальше ▶", `wl:${p + 1}`));
  return { text, markup: nav.length ? Markup.inlineKeyboard([nav]) : undefined };
}

async function replyList(ctx: Context): Promise<void> {
  if (!ctx.from) return;
  const words = await listWordsForUser(acct(ctx));
  if (words.length === 0) {
    await ctx.reply("Пока пусто. Добавь слово: отправь «add sanction».");
    return;
  }
  const { text, markup } = wordsPage(words, 0);
  await ctx.replyWithHTML(text, markup ? { link_preview_options: { is_disabled: true }, ...markup } : undefined);
}

// Reminder picker: whole hours (Telegram has no time input) + weekday multi-select.
const REMIND_HOURS = [6, 7, 8, 9, 10, 12, 14, 18, 20, 21, 22, 23];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun (getDay(): 0=Sun)
const DAY_LABEL: Record<number, string> = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 0: "Вс" };

function parseDays(csv: string): Set<number> {
  if (!csv.trim()) return new Set(DAY_ORDER); // "" = every day
  return new Set(csv.split(",").map(Number).filter((n) => n >= 0 && n <= 6));
}
function daysToStore(set: Set<number>): string {
  if (set.size >= 7) return ""; // all = every day (stored as empty)
  return DAY_ORDER.filter((d) => set.has(d)).join(",");
}
function daysLabel(set: Set<number>): string {
  if (set.size >= 7) return "каждый день";
  const picked = DAY_ORDER.filter((d) => set.has(d));
  return picked.length ? picked.map((d) => DAY_LABEL[d]).join(", ") : "—";
}

function remindKeyboard(hour: number | null, daysCsv: string) {
  const days = parseDays(daysCsv);
  const dayBtn = (d: number) => Markup.button.callback(`${days.has(d) ? "✅ " : ""}${DAY_LABEL[d]}`, `rd:${d}`);
  const rows = [
    DAY_ORDER.slice(0, 4).map(dayBtn),
    DAY_ORDER.slice(4).map(dayBtn),
    [Markup.button.callback(days.size >= 7 ? "✅ Каждый день" : "Каждый день", "rd:all")],
  ];
  for (let i = 0; i < REMIND_HOURS.length; i += 4) {
    rows.push(
      REMIND_HOURS.slice(i, i + 4).map((h) =>
        Markup.button.callback(`${hour === h ? "✅ " : ""}${String(h).padStart(2, "0")}:00`, `rm:${h}`),
      ),
    );
  }
  rows.push([Markup.button.callback(hour === null ? "✅ 🔕 Выключено" : "🔕 Выключить", "rm:off")]);
  return Markup.inlineKeyboard(rows);
}

function remindText(hour: number | null, daysCsv: string): string {
  if (hour === null) return "🔕 Напоминания выключены.\n\nВыбери дни и время ниже 👇";
  return (
    `🔔 Напоминаю <b>${daysLabel(parseDays(daysCsv))}</b> в <b>${String(hour).padStart(2, "0")}:00</b>.` +
    "\n\nМеняй дни и время кнопками 👇"
  );
}

async function replyRemindStatus(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const telegramId = acct(ctx);
  const [hour, days] = await Promise.all([getReminderHour(telegramId), getReminderDays(telegramId)]);
  await ctx.replyWithHTML(remindText(hour, days), remindKeyboard(hour, days));
}

// Inline picker for the learner's language pair — the pairs they already have
// cards in, plus a few common presets, so it never needs the /lang command.
async function replyLangPicker(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const telegramId = acct(ctx);
  const cur = await resolveUserPair(telegramId);
  const seen = new Set<string>();
  const pairs: { source: string; target: string }[] = [];
  for (const p of await distinctPairsForUser(telegramId)) {
    const k = `${p.source}|${p.target}`;
    if (!seen.has(k)) {
      seen.add(k);
      pairs.push(p);
    }
  }
  for (const [source, target] of [
    ["en", "ru"],
    ["ru", "en"],
    ["en", "zh"],
    ["zh", "en"],
  ] as const) {
    const k = `${source}|${target}`;
    if (!seen.has(k)) {
      seen.add(k);
      pairs.push({ source, target });
    }
  }
  const rows = pairs.slice(0, 8).map((p) => {
    const on = p.source === cur.source && p.target === cur.target;
    return [Markup.button.callback(`${on ? "✅ " : ""}${langName(p.source)} → ${langName(p.target)}`, `lp:${p.source}:${p.target}`)];
  });
  await ctx.replyWithHTML(
    `🗣 Текущая пара: <b>${esc(langName(cur.source))} → ${esc(langName(cur.target))}</b>\nВыбери ниже или задай свою: <code>/lang en ru</code>`,
    Markup.inlineKeyboard(rows),
  );
}

async function replySite(ctx: Context): Promise<void> {
  // Telegram only allows https URL buttons; on a local http URL, send it as text.
  if (env.FRONTEND_URL.startsWith("https://")) {
    await ctx.reply("Открой Onomika в браузере:", Markup.inlineKeyboard([[siteButton()]]));
  } else {
    await ctx.reply(`Открой Onomika: ${env.FRONTEND_URL}`);
  }
}

async function replyAddHelp(ctx: Context): Promise<void> {
  await ctx.replyWithHTML(
    "➕ Чтобы добавить слово, просто отправь: <code>add слово</code>\nНапример: <code>add resilient</code>" +
      "\n\n📷 Или пришли <b>фото страницы</b> — я прочитаю её и предложу слова, которых у тебя ещё нет.",
  );
}

/**
 * Save one word into the deck with its example and dictionary entry. Every way
 * into the deck from the chat — typed `add`, a candidate tapped off a photo —
 * goes through here.
 */
async function captureWord(ctx: Context, word: string): Promise<void> {
  const telegramId = acct(ctx);
  const pair = await resolveUserPair(telegramId);
  await ctx.replyWithChatAction("typing");
  try {
    const w = await addWordForUser({ telegramId, word, sourceLang: pair.source, targetLang: pair.target, level: pair.level });
    await ctx.replyWithHTML(cardBack(w), { link_preview_options: { is_disabled: true } });
  } catch (err) {
    console.error(err);
    await ctx.reply(`⚠️ Не смог добавить «${word}»: ${(err as Error).message}`);
  }
}

// ---- Coach practice (adaptive drill over the learner's own words) ----
const practiceStopKeyboard = () =>
  Markup.inlineKeyboard([[Markup.button.callback("⏹ Закончить практику", "pr:stop")]]);

async function startPractice(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const telegramId = acct(ctx);
  const pair = await resolveUserPair(telegramId);
  const words = await drillWordsForUser(telegramId, pair, 6);
  if (words.length === 0) {
    await ctx.reply("Сначала добавь несколько слов — потом попрактикуем. Напиши, например: add resilient");
    return;
  }
  const st = stateFor(String(ctx.chat.id));
  st.practice = { words, pair, messages: [], graded: new Set(), correct: 0 };
  await ctx.replyWithHTML(
    `🎯 <b>Практика</b> — отработаем ${words.length} ${words.length === 1 ? "слово" : "слов"}. ` +
      "Отвечай текстом или голосовым 🎙",
  );
  await ctx.replyWithChatAction("typing");
  await runPracticeTurn(ctx, st);
}

/**
 * The day's one use-step: a single word, once the review queue is empty.
 *
 * Reviewing says you recognise a word; this asks you to use it, which is the
 * thing the app is actually for. One word, not six — it closes the daily loop
 * instead of starting a second session the learner didn't come for.
 */
async function startUseStep(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const telegramId = acct(ctx);
  const pair = await resolveUserPair(telegramId);
  const words = await drillWordsForUser(telegramId, pair, 1);
  if (words.length === 0) {
    await ctx.reply("Сначала добавь слово — потом отработаем. Напиши, например: add resilient");
    return;
  }
  const st = stateFor(String(ctx.chat.id));
  st.practice = { words, pair, messages: [], graded: new Set(), correct: 0 };
  await ctx.replyWithHTML(
    `🗣 <b>Шаг на использование</b> — одно слово: <b>${esc(words[0].word)}</b>. Ответь текстом или голосовым 🎙`,
  );
  await ctx.replyWithChatAction("typing");
  await runPracticeTurn(ctx, st);
}

/** One coach turn: ask the model, grade the previous answer into the SRS, reply. */
async function runPracticeTurn(ctx: Context, st: ChatState): Promise<void> {
  const p = st.practice;
  if (!p) return;
  const telegramId = acct(ctx);
  let res;
  try {
    res = await coachDrill({
      messages: p.messages,
      words: p.words.map((w) => ({ word: w.word, meaning: w.meaning })),
      sourceLang: p.pair.source,
      targetLang: p.pair.target,
      level: p.pair.level,
      profileNote: telegramId ? profilePreamble(await getProfile(telegramId, p.pair.source), p.pair.source) : "",
    });
  } catch (err) {
    console.error(err);
    await ctx.reply("⚠️ Наставник не ответил. Попробуй ещё раз или начни заново: /practice");
    return;
  }
  p.messages.push({ role: "assistant", content: res.say });
  p.messages = p.messages.slice(-16);
  // Log the previous answer as production evidence (once per word). NOT a review:
  // using a word in a drill says nothing about when to show the card again.
  if (res.grade !== "none" && res.gradedWord) {
    const key = res.gradedWord.trim().toLowerCase();
    const card = p.words.find((w) => w.word.trim().toLowerCase() === key);
    if (card && !p.graded.has(key)) {
      p.graded.add(key);
      if (res.grade === "correct") p.correct++;
      try {
        await recordProduction(card.id, res.grade, "drill", asProductionError(res.errorKind));
      } catch (err) {
        console.error("practice grade failed:", (err as Error).message);
      }
    }
  }
  const mark = res.grade === "correct" ? "🟢 " : res.grade === "partial" ? "🟠 " : res.grade === "wrong" ? "🔴 " : "";
  if (res.done) {
    if (telegramId) void rememberFromSession({ telegramId, lang: p.pair.source, messages: p.messages });
    st.practice = undefined;
    await ctx.replyWithHTML(
      `${mark}${esc(res.say)}\n\n🎉 <b>Готово</b> — верно ${p.correct}/${p.graded.size}. Ещё раз: /practice`,
      { link_preview_options: { is_disabled: true } },
    );
    return;
  }
  await ctx.replyWithHTML(`${mark}${esc(res.say)}`, {
    link_preview_options: { is_disabled: true },
    ...practiceStopKeyboard(),
  });
}

/** The learner answered (typed or transcribed) during an active practice. */
async function handlePracticeAnswer(ctx: Context, st: ChatState, text: string): Promise<void> {
  if (!st.practice) return;
  st.practice.messages.push({ role: "user", content: text.slice(0, 1500) });
  await ctx.replyWithChatAction("typing");
  await runPracticeTurn(ctx, st);
}

/** Build the bot. Not launched here — see launchBot(). */
export function createBot(): Telegraf {
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
  // Resolve the sender to their account once per update, and attribute this
  // update's LLM spend to it. Handlers read it back with acct(ctx) — they must
  // never key on ctx.from.id, which is only one of the ways into an account.
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const account = await ensureBotUser(String(ctx.from.id), String(ctx.chat?.id ?? ctx.from.id), {
      firstName: ctx.from.first_name,
      username: ctx.from.username,
    });
    (ctx.state as { account?: string }).account = account;
    return runAsUser(account, next, "bot");
  });

  bot.start(async (ctx) => {
    const telegramId = acct(ctx);
    // Deep-link login: /start login_<token>. We DON'T bind silently — the user
    // must tap confirm, so a link someone else sent can't log them in unaware.
    const payload = ctx.startPayload;
    if (payload && payload.startsWith("login_")) {
      const token = payload.slice("login_".length);
      await ctx.replyWithHTML(
        "🔐 <b>Вход на сайт Onomika</b>\nПодтверждайте, только если вы <b>сами</b> сейчас входите на сайте.",
        Markup.inlineKeyboard([[Markup.button.callback("✅ Это я — войти", `login:ok:${token}`)]]),
      );
      return;
    }
    const pair = await resolveUserPair(telegramId);
    await ctx.replyWithHTML(welcome(pair), mainKeyboard());
  });

  // /site — quick link to the web app.
  bot.command("site", (ctx) => replySite(ctx));
  bot.help(async (ctx) => ctx.replyWithHTML(welcome(await resolveUserPair(acct(ctx))), mainKeyboard()));

  // Confirm a web sign-in (from the /start login_<token> deep link). The numeric
  // id, not acct(ctx): the site resolves it as a Telegram identity, which is how
  // it finds (or links) the account on its side.
  bot.action(/^login:ok:(.+)$/, async (ctx) => {
    const ok = bindLoginToken(ctx.match[1], String(ctx.from.id), {
      firstName: ctx.from.first_name ?? null,
      lastName: ctx.from.last_name ?? null,
      username: ctx.from.username ?? null,
    });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      ok
        ? "✅ Вход подтверждён. Вернись в браузер (на iPhone — «◀ Safari» вверху слева): вкладка Onomika войдёт сама."
        : "Ссылка для входа устарела. Войди на сайте ещё раз.",
    );
  });

  // /lang <src> <tgt> — set the pair used for chat + review.
  bot.command("lang", async (ctx) => {
    const telegramId = acct(ctx);
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length < 2) {
      const p = await resolveUserPair(telegramId);
      await ctx.replyWithHTML(
        `Текущая пара: <b>${esc(langName(p.source))} → ${esc(langName(p.target))}</b>\nСменить: <code>/lang en ru</code>`,
      );
      return;
    }
    await setUserPair(telegramId, parts[0].toLowerCase(), parts[1].toLowerCase());
    const p = await resolveUserPair(telegramId);
    await ctx.replyWithHTML(`✅ Пара: <b>${esc(langName(p.source))} → ${esc(langName(p.target))}</b>`);
  });

  // /remind — choose when the daily review nudge arrives (server time), or off.
  bot.command("remind", async (ctx) => {
    const telegramId = acct(ctx);
    const arg = ctx.message.text.trim().split(/\s+/)[1]?.toLowerCase();
    if (!arg) {
      await replyRemindStatus(ctx);
      return;
    }
    if (arg === "off" || arg === "выкл") {
      await setReminderHour(telegramId, null);
      await ctx.reply("🔕 Ок, больше не напоминаю.");
      return;
    }
    const hour = Number(arg);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      await ctx.reply("Укажи час от 0 до 23, например: /remind 9");
      return;
    }
    await setReminderHour(telegramId, hour);
    await ctx.replyWithHTML(`🔔 Буду напоминать о повторении каждый день в <b>${String(hour).padStart(2, "0")}:00</b>.`);
  });

  // "add <word>" / "/add <word>" — save a word with example + dictionary entry.
  bot.hears(/^\/?add\s+(.+)$/i, async (ctx) => {
    const word = ctx.match[1].trim();
    if (!take(`bot:add:${acct(ctx)}`, 20, 60_000)) {
      await ctx.reply("Слишком часто — подожди минутку.");
      return;
    }
    await captureWord(ctx, word);
  });

  // /add with nothing after it — explain both ways in.
  bot.command("add", (ctx) => replyAddHelp(ctx));

  // /list — saved words (first 50).
  bot.command("list", (ctx) => replyList(ctx));

  // /due — how many cards are waiting.
  bot.command("due", (ctx) => replyDue(ctx));

  // /review — start an in-chat review session.
  bot.command("review", (ctx) => replyReview(ctx));

  // /practice — start an adaptive Coach drill over your own words.
  bot.command("practice", (ctx) => startPractice(ctx));

  // ---- reply-keyboard buttons: the popular functions, no typing needed ----
  bot.hears(BTN.review, (ctx) => replyReview(ctx));
  bot.hears(BTN.practice, (ctx) => startPractice(ctx));
  bot.hears(BTN.due, (ctx) => replyDue(ctx));
  bot.hears(BTN.list, (ctx) => replyList(ctx));
  bot.hears(BTN.remind, (ctx) => replyRemindStatus(ctx));
  bot.hears(BTN.add, (ctx) => replyAddHelp(ctx));
  bot.hears(BTN.lang, (ctx) => replyLangPicker(ctx));
  bot.hears(BTN.site, (ctx) => replySite(ctx));

  // ---- inline pagination for "Мои слова" ----
  bot.action(/^wl:(\d+)$/, async (ctx) => {
    const words = await listWordsForUser(acct(ctx));
    const { text, markup } = wordsPage(words, Number(ctx.match[1]));
    await ctx.answerCbQuery();
    await ctx.editMessageText(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(markup ?? {}) });
  });

  // ---- reminder time picker ----
  bot.action(/^rm:(off|\d{1,2})$/, async (ctx) => {
    const telegramId = acct(ctx);
    const hour = ctx.match[1] === "off" ? null : Number(ctx.match[1]);
    await setReminderHour(telegramId, hour);
    const days = await getReminderDays(telegramId);
    await ctx.answerCbQuery(hour === null ? "🔕 Выключено" : `🔔 ${String(hour).padStart(2, "0")}:00`);
    await ctx.editMessageText(remindText(hour, days), { parse_mode: "HTML", ...remindKeyboard(hour, days) });
  });

  // ---- reminder weekday multi-select ----
  bot.action(/^rd:(all|[0-6])$/, async (ctx) => {
    const telegramId = acct(ctx);
    const hour = await getReminderHour(telegramId);
    let store: string;
    if (ctx.match[1] === "all") {
      store = ""; // every day
    } else {
      const d = Number(ctx.match[1]);
      const set = parseDays(await getReminderDays(telegramId));
      if (set.has(d)) set.delete(d);
      else set.add(d);
      if (set.size === 0) set.add(d); // never allow zero days — keep the last one
      store = daysToStore(set);
    }
    await setReminderDays(telegramId, store);
    await ctx.answerCbQuery();
    await ctx.editMessageText(remindText(hour, store), { parse_mode: "HTML", ...remindKeyboard(hour, store) });
  });

  // ---- language pair picker ----
  bot.action(/^lp:([a-zA-Z-]+):([a-zA-Z-]+)$/, async (ctx) => {
    const telegramId = acct(ctx);
    const source = ctx.match[1].toLowerCase();
    const target = ctx.match[2].toLowerCase();
    await setUserPair(telegramId, source, target);
    await ctx.answerCbQuery(`${langName(source)} → ${langName(target)}`);
    await ctx.editMessageText(`✅ Пара: <b>${esc(langName(source))} → ${esc(langName(target))}</b>`, { parse_mode: "HTML" });
  });

  // ---- review callbacks ----
  bot.action("rv:next", async (ctx) => {
    await ctx.answerCbQuery();
    await sendNextCard(ctx, acct(ctx));
  });

  bot.action(/^rv:show:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const telegramId = acct(ctx);
    const word = await ownedWord(telegramId, id);
    await ctx.answerCbQuery();
    if (!word) {
      await ctx.editMessageText("Карточка недоступна.");
      return;
    }
    await ctx.editMessageText(cardBack(word), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...gradeKeyboard(id),
    });
  });

  bot.action(/^rv:g:(.+):([1-4])$/, async (ctx) => {
    const id = ctx.match[1];
    const grade = Number(ctx.match[2]) as 1 | 2 | 3 | 4;
    const telegramId = acct(ctx);
    const word = await ownedWord(telegramId, id);
    if (!word) {
      await ctx.answerCbQuery("Карточка недоступна");
      return;
    }
    await recordReview(id, grade);
    const mark = grade === 1 ? "🔴" : grade === 2 ? "🟠" : grade === 3 ? "🟢" : "🔵";
    await ctx.answerCbQuery(`${mark} записал`);
    // Collapse the graded card to keep the chat tidy, then send the next one.
    await ctx.editMessageText(`${mark} <b>${esc(word.word)}</b> — оценено`, { parse_mode: "HTML" });
    await sendNextCard(ctx, telegramId);
  });

  bot.action("rv:stop", async (ctx) => {
    await ctx.answerCbQuery("Готово");
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply("⏹ Сессия завершена. Хорошая работа!");
  });

  // ---- practice: start from an inline button (e.g. the daily nudge) ----
  bot.action("pr:start", async (ctx) => {
    await ctx.answerCbQuery();
    await startPractice(ctx);
  });

  // ---- the day's one use-step, offered when the review queue runs out ----
  bot.action("us:start", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined);
    await startUseStep(ctx);
  });

  // ---- practice: stop the drill ----
  bot.action("pr:stop", async (ctx) => {
    const st = stateFor(String(ctx.chat?.id ?? ctx.from.id));
    const p = st.practice;
    st.practice = undefined;
    await ctx.answerCbQuery("Готово");
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(p ? `⏹ Практика остановлена — верно ${p.correct}/${p.graded.size}. Хорошая работа!` : "⏹ Готово.");
  });

  // ---- practice: a voice answer (transcribe → grade) ----
  bot.on("voice", async (ctx) => {
    const telegramId = acct(ctx);
    const chatId = String(ctx.chat.id);
    const st = stateFor(chatId);
    if (!st.practice) {
      await ctx.reply("🎙 Голосовые я слушаю во время практики. Нажми «🎯 Практика», чтобы начать.");
      return;
    }
    if (!take(`bot:practice:${telegramId}`, 20, 60_000)) {
      await ctx.reply("Слишком часто — подожди минутку.");
      return;
    }
    await ctx.replyWithChatAction("typing");
    try {
      const link = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
      const resp = await fetch(link.href);
      const b64 = Buffer.from(await resp.arrayBuffer()).toString("base64");
      const text = await transcribeAudio({ base64: b64, format: "ogg", sourceLang: st.practice.pair.source });
      if (!text) {
        await ctx.reply("🎙 Не разобрал запись — попробуй ещё раз или напиши ответ текстом.");
        return;
      }
      await ctx.replyWithHTML(`🎙 <i>${esc(text)}</i>`, { link_preview_options: { is_disabled: true } });
      await handlePracticeAnswer(ctx, st, text);
    } catch (err) {
      console.error("voice practice failed:", (err as Error).message);
      await ctx.reply("🎙 Не смог обработать голос — напиши ответ текстом.");
    }
  });

  // ---- capture: a photo of a page -> OCR -> words you don't have yet ----
  bot.on("photo", async (ctx) => {
    const telegramId = acct(ctx);
    if (!take(`bot:ocr:${telegramId}`, 5, 60_000)) {
      await ctx.reply("Слишком часто — подожди минутку.");
      return;
    }
    // Same monthly allowance as the Reader's "scan a photo": one OCR is one OCR,
    // whichever surface it came from.
    if (!(await takeMonthly(telegramId, "ocr", env.FREE_MONTHLY_OCR))) {
      await ctx.reply("📷 Бесплатные сканы на этот месяц закончились. Открой сайт, чтобы перейти на Pro.");
      return;
    }
    const pair = await resolveUserPair(telegramId);
    await ctx.replyWithChatAction("typing");
    try {
      // Telegram sends the same photo in several sizes, largest last.
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const link = await ctx.telegram.getFileLink(photo.file_id);
      const resp = await fetch(link.href);
      const b64 = Buffer.from(await resp.arrayBuffer()).toString("base64");
      const text = await ocrImage({ dataUrl: `data:image/jpeg;base64,${b64}`, sourceLang: pair.source });
      if (!text.trim()) {
        await ctx.reply("📷 Не разобрал текст на фото — попробуй снять поближе и при свете.");
        return;
      }
      await ctx.replyWithHTML(`📷 <i>${esc(text.slice(0, 600))}</i>`, { link_preview_options: { is_disabled: true } });
      const candidates = await captureCandidates(telegramId, pair, text);
      // No buttons for a language the segmenter doesn't cover (it's Chinese-only,
      // see captureCandidates) — and none when the page holds nothing new.
      if (candidates.length === 0) {
        await ctx.replyWithHTML("Выбери слово из текста сам и пришли: <code>add слово</code>");
        return;
      }
      const st = stateFor(String(ctx.chat.id));
      st.captured = candidates;
      const rows: ReturnType<typeof Markup.button.callback>[][] = [];
      for (let i = 0; i < candidates.length; i += 3) {
        rows.push(candidates.slice(i, i + 3).map((w, j) => Markup.button.callback(w, `cap:${i + j}`)));
      }
      rows.push([Markup.button.callback(`➕ Добавить все (${candidates.length})`, "cap:all")]);
      await ctx.replyWithHTML(
        `🌱 <b>Нашёл ${candidates.length} ${candidates.length === 1 ? "слово" : "слов"}</b>, которых у тебя ещё нет. Нажми, чтобы добавить:`,
        Markup.inlineKeyboard(rows),
      );
    } catch (err) {
      console.error("photo capture failed:", (err as Error).message);
      await ctx.reply("📷 Не смог обработать фото — попробуй ещё раз.");
    }
  });

  // One captured word (the button carries its index — a word doesn't fit the
  // 64-byte callback payload reliably).
  bot.action(/^cap:(\d+)$/, async (ctx) => {
    const st = stateFor(String(ctx.chat?.id ?? ctx.from.id));
    const i = Number(ctx.match[1]);
    const word = st.captured[i];
    if (!word) {
      // The slot is blanked once added, so a second tap on a button that stays
      // on screen costs neither a duplicate card nor another model call.
      await ctx.answerCbQuery(st.captured.length ? "Уже добавлено" : "Список устарел — пришли фото ещё раз");
      return;
    }
    st.captured[i] = "";
    await ctx.answerCbQuery(`➕ ${word}`);
    await captureWord(ctx, word);
  });

  bot.action("cap:all", async (ctx) => {
    const telegramId = acct(ctx);
    const st = stateFor(String(ctx.chat?.id ?? ctx.from.id));
    const words = st.captured.filter(Boolean); // minus the ones already tapped
    st.captured = [];
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined);
    if (words.length === 0) return;
    const pair = await resolveUserPair(telegramId);
    await ctx.replyWithChatAction("typing");
    let ok = 0;
    for (const w of words) {
      try {
        await addWordForUser({ telegramId, word: w, sourceLang: pair.source, targetLang: pair.target, level: pair.level });
        ok++;
      } catch (err) {
        console.error(err);
      }
    }
    await ctx.reply(`🌱 Добавил карточек: ${ok}/${words.length}`);
  });

  // ---- add a tutor-suggested word ----
  bot.action("tut:addall", async (ctx) => {
    const telegramId = acct(ctx);
    const st = stateFor(String(ctx.chat?.id ?? ctx.from.id));
    const words = st.suggested.slice(0, 20);
    st.suggested = [];
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined);
    if (words.length === 0) return;
    const pair = await resolveUserPair(telegramId);
    await ctx.replyWithChatAction("typing");
    let ok = 0;
    for (const w of words) {
      try {
        await addWordForUser({ telegramId, word: w, sourceLang: pair.source, targetLang: pair.target, level: pair.level });
        ok++;
      } catch (err) {
        console.error(err);
      }
    }
    await ctx.reply(`🌱 Добавил карточек: ${ok}/${words.length}`);
  });

  // ---- free text -> conversational tutor ----
  bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return; // commands handled above
    const telegramId = acct(ctx);
    const chatId = String(ctx.chat.id);
    // While a practice drill is active, plain text is the learner's answer — route
    // it to the coach instead of the free-form tutor.
    const active = stateFor(chatId);
    if (active.practice) {
      if (!take(`bot:practice:${telegramId}`, 20, 60_000)) {
        await ctx.reply("Слишком часто — подожди минутку.");
        return;
      }
      await handlePracticeAnswer(ctx, active, text);
      return;
    }
    if (!take(`bot:tutor:${telegramId}`, 20, 60_000)) {
      await ctx.reply("Слишком часто — подожди минутку.");
      return;
    }
    const pair = await resolveUserPair(telegramId);
    const st = stateFor(chatId);
    st.history.push({ role: "user", content: text });
    st.history = st.history.slice(-8);
    await ctx.replyWithChatAction("typing");
    try {
      const r = await tutorChat({
        messages: st.history,
        sourceLang: pair.source,
        targetLang: pair.target,
        profileNote: profilePreamble(await getProfile(telegramId, pair.source), pair.source),
      });
      st.history.push({ role: "assistant", content: r.answer });
      st.suggested = r.addWords ?? [];
      const extra = st.suggested.length
        ? Markup.inlineKeyboard([
            [Markup.button.callback(`➕ Добавить ${st.suggested.length} слов: ${st.suggested.slice(0, 6).join(", ")}`.slice(0, 60), "tut:addall")],
          ])
        : undefined;
      await ctx.replyWithHTML(esc(r.answer), extra ? { link_preview_options: { is_disabled: true }, ...extra } : undefined);
    } catch (err) {
      console.error(err);
      await ctx.reply("⚠️ Что-то пошло не так, попробуй ещё раз.");
    }
  });

  return bot;
}

/** Send the next due card to review, or a "done" message when none remain. */
async function sendNextCard(ctx: Context, telegramId: string): Promise<void> {
  const pair = await resolveUserPair(telegramId);
  const due = await dueWordsForUser(telegramId, pair, 1);
  if (due.length === 0) {
    // The end of the queue is where the daily loop closes: recognising the cards
    // was the easy half, so offer the use-step rather than just applauding. One
    // tap, not automatic — it costs a model call the learner may not want.
    await ctx.replyWithHTML(
      "🎉 <b>Всё повторено</b> — отличная работа!\n\nОстался один шаг: <i>использовать</i> слово, а не просто узнать его.",
      Markup.inlineKeyboard([[Markup.button.callback("🗣 Шаг на использование", "us:start")]]),
    );
    return;
  }
  const word = due[0];
  await ctx.replyWithHTML(cardFront(word), { link_preview_options: { is_disabled: true }, ...showKeyboard(word.id) });
}

/**
 * Per-user daily nudge: each learner picks their own hour via /remind. Every 15
 * min we look at the current hour and message anyone who chose it and has cards
 * due. A per-user "last sent day" guard stops double-sends within the hour.
 */
function startReminderLoop(bot: Telegraf): void {
  const lastSent = new Map<string, string>(); // telegramId -> YYYY-MM-DD
  const tick = async () => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.toISOString().slice(0, 10);
    try {
      const weekday = now.getDay(); // 0=Sun..6=Sat
      const users = await usersToRemindAt(hour);
      for (const u of users) {
        // Respect the chosen weekdays ("" = every day).
        if (u.reminderDays.trim() && !parseDays(u.reminderDays).has(weekday)) continue;
        if (lastSent.get(u.telegramId) === day) continue;
        const pair = await resolveUserPair(u.telegramId);
        const n = await dueCountForUser(u.telegramId, pair);
        if (n === 0) continue;
        const weak = await weakCountForUser(u.telegramId, pair);
        lastSent.set(u.telegramId, day);
        const weakLine = weak > 0 ? `\n🎯 ${weak} ${weak === 1 ? "слово ускользает" : "слов ускользают"} — их и отработаем в конце.` : "";
        // One button on purpose: the nudge starts the day's whole loop (review →
        // one use-step), and a second choice here is where people stall.
        try {
          await bot.telegram.sendMessage(u.botChatId, `⏰ Пора повторить: <b>${n}</b> ${n === 1 ? "карточка" : "карточек"} ждёт.${weakLine}`, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("▶️ Начать", "rv:next")]]),
          });
        } catch (err) {
          // A user may have blocked the bot — skip and continue.
          console.error(`reminder to ${u.telegramId} failed:`, (err as Error).message);
        }
      }
    } catch (err) {
      console.error("reminder sweep failed:", err);
    }
  };
  setInterval(() => void tick(), 15 * 60_000).unref?.();
}

/**
 * Launch the bot via long polling, if enabled. Guarded behind ENABLE_TELEGRAM_BOT
 * so it never fights another poller (e.g. a local backend) over the same token.
 */
export function launchBot(): void {
  if (env.ENABLE_TELEGRAM_BOT !== "true") {
    console.log("ENABLE_TELEGRAM_BOT not 'true' — Telegram tutor bot disabled.");
    return;
  }
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled.");
    return;
  }
  const bot = createBot();
  void bot.telegram
    .setMyCommands([
      { command: "review", description: "Повторить карточки" },
      { command: "practice", description: "Практика с наставником" },
      { command: "add", description: "Добавить слово (или пришли фото страницы)" },
      { command: "due", description: "Сколько ждёт повторения" },
      { command: "remind", description: "Напоминания о повторении" },
      { command: "list", description: "Мои слова" },
      { command: "site", description: "Открыть сайт" },
      { command: "lang", description: "Сменить языковую пару" },
      { command: "help", description: "Что я умею" },
    ])
    .catch((err) => console.error("setMyCommands failed:", (err as Error).message));
  // Menu button → open the site as a Mini App (Telegram requires an https URL).
  if (env.FRONTEND_URL.startsWith("https://")) {
    void bot.telegram
      .setChatMenuButton({ menuButton: { type: "web_app", text: "Открыть Onomika", web_app: { url: env.FRONTEND_URL } } })
      .catch((err) => console.error("setChatMenuButton failed:", (err as Error).message));
  }
  // A 409 means another process polls this token (e.g. the old container during a
  // Railway redeploy overlap). Don't let it crash the API — wait and retry.
  const start = (): void => {
    bot.launch(() => console.log("Telegram tutor bot started (long polling).")).catch((err) => {
      const code = (err as { response?: { error_code?: number } }).response?.error_code;
      console.error(`Telegram bot polling stopped${code ? ` (${code})` : ""}: ${(err as Error).message}. Retrying in 15s.`);
      setTimeout(start, 15_000);
    });
  };
  start();
  // Reminders are per-user opt-in (via /remind), so the sweep always runs.
  startReminderLoop(bot);

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
