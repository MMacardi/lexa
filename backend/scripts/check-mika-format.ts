// Deterministic language/recovery checks; --live also asks local Mika via HTTP.
import assert from "node:assert/strict";
import "dotenv/config";
import { checkedTeachingReply, teachingLanguageIssue } from "../src/lib/teachingLanguage.js";

const good = '**拒绝** — отказаться; **照镜子** — смотреться в зеркало.\n- 他拒绝了邀请。\n  Он отказался от приглашения.\n- 她在照镜子。\n  Она смотрится в зеркало.\n- В **银行** и **行走** один иероглиф читается по-разному.';
assert.equal(teachingLanguageIssue(good, "ru"), null);
assert.equal(teachingLanguageIssue('Сравни «拒绝» и «照镜子».', "ru"), null);
assert.ok(teachingLanguageIssue('Он 拒绝了 приглашение.', "ru"));
assert.ok(teachingLanguageIssue('- Перевод: Она смотрит в 镜子.', "ru"));
assert.ok(teachingLanguageIssue('- 她在照镜子。\n  Она смотрит в **镜子**.', "ru"));
assert.ok(teachingLanguageIssue('这是中文解释。', "ru"));
assert.equal(teachingLanguageIssue('这是中文解释。', "zh"), null);
assert.equal(teachingLanguageIssue('Use **拒绝** for refusing.', "en"), null);
let calls = 0;
assert.equal((await checkedTeachingReply(async repair => {
  calls++;
  if (calls === 1) { assert.equal(repair, undefined); return { answer: 'Он 拒绝了 приглашение.' }; }
  assert.match(repair!, /Untranslated Chinese/);
  return { answer: good };
}, "ru")).answer, good);
assert.equal(calls, 2);
calls = 0;
await assert.rejects(checkedTeachingReply(async () => { calls++; return { answer: 'Он 拒绝了 приглашение.' }; }, "ru"), /requested language/);
assert.equal(calls, 2, "never loops after a failed repair");
calls = 0;
await checkedTeachingReply(async repair => {
  calls++;
  if (!repair) { const err = new Error('bad shape'); err.name = 'ZodError'; throw err; }
  return { answer: good };
}, "ru");
assert.equal(calls, 2);
const abort = new AbortController();
calls = 0;
await assert.rejects(checkedTeachingReply(async () => {
  calls++; abort.abort(); return { answer: 'Он 拒绝了 приглашение.' };
}, "ru", abort.signal), { name: "AbortError" });
assert.equal(calls, 1);
console.log('PASS Russian quotations/examples, mixed-clause detection, language preservation, bounded JSON/language repair, cancellation');

if (process.argv.includes('--live')) {
  assert.match(process.env.DATABASE_URL ?? "", /localhost:5433\//, "Local Docker DB only");
  const { prisma } = await import('../src/services/db.js');
  const { deleteAccount } = await import('../src/services/accountData.js');
  const telegramId = `mika-format-${Date.now()}`;
  try {
    const user = await prisma.user.create({ data: { telegramId, invited: true, nativeLang: 'ru', hskTarget: 4 } });
    const login = await fetch('http://localhost:3000/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telegramId }) });
    assert.equal(login.status, 200);
    const headers = { 'Content-Type': 'application/json', Cookie: login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
    const word = await prisma.word.create({ data: { userId: user.id, word: '拒绝', sourceLang: 'zh', targetLang: 'ru', explainCache: 'explain-v2\nОн 拒绝了 приглашение.' } });
    for (const [route, question] of [
      ['/tutor/ask', 'Объясни по-русски 拒绝 и 照镜子 с коротким примером и полным переводом каждого. Затем покажи разное чтение 行 в 银行 и 行走 и пример с 到达.'],
      [`/words/${word.id}/ask`, 'Объясни по-русски 拒绝 с коротким примером и полным русским переводом.'],
      [`/words/${word.id}/explain`, ''],
    ].filter(([route]) => !process.argv.includes('--explain-only') || route.endsWith('/explain'))) {
      const response = await fetch('http://localhost:3000/api' + route, { method: 'POST', headers, body: JSON.stringify({ stream: true, sourceLang: 'zh', targetLang: 'ru', level: '4', messages: [{ role: 'user', content: question }] }) });
      assert.equal(response.status, 200);
      const events = (await response.text()).trim().split('\n').map(l => JSON.parse(l));
      assert.ok(events.some(e => e.type === 'delta'), 'initial reply streams');
      const final = events.find(e => e.type === 'final');
      assert.ok(final, JSON.stringify(events.at(-1)));
      const text = final.result.answer ?? final.result.explanation;
      assert.equal(teachingLanguageIssue(text, 'ru'), null);
      console.log(`PASS live ${route}\n${text}`);
      if (route.endsWith('/explain')) {
        const cached = await fetch('http://localhost:3000/api' + route, { method: 'POST', headers, body: '{}' });
        assert.equal(cached.status, 200);
        assert.equal((await cached.json()).explanation, text);
        console.log('PASS invalid legacy explanation regenerated; validated cache reused');
      }
    }
  } finally { await deleteAccount(telegramId); await prisma.$disconnect(); }
}
