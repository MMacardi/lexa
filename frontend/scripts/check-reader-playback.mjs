// Adversarial lifecycle checks complement real local MP3 playback.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../node_modules/typescript/lib/typescript.js';
const modules={},players=[],requests=[],revoked=[];let blobId=0;
let deferPrimer=false,releasePrimer,rejectPrimer;
class FakeAudio{
  src='';paused=true;currentTime=0;playbackRate=1;
  constructor(){players.push(this);}
  play(){
    this.paused=false;
    if(deferPrimer){deferPrimer=false;return new Promise((resolve,reject)=>{releasePrimer=resolve;rejectPrimer=reject;});}
    this.onplaying?.();return Promise.resolve();
  }
  pause(){this.paused=true;}
  removeAttribute(){this.src='';this.currentTime=0;}
  load(){}
}
function load(file){
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023},
  }).outputText,{exports,require:name=>{
    if(name==='react')return {useSyncExternalStore:(_sub,snap)=>snap()};
    if(name==='./api')return {ttsUrl:(text,lang)=>'http://local/tts?lang='+lang+'&text='+encodeURIComponent(text)};
    if(modules[name])return modules[name];throw new Error(name);
  },window:{addEventListener(){}},Audio:FakeAudio,localStorage:{getItem(){},setItem(){}},
  URL:{createObjectURL:()=>`blob:${++blobId}`,revokeObjectURL:url=>revoked.push(url)},Blob,
  setTimeout,clearTimeout,AbortController,
  fetch:(url,options)=>new Promise((resolve,reject)=>{
    requests.push({url,options,resolve,reject});
    options.signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true});
  }),
  });
  return exports;
}
modules['./sentences']=load('../lib/sentences.ts');modules['./speak']=load('../lib/speak.ts');
const {ReaderPlayback}=load('../lib/readerPlayback.ts');
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
const resolve=r=>r.resolve({ok:true,headers:{get:()=> 'audio/mpeg'},blob:async()=>new Blob(['real-audio-fixture'])});
const text='今天下雨。\n明天在家。\n我们去学校。\n最后结束。';
const p=new ReaderPlayback(text,'zh','reader');
assert.equal(requests.length,0);p.play();assert.equal(requests.length,1);
p.pause();p.play();assert.equal(p.getSnapshot().status,'loading');assert.equal(requests.length,1);
resolve(requests[0]);await flush();assert.equal(p.getSnapshot().status,'playing');assert.equal(requests.length,2);
const el=players[0];el.currentTime=3;p.pause();p.play();assert.equal(el.currentTime,3);
const src=el.src;p.setRate(1.5);assert.equal(el.src,src);assert.equal(el.playbackRate,1.5);assert.equal(requests.length,2);
const oldEnd=el.onended,oldFail=el.onerror;
// Current becomes the pending prefetched clip; do not abort/re-request it.
el.onended();assert.equal(p.getSnapshot().index,1);assert.equal(requests.length,2);assert.equal(requests[1].options.signal.aborted,false);
oldEnd();oldFail();assert.equal(p.getSnapshot().index,1);assert.equal(p.getSnapshot().status,'loading');
requests[1].resolve({ok:false});await flush();assert.equal(p.getSnapshot().status,'error');
p.play();assert.equal(p.getSnapshot().index,1);assert.equal(requests.length,3);resolve(requests[2]);await flush();
assert.equal(p.getSnapshot().status,'playing');assert.equal(requests.length,4);
const lateEnd=el.onended;modules['./speak'].speak('学校','zh');lateEnd();
assert.equal(p.getSnapshot().status,'idle');assert.equal(requests[3].options.signal.aborted,true);
const wordSrc=el.src;resolve(requests[3]);await flush();assert.equal(el.src,wordSrc,'late prefetch never interrupts a word');
p.play();await flush();assert.equal(players.length,1);assert.equal(p.getSnapshot().status,'playing');
p.seek(3);const late=requests.at(-1);assert.equal(p.getSnapshot().index,3);
p.dispose();resolve(late);await flush();assert.equal(el.src,'');assert.equal(p.getSnapshot().loaded,0);
// React development effect replay must be safe after cleanup.
p.activate();p.play();const current=requests.at(-1);resolve(current);await flush();
assert.equal(p.getSnapshot().status,'playing');p.pause();p.seek(1);const waiting=requests.at(-1);
assert.equal(p.getSnapshot().buffering,true);
resolve(waiting);await flush();assert.equal(p.getSnapshot().buffering,false);assert.equal(p.getSnapshot().status,'paused');assert.equal(el.paused,true);
p.play();assert.equal(p.getSnapshot().status,'playing');assert.equal(p.getSnapshot().index,1);
p.stop();assert.equal(el.src,'');assert.ok(revoked.length>0);p.dispose();
deferPrimer=true;
const primed=new ReaderPlayback(text,'zh','primer');primed.play();
const primerSrc=el.src;assert.equal(el.paused,false,'keep gesture primer alive while fetching');
resolve(requests.at(-1));await flush();assert.equal(el.src,primerSrc,'wait for gesture play before replacing source');
releasePrimer();await flush();assert.equal(primed.getSnapshot().status,'playing');primed.dispose();
deferPrimer=true;
const cancelled=new ReaderPlayback(text,'zh','cancelled-primer');cancelled.play();
const latePrimer=requests.at(-1);cancelled.dispose();releasePrimer();resolve(latePrimer);await flush();assert.equal(el.src,'');
const race=new ReaderPlayback(text,'zh','play-race');race.play();
deferPrimer=true;resolve(requests.at(-1));await flush();const rejectOld=rejectPrimer;
assert.equal(race.getSnapshot().status,'loading');race.pause();race.play();await flush();
assert.equal(race.getSnapshot().status,'playing');rejectOld(new Error('Late play rejection after pause'));
await flush();assert.equal(race.getSnapshot().status,'playing');race.dispose();
console.log('Reader playback: bounded prefetch reuse, pause during load/resume, live speed, stale events, failed-unit retry, word interruption, late fetch, seek, cleanup and effect replay pass');
