// Local learner flow: real decoded Bailian clips, controlled failures and late responses.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root=process.cwd(),out=path.join(root,'.playwright-cli','reader-listening');
fs.mkdirSync(path.join(out,'tmp'),{recursive:true});
process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'.playwright-cli','browsers');
process.env.TEMP=process.env.TMP=path.join(out,'tmp');
const {chromium,webkit,devices}=await import('../node_modules/playwright-core/index.mjs');
const app='http://localhost:3001',api='http://localhost:3000/api';
const phrase='今天下雨，我带着雨伞去学校';
const long='今天我在学校学习中文然后和朋友一起回家'.repeat(18);
const source=Array.from({length:14},(_,i)=>`${i+1}. ${phrase}。`).join('\n')+'\n'+long+'\n最后一句结束了。';
function db(code){return execFileSync('docker',['compose','exec','-T','backend','node','--input-type=module'],{cwd:root,encoding:'utf8',input:`import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`}).trim();}
const configurations=[
  {name:'phone-chromium',engine:chromium,...devices['Pixel 7']},
  {name:'phone-webkit',engine:webkit,...devices['iPhone 13']},
];
for(const {name,engine,...options} of configurations.filter(c=>c.name===(process.argv[2]||'phone-chromium'))){
  const browser=await engine.launch({headless:true,downloadsPath:out});
  const ctx=await browser.newContext({...options,locale:'ru-RU',serviceWorkers:'block'});
  const page=await ctx.newPage(),user=`reader-listening-${name}-${Date.now()}`,errors=[],requests=[];
  page.setDefaultTimeout(60_000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/tts?'))requests.push(new URL(r.url()).searchParams.get('text'));});
  try{
    await ctx.addInitScript(()=>{
      localStorage.setItem('lexa.locale','ru');localStorage.setItem('lexa.autoGloss','0');
      localStorage.setItem('lexa.showTextLevel','0');localStorage.setItem('lexa.examplePinyin','0');
      window.__audio=[];window.__played=[];window.__mediaErrors=[];
      const NativeAudio=window.Audio;
      window.Audio=function(...args){
        const el=new NativeAudio(...args);window.__audio.push(el);
        el.addEventListener('playing',()=>window.__played.push(el.src));
        el.addEventListener('error',()=>window.__mediaErrors.push({code:el.error?.code,message:el.error?.message}));
        const play=el.play.bind(el);el.play=()=>play().catch(e=>{window.__mediaErrors.push({name:e.name,message:e.message});throw e;});
        return el;
      };
    });
    assert.equal((await ctx.request.post(api+'/auth/dev',{data:{telegramId:user}})).status(),200);
    db(`await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});`);
    db(`const u=await db.user.findUniqueOrThrow({where:{telegramId:${JSON.stringify(user)}}});await db.word.create({data:{userId:u.id,word:'学习',meaningZh:'учиться',sourceLang:'zh',targetLang:'ru',collocations:[],synonyms:[],antonyms:[],familyAt:new Date(),autoExamples:false,exampleStatus:'ready'}});`);
    await page.goto(app+'/reader',{waitUntil:'domcontentloaded'});
    await page.locator('textarea').filter({visible:true}).first().fill(source);
    await page.getByRole('button',{name:'Читать',exact:true}).click();
    const player=page.locator('[data-reader-player]');await player.waitFor();
    const status=async value=>{
      await page.waitForFunction(v=>{const s=document.querySelector('[data-reader-player]')?.dataset.playbackState;return s===v||s==='error';},value);
      assert.equal(await player.getAttribute('data-playback-state'),value);
    };
    const button=name=>player.getByRole('button',{name,exact:true});
    const media=()=>page.evaluate(()=>{const a=window.__audio[0];return {time:a?.currentTime,src:a?.getAttribute('src'),paused:a?.paused,rate:a?.playbackRate,pitch:a?.preservesPitch,count:window.__audio.length};});
    const seek=async n=>{await player.getByRole('slider',{name:'Перейти к фрагменту'}).fill(String(n));};
    const total=Number(await player.getByRole('slider').getAttribute('max'));
    assert.ok(source.length>300&&total>12);
    assert.equal(requests.length,0,'opening a text never synthesizes it');
    console.log(name+': player loaded, no eager synthesis');
    if(process.argv[3]==='lifecycle-only'){
      await button('Включить текст').click();await status('playing');
      await page.getByRole('button',{name:'Инструменты чтения',exact:true}).click();
      await page.getByRole('button',{name:'Изменить текст',exact:true}).filter({visible:true}).click();
      await status('idle');assert.equal((await media()).src,null,'opening edit cancels playback');
      await page.getByRole('textbox',{name:'Текст',exact:true}).fill('今天下雨。\n最后一句结束了。');
      await page.getByRole('textbox',{name:'Название',exact:true}).fill('Listening lifecycle');
      await page.getByRole('button',{name:'Обновить',exact:true}).click();
      await page.getByRole('textbox',{name:'Текст',exact:true}).waitFor({state:'hidden'});
      await button('Включить текст').click();await status('playing');
      assert.equal(await player.getByRole('slider').getAttribute('max'),'2');
      await page.getByRole('button',{name:'Инструменты чтения',exact:true}).click();
      await page.getByRole('button',{name:'Удалить',exact:true}).filter({visible:true}).click();
      await page.getByRole('heading',{name:'Удалить текст?',exact:true}).waitFor();
      await page.getByRole('button',{name:'Удалить',exact:true}).filter({visible:true}).last().click();
      await player.waitFor({state:'hidden'});assert.equal((await media()).src,null);assert.equal((await media()).paused,true);
      const oldText='这是一次等待返回的旧课文。',newText='今天下雨。';
      await page.locator('textarea').filter({visible:true}).first().fill(oldText);
      await page.getByRole('button',{name:'Читать',exact:true}).click();
      let release;const gate=new Promise(r=>release=r);
      const clip=await ctx.request.get(api+'/tts?lang=zh&text='+encodeURIComponent(newText));
      assert.equal(clip.status(),200);const bytes=await clip.body();
      await page.route('**/api/tts?**',async r=>{
        if(new URL(r.request().url()).searchParams.get('text')!==oldText)return r.continue();
        await gate;await r.fulfill({status:200,contentType:'audio/mpeg',body:bytes}).catch(()=>{});
      });
      await button('Включить текст').click();await status('loading');
      await page.getByRole('button',{name:'Новый текст',exact:true}).click();
      await page.locator('textarea').filter({visible:true}).first().fill(newText);
      await page.getByRole('button',{name:'Читать',exact:true}).click();await button('Включить текст').click();await status('playing');
      const newest=(await media()).src;release();await page.waitForTimeout(300);
      assert.equal((await media()).src,newest,'late old text cannot replace the new text');
      await page.unroute('**/api/tts?**');assert.deepEqual(errors,[]);
      console.log(name+': editing, saved content replacement, deletion and quick text switch with late response passed');
      continue;
    }
    await button('Включить текст').click();await status('playing');
    await page.waitForFunction(()=>window.__audio[0].currentTime>0.15);
    assert.equal((await media()).count,1,'one shared unlocked element');
    assert.ok(requests.length<=2,'only current and next are loaded');
    await button('Пауза').click();await status('paused');const paused=await media();
    await page.waitForTimeout(250);assert.ok(Math.abs((await media()).time-paused.time)<0.05);
    await button('Продолжить').click();await status('playing');
    assert.ok((await media()).time>=paused.time,'resume does not restart');
    for(const rate of ['1.25','1.5','0.75','1']){
      const before=(await media());const count=requests.length;
      await player.getByRole('combobox',{name:'Скорость чтения текста'}).selectOption(rate);
      const after=await media();assert.equal(after.rate,Number(rate));assert.equal(after.pitch,true);
      assert.equal(after.src,before.src);assert.ok(after.time>=before.time);assert.equal(requests.length,count,'rate does not request new audio');
    }
    if(process.argv[3]==='unlock-only'){
      await page.screenshot({path:path.join(out,`${name}-unlock.png`)});
      await page.locator('a[href="/words"]').filter({visible:true}).first().click();await page.waitForURL('**/words');
      assert.equal((await media()).paused,true);assert.equal((await media()).src,null);assert.deepEqual(errors,[]);
      console.log(name+': native phone unlock, actual MP3, pause/resume, live rates and navigation cleanup passed');
      continue;
    }
    await button('Пауза').click();await seek(2);await status('paused');
    await page.waitForFunction(()=>window.__audio[0]?.getAttribute('src')?.startsWith('blob:'));
    assert.equal((await media()).time,0,'paused seek starts at selected fragment');
    await button('Продолжить').click();await status('playing');
    await button('Остановить текст').click();await status('idle');assert.equal((await media()).src,null);
    // Real clips play to completion. Accelerate only in the harness; UI rates were checked above.
    await page.evaluate(()=>{window.__fast=()=>{window.__audio[0].playbackRate=16;};window.__audio[0].addEventListener('playing',window.__fast);});
    await button('Включить текст').click();await status('ended');
    assert.equal(await player.getByRole('slider').inputValue(),String(total));
    assert.ok(requests.every(t=>t.length<=120&&!/^\d+[.)]/.test(t)));
    assert.ok(requests.includes('最后一句结束了。'),'listening goes past practice limit and long passage');
    const clips=await page.evaluate(()=>window.__played.filter(url=>url.startsWith('blob:')).length);
    assert.ok(clips>=total,'real media ended for every fragment');
    const count=requests.length;
    await button('Слушать снова').click();await status('ended');assert.equal(requests.length,count,'complete replay uses cached clips');
    await page.evaluate(()=>window.__audio[0].removeEventListener('playing',window.__fast));
    console.log(name+': complete >300-character/>12-sentence playback and cached replay passed');
    // A fresh second text makes the third fragment fail, after successful playback.
    const switchText=async text=>{
      await page.getByRole('button',{name:'Новый текст',exact:true}).click();
      await page.locator('textarea').filter({visible:true}).first().fill(text);
      await page.getByRole('button',{name:'Читать',exact:true}).click();await player.waitFor();
    };
    const errorText='今天我去学校学习中文。\n明天我和朋友一起回家。\n下雨的时候我喜欢在家看书。\n最后一句结束了。';
    await switchText(errorText);
    const failText='下雨的时候我喜欢在家看书。';
    let failures=0;
    await page.route('**/api/tts?**',r=>new URL(r.request().url()).searchParams.get('text')===failText?(failures++,r.fulfill({status:502,body:'unavailable'})):r.continue());
    await button('Включить текст').click();await status('playing');
    await page.evaluate(()=>{window.__fast=()=>{window.__audio[0].playbackRate=16;};window.__audio[0].addEventListener('playing',window.__fast);window.__fast();});
    await status('error');assert.ok(failures>=1);assert.equal(await player.getByRole('slider').inputValue(),'3');
    await page.screenshot({path:path.join(out,`${name}-retry.png`)});
    await page.unroute('**/api/tts?**');const retryAt=requests.length;
    await button('Повторить фрагмент').click();await status('ended');
    assert.ok(requests.slice(retryAt).includes(failText));assert.ok(!requests.slice(retryAt).includes('今天我去学校学习中文。'));
    await page.evaluate(()=>window.__audio[0].removeEventListener('playing',window.__fast));
    // Pause while a fresh fetch is held, then resume before it arrives.
    await switchText('我们现在一起学习新的中文课文。\n今天下雨。');
    let release;const gate=new Promise(r=>release=r);
    const clip=await ctx.request.get(api+'/tts?lang=zh&text='+encodeURIComponent(phrase),{timeout:90_000});
    assert.equal(clip.status(),200);const bytes=await clip.body();fs.writeFileSync(path.join(out,`${name}-voice.mp3`),bytes);
    await page.route('**/api/tts?**',async r=>{await gate;await r.fulfill({status:200,contentType:'audio/mpeg',body:bytes}).catch(()=>{});});
    await button('Включить текст').click();await status('loading');await button('Пауза').click();await status('paused');
    await button('Продолжить').click();await status('loading');release();await status('playing');
    await page.unroute('**/api/tts?**');
    // A saved single word claims the same element and cancels the queue.
    const savedWord=page.locator('[data-reader-unit="0"] [role="button"]').filter({hasText:/^学习$/});
    await savedWord.click();
    await page.getByRole('dialog',{name:'学习',exact:true}).getByRole('button',{name:'Прослушать',exact:true}).click();
    await status('idle');assert.equal((await media()).count,1);assert.ok(!(await media()).src.startsWith('blob:'));
    assert.equal(new URL((await media()).src).searchParams.get('text'),'学习');
    await savedWord.click();
    await button('Включить текст').click();await status('playing');
    // Mark a word selected; advancing audio must not force scrolling away from it.
    await page.locator('[data-reader-unit="0"] [role="button"]').first().click();
    const scroll=await page.evaluate(()=>scrollY);
    await seek(2);await status('playing');await page.waitForTimeout(300);
    assert.ok(Math.abs((await page.evaluate(()=>scrollY))-scroll)<5,'selection prevents automatic scrolling');
    await page.screenshot({path:path.join(out,`${name}-player.png`)});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phone has no horizontal overflow');
    await page.locator('a[href="/words"]').filter({visible:true}).first().click();await page.waitForURL('**/words');
    assert.equal((await media()).paused,true);assert.equal((await media()).src,null);
    // Leaving during a late request must never let it revive audio.
    await page.goto(app+'/reader',{waitUntil:'domcontentloaded'});
    if(await player.count())await page.getByRole('button',{name:'Новый текст',exact:true}).click();
    await page.locator('textarea').filter({visible:true}).first().fill('这是另一个还没有播放的新故事。');
    await page.getByRole('button',{name:'Читать',exact:true}).click();
    let late;const pending=new Promise(r=>late=r);
    await page.route('**/api/tts?**',async r=>{await pending;await r.fulfill({status:200,contentType:'audio/mpeg',body:bytes}).catch(()=>{});});
    await button('Включить текст').click();await status('loading');
    await page.getByRole('button',{name:'Новый текст',exact:true}).click();late();await page.waitForTimeout(400);
    assert.equal((await media()).paused,true);assert.equal((await media()).src,null);
    await page.unroute('**/api/tts?**');
    fs.writeFileSync(path.join(out,`${name}.json`),JSON.stringify({total,clips,requests,errors},null,2));
    assert.deepEqual(errors,[]);
    console.log(name+': speed/pause/seek/error/retry/interruption/selection/navigation/late cancellation passed');
  }catch(error){await page.screenshot({path:path.join(out,`${name}-failure.png`),fullPage:true}).catch(()=>{});console.error(JSON.stringify({url:page.url(),errors,media:await page.evaluate(()=>({errors:window.__mediaErrors,mp3:window.__audio[0]?.canPlayType('audio/mpeg')})).catch(()=>null)}));throw error;}
  finally{db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);await ctx.close();await browser.close();}
}
