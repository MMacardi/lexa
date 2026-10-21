// Focused local learner playback and original WAV/MP3 onset comparison.
// Generate backend inspect-tts/check-tts-words fixtures first; serve
// .playwright-cli/word-audio on 127.0.0.1:8766 (python -m http.server).
// Windows WebKit's API-media fallback also appears in Part 4's saved evidence;
// pass phone-webkit to diagnose it. Default checks require real Chromium MP3s.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), out = path.join(root, '.playwright-cli', 'word-audio');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, webkit, devices } = await import('../node_modules/playwright-core/index.mjs');
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
const words = ['顺', '序', '顺序', '味', '儿', '味道'], sentence = '我们按顺序来。';
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
for (const { name, engine, ...options } of [
  { name: 'phone-chromium', engine: chromium, ...devices['Pixel 7'] },
  { name: 'desktop-chromium', engine: chromium, viewport: { width: 1280, height: 900 } },
  { name: 'phone-webkit', engine: webkit, ...devices['iPhone 13'] },
].filter(c => process.argv[2] ? process.argv[2] === c.name : c.name !== 'phone-webkit')) {
  const browser = await engine.launch({ headless: true, downloadsPath: out });
  const ctx = await browser.newContext({ ...options, locale: 'ru-RU', serviceWorkers: 'block' });
  const page = await ctx.newPage(), user = `word-audio-${name}-${Date.now()}`, checks = [];
  const network = [];
  page.on('response', r => { if (r.url().includes('/tts?')) network.push({ url: r.url(), status: r.status() }); });
  page.on('requestfailed', r => { if (r.url().includes('/tts?')) network.push({ url: r.url(), failure: r.failure() }); });
  page.setDefaultTimeout(20_000);
  try {
    await ctx.addInitScript(() => {
      localStorage.setItem('lexa.locale', 'ru');
      localStorage.setItem('lexa.autoGloss', '0'); localStorage.setItem('lexa.showTextLevel', '0');
      if (localStorage.getItem('lexa.sentenceRate') === null) localStorage.setItem('lexa.sentenceRate', '1');
      window.__audio = []; window.__spoken = []; window.__audioErrors = [];
      const NativeAudio = window.Audio;
      window.Audio = function (...args) {
        const a = new NativeAudio(...args); window.__audio.push(a);
        a.addEventListener('error', () => window.__audioErrors.push({ src: a.src, code: a.error?.code, message: a.error?.message }));
        const play = a.play.bind(a);
        a.play = () => play().catch(e => { window.__audioErrors.push({ name: e.name, message: e.message, src: a.src }); throw e; });
        return a;
      };
      const synth = { speaking: false, pending: false, getVoices: () => [{ lang: 'zh-CN' }],
        addEventListener() {}, removeEventListener() {}, cancel() {}, resume() {},
        speak(u) { window.__spoken.push(u); if (u.volume !== 0) setTimeout(() => u.onstart?.(), 10); },
      };
      Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    });
    assert.equal((await ctx.request.get(api + '/tts?lang=zh&text=顺&v=word-3')).status(), 401);
    assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
    const ids = JSON.parse(db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});const ids=[];for(const word of ${JSON.stringify(words)}){const w=await db.word.create({data:{userId:u.id,word,meaningZh:'Проверка аудио',sourceLang:'zh',targetLang:'ru',collocations:[],synonyms:[],antonyms:[],familyAt:new Date(),autoExamples:false,exampleStatus:'ready',examples:{create:{sentenceEn:${JSON.stringify(sentence)},sentenceZh:'Давайте по порядку.',sourceName:'Audio check',sourceUrl:'',checkedAt:new Date()}}}});ids.push(w.id)}console.log(JSON.stringify(ids));`));
    for (const [i, word] of words.entries()) {
      const url = api + '/tts?lang=zh&text=' + encodeURIComponent(word) + '&v=word-3';
      const clip = await ctx.request.get(url);
      assert.equal(clip.status(), 200, word); assert.match(clip.headers()['cache-control'], /private.*immutable/);
      const range = await ctx.request.get(url, { headers: { Range: 'bytes=0-1' } });
      assert.equal(range.status(), 206); assert.equal((await range.body()).length, 2);
      assert.match(range.headers()['content-range'], /^bytes 0-1\//);
      await page.goto(app + '/word/' + ids[i], { waitUntil: 'domcontentloaded' });
      const play = page.getByRole('button', { name: 'Прослушать', exact: true }).first();
      await play.click();
      await page.waitForFunction(() => window.__audio.some(a => a.getAttribute('src') && !a.paused && a.currentTime > 0));
      const media = await page.evaluate(() => {
        const a = window.__audio.at(-1);
        return { src: a.src, rate: a.playbackRate, pitch: a.preservesPitch, fallback: window.__spoken.filter(u => u.volume !== 0).length };
      });
      assert.equal(new URL(media.src).searchParams.get('v'), 'word-3');
      assert.equal(new URL(media.src).searchParams.get('text'), word);
      assert.equal(media.rate, 1); assert.equal(media.pitch, true); assert.equal(media.fallback, 0);
      await page.waitForFunction(() => window.__audio.at(-1).paused);
      await play.click();
      await page.waitForFunction(() => !window.__audio.at(-1).paused && window.__audio.at(-1).currentTime > 0);
      checks.push({ word, ...media, replay: true, httpBytes: (await clip.body()).length });
    }
    await page.waitForFunction(() => window.__audio.at(-1).paused);
    const slowWord = await page.evaluate(async () => {
      const a = window.__audio.at(-1); a.currentTime = 0; a.playbackRate = .75;
      await a.play(); return { src: a.src, rate: a.playbackRate, pitch: a.preservesPitch };
    });
    assert.equal(slowWord.rate, .75); assert.equal(slowWord.pitch, true);
    await page.waitForFunction(() => window.__audio.at(-1).ended);
    await page.evaluate(() => { window.__audio.at(-1).playbackRate = 1; });
    checks.push({ slowWord });
    const example = page.locator('[data-sentence-audio]');
    await example.getByRole('button', { name: 'Прослушать', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-sentence-audio]')?.dataset.speechState === 'playing');
    const normal = await page.evaluate(() => { const a = window.__audio.at(-1); return { src: a.src, rate: a.playbackRate, duration: a.duration }; });
    assert.equal(normal.rate, 1); assert.equal(new URL(normal.src).searchParams.get('v'), 'zhijia-1');
    await example.getByRole('button', { name: 'Скорость предложения: 1×', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__audio.at(-1).playbackRate), .75);
    await example.getByRole('button', { name: 'Остановить', exact: true }).click();
    await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
    await page.locator('textarea').filter({ visible: true }).first().fill(sentence);
    await page.getByRole('button', { name: 'Читать', exact: true }).click();
    const reader = page.locator('[data-sentence-audio]').first();
    await reader.getByRole('button', { name: 'Скорость предложения: 0.75×', exact: true }).click();
    await reader.getByRole('button', { name: 'Прослушать', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-sentence-audio]')?.dataset.speechState === 'playing');
    assert.equal(await page.evaluate(() => window.__audio.at(-1).src), normal.src);
    assert.equal(await page.evaluate(() => window.__audio.at(-1).playbackRate), normal.rate);
    assert.equal(await page.evaluate(() => window.__audio.at(-1).duration), normal.duration);
    await reader.getByRole('button', { name: 'Остановить', exact: true }).click();
    // A rejected synthesis uses the existing fallback. Its sound is NOT validated here.
    await page.route('**/api/tts?**', r => r.fulfill({ status: 502, body: 'tts_failed' }));
    await reader.getByRole('button', { name: 'Прослушать', exact: true }).click();
    await page.waitForFunction(s => window.__spoken.some(u => u.text === s), sentence);
    checks.push({ sentence, wordPage: normal, readerSameClipAndRate: true, controlledFallback: 'browser fixture; tone unverified' });
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(checks, null, 2));
    console.log(`${name}: six real Mandarin word/replay clips, versioned URL, auth/range/cache, sentence 1×/0.75× and Reader pace pass`);
  } catch (error) {
    console.error(name, page.url(), error.message);
    const debug = await page.evaluate(() => ({
      audio: window.__audio?.map(a => ({ src: a.src, paused: a.paused, time: a.currentTime, error: a.error?.message })),
      spoken: window.__spoken?.map(u => ({ text: u.text, lang: u.lang })),
      buttons: [...document.querySelectorAll('[data-speech-state]')].map(a => a.dataset.speechState),
      audioErrors: window.__audioErrors,
    })).catch(() => ({}));
    console.error(JSON.stringify(debug));
    console.error(JSON.stringify(network));
    throw error;
  } finally {
    db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
    await ctx.close(); await browser.close();
  }
}
// MP3 adds encoder delay; compare full waveforms after alignment, without trimming.
if (!process.argv.includes('--app-only')) {
const browser = await chromium.launch({ headless: true, downloadsPath: out });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8766/zhijia-service/');
  const metrics = await page.evaluate(async () => {
    const manifest = await (await fetch('manifest.json')).json(), result = [];
    const audio = new AudioContext({ sampleRate: 48000 });
    for (const f of manifest) {
      const decode = async file => (await audio.decodeAudioData(await (await fetch(file)).arrayBuffer())).getChannelData(0);
      const wav = await decode(f.wav), mp3 = await decode(f.mp3);
      let best = { correlation: -1, delaySamples: 0 };
      for (let delay = 0; delay <= 4800; delay += 4) {
        let cross = 0, a2 = 0, b2 = 0;
        for (let i = 0; i < wav.length && i + delay < mp3.length; i += 4) {
          const a = wav[i], b = mp3[i + delay]; cross += a * b; a2 += a * a; b2 += b * b;
        }
        const correlation = cross / Math.sqrt(a2 * b2);
        if (correlation > best.correlation) best = { correlation, delaySamples: delay };
      }
      result.push({ text: f.word, ...best, wavSeconds: wav.length / 48000, mp3Seconds: mp3.length / 48000 });
    }
    await audio.close(); return result;
  });
  fs.writeFileSync(path.join(out, 'compression.json'), JSON.stringify(metrics, null, 2));
  for (const f of metrics) {
    assert.ok(f.correlation > .85, `${f.text}: WAV/MP3 correlation ${f.correlation}`);
    assert.ok(f.mp3Seconds >= f.wavSeconds - .02, `${f.text}: no gross tail truncation`);
  }
  console.log(`${metrics.length} WAV/MP3 comparisons pass; waveform preservation does not prove tones`);
} finally { await browser.close(); }
}
