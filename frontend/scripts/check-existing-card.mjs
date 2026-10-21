// Local disposable accounts: duplicate actions, deleted links, and cached failures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), out = path.join(root, '.playwright-cli', 'existing-card');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, devices } = await import('../node_modules/playwright-core/index.mjs');
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
const user = `existing-card-${Date.now()}`, other = `${user}-other`, results = [];
const record = value => { results.push(value); console.log('PASS: ' + value); };
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}catch(e){console.error(e.message);process.exitCode=1}finally{await db.$disconnect()}`,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
const browser = await chromium.launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block' });
const page = await ctx.newPage(), errors = [];
page.setDefaultTimeout(25000);
page.on('pageerror', e => errors.push(e.message));
await ctx.addInitScript(() => {
  localStorage.setItem('lexa.locale', 'ru');
  localStorage.setItem('lexa.wordPair', JSON.stringify({ sourceLang: 'zh', targetLang: 'ru' }));
  localStorage.setItem('lexa.exampleStyle', 'none');
  localStorage.setItem('lexa.autoGloss', '1');
  localStorage.setItem('lexa.showTextLevel', '0');
});
const list = () => ctx.request.get(api + '/words').then(r => r.json());
async function openAdd(word = '及时', meaning = 'вовремя', navigate = true) {
  if (navigate) await page.goto(app + '/words?mode=manual', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Добавить слово', exact: true }).filter({ visible: true }).click();
  const form = page.locator('form').filter({ has: page.getByPlaceholder(/Значение .*обязательно/) }).filter({ visible: true });
  await form.locator('input').first().fill(word);
  await form.getByPlaceholder(/Значение .*обязательно/).fill(meaning);
  return form;
}
const dialog = () => page.locator('form').filter({ has: page.getByRole('heading', { name: 'Такое слово уже есть', exact: true }) });
async function submit(form) { await form.locator('button[type=submit]').click(); }
try {
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
  const fixture = JSON.parse(db(`
    const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});
    const b=await db.user.create({data:{telegramId:${JSON.stringify(other)},invited:true}});
    const cards=[];
    for(const [owner,sourceLang,targetLang,meaningZh] of [[u.id,'zh','ru','вовремя'],[u.id,'zh','ru','своевременный'],[u.id,'zh','en','wrong target'],[u.id,'ja','ru','wrong source'],[b.id,'zh','ru','other account']]) {
      cards.push(await db.word.create({data:{userId:owner,word:'及时',sourceLang,targetLang,meaningZh,phonetic:'jí shí',autoExamples:false,exampleStatus:'disabled',familyAt:new Date()}}));
    }
    await db.readerText.create({data:{userId:u.id,title:'Part 12 deletion fixture',content:'请及时通知我。',sourceLang:'zh',targetLang:'ru'}});
    console.log(JSON.stringify(cards.map(w=>w.id)));
  `));
  const before = (await list()).length;
  assert.equal((await ctx.request.get(api + '/words/' + fixture[4])).status(), 404);
  let form = await openAdd();
  await submit(form);
  await dialog().getByRole('button', { name: /Открыть карточку/ }).first().waitFor();
  assert.equal(await dialog().getByRole('button', { name: /Открыть карточку/ }).count(), 2);
  assert.doesNotMatch(await dialog().innerText(), /wrong target|wrong source|other account/);
  assert.match(await dialog().innerText(), /вовремя/);
  assert.match(await dialog().innerText(), /своевременный/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(out, 'phone-duplicate.png'), fullPage: true });
  await dialog().getByRole('button', { name: /Открыть карточку/ }).filter({ hasText: 'своевременный' }).click();
  await page.waitForURL(app + '/word/' + fixture[1]);
  assert.equal((await list()).length, before);
  record('phone: exact pair and explicit sense open same owned ID without creation');

  form = await openAdd(); await submit(form);
  await dialog().getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal((await list()).length, before);
  await submit(form);
  await dialog().getByLabel('Больше не спрашивать').check();
  await dialog().getByRole('button', { name: 'Всё равно добавить', exact: true }).click();
  const success = form.getByRole('link', { name: 'Открыть карточку', exact: true });
  await success.waitFor();
  const createdUrl = await success.getAttribute('href');
  assert.equal((await list()).length, before + 1);
  // The preference applies only to the intentional add, and remains in this session.
  await form.locator('input').first().fill('及时');
  await form.getByPlaceholder(/Значение .*обязательно/).fill('вовремя');
  await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/words')), submit(form)]);
  await success.waitFor();
  const secondUrl = await success.getAttribute('href');
  assert.notEqual(secondUrl, createdUrl);
  assert.equal((await list()).length, before + 2);
  record('Cancel, Add anyway, and session duplicate preference');

  await success.click();
  await page.waitForURL(app + secondUrl);
  await page.getByRole('button', { name: 'Удалить', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Удалить карточку?', exact: true }).waitFor();
  await page.locator('form').getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.waitForURL(app + '/words');
  form = await openAdd('', '', false);
  assert.equal(await form.locator(`a[href="${secondUrl}"]`).count(), 0);
  await page.goto(app + secondUrl, { waitUntil: 'networkidle' });
  await page.getByText('Возможно, карточка была удалена. Вернитесь в «Мои слова».', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Повторить', exact: true }).count(), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /Сервер запущен/);
  record('delete just-added card: Add clears action; direct URL has calm 404 and My words route');

  // Remove the remaining same-pair cards through the list UI, then revisit Reader.
  await page.goto(app + '/words', { waitUntil: 'networkidle' });
  // API deletion is used here to exercise authoritative 404 eviction of a cached card.
  await page.goto(app + '/word/' + fixture[0], { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Удалить', exact: true }).first().waitFor();
  for (const word of await list()) if (word.sourceLang === 'zh' && word.targetLang === 'ru') await ctx.request.delete(api + '/words/' + word.id);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Возможно, карточка была удалена. Вернитесь в «Мои слова».', { exact: true }).waitFor();
  await page.goto(app + '/reader', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Part 12 deletion fixture/ }).click();
  const passage = page.locator('div.select-none.whitespace-pre-wrap');
  await passage.getByRole('button', { name: '及时', exact: true }).click();
  await page.getByRole('dialog', { name: '及时', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Открыть карточку', exact: true }).count(), 0);
  record('authoritative 404 evicts cached detail; Reader offers no deleted-card action');

  // Keep a real card visible through a controlled transient failure, then test uncached failure.
  const remaining = (await list()).find(w => w.targetLang === 'en');
  await page.goto(app + '/word/' + remaining.id, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Удалить', exact: true }).first().waitFor();
  await page.route(`**/api/words/${remaining.id}`, route => route.fulfill({ status: 502, json: { error: 'Controlled transient failure' } }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Удалить', exact: true }).first().waitFor();
  assert.equal(await page.getByText(/^Слово не найдено/).count(), 0);
  await page.route('**/api/words/uncached-part12', route => route.fulfill({ status: 502, json: { error: 'Controlled transient failure' } }));
  await page.goto(app + '/word/uncached-part12', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Повторить', exact: true }).waitFor();
  assert.equal(await page.getByText(/^Слово не найдено/).count(), 0);
  record('502 preserves cached content; uncached 502 offers Retry instead of not-found');

  // Keep the desktop Add form mounted while deleting its newly created card.
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(app + '/words?mode=manual', { waitUntil: 'networkidle' });
  const inline = page.locator('form').filter({ has: page.getByPlaceholder(/Значение .*обязательно/) }).filter({ visible: true });
  await inline.locator('input').first().fill('学习');
  await inline.getByPlaceholder(/Значение .*обязательно/).fill('учиться');
  await submit(inline);
  const liveLink = inline.getByRole('link', { name: 'Открыть карточку', exact: true });
  await liveLink.waitFor();
  const liveUrl = await liveLink.getAttribute('href');
  await page.getByRole('button', { name: 'Delete 学习', exact: true }).click();
  await page.locator('form').getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.waitForFunction(url => !document.querySelector(`a[href="${url}"]`), liveUrl);
  assert.equal(await inline.getByRole('link', { name: 'Открыть карточку', exact: true }).count(), 0);
  record('list deletion clears success link while Add stays mounted');

  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
} catch (error) {
  fs.writeFileSync(path.join(out, 'failure.txt'), await page.locator('body').innerText().catch(() => ''));
  throw error;
} finally {
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');for(const id of ${JSON.stringify([user, other])}) await deleteAccount(id);`);
  await browser.close();
}
