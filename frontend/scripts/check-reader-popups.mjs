// Part 8: real local dictionary/account; controlled gloss latency for close races.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli', 'reader-popups');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, webkit, devices } = await import('../node_modules/playwright-core/index.mjs');
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
const user = `reader-popups-${Date.now()}`;
const results = [], errors = [];
const record = value => { results.push(value); console.log('PASS: '+value); };
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
const longMeaning = 'Учиться, изучать и осваивать новое. '.repeat(100);
const content = ('我学习中文。朋友喜欢看书。'.repeat(8)+'\n').repeat(5)+'拒绝。拒绝。学校。学校。镜子。';
let fixture, activePage;
async function bounds(page, locator) {
  await page.waitForFunction(() => !document.querySelector('[role="dialog"].anim-popover')?.getAnimations().some(a => a.playState === 'running'));
  await page.waitForFunction(el => {
    const r=el.getBoundingClientRect();
    return r.left>=7 && r.top>=7 && r.right<=innerWidth-7 && r.bottom<=innerHeight-7;
  },await locator.elementHandle());
  const rect = await locator.boundingBox();
  const view = await page.evaluate(() => ({w:innerWidth,h:innerHeight}));
  assert(rect && rect.x >= 7 && rect.y >= 7 && rect.x + rect.width <= view.w - 7 && rect.y + rect.height <= view.h - 7, JSON.stringify({rect,view}));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
}
async function prepare(browser, options) {
  const ctx = await browser.newContext({ ...options, locale:'ru-RU', serviceWorkers:'block' });
  await ctx.addInitScript(() => {
    localStorage.setItem('lexa.locale','ru');
    localStorage.setItem('lexa.autoGloss','1');
    localStorage.setItem('lexa.rubyAll','0');
    localStorage.setItem('lexa.showTextLevel','0');
  });
  assert.equal((await ctx.request.post(api+'/auth/dev',{data:{telegramId:user}})).status(),200);
  const page = await ctx.newPage();
  activePage = page;
  page.setDefaultTimeout(25000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(app+'/reader',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('button',{name:/Part 8 popup fixture/}).click();
  const text = page.locator('div.select-none.whitespace-pre-wrap');
  await text.waitFor();
  return {ctx,page,text};
}
const desktop = await chromium.launch({headless:true,downloadsPath:out});
try {
  const setup = await desktop.newContext();
  assert.equal((await setup.request.post(api+'/auth/dev',{data:{telegramId:user}})).status(),200);
  fixture = JSON.parse(db(`
    const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});
    const w=await db.word.create({data:{userId:u.id,word:'学习',sourceLang:'zh',targetLang:'ru',phonetic:'xué xí',meaningZh:${JSON.stringify(longMeaning)},collocations:[],synonyms:['研究'],antonyms:['拒绝'],autoExamples:false,familyAt:new Date()}});
    const text=await db.readerText.create({data:{userId:u.id,title:'Part 8 popup fixture',sourceLang:'zh',targetLang:'ru',content:${JSON.stringify(content)}}});
    console.log(JSON.stringify({word:w.id,text:text.id}));
  `));
  await setup.close();
  if (!process.argv.includes('--phone-only')) {
    const {ctx,page,text} = await prepare(desktop,{viewport:{width:960,height:720}});
    const pending = [];
    await page.route('**/api/gloss',route => { pending.push({route,data:route.request().postDataJSON()}); });
    const known = text.getByRole('button',{name:'学习',exact:true});
    const unknown = text.getByRole('button',{name:'拒绝',exact:true});
    const dialog = name => page.getByRole('dialog',{name,exact:true});
    await known.first().click(); await dialog('学习').waitFor();
    await known.first().click(); await dialog('学习').waitFor({state:'detached'});
    await known.first().focus(); await page.keyboard.press('Enter'); await dialog('学习').waitFor();
    await page.keyboard.press('Space'); await dialog('学习').waitFor({state:'detached'});
    await known.first().click();
    await known.nth(1).click(); await dialog('学习').waitFor();
    await page.keyboard.press('Escape'); await dialog('学习').waitFor({state:'detached'});
    assert(await known.nth(1).evaluate(el=>el===document.activeElement));
    record('saved same-anchor pointer/Enter/Space close; second occurrence opens; Escape returns focus');

    await unknown.first().click(); await dialog('拒绝').waitFor();
    await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="拒绝"]'));
    await unknown.nth(1).click(); await dialog('拒绝').waitFor();
    assert.match(await page.locator('[data-reader-dock]').innerText(),/выбрано: 1/);
    await unknown.nth(1).click(); await dialog('拒绝').waitFor({state:'detached'});
    for(let i=0;!pending.length && i<200;i++) await page.waitForTimeout(30);
    assert(pending.length,'gloss request was sent');
    await pending.shift().route.fulfill({json:{gloss:'Старый ответ после закрытия',transcription:'jù jué'}});
    await page.waitForTimeout(200);
    assert.equal(await dialog('拒绝').count(),0);
    await unknown.first().focus(); await page.keyboard.press('Enter'); await dialog('拒绝').waitFor();
    await page.keyboard.press('Space'); await dialog('拒绝').waitFor({state:'detached'});
    record('new-word occurrence switching preserves one selection; repeat pointer/keyboard closes; delayed lookup cannot reopen');

    const mirror = text.getByRole('button',{name:'镜子',exact:true});
    await mirror.click(); await dialog('镜子').waitFor();
    const school = text.getByRole('button',{name:'学校',exact:true}).first();
    await school.click(); await dialog('学校').waitFor();
    const schoolRequest = async () => {
      for(let i=0;!pending.some(p=>p.data.word==='学校') && i<200;i++) await page.waitForTimeout(30);
      assert(pending.some(p=>p.data.word==='学校'),'school request was sent');
      const i=pending.findIndex(p=>p.data.word==='学校');
      await pending.splice(i,1)[0].route.fulfill({json:{gloss:'Школа: место для учёбы. '.repeat(100),transcription:'xué xiào'}});
    };
    await schoolRequest();
    await dialog('学校').getByText(/^Школа: место для учёбы/).waitFor();
    await bounds(page,dialog('学校'));
    assert(await dialog('学校').evaluate(el=>el.scrollHeight>el.clientHeight));
    await page.setViewportSize({width:960,height:780});
    await bounds(page,dialog('学校'));
    await page.setViewportSize({width:960,height:720});
    assert(pending.some(p=>p.data.word==='镜子'),'previous word still has a delayed request');
    for (const p of pending.splice(0)) await p.route.fulfill({json:{gloss:'Чужой поздний ответ',transcription:'jìng zi'}});
    await page.waitForTimeout(150);
    assert(!await dialog('学校').innerText().then(t=>t.includes('Чужой')));
    await page.keyboard.press('Escape'); await dialog('学校').waitFor({state:'detached'});
    record('switching words rejects stale response; long loaded meaning and resized viewport stay bounded');

    await page.getByRole('button',{name:'Сбросить выбор',exact:true}).click();
    const edgeIndex = await known.evaluateAll(els=>els.slice(16,32).map((el,i)=>({i:i+16,right:el.getBoundingClientRect().right})).sort((a,b)=>b.right-a.right)[0].i);
    const edge = known.nth(edgeIndex);
    await edge.scrollIntoViewIfNeeded();
    await edge.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().bottom-(innerHeight-12)));
    assert((await edge.boundingBox()).y > 600);
    await edge.click(); await dialog('学习').waitFor();
    await bounds(page,dialog('学习'));
    assert(await dialog('学习').evaluate(el=>el.scrollHeight>el.clientHeight));
    await dialog('学习').evaluate(el=>{el.scrollTop=100;});
    assert(await dialog('学习').evaluate(el=>el.scrollTop>0));
    await dialog('学习').locator('.select-text').first().click();
    assert.equal(await dialog('学习').count(),1,'inside tap preserves popup');
    assert.equal(await dialog('学习').locator('.select-text').first().evaluate(el=>getComputedStyle(el).userSelect),'text');
    await page.screenshot({path:path.join(out,'desktop-bottom.png')});
    await page.evaluate(()=>window.scrollBy(0,100));
    await bounds(page,dialog('学习'));
    await page.keyboard.press('Escape');
    await dialog('学习').waitFor({state:'detached'});
    await known.first().click(); await dialog('学习').waitFor();
    await page.getByTestId('reader-new-count').click(); await dialog('学习').waitFor({state:'detached'});
    record('bottom-edge long saved meaning constrained, scrollable and follows page scroll');

    await page.goto(app+'/word/'+fixture.word,{waitUntil:'domcontentloaded'});
    const pill = page.getByRole('button',{name:'+ 拒绝',exact:true});
    await pill.waitFor(); await pill.scrollIntoViewIfNeeded();
    let release;
    const wait = new Promise(resolve=>{release=resolve;});
    await page.route('**/api/dict?word=*',async route=>{
      if (new URL(route.request().url()).searchParams.get('word')==='拒绝') {
        const response = await route.fetch(); await wait; await route.fulfill({response});
      } else await route.continue();
    });
    await pill.hover();
    const tip=page.getByRole('tooltip');
    await tip.getByText('Смотрю…',{exact:true}).waitFor();
    assert(!(await tip.innerText()).includes('refuse'));
    release();
    await tip.getByText(/jù jué/).waitFor();
    assert.match(await tip.innerText(),/[А-Яа-я]/);
    assert(!(await tip.innerText()).includes('拒绝'));
    await page.screenshot({path:path.join(out,'dictionary-preview.png')});
    await page.mouse.move(0,0); await tip.waitFor({state:'detached'});
    await pill.focus(); await tip.waitFor();
    await page.keyboard.press('Escape'); await tip.waitFor({state:'detached'});
    const remove = pill.locator('xpath=../..').getByRole('button',{name:'Удалить',exact:true});
    await remove.focus(); assert(await remove.evaluate(el=>el===document.activeElement));
    record('graph 拒绝 preview: localized pending state then dictionary pinyin/meaning, hover/focus/Escape; remove keyboard accessible');
    await ctx.close();
  }

  const phone=await webkit.launch({headless:true,downloadsPath:out});
  try {
    const {ctx,page,text}=await prepare(phone,{...devices['iPhone 13']});
    const word=text.getByRole('button',{name:'学习',exact:true}).first();
    const pop=page.getByRole('dialog',{name:'学习',exact:true});
    await word.tap(); await pop.waitFor();
    const dock=await page.locator('[data-reader-dock]').boundingBox();
    assert(dock.y>300); await bounds(page,pop);
    await word.tap(); await pop.waitFor({state:'detached'});
    await word.tap(); await pop.waitFor();
    await pop.getByRole('button',{name:'Открыть карточку',exact:true}).tap();
    const card=page.getByRole('dialog',{name:'学习',exact:true}); await card.waitFor();
    await bounds(page,card);
    const box=await card.boundingBox(); assert(Math.abs(box.x+box.width/2-195)<2);
    await page.screenshot({path:path.join(out,'phone-card.png'),animations:'disabled'});
    record('Russian WebKit phone: bottom meaning dock, repeat tap closes, direct Open card stays centered and bounded');
    await ctx.close();
  } finally {await phone.close();}
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,process.argv.includes('--phone-only')?'phone-results.json':'results.json'),JSON.stringify(results,null,2));
} catch (error) {
  await activePage?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
  fs.writeFileSync(path.join(out,'partial.json'),JSON.stringify(results,null,2));
  throw error;
} finally {
  await desktop.close();
  db(`const u=await db.user.findUnique({where:{telegramId:${JSON.stringify(user)}}});if(u){await db.word.deleteMany({where:{userId:u.id}});await db.user.delete({where:{id:u.id}});}`);
}
