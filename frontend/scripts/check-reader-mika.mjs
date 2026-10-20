// Local learner flows in Russian. Live Qwen by default; --fixtures replays the
// separately verified Qwen outputs to exercise the other browser engines cheaply.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const out = path.join(root, '.playwright-cli', 'reader-mika');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, webkit, firefox, devices } = await import('../node_modules/playwright-core/index.mjs');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'backend/scripts/reader-mika-result.log'), 'utf8'));
const configs = [
  { name: 'desktop-chromium', engine: chromium, viewport: { width: 1280, height: 900 } },
  { name: 'phone-chromium', engine: chromium, viewport: { width: 360, height: 780 }, hasTouch: true },
  { name: 'phone-webkit', engine: webkit, ...devices['iPhone 13'] },
  { name: 'phone-firefox', engine: firefox, viewport: { width: 390, height: 844 }, hasTouch: true },
];
const app = 'http://localhost:3001';
const api = 'http://localhost:3000';
const fixtureMode = process.argv.includes('--fixtures');
const selectedConfig = process.argv.find((a) => configs.some((c) => c.name === a));
const source = fixtures.translation.alignment.source;
const passage = '今天我去图书馆看书。明天我想和朋友一起学习汉语。';

for (const config of configs.filter((c) => !selectedConfig || c.name === selectedConfig)) {
  const { name, engine, ...options } = config;
  const desktop = options.viewport.width >= 768;
  const browser = await engine.launch({ headless: true, downloadsPath: path.join(out, 'downloads') });
  const ctx = await browser.newContext({ ...options, locale: 'ru-RU', serviceWorkers: 'block' });
  const user = `reader-mika-ui-${name}-${Date.now()}`;
  const errors = [];
  let page;
  try {
    await ctx.addInitScript(() => {
      localStorage.setItem('lexa.locale', 'ru');
      localStorage.setItem('lexa.autoGloss', '0');
      localStorage.setItem('lexa.showTextLevel', '0');
    });
    const login = await ctx.request.post(api + '/api/auth/dev', { data: { telegramId: user } });
    assert.equal(login.status(), 200);
    execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
      cwd: root, input: `import { PrismaClient } from '@prisma/client'; const db = new PrismaClient(); await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,invitedAt:new Date(),nativeLang:'ru',hskTarget:4}}); await db.$disconnect();`,
    });
    const text = await ctx.request.post(api + '/api/reader/texts', { data: { title: 'Сяоюй и мама', content: source, sourceLang: 'zh', targetLang: 'ru', translation: fixtures.translation.translation } });
    assert.equal(text.status(), 201, await text.text());
    const { id } = await text.json();
    const mapping = await ctx.request.put(api + '/api/reader/texts/' + id, { data: { translationAlignment: fixtures.translation.alignment } });
    assert.equal(mapping.status(), 200, await mapping.text());
    page = await ctx.newPage();
    page.setDefaultTimeout(25_000);
    page.on('pageerror', (e) => errors.push(e.message));
    if (fixtureMode) {
      await page.route('**/api/tutor/ask', async (route) => {
        const req = route.request().postDataJSON();
        const q = req.messages.at(-1).content;
        const result = q.includes('фото') ? fixtures.photo : q.includes('номер комнаты') ? fixtures.recall.recall : q.includes('无论') ? fixtures.focus : q.includes('Читалке') ?
          { answer: 'Открой текст кнопкой ниже.', addWords: [], addCards: [], readerText: { title: 'В библиотеке', content: passage } } : fixtures.reader;
        await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'final', result }) + '\n' });
      });
    }
    await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button').filter({ hasText: 'Сяоюй и мама' }).click();
    const original = page.locator('div.select-none.whitespace-pre-wrap');
    await original.waitFor();
    assert.equal(await original.textContent(), source);
    const translationButton = desktop ? page.getByRole('button', { name: /Показать перевод/ }) : page.getByRole('button', { name: /Перевод/ }).first();
    await translationButton.click();
    const word = original.getByRole('button', { name: '妈妈', exact: true }).first();
    await word.click();
    await page.getByTestId('translation-highlight').waitFor();
    assert.match(await page.getByTestId('translation-highlight').textContent(), /мам/i);
    await word.focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('translation-highlight').waitFor();
    // Each occurrence has its own offsets, including the weather use of 小雨.
    const rain = original.getByRole('button', { name: '小雨', exact: true }).last();
    await rain.click();
    assert.match(await page.getByTestId('translation-highlight').textContent(), /дожд/i);
    await page.waitForFunction(() => {
      const mark = document.querySelector('[data-testid="translation-highlight"]')?.getBoundingClientRect();
      const dock = document.querySelector('[data-reader-dock]')?.getBoundingClientRect();
      return mark && mark.top >= 0 && mark.bottom <= Math.min(innerHeight, dock?.top ?? Infinity);
    });
    await page.screenshot({ path: path.join(out, name + '-alignment.png'), fullPage: true, animations: 'disabled' });
    console.log(name + ': persisted alignment, repeated words and keyboard');

    // Select a word, then ask Mika without copying the passage into the question.
    await word.click();
    await page.getByRole('button', { name: 'Открыть Мику', exact: true }).filter({ visible: true }).click();
    async function send(q) {
      const input = page.getByPlaceholder('Спроси или добавь фото…').filter({ visible: true });
      await input.fill(q);
      await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label="Отправить"]')].some((b) => !b.disabled));
      const response = page.waitForResponse((r) => r.url().endsWith('/api/tutor/ask') && r.request().method() === 'POST', { timeout: 90_000 });
      await input.press('Enter');
      const res = await response;
      assert.equal(res.status(), 200, await res.text());
      const records = (await res.text()).trim().split('\n').map((s) => JSON.parse(s));
      const final = records.find((r) => r.type === 'final');
      assert(final, JSON.stringify(records));
      await input.waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('textarea:disabled'));
      return { result: final.result, request: res.request().postDataJSON() };
    }
    const read = await send('Прочитай текст, который я сейчас читаю. Куда завтра едет героиня и как её зовут?');
    assert.equal(read.request.readerContext.content, source);
    assert.equal(read.request.readerContext.selection, '妈妈');
    assert.match(read.result.answer, /Пекин|北京/i);
    await page.getByRole('link', { name: 'Открыть на весь экран', exact: true }).click();
    await page.waitForURL(app + '/mika');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const again = await send('Напомни, куда завтра едет героиня текста.');
    assert.equal(again.request.readerContext.content, source);
    assert.match(again.result.answer, /Пекин|北京/i);
    const focus = await send('Объясни 无论');
    assert.deepEqual(focus.result.addWords, ['无论']);
    await page.getByRole('button', { name: '无论', exact: true }).waitFor();
    console.log(name + ': Reader to panel to full page to reload, focused suggestions');
    if (desktop) {
      // Chat saves are intentionally debounced. Confirm that the opening chat is
      // on the account before reloading and searching for it in account history.
      const currentChat = await page.evaluate(() => sessionStorage.getItem('lexa.tutorChatId'));
      let stored = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const saved = await ctx.request.get(api + '/api/tutor/chats/' + currentChat);
        const body = await saved.json();
        if (saved.ok() && body.messages?.at(-1)?.addWords?.includes('无论')) { stored = true; break; }
        await page.waitForTimeout(250);
      }
      assert(stored, 'completed chat is saved before switching account history');
      assert(fixtures.memory, 'run backend/scripts/check-reader-mika.ts first to record the real 16-exchange history');
      const memory = fixtures.memory.map((m) => { const next = { ...m }; delete next.readerContext; return next; });
      const history = await ctx.request.put(api + '/api/tutor/chats/uimemory', { data: { messages: memory } });
      assert.equal(history.status(), 200);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'История', exact: true }).filter({ visible: true }).click();
      await page.getByRole('button').filter({ hasText: 'В нашем учебном диалоге героиню зовут Лена' }).click();
      const recalled = await send('Какой номер комнаты у героини нашего учебного диалога?');
      assert(recalled.request.messages.length > 30);
      assert.match(recalled.result.answer, /721/);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const reloaded = await send('Напомни номер комнаты героини.');
      assert.match(reloaded.result.answer, /721/);
      await page.getByRole('button', { name: 'История', exact: true }).filter({ visible: true }).click();
      await page.getByRole('button').filter({ hasText: 'Прочитай текст, который я сейчас читаю.' }).click();
      await page.getByText('Прочитай текст, который я сейчас читаю. Куда завтра едет героиня и как её зовут?', { exact: true }).waitFor();
      console.log(name + ': saved chat switching and recall after 16 exchanges and reload');
      await page.locator('input[type="file"]').last().setInputFiles(path.join(root, 'backend/scripts/fixtures/lesson-page.jpg'));
      await page.waitForFunction(() => document.querySelectorAll('img[src^="data:image/"]').length > 0);
      const photo = await send('Прочитай текст с фото и предложи открыть его в Читалке.');
      assert(photo.request.messages.at(-1).images?.length);
      assert.match(photo.result.readerText.content, /图书馆/);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const photoReload = await send('Повтори последнюю строку с фото.');
      assert(photoReload.request.messages.some((m) => m.images?.length));
      assert.match(photoReload.result.answer, /图书馆/);
      console.log(name + ': photo composer and photo follow-up survive reload');
    }

    const handed = await send('Открой этот текст в Читалке:\n' + passage);
    assert.equal(handed.result.readerText.content, passage);
    await page.getByRole('button', { name: 'Открыть в Читалке', exact: true }).last().click();
    await page.waitForURL(app + '/reader');
    await original.waitFor();
    assert.equal(await original.textContent(), passage);
    const list = await (await ctx.request.get(api + '/api/reader/texts')).json();
    const firstPassage = list.find((r) => r.snippet === passage);
    assert(firstPassage);
    // Same passage handed off again while Reader remains mounted: no duplicate.
    await page.getByRole('button', { name: 'Открыть Мику', exact: true }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'Открыть в Читалке', exact: true }).last().click();
    await original.waitFor();
    assert.equal(await original.textContent(), passage);
    assert.equal((await (await ctx.request.get(api + '/api/reader/texts')).json()).length, 2);
    console.log(name + ': real save/open hand-off, including mounted Reader and deduplication');

    // User text length is rejected in view, with the original composer untouched.
    await page.getByRole('button', { name: 'Открыть Мику', exact: true }).filter({ visible: true }).click();
    const composer = page.getByPlaceholder('Спроси или добавь фото…').filter({ visible: true });
    await composer.fill('字'.repeat(20_001));
    await page.getByRole('alert').filter({ hasText: '20 000' }).waitFor();
    await composer.press('Enter');
    assert.equal((await composer.inputValue()).length, 20_001);
    await composer.fill('');
    console.log(name + ': long-message boundary preserves composer');
    await page.screenshot({ path: path.join(out, name + '-mika.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Отмена', exact: true }).filter({ visible: true }).last().click();

    // Actual saved cards, with controlled enrichment completion/error timing.
    let job = 0;
    let fail = false;
    let jobCards = [];
    await page.route('**/api/words/batch', async (route) => {
      const payload = route.request().postDataJSON();
      const response = await route.fetch({ postData: JSON.stringify({ ...payload, enrich: false }) });
      const body = await response.json();
      const saved = await ctx.request.get(api + '/api/words').then((r) => r.json());
      const wanted = payload.items?.map((i) => i.word) ?? payload.words ?? [];
      jobCards = wanted.map((word) => saved.find((w) => w.word === word)).filter(Boolean).map(({ id, word }) => ({ id, word }));
      await route.fulfill({ response, json: { ...body, job: { id: 'uitracker' + ++job, total: 1 } } });
    });
    await page.route('**/api/words/import/uitracker*', async (route) => {
      await route.fulfill({ status: 200, json: { id: 'uitracker' + job, total: 1, processed: 1, status: fail ? 'failed' : 'completed', errors: fail ? ['test failure'] : [], errorMessage: fail ? 'test failure' : null, cards: jobCards } });
    });
    async function addWord(term) {
      // Clear selection by toggling any selected source words first.
      const clear = page.getByRole('button', { name: /Сбросить выбор/ }).filter({ visible: true }).first();
      if (await clear.count()) await clear.click();
      await original.getByRole('button', { name: term, exact: true }).first().click();
      await page.getByRole('button', { name: /^Добавить \d+$/ }).filter({ visible: true }).click();
      await page.getByTestId('enrichment-tracker').waitFor();
    }
    await addWord('图书馆');
    console.log(name + ': started enrichment tracker check');
    const tracker = page.getByTestId('enrichment-tracker');
    await tracker.getByRole('link', { name: '图书馆', exact: true }).waitFor();
    console.log(name + ': completed tracker has card link');
    if (desktop) {
      await tracker.hover();
      await page.waitForTimeout(7000);
      assert(await tracker.isVisible(), 'pointer pauses dismissal');
      await page.mouse.move(900, 450);
      await tracker.getByRole('link', { name: '图书馆', exact: true }).focus();
      await page.waitForTimeout(7000);
      assert(await tracker.isVisible(), 'focus pauses dismissal');
      await page.mouse.click(900, 450);
      await addWord('学习');
      await tracker.getByRole('link', { name: '学习', exact: true }).waitFor();
      assert.equal(await tracker.getByText('图书馆', { exact: true }).count(), 0, 'new work replaces old completed words');
    }
    await page.mouse.move(700, 400);
    await page.locator('body').click({ position: { x: 2, y: 200 } });
    await tracker.waitFor({ state: 'hidden', timeout: 12_000 });
    if (desktop) {
      fail = true;
      await addWord('朋友');
      await tracker.getByText('test failure', { exact: true }).waitFor();
      await page.mouse.move(900, 450);
      await page.waitForTimeout(7000);
      assert(await tracker.isVisible(), 'failed progress remains available');
      fail = false;
      await addWord('汉语');
      await tracker.getByRole('link', { name: '汉语', exact: true }).waitFor();
      assert.equal(await tracker.getByText('朋友', { exact: true }).count(), 0);
      await tracker.waitFor({ state: 'hidden', timeout: 12_000 });
    }
    console.log(name + ': completed enrichment fades while idle, new words and card links work');
    // A many-to-one possessive and a particle with only a sentence equivalent.
    const alignedSource = '妈妈的书。她走了。';
    const alignedTarget = 'Мамина книга. Она ушла.';
    const fallback = await ctx.request.post(api + '/api/reader/texts', { data: { title: 'Притяжательное и частица', content: alignedSource, sourceLang: 'zh', targetLang: 'ru', translation: alignedTarget } });
    const fallbackId = (await fallback.json()).id;
    await ctx.request.put(api + '/api/reader/texts/' + fallbackId, { data: { translationAlignment: { version: 1, source: alignedSource, translation: alignedTarget, spans: [
      { sourceStart: 0, sourceEnd: 3, targetStart: 0, targetEnd: 6, kind: 'phrase' },
      { sourceStart: 0, sourceEnd: 5, targetStart: 0, targetEnd: 13, kind: 'sentence' },
      { sourceStart: 7, sourceEnd: 8, targetStart: 0, targetEnd: 0, kind: 'word' },
      { sourceStart: 5, sourceEnd: 9, targetStart: 14, targetEnd: 23, kind: 'sentence' },
    ] } } });
    await page.goto(app + '/reader', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button').filter({ hasText: 'Притяжательное и частица' }).click();
    await translationButton.click();
    await original.getByRole('button', { name: '妈妈', exact: true }).click();
    assert.equal(await page.getByTestId('translation-highlight').textContent(), 'Мамина');
    await original.getByRole('button', { name: '了', exact: true }).click();
    assert.equal(await page.getByTestId('translation-highlight').textContent(), 'Она ушла.');
    await page.getByText('Точное соответствие слова не найдено — подсвечено предложение целиком.', { exact: true }).waitFor();
    console.log(name + ': possessive phrase and particle sentence fallback');
    // Old cached example translations change only after an explicit editor save.
    const oldTranslation = 'Мелкий дождь сказал, что завтра едет в Пекин.';
    const cardId = execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
      cwd: root, encoding: 'utf8', input: `import { PrismaClient } from '@prisma/client'; const db = new PrismaClient(); const u = await db.user.findUniqueOrThrow({where:{telegramId:${JSON.stringify(user)}}}); const w = await db.word.create({data:{userId:u.id,word:'小雨',sourceLang:'zh',targetLang:'ru',meaningZh:'Сяоюй (имя)',phonetic:'Xiǎoyǔ',partOfSpeech:'имя собственное',familyAt:new Date(),examples:{create:{sentenceEn:'小雨说她明天去北京。',sentenceZh:${JSON.stringify(oldTranslation)},sourceName:'Учебник',sourceUrl:''}}}}); console.log(w.id); await db.$disconnect();`,
    }).trim();
    await page.goto(app + '/word/' + cardId, { waitUntil: 'domcontentloaded' });
    async function editCard() { await page.getByRole('button', { name: /Изменить/ }).click(); }
    const trInput = page.getByPlaceholder('Перевод примера', { exact: true });
    const translateEx = page.getByRole('button', { name: 'Перевести пример заново', exact: true });
    async function translateDraft() {
      await translateEx.click();
      await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some((e) => e.placeholder === 'Перевод примера' && /Сяо[ -]?юй/i.test(e.value)));
    }
    const readCard = async () => (await ctx.request.get(api + '/api/words/' + cardId)).json();
    await editCard();
    await translateDraft();
    assert.equal((await readCard()).examples[0].sentenceZh, oldTranslation);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await editCard();
    assert.equal(await trInput.inputValue(), oldTranslation);
    await translateDraft();
    await page.screenshot({ path: path.join(out, name + '-example-draft.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await trInput.waitFor({ state: 'hidden' });
    assert.match((await readCard()).examples[0].sentenceZh, /Сяо[ -]?юй/i);
    await editCard();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/translate', async (route) => { await gate; await route.fulfill({ status: 200, json: { translation: 'Ответ запоздавшего запроса' } }); });
    const requestStarted = page.waitForRequest((r) => r.url().endsWith('/api/translate'));
    await translateEx.click();
    await requestStarted;
    await trInput.fill('Моя правка во время перевода');
    release();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Перевести пример заново') && !b.disabled));
    assert.equal(await trInput.inputValue(), 'Моя правка во время перевода');
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    console.log(name + ': cached example repair is a draft; cancel, explicit save and concurrent edit protection');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false);
    assert.deepEqual(errors, []);
  } catch (e) {
    if (page) {
      await page.screenshot({ path: path.join(out, name + '-failure.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(out, name + '-failure.html'), await page.content());
    }
    throw e;
  } finally {
    await browser.close();
    execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
      cwd: root, input: `import { deleteAccount } from './dist/services/accountData.js'; import { prisma } from './dist/services/db.js'; await deleteAccount(${JSON.stringify(user)}); await prisma.$disconnect();`,
    });
  }
}
