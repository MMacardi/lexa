// Deterministic engine checks: timers/events must never resurrect cancelled audio.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../node_modules/typescript/lib/typescript.js';
function load(file, globals = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText;
  vm.runInNewContext(js, { exports, require: (name) => {
    if (name === 'react') return { useSyncExternalStore: (_sub, snapshot) => snapshot() };
    if (name === './api') return { ttsUrl: (text, lang) => `/tts?text=${encodeURIComponent(text)}&lang=${lang}` };
    if (name === './sentences') return grammar;
    throw new Error(name);
  }, ...globals });
  return exports;
}
const grammar = load('../lib/sentences.ts');
for (const [text, expected] of [
  ['24. 今天下雨。\n25. 明天见！\n', ['今天下雨。', '明天见！']],
  ['24.\n今天下雨。\n\n25. 明天见！', ['今天下雨。', '明天见！']],
  ['价格是24.75元。值3.14。', ['价格是24.75元。', '值3.14。']],
  ['3.14 is pi. Version 2.4 works! Really?!', ['3.14 is pi.', 'Version 2.4 works!', 'Really?!']],
  ['他说：“你好！”\n她说：「再见。」', ['他说：“你好！”', '她说：「再见。」']],
  ['今天我\n去学校\n\n明天在家', ['今天我', '去学校', '明天在家']],
  ['A. Hello.\nB. Goodbye!', ['Hello.', 'Goodbye!']],
  ['24.\n\n', []],
  ['31. 今天下雨\n32. 明天见\n33. 你去哪里\nA. 学校\nB. 商店\nC. 家\n34. 我在家', ['今天下雨', '明天见', '你去哪里', '学校', '商店', '家', '我在家']],
  ['31. 你去哪里 A. 学校 B. 商店 C. 家\n32.\n你叫什么名字\n33、 今天很好\n（34） 再见', ['你去哪里', '学校', '商店', '家', '你叫什么名字', '今天很好', '再见']],
  ['31.\n32)\nA.\nB、\n123\n3.14\n', []],
  ['只有一行没有标点'.repeat(50), ['只有一行没有标点'.repeat(50)]],
]) {
  const spans = grammar.sentences(text);
  assert.deepEqual(Array.from(spans, (s) => s.text), expected);
  for (const s of spans) assert.equal(text.slice(s.start, s.end), s.text, 'spoken/captured source offsets');
  // Exercise coarse offline segmentation, including punctuation/newline in one token.
  const tokens = grammar.splitSentenceTokens([{ text, wordLike: false }], spans);
  assert.equal(tokens.map((t) => t.text).join(''), text);
  const groups = grammar.sentenceGroups(tokens, spans);
  assert.equal(groups.flatMap((g) => [...g.before, ...g.head, ...g.tail]).map((i) => tokens[i].text).join(''), text);
}
for (const text of ['中文'.repeat(330), '今天我去学校，'.repeat(70), '学习中文 '.repeat(90), '学'.repeat(119)+'𠮷'+'好'.repeat(302)]) {
  const chunks = Array.from(grammar.speechChunks(text));
  assert.equal(chunks.map(c=>c.text).join(''), text, 'no truncation or added speech');
  for (const c of chunks) {
    assert.ok(c.text.length > 0 && c.text.length <= grammar.SPEECH_CHUNK_CHARS);
    assert.equal(text.slice(c.start,c.end),c.text);
    assert.ok(!/[\uD800-\uDBFF]$/.test(c.text) && !/^[\uDC00-\uDFFF]/.test(c.text));
  }
}
assert.ok(grammar.speechChunks('学'.repeat(90)+'，'+'习'.repeat(180))[0].text.endsWith('，'));
function engine({ voices = [{ lang: 'zh-CN' }, { lang: 'en-US' }], audio = true } = {}) {
  let timers = new Map(), clock = 0, next = 0;
  const events = new Map(), utterances = [], players = [], storage = new Map();
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => voices,
    addEventListener: (name, fn) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener: (name, fn) => events.get(name)?.delete(fn),
    speak: (u) => { utterances.push(u); synth.pending = true; },
    cancel: () => { synth.speaking = synth.pending = false; }, resume() { synth.paused = false; },
  };
  class FakeAudio {
    paused = true; src = ''; playbackRate = 1; preservesPitch = false;
    constructor() { players.push(this); }
    play() { this.paused = false; return new Promise((_ok, fail) => { this.reject = fail; }); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
  }
  const api = load('../lib/speak.ts', {
    window: { speechSynthesis: synth, addEventListener() {} },
    Audio: audio ? FakeAudio : undefined,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    localStorage: { getItem: (k) => storage.get(k), setItem: (k,v) => storage.set(k,v) },
    setTimeout: (fn, ms) => { timers.set(++next, { fn, at: clock + ms }); return next; },
    clearTimeout: (id) => timers.delete(id),
    URL: { createObjectURL: () => 'blob:silence' }, Blob,
  });
  const tick = (ms = 1000) => {
    const until = clock + ms;
    while (true) {
      const due = [...timers].filter(([,t]) => t.at <= until).sort((a,b) => a[1].at-b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); clock = due[1].at; due[1].fn();
    }
    clock = until;
  };
  return { api, tick, synth, utterances, players, storage, events, setVoices: (v) => { voices = v; } };
}
{
  const { api:a, players:p, utterances:u, tick } = engine();
  assert.equal(a.speak('今天下雨。', 'zh', { sentence:true, owner:'reader' }), true);
  const el = p[0], oldError = el.onerror, oldPlaying = el.onplaying;
  assert.equal(a.useSpeechState('今天下雨。','zh'), 'loading');
  a.stopSpeech(); oldError(); oldPlaying(); tick();
  assert.equal(u.length,0); assert.equal(el.src,'');
  assert.equal(a.useSpeechState('今天下雨。','zh'),'stopped');
  a.speak('今天下雨。','zh',{sentence:true}); el.onplaying();
  assert.equal(a.useSpeechState('今天下雨。','zh'),'playing');
  a.setSentenceRate(0.75); assert.equal(el.playbackRate,0.75); assert.equal(el.preservesPitch,true);
  const staleEnd=el.onended, staleFail=el.onerror;
  a.speak('明天见！','zh',{sentence:true}); staleEnd(); staleFail();
  assert.equal(a.useSpeechState('明天见！','zh'),'loading'); assert.equal(u.length,0);
  el.onerror(); assert.equal(u.length,0,'Mandarin never silently falls back');
  assert.equal(a.useSpeechState('明天见！','zh'),'error');
  a.setSentenceRate(1); assert.equal(a.useSpeechState('明天见！','zh'),'error');
  a.speak('最后一句。','zh',{sentence:true}); staleEnd(); staleFail();
  assert.equal(a.useSpeechState('最后一句。','zh'),'loading');
  a.stopSpeech();
  console.log('Server stop/loading, stale callbacks, visible failure, live pitch-preserving rate and switches pass');
}
{
  const {api:a, tick, synth, utterances:u} = engine({audio:false});
  synth.speaking=true;
  a.speak('Hello','en',{sentence:true}); a.stopSpeech(); tick(); assert.equal(u.length,0);
  a.speak('Hello','en',{sentence:true});
  assert.equal(u[0].volume,0,'silent onset primer preserved'); assert.equal(u[1].rate,1);
  u[1].onstart(); a.setSentenceRate(0.75); tick(); assert.equal(u.at(-1).rate,0.75);
  a.stopSpeech('unrelated'); assert.notEqual(a.useSpeechState('Hello','en'),'stopped');
  a.stopSpeech();
  console.log('Browser cancellation delay, onset primer, rate replay and unrelated cleanup pass');
}
{
  const {api:a,tick,setVoices,events,utterances:u} = engine({voices:[],audio:false});
  a.speak('Hello','en',{sentence:true}); a.stopSpeech();
  for (const fn of events.get('voiceschanged') ?? []) fn(); tick(); assert.equal(u.length,0);
  let failed=0;
  a.speak('Привет','ru',{sentence:true,onUnavailable:()=>failed++});
  setVoices([{lang:'en-US'}]); tick(); assert.equal(failed,1); assert.equal(u.length,0);
  assert.equal(a.useSpeechState('Привет','ru'),'error');
  assert.equal(a.speak('你好','zh'),false);
  console.log('Voice-load stop, voice-language recheck and unavailable state pass');
}
{
  const {api:a,players:p,tick,utterances:u} = engine();
  a.unlockSpeech(); const unlocked=p[0];
  a.speak('你好','zh'); assert.equal(p[0],unlocked); assert.equal(p.length,1);
  assert.equal(p[0].playbackRate,1,'review/quiz keep natural server rate');
  const reject=p[0].reject;
  a.stopSpeech(); reject({name:'NotAllowedError'}); await Promise.resolve(); tick(); assert.equal(u.length,1,'only unlock primer exists');
  let failed=0;
  a.speak('你好','zh',{onUnavailable:()=>failed++}); p[0].onerror();
  assert.equal(failed,1); assert.equal(u.length,1,'no browser word fallback');
  a.unlockSpeech(); assert.equal(p[0].src,'blob:silence','a failed clip must not block the next iOS unlock');
  a.stopSpeech();
  console.log('iOS shared unlocked player, automatic word defaults and stale play rejection pass');
}
{
  const {api:a,players:p,utterances:u}=engine();
  const text='今天学习中文'.repeat(110), expected=Array.from(grammar.speechChunks(text),c=>c.text);
  let failed=0;
  a.speak(text,'zh',{sentence:true,onUnavailable:()=>failed++});
  const el=p[0], read=()=>new URL(el.src,'http://local').searchParams.get('text');
  const played=[read()]; el.onplaying(); const oldError=el.onerror, oldEnd=el.onended;
  el.onended(); played.push(read()); oldError(); oldEnd();
  assert.equal(read(),expected[1],'retired chunk events cannot advance/fail current chunk');
  el.onerror(); assert.equal(failed,1); assert.equal(a.useSpeechState(text,'zh'),'error');
  a.speak(text,'zh',{sentence:true}); assert.equal(read(),expected[1],'explicit retry resumes failed chunk');
  a.setSentenceRate(.75); assert.equal(el.playbackRate,.75);
  for(let i=2;i<expected.length;i++){el.onended();played.push(read());assert.equal(el.playbackRate,.75);}
  el.onended(); assert.equal(a.useSpeechState(text,'zh'),'stopped');
  assert.deepEqual(played,expected); assert.equal(played.join(''),text); assert.equal(u.length,0);
  a.speak(text,'zh',{sentence:true}); const lateEnd=el.onended;
  a.stopSpeech(); lateEnd(); assert.equal(el.src,'');
  a.speak('31.','zh'); assert.ok(el.src.includes('/tts?'),'Mandarin never chooses browser by content/length');
  a.stopSpeech();
  console.log('Bounded complete queue, per-chunk event isolation, failed-chunk retry and queued stop pass');
}
console.log('Sentence boundaries and source reconstruction pass');
