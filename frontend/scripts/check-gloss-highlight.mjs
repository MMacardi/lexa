// Russian phone regression: «боль» must not highlight «больнице».
// Run from the project root with the local API and production frontend running.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli/gloss-highlight');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli/browsers');
const { chromium, devices } = await import('../node_modules/playwright-core/index.mjs');
const db = code => execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
  cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
}).trim();
const user = `gloss-highlight-${Date.now()}`;
const browser = await chromium.launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block' });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await ctx.addInitScript(() => localStorage.setItem('lexa.locale', 'ru'));
  assert.equal((await ctx.request.post('http://localhost:3000/api/auth/dev', { data: { telegramId: user } })).status(), 200);
  const meaning = 'добавлять страдания к уже существующим страданиям, усугублять боль (о человеке, ситуации, обиде)';
  const card = db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru'}});
    const w=await db.word.create({data:{userId:u.id,word:'伤口上撒盐',phonetic:'shāng kǒu shàng sā yán',sourceLang:'zh',targetLang:'ru',
    meaningZh:${JSON.stringify(meaning)},autoExamples:false,exampleStatus:'ready',familyAt:new Date(),collocations:[],synonyms:[],antonyms:[],
    senses:{v:5,list:[{meaning:${JSON.stringify(meaning)},pos:'идиома',onCard:true,phrases:[]}]},
    examples:{create:[{sentenceEn:'她妈妈生病住院了，你还说可能治不好，这是伤口上撒盐。',sentenceZh:'Её мама лежит в больнице, а ты ещё и сыплешь соль на рану.',sourceName:'Manual entry',sourceUrl:''},
      {sentenceEn:'别在伤口上撒盐。',sentenceZh:'Не усиливай её боль: она и так измучена болью. От боли ей тяжело.',sourceName:'Manual entry',sourceUrl:''}]}}});console.log(w.id);`);
  await page.goto('http://localhost:3001/word/' + card, { waitUntil: 'networkidle' });
  const hospital = page.locator('p').filter({ hasText: 'Её мама лежит в больнице' });
  await hospital.waitFor();
  assert.equal(await hospital.locator('mark').count(), 0, 'больнице is not an inflection of боль');
  const pain = page.locator('p').filter({ hasText: 'Не усиливай её боль:' });
  assert.deepEqual(await pain.locator('mark').allTextContents(), ['боль', 'болью', 'боли']);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  await hospital.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'phone.png') });
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ hospitalMarks: [], painMarks: await pain.locator('mark').allTextContents(), errors }, null, 2));
  console.log('PASS Russian phone: hospital unmarked; боль/болью/боли marked; no overflow or page errors');
} finally {
  await browser.close();
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
}
