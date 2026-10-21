// Focused local Russian phone check: legacy history, ruby, streaming and settings.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), out = path.join(root, '.playwright-cli', 'mika-pinyin');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium } = await import('../node_modules/playwright-core/index.mjs');
const api = 'http://localhost:3000/api', app = 'http://localhost:3001';
const users = [`ruby-ui-${Date.now()}-a`, `ruby-ui-${Date.now()}-b`];
const checks = [], errors = [];
const record = s => { checks.push(s); console.log('PASS ' + s); };
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
const browser = await chromium.launch({ headless: true, downloadsPath: path.join(out, 'downloads') });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', serviceWorkers: 'block' });
await ctx.addInitScript(() => localStorage.setItem('lexa.locale', 'ru'));
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', e => errors.push(e.message));
const toggle = () => page.getByRole('button', { name: 'Пиньинь', exact: true }).filter({ visible: true });
const replies = () => page.locator('[data-mika-reply]');
async function on(expected) { await toggle().waitFor(); await page.waitForFunction(value => [...document.querySelectorAll('button[aria-label="Пиньинь"]')].filter(el => el.getBoundingClientRect().width).every(el => el.getAttribute('aria-pressed') === String(value)), expected); }
async function login(id, level) {
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: id } })).status(), 200);
  db(`await db.user.update({where:{telegramId:${JSON.stringify(id)}},data:{invited:true,firstName:'Проверка',nativeLang:'ru',hskTarget:${level},levels:{zh:'B2'}}});`);
}
const legacy = '**到达** (dádá) — прибывать.\n- 火车到达了车站。\n  Huǒchē dídá le chēzhàn. — Поезд прибыл на станцию — вовремя.\n1. **拒绝** (jùjué) — отказаться.\n- 他拒绝了邀请。\n  Tā jùjué le yāoqǐng. — Он отказался от приглашения.\n2. **照镜子** (zhào jìngzi) — смотреться в зеркало.\n- 她在照镜子。\n  Она смотрится в зеркало.\n- **银行** и **行走** читаются по-разному.\n- 银**行** и **行**走 сохраняют чтение при выделении части слова.\n- 我把书**还**给他。\n  Я возвращаю ему книгу.\n- <img src=x onerror=alert(1)>\n- 这是一个为了检查手机屏幕上拼音换行而写的很长的中文例句，标点也应该保留下来。';
try {
  await login(users[0], 4);
  assert.equal((await ctx.request.put(api + '/tutor/chats/rubyhistory', { data: { messages: [{ role: 'user', content: 'Старая история с примерами' }, { role: 'assistant', content: legacy }] } })).status(), 200);
  for (let attempt = 0; ; attempt++) {
    try { if ((await ctx.request.get(app + '/mika', { timeout: 2000 })).ok()) break; } catch {}
    if (attempt >= 29) throw new Error('Local frontend did not become ready');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await page.goto(app + '/mika', { waitUntil: 'networkidle' });
  await on(true);
  await page.getByRole('button', { name: 'История', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: /Старая история с примерами/ }).click();
  await replies().locator('ruby').first().waitFor();
  await page.waitForFunction(() => document.querySelector('[data-mika-reply]')?.querySelectorAll('ruby').length > 50);
  const readings = await replies().locator('ruby').evaluateAll(els => els.map(el => [el.firstChild.textContent, el.querySelector('rt').textContent]));
  const pairs = readings.map(([a,b]) => a + ':' + b).join(' ');
  for (const expected of ['到:dào', '达:dá', '拒:jù', '绝:jué', '照:zhào', '镜:jìng', '行:háng', '行:xíng', '还:huán']) assert.ok(pairs.includes(expected), expected + '\n' + pairs);
  assert.deepEqual(readings.filter(([char]) => char === '行').slice(0, 4).map(([,reading]) => reading), ['háng', 'xíng', 'háng', 'xíng']);
  assert.doesNotMatch(await replies().innerText(), /dádá|dídá|Huǒchē|jùjué|zhào jìngzi/);
  assert.match(await replies().innerText(), /Поезд прибыл на станцию — вовремя/);
  assert.ok((await replies().locator('strong').count()) >= 5);
  assert.equal(await replies().locator('img').count(), 0, 'HTML is text, never executed');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'phone no horizontal overflow');
  await page.screenshot({ path: path.join(out, 'phone-ruby.png') });
  const selected = await replies().evaluate(el => {
    const sel = getSelection(), range = document.createRange(); range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
    const data = new DataTransfer(); el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true })); sel.removeAllRanges(); return data.getData('text/plain');
  });
  assert.match(selected, /火车到达了车站。/);
  assert.match(selected, /Поезд прибыл на станцию/);
  assert.doesNotMatch(selected, /dào|dá|dádá|dídá/);
  assert.equal((await (await ctx.request.get(api + '/tutor/chats/rubyhistory')).json()).messages[1].content, legacy);
  record('legacy saved reply: correct 到达/拒绝/照镜子/银行/行走/还给 ruby, preserved Russian/list/highlights/punctuation, safe HTML, clean selection copy, unchanged stored text, phone width');
  if (process.argv.includes('--render-only')) {
    await toggle().click(); await on(false);
    assert.equal(await replies().locator('ruby').count(), 0);
    await toggle().click(); await on(true); await replies().locator('ruby').first().waitFor();
    record('toggle event synchronizes the control and reply renderer');
    assert.deepEqual(errors, []);
    process.exitCode = 0;
  } else {
  await toggle().click(); await on(false);
  assert.equal(await replies().locator('ruby').count(), 0);
  await page.reload({ waitUntil: 'networkidle' }); await on(false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(app + '/words', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Открыть Мику', exact: true }).click(); await on(false);
  await toggle().click(); await on(true); await replies().locator('ruby').first().waitFor();
  await page.getByRole('link', { name: 'Открыть на весь экран', exact: true }).click(); await page.waitForURL(app + '/mika'); await on(true);
  record('completed-reply toggle, reload and popup/full-page share one account preference');

  // Deliver deliberate partial chunks through the app's normal streaming client.
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      if (!String(args[0]).endsWith('/api/tutor/ask')) return original(...args);
      const first = '**到达** — прибыть.\n- 火车到达了车站。';
      const tail = '\n  Поезд прибыл на станцию — вовремя.';
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) {
        const push = obj => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        push({ type: 'delta', t: first });
        setTimeout(() => { push({ type: 'delta', t: tail }); window.__rubyLineDone = true; }, 1800);
        setTimeout(() => { push({ type: 'final', result: { answer: first + tail, addWords: [], addCards: [] } }); controller.close(); }, 3500);
      } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
  await page.getByPlaceholder('Спроси или добавь фото…', { exact: true }).fill('Потоковая проверка');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await replies().last().getByText('火车到达了车站。', { exact: true }).waitFor();
  assert.equal(await replies().last().locator('ruby').count(), 2, 'only settled heading gets ruby; unfinished example stays plain');
  await page.waitForFunction(() => window.__rubyLineDone);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-mika-reply]')].at(-1)?.querySelectorAll('ruby').length > 2);
  await page.getByRole('button', { name: 'Отправить', exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' }); await on(true);
  await replies().last().locator('ruby').first().waitFor();
  record('partial streamed tail stays plain, completed lines receive ruby, final reply reloads from saved history');

  await login(users[1], 5); await page.reload({ waitUntil: 'networkidle' }); await on(false);
  await toggle().click(); await on(true);
  assert.equal((await ctx.request.patch(api + '/auth/me', { data: { hskTarget: 6 } })).status(), 200);
  await page.reload({ waitUntil: 'networkidle' }); await on(true);
  await login(users[0], 4); await page.reload({ waitUntil: 'networkidle' }); await on(true);
  await toggle().click(); await on(false);
  await login(users[1], 5); await page.reload({ waitUntil: 'networkidle' }); await on(true);
  record('HSK 4 defaults on, HSK 5 defaults off, manual choice survives level change/reload and accounts are isolated');
  assert.deepEqual(errors, []); record('no browser page errors');
  }
} finally {
  fs.writeFileSync(path.join(out, process.argv.includes('--render-only') ? 'render-result.json' : 'result.json'), JSON.stringify({ checks, errors }, null, 2));
  db(`for(const telegramId of ${JSON.stringify(users)}){const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(telegramId);}`);
  await browser.close();
}
