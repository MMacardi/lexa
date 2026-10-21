// One Russian phone flow; real local dictionary with controlled translation latency.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), out = path.join(root, '.playwright-cli', 'dictionary-meanings');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, devices } = await import('../node_modules/playwright-core/index.mjs');
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
const user = `dictionary-phone-${Date.now()}`;
const phase = process.argv.includes('--detail-only') ? 'detail' : process.argv.includes('--recovery-only') ? 'recovery' : process.argv.includes('--review-reader-only') ? 'review-reader' : 'all';
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
const browser = await chromium.launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block' });
const errors = [];
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', e => errors.push(e.message));
try {
  await ctx.addInitScript(() => {
    localStorage.setItem('lexa.locale', 'ru');
    localStorage.setItem('lexa.wordPair', JSON.stringify({ sourceLang: 'zh', targetLang: 'ru' }));
    localStorage.setItem('lexa.exampleStyle', 'none');
    localStorage.setItem('lexa.autoGloss', '1');
    localStorage.setItem('lexa.showTextLevel', '0');
  });
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
  db(`await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});`);
  const actual = await ctx.request.post(api + '/dict/glosses', { data: { words: ['照镜子'], lang: 'ru' } }).then(r => r.json());
  const careful = await ctx.request.get(api + '/dict/lookup?q=' + encodeURIComponent('仔细') + '&lang=ru').then(r => r.json());
  const carefulMeaning = careful.hits.find(h => h.word === '仔细').meaning;
  const translated = actual.meanings['照镜子']; assert.ok(translated);
  if (phase === 'detail') {
    assert.match(translated, /смотр|гляд/i);
    const card = await ctx.request.post(api + '/words', { data: { word: '照镜子', sourceLang: 'zh', targetLang: 'ru', exampleStyle: 'none' } }).then(r => r.json());
    assert.equal(card.meaningZh, translated);
    await page.goto(app + '/word/' + card.id, { waitUntil: 'domcontentloaded' });
    await page.getByText(translated, { exact: true }).nth(1).waitFor();
    assert.equal(await page.getByText(/это ни одно из значений/).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(out, 'phone-detail.png'), fullPage: true });
    console.log('PASS phone-chromium detail: complete Russian action gloss, same card/dictionary wording');
  } else {
  let created, attempts = 0;
  if (phase !== 'recovery') {
  if (phase === 'all') {
  // Force the uncached frontend state while keeping the real backend translation.
  await page.route('**/api/dict/lookup?*', async route => {
    const response = await route.fetch(), data = await response.json();
    if (new URL(route.request().url()).searchParams.get('q') === '照镜子') {
      data.hits = data.hits.filter(h => h.word === '照镜子').map(h => ({ ...h, english: true, meaning: 'to look in the mirror' }));
    }
    await route.fulfill({ response, json: data });
  });
  let held;
  await page.route('**/api/dict/glosses', async route => {
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 502, json: { error: 'Controlled translation failure' } });
    held = route;
  });
  await page.goto(app + '/words', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Добавить слово/ }).filter({ visible: true }).first().click();
  const input = page.getByPlaceholder('Слово или значение').filter({ visible: true });
  await input.fill('照镜子');
  const row = word => page.getByTestId('lookup-row').filter({ hasText: word }).filter({ visible: true });
  await row('照镜子').getByText('Не удалось загрузить значение', { exact: true }).waitFor();
  assert.ok(!(await row('照镜子').innerText()).includes('to look'));
  await row('照镜子').getByRole('button', { name: 'Повторить', exact: true }).click();
  await row('照镜子').getByText('Пишем значение на вашем языке…', { exact: true }).waitFor();
  assert.ok(!(await row('照镜子').innerText()).includes('to look'));
  await page.screenshot({ path: path.join(out, 'phone-loading.png') });
  await input.fill('仔细');
  await row('仔细').getByText(carefulMeaning, { exact: true }).waitFor();
  assert.equal(await row('照镜子').count(), 0, 'previous query disappears immediately');
  assert.ok(held); await held.fulfill({ json: actual });
  assert.equal(await row('照镜子').count(), 0, 'late translation cannot replace next query');
  assert.ok(!(await row('仔细').innerText()).includes(translated));
  await input.fill('照镜子');
  await row('照镜子').getByText(translated, { exact: true }).waitFor();
  const createdResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/words');
  await row('照镜子').getByRole('button').first().click();
  created = await (await createdResponse).json();
  assert.ok(created.id, JSON.stringify(created)); assert.equal(created.meaningZh, translated);
  await page.goto(app + '/word/' + created.id, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '照镜子', exact: true }).waitFor();
  await page.getByText(translated, { exact: true }).first().waitFor();
  await page.locator('span[lang="ru"]').filter({ hasText: translated }).first().waitFor();
  assert.ok((await ctx.request.post(api + '/words/' + created.id + '/senses').then(r => r.json())).senses.some(s => s.onCard));
  assert.equal(await page.getByText(/это ни одно из значений/).count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(out, 'phone-detail.png'), fullPage: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText(translated, { exact: true }).nth(1).waitFor();
  assert.equal((await ctx.request.get(api + '/words/' + created.id).then(r => r.json())).meaningZh, translated);
  console.log('PASS phone add/detail: loading/failure/retry, stale query, real dictionary, reload, bounds');
  } else {
    created = await ctx.request.post(api + '/words', { data: { word: '照镜子', sourceLang: 'zh', targetLang: 'ru', exampleStyle: 'none' } }).then(r => r.json());
    await page.goto(app + '/words', { waitUntil: 'domcontentloaded' });
  }
  await page.evaluate(id => sessionStorage.setItem('lexa.reviewFocusIds', JSON.stringify([id])), created.id);
  await page.goto(app + '/review', { waitUntil: 'domcontentloaded' });
  await page.locator('.flip-card').waitFor();
  await page.locator('.flip-card').click({ position: { x: 35, y: 40 } });
  await page.locator('.flip-card.is-flipped').waitFor();
  await page.locator('.flip-back').getByText(translated, { exact: true }).waitFor();
  assert.ok((await page.locator('.flip-back').innerText()).includes(translated));
  assert.ok(!(await page.locator('.flip-back').innerText()).includes('to look in the mirror'));
  // Reader translation failure must keep pinyin + localized failure/retry, without English.
  await page.route('**/api/gloss', route => route.fulfill({ status: 502, json: { error: 'Controlled gloss failure' } }));
  await page.route('**/api/dict?*', async route => {
    const response = await route.fetch(), data = await response.json();
    if (data.entry) data.entry.meaning = null;
    await route.fulfill({ response, json: data });
  });
  await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
  await page.locator('textarea').filter({ visible: true }).first().fill('电饭锅。');
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
  await page.getByRole('button', { name: '电饭锅', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '电饭锅', exact: true });
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).waitFor();
  assert.ok(!(await dialog.innerText()).match(/rice cooker|electric rice/i));
  assert.equal((await ctx.request.delete(api + '/words/' + created.id)).status(), 200);
  } else await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
  const failedId = db(`const user=await db.user.findUniqueOrThrow({where:{telegramId:${JSON.stringify(user)}}});
    const word=await db.word.create({data:{userId:user.id,word:'照镜子',sourceLang:'zh',targetLang:'ru',phonetic:'zhào jìng zi',
    meaningZh:'to look in the mirror',enrichmentStatus:'failed',autoExamples:false,collocations:[],synonyms:[],antonyms:[]}});console.log(word.id);`);
  assert.ok(failedId);
  await page.goto(app + '/review', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Начать — 1 карточка/ }).click();
  await page.locator('.flip-card').waitFor();
  await page.locator('.flip-card').click({ position: { x: 35, y: 40 } });
  const back = page.locator('.flip-back');
  await back.getByText('Не удалось загрузить значение', { exact: true }).waitFor();
  assert.ok(!(await back.innerText()).includes('to look in the mirror'));
  await back.getByRole('button', { name: 'Повторить', exact: true }).click();
  await back.getByText(translated, { exact: true }).waitFor({ timeout: 60000 });
  assert.ok(!(await back.innerText()).includes('to look in the mirror'));
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ word: '照镜子', meaning: translated,
    carefulMeaning, attempts, phase, errors }, null, 2));
  console.log(`PASS phone-chromium ${phase}: ${phase === 'recovery' ? 'failed Russian review placeholder, retry and live meaning update' : 'Russian meaning, review, Reader failure and recovery'}`);
  }
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
  await ctx.close(); await browser.close();
}
