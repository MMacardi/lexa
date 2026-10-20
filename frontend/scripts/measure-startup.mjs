// Local Docker only. Same API delay and browser cache conditions before/after.
// The label names the current source version; run once before edits and once after.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const out = path.join(root, '.playwright-cli', 'connection');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli', 'browsers');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
const { chromium } = await import('../node_modules/playwright-core/index.mjs');
const label = process.argv[2] || 'after';
const user = `startup-${Date.now()}`;
function db(code) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
    cwd: root, input: `import { PrismaClient } from '@prisma/client'; const db = new PrismaClient({errorFormat:'minimal'}); try { ${code}; } catch(e) { console.error(e.message); process.exitCode=1; } finally { await db.$disconnect(); }`, encoding: 'utf8',
  });
}
const browser = await chromium.launch({ headless: true, downloadsPath: out });
const results = [];
try {
  for (const delay of [0, 1500]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
    await ctx.addInitScript(() => localStorage.setItem('lexa.locale', 'ru'));
    assert.equal((await ctx.request.post('http://localhost:3000/api/auth/dev', { data: { telegramId: user } })).status(), 200);
    db(`const u = await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,hskTarget:null,nativeLang:'ru'}}); if (!await db.word.count({where:{userId:u.id}})) await db.word.create({data:{userId:u.id,word:'启动测试',sourceLang:'zh',targetLang:'ru',meaningZh:'проверка запуска'}})`);
    const page = await ctx.newPage();
    await page.route('**/api/**', async route => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      await route.continue();
    });
    for (const visit of ['cold', 'warm']) {
      const started = Date.now();
      const requests = [];
      const onRequest = r => { if (r.url().includes('/api/')) requests.push({ path: new URL(r.url()).pathname, start: Date.now() - started }); };
      const onResponse = r => { const entry = requests.find(x => x.path === new URL(r.url()).pathname && !x.end); if (entry) entry.end = Date.now() - started; };
      page.on('request', onRequest); page.on('response', onResponse);
      await page.goto('http://localhost:3001/words', { waitUntil: 'domcontentloaded' });
      await page.locator('aside').waitFor({ timeout: 90_000 });
      const shell = Date.now() - started;
      await page.getByRole('link', { name: /启动测试/ }).first().waitFor();
      const content = Date.now() - started;
      await page.waitForTimeout(delay + 300);
      page.off('request', onRequest); page.off('response', onResponse);
      results.push({ delay, visit, shell, content, requests });
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, `startup-${label}.json`), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  db(`const {deleteAccount} = await import('./dist/services/accountData.js'); await deleteAccount(${JSON.stringify(user)})`);
}
