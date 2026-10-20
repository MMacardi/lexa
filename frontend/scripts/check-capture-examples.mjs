// One Russian phone flow and one desktop flow against local Docker only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const out = path.join(root, '.playwright-cli', 'capture-examples');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, webkit, devices } = await import('../node_modules/playwright-core/index.mjs');
const api = 'http://localhost:3000/api';
const app = 'http://localhost:3001';
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try {${code}} finally {await db.$disconnect()}`,
  }).trim();
}
for (const config of [
  { name: 'phone-webkit', engine: webkit, ...devices['iPhone 13'] },
  { name: 'desktop-chromium', engine: chromium, viewport: { width: 1280, height: 900 } },
].filter((c) => !process.argv[2] || c.name === process.argv[2])) {
  const { name, engine, ...options } = config;
  const browser = await engine.launch({ headless: true, downloadsPath: out });
  const ctx = await browser.newContext({ ...options, locale: 'ru-RU', serviceWorkers: 'block' });
  const stranger = await browser.newContext({ serviceWorkers: 'block' });
  const user = `capture-ui-${name}-${Date.now()}`;
  const other = `${user}-other`;
  const errors = [];
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (e) => {
    if (!/localhost:(3000|3001).*due to access control checks\.$/.test(e.message)) errors.push(e.message);
  });
  try {
    await ctx.addInitScript(() => {
      localStorage.setItem('lexa.locale', 'ru');
      localStorage.setItem('lexa.exampleStyle', 'internet');
      localStorage.setItem('lexa.autoGloss', '0');
      localStorage.setItem('lexa.showTextLevel', '0');
      localStorage.setItem('lexa.readerSource', 'Упражнение A/B/C');
    });
    for (const [session, id] of [[ctx, user], [stranger, other]]) {
      assert.equal((await session.request.post(api + '/auth/dev', { data: { telegramId: id } })).status(), 200);
      db(`await db.user.update({where:{telegramId:${JSON.stringify(id)}},data:{invited:true,nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});`);
    }
    await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
    await page.locator('textarea').filter({ visible: true }).first().fill('A. 然而 B. 因此 C. 而且');
    await page.getByRole('button', { name: 'Читать', exact: true }).click();
    await page.getByRole('button', { name: '然而', exact: true }).first().click();
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/words/batch'));
    await page.getByRole('button', { name: /^Добавить 1$/ }).click();
    const payload = (await posted).postDataJSON();
    assert.equal(payload.exampleStyle, 'internet'); assert.equal(payload.level, '4');
    await page.getByTestId('enrichment-tracker').waitFor();
    let word;
    for (let i = 0; i < 90; i++) {
      const words = await ctx.request.get(api + '/words').then((r) => r.json());
      word = words.find((w) => w.word === '然而');
      if (word?.exampleStatus === 'ready' || word?.exampleStatus === 'failed') break;
      await page.waitForTimeout(1000);
    }
    assert.equal(word?.exampleStatus, 'ready', JSON.stringify(word));
    assert.equal(word.examples.length, 2);
    const original = word.examples.find((e) => e.sourceName === 'Упражнение A/B/C');
    const generated = word.examples.find((e) => e.id !== original?.id);
    assert.ok(original && generated);
    assert.ok(payload.items[0].sentence.includes('然而'));
    assert.equal(original.sentenceEn, payload.items[0].sentence);
    assert.equal(generated.register, 'internet'); assert.equal(generated.level, 'HSK 1–4');
    assert.ok(generated.sentenceEn.includes('然而') && generated.sentenceZh);
    fs.writeFileSync(path.join(out, `${name}-examples.json`), JSON.stringify({ payload, examples: word.examples }, null, 2));
    const saved = await ctx.request.get(api + '/reader/texts').then((r) => r.json());
    const text = saved.find((x) => x.snippet.includes('A. 然而'));
    assert.ok(text, 'Reader saved text remains available');
    await page.goto(app + '/word/' + word.id, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Удалить пример', exact: true }).first().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (name.startsWith('phone')) await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
    const denied = await stranger.request.delete(api + `/words/${word.id}/examples/${original.id}`);
    assert.equal(denied.status(), 404, 'other account cannot remove this example');
    async function remove(id) {
      const index = word.examples.findIndex((e) => e.id === id);
      await page.getByRole('button', { name: 'Удалить пример', exact: true }).nth(index).click();
      await page.getByRole('button', { name: 'Удалить пример', exact: true }).last().click();
      await page.waitForFunction((n) => document.querySelectorAll('button[aria-label="Удалить пример"]').length === n, word.examples.length - 1);
      word = await ctx.request.get(api + '/words/' + word.id).then((r) => r.json());
    }
    const fsrs = JSON.parse(db(`const w=await db.word.findUniqueOrThrow({where:{id:${JSON.stringify(word.id)}}});console.log(JSON.stringify([w.stability,w.difficulty,w.due,w.reps,w.lapses,w.reviewCount]));`));
    await remove(original.id);
    assert.equal(word.examples.length, 1);
    assert.deepEqual(word.examples[0], generated, 'remaining metadata preserved');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Удалить пример', exact: true }).waitFor();
    await remove(generated.id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Удалить пример', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await ctx.request.get(api + '/words/' + word.id).then((r) => r.json())).examples.length, 0);
    assert.deepEqual(JSON.parse(db(`const w=await db.word.findUniqueOrThrow({where:{id:${JSON.stringify(word.id)}}});console.log(JSON.stringify([w.stability,w.difficulty,w.due,w.reps,w.lapses,w.reviewCount]));`)), fsrs);
    assert.equal((await ctx.request.get(api + '/reader/texts/' + text.id)).status(), 200);
    await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button').filter({ hasText: text.title }).first().click();
    await page.getByRole('button', { name: '然而', exact: true }).first().click();
    assert.equal((await ctx.request.get(api + '/words/' + word.id).then((r) => r.json())).examples.length, 0);
    await page.evaluate((id) => sessionStorage.setItem('lexa.reviewFocusIds', JSON.stringify([id])), word.id);
    await page.goto(app + '/review', { waitUntil: 'domcontentloaded' });
    await page.locator('.flip-card').waitFor();
    assert.equal(await page.getByText(original.sentenceEn, { exact: true }).count(), 0);
    assert.equal(await page.getByText(generated.sentenceEn, { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${name}: live Reader capture, saved style/level, progress, original/generated/last removal, reload, Reader/review, ownership and FSRS pass`);
  } finally {
    db(`const {deleteAccount}=await import('./dist/services/accountData.js');for(const id of ${JSON.stringify([user, other])}) await deleteAccount(id);if(await db.user.count({where:{telegramId:{in:${JSON.stringify([user, other])}}}})) throw new Error('Test account cleanup failed');`);
    await ctx.close(); await stranger.close(); await browser.close();
  }
}
