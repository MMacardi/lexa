// Local regression for a stale drag tooltip and stored English part-of-speech labels.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli/word-graph');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli/browsers');
const { chromium, devices } = await import('../node_modules/playwright-core/index.mjs');
const db = code => execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
  cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
}).trim();
const user = `word-graph-${Date.now()}`;
const browser = await chromium.launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU', serviceWorkers: 'block' });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
page.setDefaultTimeout(20000);
try {
  await ctx.addInitScript(() => localStorage.setItem('lexa.locale', 'ru'));
  assert.equal((await ctx.request.post('http://localhost:3000/api/auth/dev', { data: { telegramId: user } })).status(), 200);
  const card = db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru'}});
    const w=await db.word.create({data:{userId:u.id,word:'由',phonetic:'yóu',sourceLang:'zh',targetLang:'ru',
      partOfSpeech:'preposition',meaningZh:'от; из; через',autoExamples:false,exampleStatus:'disabled',familyAt:new Date(),
      synonyms:['来自','由于'],antonyms:[],collocations:[],
      senses:{v:5,list:[{meaning:'от; из; через',pos:'preposition',onCard:true,phrases:[]}]}}});console.log(w.id);`);
  await page.goto('http://localhost:3001/word/' + card, { waitUntil: 'networkidle' });
  await page.getByText('предлог', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('preposition', { exact: true }).count(), 0);
  const pill = page.locator('.graph-pill').filter({ hasText: '来自' });
  await pill.scrollIntoViewIfNeeded();
  // Wait for the entrance springs to settle before grabbing the node.
  await page.waitForFunction(() => {
    const el = document.querySelector('.graph-pill');
    const x = el?.getBoundingClientRect().x;
    const prev = window.graphPreviousX;
    window.graphPreviousX = x;
    return x !== undefined && prev !== undefined && Math.abs(x - prev) < 0.01;
  }, null, { polling: 100 });
  await pill.hover();
  await page.getByRole('tooltip').waitFor();
  const start = await pill.boundingBox();
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 - 140, start.y + start.height / 2 - 65, { steps: 12 });
  await page.locator('.graph-node[data-dragging]').waitFor();
  assert.equal(await page.getByRole('tooltip').count(), 0, 'no tooltip at the old position during drag');
  assert.equal(await pill.getAttribute('aria-describedby'), null);
  await page.screenshot({ path: path.join(out, 'desktop-drag.png') });
  // Avoid a fling: a careful drop must retain the new position and not navigate.
  await page.waitForTimeout(100);
  await page.mouse.up();
  assert.equal(await page.locator('.graph-node[data-dragging]').count(), 0);
  const moved = await pill.boundingBox();
  assert.ok(Math.abs(moved.x - start.x) > 50);
  assert.ok(page.url().endsWith('/word/' + card));
  await page.mouse.move(10, 10);
  await pill.hover();
  await page.getByRole('tooltip').waitFor();
  const tip = await page.getByRole('tooltip').boundingBox();
  const anchor = await pill.boundingBox();
  assert.ok(Math.abs(tip.x + tip.width / 2 - anchor.x - anchor.width / 2) < 3, 'tooltip is anchored at the new position');
  // Pointer cancellation also restores previews.
  await page.mouse.down();
  await page.mouse.move(anchor.x + anchor.width / 2 - 40, anchor.y + anchor.height / 2 + 25, { steps: 5 });
  assert.equal(await page.getByRole('tooltip').count(), 0);
  await pill.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
  await page.mouse.up();
  assert.equal(await page.locator('.graph-node[data-dragging]').count(), 0);
  const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block', storageState: await ctx.storageState() });
  const mobile = await phone.newPage();
  mobile.on('pageerror', e => errors.push(e.message));
  await mobile.goto('http://localhost:3001/word/' + card, { waitUntil: 'networkidle' });
  await mobile.getByText('предлог', { exact: true }).first().waitFor();
  assert.equal(await mobile.getByText('preposition', { exact: true }).count(), 0);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await mobile.screenshot({ path: path.join(out, 'phone-pos.png') });
  await phone.close();
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ dragHidden: true, movedAnchor: true, cancelled: true, phonePos: 'предлог', errors }, null, 2));
  console.log('PASS: drag hides tooltip; rehover anchors at drop; cancel restores; Russian phone shows предлог; no overflow/errors');
} finally {
  await browser.close();
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
}
