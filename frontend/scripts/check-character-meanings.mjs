// Local Russian phone flow: prepared meanings, gap loading/failure/retry and shared cache.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli/character-meanings');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli/browsers');
const { chromium } = await import('../node_modules/playwright-core/index.mjs');
const api = 'http://localhost:3000/api', app = 'http://localhost:3001';
const user = `character-meanings-${Date.now()}`;
const db = code => execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
  cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
}).trim();
const ctx = await chromium.launchPersistentContext(path.join(out, `profile-${Date.now()}`), {
  channel: 'chromium', headless: true, viewport: { width: 390, height: 844 }, hasTouch: true,
  locale: 'ru-RU', serviceWorkers: 'block',
});
const page = ctx.pages()[0], errors = [], checks = [];
page.setDefaultTimeout(30_000);
page.on('pageerror', error => errors.push(error.message));
const record = text => { checks.push(text); console.log('PASS ' + text); };
await ctx.addInitScript(() => {
  localStorage.setItem('lexa.locale', 'ru');
  localStorage.setItem('lexa.theme', 'dark');
});
try {
  const readyBy = Date.now() + 90_000;
  while (true) {
    try {
      const ready = await Promise.all([fetch('http://localhost:3000/health'), fetch(app + '/reader')]);
      if (ready.every(r => r.ok)) break;
    } catch {}
    assert.ok(Date.now() < readyBy, 'local services are ready');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  // Session + invite gate applies to both reads and localization.
  const anonymous = await fetch(api + '/dict/chars/localize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word: '偶尔', phonetic: 'ǒu ěr', lang: 'ru' }),
  });
  assert.equal(anonymous.status, 401);
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
  assert.equal((await ctx.request.post(api + '/dict/chars/localize', { data: { word: '偶尔', phonetic: 'ǒu ěr', lang: 'ru' } })).status(), 403);
  const card = db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4}});
    const w=await db.word.create({data:{userId:u.id,word:'偶尔',sourceLang:'zh',targetLang:'ru',phonetic:'ǒu ěr',meaningZh:'иногда',
    autoExamples:false,exampleStatus:'ready',collocations:[],synonyms:[],antonyms:[]}});console.log(w.id);`);
  const params = '?word=' + encodeURIComponent('偶尔') + '&phonetic=' + encodeURIComponent('ǒu ěr') + '&lang=ru';
  const initial = await ctx.request.get(api + '/dict/chars' + params).then(r => r.json());
  assert.ok(initial.chars.length === 2);
  assert.ok(initial.chars.every(c => [c, ...c.words].every(w => !w.english || w.meaning === '')));
  record('Russian API never returns raw English; session and invite required');

  // Inject one untranslated row even on repeat runs with a warm shared cache.
  const pending = structuredClone(initial);
  pending.chars[0].meaning = '';
  pending.chars[0].english = true;
  await page.route('**/api/dict/chars?*', route => route.fulfill({ json: pending }));
  let releaseFailure, localizeCalls = 0;
  const failureGate = new Promise(resolve => { releaseFailure = resolve; });
  await page.route('**/api/dict/chars/localize', async route => {
    localizeCalls++;
    if (localizeCalls === 1) {
      await failureGate;
      await route.fulfill({ status: 502, json: { error: 'Local check failure' } });
    } else await route.continue();
  });
  await page.goto(app + '/word/' + card, { waitUntil: 'domcontentloaded' });
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Иероглифы', exact: true }) });
  await panel.getByText('Пишем значение на вашем языке…', { exact: true }).first().waitFor();
  assert.ok(!(await panel.innerText()).includes('accidental'));
  releaseFailure();
  await panel.getByText('Не удалось загрузить значение', { exact: true }).first().waitFor();
  await panel.getByRole('button', { name: 'Повторить', exact: true }).click();
  await panel.getByText('Пишем значение на вашем языке…', { exact: true }).first().waitFor({ state: 'hidden', timeout: 90_000 });
  await panel.getByRole('button', { name: 'Повторить', exact: true }).waitFor({ state: 'hidden' });
  record('Russian loading/failure/retry; retry uses real dictionary data');

  const result = await ctx.request.get(api + '/dict/chars' + params).then(r => r.json());
  for (const c of result.chars) for (const w of [c, ...c.words]) {
    assert.equal(w.english, false, w.word);
    assert.match(w.meaning, /[а-яё]/i, w.word);
  }
  assert.ok(!(await panel.innerText()).includes('Значения курсивом'));
  assert.ok(!(await panel.innerText()).match(/accidental|thus;|like that|image; pair/));
  assert.equal(await panel.getByRole('link', { name: 'CC-CEDICT', exact: true }).count(), 1);
  await panel.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await panel.screenshot({ path: path.join(out, 'phone.png') });
  record('偶 and 尔 plus suggested words are Russian; credit kept; no phone overflow');

  await page.unroute('**/api/dict/chars?*');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await panel.waitFor();
  await panel.getByText(result.chars[0].meaning, { exact: true }).waitFor();
  assert.equal(localizeCalls, 2, 'reload uses cached Russian without a new localization request');
  assert.deepEqual(errors, []);
  record('Reload uses shared Russian cache; no browser errors');
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ checks, chars: result.chars, errors }, null, 2));
} finally {
  await ctx.close();
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
}
