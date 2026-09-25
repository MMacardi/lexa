// Proves "a topic narrows the goal, it doesn't replace it" (Words for you): an HSK 4
// learner who saved a goal asks for IT words and gets IT words from the HSK list —
// at most 3 above the level, none they own — and the saved goal is still there.
//
// Worth a script because the fault was in the pool, not the prompt: the model saw a
// random 100 of HSK 4's ~970 words, which held one or two IT words, so it padded
// the set with unrelated ones and the prompt read fine.
//
// Calls the model (Qwen) — run against a DEV database, it creates a throwaway user
// and deletes it:
//   cd backend && npx tsx scripts/check-picks-topic.ts
import { prisma } from "../src/services/db.js";
import { suggestDailyPicks } from "../src/agents/coachSuggest.js";
import { getProfile, updateProfile } from "../src/services/coachMemory.js";
import { hskTagFor } from "../src/services/hsk.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-picks-${Date.now()}`;
const GOAL = "HSK 4 к маю, учёба в Китае";
// IT words on the HSK 3.0 list (levels 1–6), to count how many picks are on topic.
const IT = new Set(
  "电脑 网络 软件 程序 数据 系统 技术 网站 手机 上网 密码 下载 键盘 屏幕 互联网 信息 科技 设备 硬件 电子邮件 应用 智能 用户 更新 安装 开发 工程师 项目 文件 网页 数字 功能 升级 输入 网上 网友 电子 打印 鼠标 登录 上传 复制 保存 删除 点击 在线 视频 短信 充电 电池 号码 输出 程序 科学 机器 设计 测试 显示 操作 网速 网民".split(" "),
);
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

async function main() {
  const user = await prisma.user.create({
    data: { telegramId: TG, firstName: "Picks", hskVersion: "3.0", hskTarget: 4, invited: true },
  });
  // Owns two IT words already: neither may come back.
  const owned = ["电脑", "网络"];
  for (const word of owned) {
    await prisma.word.create({ data: { userId: user.id, word, sourceLang: "zh", targetLang: "ru", meaningZh: "" } });
  }
  await updateProfile(TG, "zh", { goal: GOAL });

  const { picks } = await suggestDailyPicks({ telegramId: TG, sourceLang: "zh", targetLang: "ru", count: 8, topic: "IT" });
  console.log(picks.map((p) => `  ${p.word} (HSK ${p.hsk ?? "?"}) — ${p.meaning}`).join("\n"));

  check(picks.length >= 6, `a set of 6–8 picks (${picks.length})`);
  check(picks.every((p) => hskTagFor(p.word)?.["3.0"]), "every pick is on the HSK 3.0 list");
  check(!picks.some((p) => owned.includes(p.word)), "no word the learner owns");
  const above = picks.filter((p) => (p.hsk ?? 0) > 4).length;
  check(above <= 3, `at most 3 above HSK 4 (${above})`);
  check(picks.every((p) => (p.hsk ?? 0) <= 5), "nothing past HSK 5");
  const onTopic = picks.filter((p) => IT.has(p.word)).length;
  check(onTopic >= Math.ceil(picks.length / 2), `most picks are IT words (${onTopic}/${picks.length})`);
  check((await getProfile(TG, "zh")).goal === GOAL, "the saved goal is untouched");

  // Without a topic: the same guarantees, from the narrow pool.
  const plain = (await suggestDailyPicks({ telegramId: TG, sourceLang: "zh", targetLang: "ru", count: 8 })).picks;
  console.log(`  no topic: ${plain.map((p) => `${p.word}/${p.hsk ?? "?"}`).join(" ")}`);
  check(plain.length >= 6 && plain.filter((p) => (p.hsk ?? 0) > 4).length <= 2, "no topic: 6–8 picks, at most 2 above HSK 4");
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    await deleteAccount(TG).catch(() => {});
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
    process.exit(failures ? 1 : 0);
  });
