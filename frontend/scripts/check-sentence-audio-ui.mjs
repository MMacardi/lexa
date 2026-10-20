// Local Docker learner flow; real MP3 playback, with controlled HTTP/synthesis failures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), out = path.join(root, '.playwright-cli', 'sentence-audio');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, devices } = await import('../node_modules/playwright-core/index.mjs');
const api = 'http://localhost:3000/api', app = 'http://localhost:3001';
const sentence = '今天下雨，我带着雨伞去学校';
const long = '今天我在学校学习中文然后和朋友一起回家'.repeat(18);
const units = [sentence, '价格是24.75元', '你去哪里', '学校', '商店', '家', '我在家', '今天我', '在家学习中文', long, '最后一句结束了。'];
const source = `31. ${sentence}\n32. ${units[1]}\n33. ${units[2]} A. 学校 B. 商店 C. 家\n34.\n我在家\n35.\n36.\n今天我\n在家学习中文\n${long}\n最后一句结束了。\n`;
function db(code) {
  return execFileSync('docker', ['compose','exec','-T','backend','node','--input-type=module'], {
    cwd:root, encoding:'utf8', input:`import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
// Starting the local container also installs dependencies before Next is ready.
const readyBy=Date.now()+90_000;
while(true){
  try{if((await fetch(app+'/reader',{signal:AbortSignal.timeout(30_000)})).ok)break;}catch{}
  assert.ok(Date.now()<readyBy,'local frontend is ready');
  await new Promise(resolve=>setTimeout(resolve,1000));
}
for (const config of [
  { name:'phone-chromium', engine:chromium, ...devices['Pixel 7'] },
  { name:'desktop-chromium', engine:chromium, viewport:{width:1280,height:900} },
].filter((c) => !process.argv[2] || c.name === process.argv[2])) {
  const {name,engine,...options}=config;
  const browser=await engine.launch({headless:true,downloadsPath:out});
  const ctx=await browser.newContext({...options,locale:'ru-RU',serviceWorkers:'block'});
  const page=await ctx.newPage(), user=`sentence-audio-${name}-${Date.now()}`, errors=[];
  page.setDefaultTimeout(60_000);
  page.on('pageerror', e => { if (!/localhost:(3000|3001).*due to access control checks\.$/.test(e.message)) errors.push(e.message); });
  try {
    await ctx.addInitScript(() => {
      localStorage.setItem('lexa.locale','ru');
      localStorage.setItem('lexa.autoGloss','0'); localStorage.setItem('lexa.showTextLevel','0');
      localStorage.setItem('lexa.examplePinyin','1');
      // Leave sentenceRate intact across reloads. Observe the actual shared media element.
      window.__audio=[]; window.__spoken=[]; window.__voices=sessionStorage.getItem('audio.noVoice') ? [{lang:'en-US'}] : [{lang:'zh-CN'},{lang:'en-US'}];
      const NativeAudio=window.Audio;
      window.Audio=function(...args){const el=new NativeAudio(...args);window.__audio.push(el);return el;};
      const synth={speaking:false,pending:false,paused:false,token:0,getVoices:()=>window.__voices,
        addEventListener(){},removeEventListener(){},resume(){this.paused=false;},
        cancel(){this.token++;this.speaking=this.pending=false;},
        speak(u){window.__spoken.push(u);if(u.volume!==0){this.pending=true;const token=this.token;setTimeout(()=>{if(token!==this.token)return;this.pending=false;this.speaking=true;u.onstart?.();},20);}},
      };
      Object.defineProperty(window,'speechSynthesis',{value:synth,configurable:true});
      window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
    });
    assert.equal((await ctx.request.post(api+'/auth/dev',{data:{telegramId:user}})).status(),200);
    const ids=JSON.parse(db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});const ids=[];for(const [word,meaning] of [['雨伞','зонт'],['学校','школа'],['今天','сегодня'],['明天','завтра']]){const w=await db.word.create({data:{userId:u.id,word,meaningZh:meaning,sourceLang:'zh',targetLang:'ru',collocations:[],synonyms:[],antonyms:[],familyAt:new Date(),autoExamples:false,exampleStatus:'ready',examples:{create:{sentenceEn:${JSON.stringify(sentence)},sentenceZh:'Сегодня идёт дождь, я иду в школу с зонтом.',sourceName:'Audio check',sourceUrl:'',checkedAt:new Date()}}}});ids.push(w.id);}console.log(JSON.stringify(ids));`));
    const clip=await ctx.request.get(api+'/tts?lang=zh&text='+encodeURIComponent(sentence),{timeout:90_000});
    assert.equal(clip.status(),200); assert.match(clip.headers()['content-type'],/audio/);
    fs.writeFileSync(path.join(out,`${name}.mp3`),await clip.body());
    await page.goto(app+'/reader',{waitUntil:'domcontentloaded'});
    await page.locator('textarea').filter({visible:true}).first().fill(source);
    await page.getByRole('button',{name:'Читать',exact:true}).click();
    const groups=page.locator('[data-sentence-audio]');
    console.log(name+': Reader loaded');
    await groups.nth(units.length-1).waitFor(); assert.equal(await groups.count(),units.length);
    assert.equal(await page.locator('[data-sentence-tail]').count(),units.length);
    assert.equal(await page.locator('[data-sentence-tail]').first().locator('button').count(),2);
    assert.equal(await page.getByRole('button',{name:'Скорость предложения: 1×',exact:true}).count(),units.length);
    const displayed=await page.locator('[data-sentence-tail]').first().evaluate(el=>{
      const source=el.closest('[data-reader-source]').cloneNode(true);source.querySelectorAll('[data-sentence-audio]').forEach(c=>c.remove());
      return source.textContent;
    });
    assert.equal(displayed,source.trim(),'every accepted source character/label is displayed exactly once');
    async function layout(label) {
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' no overflow');
      const tails=await page.locator('[data-sentence-tail]').evaluateAll(els=>els.map(el=>{
        const controls=el.querySelector('[data-sentence-audio]').getBoundingClientRect();
        const range=document.createRange();range.selectNodeContents(el);range.setEndBefore(el.querySelector('[data-sentence-audio]'));
        const text=[...range.getClientRects()].filter(r=>r.width>1&&r.height>1);
        return {control:{x:controls.x,y:controls.y,right:controls.right,bottom:controls.bottom},text:text.map(r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom})),width:innerWidth};
      }));
      for(const t of tails){
        assert.ok(t.control.right<=t.width+1,label+' controls on screen');
        assert.ok(t.text.some(r=>r.y<t.control.bottom&&r.bottom>t.control.y),label+' control shares last word line');
      }
      fs.writeFileSync(path.join(out,`${name}-${label}.json`),JSON.stringify(tails,null,2));
    }
    console.log(name+': numbered questions, inline A/B/C, bare markers, plain lines and long passage controls found');
    await layout('reader');
    await page.getByRole('button',{name:'Транскрипция',exact:true}).click();
    await page.locator('ruby').first().waitFor();
    await layout('reader-pinyin');
    const first=groups.first();
    async function play(group=first) {
      await group.getByRole('button',{name:'Прослушать',exact:true}).click();
      await group.locator('button[aria-label="Остановить"]').waitFor();
      await page.waitForFunction(el => ['playing','error'].includes(el.dataset.speechState), await group.elementHandle());
      assert.equal(await group.getAttribute('data-speech-state'),'playing','real Mandarin media must play');
    }
    async function media() {return page.evaluate(()=>{
      const a=window.__audio.at(-1);
      if (a.getAttribute('src')) return {engine:'mp3',src:a.src,rate:a.playbackRate,pitch:a.preservesPitch,time:a.currentTime,duration:a.duration,paused:a.paused};
      const u=window.__spoken.at(-1);
      return {engine:'browser-fixture',src:'browser://speech?text='+encodeURIComponent(u?.text??''),rate:u?.rate,pitch:u?.pitch===1,time:null,duration:null,paused:!window.speechSynthesis.speaking};
    });}

    await play(); const readerNormal=await media(); assert.equal(readerNormal.rate,1); assert.equal(readerNormal.pitch,true);
    assert.equal(new URL(readerNormal.src).searchParams.get('text'),sentence,'number marker excluded');
    await first.getByRole('button',{name:'Скорость предложения: 1×',exact:true}).click();
    await page.waitForFunction(()=>window.__audio.at(-1)?.playbackRate===0.75||window.__spoken.at(-1)?.rate===0.75);
    await first.getByRole('button',{name:'Остановить',exact:true}).click();
    // Items/options without punctuation must reach the actual MP3 route too.
    for (let i=1;i<9;i++) {
      await play(groups.nth(i)); const clip=await media();
      assert.equal(clip.engine,'mp3');assert.equal(new URL(clip.src).searchParams.get('text'),units[i]);
      await groups.nth(i).getByRole('button',{name:'Остановить',exact:true}).click();
    }
    // Play all >300 source characters through real decoded MP3 chunks. Test-only
    // acceleration keeps the complete queue check short; UI rates tested above.
    const chunkRequests=[], chunkResponses=[];
    const requested=r=>{if(r.url().includes('/api/tts?'))chunkRequests.push(new URL(r.url()).searchParams.get('text'));};
    const responded=r=>{if(r.url().includes('/api/tts?'))chunkResponses.push({status:r.status(),type:r.headers()['content-type']});};
    page.on('request',requested);page.on('response',responded);
    await page.evaluate(()=>{window.__fastAudio=()=>{window.__audio.at(-1).playbackRate=16;};window.__audio.at(-1).addEventListener('playing',window.__fastAudio);});
    await play(groups.nth(9));
    await page.waitForFunction(()=>document.querySelectorAll('[data-sentence-audio]')[9].dataset.speechState==='stopped',null,{timeout:120_000});
    page.off('request',requested);page.off('response',responded);
    assert.equal(chunkRequests.join(''),long);assert.ok(chunkRequests.length>1);
    assert.ok(chunkRequests.every(t=>t.length<=300));
    assert.ok(chunkResponses.length>=chunkRequests.length&&chunkResponses.every(r=>[200,206].includes(r.status)&&r.type.includes('audio')));
    // DevTools may not expose streaming-media bodies. Read cached route bytes
    // directly after the real player consumed every clip.
    const chunks=await Promise.all(chunkRequests.map(async text=>{
      const clip=await ctx.request.get(api+'/tts?lang=zh&text='+encodeURIComponent(text));
      assert.equal(clip.status(),200);const bytes=(await clip.body()).length;assert.ok(bytes>100);return {text,bytes};
    }));
    await page.evaluate(()=>window.__audio.at(-1).removeEventListener('playing',window.__fastAudio));
    fs.writeFileSync(path.join(out,`${name}-chunks.json`),JSON.stringify({chunkRequests,chunkResponses,chunks},null,2));
    await play(groups.nth(10));
    assert.equal(new URL((await media()).src).searchParams.get('text'),units[10]);
    await groups.nth(10).getByRole('button',{name:'Остановить',exact:true}).click();
    // Return to the first unit at the persisted UI speed.
    await play(); await first.getByRole('button',{name:'Остановить',exact:true}).click();
    assert.equal((await media()).paused,true);
    await play(); assert.equal((await media()).rate,0.75);
    await first.getByRole('button',{name:'Остановить',exact:true}).click();
    // A real request is held until Stop; releasing it must never start a clip/fallback.
    let release;
    const gate=new Promise(resolve=>release=resolve);
    const hold=async route=>{await gate;await route.fulfill({status:200,contentType:'audio/mpeg',body:await clip.body()}).catch(()=>{});};
    await page.route('**/api/tts?**',hold);
    await first.getByRole('button',{name:'Прослушать',exact:true}).click();
    await first.locator('[aria-busy="true"]').waitFor();
    await first.getByRole('button',{name:'Остановить',exact:true}).click();
    const spokenAtStop=await page.evaluate(()=>window.__spoken.length); release();
    await page.waitForTimeout(400);
    assert.equal((await media()).paused,true); assert.equal(await page.evaluate(()=>window.__spoken.length),spokenAtStop);
    await page.unroute('**/api/tts?**',hold);
    // Rapid switch to another sentence; only the newest request may play/fallback.
    await first.getByRole('button',{name:'Прослушать',exact:true}).click();
    await groups.nth(1).getByRole('button',{name:'Прослушать',exact:true}).click();
    await groups.nth(1).getByRole('button',{name:'Остановить',exact:true}).waitFor();
    assert.equal(await first.getByRole('button',{name:'Прослушать',exact:true}).count(),1);
    await groups.nth(1).getByRole('button',{name:'Остановить',exact:true}).click();
    // Mandarin media failure stays visible; restoring the same route is explicit recovery.
    await page.route('**/api/tts?**',r=>r.fulfill({status:502,body:'unavailable'}));
    await first.getByRole('button',{name:'Прослушать',exact:true}).click();
    await first.getByRole('button',{name:'Ошибка аудио. Повторить',exact:true}).waitFor();
    await page.getByText('Ошибка аудио. Повтори.',{exact:true}).first().waitFor();
    assert.equal(await page.evaluate(()=>window.__spoken.filter(u=>u.volume!==0).length),0);
    if(name==='phone-chromium')await page.screenshot({path:path.join(out,`${name}-retry.png`)});
    await page.unroute('**/api/tts?**');
    await first.getByRole('button',{name:'Ошибка аудио. Повторить',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-sentence-audio]')?.dataset.speechState==='playing');
    await first.getByRole('button',{name:'Остановить',exact:true}).click();
    // Internal route change cancels audio, then the saved sentence speed survives navigation/reload.
    await play();
    await page.locator('a[href="/words"]').filter({visible:true}).first().click();
    await page.waitForURL('**/words');
    await page.waitForFunction(()=>window.__audio.at(-1).paused&&!window.__audio.at(-1).getAttribute('src')&&!window.speechSynthesis.speaking);
    await page.goto(app+'/word/'+ids[0],{waitUntil:'domcontentloaded'});
    const example=page.locator('[data-sentence-audio]'); await example.waitFor();
    assert.equal(await example.getByRole('button',{name:'Скорость предложения: 0.75×',exact:true}).count(),1);
    await example.getByRole('button',{name:'Скорость предложения: 0.75×',exact:true}).click();
    await play(example); const wordNormal=await media();
    assert.equal(wordNormal.rate,1); assert.equal(wordNormal.src,readerNormal.src); assert.equal(wordNormal.duration,readerNormal.duration);
    await example.getByRole('button',{name:'Остановить',exact:true}).click();
    await layout('word-pinyin');
    fs.writeFileSync(path.join(out,`${name}-pace.json`),JSON.stringify({readerNormal,wordNormal},null,2));
    await page.reload({waitUntil:'domcontentloaded'}); await example.getByRole('button',{name:'Скорость предложения: 1×',exact:true}).waitFor();
    await page.evaluate(()=>sessionStorage.setItem('audio.noVoice','1'));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.route('**/api/tts?**',r=>r.fulfill({status:502,body:'unavailable'}));
    await example.getByRole('button',{name:'Прослушать',exact:true}).click();
    await page.getByText('Ошибка аудио. Повтори.',{exact:true}).filter({visible:true}).first().waitFor();
    await example.getByRole('button',{name:'Ошибка аудио. Повторить',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__spoken.length),0);
    await page.unroute('**/api/tts?**');
    await page.evaluate(()=>sessionStorage.removeItem('audio.noVoice'));
    // Existing review listening starts automatically after the setup gesture/unlock.
    await page.evaluate(ids=>{localStorage.setItem('lexa.cardLayout',JSON.stringify({front:['audio'],back:['word','meaning']}));sessionStorage.setItem('lexa.reviewFocusIds',JSON.stringify(ids));},ids);
    await page.goto(app+'/review',{waitUntil:'domcontentloaded'});
    await page.locator('.flip-card').waitFor();
    await page.waitForFunction(()=>window.__audio.at(-1)?.currentTime>0||window.speechSynthesis.speaking);
    const automatic=await media(); assert.equal(automatic.rate,automatic.engine==='mp3'?1:0.95);
    await page.goto(app+'/quiz',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:/^На слух/}).click();
    await page.getByRole('button',{name:/^Начать — вопросов:/}).click();
    await page.waitForFunction(()=>window.__audio.at(-1)?.currentTime>0||window.speechSynthesis.speaking);
    const quizAudio=await media(); assert.equal(quizAudio.rate,quizAudio.engine==='mp3'?1:0.95);
    assert.deepEqual(errors,[]);
    console.log(`${name}: source/controls, full bounded MP3 queue, 1×/0.75×/stop/replay, loading cancellation, switches, visible failure/retry without browser speech, route/reload, identical Reader/word clip and review/quiz audio pass`);
  } catch (error) {
    await page.screenshot({path:path.join(out,`${name}-failure.png`),fullPage:true}).catch(()=>{});
    console.error({url:page.url(),errors});
    throw error;
  } finally {
    db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
    await ctx.close();await browser.close();
  }
}
