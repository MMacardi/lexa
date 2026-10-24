// Local Russian phone check: real Qwen Reader access after a mistaken denial,
// default titles, editing, late autosave, and the duplicate-card layout.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli/reader-context-followup');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli/browsers');
const { chromium, devices } = await import('../node_modules/playwright-core/index.mjs');
const db = code => execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
  cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
}).trim();
const api = 'http://localhost:3000/api', app = 'http://localhost:3001';
const user = `reader-context-followup-${Date.now()}`;
const source = 'A 让被批评的人不觉得难受，而且能感觉到是在帮助他\nB 例如批评人的时候要考虑用正确的方法\nC 管理是一门艺术';
const falseHistory = [
  { role: 'user', content: 'Прочитай мой текст в Читалке.' },
  { role: 'assistant', content: 'Я могу работать только с текстом, который ты отправляешь в чат. Если текст открыт в Reader, я его не вижу. Скопируй его сюда.' },
];
const browser = await chromium.launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block' });
const page = await ctx.newPage(), errors = [], evidence = {};
page.setDefaultTimeout(25000);
page.on('pageerror', e => errors.push(e.message));
const post = async (url, data, method = 'post') => {
  const r = await ctx.request[method](api + url, { data, timeout: 90000 });
  assert(r.ok(), `${r.status()} ${await r.text()}`);
  return r.json();
};
const original = () => page.locator('div.whitespace-pre-wrap').filter({ has: page.locator('[data-reader-unit]') });
async function newText(text) {
  await page.locator('textarea').filter({ visible: true }).first().fill(text);
  const saved = page.waitForResponse(r => r.url().endsWith('/api/reader/texts') && r.request().method() === 'POST', { timeout: 60000 });
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
  await original().waitFor();
  const r = await saved;
  assert.equal(r.status(), 201, await r.text());
  return r.json();
}
async function edit() {
  await page.getByRole('button', { name: 'Инструменты чтения', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить текст', exact: true }).click();
  await page.getByRole('heading', { name: 'Редактировать текст', exact: true }).waitFor();
}
try {
  await post('/auth/dev', { telegramId: user });
  const card = db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});
    const w=await db.word.create({data:{userId:u.id,word:'组织',sourceLang:'zh',targetLang:'ru',phonetic:'zǔ zhī',meaningZh:'организация; организовывать',autoExamples:false,exampleStatus:'disabled',familyAt:new Date()}});console.log(w.id);`);
  const other = await post('/reader/texts', { title: 'Другой текст', content: '明天我们去北京。', sourceLang: 'zh', targetLang: 'ru', autosave: true });
  await post('/tutor/chats/followuphistory', { messages: falseHistory }, 'put');
  await ctx.addInitScript(({ user, falseHistory }) => {
    localStorage.setItem('lexa.locale', 'ru');
    localStorage.setItem('lexa.autoGloss', '0');
    localStorage.setItem('lexa.showTextLevel', '0');
    localStorage.setItem('lexa.exampleStyle', 'none');
    if (!sessionStorage.getItem('followup-seeded')) {
      sessionStorage.setItem('followup-seeded', '1');
      sessionStorage.setItem('lexa.tutorChatOwner', user);
      sessionStorage.setItem('lexa.tutorChatId', 'followuphistory');
      sessionStorage.setItem('lexa.tutorChat', JSON.stringify(falseHistory));
    }
  }, { user, falseHistory });
  if (!process.argv.includes('--layout-only')) {
  if (!process.argv.includes('--navigation-only')) {
  await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
  const saved = await newText(source);
  assert.notEqual(saved.title, source.replace(/\s+/g, ' ').slice(0, 40));
  assert(!/^[ABC]\s/.test(saved.title), saved.title);
  assert(saved.title.length > 0 && saved.title.length <= 120);
  evidence.title = saved.title;
  const repeated = await post('/reader/texts', { title: '', content: source, sourceLang: 'zh', targetLang: 'ru', autosave: true });
  assert.equal(repeated.id, saved.id);
  assert.equal(repeated.title, saved.title);
  await page.screenshot({ path: path.join(out, 'phone-reader.png'), fullPage: true, animations: 'disabled' });
  await original().getByRole('button', { name: '难受', exact: true }).click();
  await page.getByRole('button', { name: /Обсудить с Микой/ }).click();
  await page.getByText('Мика видит весь текст из Читалки', { exact: true }).filter({ visible: true }).waitFor();
  const input = page.getByPlaceholder('Спроси или добавь фото…').filter({ visible: true });
  await input.fill('Расставь предложения A, B, C из Читалки в связный текст. Назови порядок букв и коротко объясни. Ты видишь весь текст или только выделенное слово?');
  const answer = page.waitForResponse(r => r.url().endsWith('/api/tutor/ask') && r.request().method() === 'POST', { timeout: 180000 });
  await input.press('Enter');
  const response = await answer;
  const records = (await response.text()).trim().split('\n').map(s => JSON.parse(s));
  const result = records.find(r => r.type === 'final')?.result;
  assert(result, JSON.stringify(records));
  const request = response.request().postDataJSON();
  evidence.answer = result.answer;
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(evidence, null, 2));
  assert.equal(request.readerContext.content, source);
  assert.equal(request.readerContext.selection, '难受');
  assert(request.messages.some(m => m.content === falseHistory[1].content));
  assert.match(result.answer, /C\s*[→—–,\-]\s*B\s*[→—–,\-]\s*A|CBA|C, B, A/);
  assert.doesNotMatch(result.answer, /не вижу|не могу (?:видеть|прочитать)|вижу только|скопируй|пришли (?:весь|полный) текст/i);
  evidence.answer = result.answer;
  await page.waitForFunction(() => !document.querySelector('textarea:disabled'));
  await page.screenshot({ path: path.join(out, 'phone-mika.png'), fullPage: true, animations: 'disabled' });
  console.log('PASS live Qwen: full passage + selected word after an earlier false denial; C → B → A');
  await page.getByRole('link', { name: 'Открыть на весь экран', exact: true }).click();
  await page.waitForURL(app + '/mika');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Мика видит весь текст из Читалки', { exact: true }).filter({ visible: true }).waitFor();

  await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
  // The reading view survives the visit to Mika. Open the editor of that same row.
  if (await page.getByRole('button', { name: /Обсудить с Микой/ }).count() === 0) {
    await page.getByRole('button').filter({ hasText: saved.title }).first().click();
  }
  await edit();
  const title = page.getByRole('textbox', { name: 'Название', exact: true });
  assert.equal(await title.inputValue(), saved.title);
  await page.getByRole('button', { name: 'Пусть ИИ придумает название', exact: true }).click();
  assert.equal(await title.inputValue(), '');
  const updated = page.waitForResponse(r => r.url().endsWith('/api/reader/texts/' + saved.id) && r.request().method() === 'PUT', { timeout: 60000 });
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  const renamed = await updated;
  assert.equal(renamed.status(), 200, await renamed.text());
  evidence.regeneratedTitle = (await renamed.json()).title;
  await page.getByRole('heading', { name: 'Редактировать текст', exact: true }).waitFor({ state: 'hidden' });
  await edit();
  await title.fill('Моё название');
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await page.getByRole('heading', { name: 'Редактировать текст', exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await (await ctx.request.get(api + '/reader/texts/' + saved.id)).json()).title, 'Моё название');
  console.log('PASS default AI naming, deduplication, explicit title, and AI rename in the editor');
  } else {
    await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button').filter({ hasText: 'Другой текст' }).first().click();
  }

  // Delay a real local save response until another saved passage is open.
  await page.getByRole('button', { name: 'Новый текст', exact: true }).click();
  const held = Promise.withResolvers(), release = Promise.withResolvers();
  const saveRoute = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const data = route.request().postDataJSON();
    const r = await route.fetch({ postData: JSON.stringify({ ...data, autoName: false }) });
    held.resolve();
    await release.promise;
    await route.fulfill({ response: r });
  };
  await page.route('**/api/reader/texts', saveRoute);
  const lateSave = newText('今天我学习汉语。');
  await held.promise;
  await page.getByRole('button', { name: 'Новый текст', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Другой текст' }).first().click();
  release.resolve();
  await lateSave;
  await page.unroute('**/api/reader/texts', saveRoute);
  await edit();
  assert.equal(await page.getByRole('textbox', { name: 'Название', exact: true }).inputValue(), 'Другой текст');
  // Navigate away after checking the editor; no changes were submitted.
  assert.equal((await (await ctx.request.get(api + '/reader/texts/' + other.id)).json()).title, 'Другой текст');
  console.log('PASS delayed autosave cannot replace the metadata of a subsequently opened passage');
  }

  await page.goto(app + '/words?mode=manual', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Добавить слово', exact: true }).filter({ visible: true }).click();
  const form = page.locator('form').filter({ has: page.getByPlaceholder(/Значение .*обязательно/) }).filter({ visible: true });
  await form.locator('input').first().fill('组织');
  await form.getByPlaceholder(/Значение .*обязательно/).fill('организация; организовывать');
  await form.locator('button[type=submit]').click();
  const dialog = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Такое слово уже есть', exact: true }) });
  const open = dialog.getByRole('button', { name: /Открыть карточку/ });
  await open.waitFor();
  const layout = await open.evaluate(el => {
    const [label, word, meaning] = [el.querySelector('span > span'), el.children[1], el.children[2]];
    return { font: getComputedStyle(label).fontFamily, size: getComputedStyle(label).fontSize,
      stacked: word.getBoundingClientRect().top >= label.getBoundingClientRect().bottom && meaning.getBoundingClientRect().top >= word.getBoundingClientRect().bottom };
  });
  assert.equal(layout.stacked, true);
  assert.equal(layout.size, '15px');
  assert(await open.getByText('组织 · zǔ zhī', { exact: true }).count());
  assert(await open.getByText('организация; организовывать', { exact: true }).count());
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(out, 'phone-duplicate.png'), fullPage: true, animations: 'disabled' });
  await open.click();
  await page.waitForURL(app + '/word/' + card);
  assert.deepEqual(errors, []);
  evidence.layout = layout;
  const resultFile = process.argv.includes('--navigation-only') ? 'navigation-result.json' : process.argv.includes('--layout-only') ? 'layout-result.json' : 'result.json';
  fs.writeFileSync(path.join(out, resultFile), JSON.stringify(evidence, null, 2));
  console.log('PASS Russian phone duplicate layout and correct saved-card destination; no page errors/overflow');
} catch (e) {
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
}
