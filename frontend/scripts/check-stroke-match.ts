// Regression guard for the writing trainer's stroke test (lib/strokeMatch.ts).
//
// For every character in the stroke file, each stroke is drawn the way a finger
// draws it — moved, resized, turned a little, shaky, starting late and running
// long — and must pass as that stroke, in both trainer modes (outline shown or
// not). The same drawing reversed must not pass (and should be called
// backwards); the next stroke drawn in this one's place must not pass (it's out
// of order). A stroke from elsewhere in another character must not pass either.
// Fails if any rate falls under the floors below.
//
// Run: npx tsx scripts/check-stroke-match.ts  (about two minutes: ~6,800 characters)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { judgeStroke, type Pt } from "../lib/strokeMatch";

const bytes = new Uint8Array(readFileSync(join(__dirname, "..", "public", "handwriting", "hanzi-v1.bin")));
const chars: { ch: string; strokes: Pt[][] }[] = [];
for (let i = 0; i < bytes.length; ) {
  const ch = String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  const n = bytes[i + 3];
  i += 4;
  const strokes: Pt[][] = [];
  for (let s = 0; s < n; s++) {
    const len = bytes[i++];
    const st: Pt[] = [];
    for (let p = 0; p < len; p++, i += 2) st.push([bytes[i], bytes[i + 1]]);
    strokes.push(st);
  }
  chars.push({ ch, strokes });
}

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const between = (a: number, b: number) => a + (b - a) * rnd();

// A median as a finger would draw it: dense points, the whole stroke shifted,
// scaled and turned about its middle, ends a little short or long, a shaky hand.
function drawn(s: Pt[]): Pt[] {
  const dense: Pt[] = [];
  for (let i = 1; i < s.length; i++) {
    const [a, b] = [s[i - 1], s[i]];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
    for (let k = 0; k < n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  dense.push(s[s.length - 1]);
  if (dense.length === 1) dense.push([dense[0][0] + 2, dense[0][1] + 2]);
  const head = Math.floor(dense.length * between(0, 0.08));
  const tail = dense.length - Math.floor(dense.length * between(0, 0.05));
  const pts = dense.slice(head, Math.max(head + 2, tail));
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const over = between(0, 6);
  const d = Math.hypot(last[0] - prev[0], last[1] - prev[1]) || 1;
  pts.push([last[0] + ((last[0] - prev[0]) / d) * over, last[1] + ((last[1] - prev[1]) / d) * over]);
  const cx = pts.reduce((n, p) => n + p[0], 0) / pts.length;
  const cy = pts.reduce((n, p) => n + p[1], 0) / pts.length;
  const k = between(0.85, 1.15);
  const r = between(-0.1, 0.1);
  const dx = between(-10, 10);
  const dy = between(-10, 10);
  return pts.map(([x, y]) => {
    const [ux, uy] = [(x - cx) * k, (y - cy) * k];
    return [
      cx + ux * Math.cos(r) - uy * Math.sin(r) + dx + between(-2, 2),
      cy + ux * Math.sin(r) + uy * Math.cos(r) + dy + between(-2, 2),
    ] as Pt;
  });
}

const tally = { right: [0, 0], reversed: [0, 0], backwards: [0, 0], order: [0, 0], stranger: [0, 0] };
const fails: Record<string, string[]> = { right: [], reversed: [], order: [] };
const t0 = performance.now();
for (const { ch, strokes } of chars) {
  for (let i = 0; i < strokes.length; i++) {
    for (const outline of [false, true]) {
      const d = drawn(strokes[i]);
      tally.right[1]++;
      if (judgeStroke(d, strokes, i, outline) === "ok") tally.right[0]++;
      else if (fails.right.length < 12) fails.right.push(`${ch}#${i + 1}`);
      // Reversing a dot or a short tick barely changes it; long strokes only.
      const len = strokes[i].reduce((n, p, j) => (j ? n + Math.hypot(p[0] - strokes[i][j - 1][0], p[1] - strokes[i][j - 1][1]) : 0), 0);
      if (len >= 40) {
        const v = judgeStroke([...d].reverse(), strokes, i, outline);
        tally.reversed[1]++;
        if (v !== "ok") tally.reversed[0]++;
        else if (fails.reversed.length < 12) fails.reversed.push(`${ch}#${i + 1}`);
        tally.backwards[1]++;
        if (v === "backwards") tally.backwards[0]++;
      }
      if (i + 1 < strokes.length) {
        tally.order[1]++;
        if (judgeStroke(drawn(strokes[i + 1]), strokes, i, outline) !== "ok") tally.order[0]++;
        else if (fails.order.length < 12) fails.order.push(`${ch}#${i + 1}`);
      }
      // Another character's stroke that starts or ends well away from this one
      // (one that doesn't is often the same stroke: a top 横, 亻's first).
      const s = strokes[i];
      const other = chars[Math.floor(rnd() * chars.length)].strokes;
      const o = other[Math.floor(rnd() * other.length)];
      const far = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) >= 90;
      if (far(o[0], s[0]) || far(o[o.length - 1], s[s.length - 1])) {
        tally.stranger[1]++;
        if (judgeStroke(drawn(o), strokes, i, outline) !== "ok") tally.stranger[0]++;
      }
    }
  }
}
console.log(`${chars.length} characters judged in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// Same-place strokes make some out-of-order cases unanswerable (三's three
// 横 are one shape a few units apart, and a finger is shakier than that).
const FLOORS = { right: 0.99, reversed: 0.99, backwards: 0.98, order: 0.97, stranger: 0.999 };
let bad = false;
for (const [k, [hit, n]] of Object.entries(tally)) {
  const rate = hit / n;
  const floor = FLOORS[k as keyof typeof FLOORS];
  const ok = rate >= floor;
  bad ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${k.padEnd(9)} ${(rate * 100).toFixed(1)}% of ${n} (floor ${floor * 100}%)${fails[k]?.length ? `  e.g. ${fails[k].join(" ")}` : ""}`);
}
if (bad) process.exit(1);
