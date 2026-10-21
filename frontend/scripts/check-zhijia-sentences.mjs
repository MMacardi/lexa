// Local live Zhijia synthesis/cache and one phone Reader/card playback flow.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli', 'zhijia-sentences');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, devices } = await import('../node_modules/playwright-core/index.mjs');
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
const user = `zhijia-sentence-${Date.now()}`;
const playbackOnly = process.argv.includes('--playback-only');
const sentence = '秋天的下午，我们在图书馆一起学习中文。';
const passage = '今天下午，我们在学校学习中文，下课以后和朋友一起去图书馆看书。'.repeat(12).slice(0, 300);
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8',
    input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
const browser = await chromium.launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'ru-RU', serviceWorkers: 'block' });
const page = await ctx.newPage(), errors = [], clips = [];
page.setDefaultTimeout(45_000);
page.on('pageerror', error => errors.push(error.message));
try {
  const readyBy = Date.now() + 90_000;
  while (true) {
    try { if ((await fetch(app + '/reader', { signal: AbortSignal.timeout(10_000) })).ok) break; } catch {}
    assert.ok(Date.now() < readyBy, 'local frontend is ready');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
  const card = db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4}});
    const {speechCacheKey}=await import('./dist/services/tts.js');
    ${playbackOnly ? '' : `await db.ttsClip.deleteMany({where:{key:{in:${JSON.stringify([sentence, passage])}.map(speechCacheKey)}}});`}
    const w=await db.word.create({data:{userId:u.id,word:'中文',sourceLang:'zh',targetLang:'ru',meaningZh:'китайский язык',
    autoExamples:false,exampleStatus:'ready',collocations:[],synonyms:[],antonyms:[],
    examples:{create:{sentenceEn:${JSON.stringify(sentence)},sentenceZh:'Осенним днём мы вместе учим китайский в библиотеке.',sourceName:'Audio check',sourceUrl:''}}}});console.log(w.id);`);
  let models = [];
  if (!playbackOnly) {
  for (const [i, text] of [sentence, passage].entries()) {
    const url = api + '/tts?lang=zh&text=' + encodeURIComponent(text) + '&v=zhijia-1';
    const started = Date.now(), first = await ctx.request.get(url, { timeout: 60_000 });
    assert.equal(first.status(), 200, await first.text());
    assert.match(first.headers()['content-type'], /audio\/mpeg/);
    const bytes = await first.body(), freshMs = Date.now() - started;
    const second = await ctx.request.get(url);
    assert.equal(second.status(), 200); assert.ok(bytes.equals(await second.body()));
    clips.push({ chars: text.length, bytes: bytes.length, freshMs });
    fs.writeFileSync(path.join(out, i ? 'passage.mp3' : 'sentence.mp3'), bytes);
  }
  models = JSON.parse(db(`console.log(JSON.stringify(await db.tokenUsage.findMany({where:{telegramId:${JSON.stringify(user)},feature:'tts'},select:{model:true,promptTokens:true}})));`));
  assert.equal(models.length, 2, 'only fresh synthesis logs usage');
  assert.ok(models.every(row => row.model === 'sambert-zhijia-v1'));
  assert.ok(models.some(row => row.promptTokens === 300));
  console.log('PASS live sentence + 300-character passage: Zhijia model, MP3 and identical cached replay');
  fs.writeFileSync(path.join(out, 'synthesis.json'), JSON.stringify({ clips, models }, null, 2));
  }
  await ctx.addInitScript(() => {
    localStorage.setItem('lexa.locale', 'ru');
    localStorage.setItem('lexa.autoGloss', '0');
    localStorage.setItem('lexa.showTextLevel', '0');
    localStorage.setItem('lexa.sentenceRate', '1');
    window.__audio = []; window.__spoken = [];
    const NativeAudio = window.Audio;
    window.Audio = function (...args) { const el = new NativeAudio(...args); window.__audio.push(el); return el; };
    const speak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = utterance => { window.__spoken.push({ volume: utterance.volume }); speak(utterance); };
  });
  await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
  await page.locator('textarea').filter({ visible: true }).first().fill(sentence);
  await page.getByRole('button', { name: 'Читать', exact: true }).click();
  async function playAndCheck(group) {
    await group.getByRole('button', { name: 'Прослушать', exact: true }).click();
    await page.waitForFunction(() => window.__audio.some(a => a.src.includes('/tts?') && !a.paused && a.currentTime > 0));
    const media = await page.evaluate(() => { const a = window.__audio.at(-1); return { src: a.src, rate: a.playbackRate, duration: a.duration, fallback: window.__spoken.filter(u => u.volume !== 0).length }; });
    assert.equal(new URL(media.src).searchParams.get('v'), 'zhijia-1');
    assert.equal(new URL(media.src).searchParams.get('text'), sentence);
    assert.equal(media.rate, 1); assert.ok(media.duration > 1); assert.equal(media.fallback, 0);
    await group.getByRole('button', { name: 'Остановить', exact: true }).click();
    return media;
  }
  const reader = await playAndCheck(page.locator('[data-sentence-audio]').first());
  await page.evaluate(id => sessionStorage.setItem('lexa.reviewFocusIds', JSON.stringify([id])), card);
  await page.goto(app + '/review', { waitUntil: 'domcontentloaded' });
  await page.locator('.flip-card').waitFor();
  await page.locator('.flip-card').click({ position: { x: 30, y: 35 } });
  await page.locator('.flip-card.is-flipped').waitFor();
  const example = await playAndCheck(page.locator('.flip-back .flex.items-start.gap-2').first());
  assert.deepEqual(errors, []);
  console.log('PASS phone Reader and card sentences: real MP3 playback, new cache URL, normal speed, no browser voice/errors');
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ clips, models, reader, example, errors }, null, 2));
} finally {
  await ctx.close(); await browser.close();
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});
    if(await db.user.count({where:{telegramId:${JSON.stringify(user)}}})) throw new Error('Test cleanup failed');`);
}
