// Local Docker learner flow; real MP3 playback, with controlled HTTP/synthesis failures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), out = path.join(root, '.playwright-cli', 'sentence-audio');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, webkit, devices } = await import('../node_modules/playwright-core/index.mjs');
const api = 'http://localhost:3000/api', app = 'http://localhost:3001';
const sentence = '今天下雨，我带着雨伞去学校。';
const source = `24. ${sentence}\n25. 价格是24.75元。你说：“真的？！”\n\n今天我\n在家学习中文。\n没有句号的段落\n\n最后一句结束了。\n3.14 is pi. Hello!\n`;
function db(code) {
  return execFileSync('docker', ['compose','exec','-T','backend','node','--input-type=module'], {
    cwd:root, encoding:'utf8', input:`import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
for (const config of [
  { name:'phone-webkit', engine:webkit, ...devices['iPhone 13'] },
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
    await groups.nth(7).waitFor(); assert.equal(await groups.count(),8);
    assert.equal(await page.locator('[data-sentence-tail]').count(),8);
    assert.equal(await page.locator('[data-sentence-tail]').first().locator('button').count(),2);
    assert.equal(await page.getByRole('button',{name:'Скорость предложения: 1×',exact:true}).count(),8);
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
    console.log(name+': 8 controls found');
    await layout('reader');
    await page.getByRole('button',{name:'Транскрипция',exact:true}).click();
    await page.locator('ruby').first().waitFor();
    await layout('reader-pinyin');
    await page.screenshot({path:path.join(out,`${name}-reader.png`),fullPage:true});
    const first=groups.first();
    async function play(group=first) {
      await group.getByRole('button',{name:'Прослушать',exact:true}).click();
      await group.locator('button[aria-label="Остановить"]').waitFor();
      await page.waitForFunction(el => el.dataset.speechState === 'playing', await group.elementHandle());
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
    // Server failure exercises browser loading -> playing -> ended and unavailable voices.
    await page.route('**/api/tts?**',r=>r.fulfill({status:502,body:'unavailable'}));
    await first.getByRole('button',{name:'Прослушать',exact:true}).click();
    await page.waitForFunction(()=>window.__spoken.some(u=>u.text==='今天下雨，我带着雨伞去学校。'));
    await page.waitForFunction(()=>document.querySelector('[data-sentence-audio]')?.dataset.speechState==='playing');
    assert.equal(await page.evaluate(()=>window.__spoken.at(-1).rate),0.75);
    await page.evaluate(()=>window.__spoken.at(-1).onend());
    await first.getByRole('button',{name:'Прослушать',exact:true}).waitFor();
    await page.unroute('**/api/tts?**');
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
    await page.screenshot({path:path.join(out,`${name}-word.png`),fullPage:true});
    fs.writeFileSync(path.join(out,`${name}-pace.json`),JSON.stringify({readerNormal,wordNormal},null,2));
    await page.reload({waitUntil:'domcontentloaded'}); await example.getByRole('button',{name:'Скорость предложения: 1×',exact:true}).waitFor();
    await page.evaluate(()=>sessionStorage.setItem('audio.noVoice','1'));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.route('**/api/tts?**',r=>r.fulfill({status:502,body:'unavailable'}));
    await example.getByRole('button',{name:'Прослушать',exact:true}).click();
    await page.getByText(/На этом устройстве нет голоса/).filter({visible:true}).first().waitFor();
    await example.getByRole('button',{name:'Прослушать',exact:true}).waitFor();
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
    console.log(`${name}: boundaries/layout with pinyin, ${readerNormal.engine} 1×/0.75×/stop/replay, loading cancellation, switches, fallback/end, route/reload, identical Reader/word clip and review/quiz audio pass`);
  } catch (error) {
    await page.screenshot({path:path.join(out,`${name}-failure.png`),fullPage:true}).catch(()=>{});
    console.error({url:page.url(),errors});
    throw error;
  } finally {
    db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
    await ctx.close();await browser.close();
  }
}
