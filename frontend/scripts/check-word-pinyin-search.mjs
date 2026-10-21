// Local Part 17 behavior check: saved cards only, no live AI or dictionary calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli/word-pinyin-search');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli/browsers');
const { chromium } = await import('../node_modules/playwright-core/index.mjs');
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
const user = `pinyin-search-${Date.now()}`, reproduce = process.argv.includes('--reproduce');
const checks = [], errors = [], requests = [];
const record = value => { checks.push(value); console.log('PASS ' + value); };
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
const ctx = await chromium.launchPersistentContext(path.join(out, `profile-${Date.now()}`), {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 }, locale: 'ru-RU',
});
const page = ctx.pages()[0];
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(60000);
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (new URL(request.url()).pathname.startsWith('/api/')) requests.push({ method: request.method(), path: new URL(request.url()).pathname });
});
await ctx.addInitScript(() => {
  localStorage.setItem('lexa.locale', 'ru');
  // Search must also work with transcription hints turned off.
  localStorage.setItem('lexa.showTranscription', '0');
});
let fixture;
const search = () => page.getByPlaceholder(reproduce ? 'Поиск по словам' : 'Слово, пиньинь или перевод', { exact: true });
async function rows(keys) {
  const expected = keys.map(key => '/word/' + fixture.ids[key]).sort();
  await page.waitForFunction(expected => {
    const actual = [...document.querySelectorAll('a[href^="/word/"]')].map(a => a.getAttribute('href')).sort();
    return JSON.stringify(actual) === JSON.stringify(expected);
  }, expected);
}
async function find(query, keys) { await search().fill(query); await rows(keys); }
async function pick(trigger, option) {
  await trigger.click();
  await page.getByRole('button', { name: option, exact: true }).click();
}
try {
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
  fixture = JSON.parse(db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,firstName:'Поиск',nativeLang:'ru',hskTarget:3,levels:{zh:'B1'}}});
    const specs=[
      {key:'hello',word:'你好',phonetic:'nǐ hǎo',meaningZh:'привет',reviewCount:1},
      {key:'girl',word:'女孩',phonetic:'nǚ hái',meaningZh:'девочка',reviewCount:6,nextReviewAt:new Date(Date.now()+86400000)},
      {key:'repeat',word:'重',phonetic:'chóng',meaningZh:'снова'},
      {key:'heavy',word:'重',phonetic:null,meaningZh:'тяжёлый'},
      {key:'english',word:'你好',phonetic:'ni3 hao3',meaningZh:'hello',targetLang:'en',reviewCount:6},
      {key:'effort',word:'努',phonetic:'nǔ',meaningZh:'стараться'},
      {key:'traditional',word:'傳統',phonetic:'   ',meaningZh:'традиция',sourceLang:'zh-Hant'}
    ];const ids={};for(const {key,...s} of specs){ids[key]=(await db.word.create({data:{userId:u.id,sourceLang:'zh',targetLang:'ru',collocations:[],synonyms:[],antonyms:[],autoExamples:false,familyAt:new Date(),...s}})).id;}
    const coll=await db.collection.create({data:{userId:u.id,name:'Part 17',words:{connect:[{id:ids.hello},{id:ids.repeat}]}}});
    console.log(JSON.stringify({ids,coll:coll.id}));`));
  const all = Object.keys(fixture.ids);
  await page.goto(app + '/words', { waitUntil: 'networkidle' });
  await search().waitFor(); await rows(all);
  if (reproduce) {
    await find('你好', ['hello', 'english']);
    await find('nihao', []);
    await find('nvhai', []);
    record('before fix: hanzi works; unspaced pinyin nihao/nvhai fails for saved cards');
  } else {
    const beforeTyping = requests.length;
    for (const q of ['nihao', 'ni hao', 'nǐhǎo', 'nǐ hǎo', 'ni3hao3', 'ni3 hao3', ' NIHAO ', 'ni-hao', "ni'hao", 'ni’hao', 'ni·hao', 'ni\thao', 'nǐhǎo'.normalize('NFD')]) {
      await find(q, ['hello', 'english']);
    }
    record('saved 你好 matches unspaced, spaced, marked, numbered, case and separator variants');
    for (const q of ['nvhai', 'nü hai', 'nu:hai', 'nǚhái', 'nv3hai2', 'NU:3 HAI2', 'nǚhái'.normalize('NFD')]) await find(q, ['girl']);
    await find('nu', ['effort']);
    record('ü/u:/v and combining tone marks match 女孩 without conflating 努');
    for (const q of ['chong', 'chóng', 'chong2']) await find(q, ['repeat']);
    for (const q of ['zhong', 'zhòng', 'zhong4']) await find(q, ['heavy']);
    await find('chuantong', ['traditional']);
    record('saved polyphonic chóng wins; legacy 重 falls back to actual local zhòng; zh-Hant/blank reading works');
    await find('ДЕВОЧ', ['girl']); await find('你好', ['hello', 'english']);
    await find('重', ['repeat', 'heavy']);
    for (const q of ['xiexie', '谢谢', '!!!', '3', '你好ni', 'nihao9']) await find(q, []);
    await find('   ', all); await find('', all);
    assert.deepEqual(requests.slice(beforeTyping), [], 'typing must not request the API');
    record('Russian/hanzi/clear search preserved; unsaved words and invalid pinyin absent; zero API requests while typing');

    await find('nihao', ['hello', 'english']);
    await pick(page.getByRole('button', { name: 'Пара', exact: true }), 'Китайский → Русский · 5');
    await rows(['hello']);
    await pick(page.getByRole('button', { name: 'Все слова', exact: true }), 'Part 17 2');
    await rows(['hello']);
    await page.getByRole('button', { name: 'Выучено 2', exact: true }).click(); await rows([]);
    await page.getByRole('button', { name: 'В процессе 5', exact: true }).click(); await rows(['hello']);
    await page.getByRole('button', { name: 'К повторению 6', exact: true }).click(); await rows(['hello']);
    await find('', ['hello', 'repeat']);
    await pick(page.getByRole('button', { name: 'Пара', exact: true }), 'Китайский → Английский · 1'); await rows([]);
    await pick(page.getByRole('button', { name: 'Part 17 · 2', exact: true }), 'Все слова'); await rows(['english']);
    await pick(page.getByRole('button', { name: 'Пара', exact: true }), 'Все языки');
    await page.getByRole('button', { name: 'Все 7', exact: true }).click(); await rows(all);
    record('pinyin and clear query combine with pair, collection, learning, mastered and due filters');

    await page.setViewportSize({ width: 390, height: 844 });
    await find('ni3hao3', ['hello', 'english']);
    await search().focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('nvhai'); await rows(['girl']);
    assert(await search().evaluate(el => el === document.activeElement), 'phone search keeps focus');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone has no horizontal overflow');
    await page.locator('a[href="/word/' + fixture.ids.girl + '"]').click({ trial: true });
    await find('', all);
    record('Russian 390×844 phone: numbered/unspaced pinyin, typing/focus, result action and clear query work');

    const saved = JSON.parse(db(`console.log(JSON.stringify(await db.word.findMany({where:{user:{telegramId:${JSON.stringify(user)}}},select:{id:true,phonetic:true}})));`));
    assert.equal(saved.length, all.length);
    assert.equal(saved.find(w => w.id === fixture.ids.heavy).phonetic, null);
    assert.deepEqual(errors, []);
    record('no added cards, no persisted fallback readings, no browser errors');
  }
} catch (error) {
  fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify(await page.evaluate(() => ({
    url: location.href,
    inputs: [...document.querySelectorAll('input')].map(el => ({ placeholder: el.placeholder, value: el.value })),
    buttons: [...document.querySelectorAll('button')].map(el => ({ text: el.textContent, label: el.getAttribute('aria-label') })).slice(0, 50),
    cards: [...document.querySelectorAll('a[href^="/word/"]')].map(el => el.textContent),
  })), null, 2));
  throw error;
} finally {
  fs.writeFileSync(path.join(out, reproduce ? 'before.json' : 'result.json'), JSON.stringify({ checks, errors, requests }, null, 2));
  try {
    db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
  } finally { await ctx.close(); }
}
