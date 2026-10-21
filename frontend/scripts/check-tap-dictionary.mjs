// One local phone flow: real dictionary/deck, controlled AI fallback for gaps only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli', 'tap-dictionary');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, devices } = await import('../node_modules/playwright-core/index.mjs');
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
const user = `tap-dictionary-${Date.now()}`;
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8',
    input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
const browser = await chromium.launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block' });
const page = await ctx.newPage(), errors = [], requests = [], checks = [];
page.setDefaultTimeout(30_000);
page.on('pageerror', error => errors.push(error.message));
const record = text => { checks.push(text); console.log('PASS ' + text); };
try {
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
  const card = db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4}});
    const w=await db.word.create({data:{userId:u.id,word:'中文',sourceLang:'zh',targetLang:'ru',phonetic:'zhōng wén',meaningZh:'китайский язык',
    autoExamples:false,exampleStatus:'ready',collocations:[],synonyms:[],antonyms:[],
    examples:{create:{sentenceEn:'我去学校。',sentenceZh:'Я иду в школу.',sourceName:'Manual entry',sourceUrl:''}}}});console.log(w.id);`);
  const entries = {};
  for (const word of ['学校', '打']) {
    const res = await ctx.request.get(api + '/dict?word=' + encodeURIComponent(word) + '&lang=ru');
    assert.equal(res.status(), 200);
    entries[word] = (await res.json()).entry;
  }
  assert.ok(entries['学校']?.meaning);
  assert.ok(entries['打']?.meaning);
  assert.equal(entries['打'].settled, false, 'multiple senses still use the dictionary');
  let gap;
  for (const word of ['氯化钠', '碳纤维', '硅胶', '氢氧化钠', '咔嚓']) {
    const { entry } = await ctx.request.get(api + '/dict?word=' + encodeURIComponent(word) + '&lang=ru').then(r => r.json());
    const { tokens } = await ctx.request.post(api + '/segment', { data: { text: word + '。' } }).then(r => r.json());
    if (!entry?.meaning && tokens.some(t => t.text === word && t.wordLike)) { gap = word; break; }
  }
  assert.ok(gap, 'fixture must lack a Russian meaning and remain one tappable token');
  await ctx.addInitScript(() => {
    localStorage.setItem('lexa.locale', 'ru');
    localStorage.setItem('lexa.wordPair', JSON.stringify({ sourceLang: 'zh', targetLang: 'ru' }));
    localStorage.setItem('lexa.autoGloss', '1');
    localStorage.setItem('lexa.showTextLevel', '0');
    localStorage.setItem('lexa.glossCache', JSON.stringify({
      ['v2|' + JSON.stringify(['zh', 'ru', '学校', '我去学校。'])]: { gloss: 'STALE AI ANSWER', tr: 'wrong' },
    }));
  });
  await page.route('**/api/gloss', async route => {
    const data = route.request().postDataJSON();
    requests.push(data);
    await route.fulfill({ json: { gloss: 'Контрольный ответ ИИ', transcription: '' } });
  });
  await page.goto(app + '/reader', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('textarea').filter({ visible: true }).first().fill(`我去学校。打篮球。${gap}。`);
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
  const dialog = word => page.getByRole('dialog', { name: word, exact: true });
  for (const word of ['学校', '打']) {
    await page.getByRole('button', { name: word, exact: true }).first().click();
    await dialog(word).getByText(entries[word].meaning, { exact: true }).waitFor();
    assert.ok(!(await dialog(word).innerText()).includes('STALE AI ANSWER'));
    assert.equal(requests.length, 0, 'dictionary word must not request AI');
    await page.keyboard.press('Escape');
    await dialog(word).waitFor({ state: 'detached' });
  }
  record('Reader: HSK and multiple-sense meanings come from real dictionary; old AI cache ignored; zero AI requests');
  await page.getByRole('button', { name: gap, exact: true }).first().click();
  await dialog(gap).getByText('Контрольный ответ ИИ', { exact: true }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].word, gap);
  assert.ok(requests[0].sentence.includes(gap));
  await page.keyboard.press('Escape');
  await dialog(gap).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: gap, exact: true }).first().click();
  await dialog(gap).getByText('Контрольный ответ ИИ', { exact: true }).waitFor();
  assert.equal(requests.length, 1, 'repeat fallback uses its cache');
  record('Reader: missing Russian meaning uses contextual AI pipeline; repeat tap uses cache');
  await page.keyboard.press('Escape');
  await page.evaluate(id => sessionStorage.setItem('lexa.reviewFocusIds', JSON.stringify([id])), card);
  await page.goto(app + '/review', { waitUntil: 'domcontentloaded' });
  await page.locator('.flip-card').waitFor();
  await page.locator('.flip-card').click({ position: { x: 30, y: 35 } });
  await page.locator('.flip-card.is-flipped').waitFor();
  await page.locator('.flip-back [data-ci="2"]').first().click();
  await dialog('学校').getByText(entries['学校'].meaning, { exact: true }).waitFor();
  assert.equal(requests.length, 1, 'card example must not request AI for dictionary word');
  assert.ok(!(await dialog('学校').innerText()).includes('STALE AI ANSWER'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  record('Card example: real dictionary meaning, no extra AI request, phone width and browser errors pass');
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ checks, requests, errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ url: page.url(), dialogs: await page.getByRole('dialog').allTextContents().catch(() => []), requests, errors }));
  throw error;
} finally {
  await ctx.close();
  await browser.close();
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});
    if(await db.user.count({where:{telegramId:${JSON.stringify(user)}}})) throw new Error('Test cleanup failed');`);
}
