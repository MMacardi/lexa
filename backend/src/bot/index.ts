import { Telegraf, Markup, type Context } from "telegraf";
import { env } from "../lib/env.js";
import { addWordForUser, listWordsForUser, recordReview } from "../services/vocab.js";
import { tutorChat } from "../services/tutorChat.js";
import { bindLoginToken } from "../services/loginLink.js";
import { langName } from "../lib/langs.js";
import { take } from "../lib/rateLimit.js";
import {
  ensureBotUser,
  resolveUserPair,
  setUserPair,
  dueWordsForUser,
  dueCountForUser,
  ownedWord,
  getReminderHour,
  setReminderHour,
  usersToRemindAt,
  type Pair,
} from "../services/botTutor.js";

// Escape user/LLM text before putting it in an HTML-parse-mode message.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Per-chat scratch state (single instance): last words the tutor suggested (for
// the one-tap "add" button) and a short rolling chat history for context.
type ChatState = { suggested: string[]; history: { role: "user" | "assistant"; content: string }[] };
const chatState = new Map<string, ChatState>();
const stateFor = (id: string): ChatState => {
  let s = chatState.get(id);
  if (!s) {
    s = { suggested: [], history: [] };
    chatState.set(id, s);
  }
  return s;
};

function welcome(pair: Pair): string {
  return [
    "👋 <b>Lexa — твой персональный репетитор</b>",
    "",
    `Пара: <b>${esc(langName(pair.source))} → ${esc(langName(pair.target))}</b>`,
    "",
    "Что я умею:",
    "• <b>/review</b> — повторить карточки, которым пришло время (с оценкой прямо в чате)",
    "• <code>add &lt;слово&gt;</code> — сохранить слово с примером и разбором",
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
  examples: { sentenceEn: string; sentenceZh: string }[];
}): string {
  const bits = [word.phonetic, word.partOfSpeech].filter(Boolean).map((b) => esc(String(b)));
  const lines = [`🃏 <b>${esc(word.word)}</b>${bits.length ? " " + bits.join(" · ") : ""}`];
  if (word.meaningZh) lines.push(esc(word.meaningZh));
  const ex = word.examples[0];
  if (ex) {
    lines.push("");
    lines.push(`<i>${esc(ex.sentenceEn)}</i>`);
    if (ex.sentenceZh) lines.push(esc(ex.sentenceZh));
  }
  return lines.join("\n");
}

const siteButton = () => Markup.button.url("🌐 Открыть сайт Lexa", env.FRONTEND_URL);

// Persistent reply keyboard: the popular functions as always-visible buttons
// under the input. Tapping one sends its label, caught by bot.hears below.
const BTN = {
  review: "▶️ Повторить",
  due: "⏰ Сколько ждёт",
  list: "📚 Мои слова",
  remind: "🔔 Напоминания",
  add: "➕ Добавить слово",
  site: "🌐 Сайт",
} as const;
const mainKeyboard = () =>
  Markup.keyboard([
    [BTN.review, BTN.due],
    [BTN.list, BTN.remind],
    [BTN.add, BTN.site],
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
  const telegramId = String(ctx.from.id);
  await ensureBotUser(telegramId, String(ctx.chat.id));
  await sendNextCard(ctx, telegramId);
}

async function replyDue(ctx: Context): Promise<void> {
  if (!ctx.from) return;
  const telegramId = String(ctx.from.id);
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

async function replyList(ctx: Context): Promise<void> {
  if (!ctx.from) return;
  const words = await listWordsForUser(String(ctx.from.id));
  if (words.length === 0) {
    await ctx.reply("Пока пусто. Добавь слово: отправь «add sanction».");
    return;
  }
  const body = words
    .slice(0, 50)
    .map((w) => `• <b>${esc(w.word)}</b>${w.meaningZh ? " — " + esc(w.meaningZh) : ""}`)
    .join("\n");
  await ctx.replyWithHTML(`📚 <b>Твои слова (${words.length})</b>\n${body}`);
}

async function replyRemindStatus(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const telegramId = String(ctx.from.id);
  await ensureBotUser(telegramId, String(ctx.chat.id));
  const cur = await getReminderHour(telegramId);
  await ctx.replyWithHTML(
    (cur === null
      ? "🔕 Напоминания выключены."
      : `🔔 Напоминаю каждый день в <b>${String(cur).padStart(2, "0")}:00</b>.`) +
      "\n\nЗадать время: <code>/remind 9</code> (час 0–23)\nВыключить: <code>/remind off</code>",
  );
}

async function replySite(ctx: Context): Promise<void> {
  // Telegram only allows https URL buttons; on a local http URL, send it as text.
  if (env.FRONTEND_URL.startsWith("https://")) {
    await ctx.reply("Открой Lexa в браузере:", Markup.inlineKeyboard([[siteButton()]]));
  } else {
    await ctx.reply(`Открой Lexa: ${env.FRONTEND_URL}`);
  }
}

async function replyAddHelp(ctx: Context): Promise<void> {
  await ctx.replyWithHTML(
    "➕ Чтобы добавить слово, просто отправь: <code>add слово</code>\nНапример: <code>add resilient</code>",
  );
}

/** Build the bot. Not launched here — see launchBot(). */
export function createBot(): Telegraf {
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  bot.start(async (ctx) => {
    const telegramId = String(ctx.from.id);
    await ensureBotUser(telegramId, String(ctx.chat.id), {
      firstName: ctx.from.first_name,
      username: ctx.from.username,
    });
    // Deep-link login: /start login_<token>. We DON'T bind silently — the user
    // must tap confirm, so a link someone else sent can't log them in unaware.
    const payload = ctx.startPayload;
    if (payload && payload.startsWith("login_")) {
      const token = payload.slice("login_".length);
      await ctx.replyWithHTML(
        "🔐 <b>Вход на сайт Lexa</b>\nПодтверждайте, только если вы <b>сами</b> сейчас входите на сайте.",
        Markup.inlineKeyboard([[Markup.button.callback("✅ Это я — войти", `login:ok:${token}`)]]),
      );
      return;
    }
    const pair = await resolveUserPair(telegramId);
    await ctx.replyWithHTML(welcome(pair), mainKeyboard());
  });

  // /site — quick link to the web app.
  bot.command("site", (ctx) => replySite(ctx));
  bot.help(async (ctx) => ctx.replyWithHTML(welcome(await resolveUserPair(String(ctx.from.id))), mainKeyboard()));

  // Confirm a web sign-in (from the /start login_<token> deep link).
  bot.action(/^login:ok:(.+)$/, async (ctx) => {
    const ok = bindLoginToken(ctx.match[1], String(ctx.from.id), {
      firstName: ctx.from.first_name ?? null,
      lastName: ctx.from.last_name ?? null,
      username: ctx.from.username ?? null,
    });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      ok ? "✅ Вход подтверждён — вернись на сайт, он уже открывается." : "Ссылка для входа устарела. Войди на сайте ещё раз.",
    );
  });

  // /lang <src> <tgt> — set the pair used for chat + review.
  bot.command("lang", async (ctx) => {
    const telegramId = String(ctx.from.id);
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length < 2) {
      const p = await resolveUserPair(telegramId);
      await ctx.replyWithHTML(
        `Текущая пара: <b>${esc(langName(p.source))} → ${esc(langName(p.target))}</b>\nСменить: <code>/lang en ru</code>`,
      );
      return;
    }
    await ensureBotUser(telegramId, String(ctx.chat.id));
    await setUserPair(telegramId, parts[0].toLowerCase(), parts[1].toLowerCase());
    const p = await resolveUserPair(telegramId);
    await ctx.replyWithHTML(`✅ Пара: <b>${esc(langName(p.source))} → ${esc(langName(p.target))}</b>`);
  });

  // /remind — choose when the daily review nudge arrives (server time), or off.
  bot.command("remind", async (ctx) => {
    const telegramId = String(ctx.from.id);
    await ensureBotUser(telegramId, String(ctx.chat.id));
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

  // "add <word>" — save a word with example + dictionary entry.
  bot.hears(/^add\s+(.+)$/i, async (ctx) => {
    const word = ctx.match[1].trim();
    const telegramId = String(ctx.from.id);
    if (!take(`bot:add:${telegramId}`, 20, 60_000)) {
      await ctx.reply("Слишком часто — подожди минутку.");
      return;
    }
    await ensureBotUser(telegramId, String(ctx.chat.id));
    const pair = await resolveUserPair(telegramId);
    await ctx.replyWithChatAction("typing");
    try {
      const w = await addWordForUser({ telegramId, word, sourceLang: pair.source, targetLang: pair.target });
      await ctx.replyWithHTML(cardBack(w), { link_preview_options: { is_disabled: true } });
    } catch (err) {
      console.error(err);
      await ctx.reply(`⚠️ Не смог добавить «${word}»: ${(err as Error).message}`);
    }
  });

  // /list — saved words.
  bot.command("list", (ctx) => replyList(ctx));

  // /due — how many cards are waiting.
  bot.command("due", (ctx) => replyDue(ctx));

  // /review — start an in-chat review session.
  bot.command("review", (ctx) => replyReview(ctx));

  // ---- reply-keyboard buttons: the popular functions, no typing needed ----
  bot.hears(BTN.review, (ctx) => replyReview(ctx));
  bot.hears(BTN.due, (ctx) => replyDue(ctx));
  bot.hears(BTN.list, (ctx) => replyList(ctx));
  bot.hears(BTN.remind, (ctx) => replyRemindStatus(ctx));
  bot.hears(BTN.add, (ctx) => replyAddHelp(ctx));
  bot.hears(BTN.site, (ctx) => replySite(ctx));

  // ---- review callbacks ----
  bot.action("rv:next", async (ctx) => {
    await ctx.answerCbQuery();
    await sendNextCard(ctx, String(ctx.from.id));
  });

  bot.action(/^rv:show:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const telegramId = String(ctx.from.id);
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
    const telegramId = String(ctx.from.id);
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

  // ---- add a tutor-suggested word ----
  bot.action("tut:addall", async (ctx) => {
    const telegramId = String(ctx.from.id);
    const st = stateFor(String(ctx.chat?.id ?? telegramId));
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
        await addWordForUser({ telegramId, word: w, sourceLang: pair.source, targetLang: pair.target });
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
    const telegramId = String(ctx.from.id);
    const chatId = String(ctx.chat.id);
    if (!take(`bot:tutor:${telegramId}`, 20, 60_000)) {
      await ctx.reply("Слишком часто — подожди минутку.");
      return;
    }
    await ensureBotUser(telegramId, chatId);
    const pair = await resolveUserPair(telegramId);
    const st = stateFor(chatId);
    st.history.push({ role: "user", content: text });
    st.history = st.history.slice(-8);
    await ctx.replyWithChatAction("typing");
    try {
      const r = await tutorChat({ messages: st.history, sourceLang: pair.source, targetLang: pair.target });
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
    await ctx.reply("🎉 Всё повторено — отличная работа!");
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
      const users = await usersToRemindAt(hour);
      for (const u of users) {
        if (lastSent.get(u.telegramId) === day) continue;
        const pair = await resolveUserPair(u.telegramId);
        const n = await dueCountForUser(u.telegramId, pair);
        if (n === 0) continue;
        lastSent.set(u.telegramId, day);
        try {
          await bot.telegram.sendMessage(u.botChatId, `⏰ Пора повторить: <b>${n}</b> ${n === 1 ? "карточка" : "карточек"} ждёт.`, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("▶️ Повторить", "rv:next")]]),
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
 * so it never fights OpenClaw (or another poller) over the same token.
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
      .setChatMenuButton({ menuButton: { type: "web_app", text: "Открыть Lexa", web_app: { url: env.FRONTEND_URL } } })
      .catch((err) => console.error("setChatMenuButton failed:", (err as Error).message));
  }
  void bot.launch(() => console.log("Telegram tutor bot started (long polling)."));
  // Reminders are per-user opt-in (via /remind), so the sweep always runs.
  startReminderLoop(bot);

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
