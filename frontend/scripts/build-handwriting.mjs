// Regenerates public/handwriting/hanzi-v1.bin — the stroke templates behind the
// draw-a-character pad (lib/handwriting.ts).
//
// Source: Make Me a Hanzi graphics.txt (github.com/skishore/makemeahanzi). We take
// only each stroke's *median* — the pen path down its middle, which is what a
// finger draws — never the outlines. That data is under the Arphic Public
// License, reproduced next to the output as ARPHICPL.txt.
//
// Characters: all of GB2312 (6763, the simplified set a learner meets in print)
// plus any HSK 3.0 character outside it. Each carries a rank the recogniser uses
// to break near-ties toward common characters: its lowest HSK 3.0 level (1–7),
// else 8 for GB2312 level 1 and 9 for level 2.
//
// Format, all bytes: per character — codepoint u16 LE, rank u8, stroke count u8,
// then per stroke a point count u8 and that many (x, y) pairs on a 0–255 grid,
// y pointing down. Medians are thinned with Douglas–Peucker first; the
// recogniser resamples them anyway.
//
// Run: node scripts/build-handwriting.mjs [path/to/graphics.txt]
// (downloads graphics.txt when no path is given; ~30 MB)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "public", "handwriting");
const SRC = "https://raw.githubusercontent.com/skishore/makemeahanzi/master/graphics.txt";
const LICENSE = "https://raw.githubusercontent.com/skishore/makemeahanzi/master/APL/english/ARPHICPL.TXT";

const graphics = process.argv[2]
  ? readFileSync(process.argv[2], "utf8")
  : await (await fetch(SRC)).text();

// GB2312 level 1 is rows 0xB0–0xD7, level 2 is 0xD8–0xF7.
const gbRank = new Map();
const gbk = new TextDecoder("gbk");
for (let hi = 0xb0; hi <= 0xf7; hi++) {
  for (let lo = 0xa1; lo <= 0xfe; lo++) {
    const ch = gbk.decode(new Uint8Array([hi, lo]));
    if (ch.length === 1 && ch !== "�") gbRank.set(ch, hi <= 0xd7 ? 8 : 9);
  }
}

// Lowest HSK 3.0 level each character appears at, from the backend's word list.
const hskRank = new Map();
const hskSrc = readFileSync(join(HERE, "..", "..", "backend", "src", "data", "hskWords.ts"), "utf8");
for (const line of hskSrc.split("\n")) {
  const [word, , tags] = line.split("\t");
  if (!tags) continue;
  const levels = tags.split(",").filter((t) => t.startsWith("n")).map((t) => Number(t.slice(1)));
  if (!levels.length) continue;
  const level = Math.min(...levels);
  for (const ch of word.replace(/^.*`/, "")) {
    if (/\p{Script=Han}/u.test(ch)) hskRank.set(ch, Math.min(hskRank.get(ch) ?? 9, level));
  }
}

// Douglas–Peucker on the 1024-unit Make Me a Hanzi grid.
function simplify(pts, tol = 12) {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let far = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > far) [far, idx] = [d, i];
  }
  if (far <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

// Make Me a Hanzi draws on a 1024 box with y up and the baseline at 900.
const q = (v) => Math.max(0, Math.min(255, Math.round(v / 4)));

const bytes = [];
let chars = 0;
for (const line of graphics.trim().split("\n")) {
  const { character: ch, medians } = JSON.parse(line);
  const rank = hskRank.get(ch) ?? gbRank.get(ch);
  if (!rank || ch.length !== 1 || medians.length > 255) continue;
  const cp = ch.codePointAt(0);
  if (cp > 0xffff) continue;
  bytes.push(cp & 0xff, cp >> 8, rank, medians.length);
  for (const m of medians) {
    const pts = simplify(m);
    bytes.push(pts.length);
    for (const [x, y] of pts) bytes.push(q(x), q(900 - y));
  }
  chars++;
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "hanzi-v1.bin"), Buffer.from(bytes));
const lic = await fetch(LICENSE);
if (lic.ok) writeFileSync(join(OUT_DIR, "ARPHICPL.txt"), await lic.text());
console.log(`${chars} characters, ${(bytes.length / 1024).toFixed(0)} KB${lic.ok ? "" : " (licence not fetched)"}`);
