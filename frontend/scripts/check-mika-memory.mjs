// One real local Qwen preference/recall flow and a Russian phone controls check.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli', 'mika-memory');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium } = await import('../node_modules/playwright-core/index.mjs');
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
const users = [`memory-ui-${Date.now()}-a`, `memory-ui-${Date.now()}-b`];
const controlsOnly = process.argv.includes('--controls-only');
const result = { checks: [] };
const record = (s) => { result.checks.push(s); console.log('PASS ' + s); };
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
const browser = await chromium.launch({ headless: true, downloadsPath: path.join(out, 'downloads') });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU', serviceWorkers: 'block' });
await ctx.addInitScript(() => localStorage.setItem('lexa.locale', 'ru'));
const page = await ctx.newPage(), errors = [];
page.setDefaultTimeout(30000);
page.on('pageerror', e => errors.push(e.message));
const profile = async (lang = 'zh') => {
  const r = await ctx.request.get(api + '/coach/profile?lang=' + lang); assert.equal(r.status(), 200); return r.json();
};
let sentChatId;
async function login(id) {
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: id } })).status(), 200);
  db(`await db.user.update({where:{telegramId:${JSON.stringify(id)}},data:{invited:true,firstName:'Проверка',nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});`);
}
async function send(text) {
  await page.getByPlaceholder('Спроси или добавь фото…', { exact: true }).filter({ visible: true }).fill(text);
  const response = page.waitForResponse(r => r.url().endsWith('/api/tutor/ask') && r.request().method() === 'POST', { timeout: 90000 });
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  const r = await response; assert.equal(r.status(), 200);
  sentChatId = r.request().postDataJSON().chatId;
  const lines = (await r.text()).trim().split('\n').map(l => JSON.parse(l));
  const final = lines.find(l => l.type === 'final'); assert.ok(final, 'validated final streamed response');
  await page.getByRole('button', { name: 'Отправить', exact: true }).waitFor({ timeout: 90000 });
  return final.result.answer;
}
const chatId = () => page.evaluate(() => sessionStorage.getItem('lexa.tutorChatId'));
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await ctx.request.get('http://localhost:3000/health', { timeout: 1000 })).ok()) break; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  await login(users[0]);
  if (!controlsOnly) {
  await page.goto(app + '/words', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Открыть Мику', exact: true }).click();
  result.firstReply = await send('Для моих занятий китайским запомни: я предпочитаю ровно один короткий пример про поезда. Это моя постоянная учебная привычка, а не задание на перевод.');
  const initialChat = await chatId();
  assert.equal(initialChat, sentChatId, 'tab mirror and live chat use the same ID');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть Мику', exact: true }).click();
  assert.equal(await chatId(), initialChat);
  assert.ok(await page.getByText(/Это моя постоянная учебная привычка/).count());
  await page.getByRole('link', { name: 'Открыть на весь экран', exact: true }).click();
  await page.waitForURL(app + '/mika');
  assert.equal(await chatId(), initialChat);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await chatId(), initialChat);
  await page.getByRole('button', { name: 'Новый чат', exact: true }).filter({ visible: true }).waitFor();
  let remembered;
  for (let attempt = 0; attempt < 60; attempt++) {
    remembered = await profile();
    if (/поезд|train/i.test(remembered.notes)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.match(remembered.notes, /поезд|train/i);
  result.memory = remembered.notes;
  const savedResponse = await ctx.request.get(api + '/tutor/chats/' + initialChat);
  assert.equal(savedResponse.status(), 200, await savedResponse.text());
  const saved = await savedResponse.json();
  assert.equal(saved.n, 2);
  record('popup close/reopen → full page → reload preserve one persisted conversation; server learns preference');
  await page.getByRole('button', { name: 'Новый чат', exact: true }).filter({ visible: true }).click();
  assert.notEqual(await chatId(), initialChat);
  result.recallReply = await send('Покажи, как употреблять 到达, с учётом моих постоянных предпочтений к учебным примерам.');
  assert.match(result.recallReply, /поезд|вокзал|火车|列车|train/i);
  assert.equal((await profile('en')).notes, '');
  record('new chat uses durable memory in a focused live Qwen reply; another source language has no notes');
  } else {
    assert.equal((await ctx.request.put(api + '/coach/profile', { data: { lang: 'zh', notes: 'Предпочитает один короткий пример про поезда.' } })).status(), 200);
    await page.goto(app + '/mika', { waitUntil: 'networkidle' });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const memoryLink = page.getByRole('link', { name: 'Что Мика знает о тебе', exact: true }).filter({ visible: true });
  await memoryLink.click();
  await page.waitForURL(/\/account\?memoryLang=zh#mika-memory/);
  const section = page.locator('#mika-memory');
  await section.locator('textarea').waitFor();
  await section.locator('textarea').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  assert.match(await section.locator('textarea').inputValue(), /поезд|train/i);
  await page.screenshot({ path: path.join(out, 'phone-memory.png') });
  if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) {
    console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].map(el => ({tag:el.tagName, cls:el.className, right:el.getBoundingClientRect().right, width:el.getBoundingClientRect().width})).filter(el => el.right > innerWidth + 1).slice(0, 12))));
    assert.fail('phone horizontal overflow');
  }
  await section.locator('textarea').fill('Моя правка: один короткий пример про лодки.');
  await section.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#mika-memory button:last-child')?.disabled !== true);
  assert.match((await profile()).notes, /лодки/);
  await section.getByRole('button', { name: 'Очистить', exact: true }).click();
  for (let i = 0; i < 20 && (await profile()).notes; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal((await profile()).notes, '');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('#mika-memory textarea').inputValue(), '');
  record('Russian phone memory link, editable notes, save/clear/reload; no horizontal overflow');

  await login(users[1]);
  assert.equal((await profile()).notes, '');
  // Body/query IDs cannot read or modify A from B's authenticated session.
  const spoof = await ctx.request.put(api + '/coach/profile', { data: { telegramId: users[0], lang: 'en', notes: 'Only B' } });
  assert.equal(spoof.status(), 200);
  assert.equal((await profile('en')).notes, 'Only B');
  await login(users[0]); assert.equal((await profile('en')).notes, '');
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(api + '/coach/profile?telegramId=' + users[0])).status(), 401);
  assert.equal((await anonymous.request.post(api + '/tutor/ask', { data: { telegramId: users[0], messages: [{ role: 'user', content: 'test' }] } })).status(), 401);
  await anonymous.close();
  record('account B isolation, session-only identity despite spoofed IDs; anonymous requests rejected');
  assert.deepEqual(errors, []);
  record('no browser page errors');
} finally {
  fs.writeFileSync(path.join(out, controlsOnly ? 'controls-result.json' : 'result.json'), JSON.stringify({ ...result, errors }, null, 2));
  db(`for(const telegramId of ${JSON.stringify(users)}){const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(telegramId);}`);
  await browser.close();
}
