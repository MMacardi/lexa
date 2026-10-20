// Part 7: one Russian phone check against local APIs and a throwaway account.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli', 'reader-vocabulary');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { webkit, devices } = await import('../node_modules/playwright-core/index.mjs');
const browser = await webkit.launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block' });
const page = await ctx.newPage(), user = `reader-vocabulary-ui-${Date.now()}`;
const api = 'http://localhost:3000/api', app = 'http://localhost:3001';
page.setDefaultTimeout(25_000);
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
async function open(id, locale = 'ru') {
  // Let WebKit finish the current page's API reads before a hard navigation;
  // the phone sidebar also schedules a delayed collections prefetch.
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => r.name.includes('/api/collections?')));
  await page.waitForLoadState('networkidle');
  const full = await (await ctx.request.get(api + '/reader/texts/' + id)).json();
  await page.evaluate(locale => localStorage.setItem('lexa.locale', locale), locale);
  await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
  await page.getByText(full.title, { exact: true }).first().click();
  await page.getByTestId('reader-vocabulary').waitFor();
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => r.name.includes('/api/collections?')));
  await page.waitForLoadState('networkidle');
}
try {
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('lexa.locale')) localStorage.setItem('lexa.locale', 'ru');
    localStorage.setItem('lexa.showTextLevel', '1');
    localStorage.setItem('lexa.autoGloss', '0');
    localStorage.setItem('lexa.rubyAll', '0');
  });
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
  const fixture = JSON.parse(db(`
    const {hskLevelWords,hskTagFor}=await import('./dist/services/hsk.js');
    const {segmentChinese}=await import('./dist/services/segment.js');
    const stable=n=>hskLevelWords('3.0',n).filter(w=>{const t=segmentChinese(w.word);return t.length===1&&t[0].text===w.word});
    const four=stable(4)[0].word, heavy=[...Array(40).fill(four),'我'].join('，');
    const lower=[...stable(1).slice(0,20),...stable(2).slice(0,20),...stable(3).slice(0,22)].map(w=>w.word);
    const upper=stable(5).slice(0,14).map(w=>w.word);
    const example=[...lower,...upper,...Array(8).fill(lower).flat()].join('，');
    const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskVersion:'3.0',hskTarget:4,levels:{zh:'B2'}}});
    const legacy=await db.readerText.create({data:{userId:u.id,title:'Legacy Part 7',content:heavy+'。',level:'HSK 2',sourceLang:'zh',targetLang:'ru'}});
    const requested=await db.readerText.create({data:{userId:u.id,title:'Requested Part 7',content:heavy+'！',level:'HSK 6',levelSource:'requested',sourceLang:'zh',targetLang:'ru'}});
    console.log(JSON.stringify({heavy,example,legacy:legacy.id,requested:requested.id}));
  `));
  const manualRes = await ctx.request.post(api + '/reader/texts', { data: { title: 'Manual Part 7', content: fixture.heavy, sourceLang: 'zh', targetLang: 'ru', level: '6', estimateLevel: true } });
  assert.equal(manualRes.status(), 201);
  const manual = await manualRes.json();
  await page.goto(app + '/reader', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('button', { name: /^Manual Part 7/ }).click();
  await page.getByTestId('reader-vocabulary').getByText('Лексика ≈ HSK 4 · список 3.0', { exact: true }).waitFor();
  await page.getByText('Выбран: HSK 6', { exact: true }).filter({ visible: true }).waitFor();
  await page.getByTestId('reader-vocabulary').locator('summary').click();
  assert.match(await page.getByTestId('reader-vocabulary').innerText(), /не менее 95%/);
  assert.match(await page.getByTestId('reader-off-list').innerText(), /0 уникальных слов · 0 употреблений/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'phone has no horizontal overflow');
  await page.screenshot({ path: path.join(out, 'phone-webkit.png') });
  results.push('manual HSK 6 separate from analyzed HSK 4, visible rule/distribution, phone width');

  await page.getByRole('button', { name: 'Инструменты чтения', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить текст', exact: true }).filter({ visible: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Manual renamed');
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).waitFor({ state: 'detached' });
  const renamed = await (await ctx.request.get(api + '/reader/texts/' + manual.id)).json();
  assert.equal(renamed.level, 'HSK 6'); assert.equal(renamed.levelSource, 'manual');
  await page.getByRole('button', { name: 'Новый текст', exact: true }).click();
  await page.getByRole('button', { name: /^Manual renamed/ }).click();
  await page.getByTestId('reader-vocabulary').getByText('Лексика ≈ HSK 4 · список 3.0', { exact: true }).waitFor();
  results.push('edit title preserves manual level, library reopen recomputes vocabulary');
  console.log('PASS: phone layout, manual level edit and library reopen');

  await open(fixture.legacy);
  await page.getByText('Сохранённая отметка: HSK 2', { exact: true }).filter({ visible: true }).waitFor();
  await page.getByTestId('reader-vocabulary').getByText('Лексика ≈ HSK 4 · список 3.0', { exact: true }).waitFor();
  await open(fixture.requested);
  await page.getByText('Запрошен: HSK 6', { exact: true }).filter({ visible: true }).waitFor();
  results.push('legacy/requested labels separate from fresh vocabulary estimate');
  console.log('PASS: legacy/requested level labels');

  await page.getByRole('button', { name: 'Новый текст', exact: true }).click();
  await page.locator('textarea').first().fill(fixture.example);
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
  await page.getByTestId('reader-vocabulary').getByText('Лексика ≈ HSK 3 · список 3.0', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('reader-new-count').innerText(), 'новых: 76');
  assert.equal(await page.getByTestId('reader-target-count').innerText(), ', из них HSK 1–4: 62');
  const list = await (await ctx.request.get(api + '/reader/texts')).json();
  const auto = list.find(r => r.snippet === fixture.example.slice(0, 140));
  assert(auto); assert.equal(auto.level, null);
  const tokens = (await (await ctx.request.post(api + '/segment', {data:{text:fixture.example}})).json()).tokens.filter(t=>t.wordLike&&/\p{L}/u.test(t.text));
  const distribution = {};
  for (const token of tokens) {const level=token.hsk?.['3.0']??'off-list';distribution[level]=(distribution[level]??0)+1;}
  assert.equal(new Set(tokens.map(t=>t.text)).size,76);
  assert.equal(new Set(tokens.filter(t=>t.hsk?.['3.0']<=4).map(t=>t.text)).size,62);
  results.push({ reconstruction: '76 unique new / 62 HSK 1–4 / vocabulary HSK 3', distribution });
  console.log('PASS: visible 76/62 reconstruction');

  for (const [version, target, range] of [['2.0',4,'1–4'],['3.0',7,'1–9']]) {
    assert.equal((await ctx.request.patch(api+'/auth/me',{data:{hskVersion:version,hskTarget:target}})).status(),200);
    await open(auto.id);
    assert.match(await page.getByTestId('reader-vocabulary').innerText(), new RegExp(`список ${version}`));
    assert.match(await page.getByTestId('reader-target-count').innerText(),new RegExp('HSK '+range+':'));
  }
  for (const [locale, vocab, label] of [['en','Vocabulary ≈ HSK 4','Chosen: HSK 6'],['zh','词汇 ≈ HSK 4','所选等级：HSK 6']]) {
    await open(manual.id,locale);
    assert((await page.getByTestId('reader-vocabulary').innerText()).includes(vocab));
    await page.getByText(label,{exact:true}).filter({visible:true}).waitFor();
  }
  results.push('selected list/7–9 target range and en/zh copy');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'phone-webkit.json'),JSON.stringify(results,null,2));
  console.log('PASS: Russian phone Reader, actual 76/62 token distribution, saved metadata/reopen, both lists, 7–9, en/zh');
} catch (error) {
  await page.screenshot({path:path.join(out,'phone-webkit-failure.png')}).catch(()=>{});
  throw error;
} finally {
  await browser.close();
  db(`await db.user.deleteMany({where:{telegramId:${JSON.stringify(user)}}});`);
}
