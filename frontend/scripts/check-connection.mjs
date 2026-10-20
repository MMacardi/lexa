// Local Docker only. Creates/deletes its own accounts; API faults never hit production.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const out = path.join(root, '.playwright-cli', 'connection');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium, webkit, firefox, devices } = await import('../node_modules/playwright-core/index.mjs');
const configs = [
  { name: 'desktop-chromium', engine: chromium, viewport: { width: 1280, height: 900 } },
  { name: 'phone-chromium', engine: chromium, viewport: { width: 360, height: 780 }, hasTouch: true },
  { name: 'phone-webkit', engine: webkit, ...devices['iPhone 13'] },
  { name: 'phone-firefox', engine: firefox, viewport: { width: 390, height: 844 }, hasTouch: true },
];
const selected = process.argv[2];
const app = 'http://localhost:3001';
const api = 'http://localhost:3000/api';
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, encoding: 'utf8',
    input: `import {prisma as db} from './dist/services/db.js'; try { ${code} } catch(e) { console.error(e.message); process.exitCode=1; } finally {await db.$disconnect();}`,
  }).trim();
}
async function stored(page, store, action, value) {
  return page.evaluate(({ store, action, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('lexa', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const tx = database.transaction(store, action === 'all' ? 'readonly' : 'readwrite');
      const request = action === 'all' ? tx.objectStore(store).getAll() : tx.objectStore(store).add(value);
      tx.oncomplete = () => { database.close(); resolve(request.result); };
      tx.onabort = () => reject(tx.error);
    };
  }), { store, action, value });
}

for (const config of configs.filter(c => !selected || c.name === selected)) {
  const { name, engine, ...options } = config;
  const browser = await engine.launch({ headless: true, downloadsPath: out });
  const ctx = await browser.newContext({ ...options, locale: 'ru-RU', serviceWorkers: 'block' });
  const users = [`connection-a-${name}-${Date.now()}`, `connection-b-${name}-${Date.now()}`];
  let page;
  const faults = { offline: false, me: 0, words: 0, detail: 0, delayMe: 0 };
  const dataRequests = [];
  const authRequests = [];
  const errors = [];
  const networkErrors = [];
  try {
    await ctx.addInitScript(() => {
      localStorage.setItem('lexa.locale', 'ru');
      const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine').get;
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => localStorage.getItem('test.offline') === '1' ? false : online.call(navigator) });
    });
    const ids = [];
    for (const [i, user] of users.entries()) {
      assert.equal((await ctx.request.post(api + '/auth/dev', { data: { telegramId: user } })).status(), 200);
      ids.push(db(`const u = await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4}}); const w = await db.word.create({data:{userId:u.id,word:${JSON.stringify(i ? '乙' : '甲')},sourceLang:'zh',targetLang:'ru',phonetic:'jiǎ',meaningZh:${JSON.stringify(i ? 'второй аккаунт' : 'первый аккаунт')},partOfSpeech:'сущ.',examples:{create:{sentenceEn:'这是甲。',sentenceZh:'Это первый.',sourceName:'Manual',sourceUrl:''}}}}); console.log(w.id);`));
    }
    await ctx.request.post(api + '/auth/dev', { data: { telegramId: users[0] } });
    page = await ctx.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', e => {
      // WebKit reports deliberately aborted local resource loads as pageerror.
      if (/localhost:(3000|3001).*due to access control checks\.$/.test(e.message)) networkErrors.push(e.message);
      else errors.push(e.message);
    });
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const me = url.pathname === '/api/auth/me';
      const list = url.pathname === '/api/words';
      const detail = url.pathname === '/api/words/' + ids[0];
      if (!url.pathname.startsWith('/api/auth/')) dataRequests.push({ path: url.pathname, method: route.request().method() });
      else authRequests.push(url.pathname);
      if (faults.offline) return route.abort('internetdisconnected');
      if (me && faults.delayMe) await new Promise(r => setTimeout(r, faults.delayMe));
      const status = me ? faults.me : list ? faults.words : detail ? faults.detail : 0;
      if (status) return route.fulfill({ status, json: { error: 'Local fault', ...(status === 403 ? { code: 'invite_required' } : {}) } });
      await route.continue().catch(() => {});
    });
    const wordLink = () => page.locator(`a[href="/word/${ids[0]}"]`).first();
    const retry = () => page.getByTestId('connection-status').getByRole('button', { name: 'Повторить' });
    async function navigate(url) {
      try { await page.goto(url, { waitUntil: 'domcontentloaded' }); }
      catch (error) {
        if (!/NS_BINDING_ABORTED|ERR_ABORTED|interrupted by another navigation/.test(error.message)) throw error;
        await page.waitForTimeout(200);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      }
    }
    async function toggleOffline(value) {
      faults.offline = value;
      await page.evaluate(v => {
        if (v) localStorage.setItem('test.offline', '1'); else localStorage.removeItem('test.offline');
        window.dispatchEvent(new Event(v ? 'offline' : 'online'));
      }, value);
    }
    async function warm() {
      await navigate(app + '/words');
      await wordLink().waitFor();
      await page.waitForFunction(() => !!localStorage.getItem('lexa.accountSnapshot'));
      await wordLink().click();
      await page.waitForURL(app + '/word/' + ids[0]);
      await page.getByRole('heading', { name: '甲', exact: true }).waitFor();
      await page.getByText('这是甲。', { exact: true }).first().waitFor();
      await page.waitForFunction(() => new Promise(resolve => {
        const open = indexedDB.open('lexa', 1);
        open.onsuccess = () => {
          const db = open.result; const tx = db.transaction('kv', 'readonly');
          const keys = tx.objectStore('kv').getAllKeys();
          tx.oncomplete = () => { db.close(); resolve(keys.result.some(k => String(k).startsWith('word:'))); };
        };
      }));
    }
    await warm();
    // Real browser offline while the loaded app stays usable.
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.getByTestId('connection-status').waitFor();
    assert.equal(await page.getByRole('heading', { name: '甲', exact: true }).count(), 1);
    await ctx.setOffline(false);
    await toggleOffline(true);
    // App assets remain reachable: exercise offline API reload and direct URL recovery.
    await navigate(page.url());
    await page.getByRole('heading', { name: '甲', exact: true }).waitFor();
    await page.getByText('这是甲。', { exact: true }).first().waitFor();
    await navigate(app + '/words');
    await wordLink().waitFor();
    assert.match(await page.getByTestId('connection-status').innerText(), /Нет сети/);
    assert(!await page.getByText('Начать учиться', { exact: true }).count());
    await page.screenshot({ path: path.join(out, name + '-offline.png'), fullPage: true });
    console.log(name + ': browser offline, cached reload/list/direct detail');

    // Review still grades offline and persists an owner-scoped queue across reload.
    await navigate(app + '/review');
    await page.getByRole('button', { name: /Начать —/ }).click();
    await page.getByRole('button', { name: /Хорошо/ }).click();
    await page.waitForFunction(() => new Promise(resolve => {
      const open = indexedDB.open('lexa', 1);
      open.onsuccess = () => { const db = open.result; const tx = db.transaction('outbox'); const req = tx.objectStore('outbox').getAll(); tx.oncomplete = () => { db.close(); resolve(req.result.length > 0); }; };
    }));
    const queued = await stored(page, 'outbox', 'all');
    assert.equal(queued[0].accountId, users[0]);
    await navigate(page.url());
    assert.equal((await stored(page, 'outbox', 'all')).length, 1);
    await toggleOffline(false);
    await page.waitForResponse(r => r.url().includes('/review') && r.request().method() === 'POST');
    await page.waitForFunction(() => new Promise(resolve => {
      const open = indexedDB.open('lexa', 1);
      open.onsuccess = () => { const db = open.result; const tx = db.transaction('outbox'); const req = tx.objectStore('outbox').count(); tx.oncomplete = () => { db.close(); resolve(req.result === 0); }; };
    }));
    console.log(name + ': offline review, persisted queue and reconnect flush');

    await navigate(app + '/words');
    await wordLink().waitFor();
    faults.me = 503;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await retry().waitFor();
    await retry().click();
    await wordLink().waitFor();
    faults.words = 503;
    await navigate(page.url());
    await wordLink().waitFor();
    const beforeUnverified = dataRequests.length;
    await page.waitForTimeout(500);
    assert.equal(dataRequests.length, beforeUnverified, 'snapshot must not send data requests before verification');
    faults.me = 0;
    await retry().click();
    await page.waitForResponse(r => new URL(r.url()).pathname === '/api/words' && r.status() === 503);
    await wordLink().waitFor();
    faults.words = 0;
    db(`await db.word.update({where:{id:${JSON.stringify(ids[0])}},data:{meaningZh:'обновлено после подключения'}});`);
    await retry().click();
    await page.getByText('обновлено после подключения', { exact: true }).filter({ visible: true }).first().waitFor();
    console.log(name + ': /me and list 5xx preserve content; reconnect updates without blanking');

    faults.delayMe = 12_000;
    await navigate(page.url());
    await wordLink().waitFor();
    await page.waitForTimeout(10_500);
    await wordLink().waitFor();
    await retry().waitFor();
    faults.delayMe = 0;
    await retry().click();
    await page.getByTestId('connection-status').waitFor({ state: 'hidden' });
    console.log(name + ': slow /me times out with readable content and retry');

    // Migrate a legacy queue only while the previous prefs marker still matches.
    await stored(page, 'outbox', 'add', { kind: 'review', wordId: ids[0], grade: 3, source: 'review', at: Date.now() });
    const migrated = page.waitForResponse(r => r.url().includes('/review') && r.request().method() === 'POST');
    await navigate(page.url());
    await migrated;
    await wordLink().waitFor();
    await page.evaluate(id => localStorage.setItem('lexa.prefsAccount', id), users[1]);
    await stored(page, 'outbox', 'add', { kind: 'learn', word: '不应发送', grade: 3, source: 'review', at: Date.now() });
    await navigate(page.url());
    await wordLink().waitFor();
    await page.getByTestId('connection-status').waitFor({ state: 'hidden' });
    assert.equal((await stored(page, 'outbox', 'all')).length, 0);
    console.log(name + ': legacy queue migrates only with matching previous owner');

    // A different cookie account must not reuse A's queries or persisted queue.
    await stored(page, 'outbox', 'add', { accountId: users[0], kind: 'learn', word: '不应发送', grade: 3, source: 'review', at: Date.now() });
    await ctx.request.post(api + '/auth/dev', { data: { telegramId: users[1] } });
    faults.delayMe = 600;
    await navigate(page.url());
    await page.getByText('второй аккаунт', { exact: true }).filter({ visible: true }).first().waitFor();
    assert.equal(await wordLink().count(), 0);
    assert.equal((await stored(page, 'outbox', 'all')).length, 0);
    const cached = await stored(page, 'kv', 'all');
    assert(!cached.some(x => Array.isArray(x) && x.some(w => w.id === ids[0])));
    faults.delayMe = 0;
    assert(!dataRequests.some(r => r.path.endsWith('/learn') && r.method === 'POST'));
    console.log(name + ': account switch clears A cache/queue without sending it as B');

    await navigate(app + '/account');
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await page.waitForFunction(() => !localStorage.getItem('lexa.accountSnapshot'));
    assert.equal((await stored(page, 'kv', 'all')).length, 0);
    assert.equal((await ctx.request.get(api + '/auth/me')).status(), 401);
    console.log(name + ': logout clears session and persisted snapshots');

    // Fresh load with no snapshot: failures offer retry, confirmed 401 signs out.
    faults.me = 500;
    await navigate(page.url());
    await page.getByText(/Не удалось проверить аккаунт/).waitFor();
    await page.getByRole('button', { name: 'Повторить', exact: true }).waitFor();
    await page.evaluate(() => { window.Telegram = { WebApp: { initData: 'test-must-not-login' } }; });
    const meFailure = page.waitForResponse(r => r.url().endsWith('/auth/me') && r.status() === 500);
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await meFailure;
    assert(!authRequests.includes('/api/auth/telegram/webapp'), '5xx must not attempt Telegram login');
    await page.evaluate(() => { delete window.Telegram; });
    faults.me = 0;
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await page.getByText(/Не удалось проверить аккаунт/).waitFor({ state: 'hidden' });

    faults.delayMe = 12_000;
    await navigate(page.url());
    await page.getByText(/Не удалось проверить аккаунт/).waitFor({ timeout: 15_000 });
    faults.delayMe = 0;
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await page.getByText(/Не удалось проверить аккаунт/).waitFor({ state: 'hidden' });

    // A successful /me can also confirm that the invite was revoked.
    await ctx.request.post(api + '/auth/dev', { data: { telegramId: users[0] } });
    await warm();
    db(`await db.user.update({where:{telegramId:${JSON.stringify(users[0])}},data:{invited:false}});`);
    assert.equal((await ctx.request.get(api + '/words')).status(), 403, 'server invite gate remains authoritative');
    await navigate(page.url());
    await page.waitForFunction(() => !localStorage.getItem('lexa.accountSnapshot'));
    await page.getByRole('heading', { name: '甲', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await stored(page, 'kv', 'all')).length, 0);
    db(`await db.user.update({where:{telegramId:${JSON.stringify(users[0])}},data:{invited:true}});`);

    // Confirmed access failures never fall back to saved data.
    for (const status of [401, 403]) {
      await ctx.request.post(api + '/auth/dev', { data: { telegramId: users[0] } });
      await warm();
      faults.me = status;
      await navigate(page.url());
      await page.waitForFunction(() => !localStorage.getItem('lexa.accountSnapshot'));
      await page.getByRole('heading', { name: '甲', exact: true }).waitFor({ state: 'hidden' });
      assert.equal((await stored(page, 'kv', 'all')).length, 0);
      faults.me = 0;
    }
    await ctx.request.post(api + '/auth/dev', { data: { telegramId: users[0] } });
    await warm();
    faults.detail = 404;
    await navigate(page.url());
    await page.getByText('Слово не найдено.', { exact: true }).waitFor();
    faults.detail = 0;
    await navigate(page.url());
    await page.getByRole('heading', { name: '甲', exact: true }).waitFor();

    await navigate(app + '/account');
    await toggleOffline(true);
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await page.getByText(/Не удалось проверить аккаунт/).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('lexa.accountSnapshot')), null);
    await navigate(page.url());
    await page.getByText(/Не удалось проверить аккаунт/).waitFor();
    const logoutResponse = page.waitForResponse(r => r.url().endsWith('/auth/logout') && r.ok());
    await toggleOffline(false);
    await logoutResponse;
    await page.waitForFunction(() => !localStorage.getItem('lexa.logoutPending'));
    await page.getByText(/Не удалось проверить аккаунт/).waitFor({ state: 'hidden' });
    assert.equal((await ctx.request.get(api + '/auth/me')).status(), 401);
    console.log(name + ': offline logout survives reload and clears server cookie on reconnect');

    await ctx.request.post(api + '/auth/dev', { data: { telegramId: users[0] } });
    await warm();
    faults.words = 403;
    await navigate(app + '/words');
    await page.waitForFunction(() => !localStorage.getItem('lexa.accountSnapshot'));
    await wordLink().waitFor({ state: 'hidden' });
    assert.equal((await stored(page, 'kv', 'all')).length, 0);
    faults.words = 0;
    const empty = `connection-empty-${name}-${Date.now()}`;
    users.push(empty);
    await ctx.request.post(api + '/auth/dev', { data: { telegramId: empty } });
    db(`await db.user.update({where:{telegramId:${JSON.stringify(empty)}},data:{invited:true,hskTarget:null}});`);
    const emptyMe = await (await ctx.request.get(api + '/auth/me')).json();
    assert.equal(emptyMe.hasWords, false);
    await navigate(app + '/words');
    await page.getByRole('heading', { name: 'Как хорошо ты знаешь китайский?', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    if (networkErrors.length) console.log(name + ': expected offline WebKit resource failures: ' + networkErrors.length);
    console.log(name + ': no-snapshot retry; /me 401/403 and data invite revocation clear cache; no page errors');
  } catch (error) {
    if (page) {
      if (await page.locator('aside').count()) await page.screenshot({ path: path.join(out, name + '-failure.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(out, name + '-failure.txt'), await page.locator('body').innerText().catch(() => ''));
    }
    throw error;
  } finally {
    await ctx.close(); await browser.close();
    db(`const {deleteAccount} = await import('./dist/services/accountData.js'); for(const id of ${JSON.stringify(users)}) await deleteAccount(id);`);
  }
}
