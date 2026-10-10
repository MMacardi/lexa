// Stroke order for the word page's Characters block (learning audit 8e), from the
// file the draw pad already uses: Make Me a Hanzi's stroke medians for ~6,800
// characters (public/handwriting/hanzi-v1.bin, packed by
// scripts/build-handwriting.mjs; Arphic Public License). A median is the pen's
// path down the middle of a stroke; the strokes come in writing order, on a 256
// grid with y pointing down. Fetched once (the service worker keeps it), so this
// works offline and adds no dependency (BACKLOG "Later" had Hanzi Writer).
//
// Per character the file holds: codepoint u16 LE, rank u8, stroke count u8, then
// per stroke a point count u8 and that many (x, y) byte pairs.

export type Stroke = [number, number][];

type Index = { bytes: Uint8Array; at: Map<string, number> };
let loading: Promise<Index> | null = null;

function indexOf(buf: ArrayBuffer): Index {
  const bytes = new Uint8Array(buf);
  const at = new Map<string, number>();
  for (let i = 0; i < bytes.length; ) {
    at.set(String.fromCharCode(bytes[i] | (bytes[i + 1] << 8)), i);
    const n = bytes[i + 3];
    i += 4;
    for (let s = 0; s < n; s++) i += 1 + bytes[i] * 2;
  }
  return { bytes, at };
}

function load(): Promise<Index> {
  loading ??= fetch("/handwriting/hanzi-v1.bin")
    .then((r) => {
      if (!r.ok) throw new Error(`stroke data: ${r.status}`);
      return r.arrayBuffer();
    })
    .then(indexOf)
    .catch((e) => {
      loading = null; // let the next look retry
      throw e;
    });
  return loading;
}

/** A character's strokes in writing order, or null when the file doesn't have it. */
export async function strokesFor(ch: string): Promise<Stroke[] | null> {
  const { bytes, at } = await load();
  let i = at.get(ch);
  if (i == null) return null;
  const n = bytes[i + 3];
  i += 4;
  const strokes: Stroke[] = [];
  for (let s = 0; s < n; s++) {
    const len = bytes[i++];
    const st: Stroke = [];
    for (let p = 0; p < len; p++, i += 2) st.push([bytes[i], bytes[i + 1]]);
    strokes.push(st);
  }
  return strokes;
}
