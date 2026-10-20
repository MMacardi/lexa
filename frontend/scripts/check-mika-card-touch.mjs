// Local Docker only. WebKit phone layout + simulated keyboard viewport lifecycle;
// Chromium additionally sends real touch input to check native scroll and grading.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const out = path.join(root, '.playwright-cli', 'mika-card-touch');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { webkit, chromium, devices } = await import('../node_modules/playwright-core/index.mjs');
const engine = process.argv[2] || 'webkit';
assert(['webkit', 'chromium'].includes(engine));
const browser = await ({ webkit, chromium })[engine].launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block' });
const user = `mika-touch-${engine}-${Date.now()}`;
const api = 'http://localhost:3000/api';
const app = 'http://localhost:3001';
const question = '女：他不是叫王明吗？我怎么总听你们叫他“老猫”呢？';
const answer = '外号 (wàihào) — прозвище.\n熟悉 (shúxī) — хорошо знать.';
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8',
    input: `import {prisma as db} from './dist/services/db.js';try {${code}} catch(e){console.error(e.message);process.exitCode=1} finally {await db.$disconnect()}`,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await ctx.addInitScript(() => {
    localStorage.setItem('lexa.locale', 'ru');
    localStorage.setItem('lexa.autoGloss', '0');
  });
  assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
  const ids = JSON.parse(db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4}});const ids=[];for(const word of ['责任','学习']){const w=await db.word.create({data:{userId:u.id,word,sourceLang:'zh',targetLang:'ru',phonetic:'zé rèn',meaningZh:'ответственность',partOfSpeech:'существительное',notes:${JSON.stringify('Длинная заметка для проверки плавной прокрутки.\n'.repeat(40))},exampleStatus:'ready',examples:{create:Array.from({length:8},()=>({sentenceEn:'学习中文很重要。',sentenceZh:'Учить китайский важно.',sourceName:'Manual entry',sourceUrl:''}))}}});ids.push(w.id)}console.log(JSON.stringify(ids));`));
  await page.route('**/api/tutor/ask', (route) => route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'final', result: { answer, addWords: [], addCards: [] } }) + '\n' }));
  await page.goto(app + '/review', { waitUntil: 'networkidle' });
  await page.evaluate((ids) => sessionStorage.setItem('lexa.reviewFocusIds', JSON.stringify(ids)), ids);
  await page.reload({ waitUntil: 'networkidle' });
  const card = page.locator('.flip-card');
  await card.waitFor();
  await page.waitForFunction(() => document.documentElement.style.overflow === 'hidden');
  const initialTop = await card.evaluate((el) => el.getBoundingClientRect().top);
  const openMika = () => page.getByRole('button', { name: 'Открыть Мику', exact: true }).filter({ visible: true }).click();
  await openMika();
  const input = page.locator('textarea').filter({ visible: true });
  await input.fill(question);
  await input.press('Enter');
  await page.getByRole('button', { name: 'Копировать', exact: true }).first().waitFor();
  assert.equal(await page.getByText(/Этот чат стал длинным|Мика учитывает до/).count(), 0, 'short chat has no context notice');

  // Reproduce Safari's root pan while the software keyboard is up. Desktop
  // WebKit has no software keyboard, so only its viewport readings are simulated.
  await page.evaluate(() => {
    window.testViewport = { height: innerHeight, top: 0 };
    Object.defineProperties(visualViewport, {
      height: { configurable: true, get: () => window.testViewport.height },
      offsetTop: { configurable: true, get: () => window.testViewport.top },
    });
    const spacer = document.createElement('div');
    spacer.id = 'keyboard-pan-spacer';
    spacer.style.cssText = 'position:absolute;top:1600px;height:1px;width:1px';
    document.body.appendChild(spacer);
  });
  async function keyboard(up) {
    await page.evaluate((up) => {
      window.testViewport.height = up ? innerHeight - 330 : innerHeight;
      window.testViewport.top = up ? 90 : 0;
      visualViewport.dispatchEvent(new Event('resize'));
    }, up);
    await page.waitForTimeout(800);
  }
  await input.focus();
  await keyboard(true);
  await page.evaluate(() => scrollTo(0, 90));
  assert.equal(await page.evaluate(() => scrollY), 90, 'keyboard pan reproduced');
  await input.evaluate((el) => el.blur());
  await keyboard(false);
  assert.equal(await page.evaluate(() => scrollY), 0, 'Done restores the pinned page');
  await input.focus();
  await keyboard(true);
  await page.evaluate(() => scrollTo(0, 90));
  await page.getByRole('button', { name: 'Отмена', exact: true }).filter({ visible: true }).click();
  await input.waitFor({ state: 'hidden' });
  await keyboard(false);
  assert.equal(await page.evaluate(() => scrollY), 0, 'closing Mika restores the page');
  assert.equal(await page.locator('textarea:focus').count(), 0, 'closing blurs the composer');
  await page.evaluate(() => document.getElementById('keyboard-pan-spacer').remove());
  assert(Math.abs(await card.evaluate((el) => el.getBoundingClientRect().top) - initialTop) < 2, 'card toolbar stays reachable');
  console.log(engine + ': keyboard Done and close restore the pinned card page');

  async function checkCopy() {
    const buttons = page.getByRole('button', { name: 'Копировать', exact: true }).filter({ visible: true });
    assert.equal(await buttons.count(), 2, 'copy actions for user and assistant');
    // Clipboard event observes the real legacy copy operation. Force API refusal
    // to cover the fallback rather than replacing it with a successful mock.
    await page.evaluate(() => {
      window.copiedMessages = [];
      window.nativeCopy = document.execCommand.bind(document);
      document.execCommand = (command, ...args) => {
        const value = document.activeElement instanceof HTMLTextAreaElement ? document.activeElement.value : getSelection()?.toString();
        const ok = window.nativeCopy(command, ...args);
        if (command === 'copy' && ok) window.copiedMessages.push(value);
        return ok;
      };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Denied for fallback check')) } });
    });
    await buttons.first().click();
    await page.waitForFunction(() => window.copiedMessages.length === 1);
    await buttons.last().click();
    await page.waitForFunction(() => window.copiedMessages.length === 2);
    assert.deepEqual(await page.evaluate(() => window.copiedMessages), [question, answer]);
    await page.evaluate(() => { document.execCommand = window.nativeCopy; delete navigator.clipboard; });
    if (engine === 'chromium') {
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
      await buttons.first().click();
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), question);
      await buttons.last().click();
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), answer);
    }

    // Existing native text selection must retain browser-owned touch gestures,
    // even on a non-scrolling message / the footer, without a preventDefault.
    const selectionResult = await page.locator('.select-text').filter({ hasText: question }).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const event = (type, y) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'touches', { value: [{ identifier: 1, target: el, clientX: 120, clientY: y }] });
        return e;
      };
      el.dispatchEvent(event('touchstart', 300));
      const move = event('touchmove', 330);
      el.dispatchEvent(move);
      const result = { selected: selection.toString(), prevented: move.defaultPrevented };
      selection.removeAllRanges();
      return result;
    });
    assert.equal(selectionResult.selected, question);
    assert.equal(selectionResult.prevented, false, 'selection handles keep native touch behavior');
    await page.getByText('Скопировано', { exact: true }).last().waitFor({ state: 'hidden' });
  }
  await openMika();
  // The sheet can be reopened after its drag listeners have been cleaned up.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator('.touch-none.border-b').evaluate(async (grip) => {
      const y = grip.getBoundingClientRect().top + 12;
      const event = (type, dy) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        const touch = { identifier: 1, target: grip, clientX: 180, clientY: y + dy };
        Object.defineProperties(e, { touches: { value: type === 'touchend' ? [] : [touch] }, changedTouches: { value: [touch] } });
        return e;
      };
      grip.dispatchEvent(event('touchstart', 0));
      for (const dy of [15, 60, 140, 260]) {
        grip.dispatchEvent(event('touchmove', dy));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      grip.dispatchEvent(event('touchend', 260));
    });
    await input.waitFor({ state: 'hidden' });
    await openMika();
  }
  console.log(engine + ': drag down from the header closes and works again after reopening');
  await checkCopy();
  await page.screenshot({ path: path.join(out, engine + '-mika-sheet.png') });
  await page.getByRole('link', { name: 'Открыть на весь экран', exact: true }).click();
  await page.waitForURL(app + '/mika');
  await checkCopy();
  await page.screenshot({ path: path.join(out, engine + '-mika-page.png') });
  console.log(engine + ': both message types copy in sheet and page; native selection stays enabled');

  // Return to a fresh focused review after the full page unmounts its scroll lock.
  await page.evaluate((ids) => sessionStorage.setItem('lexa.reviewFocusIds', JSON.stringify(ids)), ids);
  await page.goto(app + '/review', { waitUntil: 'networkidle' });
  await card.waitFor();
  await card.click({ position: { x: 80, y: 100 } });
  await page.locator('.flip-card.is-flipped').waitFor();
  await page.waitForTimeout(600);
  const scroller = page.locator('.flip-back > div').first();
  const dims = await scroller.evaluate((el) => ({ h: el.clientHeight, content: el.scrollHeight, action: getComputedStyle(el).touchAction }));
  assert(dims.content > dims.h + 100, 'long answer overflows');
  assert.equal(dims.action, 'pan-y');
  assert.equal(await page.locator('div.cursor-grab').evaluate((el) => getComputedStyle(el).touchAction), 'pan-y');
  if (engine === 'chromium') {
    const cdp = await ctx.newCDPSession(page);
    const r = await scroller.boundingBox();
    const start = { x: r.x + r.width / 2, y: r.y + r.height - 25 };
    async function gesture(dx, dy) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + dx * i / 8, y: start.y + dy * i / 8 }] });
        await page.waitForTimeout(16);
      }
      const beforeRelease = await scroller.evaluate((el) => el.scrollTop);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return beforeRelease;
    }
    const releaseTop = await gesture(0, -120);
    await page.waitForTimeout(200);
    const momentumTop = await scroller.evaluate((el) => el.scrollTop);
    assert(releaseTop > 20, 'native touch scroll moves text');
    // Headless Chromium's injected touch events do not generate a fling on every
    // host. Check release stability here; device inertia/FPS needs a real phone.
    assert(momentumTop >= releaseTop, 'release does not snap the text back');
    await gesture(0, 80);
    assert(await scroller.evaluate((el) => el.scrollTop) < momentumTop, 'reverse touch scroll moves back up');
    assert.equal(await page.locator('.flip-card.is-flipped').count(), 1, 'text scrolling never grades or flips');
    assert.equal(await page.evaluate(() => scrollY), 0, 'answer scroll never moves the page');
    await page.screenshot({ path: path.join(out, engine + '-card-back.png') });
    await gesture(180, 0);
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.flip-card.is-flipped').count(), 0, 'horizontal swipe grades and advances');
    console.log(engine + ': real native touch scrolling both ways, stable release, fixed page and horizontal grading');
  } else {
    await scroller.evaluate((el) => { el.scrollTop = 120; });
    assert.equal(await scroller.evaluate((el) => el.scrollTop), 120);
    await page.screenshot({ path: path.join(out, engine + '-card-back.png') });
    console.log(engine + ': phone card back stays in bounds with a native scroll region');
  }
  assert.deepEqual(errors, []);
  if (engine === 'webkit') {
    for (const [id, messages] of [
      ['touchturnlimit', Array.from({ length: 120 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '学习 ' + i }))],
      ['touchcharlimit', Array.from({ length: 4 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '学'.repeat(16000) }))],
    ]) {
      assert.equal((await ctx.request.put(api + '/tutor/chats/' + id, { data: { messages } })).status(), 200);
      await page.evaluate(({ id, messages }) => {
        sessionStorage.setItem('lexa.tutorChatId', id);
        sessionStorage.setItem('lexa.tutorChat', JSON.stringify(messages));
      }, { id, messages });
      await page.goto(app + '/mika', { waitUntil: 'networkidle' });
      assert.equal(await page.getByText(/Этот чат стал длинным/).count(), 0, 'no notice until a message actually leaves the window');
      await input.fill(question);
      await input.press('Enter');
      await page.getByText(/Этот чат стал длинным/).waitFor();
    }
    console.log(engine + ': context notice appears only after the turn or character budget is exceeded');
  }
} catch (error) {
  await page.screenshot({ path: path.join(out, engine + '-failure.png') }).catch(() => {});
  console.error('Visible actions', await page.getByRole('button').filter({ visible: true }).evaluateAll((buttons) => buttons.slice(0, 25).map((b) => b.getAttribute('aria-label') || b.textContent)).catch(() => []));
  throw error;
} finally {
  await ctx.close();
  await browser.close();
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
}
