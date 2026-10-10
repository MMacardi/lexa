// Is the stroke the learner just drew the one the character wants next? The
// writing trainer's test (components/WriteChar.tsx), Hanzi Writer's stroke
// matcher ported to the stroke file's 256 grid (lib/strokes.ts, y down): the
// drawn line has to lie along the stroke's median, start and end near its ends,
// run the same way, have its shape, and not be too short. A drawing that fits a
// later stroke better is that later stroke, drawn out of order; one that fits
// only when reversed was drawn the wrong way. Hanzi Writer's thresholds are on
// a 1024 grid, so the distances here are a quarter of theirs. The medians in the
// file are thinned, so distance is measured to the median's segments, not to
// its points.

import type { Stroke } from "@/lib/strokes";

export type Pt = [number, number];
export type Verdict = "ok" | "miss" | "backwards" | "order";

const AVG_DIST = 87.5; // mean distance from the drawn points to the median
const END_DIST = 62.5; // drawn start / end to the stroke's start / end
const FRECHET = 0.4; // shape, after both are centred and scaled
const MIN_LEN = 0.35; // drawn length over the stroke's
const ROTATIONS = [Math.PI / 16, Math.PI / 32, 0, -Math.PI / 32, -Math.PI / 16];
const SAMPLES = 24;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lengthOf = (s: Pt[]) => s.reduce((n, p, i) => (i ? n + dist(s[i - 1], p) : 0), 0);

function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function toLine(p: Pt, s: Pt[]): number {
  if (s.length === 1) return dist(p, s[0]);
  let d = Infinity;
  for (let i = 1; i < s.length; i++) d = Math.min(d, toSegment(p, s[i - 1], s[i]));
  return d;
}

const avgDist = (drawn: Pt[], s: Pt[]) => drawn.reduce((n, p) => n + toLine(p, s), 0) / drawn.length;

/** `n` points evenly spaced along the line. */
function resample(s: Pt[], n: number): Pt[] {
  const total = lengthOf(s);
  if (!total) return Array.from({ length: n }, () => s[0]);
  const out: Pt[] = [s[0]];
  const step = total / (n - 1);
  let want = step;
  let walked = 0;
  for (let i = 1; i < s.length && out.length < n - 1; i++) {
    const seg = dist(s[i - 1], s[i]);
    while (seg && walked + seg >= want && out.length < n - 1) {
      const t = (want - walked) / seg;
      out.push([s[i - 1][0] + t * (s[i][0] - s[i - 1][0]), s[i - 1][1] + t * (s[i][1] - s[i - 1][1])]);
      want += step;
    }
    walked += seg;
  }
  while (out.length < n) out.push(s[s.length - 1]);
  return out;
}

// Centred on its mean, scaled so its ends sit about 1 from the centre.
function normalize(s: Pt[]): Pt[] {
  const r = resample(s, SAMPLES);
  const mx = r.reduce((n, p) => n + p[0], 0) / r.length;
  const my = r.reduce((n, p) => n + p[1], 0) / r.length;
  const c = r.map(([x, y]) => [x - mx, y - my] as Pt);
  const a = c[0];
  const b = c[c.length - 1];
  const scale = Math.sqrt((a[0] ** 2 + a[1] ** 2 + b[0] ** 2 + b[1] ** 2) / 2) || 1;
  return c.map(([x, y]) => [x / scale, y / scale]);
}

// Discrete Fréchet distance: the leash a walker on each line needs, neither
// walking backwards.
function frechet(p: Pt[], q: Pt[]): number {
  let prev: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const cur: number[] = [];
    for (let j = 0; j < q.length; j++) {
      const d = dist(p[i], q[j]);
      if (!i && !j) cur.push(d);
      else cur.push(Math.max(Math.min(i ? prev[j] : Infinity, j ? cur[j - 1] : Infinity, i && j ? prev[j - 1] : Infinity), d));
    }
    prev = cur;
  }
  return prev[q.length - 1];
}

const rotate = (s: Pt[], a: number): Pt[] =>
  s.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);

function shapeFits(drawn: Pt[], s: Pt[], leniency: number): boolean {
  const a = normalize(drawn);
  const b = normalize(s);
  return Math.min(...ROTATIONS.map((r) => frechet(a, rotate(b, r)))) <= FRECHET * leniency;
}

// On average each drawn segment points the way some part of the stroke does.
function directionFits(drawn: Pt[], s: Pt[]): boolean {
  const vec = (l: Pt[]) => l.slice(1).map((p, i) => [p[0] - l[i][0], p[1] - l[i][1]] as Pt).filter(([x, y]) => x || y);
  const sv = vec(s);
  const dv = vec(resample(drawn, 12));
  if (!sv.length || !dv.length) return true;
  const cos = (a: Pt, b: Pt) => (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));
  const mean = dv.reduce((n, v) => n + Math.max(...sv.map((w) => cos(v, w))), 0) / dv.length;
  return mean > 0;
}

type Fit = { ok: boolean; backwards: boolean; avg: number };

function fit(drawn: Pt[], s: Stroke, o: { leniency: number; near: boolean; backwards: boolean }): Fit {
  const avg = avgDist(drawn, s);
  // Once a stroke is down (or the outline shows) the place is known: tighter.
  if (avg > AVG_DIST * (o.near ? 0.5 : 1) * o.leniency) return { ok: false, backwards: false, avg };
  const ok =
    dist(drawn[0], s[0]) <= END_DIST * o.leniency &&
    dist(drawn[drawn.length - 1], s[s.length - 1]) <= END_DIST * o.leniency &&
    directionFits(drawn, s) &&
    shapeFits(drawn, s, o.leniency) &&
    (o.leniency * (lengthOf(drawn) + 6)) / (lengthOf(s) + 6) >= MIN_LEN;
  if (!ok && o.backwards && fit([...drawn].reverse(), s, { ...o, backwards: false }).ok) return { ok: false, backwards: true, avg };
  return { ok, backwards: false, avg };
}

/**
 * Judge a drawn line (256-grid points, in drawing order) as stroke `next` of
 * `strokes`. `outline`: the character's outline is on screen.
 */
export function judgeStroke(drawn: Pt[], strokes: Stroke[], next: number, outline: boolean, leniency = 1): Verdict {
  const pts = drawn.filter((p, i) => !i || dist(p, drawn[i - 1]) >= 1);
  if (pts.length < 2) return "miss";
  const near = outline || next > 0;
  const want = fit(pts, strokes[next], { leniency, near, backwards: true });
  const later = strokes.slice(next + 1).map((s) => fit(pts, s, { leniency, near, backwards: false }));
  if (!want.ok) {
    if (want.backwards) return "backwards";
    return later.some((f) => f.ok) ? "order" : "miss";
  }
  // A later stroke fits better: ask the wanted one to fit more tightly, the
  // tighter the better the other fits (Hanzi Writer's 0.3–0.6).
  const best = Math.min(...later.filter((f) => f.ok).map((f) => f.avg), want.avg);
  if (best < want.avg) {
    const tight = (0.6 * (best + want.avg)) / (2 * want.avg);
    return fit(pts, strokes[next], { leniency: leniency * tight, near, backwards: false }).ok ? "ok" : "order";
  }
  return "ok";
}
