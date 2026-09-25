// Offline recognition of one hand-drawn hanzi — the engine behind the draw pad
// (components/HandwritingPad.tsx), Pleco's "write it with your finger" input.
//
// Runs entirely on the device: no request per stroke, and nothing that breaks
// behind the Great Firewall (Google's handwriting endpoint would). Templates are
// the stroke medians of ~6800 characters from Make Me a Hanzi, packed by
// scripts/build-handwriting.mjs and fetched once, the first time a pad opens.
//
// Two ways a template can match, and it keeps the better:
// - Whole character. The drawing and the template are each centred on their ink
//   and scaled by its spread, so size and placement on the pad don't matter.
// - Completion (Pleco's "write the left part, get the whole one"). The drawing
//   stays where it is on the pad, which stands for the character's em box, and
//   only has to cover *some* of the template's strokes — a 女 on the left half
//   brings up 好, 妈, 她. The template's undrawn strokes cost a little each, so
//   the nearer to finished, the higher it ranks.
// Either way a character's cost is the cheapest one-to-one pairing of drawn
// strokes with its strokes (Hungarian method), each stroke resampled to N points.
// Pairing, not order, so 口 written in the wrong order is still 口; order only
// breaks ties, as does how common the character is.

export type Point = [number, number];

const N = 8; // points per resampled stroke
const EXTRA = 0.9; // a drawn stroke the character doesn't have
// A stroke of the character that wasn't drawn costs less the shorter it is: a
// forgotten dot or 提 is the commonest slip there is (a 我 without its 提 used to
// fall out of the list behind six-stroke characters that paid nothing), while a
// long stroke left out more often means another character.
const MISSING = [0.3, 0.9] as const; // cheapest, dearest
const MISSING_BASE = 0.25;
const MISSING_PER_LENGTH = 0.2; // per unit of stroke length on the ink scale
const REVERSED = 0.35; // extra cost of a stroke drawn from the wrong end
const ORDER = 0.03; // per pair of strokes written in the wrong order
const RARITY = 0.025; // per rank step (HSK 1 … GB2312 level 2)
const UNDRAWN = 0.05; // completion: per template stroke not drawn yet
const COMPLETION = 0.3; // completion: flat cost, so a whole match wins a tie
const RARITY_COMPLETION = 0.1; // completion: per rank step — half a character is
// ambiguous by design, so how common the whole one is has to count for more

export type Templates = {
  chars: string[];
  ranks: Uint8Array;
  counts: Uint8Array; // strokes per character
  offsets: Uint32Array; // index of each character's first point in `pts`
  pts: Float32Array; // x, y pairs, N per stroke, ink-normalized
  frames: Float32Array; // per character: ink centre x, y and scale on the 256 grid
  mids: Float32Array; // x, y per stroke: the mean of its N points
  missing: Float32Array; // per stroke: its cost when it isn't drawn
  byCount: number[][]; // character indexes by stroke count
  unit: number; // a typical ink scale, to put box distances on the ink scale
};

// Centre on the ink's centroid and scale by its RMS radius, both weighted by
// segment length so dense pointer samples and sparse template medians agree.
// Returns the frame it used.
function normalize(strokes: Point[][], out: Float32Array, at: number): [number, number, number] {
  let w = 0;
  let cx = 0;
  let cy = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.length; i++) {
      const l = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      w += l;
      cx += l * (s[i][0] + s[i - 1][0]) / 2;
      cy += l * (s[i][1] + s[i - 1][1]) / 2;
    }
  }
  if (w === 0) {
    // Only taps: fall back to the plain mean.
    let n = 0;
    for (const s of strokes) for (const p of s) [cx, cy, n] = [cx + p[0], cy + p[1], n + 1];
    [cx, cy, w] = [cx / n, cy / n, 1];
  } else {
    cx /= w;
    cy /= w;
  }
  let v = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.length; i++) {
      const l = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      const mx = (s[i][0] + s[i - 1][0]) / 2 - cx;
      const my = (s[i][1] + s[i - 1][1]) / 2 - cy;
      v += l * (mx * mx + my * my);
    }
  }
  const scale = Math.sqrt(v / w) || 1;
  for (const s of strokes) {
    resample(s, out, at, cx, cy, scale);
    at += N * 2;
  }
  return [cx, cy, scale];
}

// N points evenly spaced along the stroke's length, as (p - c) / scale.
function resample(s: Point[], out: Float32Array, at: number, cx: number, cy: number, scale: number) {
  let total = 0;
  for (let i = 1; i < s.length; i++) total += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  let seg = 1;
  let walked = 0;
  for (let k = 0; k < N; k++) {
    const target = (total * k) / (N - 1);
    while (seg < s.length - 1 && walked + Math.hypot(s[seg][0] - s[seg - 1][0], s[seg][1] - s[seg - 1][1]) < target) {
      walked += Math.hypot(s[seg][0] - s[seg - 1][0], s[seg][1] - s[seg - 1][1]);
      seg++;
    }
    let x = s[0][0];
    let y = s[0][1];
    if (s.length > 1) {
      const [a, b] = [s[seg - 1], s[seg]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = l ? Math.min(1, Math.max(0, (target - walked) / l)) : 0;
      x = a[0] + (b[0] - a[0]) * t;
      y = a[1] + (b[1] - a[1]) * t;
    }
    out[at + k * 2] = (x - cx) / scale;
    out[at + k * 2 + 1] = (y - cy) / scale;
  }
}

export function parseTemplates(buf: ArrayBuffer): Templates {
  const b = new Uint8Array(buf);
  const chars: string[] = [];
  const ranks: number[] = [];
  const counts: number[] = [];
  const offsets: number[] = [];
  const all: Point[][][] = [];
  let points = 0;
  for (let i = 0; i < b.length; ) {
    chars.push(String.fromCharCode(b[i] | (b[i + 1] << 8)));
    ranks.push(b[i + 2]);
    const n = b[i + 3];
    i += 4;
    const strokes: Point[][] = [];
    for (let s = 0; s < n; s++) {
      const len = b[i++];
      const st: Point[] = [];
      for (let p = 0; p < len; p++, i += 2) st.push([b[i], b[i + 1]]);
      strokes.push(st);
    }
    counts.push(n);
    offsets.push(points);
    points += n * N * 2;
    all.push(strokes);
  }
  const pts = new Float32Array(points);
  const frames = new Float32Array(all.length * 3);
  const byCount: number[][] = [];
  all.forEach((strokes, c) => {
    frames.set(normalize(strokes, pts, offsets[c]), c * 3);
    (byCount[counts[c]] ??= []).push(c);
  });
  const mids = centroids(pts);
  const missing = new Float32Array(pts.length / N / 2);
  for (let s = 0; s < missing.length; s++) {
    let len = 0;
    for (let k = 1; k < N; k++) len += Math.hypot(pts[s * N * 2 + k * 2] - pts[s * N * 2 + k * 2 - 2], pts[s * N * 2 + k * 2 + 1] - pts[s * N * 2 + k * 2 - 1]);
    missing[s] = Math.min(MISSING[1], Math.max(MISSING[0], MISSING_BASE + MISSING_PER_LENGTH * len));
  }
  const scales = Array.from({ length: all.length }, (_, c) => frames[c * 3 + 2]).sort((x, y) => x - y);
  return {
    chars,
    ranks: Uint8Array.from(ranks),
    counts: Uint8Array.from(counts),
    offsets: Uint32Array.from(offsets),
    pts,
    frames,
    mids,
    missing,
    byCount,
    unit: scales[scales.length >> 1],
  };
}

// Each stroke's centroid. A stroke's cost is never below the distance between
// its centroid and its partner's (from either end), which makes a bound that
// throws most characters out before the full N-point comparison.
function centroids(pts: Float32Array): Float32Array {
  const out = new Float32Array(pts.length / N);
  for (let s = 0; s < out.length / 2; s++) {
    let [x, y] = [0, 0];
    for (let k = 0; k < N; k++) [x, y] = [x + pts[s * N * 2 + k * 2], y + pts[s * N * 2 + k * 2 + 1]];
    [out[s * 2], out[s * 2 + 1]] = [x / N, y / N];
  }
  return out;
}

// Lower bound on a pairing's cost from centroids: each drawn stroke pays at least
// the distance to its nearest template stroke (or EXTRA, when `both` allows it a
// dummy partner); with `both`, each template stroke also pays toward the drawn
// ones (or its `missing` cost), and the larger of the two sums holds.
function bound(a: Float32Array, n: number, b: Float32Array, s0: number, m: number, sc: number, dx: number, dy: number, div: number, both: boolean, missing?: Float32Array): number {
  const k = Math.max(n, m);
  let rows = both ? (k - n) * MISSING[0] : 0;
  for (let i = 0; i < n; i++) {
    let low = both && m < k ? EXTRA : Infinity;
    for (let j = 0; j < m; j++) {
      const ex = a[i * 2] - (b[(s0 + j) * 2] * sc + dx);
      const ey = a[i * 2 + 1] - (b[(s0 + j) * 2 + 1] * sc + dy);
      const d = Math.sqrt(ex * ex + ey * ey) / div;
      if (d < low) low = d;
    }
    rows += low;
  }
  if (!both) return rows;
  let cols = (k - m) * EXTRA;
  for (let j = 0; j < m; j++) {
    let low = n < k ? missing![s0 + j] : Infinity;
    for (let i = 0; i < n; i++) {
      const ex = a[i * 2] - (b[(s0 + j) * 2] * sc + dx);
      const ey = a[i * 2 + 1] - (b[(s0 + j) * 2 + 1] * sc + dy);
      const d = Math.sqrt(ex * ex + ey * ey) / div;
      if (d < low) low = d;
    }
    cols += low;
  }
  return Math.max(rows, cols);
}

let loading: Promise<Templates> | null = null;

export function loadTemplates(): Promise<Templates> {
  loading ??= fetch("/handwriting/hanzi-v1.bin")
    .then((r) => {
      if (!r.ok) throw new Error(`handwriting data: ${r.status}`);
      return r.arrayBuffer();
    })
    .then(parseTemplates)
    .catch((e) => {
      loading = null; // let the next open retry
      throw e;
    });
  return loading;
}

// Scratch space for the assignment, grown to the largest size seen.
let cost = new Float64Array(0);
let u = new Float64Array(0);
let v = new Float64Array(0);
let minv = new Float64Array(0);
let p = new Int32Array(0);
let way = new Int32Array(0);
let used = new Uint8Array(0);

// Minimum-cost matching of every row to a distinct column, rows ≤ cols, on the
// row-major `cost` (stride cols). Leaves p[col] = row (1-based, 0 = unused).
function assign(rows: number, cols: number): number {
  if (v.length < cols + 1) {
    [u, v, minv] = [new Float64Array(cols + 1), new Float64Array(cols + 1), new Float64Array(cols + 1)];
    [p, way, used] = [new Int32Array(cols + 1), new Int32Array(cols + 1), new Uint8Array(cols + 1)];
  }
  u.fill(0, 0, rows + 1);
  v.fill(0, 0, cols + 1);
  p.fill(0, 0, cols + 1);
  for (let i = 1; i <= rows; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity, 0, cols + 1);
    used.fill(0, 0, cols + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= cols; j++) {
        if (used[j]) continue;
        const cur = cost[(i0 - 1) * cols + (j - 1)] - u[i0] - v[j];
        if (cur < minv[j]) [minv[j], way[j]] = [cur, j0];
        if (minv[j] < delta) [delta, j1] = [minv[j], j];
      }
      for (let j = 0; j <= cols; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  let total = 0;
  for (let j = 1; j <= cols; j++) if (p[j]) total += cost[(p[j] - 1) * cols + (j - 1)];
  return total;
}

// Mean point distance between drawn stroke `a` and template stroke `b`, trying
// both ends of `b`. The template stroke is mapped through (scale, dx, dy) first,
// which puts it on the pad for completions; `div` brings the result back to ink
// units. (Math.sqrt, not Math.hypot: this is the hot loop and hypot is slower.)
function strokeCost(a: Float32Array, ai: number, b: Float32Array, bi: number, sc: number, dx: number, dy: number, div: number): number {
  let fwd = 0;
  let rev = 0;
  for (let k = 0; k < N; k++) {
    const ax = a[ai + k * 2];
    const ay = a[ai + k * 2 + 1];
    let ex = ax - (b[bi + k * 2] * sc + dx);
    let ey = ay - (b[bi + k * 2 + 1] * sc + dy);
    fwd += Math.sqrt(ex * ex + ey * ey);
    ex = ax - (b[bi + (N - 1 - k) * 2] * sc + dx);
    ey = ay - (b[bi + (N - 1 - k) * 2 + 1] * sc + dy);
    rev += Math.sqrt(ex * ex + ey * ey);
  }
  return Math.min(fwd / div, rev / div + REVERSED * N) / N;
}

// Pairs of drawn strokes whose partners (among the first `cols` template
// strokes, so not the padding) come in the opposite order.
function inversions(n: number, cols: number): number {
  let count = 0;
  const partner: number[] = [];
  for (let j = 1; j <= cols; j++) if (p[j] && p[j] <= n) partner[p[j]] = j;
  for (let i = 1; i <= n; i++) {
    if (!partner[i]) continue;
    for (let i2 = i + 1; i2 <= n; i2++) if (partner[i2] && partner[i] > partner[i2]) count++;
  }
  return count;
}

// Best candidates for the drawing, most likely first. `strokes` are in pad
// coordinates, y pointing down; `box` is the pad's side in the same units and
// turns on completions (without it, only whole characters match).
export function recognize(t: Templates, strokes: Point[][], opts: { box?: number; limit?: number } = {}): string[] {
  return rank(t, strokes, opts).map(([ch]) => ch);
}

// recognize() with each candidate's cost, for tuning.
export function rank(t: Templates, strokes: Point[][], opts: { box?: number; limit?: number } = {}): [string, number][] {
  const n = strokes.length;
  if (!n) return [];
  const limit = opts.limit ?? 10;
  const ink = new Float32Array(n * N * 2);
  normalize(strokes, ink, 0);
  // The pad as the template's 256-unit em box.
  const onPad = new Float32Array(n * N * 2);
  if (opts.box) strokes.forEach((s, i) => resample(s, onPad, i * N * 2, 0, 0, opts.box! / 256));
  const [inkMid, padMid] = [centroids(ink), centroids(onPad)];

  // Best `limit` so far, ascending; anything that can't beat the last is skipped.
  const best: [number, number][] = [];
  const bar = () => (best.length < limit ? Infinity : best[best.length - 1][0]);
  const keep = (score: number, c: number) => {
    if (score >= bar()) return;
    let at = best.length;
    while (at > 0 && best[at - 1][0] > score) at--;
    best.splice(at, 0, [score, c]);
    if (best.length > limit) best.pop();
  };

  // Whole characters, closest stroke counts first so the bar drops fast.
  const slack = 2 + (n >> 2);
  for (let d = 0; d <= slack; d++) {
    for (const m of d ? [n - d, n + d] : [n]) {
      for (const c of t.byCount[m] ?? []) {
        const k = Math.max(n, m);
        if (cost.length < k * k) cost = new Float64Array(k * k);
        const off = t.offsets[c];
        const extra = RARITY * t.ranks[c];
        if (bound(inkMid, n, t.mids, off / N / 2, m, 1, 0, 0, 1, true, t.missing) + extra >= bar()) continue;
        let rowMin = 0;
        for (let i = 0; i < k; i++) {
          let low = Infinity;
          for (let j = 0; j < k; j++) {
            // Past the drawn strokes: a template stroke left undrawn; past the
            // template's: a drawn stroke too many.
            const x = i < n && j < m ? strokeCost(ink, i * N * 2, t.pts, off + j * N * 2, 1, 0, 0, 1) : j < m ? t.missing[off / N / 2 + j] : EXTRA;
            cost[i * k + j] = x;
            if (x < low) low = x;
          }
          rowMin += low;
        }
        if (rowMin + extra >= bar()) continue; // can't place, however it pairs
        keep(assign(k, k) + ORDER * inversions(n, m) + extra, c);
      }
    }
  }

  // Completions: characters with more strokes than drawn, matched on the pad.
  if (opts.box) {
    for (let m = n + 1; m < t.byCount.length; m++) {
      const undrawn = COMPLETION + UNDRAWN * (m - n);
      if (undrawn >= bar()) break; // only gets dearer from here
      for (const c of t.byCount[m] ?? []) {
        if (cost.length < n * m) cost = new Float64Array(n * m);
        const off = t.offsets[c];
        const [cx, cy, sc] = [t.frames[c * 3], t.frames[c * 3 + 1], t.frames[c * 3 + 2]];
        const extra = undrawn + RARITY_COMPLETION * t.ranks[c];
        if (bound(padMid, n, t.mids, off / N / 2, m, sc, cx, cy, t.unit, false) + extra >= bar()) continue;
        let rowMin = 0;
        for (let i = 0; i < n; i++) {
          let low = Infinity;
          for (let j = 0; j < m; j++) {
            const x = strokeCost(onPad, i * N * 2, t.pts, off + j * N * 2, sc, cx, cy, t.unit);
            cost[i * m + j] = x;
            if (x < low) low = x;
          }
          rowMin += low;
          if (rowMin + extra >= bar()) break;
        }
        if (rowMin + extra >= bar()) continue;
        const score = assign(n, m) + ORDER * inversions(n, m) + extra;
        // A character already in as a whole match keeps its better score.
        const had = best.findIndex(([, b]) => b === c);
        if (had >= 0) {
          if (best[had][0] <= score) continue;
          best.splice(had, 1);
        }
        keep(score, c);
      }
    }
  }
  return best.map(([score, c]) => [t.chars[c], score]);
}
