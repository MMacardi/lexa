import { Telegraf } from "telegraf";
import { env } from "../lib/env.js";
import {
  addWordForUser,
  listWordsForUser,
} from "../services/vocab.js";

// Escape user/LLM text before putting it in an HTML-parse-mode message, so a
// stray <, > or & can't break Telegram's parser.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const WELCOME = [
  "👋 <b>Vocabulary Assistant</b>",
  "",
  "Send <code>add &lt;word&gt;</code> to save an English word. I'll find a real",
  "news sentence, translate it to Chinese, and add a dictionary entry.",
  "",
  "Commands:",
  "• <code>add sanction</code> — look up and save a word",
  "• <code>/list</code> — your saved words",
].join("\n");

/** Build the Telegraf bot. Not launched here — see launchBot(). */
export function createBot(): Telegraf {
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  bot.start((ctx) => ctx.replyWithHTML(WELCOME));
  bot.help((ctx) => ctx.replyWithHTML(WELCOME));

  // "add <word>" — the core flow.
  bot.hears(/^add\s+(.+)$/i, async (ctx) => {
    const word = ctx.match[1].trim();
    const telegramId = String(ctx.from.id);
    await ctx.replyWithChatAction("typing");
    try {
      const w = await addWordForUser({ telegramId, word });
      const ex = w.examples[0];
      const lines = [
        `📘 <b>${esc(w.word)}</b> ${esc(w.phonetic ?? "")} · ${esc(w.partOfSpeech ?? "")}`,
        w.meaningZh ? esc(w.meaningZh) : "",
        "",
      ];
      if (ex) {
        lines.push(`📰 <i>${esc(ex.sentenceEn)}</i>`);
        lines.push(`🀄 ${esc(ex.sentenceZh)}`);
        lines.push(`🔗 <a href="${esc(ex.sourceUrl)}">${esc(ex.sourceName)}</a>`);
        lines.push("");
      }
      if (w.collocations.length) lines.push(`搭配: ${esc(w.collocations.join(", "))}`);
      if (w.synonyms.length) lines.push(`近义: ${esc(w.synonyms.join(", "))}`);
      if (w.antonyms.length) lines.push(`反义: ${esc(w.antonyms.join(", "))}`);
      await ctx.replyWithHTML(lines.filter(Boolean).join("\n"), {
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      console.error(err);
      await ctx.reply(`⚠️ Couldn't add "${word}": ${(err as Error).message}`);
    }
  });

  // "/list" — saved words.
  bot.command("list", async (ctx) => {
    const words = await listWordsForUser(String(ctx.from.id));
    if (words.length === 0) {
      await ctx.reply("No words yet. Try: add sanction");
      return;
    }
    const body = words
      .map((w) => `• <b>${esc(w.word)}</b>${w.meaningZh ? " — " + esc(w.meaningZh) : ""}`)
      .join("\n");
    await ctx.replyWithHTML(`📚 <b>Your words (${words.length})</b>\n${body}`);
  });

  return bot;
}

/**
 * Launch the bot via long polling, if a token is configured. Long polling needs
 * no public URL, so it works on localhost during development. We don't await
 * bot.launch() because it only resolves when the bot stops.
 */
export function launchBot(): void {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled.");
    return;
  }
  const bot = createBot();
  void bot.launch(() => console.log("Telegram bot started (long polling)."));

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
