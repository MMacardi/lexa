// Local Docker only. Hold this run's jobs to inspect pending UI, then let the real worker finish.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const out = path.join(root, '.playwright-cli', 'example-progress');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, webkit, firefox, devices } = await import('../node_modules/playwright-core/index.mjs');
const configs = [
  { name: 'phone-chromium', engine: chromium, viewport: { width: 360, height: 780 }, hasTouch: true },
  { name: 'desktop-chromium', engine: chromium, viewport: { width: 1280, height: 900 } },
  { name: 'phone-webkit', engine: webkit, ...devices['iPhone 13'] },
  { name: 'phone-firefox', engine: firefox, viewport: { width: 390, height: 844 }, hasTouch: true },
];
const api = 'http://localhost:3000/api';
const app = 'http://localhost:3001';
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8',
    input: `import {prisma as db} from './dist/services/db.js'; try {${code}} finally {await db.$disconnect()}`,
  }).trim();
}
for (const config of configs.filter((c) => !process.argv[2] || c.name === process.argv[2])) {
  const { name, engine, ...options } = config;
  const browser = await engine.launch({ headless: true, downloadsPath: out });
  const ctx = await browser.newContext({ ...options, locale: 'ru-RU', serviceWorkers: 'block' });
  const user = `example-ui-${name}-${Date.now()}`;
  const jobs = [];
  const errors = [];
  const cancelledRequests = [];
  const failedRequests = [];
  const pendingChunks = new Set();
  const posts = [];
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (e) => {
    // WebKit reports local resource loads cancelled by navigation this way.
    if (/localhost:(3000|3001).*due to access control checks\.$/.test(e.message)) cancelledRequests.push(e.message);
    else errors.push(e.message);
  });
  page.on('request', (r) => { if (r.url().includes('/_next/static/') && r.url().includes('.js')) pendingChunks.add(r); });
  page.on('requestfinished', (r) => pendingChunks.delete(r));
  page.on('requestfailed', (r) => { pendingChunks.delete(r); failedRequests.push({ url: r.url(), error: r.failure()?.errorText }); });
  async function go(url) {
    // Finish lazy component loads before the next deliberate full navigation.
    // API polling intentionally continues while a job is held.
    let quiet = Date.now();
    for (let i = 0; i < 100; i++) {
      if (pendingChunks.size) quiet = Date.now();
      if (Date.now() - quiet > 500) break;
      await page.waitForTimeout(100);
    }
    assert.equal(pendingChunks.size, 0, 'lazy chunks loaded before navigation');
    try { await page.goto(app + url, { waitUntil: 'domcontentloaded' }); }
    catch (e) {
      if (!/NS_BINDING_ABORTED|ERR_ABORTED|interrupted by another navigation/.test(e.message)) throw e;
      await page.goto(app + url, { waitUntil: 'domcontentloaded' });
    }
  }
  async function hold(r) {
    if (!r.job) return;
    const key = JSON.stringify(r.job.id);
    const claimed = JSON.parse(db(`const claim=await db.importJob.updateMany({where:{id:${key},status:'queued'},data:{status:'processing',leaseUntil:new Date(Date.now()+600000)}});const j=await db.importJob.findUniqueOrThrow({where:{id:${key}}});console.log(JSON.stringify({held:claim.count===1,cards:j.cards}));`));
    const cards = claimed.cards;
    const ids = cards.map((c) => c.id);
    if (!claimed.held) {
      // The worker can win the race to the response interceptor. Let it finish,
      // then restore this test's initial examples and hold its replay instead.
      for (let i = 0; i < 90; i++) {
        const state = await ctx.request.get(api + '/words/import/' + r.job.id).then((s) => s.json());
        if (state.status === 'completed' || state.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      db(`await db.importJob.update({where:{id:${key}},data:{status:'processing',processed:0,errors:[],completedAt:null,leaseUntil:new Date(Date.now()+600000)}});await db.example.deleteMany({where:{wordId:{in:${JSON.stringify(ids)}},sourceName:'Onomika AI',id:{notIn:${JSON.stringify(r.examples?.map((e) => e.id) ?? [])}}}});`);
    }
    db(`await db.word.updateMany({where:{id:{in:${JSON.stringify(ids)}},exampleStatus:{not:'disabled'}},data:{enrichmentStatus:'generating',exampleStatus:'generating',createdAt:new Date(Date.now()-180000)}});`);
    jobs.push({ id: r.job.id, cards, started: Date.now() });
  }
  async function release(job) {
    db(`await db.importJob.update({where:{id:${JSON.stringify(job.id)}},data:{status:'processing',leaseUntil:new Date(Date.now()-1000)}});`);
    for (let i = 0; i < 90; i++) {
      const state = await ctx.request.get(api + '/words/import/' + job.id).then((r) => r.json());
      if (state.status === 'completed' || state.status === 'failed') {
        assert.equal(state.status, 'completed'); assert.deepEqual(state.errors, []); return;
      }
      await page.waitForTimeout(1000);
    }
    throw new Error('Worker did not finish ' + job.id);
  }
  async function openAdd() {
    await page.getByPlaceholder('Слово или значение').first().waitFor({ state: 'attached' });
    const field = page.getByPlaceholder('Слово или значение').filter({ visible: true });
    if (!await field.count()) await page.getByRole('button', { name: /Добавить слово/ }).first().click();
    await field.waitFor();
    return field;
  }
  async function pending(job, reload = false) {
    const id = job.cards[0].id;
    await go('/word/' + id);
    await page.getByTestId('example-progress').filter({ hasText: 'Готовим пример…' }).waitFor();
    if (reload) {
      await go('/word/' + id);
      await page.getByTestId('example-progress').filter({ hasText: 'Готовим пример…' }).waitFor();
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone overflow');
  }
  try {
    await ctx.addInitScript(() => {
      localStorage.setItem('lexa.locale', 'ru');
      localStorage.setItem('lexa.exampleStyle', 'casual');
      localStorage.setItem('lexa.wordAddMode', 'auto');
      localStorage.setItem('lexa.autoGloss', '0');
    });
    assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
    const seed = db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});const w=await db.word.create({data:{userId:u.id,word:'学习',sourceLang:'zh',targetLang:'ru',phonetic:'xué xí',meaningZh:'учиться',partOfSpeech:'глагол',exampleStatus:'ready',examples:{create:{sentenceEn:'顺序和环境都很重要。',sentenceZh:'Порядок и среда важны.',sourceName:'Manual entry',sourceUrl:''}}}});console.log(w.id);`);
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && (pathname === '/api/words' || pathname === '/api/words/batch')) {
        posts.push({ path: pathname, body: request.postDataJSON() });
        const response = await route.fetch();
        const result = await response.json();
        await hold(result);
        await route.fulfill({ response, json: result });
      } else await route.continue();
    });
    await go('/words');
    let field = await openAdd();
    await field.fill('顺序');
    const form = field.locator('xpath=ancestor::form');
    const submit = form.locator('button[type="submit"]');
    await page.waitForFunction((el) => !el.disabled, await submit.elementHandle());
    await submit.evaluate((el) => { el.click(); el.click(); });
    await page.getByRole('link', { name: 'Открыть карточку', exact: true }).filter({ visible: true }).waitFor();
    assert.equal(posts.filter((p) => p.path === '/api/words').length, 1, 'double tap creates once');
    assert.ok(await page.getByTestId('enrichment-tracker').count());
    const main = jobs.at(-1);
    await page.getByRole('link', { name: 'Открыть карточку', exact: true }).filter({ visible: true }).click();
    await page.getByTestId('example-progress').waitFor();
    await pending(main, true);
    await page.screenshot({ path: path.join(out, name + '-pending.png') });
    await go('/words');
    await page.getByText('Готовим пример…', { exact: true }).filter({ visible: true }).first().waitFor();
    console.log(name + ': main field, double tap, immediate opening, list progress and reload pass');
    if (process.argv.includes('--long')) {
      await pending(main);
      while (Date.now() - main.started < 125_000) {
        await page.waitForTimeout(Math.min(30_000, 125_000 - (Date.now() - main.started)));
        assert.equal(await page.getByTestId('example-progress').innerText(), 'Готовим пример…');
        console.log(name + ': still pending at ' + Math.round((Date.now() - main.started) / 1000) + 's');
      }
    }
    await release(main);
    await pendingOrReady(main);
    console.log(name + ': real worker completion appears without reload');

    await go('/words'); field = await openAdd();
    await field.fill('顺序');
    await field.locator('xpath=ancestor::form').locator('li button').filter({ hasText: '顺序' }).first().click();
    await page.getByRole('button', { name: /Всё равно добавить|Добавить всё равно|Добавить ещё/ }).click();
    await page.getByRole('link', { name: 'Открыть карточку', exact: true }).filter({ visible: true }).waitFor();
    const dictionary = jobs.at(-1);
    assert.notEqual(dictionary.id, main.id);
    await pending(dictionary);
    await release(dictionary);
    await pendingOrReady(dictionary);
    assert.equal(JSON.parse(db(`console.log(JSON.stringify(await db.word.count({where:{user:{telegramId:${JSON.stringify(user)}},word:'顺序'}})));`)), 2);
    console.log(name + ': dictionary row/plus and intentional duplicate confirmation pass');

    await go('/reader');
    await page.locator('textarea').filter({ visible: true }).first().fill('我们学习环境和工作。');
    await page.getByRole('button', { name: 'Читать', exact: true }).click();
    await page.getByRole('button', { name: '环境', exact: true }).first().click();
    await page.getByRole('button', { name: '工作', exact: true }).first().click();
    await page.getByRole('button', { name: /^Добавить 2$/ }).evaluate((el) => { el.click(); el.click(); });
    await page.getByTestId('enrichment-tracker').waitFor();
    await page.waitForFunction(() => !document.querySelector('button:disabled')?.textContent?.includes('Добавляю'));
    for (let i = 0; i < 50 && jobs.length < 3; i++) await page.waitForTimeout(100);
    const reader = jobs.at(-1);
    assert.equal(reader.cards[0].word, '环境');
    assert.equal(reader.cards.length, 2);
    assert.equal(posts.filter((p) => p.path === '/api/words/batch').length, 1);
    await pending(reader, true);
    await release(reader);
    await pendingOrReady(reader);
    console.log(name + ': Reader selection/batch, context translation and navigation/reload pass');

    // A seed example contains a new word, so the actual popup add path is exercised.
    await go('/word/' + seed);
    const character = page.locator('[data-ci="0"]').filter({ visible: true }).first();
    // 顺序 is now owned; 服务 is new and supplied in a fresh seed sentence.
    db(`await db.example.updateMany({where:{wordId:${JSON.stringify(seed)}},data:{sentenceEn:'服务很重要。'}});`);
    await go('/word/' + seed);
    await character.waitFor();
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await character.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
    await character.click();
    const popupAdd = page.getByRole('button', { name: 'В мои слова', exact: true });
    await popupAdd.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.textContent.trim() === 'В мои слова' && !el.disabled));
    await popupAdd.evaluate((el) => { el.click(); el.click(); });
    for (let i = 0; i < 50 && jobs.length < 4; i++) await page.waitForTimeout(100);
    const popup = jobs.at(-1);
    assert.equal(popup.cards[0].word, '服务');
    assert.equal(posts.filter((p) => p.path === '/api/words/batch').length, 2);
    await pending(popup);
    await release(popup);
    await pendingOrReady(popup);
    console.log(name + ': example-word popup capture and translation progress pass');

    // A controlled terminal failure must retry the existing card through the real route.
    db(`await db.word.update({where:{id:${JSON.stringify(main.cards[0].id)}},data:{exampleStatus:'failed',enrichmentStatus:'failed'}});`);
    await go('/word/' + main.cards[0].id);
    await page.getByTestId('example-progress').getByRole('button', { name: 'Повторить' }).click();
    await page.getByTestId('example-progress').filter({ hasText: 'Готовим пример…' }).waitFor();
    await page.getByTestId('example-progress').waitFor({ state: 'hidden', timeout: 90_000 });
    assert.equal(JSON.parse(db(`console.log(JSON.stringify(await db.word.count({where:{user:{telegramId:${JSON.stringify(user)}},word:'顺序'}})));`)), 2);
    console.log(name + ': visible failure/retry keeps the existing card');

    await go('/words'); field = await openAdd();
    await field.locator('xpath=ancestor::form').getByRole('button', { name: 'Без примера', exact: true }).click();
    await field.fill('朋友');
    await field.locator('xpath=ancestor::form').locator('button[type="submit"]').click();
    await page.getByRole('link', { name: 'Открыть карточку', exact: true }).filter({ visible: true }).waitFor();
    const disabled = jobs.at(-1);
    await go('/word/' + disabled.cards[0].id);
    await page.getByRole('heading', { name: '朋友', exact: true }).waitFor();
    assert.equal(await page.getByTestId('example-progress').count(), 0);
    await release(disabled);
    const without = await ctx.request.get(api + '/words/' + disabled.cards[0].id).then((r) => r.json());
    assert.equal(without.exampleStatus, 'disabled'); assert.equal(without.examples.length, 0);
    console.log(name + ': explicit no-example never shows example progress');
    assert.deepEqual(errors, []);
    if (cancelledRequests.length) console.log(name + ': classified ' + cancelledRequests.length + ' navigation-cancelled local resources');
    await page.screenshot({ path: path.join(out, name + '-ready.png') });
  } catch (error) {
    await page.screenshot({ path: path.join(out, name + '-failure.png') }).catch(() => {});
    console.error('UI', await page.locator('button:visible').allTextContents().catch(() => []));
    console.error('Failed local assets', failedRequests.filter((r) => r.url.includes('/_next/')).slice(-10));
    throw error;
  } finally {
    await ctx.close(); await browser.close();
    db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
  }
  async function pendingOrReady(job) {
    await page.getByTestId('example-progress').waitFor({ state: 'hidden', timeout: 90_000 });
    const word = await ctx.request.get(api + '/words/' + job.cards[0].id).then((r) => r.json());
    assert.equal(word.exampleStatus, 'ready');
    assert.ok(word.examples.length);
    // Detail and list offline caches receive the terminal state too.
    await page.waitForFunction((id) => new Promise((resolve) => {
      const request = indexedDB.open('lexa', 1);
      request.onsuccess = () => {
        const database = request.result; const tx = database.transaction('kv', 'readonly');
        const all = tx.objectStore('kv').getAll();
        tx.oncomplete = () => { database.close(); resolve(all.result.some((w) => w?.id === id && w.exampleStatus === 'ready') && all.result.some((list) => Array.isArray(list) && list.some((w) => w.id === id && w.exampleStatus === 'ready'))); };
      };
    }), job.cards[0].id);
  }
}
