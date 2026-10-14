// Every page on five phones: iPhone 13 and SE (WebKit = Safari), Pixel 7 and a 360 px
// Galaxy (Chrome), Firefox at 390. Flags what a learner on a phone hits: the page
// scrolling sideways, an element past the screen edge, tap targets under 28 px, inputs
// under 16 px (iOS Safari zooms the page on focus), controls left under the bottom bar
// at the end of the page, console errors. Screenshots per page (full-page on iPhone 13).
//
// Local Docker only (it signs in with /api/auth/dev). Needs the Playwright CLI installed
// globally (npm i -g @playwright/cli) and its browsers (… playwright-core/cli.js install
// webkit firefox; Chrome is the installed one). From the repo root:
//   node frontend/scripts/phone-audit.mjs <outDir> [config]
// config is one of the CONFIGS names below (iphoneSE-webkit, android360-chrome, …).
// First run 2026-10-14: 125 page loads, /account scrolled 71 px sideways on the SE.
import { createRequire } from "module";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
const root = execSync("npm root -g").toString().trim();
const require = createRequire(path.join(root, "@playwright/cli/node_modules/playwright-core/package.json"));
const { chromium, webkit, firefox, devices } = require("playwright-core");

const OUT = process.argv[2] || "audit";
const ONLY = process.argv[3];
const APP = "http://localhost:3001";
const API = "http://localhost:3000";
const USER = process.env.AUDIT_USER || "ux-learner";
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  "/", "/words", "/review", "/reader", "/mika", "/hsk/3.0/4", "/hsk/3.0/4/check", "/hsk/3.0/4/sweep",
  "/word/<first>", "/collections", "/quiz", "/write", "/coach", "/coach/chat",
  "/coach/practice", "/coach/scene", "/account", "/profile", "/friends", "/community", "/pro",
];
const GUEST_PAGES = ["/", "/login", "/privacy", "/terms"];

const CONFIGS = [
  { name: "iphone13-webkit", type: webkit, opts: { ...devices["iPhone 13"] } },
  { name: "iphoneSE-webkit", type: webkit, opts: { ...devices["iPhone SE"] } },
  { name: "pixel7-chrome", type: chromium, launch: { channel: "chrome" }, opts: { ...devices["Pixel 7"] } },
  { name: "android360-chrome", type: chromium, launch: { channel: "chrome" }, opts: { ...devices["Galaxy S8"] } },
  { name: "firefox-390", type: firefox, opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true } },
].filter((c) => !ONLY || c.name === ONLY);

function measure() {
  const W = innerWidth, H = innerHeight;
  const sel = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 4).join(".") : "";
    const txt = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls === "." ? "" : cls} «${txt}»`;
  };
  const visible = (el, r) => {
    if (r.width <= 1 || r.height <= 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  // An ancestor that clips sideways and itself sits on screen hides the overflow.
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const pc = getComputedStyle(p);
      if (/(hidden|auto|scroll|clip)/.test(pc.overflowX)) {
        const pr = p.getBoundingClientRect();
        if (pr.right <= W + 1 && pr.left >= -1) return true;
      }
    }
    return false;
  };
  const overflowX = document.documentElement.scrollWidth - W;
  const bodyOverflowX = document.body.scrollWidth - W;
  const offs = [];
  const all = [...document.querySelectorAll("body *")];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    if ((r.right > W + 1 || r.left < -1) && !clipped(el)) {
      const parentOff = el.parentElement && (() => { const pr = el.parentElement.getBoundingClientRect(); return pr.right > W + 1 || pr.left < -1; })();
      if (!parentOff) offs.push(`${sel(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
  }
  const IA = 'a[href], button, [role="button"], input:not([type="hidden"]), select, textarea, [role="tab"], [role="switch"], [role="checkbox"], summary';
  const small = [];
  for (const el of document.querySelectorAll(IA)) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    if (el.closest("[aria-hidden='true']")) continue;
    if (Math.min(r.width, r.height) < 28) small.push(`${sel(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const zoomInputs = [];
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select")) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) zoomInputs.push(`${sel(el)} ${fs}px`);
  }
  let tinyText = 0;
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const tinySamples = [];
  while (tw.nextNode()) {
    const n = tw.currentNode;
    if (!n.textContent.trim() || !n.parentElement) continue;
    const r = n.parentElement.getBoundingClientRect();
    if (!visible(n.parentElement, r)) continue;
    const f = parseFloat(getComputedStyle(n.parentElement).fontSize);
    if (f < 11) { tinyText++; if (tinySamples.length < 4) tinySamples.push(`${f}px «${n.textContent.trim().slice(0, 30)}»`); }
  }
  // Fixed bars at the bottom, and controls they cover once the page is scrolled to the end.
  const bars = [...document.querySelectorAll("body *")].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") return false;
    const r = el.getBoundingClientRect();
    return visible(el, r) && r.bottom >= H - 2 && r.height < H * 0.4 && r.width > W * 0.6;
  });
  return { W, H, overflowX, bodyOverflowX, offs: offs.slice(0, 12), offCount: offs.length, small: small.slice(0, 25), smallCount: small.length, zoomInputs, tinyText, tinySamples, bars: bars.map((b) => { const r = b.getBoundingClientRect(); return { top: r.top, sel: sel(b).slice(0, 60) }; }), title: document.title, h1: (document.querySelector("h1")?.innerText || "").slice(0, 60) };
}

function covered() {
  const H = innerHeight, W = innerWidth;
  const bars = [...document.querySelectorAll("body *")].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed") return false;
    const r = el.getBoundingClientRect();
    return r.width > W * 0.6 && r.bottom >= H - 2 && r.height < H * 0.4 && r.height > 0 && cs.display !== "none";
  });
  const out = [];
  for (const bar of bars) {
    const br = bar.getBoundingClientRect();
    for (const el of document.querySelectorAll('a[href], button, input, textarea, [role="button"]')) {
      if (bar.contains(el) || el.contains(bar)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || el.closest("[style*='position: fixed']")) continue;
      if (r.bottom > br.top + 4 && r.top < br.bottom) {
        const top = document.elementFromPoint(Math.min(W - 1, Math.max(0, r.left + r.width / 2)), Math.min(H - 1, r.top + r.height / 2));
        if (top && !el.contains(top) && bar.contains(top)) out.push(`${el.tagName.toLowerCase()} «${(el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 30)}» under ${bar.tagName.toLowerCase()}`);
      }
    }
  }
  return out.slice(0, 8);
}

const slug = (p) => (p === "/" ? "home" : p.replace(/^\//, "").replace(/[\/\[\]\.]/g, "_").slice(0, 40));

async function auditPages(ctx, pages, cfg, tag, results) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`); });
  for (const p of pages) {
    errors.length = 0;
    const t0 = Date.now();
    try {
      await page.goto(APP + p, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
      const m = await page.evaluate(measure);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
      const cov = await page.evaluate(covered);
      await page.evaluate(() => window.scrollTo(0, 0));
      const shot = path.join(OUT, `${cfg.name}${tag}-${slug(p)}.jpg`);
      await page.screenshot({ path: shot, type: "jpeg", quality: 45, fullPage: cfg.name === "iphone13-webkit" });
      results.push({ cfg: cfg.name + tag, page: p, url: page.url().replace(APP, ""), ms: Date.now() - t0, ...m, covered: cov, errors: [...new Set(errors)].slice(0, 6) });
      fs.appendFileSync(path.join(OUT, "progress.jsonl"), JSON.stringify(results.at(-1)) + "\n");
    } catch (e) {
      results.push({ cfg: cfg.name + tag, page: p, fail: e.message.slice(0, 200) });
      fs.appendFileSync(path.join(OUT, "progress.jsonl"), JSON.stringify(results.at(-1)) + "\n");
    }
    process.stdout.write(`${cfg.name}${tag} ${p} ${Date.now() - t0}ms\n`);
  }
  await page.close();
}

const results = [];
for (const cfg of CONFIGS) {
  const browser = await cfg.type.launch({ headless: true, ...(cfg.launch || {}) });
  // Signed in.
  const ctx = await browser.newContext({ ...cfg.opts, locale: "ru-RU" });
  await ctx.addInitScript(() => { try { localStorage.setItem("lexa.locale", "ru"); } catch {} });
  const r = await ctx.request.post(API + "/api/auth/dev", { data: { telegramId: USER } });
  if (!r.ok()) console.log("login failed", r.status(), await r.text());
  // A word page needs a real card: the account's newest.
  const words = await (await ctx.request.get(API + `/api/words?telegramId=${USER}`)).json().catch(() => []);
  const pages = PAGES.map((p) => (p === "/word/<first>" ? (words[0] ? `/word/${words[0].id}` : null) : p)).filter(Boolean);
  await auditPages(ctx, pages, cfg, "", results);
  await ctx.close();
  // Signed out.
  const g = await browser.newContext({ ...cfg.opts, locale: "ru-RU" });
  await auditPages(g, GUEST_PAGES, cfg, "-guest", results);
  await g.close();
  await browser.close();
  console.log(" " + cfg.name);
}
fs.writeFileSync(path.join(OUT, `results${ONLY ? "-" + ONLY : ""}.json`), JSON.stringify(results, null, 1));
console.log("done", results.length);
