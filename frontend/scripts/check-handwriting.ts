// Regression guard for the draw pad's recogniser (lib/handwriting.ts).
//
// Feeds it every HSK 1–4 character drawn from the *full-resolution* Make Me a
// Hanzi medians (the shipped templates are thinned), after the damage a finger
// does: a skewed, rescaled box, shaky points, strokes that start late and end
// long, and — separately — strokes out of order, one stroke missing, and only
// the left half of a left–right character (the completion Pleco offers). The
// "messy" cases move, turn and resize every stroke on its own, the way a real
// finger does (the tidy cases alone passed while a phone's 我 missing its 提
// didn't make the top 16), and a few drawings traced from a phone are replayed
// as they were. Fails if top-1 / top-16 (what the pad shows) fall under the floors below.
//
// Run: npx tsx scripts/check-handwriting.ts path/to/graphics.txt path/to/dictionary.txt

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTemplates, recognize, type Point } from "../lib/handwriting";

const [graphicsPath, dictionaryPath] = process.argv.slice(2);
if (!dictionaryPath) throw new Error("usage: npx tsx scripts/check-handwriting.ts graphics.txt dictionary.txt");
const SHOWN = 16;

const bin = readFileSync(join(__dirname, "..", "public", "handwriting", "hanzi-v1.bin"));
let t0 = performance.now();
const t = parseTemplates(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
console.log(`parsed ${t.chars.length} templates in ${(performance.now() - t0).toFixed(0)} ms`);

const medians = new Map<string, number[][][]>();
for (const line of readFileSync(graphicsPath, "utf8").trim().split("\n")) {
  const o = JSON.parse(line);
  medians.set(o.character, o.medians);
}
// Which component each stroke belongs to, for characters split left | right.
const leftRight = new Map<string, number[][]>();
for (const line of readFileSync(dictionaryPath, "utf8").trim().split("\n")) {
  const o = JSON.parse(line);
  if (o.decomposition?.startsWith("⿰") && o.matches?.every((m: number[] | null) => m)) leftRight.set(o.character, o.matches);
}

// Deterministic noise so runs compare.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

// A 300 px canvas, y down, with the character's box skewed and shifted. `mess`
// also moves, turns and resizes each stroke about its own middle.
function draw(strokes: number[][][], mess = false): Point[][] {
  const sx = 0.28 * (1 + 0.15 * rnd());
  const sy = 0.28 * (1 + 0.15 * rnd());
  const shear = 0.12 * rnd();
  const rot = 0.08 * rnd();
  const [dx, dy] = [10 * rnd(), 10 * rnd()];
  return strokes.map((s) => {
    const [ox, oy] = mess ? [22 * rnd(), 22 * rnd()] : [8 * rnd(), 8 * rnd()]; // each stroke a little off
    const [turn, grow] = mess ? [0.2 * rnd(), 1 + 0.25 * rnd()] : [0, 1];
    const [mx, my] = [s.reduce((a, p) => a + p[0], 0) / s.length, s.reduce((a, p) => a + p[1], 0) / s.length];
    const pts = s.map(([x0, y0]) => {
      const [ex, ey] = [(x0 - mx) * grow, (y0 - my) * grow];
      const [x, y] = [mx + ex * Math.cos(turn) - ey * Math.sin(turn), my + ex * Math.sin(turn) + ey * Math.cos(turn)];
      const [u, v] = [x * sx, (900 - y) * sy];
      return [u * Math.cos(rot) - v * Math.sin(rot) + shear * v + dx + ox, u * Math.sin(rot) + v * Math.cos(rot) + dy + oy] as Point;
    });
    // A finger samples densely and shakily: 20 points per segment plus jitter.
    const dense: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) {
        dense.push(pts[0]);
        continue;
      }
      for (let k = 1; k <= 20; k++) {
        const f = k / 20;
        dense.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f + 1.5 * rnd(), pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f + 1.5 * rnd()]);
      }
    }
    // Start late / end long by up to 15 %.
    const cut = Math.floor(dense.length * 0.1 * Math.abs(rnd()));
    const out = dense.slice(cut);
    if (out.length > 1) {
      const [a, b] = [out[out.length - 2], out[out.length - 1]];
      const ext = 1 + 3 * Math.abs(rnd());
      out.push([b[0] + (b[0] - a[0]) * ext, b[1] + (b[1] - a[1]) * ext]);
    }
    return out;
  });
}

const hsk = readFileSync(join(__dirname, "..", "..", "backend", "src", "data", "hskWords.ts"), "utf8");
const chars = new Set<string>();
for (const line of hsk.split("\n")) {
  const [word, , tags] = line.split("\t");
  if (tags && /\bn[1-4]\b/.test(tags)) for (const ch of word.replace(/^.*`/, "")) if (medians.has(ch) && /\p{Script=Han}/u.test(ch)) chars.add(ch);
}

type Case = { name: string; floor1: number; floorShown: number; mess?: boolean; make: (m: number[][][], ch: string) => number[][][] | null };
const missing = (m: number[][][]) => {
  if (m.length < 4) return null;
  const c = [...m];
  c.splice(Math.floor(Math.abs(rnd()) * c.length), 1);
  return c;
};
const cases: Case[] = [
  { name: "sloppy", floor1: 0.9, floorShown: 0.98, make: (m) => m },
  { name: "messy", floor1: 0.9, floorShown: 0.98, mess: true, make: (m) => m },
  {
    name: "two strokes swapped",
    floor1: 0.85,
    floorShown: 0.97,
    make: (m) => {
      if (m.length < 3) return null;
      const i = Math.floor(Math.abs(rnd()) * (m.length - 1));
      const c = [...m];
      [c[i], c[i + 1]] = [c[i + 1], c[i]];
      return c;
    },
  },
  { name: "one stroke missing", floor1: 0.8, floorShown: 0.97, make: missing },
  { name: "messy, one missing", floor1: 0.7, floorShown: 0.95, mess: true, make: missing },
  {
    // Only the left component, drawn where it sits: 女 on the left → 好.
    // Top-1 means nothing here (女 alone is also a character).
    name: "left part only",
    floor1: 0,
    floorShown: 0.5,
    make: (m, ch) => {
      const parts = leftRight.get(ch);
      if (!parts || parts.length !== m.length) return null;
      const left = m.filter((_, i) => parts[i][0] === 0);
      return left.length && left.length < m.length ? left : null;
    },
  },
];

let failed = false;
for (const c of cases) {
  let [n, top1, shown, ms] = [0, 0, 0, 0];
  const misses: string[] = [];
  for (const ch of chars) {
    const m = c.make(medians.get(ch)!, ch);
    if (!m) continue;
    const input = draw(m, c.mess);
    t0 = performance.now();
    const got = recognize(t, input, { box: 300, limit: SHOWN });
    ms += performance.now() - t0;
    n++;
    if (got[0] === ch) top1++;
    else if (misses.length < 12) misses.push(`${ch}→${got.slice(0, 3).join("")}`);
    if (got.includes(ch)) shown++;
  }
  const [r1, rs] = [top1 / n, shown / n];
  const ok = r1 >= c.floor1 && rs >= c.floorShown;
  failed ||= !ok;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${c.name.padEnd(20)} n=${n} top1=${(r1 * 100).toFixed(1)}% top${SHOWN}=${(rs * 100).toFixed(1)}% ` +
      `${(ms / n).toFixed(1)} ms/char  misses: ${misses.join(" ")}`,
  );
}
// Drawings traced from a phone's pad (screenshots, 2026-09-25), in pad pixels:
// the character, the pad's side, the strokes, and how high it must rank.
const densify = (s: number[][]): Point[] =>
  s.flatMap((p, i) => (i ? Array.from({ length: 10 }, (_, k) => [s[i - 1][0] + ((p[0] - s[i - 1][0]) * (k + 1)) / 10, s[i - 1][1] + ((p[1] - s[i - 1][1]) * (k + 1)) / 10] as Point) : [p as Point]));
const traced: [string, string, number, number[][][], number][] = [
  // 我 with its 提 forgotten, the 斜钩 drawn nearly upright: Pleco puts 我 first.
  ["我 without 提", "我", 680, [
    [[197,120],[200,140],[175,190],[135,250],[85,305],[47,330]],
    [[47,400],[185,395],[335,390],[540,385]],
    [[180,290],[177,415],[183,565],[193,665],[125,610],[60,555]],
    [[360,245],[353,365],[340,515],[345,610],[375,625],[405,595],[417,545]],
    [[290,525],[395,500]],
    [[435,260],[465,300],[480,350]],
  ], 3],
  ["我 without 提 (2)", "我", 924, [
    [[300,360],[295,420],[260,490],[210,575]],
    [[140,685],[260,688],[430,665],[595,640]],
    [[275,505],[300,640],[325,780],[330,1040],[300,1065],[265,1060],[155,955]],
    [[435,535],[440,680],[435,930],[445,1060],[470,1105],[495,1100],[525,1010],[525,905]],
    [[390,935],[485,920]],
    [[575,515],[615,560],[620,650]],
  ], 3],
];
for (const [name, ch, box, strokes, within] of traced) {
  const got = recognize(t, strokes.map(densify), { box, limit: SHOWN });
  const at = got.indexOf(ch) + 1;
  const ok = at > 0 && at <= within;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} traced: ${name.padEnd(24)} ${ch} at ${at || "-"} (needs ≤ ${within})  ${got.slice(0, 8).join("")}`);
}
process.exit(failed ? 1 : 0);
