// Runs the draw pad's recogniser (lib/handwriting.ts) off the main thread. The
// templates are parsed here once, and each finished stroke costs 10–60 ms of
// matching that would otherwise hold up the next stroke's ink on a slow phone.
//
// In:  "load" to warm up, or { id, strokes, box } for a drawing.
// Out: { ready: true } | { error } after "load"; { id, chars } per drawing.

import { loadTemplates, recognize, type Point } from "./handwriting";

const ctx = self as unknown as Worker;

ctx.onmessage = async (e: MessageEvent<"load" | { id: number; strokes: Point[][]; box: number }>) => {
  try {
    const t = await loadTemplates();
    if (e.data === "load") ctx.postMessage({ ready: true });
    else ctx.postMessage({ id: e.data.id, chars: recognize(t, e.data.strokes, { box: e.data.box, limit: 16 }) });
  } catch (err) {
    ctx.postMessage({ error: String(err) });
  }
};
