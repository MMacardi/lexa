// Local WebKit phone check. Desktop WebKit has no software keyboard: replay
// viewport resize/pan readings and inspect every frame, not only settled boxes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli/chat-keyboard');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli/browsers');
const { webkit, devices } = await import('../node_modules/playwright-core/index.mjs');
const baseline = process.argv.includes('--baseline');
const db = code => execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
  cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
}).trim();
const user = `chat-keyboard-${Date.now()}`;
const browser = await webkit.launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block' });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
page.setDefaultTimeout(20000);
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
const input = () => page.locator('textarea').filter({ visible: true });
const open = () => page.getByRole('button', { name: 'Открыть Мику', exact: true }).filter({ visible: true }).click();

// Each sample is in visual coordinates, subtracting Safari's current pan.
async function frames(selector, readings) {
  return page.evaluate(async ({ selector, readings }) => {
    const box = document.querySelector(selector);
    const samples = [];
    for (const [height, top] of readings) {
      window.testViewport.height = height;
      window.testViewport.top = top;
      visualViewport.dispatchEvent(new Event('resize'));
      visualViewport.dispatchEvent(new Event('scroll'));
      // ResizeObserver runs after animation-frame callbacks and before paint.
      // Sample the rendered state rather than forcing layout before its anchor
      // correction (pinyin can finish loading in that same frame).
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const r = box.getBoundingClientRect();
      const panel = box.querySelector('.anim-sheet') ?? box;
      const p = panel.getBoundingClientRect();
      const field = box.querySelector('textarea').getBoundingClientRect();
      const scroller = box.querySelector('.overflow-y-auto');
      samples.push({ top: r.top - top, height: r.height, expectedHeight: height,
        panelTop: p.top - top, fieldBottom: field.bottom - top, scrollTop: scroller.scrollTop,
        gap: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight });
    }
    return samples;
  }, { selector, readings });
}
function check(samples, label, welcome = false, pageMode = false) {
  if (baseline) return;
  for (const sample of samples) {
    assert(Math.abs(sample.top) < 2, `${label}: overlay trails viewport pan ${JSON.stringify(sample)}`);
    if (!pageMode) assert(Math.abs(sample.height - sample.expectedHeight) < 2, `${label}: overlay trails keyboard height`);
    assert(sample.panelTop >= -1, `${label}: header clipped above screen`);
    assert(sample.fieldBottom <= sample.expectedHeight + 1, `${label}: composer under keyboard`);
    if (welcome) assert.equal(sample.scrollTop, 0, `${label}: welcome is scrolled past its opening`);
    else assert(sample.gap < 3, `${label}: newest message moved under composer ${JSON.stringify(sample)}`);
  }
}
try {
  await ctx.addInitScript(() => {
    localStorage.setItem('lexa.locale', 'ru');
    localStorage.setItem('lexa.autoGloss', '0');
    localStorage.setItem('lexa.showTextLevel', '0');
  });
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
  db(`await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4}});`);
  const text = await ctx.request.post(api + '/reader/texts', { data: {
    title: '半推半就的人生', content: '看似安穩啊\n毫無意外的旅程\n得到一些可以任性的機會\n'.repeat(8), sourceLang: 'zh', targetLang: 'ru',
  } });
  assert.equal(text.status(), 201, await text.text());
  await page.goto(app + '/reader', { waitUntil: 'networkidle' });
  await page.getByRole('button').filter({ hasText: '半推半就的人生' }).click();
  await page.locator('[data-reader-source]').waitFor();
  await open();
  await page.getByText('Мика видит весь текст из Читалки', { exact: true }).waitFor();
  await page.waitForTimeout(450);
  await page.evaluate(() => {
    window.testViewport = { height: innerHeight, top: 0 };
    Object.defineProperties(visualViewport, {
      height: { configurable: true, get: () => window.testViewport.height },
      offsetTop: { configurable: true, get: () => window.testViewport.top },
    });
  });
  const rest = await page.evaluate(() => innerHeight), small = rest - 350;
  const opening = [[small, 0], ...[20, 55, 90, 130, 170, 190].map(top => [small, top])];
  const closing = [[small, 170], [small, 130], [small, 70], [small, 20], [rest, 0]];
  await input().focus();
  const up = await frames('.vv-overlay', opening);
  await page.screenshot({ path: path.join(out, baseline ? 'before-keyboard.png' : 'after-keyboard.png'),
    clip: { x: 0, y: opening.at(-1)[1], width: 390, height: small } });
  // Done can leave the old height in place until its final resize event.
  await input().evaluate(el => el.blur());
  const down = await frames('.vv-overlay', closing);
  const results = { opening: up, closing: down };
  fs.writeFileSync(path.join(out, baseline ? 'before.json' : 'after.json'), JSON.stringify(results, null, 2));
  if (baseline) {
    console.log('Baseline recorded; largest pan tracking error:', Math.max(...up.concat(down).map(s => Math.abs(s.top))));
  } else {
    check(up, 'opening', true); check(down, 'Done', true);
    // Rapid blur/refocus must follow actual readings rather than a close timer.
    await input().focus();
    check(await frames('.vv-overlay', [[small, 100]]), 'refocus', true);
    await input().evaluate(el => el.blur());
    await input().focus();
    check(await frames('.vv-overlay', [[small, 130], [small, 90]]), 'rapid reopen', true);
    await input().evaluate(el => el.blur());
    check(await frames('.vv-overlay', [[rest, 0]]), 'restore', true);

    // A real thread still holds its newest line while the available height changes.
    await page.route('**/api/tutor/ask', route => route.fulfill({ status: 200, contentType: 'application/x-ndjson',
      body: JSON.stringify({ type: 'final', result: { answer: '安稳 (ānwěn) — спокойно.\n'.repeat(30), addWords: [], addCards: [] } }) + '\n' }));
    await input().fill('Объясни текст');
    await input().press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.vv-overlay button[aria-label="Копировать"]').length === 2);
    await page.locator('[data-mika-reply] ruby rt').first().waitFor();
    await page.waitForFunction(() => {
      const el = document.querySelector('.vv-overlay .overflow-y-auto');
      return el && el.scrollHeight - el.scrollTop - el.clientHeight < 3;
    });
    await input().focus();
    check(await frames('.vv-overlay', opening), 'thread opening');
    await input().evaluate(el => el.blur());
    check(await frames('.vv-overlay', closing), 'thread closing');
    const progressive = Array.from({ length: 10 }, (_, i) => [rest - 35 * (i + 1), 10 * i]);
    await input().focus();
    check(await frames('.vv-overlay', progressive), 'progressive keyboard');
    await input().evaluate(el => el.blur());
    check(await frames('.vv-overlay', [[rest, 0]]), 'progressive restore');
    // Reading older messages keeps the same distance from the thread's end.
    const previousGap = await page.locator('.vv-overlay div.overflow-y-auto').evaluate(el => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -500 }));
      el.scrollTop -= 500;
      el.dispatchEvent(new Event('scroll'));
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    });
    await input().focus();
    const reading = await frames('.vv-overlay', opening);
    for (const sample of reading) assert(Math.abs(sample.gap - previousGap) < 3, 'keyboard preserves older reading position');
    await input().evaluate(el => el.blur());
    await frames('.vv-overlay', closing);
    await page.getByRole('button', { name: 'К последнему сообщению', exact: true }).click();
    await page.waitForFunction(() => {
      const el = document.querySelector('.vv-overlay .overflow-y-auto');
      return el && el.scrollHeight - el.scrollTop - el.clientHeight < 3;
    });
    // Closing while typing must blur and unmount, then reopen with clean geometry.
    await input().focus();
    await frames('.vv-overlay', opening);
    await page.getByRole('button', { name: 'Отмена', exact: true }).filter({ visible: true }).click();
    await input().waitFor({ state: 'hidden' });
    assert.equal(await page.locator('textarea:focus').count(), 0);
    await page.evaluate(() => { window.testViewport.height = innerHeight; window.testViewport.top = 0; visualViewport.dispatchEvent(new Event('resize')); });
    await open();
    await page.waitForTimeout(450);
    check(await frames('.vv-overlay', [[rest, 0]]), 'reopen');
    await page.getByRole('link', { name: 'Открыть на весь экран', exact: true }).click();
    await page.waitForURL(app + '/mika');
    await page.locator('.vv-overlay').waitFor({ state: 'hidden' });
    await input().focus();
    check(await frames('.mika-chat', opening), 'full page opening', false, true);
    await input().evaluate(el => el.blur());
    check(await frames('.mika-chat', closing), 'full page Done', false, true);
    assert.deepEqual(errors, []);
    console.log('WebKit phone: per-frame pan/resize, welcome anchor, thread bottom, Done, rapid refocus, close/reopen and full page passed.');
  }
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await ctx.close();
  await browser.close();
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
}
