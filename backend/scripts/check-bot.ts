// Proves the bot works without commands (BACKLOG "A bot you don't need commands for").
//
// The real bot, with Telegram's API replaced by a recorder: messages and button
// presses go through bot.handleUpdate exactly as Telegram would deliver them, and
// every reply is checked. The learner is a Chinese→Russian HSK 4 whose chat
// predates the four-button keyboard. No slash command is typed after /start.
//
// Run against a DEV database — it creates a throwaway learner and deletes it:
//   cd backend && npx tsx scripts/check-bot.ts
import { Telegram } from "telegraf";
import { createBot } from "../src/bot/index.js";
import { prisma } from "../src/services/db.js";
import { deleteAccount } from "../src/services/accountData.js";

type Call = { method: string; payload: Record<string, unknown> };
type Kb = { keyboard?: (string | { text: string })[][]; inline_keyboard?: { text: string; callback_data?: string }[][]; is_persistent?: boolean };

const TGID = 910_000_000 + Math.floor(Math.random() * 1_000_000);
const TG = String(TGID);
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

const calls: Call[] = [];
const bot = createBot();
bot.botInfo = {
  id: 1,
  is_bot: true,
  first_name: "Test",
  username: "onomika_check_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};
// On the prototype: Telegraf makes a new Telegram client for every update, so
// patching bot.telegram alone would let the replies reach the real API.
(Telegram.prototype as unknown as { callApi: (m: string, p: Record<string, unknown>) => Promise<unknown> }).callApi = async (method, payload) => {
  calls.push({ method, payload });
  if (method === "sendMessage") return { message_id: calls.length, date: 0, chat: { id: TGID, type: "private" }, text: payload.text };
  return true;
};

let upd = 1;
const from = { id: TGID, is_bot: false, first_name: "Check", language_code: "ru" };
const chat = { id: TGID, type: "private" as const, first_name: "Check" };
async function send(text: string): Promise<Call[]> {
  calls.length = 0;
  const cmd = text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } : {};
  await bot.handleUpdate({ update_id: upd++, message: { message_id: upd, date: Math.floor(Date.now() / 1000), chat, from, text, ...cmd } } as never);
  return [...calls];
}
async function press(data: string): Promise<Call[]> {
  calls.length = 0;
  await bot.handleUpdate({
    update_id: upd++,
    callback_query: { id: String(upd), from, chat_instance: "x", data, message: { message_id: 1, date: 0, chat, text: "x" } },
  } as never);
  return [...calls];
}
const replies = (cs: Call[]) => cs.filter((c) => c.method === "sendMessage");
const texts = (cs: Call[]) => replies(cs).map((c) => String(c.payload.text));
const kb = (c: Call) => c.payload.reply_markup as Kb | undefined;
const inline = (cs: Call[]) => replies(cs).flatMap((c) => kb(c)?.inline_keyboard?.flat() ?? []).map((b) => b.callback_data ?? "");
const card = (word: string) => prisma.word.findFirst({ where: { user: { telegramId: TG }, word } });

async function main() {
  // A chat from before the new menu: Chinese → Russian, HSK 4, botMenu still 0.
  await prisma.user.create({
    data: { telegramId: TG, firstName: "Check", preferredSource: "zh", preferredTarget: "ru", nativeLang: "ru", hskVersion: "3.0", hskTarget: 4 },
  });

  // 1. One word as a message: a dictionary preview, and the new keyboard — once.
  let r = await send("算法");
  const menu = replies(r).find((c) => kb(c)?.keyboard);
  expect(texts(r).some((t) => t.includes("算法") && t.includes("suàn fǎ")), "a single word gets a dictionary preview (算法 suàn fǎ)");
  expect(inline(r).includes("aw:add") && inline(r).includes("aw:ask"), "…with [➕ Добавить] [💬 Спросить]");
  expect(!!menu, "an old chat gets the new keyboard on its next message");
  const rows = kb(menu!)?.keyboard?.map((row) => row.map((b) => (typeof b === "string" ? b : b.text))) ?? [];
  expect(JSON.stringify(rows) === JSON.stringify([["▶️ Повторить", "✨ Слова на сегодня"], ["➕ Добавить слово", "☰ Ещё"]]), `four buttons: ${JSON.stringify(rows)}`);
  expect(kb(menu!)?.is_persistent === true, "the keyboard is persistent (Telegram doesn't fold it away)");
  expect((await prisma.user.findUnique({ where: { telegramId: TG } }))?.botMenu === 2, "User.botMenu remembers it");
  r = await send("参数");
  expect(!replies(r).some((c) => kb(c)?.keyboard), "…and only once");

  // 2. [➕ Добавить] under the preview makes the card.
  r = await press("aw:add");
  expect(!!(await card("参数")), "➕ Добавить makes a card of the previewed word (参数)");

  // 3. "➕ Добавить слово", then the words themselves — no `add`.
  r = await send("➕ Добавить слово");
  expect(texts(r).some((t) => t.includes("Пришли слово")), "➕ Добавить слово asks for the word");
  r = await send("延迟, 推理");
  expect(!!(await card("延迟")) && !!(await card("推理")), "the next message is the words: 延迟 and 推理 become cards");

  // 4. ✨ Слова на сегодня: the day's HSK 4 words with meanings, one tap for all.
  r = await send("✨ Слова на сегодня");
  const listed = texts(r).join("\n");
  expect(listed.includes("HSK 4") && inline(r).some((d) => d === "td:all"), "✨ Слова на сегодня lists the day's HSK 4 words with ➕ Взять все");
  const before = await prisma.word.count({ where: { user: { telegramId: TG } } });
  r = await press("td:all");
  const after = await prisma.word.count({ where: { user: { telegramId: TG } } });
  expect(after - before >= 5, `➕ Взять все adds them (${after - before} new cards)`);
  expect(texts(r).some((t) => t.includes("Добавил")), "…and says so, with ▶️ Повторить");

  // 5. ☰ Ещё → the rest, labelled in Russian.
  r = await send("☰ Ещё");
  expect(["mn:practice", "mn:list", "mn:remind", "mn:lang", "mn:site", "mn:help"].every((d) => inline(r).includes(d)), "☰ Ещё opens practice / words / reminders / language / site / help");
  r = await press("mn:lang");
  expect(texts(r).some((t) => t.includes("учу китайский, знаю русский")), "the language picker says «учу китайский, знаю русский»");

  // 6. /start teaches buttons, not commands.
  r = await send("/start");
  const welcome = texts(r).join("\n");
  expect(!welcome.includes("/review") && !welcome.includes("add &lt;") && !welcome.includes("/remind"), "the welcome no longer teaches /review, add <слово>, /remind");

  // 7. An account waiting out its deletion grace period gets the date, not the bot.
  await prisma.user.update({ where: { telegramId: TG }, data: { deleteAfter: new Date(Date.now() + 14 * 86_400_000) } });
  const cardsBefore = await prisma.word.count({ where: { user: { telegramId: TG } } });
  r = await send("算力");
  expect(texts(r).some((t) => t.includes("будет удалён")) && !inline(r).includes("aw:add"), "a deleting account gets the date and the way back, not the bot");
  r = await send("/start login_abc");
  expect(texts(r).some((t) => t.includes("Вход на сайт")), "…but the sign-in link still works (it's the way back)");
  expect((await prisma.word.count({ where: { user: { telegramId: TG } } })) === cardsBefore, "…and nothing is added meanwhile");
}

main()
  .catch((e) => {
    console.error(e);
    fails.push(String(e));
  })
  .finally(async () => {
    await deleteAccount(TG).catch(() => {});
    console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nall checks passed");
    await prisma.$disconnect();
    process.exit(fails.length ? 1 : 0);
  });
