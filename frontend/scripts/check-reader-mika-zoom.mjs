// Local Part 16 check. The extension changes real browser page zoom: DPR changes,
// CSS viewport shrinks, visualViewport.scale stays 1 (no pinch or CSS zoom).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), out = path.join(root, '.playwright-cli/reader-mika-zoom');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
const extension = path.join(out, 'extension');
fs.mkdirSync(extension, { recursive: true });
fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Local page zoom check', version: '1.0', permissions: ['tabs'], background: { service_worker: 'worker.js' } }));
fs.writeFileSync(path.join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli/browsers');
const { chromium } = await import('../node_modules/playwright-core/index.mjs');
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
const user = `zoom-ui-${Date.now()}`, reproduce = process.argv.includes('--reproduce');
const checks = [], errors = [], measurements = [];
const record = value => { checks.push(value); console.log('PASS ' + value); };
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
const ctx = await chromium.launchPersistentContext(path.join(out, `profile-${Date.now()}`), {
  channel: 'chromium', headless: true, viewport: { width: 1600, height: 900 }, locale: 'ru-RU',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const page = ctx.pages()[0];
page.setDefaultTimeout(20000);
page.setDefaultNavigationTimeout(60000);
page.on('pageerror', e => errors.push(e.message));
await ctx.addInitScript(() => { localStorage.setItem('lexa.locale', 'ru'); localStorage.setItem('lexa.autoGloss', '1'); localStorage.setItem('lexa.rubyAll', '1'); });
const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
const input = () => page.getByPlaceholder('Спроси или добавь фото…', { exact: true });
const send = () => page.getByRole('button', { name: 'Отправить', exact: true });
async function zoom(value) {
  await worker.evaluate(async value => {
    const tabs = await chrome.tabs.query({ url: 'http://localhost:3001/*' });
    await chrome.tabs.setZoom(tabs[0].id, value);
  }, value);
  await page.waitForFunction(value => Math.abs(devicePixelRatio - value) < .01 && visualViewport.scale === 1, value);
  await page.waitForTimeout(550);
}
async function measure(name, panel) {
  const result = await page.evaluate(({ name, panel }) => {
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height, right:r.right, bottom:r.bottom, clientH:el.clientHeight, scrollH:el.scrollHeight }; };
    const textarea = document.querySelector('textarea[placeholder="Спроси или добавь фото…"]');
    return { name, w:innerWidth, h:innerHeight, dpr:devicePixelRatio, scale:visualViewport.scale, pageW:document.documentElement.scrollWidth,
      panel:rect(document.querySelector(panel)), input:rect(textarea), send:rect(document.querySelector('button[aria-label="Отправить"]')),
      overflowing:[...document.querySelectorAll('body *')].filter(el=> { const r=el.getBoundingClientRect();return r.width>0 && getComputedStyle(el).position!=='fixed' && (r.right>innerWidth+1 || r.left < -1); }).slice(0,8).map(el=>({ tag:el.tagName, cls:el.className?.baseVal??el.className, r:rect(el) })) };
  }, { name, panel });
  measurements.push(result); console.log(JSON.stringify(result));
  return result;
}
async function reachable(locator, label) {
  const r = await locator.boundingBox(), v = await page.evaluate(() => ({ w:innerWidth,h:innerHeight }));
  assert(r && r.x >= -1 && r.y >= -1 && r.x+r.width <= v.w+1 && r.y+r.height <= v.h+1, `${label}: ${JSON.stringify({r,v})}`);
  await locator.click({ trial: true });
}
async function noOverflow() { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), 'horizontal page overflow'); }
async function chatCheck(name, panel) {
  await page.waitForTimeout(550);
  await input().fill('Проверка доступности поля');
  await reachable(input(), name+' input'); await reachable(send(), name+' send');
  await page.locator('[data-mika-reply] ruby').first().waitFor();
  const scroller = page.locator('[data-mika-reply]').first().locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
  assert(await scroller.evaluate(el=>el.clientHeight>40 && el.scrollHeight>el.clientHeight), name+' readable scrolling thread');
  await scroller.evaluate(el=>el.scrollTop=0);
  await input().focus();
  assert(await input().evaluate(el=>el===document.activeElement));
  await reachable(send(), name+' focused send'); await noOverflow();
  await input().fill(('Длинный вопрос с переносами\n').repeat(20));
  await reachable(input(),name+' long input'); await reachable(send(),name+' long input send');
  assert(await scroller.evaluate(el=>el.clientHeight>40),name+' long draft leaves room for reading');
  await measure(name,panel); await input().fill(''); record(name+': long ruby thread scrolls, focused composer and send reachable, no horizontal overflow');
}
let fixture;
try {
  assert.equal((await ctx.request.post(api+'/auth/dev', {data:{telegramId:user}})).status(),200);
  fixture = JSON.parse(db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,firstName:'Проверка',nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});
    const w=await db.word.create({data:{userId:u.id,word:'学习',sourceLang:'zh',targetLang:'ru',phonetic:'xué xí',meaningZh:${JSON.stringify('Учиться, изучать и осваивать новое. '.repeat(80))},collocations:[],synonyms:[],antonyms:[],autoExamples:false,familyAt:new Date()}});
    const text=await db.readerText.create({data:{userId:u.id,title:'Part 16 zoom fixture',sourceLang:'zh',targetLang:'ru',content:${JSON.stringify(('我学习中文。朋友喜欢看书。\n').repeat(65))}}}); console.log(JSON.stringify({word:w.id,text:text.id}));`));
  const messages=Array.from({length:10},(_,i)=>[{role:'user',content:`Разберём пример ${i+1}`},{role:'assistant',content:('火车到达了车站。我们一起学习中文。 — Поезд прибыл на станцию. Мы вместе учим китайский.\n').repeat(8)}]).flat();
  assert.equal((await ctx.request.put(api+'/tutor/chats/zoomhistory',{data:{messages}})).status(),200);
  await page.goto(app+'/mika',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'История',exact:true}).filter({visible:true}).click();
  await page.getByRole('button',{name:/Разберём пример 1/}).click();
  await input().waitFor(); await page.locator('[data-mika-reply] ruby').first().waitFor();
  if (!process.argv.includes('--reader-only')) {
  await zoom(1);
  if (!reproduce) await chatCheck('mika-100','.mika-chat');
  await zoom(2);
  await measure('mika-200','.mika-chat');
  await page.screenshot({path:path.join(out,reproduce?'before-mika-200.png':'after-mika-200.png')});
  if (!reproduce) await chatCheck('mika-200','.mika-chat');
  if (!reproduce) {
    const account=page.locator('aside a[href="/account"]');
    await account.scrollIntoViewIfNeeded(); await reachable(account,'sidebar account');
    await page.getByRole('button',{name:'История',exact:true}).filter({visible:true}).click();
    await page.keyboard.press('Escape');
    record('200% desktop sidebar account and chat history remain reachable');
  }
  await zoom(1); await page.goto(app+'/words',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Открыть Мику',exact:true}).click();
  await input().waitFor();
  if (!reproduce) await chatCheck('floating-100','.anim-panel');
  // Drag left, then shrink the CSS viewport with real zoom, keeping it desktop.
  const grip=page.getByLabel('Перетащить',{exact:true}).filter({visible:true});
  if (await grip.count()) { const r=await grip.boundingBox(); await page.mouse.move(r.x+r.width/2,r.y+r.height/2); await page.mouse.down(); await page.mouse.move(480,140,{steps:8}); await page.mouse.up(); }
  await zoom(2);
  await measure('floating-200','.anim-panel');
  await page.screenshot({path:path.join(out,reproduce?'before-floating-200.png':'after-floating-200.png')});
  if (!reproduce) { await chatCheck('floating-200','.anim-panel'); await reachable(page.getByRole('button',{name:'Отмена',exact:true}), 'floating close'); }
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  }
  await zoom(1); await page.goto(app+'/reader',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:/Part 16 zoom fixture/}).click();
  const text=page.locator('[data-reader-source]'); await text.waitFor();
  await page.getByRole('button',{name:'Транскрипция',exact:true}).click(); await text.locator('ruby').first().waitFor();
  await noOverflow();
  const word=text.getByRole('button',{name:/学.*习/}).first();
  await word.scrollIntoViewIfNeeded(); await word.hover(); await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
  await page.locator('a[href="/word/'+fixture.word+'"]').filter({visible:true}).waitFor();
  const card=page.locator('div.fixed.right-4.top-20');
  const handle=card.getByLabel('Перетащить',{exact:true});
  const hr=await handle.boundingBox(); await page.mouse.move(hr.x+hr.width/2,hr.y+hr.height/2); await page.mouse.down(); await page.mouse.move(520,500,{steps:8}); await page.mouse.up();
  await zoom(2);
  await measure('reader-card-200','div.fixed.right-4.top-20');
  await page.screenshot({path:path.join(out,reproduce?'before-reader-card-200.png':'after-reader-card-200.png')});
  if (!reproduce) {
    await noOverflow(); await reachable(card.getByRole('button',{name:'Отмена',exact:true}),'Reader card close');
    const r=await card.boundingBox(); assert(r.x>=7 && r.y>=7 && r.x+r.width<=801 && r.y+r.height<=443,'whole dragged card re-clamped');
    const openCard=card.locator('a[href="/word/'+fixture.word+'"]'); await openCard.scrollIntoViewIfNeeded(); await reachable(openCard,'Reader full-card action');
  }
  await page.keyboard.press('Escape');
  if (!reproduce) {
    await word.click(); await page.getByRole('dialog',{name:'学习',exact:true}).waitFor();
    await noOverflow(); await page.keyboard.press('Escape');
    await text.getByRole('button',{name:/学.*习/}).last().scrollIntoViewIfNeeded();
    record('Reader at 100/200%: long ruby text and end reachable; saved-word popup and re-clamped dragged card remain usable');
    // Cross the responsive breakpoint using browser zoom on a typical laptop.
    await zoom(1); await page.setViewportSize({width:1280,height:720}); await zoom(2);
    await page.evaluate(()=>window.dispatchEvent(new Event('onomika:open-mika')));
    await chatCheck('floating-laptop-200','.anim-sheet');
    await reachable(page.getByRole('button',{name:'Отмена',exact:true}),'laptop sheet close');
    await page.getByRole('button',{name:'Отмена',exact:true}).click();
    await page.goto(app+'/mika',{waitUntil:'networkidle'}); await chatCheck('mika-laptop-200','.mika-chat');
    // Normal phone size, then the smaller viewport the keyboard leaves. This is
    // a deterministic keyboard-layout spot-check, not a native OS keyboard test.
    await zoom(1); await page.setViewportSize({width:390,height:844}); await chatCheck('phone','.mika-chat');
    await page.setViewportSize({width:390,height:430}); await chatCheck('phone-keyboard-space','.mika-chat');
    await page.goto(app+'/reader',{waitUntil:'networkidle'});
    await page.evaluate(()=>window.dispatchEvent(new Event('onomika:open-mika')));
    await chatCheck('phone-sheet-keyboard-space','.anim-sheet');
    await reachable(page.getByRole('button',{name:'Отмена',exact:true}),'phone sheet close');
    await page.route('**/api/tutor/ask',route=>route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'final',result:{answer:'Проверка отправки завершена. 火车到达了车站。',addWords:[],addCards:[]}})+'\n'}));
    await input().fill('Проверка отправки'); await send().click();
    await page.locator('[data-mika-reply]').last().getByText(/Проверка отправки завершена/).waitFor();
    record('send works with a controlled local response in phone keyboard space');
    assert.deepEqual(errors,[]); record('no browser errors');
  } else {
    await zoom(1); await page.setViewportSize({width:1280,height:720}); await zoom(2);
    await page.evaluate(()=>window.dispatchEvent(new Event('onomika:open-mika')));
    await input().waitFor(); await measure('floating-laptop-200','.anim-sheet');
    await page.screenshot({path:path.join(out,'before-laptop-sheet-200.png')});
  }
} catch(e) {
  await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{}); throw e;
} finally {
  fs.writeFileSync(path.join(out,reproduce?(process.argv.includes('--reader-only')?'before-reader.json':'before.json'):'result.json'),JSON.stringify({checks,errors,measurements},null,2));
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
  await ctx.close();
}
