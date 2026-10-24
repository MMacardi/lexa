// Local Today -> Mika check: compare background geometry through the entire
// entrance/exit, including a forced root pan that overflow:hidden cannot block.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, '.playwright-cli/mika-background');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.playwright-cli/browsers');
const { webkit, devices } = await import('../node_modules/playwright-core/index.mjs');
const baseline = process.argv.includes('--baseline');
const db = code => execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'node', '--input-type=module'], {
  cwd: root, encoding: 'utf8', input: `import {prisma as db} from './dist/services/db.js';try{${code}}finally{await db.$disconnect()}`,
}).trim();
const user = `mika-background-${Date.now()}`;
const browser = await webkit.launch({ headless: true, downloadsPath: out });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', serviceWorkers: 'block' });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
page.setDefaultTimeout(20000);
const input = page.locator('.vv-overlay textarea');
const open = () => page.getByRole('button', { name: 'Открыть Мику', exact: true }).filter({ visible: true }).click();
const close = () => page.getByRole('button', { name: 'Отмена', exact: true }).filter({ visible: true }).click();
async function sample(label, origin) {
  const frames = await page.evaluate(async () => {
    const frames = [];
    for (let i = 0; i < 28; i++) {
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      frames.push({ y: scrollY, heading: document.querySelector('main h1').getBoundingClientRect().top,
        header: document.querySelector('header').getBoundingClientRect().top });
    }
    return frames;
  });
  if (!baseline) for (const f of frames) {
    assert(Math.abs(f.heading - origin.heading) < 2, `${label}: background moved ${JSON.stringify(f)} from ${JSON.stringify(origin)}`);
    assert(Math.abs(f.header - origin.header) < 2, `${label}: sticky header moved ${JSON.stringify(f)} from ${JSON.stringify(origin)}`);
  }
  return { label, frames };
}
try {
  await ctx.addInitScript(() => localStorage.setItem('lexa.locale', 'ru'));
  assert.equal((await ctx.request.post('http://localhost:3000/api/auth/dev', { data: { telegramId: user } })).status(), 200);
  db(`const u=await db.user.update({where:{telegramId:${JSON.stringify(user)}},data:{invited:true,nativeLang:'ru',hskTarget:4}});
    await db.word.createMany({data:['方向','桥','距离','地址','对面','东','当地','参观','长城','风景','导游','专业','教授','毕业','受到'].map(word=>({userId:u.id,word,sourceLang:'zh',targetLang:'ru',meaningZh:'слово',autoExamples:false,exampleStatus:'disabled'}))});`);
  await page.goto('http://localhost:3001', { waitUntil: 'domcontentloaded' });
  await page.locator('main h1').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const results = [];
  for (const position of [0, 280]) {
    await page.evaluate(async y => {
      scrollTo(0, y);
      // Sticky positioning settles in WebKit's rendering step after scrolling.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
    }, position);
    const origin = await page.evaluate(() => ({ y: scrollY,
      heading: document.querySelector('main h1').getBoundingClientRect().top,
      header: document.querySelector('header').getBoundingClientRect().top }));
    assert(Math.abs(origin.y - position) < 2, 'Today has enough scroll range');
    await open();
    results.push(await sample(`open at ${position}`, origin));
    assert.equal(await page.locator('textarea:focus').count(), 0, 'opening does not summon keyboard');
    // Reproduce document movement independently of desktop WebKit's mobile UI.
    await page.evaluate(() => scrollTo(0, 520));
    results.push(await sample(`root pan at ${position}`, origin));
    await page.screenshot({ path: path.join(out, `${baseline ? 'before' : 'after'}-${position}.png`) });
    await close();
    results.push(await sample(`close at ${position}`, origin));
    await input.waitFor({ state: 'hidden' });
    assert(Math.abs(await page.evaluate(() => scrollY) - origin.y) < 2, 'close restores original page offset');
  }
  fs.writeFileSync(path.join(out, baseline ? 'before.json' : 'after.json'), JSON.stringify(results, null, 2));
  assert.deepEqual(errors, []);
  console.log(baseline ? 'Baseline recorded: root pan moves Today behind Mika.' : 'WebKit phone: Today background and sticky header hold through open, forced pan and close at top and mid-page.');
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await ctx.close();
  await browser.close();
  db(`const {deleteAccount}=await import('./dist/services/accountData.js');await deleteAccount(${JSON.stringify(user)});`);
}
