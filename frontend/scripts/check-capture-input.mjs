// One local Russian phone check: 程 meaning and real handwriting candidates at the caret.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli/capture-input');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli/browsers');
const { chromium, devices } = await import('../node_modules/playwright-core/index.mjs');
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
const user = `capture-input-${Date.now()}`, checks = [], errors = [];
const db = code => execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
  cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
}).trim();
const browser = await chromium.launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block' });
const page = await ctx.newPage();
page.setDefaultTimeout(30_000);
page.on('pageerror', e => errors.push(e.message));
const record = text => { checks.push(text); console.log('PASS ' + text); };
try {
  await ctx.addInitScript(() => {
    localStorage.setItem('lexa.locale', 'ru');
    localStorage.setItem('lexa.drawPad', '1');
    localStorage.setItem('lexa.exampleStyle', 'none');
  });
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
  const card = db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4,hskVersion:'2.0'}});
    const w=await db.word.create({data:{userId:u.id,word:'编程',sourceLang:'zh',targetLang:'ru',phonetic:'biān chéng',meaningZh:'программировать',
      autoExamples:false,exampleStatus:'ready',collocations:[],synonyms:[],antonyms:[]}});console.log(w.id);`);
  let localizationCalls = 0;
  page.on('request', req => { if (req.url().endsWith('/dict/chars/localize')) localizationCalls++; });
  await page.goto(app + '/word/' + card, { waitUntil: 'domcontentloaded' });
  await page.getByText('правило; порядок; норма; формула; путь; процедура', { exact: true }).waitFor();
  assert.equal(localizationCalls, 0, '程 is ready without a model request');
  assert.equal(await page.getByText('Не удалось загрузить значение', { exact: true }).count(), 0);
  record('编程: 程 has a prepared Russian meaning on the phone, no localization call');

  const initial = await ctx.request.get(api + '/dict/chars?word=' + encodeURIComponent('编程') + '&phonetic=' + encodeURIComponent('biān chéng') + '&lang=ru').then(r => r.json());
  const pending = structuredClone(initial);
  for (const c of pending.chars) { c.meaning = ''; c.english = true; }
  const partial = structuredClone(initial);
  partial.chars[1].meaning = ''; partial.chars[1].english = true;
  await page.route('**/api/dict/chars?*', route => route.fulfill({ json: pending }));
  let retries = 0;
  await page.route('**/api/dict/chars/localize', route => ++retries === 1
    ? route.fulfill({ json: partial }) : route.continue());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Не удалось загрузить значение', { exact: true }).waitFor();
  await page.getByText(initial.chars[0].meaning, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await page.getByText(initial.chars[1].meaning, { exact: true }).waitFor();
  assert.equal(await page.getByText('Не удалось загрузить значение', { exact: true }).count(), 0);
  assert.equal(retries, 2);
  await page.unroute('**/api/dict/chars?*');
  await page.unroute('**/api/dict/chars/localize');
  record('Partial localization keeps completed meanings visible and retry fills the remaining gap');

  await page.goto(app + '/words', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Добавить слово', exact: true }).first().click();
  const sheet = page.locator('div.fixed.inset-0').filter({ has: page.getByRole('heading', { name: 'Добавить слово', exact: true }) });
  const input = sheet.getByPlaceholder('Слово или значение', { exact: true });
  await input.waitFor();
  const pad = sheet.locator('canvas[aria-label="Поле для письма иероглифа"]');
  const backspace = sheet.getByRole('button', { name: 'Удалить выделенное или иероглиф перед курсором', exact: true });
  async function select(value, start, end = start) {
    await input.fill(value);
    await input.evaluate((el, [s, e]) => {
      el.focus();
      el.setSelectionRange(s, e);
      el.dispatchEvent(new Event('select', { bubbles: true }));
    }, [start, end]);
  }
  async function insert() {
    await pad.scrollIntoViewIfNeeded();
    const box = await pad.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width * .15, box.y + box.height * .45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .85, box.y + box.height * .45, { steps: 12 });
    await page.mouse.up();
    await sheet.getByRole('button', { name: '一', exact: true }).click();
    assert.equal(await input.evaluate(el => document.activeElement === el), false, 'pad keeps phone keyboard closed');
  }
  await select('编程', 0);
  await insert();
  assert.equal(await input.inputValue(), '一编程');
  await insert();
  assert.equal(await input.inputValue(), '一一编程');
  record('Real handwriting candidates insert at the start and continue at the new caret');
  await select('编程', 1);
  await insert();
  assert.equal(await input.inputValue(), '编一程');
  await insert();
  assert.equal(await input.inputValue(), '编一一程');
  record('Insertion in the middle preserves the following text');
  await select('编程', 0, 1);
  await insert();
  assert.equal(await input.inputValue(), '一程');
  await select('一程', 0, 1);
  await insert();
  assert.equal(await input.inputValue(), '一程');
  await insert();
  assert.equal(await input.inputValue(), '一一程');
  record('Candidates replace a selection, including replacing a character with itself');
  await select('编程', 2);
  await insert();
  assert.equal(await input.inputValue(), '编程一');
  await select('', 0);
  await insert();
  assert.equal(await input.inputValue(), '一');
  record('Empty field and end insertion still work');

  await select('编程', 1);
  await backspace.click();
  assert.equal(await input.inputValue(), '程');
  await select('编程', 0, 1);
  await backspace.click();
  assert.equal(await input.inputValue(), '程');
  await select('编程', 0);
  await backspace.click();
  assert.equal(await input.inputValue(), '编程');
  await select('𠮷程', 2);
  await backspace.click();
  assert.equal(await input.inputValue(), '程');
  record('Pad deletion uses caret/selection, leaves start intact and removes a whole supplementary character');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ checks, errors, localizationCalls }, null, 2));
} finally {
  await browser.close();
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
}
