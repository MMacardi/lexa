// Regression guard for the draw pad's recogniser (lib/handwriting.ts).
//
// Feeds it every HSK 1–4 character drawn from the *full-resolution* Make Me a
// Hanzi medians (the shipped templates are thinned), after the damage a finger
// does: a skewed, rescaled box, shaky points, strokes that start late and end
// long, and — separately — strokes out of order, one stroke missing, and only
// the left half of a left–right character (the completion Pleco offers).
// Fails if top-1 / top-16 (what the pad shows) fall under the floors below.
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

// A 300 px canvas, y down, with the character's box skewed and shifted.
function draw(strokes: number[][][]): Point[][] {
  const sx = 0.28 * (1 + 0.15 * rnd());
  const sy = 0.28 * (1 + 0.15 * rnd());
  const shear = 0.12 * rnd();
  const rot = 0.08 * rnd();
  const [dx, dy] = [10 * rnd(), 10 * rnd()];
  return strokes.map((s) => {
    const [ox, oy] = [8 * rnd(), 8 * rnd()]; // each stroke a little off
    const pts = s.map(([x, y]) => {
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

type Case = { name: string; floor1: number; floorShown: number; make: (m: number[][][], ch: string) => number[][][] | null };
const cases: Case[] = [
  { name: "sloppy", floor1: 0.9, floorShown: 0.98, make: (m) => m },
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
  {
    name: "one stroke missing",
    floor1: 0.4,
    floorShown: 0.75,
    make: (m) => {
      if (m.length < 4) return null;
      const c = [...m];
      c.splice(Math.floor(Math.abs(rnd()) * c.length), 1);
      return c;
    },
  },
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
    const input = draw(m);
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
process.exit(failed ? 1 : 0);
