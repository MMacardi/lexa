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
  ['今天我\n去学校\n\n明天在家', ['今天我\n去学校', '明天在家']],
  ['A. Hello.\nB. Goodbye!', ['Hello.', 'Goodbye!']],
  ['24.\n\n', []],
]) {
  const spans = grammar.sentences(text);
  assert.deepEqual(Array.from(spans, (s) => s.text), expected);
  // Exercise coarse offline segmentation, including punctuation/newline in one token.
  const tokens = grammar.splitSentenceTokens([{ text, wordLike: false }], spans);
  assert.equal(tokens.map((t) => t.text).join(''), text);
  const groups = grammar.sentenceGroups(tokens, spans);
  assert.equal(groups.flatMap((g) => [...g.before, ...g.head, ...g.tail]).map((i) => tokens[i].text).join(''), text);
}
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
  el.onerror(); assert.equal(u.at(-1).text,'明天见！'); assert.equal(u.at(-1).rate,0.75);
  u.at(-1).onstart(); assert.equal(a.useSpeechState('明天见！','zh'),'playing');
  const staleUtterance = u.at(-1);
  a.setSentenceRate(1); a.stopSpeech(); tick();
  assert.equal(u.at(-1),staleUtterance,'stop cancels delayed rate replay');
  a.speak('最后一句。','zh',{sentence:true}); staleUtterance.onend(); staleUtterance.onerror();
  assert.equal(a.useSpeechState('最后一句。','zh'),'loading');
  a.stopSpeech();
  console.log('Server stop/loading, stale callbacks, fallback, live pitch-preserving rate and switches pass');
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
  a.speak('你好','zh',{sentence:true,onUnavailable:()=>failed++});
  setVoices([{lang:'en-US'}]); tick(); assert.equal(failed,1); assert.equal(u.length,0);
  assert.equal(a.useSpeechState('你好','zh'),'stopped');
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
  a.speak('你好','zh'); p[0].onerror();
  assert.equal(u.at(-1).rate,0.95,'word fallback keeps its existing browser pace');
  a.stopSpeech();
  console.log('iOS shared unlocked player, automatic word defaults and stale play rejection pass');
}
console.log('Sentence boundaries and source reconstruction pass');
