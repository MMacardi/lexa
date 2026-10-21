// Local UI regression: real session, deck reads and capture; controlled gloss/chat text.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli', 'compact-popups');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, webkit, devices } = await import('../node_modules/playwright-core/index.mjs');
const app = 'http://localhost:3001', api = 'http://localhost:3000/api';
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
  }).trim();
}
for (const { name, engine, ...options } of [
  { name: 'phone-webkit', engine: webkit, ...devices['iPhone 13'] },
  { name: 'desktop-chromium', engine: chromium, viewport: { width: 1280, height: 900 } },
].filter(c => !process.argv[2] || c.name === process.argv[2])) {
  const browser = await engine.launch({ headless: true, downloadsPath: out });
  const ctx = await browser.newContext({ ...options, locale: 'ru-RU', serviceWorkers: 'block' });
  const page = await ctx.newPage(), user = `compact-popups-${name}-${Date.now()}`;
  page.setDefaultTimeout(20_000);
  const errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await ctx.addInitScript(() => {
      localStorage.setItem('lexa.locale', sessionStorage.getItem('test.locale') || 'ru');
      localStorage.setItem('lexa.autoGloss', sessionStorage.getItem('test.gloss') || '1');
      localStorage.setItem('lexa.readerUnderlines', sessionStorage.getItem('test.underlines') || '1');
      localStorage.setItem('lexa.exampleStyle', 'none');
      localStorage.setItem('lexa.examplePinyin', '0');
      localStorage.setItem('lexa.showTextLevel', '0');
    });
    assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
    const ids = JSON.parse(db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4,levels:{zh:'B2'}}});const ids=[];for(const [word,meaning,targetLang] of [['路','дорога','ru'],['语言','язык','ru'],['长','long','en']]){const w=await db.word.create({data:{userId:u.id,word,meaningZh:meaning,phonetic:word==='语言'?'yǔ yán':null,sourceLang:'zh',targetLang,collocations:[],synonyms:[],antonyms:[],familyAt:new Date(),autoExamples:false,exampleStatus:'ready',examples:{create:{sentenceEn:'这条路很长。',sentenceZh:'Эта дорога длинная.',sourceName:'Popup check',sourceUrl:'',checkedAt:new Date()}}}});ids.push(w.id);}console.log(JSON.stringify(ids));`));
    let glossMode = 'success', releaseGloss, sawGloss;
    const glossGate = new Promise(resolve => releaseGloss = resolve);
    const glossRequested = new Promise(resolve => sawGloss = resolve);
    await page.route('**/api/gloss', async route => {
      if (glossMode === 'failure') { sawGloss(); await glossGate; return route.fulfill({status:502,contentType:'application/json',body:'{"error":"Controlled failure"}'}); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ gloss: 'длинный', transcription: 'cháng' }) });
    });
    // Keep loading/failure cases on the AI fallback after dictionary-first taps.
    await page.route('**/api/dict?*', async route => {
      const response = await route.fetch(), data = await response.json();
      if (data.entry) data.entry.meaning = null;
      await route.fulfill({ response, json: data });
    });
    let unknownBox = null;
    if (!process.argv.includes('--reader-only') && !process.argv.includes('--shared-only')) {
    await page.goto(app + '/word/' + ids[0], { waitUntil: 'domcontentloaded' });
    const token = page.locator('[data-ci]').filter({ hasText: /^长$/ }).first();
    glossMode = 'failure';
    await token.click();
    const pop = page.getByRole('dialog', { name: '长', exact: true });
    const add = pop.getByRole('button', { name: 'В мои слова', exact: true });
    await pop.getByText('Смотрю…',{exact:true}).waitFor();
    assert.ok(await add.isDisabled(), 'loading cannot add');
    await glossRequested;
    releaseGloss();
    await pop.getByText('Не удалось перевести',{exact:true}).waitFor();
    assert.equal(await pop.getByRole('status').count(),0,'failed lookup is never shown as saved');
    await page.keyboard.press('Escape');
    glossMode = 'success';
    await token.click();
    await add.waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent === 'В мои слова')?.disabled);
    assert.equal(await pop.getByText('Новое', { exact: true }).count(), 0);
    async function fits(label) {
      await page.waitForTimeout(220);
      const r = await pop.boundingBox(), v = page.viewportSize();
      assert.ok(r.x >= 7 && r.y >= 7 && r.x + r.width <= v.width - 7 && r.y + r.height <= v.height - 7, label + JSON.stringify({r,v}));
      assert.ok(r.width <= 241, 'compact maximum width');
      return r;
    }
    unknownBox = await fits('unknown');
    assert.ok(unknownBox.width < 228, 'short meaning sizes to its content');
    for (const edge of ['left','right']) {
      await token.evaluate((el,edge) => {
        el.removeAttribute('style');
        const r=el.getBoundingClientRect();
        el.style.cssText=`display:inline-block;transform:translate(${(edge==='left'?0:innerWidth-r.width)-r.x}px,${innerHeight-r.height-r.y-1}px)`;
        window.dispatchEvent(new Event('resize'));
      },edge);
      await fits('bottom-' + edge);
    }
    await token.evaluate(el => {el.removeAttribute('style');window.dispatchEvent(new Event('resize'));});
    await page.screenshot({ path: path.join(out, name + '-example.png') });
    checks.push('loading/error/compact width/bottom corners');
    if (process.argv.includes('--popup-state-only')) {
      console.log(name + ': loading, errors, compact width and bottom viewport edges passed');
      fs.writeFileSync(path.join(out,name+'-popup-state.json'),JSON.stringify({unknownBox,checks},null,2));
      continue;
    }
    await add.click();
    await pop.getByRole('status').filter({ hasText: 'Добавлено' }).waitFor();
    assert.equal(await add.count(), 0);
    const deck = await (await ctx.request.get(api + '/words')).json();
    assert.equal(deck.filter(w => w.word === '长' && w.targetLang === 'ru').length, 1, 'one capture in the exact pair');
    assert.equal(deck.filter(w => w.word === '长' && w.targetLang === 'en').length, 1, 'other pair preserved');
    const repeat=await ctx.request.post(api+'/words/batch',{data:{sourceLang:'zh',targetLang:'ru',words:['长'],enrich:false,exampleStyle:'none'}});
    assert.equal(repeat.status(),201);
    const repeated=await repeat.json();
    assert.equal(repeated.created,0); assert.equal(repeated.skipped,1,'same-pair capture still skipped');
    await page.keyboard.press('Escape');
    await pop.waitFor({ state: 'detached' });
    await token.focus();
    await page.keyboard.press('Enter');
    await pop.getByRole('status').filter({ hasText: 'Добавлено' }).waitFor();
    await page.keyboard.press('Escape');
    assert.ok(await token.evaluate(el => el === document.activeElement), 'Escape restores trigger focus');
    // A fresh context has no in-memory word list or IndexedDB mirror.
    const cold = await browser.newContext({ ...options, locale: 'ru-RU', serviceWorkers: 'block', storageState: { cookies: (await ctx.storageState()).cookies, origins: [] } });
    await cold.addInitScript(() => { localStorage.setItem('lexa.locale', 'ru'); localStorage.setItem('lexa.examplePinyin', '0'); });
    const direct = await cold.newPage();
    await direct.goto(app + '/word/' + ids[0]);
    await direct.locator('[data-ci]').filter({ hasText: /^长$/ }).first().click();
    await direct.getByRole('dialog', { name: '长', exact: true }).getByRole('status').filter({ hasText: 'Добавлено' }).waitFor();
    assert.equal(await direct.getByRole('button', { name: 'В мои слова', exact: true }).count(), 0);
    await direct.reload();
    await direct.locator('[data-ci]').filter({ hasText: /^长$/ }).first().click();
    await direct.getByRole('dialog', { name: '长', exact: true }).getByRole('status').filter({ hasText: 'Добавлено' }).waitFor();
    await cold.close();
    console.log(name + ': capture, cold ownership, reload and keyboard passed');
    checks.push('capture/exact pair/repeat add/cold ownership/reload/keyboard');
    }

    async function reader(gloss, underlines, locale = 'ru') {
      await page.evaluate(({gloss, underlines, locale}) => { sessionStorage.setItem('test.gloss', gloss); sessionStorage.setItem('test.underlines', underlines); sessionStorage.setItem('test.locale', locale); }, {gloss, underlines, locale});
      await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
      await page.locator('textarea').filter({ visible: true }).first().fill('我学习语言。');
      await page.getByRole('button', { name: {ru:'Читать',en:'Read',zh:'开始阅读'}[locale], exact:true }).click();
    }
    if (page.url() === 'about:blank') await page.goto(app + '/reader');
    if (!process.argv.includes('--shared-only')) {
    await reader('1', '1');
    const hint = page.getByText('Нажми на слово — увидишь перевод. Незнакомые можно выбрать и добавить.', { exact: false });
    await hint.waitFor();
    assert.equal(await page.getByText(/Те, что учишь, подчёркнуты/).count(), 0);
    await page.getByRole('button', { name:'语言', exact:true }).first().click();
    const saved = page.getByRole('button', { name:'Открыть карточку', exact:true });
    await saved.waitFor();
    if (name.startsWith('phone')) {
      const r = await page.locator('[data-reader-dock]').boundingBox();
      assert.ok(r.y > page.viewportSize().height / 2, 'Reader stays docked');
      await page.getByText('Нажми на добавленное слово, чтобы увидеть перевод и открыть карточку.', {exact:true}).waitFor();
    } else {
      await page.getByText('Зажми добавленное слово, чтобы открыть карточку.', {exact:true}).waitFor();
      const savedToken = page.getByRole('button', { name:'语言', exact:true }).first();
      await page.keyboard.press('Escape');
      await savedToken.click({delay:600});
      await page.getByRole('dialog', {name:'语言',exact:true}).waitFor();
    }
    await page.screenshot({ path:path.join(out, name + '-reader.png') });
    await reader('0', '0');
    await page.getByText('Нажми на незнакомые слова, чтобы выбрать и добавить их.', {exact:false}).waitFor();
    await page.getByRole('button', {name:'学习',exact:true}).first().click();
    assert.equal(await page.getByText('длинный',{exact:true}).filter({visible:true}).count(),0, 'auto-gloss off selects without translation');
    await page.getByRole('button',{name:'Добавить 1',exact:true}).waitFor();
    // Underlines must not change which interaction the hint promises.
    await reader('1', '0');
    await hint.waitFor();
    await page.getByRole('button', {name:'学习',exact:true}).first().click();
    await page.getByText('длинный',{exact:true}).filter({visible:true}).first().waitFor();
    for (const [locale, text] of [['en','Tap a word to see its meaning. Select unfamiliar words to add them.'], ['zh','点击单词查看释义。可选中生词并添加。']]) {
      await reader('1','1',locale);
      await page.getByText(text,{exact:false}).waitFor();
    }
    console.log(name + ': Reader copy, auto-gloss and underlines passed');
    checks.push('Reader auto-gloss/underlines/tap/desktop hold/ru-en-zh');
    }
    await page.evaluate(() => sessionStorage.setItem('test.locale','ru'));
    await page.route('**/api/coach/chat', r => r.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({type:'final',result:{say:'我学习语言。',seeded:['语言'],used:[],newWords:[]}})+'\n'}));
    await page.goto(app + '/coach/chat');
    await page.getByRole('button',{name:'Начать беседу',exact:true}).click();
    await page.locator('span[role=button]').filter({hasText:/^语言$/}).first().click();
    await page.getByRole('dialog',{name:'语言',exact:true}).getByRole('status').filter({hasText:'Добавлено'}).waitFor();
    await page.keyboard.press('Escape');
    await page.route('**/api/coach/scene/setup',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({title:'Popup check',setting:'Library',character:'Librarian',characterName:'小李',learnerRole:'Visitor',goal:'Read',briefing:'Read',missionWords:[],newWords:[{word:'语言',meaning:'язык'}],opening:'我学习语言。'})}));
    await page.goto(app + '/coach/scene');
    await page.getByRole('button',{name:'Сыграть',exact:true}).click();
    await page.getByRole('button',{name:'Начать сцену',exact:true}).click();
    await page.locator('span[role=button]').filter({hasText:/^语言$/}).first().click();
    const shared=page.getByRole('dialog',{name:'语言',exact:true});
    await shared.getByRole('status').filter({hasText:'Добавлено'}).waitFor();
    assert.equal(await shared.getByRole('button',{name:'В мои слова',exact:true}).count(),0,'saved words override old scene new-word flags');
    await page.mouse.click(5,100);
    await shared.waitFor({state:'detached'});
    console.log(name + ': shared chat and scene callers passed');
    db(`const u=await db.user.findUniqueOrThrow({where:{telegramId:${JSON.stringify(user)}}});await db.word.deleteMany({where:{userId:u.id}});`);
    await reader('1','1');
    await page.getByText('Нажми на слово — увидишь перевод. Незнакомые можно выбрать и добавить.',{exact:false}).waitFor();
    assert.equal(await page.getByText(/Зажми добавленное слово|Нажми на добавленное слово/).count(),0,'no saved-word instruction for an empty deck');
    checks.push('shared chat/scene/empty deck hint');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out,name+(process.argv.includes('--shared-only')?'-shared':'')+'.json'),JSON.stringify({unknownBox,checks},null,2));
  } catch(e) {
    await page.screenshot({path:path.join(out,name+'-failure.png')}).catch(()=>{});
    throw e;
  } finally {
    await browser.close();
    db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
  }
}
