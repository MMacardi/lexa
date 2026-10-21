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
const otherUser = user + '-other';
const settingsOnly = process.argv.includes('--settings-only');
const settingsQuotaOnly = settingsOnly || process.argv.includes('--settings-quota-only');
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
  const readyBy = Date.now() + 90_000;
  while (true) {
    try {
      const results = await Promise.all([fetch(app + '/reader', { signal: AbortSignal.timeout(10_000) }), fetch('http://localhost:3000/health', { signal: AbortSignal.timeout(10_000) })]);
      if (results.every(r => r.ok)) break;
    } catch {}
    assert.ok(Date.now() < readyBy, 'local frontend and backend are ready');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
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
    if (!sessionStorage.getItem('tap.seeded')) localStorage.setItem('lexa.glossCache', JSON.stringify({
      ['v2|' + JSON.stringify(['zh', 'ru', '学校', '我去学校。'])]: { gloss: 'STALE AI ANSWER', tr: 'wrong' },
    }));
    sessionStorage.setItem('tap.seeded', '1');
  });
  await page.route('**/api/gloss', async route => {
    const data = route.request().postDataJSON();
    requests.push(data);
    await route.fulfill({ json: { gloss: data.contextual ? `Контекст: ${data.sentence}` : 'Контрольный ответ ИИ', transcription: '' } });
  });
  const dialog = word => page.getByRole('dialog', { name: word, exact: true });
  async function settings() {
    await page.goto(app + '/account', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Ещё настройки', exact: true }).click();
    const section = page.getByTestId('tap-meaning-settings');
    await section.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity));
    await section.scrollIntoViewIfNeeded();
    return section;
  }
  let section;
  if (!settingsQuotaOnly) {
  await page.goto(app + '/reader', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('textarea').filter({ visible: true }).first().fill(`我去学校。打篮球。${gap}。`);
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
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
  await page.evaluate(() => localStorage.removeItem('lexa.glossCache'));
  section = await settings();
  assert.equal(await section.getByRole('button', { name: 'Словарь', exact: true }).getAttribute('aria-pressed'), 'true');
  await section.getByRole('button', { name: 'ИИ в контексте', exact: true }).click();
  await section.getByRole('button', { name: 'ИИ в контексте', exact: true }).getAttribute('aria-pressed').then(value => assert.equal(value, 'true'));
  await page.screenshot({ path: path.join(out, 'phone-settings.png'), animations: 'disabled' });
  section = await settings();
  assert.equal(await section.getByRole('button', { name: 'ИИ в контексте', exact: true }).getAttribute('aria-pressed'), 'true', 'selection survives reload');
  const school = db(`const u=await db.user.findUniqueOrThrow({where:{telegramId:${JSON.stringify(user)}}});
    const w=await db.word.create({data:{userId:u.id,word:'学校',sourceLang:'zh',targetLang:'ru',meaningZh:'школа',phonetic:'xué xiào',autoExamples:false,collocations:[],synonyms:[],antonyms:[]}});console.log(w.id);`);
  await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
  await page.locator('textarea').filter({ visible: true }).first().fill('我去学校。学校很大。打篮球。');
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
  for (const [index, sentence] of ['我去学校。', '学校很大。'].entries()) {
    await page.getByRole('button', { name: '学校', exact: true }).nth(index).click();
    await dialog('学校').getByText(`Контекст: ${sentence}`, { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await dialog('学校').waitFor({ state: 'detached' });
  }
  assert.equal(requests.length, 3, 'same saved word in different sentences gets separate AI answers');
  await page.getByRole('button', { name: '学校', exact: true }).first().click();
  await dialog('学校').getByText('Контекст: 我去学校。', { exact: true }).waitFor();
  assert.equal(requests.length, 3, 'repeat contextual answer is cached');
  await page.keyboard.press('Escape'); await dialog('学校').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '打', exact: true }).first().click();
  await dialog('打').getByText('Контекст: 打篮球。', { exact: true }).waitFor();
  assert.equal(requests.length, 4, 'unsaved dictionary word also uses selected AI mode');
  await page.keyboard.press('Escape');
  await page.evaluate(id => sessionStorage.setItem('lexa.reviewFocusIds', JSON.stringify([id])), card);
  await page.goto(app + '/review', { waitUntil: 'domcontentloaded' });
  await page.locator('.flip-card').waitFor();
  await page.locator('.flip-card').click({ position: { x: 30, y: 35 } });
  await page.locator('.flip-card.is-flipped').waitFor();
  await page.locator('.flip-back [data-ci="2"]').first().click();
  await dialog('学校').getByText('Контекст: 我去学校。', { exact: true }).waitFor();
  assert.equal(requests.length, 4, 'card example shares contextual cache, including owned words');
  assert.equal((await ctx.request.get(api + '/words/' + school).then(r => r.json())).meaningZh, 'школа', 'contextual viewing never edits the card');
  record('AI setting: persistence, saved/unsaved words, distinct sentences, cached Reader/card answers, saved card untouched');
  } else {
    section = await settings();
    assert.equal(await section.getByRole('button', { name: 'Словарь', exact: true }).getAttribute('aria-pressed'), 'true');
    await section.getByRole('button', { name: 'ИИ в контексте', exact: true }).click();
    await page.screenshot({ path: path.join(out, 'phone-settings.png'), animations: 'disabled' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    record('Phone settings: dictionary default, AI selection and width pass');
  }
  if (!settingsOnly) {
  const priorRequests = requests.length;
  const otherCtx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block' });
  try {
    // Carry A's preference into B's storage without bypassing the app's logout flow.
    await otherCtx.addInitScript(key => { localStorage.setItem('lexa.locale', 'ru'); localStorage.setItem(key, 'ai'); }, `lexa.tapMeaningMode:${user}`);
    assert.equal((await otherCtx.request.post(api + '/auth/dev', { data: { telegramId: otherUser } })).status(), 200);
    db(`await db.user.update({where:{telegramId:${JSON.stringify(otherUser)}},data:{invited:true,nativeLang:'ru',hskTarget:4}});`);
    const otherPage = await otherCtx.newPage();
    await otherPage.goto(app + '/account', { waitUntil: 'domcontentloaded' });
    await otherPage.getByRole('button', { name: 'Ещё настройки', exact: true }).click().catch(async error => {
      console.error((await otherPage.locator('body').innerText()).slice(0, 600)); throw error;
    });
    assert.equal(await otherPage.getByTestId('tap-meaning-settings').getByRole('button', { name: 'Словарь', exact: true }).getAttribute('aria-pressed'), 'true', 'other account ignores A preference and defaults to dictionary');
  } finally { await otherCtx.close(); }
  section = await settings();
  assert.equal(await section.getByRole('button', { name: 'ИИ в контексте', exact: true }).getAttribute('aria-pressed'), 'true');
  await section.getByRole('button', { name: 'Словарь', exact: true }).click();
  await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
  await page.locator('textarea').filter({ visible: true }).first().fill('打篮球。');
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
  await page.getByRole('button', { name: '打', exact: true }).first().click();
  await dialog('打').getByText(entries['打'].meaning, { exact: true }).waitFor();
  assert.equal(requests.length, priorRequests, 'switching back uses dictionary without requesting AI');
  record('Account isolation and switching back to dictionary pass');
  const headers = { 'X-Simulate-Free': '1' };
  const usage = () => ctx.request.get(api + '/ai/usage', { headers }).then(r => r.json());
  const startUsage = await usage();
  const payload = { word: '学校', sentence: '我去学校。', sourceLang: 'zh', targetLang: 'ru', contextual: true };
  const paid = await ctx.request.post(api + '/gloss', { headers, data: payload });
  assert.equal(paid.status(), 200); assert.ok((await paid.json()).gloss);
  assert.equal((await usage()).used, startUsage.used + 1, 'fresh contextual answer uses one daily action');
  db(`const key='d:'+${JSON.stringify(user)}+':'+Math.floor(Date.now()/86400000);await db.usageCounter.update({where:{key},data:{count:${startUsage.limit}}});`);
  const blocked = await ctx.request.post(api + '/gloss', { headers, data: payload });
  assert.equal(blocked.status(), 429); assert.equal((await blocked.json()).code, 'ai_quota');
  const defaultRequest = await ctx.request.post(api + '/gloss', { headers, data: { ...payload, contextual: false } });
  assert.equal(defaultRequest.status(), 200); assert.equal((await defaultRequest.json()).gloss, entries['学校'].meaning, 'omitting AI mode returns dictionary, never an unmetered contextual answer');
  assert.equal((await ctx.request.get(api + '/dict?word=' + encodeURIComponent('学校') + '&lang=ru', { headers })).status(), 200);
  const freeGap = await ctx.request.post(api + '/gloss', { headers, data: { ...payload, word: gap, sentence: gap + '。', contextual: false } });
  assert.equal(freeGap.status(), 200); assert.ok((await freeGap.json()).gloss);
  assert.equal((await usage()).used, startUsage.limit, 'dictionary gap remains free when allowance is exhausted');
  assert.deepEqual(errors, []);
  record('Real server: contextual AI spends allowance; omission cannot bypass exhausted cap; dictionary and gap fallback stay free');
  section = await settings();
  await section.getByRole('button', { name: 'ИИ в контексте', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('lexa.simulateFree', '1'));
  await page.unroute('**/api/gloss');
  await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
  await page.locator('textarea').filter({ visible: true }).first().fill('我喜欢这所学校。');
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
  await page.getByRole('button', { name: '学校', exact: true }).first().click();
  await page.getByRole('button', { name: 'Посмотреть Pro', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Не сейчас', exact: true }).click();
  await dialog('学校').getByText('школа', { exact: true }).waitFor();
  await dialog('学校').getByText('На сегодня бесплатные ИИ-действия закончились. Pro снимает лимит.', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  record('Exhausted AI allowance: real phone upsell and localized message; dictionary meaning remains readable');
  }
  const resultName = settingsOnly ? 'settings-result.json' : settingsQuotaOnly ? 'quota-result.json' : 'result.json';
  fs.writeFileSync(path.join(out, resultName), JSON.stringify({ checks, requests, errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ url: page.url(), dialogs: await page.getByRole('dialog').allTextContents().catch(() => []), requests, errors }));
  throw error;
} finally {
  await ctx.close();
  await browser.close();
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');for(const id of ${JSON.stringify([user, otherUser])}) await deleteAccount(id);
    if(await db.user.count({where:{telegramId:{in:${JSON.stringify([user, otherUser])}}}})) throw new Error('Test cleanup failed');`);
}
