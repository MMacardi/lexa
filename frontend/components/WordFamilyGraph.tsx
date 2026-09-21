"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { useToast } from "@/lib/toast";
import { RotateCcw, X } from "lucide-react";
import { useDialog } from "@/lib/dialog";
import { useEnsureLevel } from "@/lib/useEnsureLevel";
import { isAiSupported } from "@/lib/langs";
import { getExampleSource, getExampleStyle, getLevel, getGraphAddMethod, setGraphAddMethod, type GraphAddMethod } from "@/lib/learnPrefs";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/motion";

type Kind = "center" | "syn" | "ant";
interface SimNode {
  id: string;
  label: string;
  kind: Kind;
  saved: boolean;
  pinned: boolean;
  side: 1 | -1; // which column it lives in (synonyms right, antonyms left)
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number; // measured pill size — the layout separates boxes, not points, so
  h: number; // long multi-word terms can't slide under each other
  hx: number; // home slot: where the node rests and springs back to
  hy: number;
  placed: boolean; // seeded near the centre once its real slot was known
  held: boolean; // dropped by the learner: its home is that spot, not a slot
  ox: number; // …kept as an offset from the word, so a resize carries it along
  oy: number;
}

const targetFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" ? "font-zh" : "");

// Strip at the canvas foot the add-buttons own. The family is centred on the
// whole canvas and the same margin is kept above it, so it sits in the middle
// instead of 20px high, and the canvas grows before it could reach the buttons.
const BOTTOM_BAND = 40;
// Under this width a column · centre · column row can't hold a multi-word term
// without truncating it, so the family stacks vertically instead.
const NARROW = 560;
// The spring every free node rides home on: stiffness (rad/s) and a damping ratio
// just under critical, so a node eases in over ~0.4s with no visible wobble.
const OMEGA = 11;
const ZETA = 0.9;
// Physics runs in fixed steps of real time, so 60 and 120 Hz screens move alike.
const STEP = 1 / 120;
// A press has to travel this far (px) to become a drag; under it, it's a tap.
const DRAG_SLOP = 5;

// Where the learner dropped pills, per word, as offsets from the word. Kept for
// the session, so opening a related word and coming back finds the family as
// they left it.
const heldStore = new Map<string, Map<string, { dx: number; dy: number }>>();

const place = (n: SimNode) => `translate3d(${n.x}px, ${n.y}px, 0)`;

// Mind-map links: each leaves the word and reaches its pill along the axis it
// mostly travels (sideways to a column, up/down in the phone stack), bending in
// between; a pill level with the word gets a straight line.
function linkPath(c: SimNode, n: SimNode) {
  const dx = n.x - c.x;
  const dy = n.y - c.y;
  const a = (dx * dx) / (dx * dx + dy * dy || 1);
  const hx = (dx / 2) * a;
  const hy = (dy / 2) * (1 - a);
  const f = (v: number) => v.toFixed(1);
  return `M${f(c.x)},${f(c.y)} C${f(c.x + hx)},${f(c.y + hy)} ${f(n.x - hx)},${f(n.y - hy)} ${f(n.x)},${f(n.y)}`;
}

// First real layout: drop each node partway out from the centre toward its slot
// — it then springs the rest of the way. Seeding them all *on* the centre let the
// separation force lock two nodes in swapped slots, each blocking the other.
function seed(nodes: SimNode[], ready: boolean) {
  if (!ready) return;
  const c = nodes[0];
  for (const n of nodes) {
    if (n.placed) continue;
    n.placed = true;
    n.x = c.hx + (n.hx - c.hx) * 0.55;
    n.y = c.hy + (n.hy - c.hy) * 0.55;
  }
}

function clampAxis(v: number, size: number, room: number) {
  const half = size / 2 + 3;
  return Math.min(Math.max(half, v), Math.max(half, room - half));
}

function clampToBox(n: SimNode, w: number, h: number) {
  n.x = clampAxis(n.x, n.w, w);
  n.y = clampAxis(n.y, n.h, h);
}

// A live, Obsidian-style "word family": the current word sits in the middle, its
// synonyms orbit to the right and antonyms to the left, each in a fanned column
// sized from the pills' real width/height. Nodes spring toward their slot, shove
// each other aside when boxes overlap, and everything is draggable — a pill stays
// where it's dropped until Reset. No graph library; a tiny simulation on rAF.
export function WordFamilyGraph({ word }: { word: Word }) {
  const { t } = useI18n();
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const router = useRouter();
  const { show, trackImport } = useToast();
  const { prompt, choose, confirm } = useDialog();
  const ensureLevel = useEnsureLevel();
  const [pending, setPending] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // Terms added from this graph → their new card id, so a tap right after adding
  // opens the freshly-created word (and a second tap never adds a duplicate).
  const [addedIds, setAddedIds] = useState<Map<string, string>>(new Map());
  const [boxW, setBoxW] = useState(640);
  const [boxH, setBoxH] = useState(340); // the canvas grows to fit both arms
  const narrow = boxW < NARROW;

  const { data: allWords } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });

  const savedMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of allWords ?? []) {
      if (w.sourceLang === word.sourceLang && w.targetLang === word.targetLang) {
        const k = w.word.trim().toLowerCase();
        if (!m.has(k)) m.set(k, w.id);
      }
    }
    return m;
  }, [allWords, word.sourceLang, word.targetLang]);

  // Cards copied out of an Onomika Library deck carry no family (the seed decks are
  // hand-written), so the graph never appeared for them. Fill it in on the first
  // open — the server asks the model once per card and stores the answer.
  const empty = word.synonyms.length === 0 && word.antonyms.length === 0;
  const { data: filled } = useQuery({
    queryKey: ["wordFamily", word.id],
    queryFn: () => api.wordFamily(word.id),
    enabled: empty && isAiSupported(word.sourceLang),
    staleTime: Infinity,
    retry: false,
  });
  // The fill is stored on the card, so refresh the page's copy once it lands:
  // the edit form and the add/remove actions below all read from `word`.
  useEffect(() => {
    if (filled?.synonyms.length || filled?.antonyms.length) {
      qc.invalidateQueries({ queryKey: ["word", word.id] });
    }
  }, [filled, qc, word.id]);

  const related = useMemo(() => {
    const seen = new Set<string>();
    const out: { term: string; kind: "syn" | "ant" }[] = [];
    const push = (term: string, kind: "syn" | "ant") => {
      const k = term.trim().toLowerCase();
      if (k && !seen.has(k)) {
        seen.add(k);
        out.push({ term, kind });
      }
    };
    const syn = word.synonyms.length ? word.synonyms : (filled?.synonyms ?? []);
    const ant = word.antonyms.length ? word.antonyms : (filled?.antonyms ?? []);
    syn.forEach((s) => push(s, "syn"));
    ant.forEach((a) => push(a, "ant"));
    return out.slice(0, narrow ? 6 : 8); // a phone stacks them — keep it short
  }, [word.synonyms, word.antonyms, filled, narrow]);

  const add = useMutation({
    mutationFn: (term: string) =>
      api.batchAddWords({
        telegramId: accountId,
        sourceLang: word.sourceLang,
        targetLang: word.targetLang,
        words: [term],
        level: getLevel(word.sourceLang) ?? undefined,
        exampleStyle: getExampleStyle(),
        exampleSource: getExampleSource(),
        enrich: isAiSupported(word.sourceLang),
      }),
    onMutate: (term) => setPending(term.trim().toLowerCase()),
    onSettled: () => setPending(null),
    onSuccess: async (r, term) => {
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words: [term], total: r.job.total, processed: 0 });
      show({ icon: "🌱", title: t("word.addedRelated", { word: term }) });
      // Refetch the list, then resolve the new card's id so the node is instantly
      // clickable (navigates to the word) instead of re-adding it.
      await qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      const key = term.trim().toLowerCase();
      const list = qc.getQueryData<Word[]>(["words", accountId]);
      const found = list?.find(
        (w) => w.word.trim().toLowerCase() === key && w.sourceLang === word.sourceLang && w.targetLang === word.targetLang,
      );
      if (found) setAddedIds((m) => new Map(m).set(key, found.id));
    },
    onError: (e) => show({ icon: "⚠️", title: errText(e, t) }),
  });

  // Add a synonym/antonym to the word itself (grows the graph), edited right here.
  const addRelated = useMutation({
    mutationFn: ({ term, kind }: { term: string; kind: "syn" | "ant" }) =>
      api.updateWord(
        word.id,
        kind === "syn"
          ? { synonyms: [...word.synonyms, term] }
          : { antonyms: [...word.antonyms, term] },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["word", word.id] });
      qc.invalidateQueries({ queryKey: ["words"] });
    },
    onError: (e) => show({ icon: "⚠️", title: errText(e, t) }),
  });

  // Create a bare manual card (no AI) — safe for unusual/unknown terms.
  const addManual = useMutation({
    mutationFn: (term: string) =>
      api.addWordManual({ word: term, telegramId: accountId, sourceLang: word.sourceLang, targetLang: word.targetLang }),
    onMutate: (term) => setPending(term.trim().toLowerCase()),
    onSettled: () => setPending(null),
    onSuccess: (created, term) => {
      qc.invalidateQueries({ queryKey: ["words"] });
      setAddedIds((m) => new Map(m).set(term.trim().toLowerCase(), created.id));
      show({ icon: "🌱", title: t("word.addedRelated", { word: term }) });
    },
    onError: (e) => show({ icon: "⚠️", title: errText(e, t) }),
  });

  // Remove a synonym/antonym from the word (edited from the graph, with confirm).
  const removeRelated = useMutation({
    mutationFn: ({ term, kind }: { term: string; kind: "syn" | "ant" }) =>
      api.updateWord(
        word.id,
        kind === "syn"
          ? { synonyms: word.synonyms.filter((s) => s.trim().toLowerCase() !== term.trim().toLowerCase()) }
          : { antonyms: word.antonyms.filter((s) => s.trim().toLowerCase() !== term.trim().toLowerCase()) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["word", word.id] });
      qc.invalidateQueries({ queryKey: ["words"] });
    },
    onError: (e) => show({ icon: "⚠️", title: errText(e, t) }),
  });

  async function confirmRemove(node: SimNode) {
    const ok = await confirm({
      title: t("graph.removeTitle"),
      message: t("graph.removeConfirm", { word: node.label }),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (ok) removeRelated.mutate({ term: node.label, kind: node.kind === "ant" ? "ant" : "syn" });
  }

  async function promptAdd(kind: "syn" | "ant") {
    const existing = kind === "syn" ? word.synonyms : word.antonyms;
    const term = await prompt({
      title: kind === "syn" ? t("word.addSynonym") : t("word.addAntonym"),
      placeholder: t("word.relatedPlaceholder"),
    });
    const v = term?.trim();
    if (!v) return;
    if (existing.some((x) => x.trim().toLowerCase() === v.toLowerCase())) return; // no dupes
    addRelated.mutate({ term: v, kind });
  }

  // --- simulation state ---
  const wrapRef = useRef<HTMLDivElement>(null);
  const dimsRef = useRef({ w: 640, h: 340 });
  const elRefs = useRef(new Map<string, HTMLDivElement>());
  const linkRefs = useRef(new Map<string, SVGPathElement>());
  const [, setFrame] = useState(0); // bump to re-render (positions are painted directly)
  const [anyHeld, setAnyHeld] = useState(false);
  const simRef = useRef<SimNode[]>([]);
  const runningRef = useRef(false);
  const rafRef = useRef<number | undefined>(undefined);
  // (sx, sy): where the press began; (gx, gy): where on the pill it was grabbed,
  // so the pill follows the pointer without its centre jumping under it.
  const dragRef = useRef<{ id: string; moved: boolean; sx: number; sy: number; gx: number; gy: number } | null>(null);
  const draggingId = useRef<string | null>(null);
  const initedKey = useRef<string>("");
  const addingRef = useRef(false); // serialize adds so rapid taps don't race

  const relatedKey = related.map((r) => r.term).join("|");

  // How wide a term may get before it wraps. Stacked, a pill may take most of the
  // canvas; in the side-by-side layout two of them plus the centre must fit a row.
  const labelMax = narrow
    ? Math.max(120, Math.min(260, Math.round(boxW * 0.62)))
    : Math.max(94, Math.min(190, Math.round(boxW * 0.26)));
  const centerMax = narrow
    ? Math.max(140, Math.min(300, Math.round(boxW * 0.7)))
    : Math.max(120, Math.min(260, Math.round(boxW * 0.3)));

  const setEl = (id: string) => (el: HTMLDivElement | null) => {
    if (el) elRefs.current.set(id, el);
    else elRefs.current.delete(id);
  };
  const setLink = (id: string) => (el: SVGPathElement | null) => {
    if (el) linkRefs.current.set(id, el);
    else linkRefs.current.delete(id);
  };

  // Measure the rendered pills, then hand every node its home slot and grow the
  // canvas to whatever the two arms need. Wide: a fanned column per side. Narrow:
  // synonyms stacked above the word, antonyms below.
  const layout = useCallback(() => {
    const nodes = simRef.current;
    if (nodes.length === 0) return;
    for (const n of nodes) {
      const el = elRefs.current.get(n.id);
      if (el) {
        n.w = el.offsetWidth;
        n.h = el.offsetHeight;
      }
    }
    const { w, h } = dimsRef.current;
    const ready = nodes.every((n) => elRefs.current.has(n.id));
    const center = nodes[0];
    const gapY = 12;
    const arms = ([1, -1] as const).map((side) => nodes.filter((n) => n.kind !== "center" && n.side === side));
    const runs = arms.map((col) => col.reduce((s, n) => s + n.h, 0) + gapY * Math.max(0, col.length - 1));
    center.hx = w / 2;
    const finish = (nextH: number) => {
      for (const n of nodes) {
        if (!n.held) continue;
        n.hx = clampAxis(center.hx + n.ox, n.w, w);
        n.hy = clampAxis(center.hy + n.oy, n.h, h);
      }
      seed(nodes, ready);
      setBoxH(Math.round(nextH));
    };

    if (w < NARROW) {
      const armGap = 16;
      const tall = runs[0] + runs[1] + center.h + armGap * 2;
      const top = Math.max(8, (h - tall) / 2);
      center.hy = top + runs[0] + armGap + center.h / 2;
      arms.forEach((col, gi) => {
        let y = gi === 0 ? top : center.hy + center.h / 2 + armGap;
        col.forEach((n, i) => {
          // a small left/right zig keeps the stack from reading as a plain list
          const reach = Math.max(0, w / 2 - n.w / 2 - 6);
          n.hx = w / 2 + (i % 2 === 0 ? -1 : 1) * Math.min(18, reach);
          n.hy = y + n.h / 2;
          y += n.h + gapY;
        });
      });
      finish(Math.min(640, Math.max(300, tall + 20 + BOTTOM_BAND * 2)));
      return;
    }

    const midY = h / 2;
    center.hy = midY;
    // links lengthen as the canvas widens, so a desktop row isn't one tight knot
    const reach = 26 + Math.min(64, Math.max(0, w - 640) * 0.12);
    arms.forEach((col, gi) => {
      if (col.length === 0) return;
      const side = gi === 0 ? 1 : -1;
      const colW = Math.max(...col.map((n) => n.w));
      const minX = colW / 2 + 6;
      const maxX = Math.max(minX, w - colW / 2 - 6);
      const colX = Math.min(Math.max(minX, w / 2 + side * (center.w / 2 + reach + colW / 2)), maxX);
      let y = midY - runs[gi] / 2;
      col.forEach((n) => {
        const slotY = y + n.h / 2;
        y += n.h + gapY;
        // ends of the column sit a little closer in, so the links fan out
        const inset = 22 * Math.min(1, Math.abs(slotY - midY) / (runs[gi] / 2 || 1));
        n.hx = Math.min(Math.max(minX, colX - side * inset), maxX);
        n.hy = slotY;
      });
    });
    finish(Math.min(560, Math.max(300, Math.max(center.h, runs[0], runs[1]) + 24 + BOTTOM_BAND * 2)));
  }, []);

  // One fixed step. Free nodes ride their spring home; then any two boxes that
  // overlap are pushed apart outright — the old per-frame nudge let pills sit half
  // under each other while one was dragged — and each node's velocity is re-read
  // from where it actually ended up, so a blocked node doesn't keep pressing in.
  const step = useCallback((dt: number, snap: boolean) => {
    const nodes = simRef.current;
    const { w, h } = dimsRef.current;
    // Who gives way: the word and the pill in hand never do, a dropped pill only
    // to those two, and the rest to everyone. Equals split the move.
    const rank = (n: SimNode) => (n.pinned || draggingId.current === n.id ? 2 : n.held ? 1 : 0);
    const prev = nodes.map((n) => [n.x, n.y]);
    for (const n of nodes) {
      if (n.pinned) {
        n.x = n.hx;
        n.y = n.hy;
      }
      if (rank(n) === 2) continue;
      if (snap) {
        n.x = n.hx;
        n.y = n.hy;
        continue;
      }
      n.vx += (OMEGA * OMEGA * (n.hx - n.x) - 2 * ZETA * OMEGA * n.vx) * dt;
      n.vy += (OMEGA * OMEGA * (n.hy - n.y) - 2 * ZETA * OMEGA * n.vy) * dt;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const ra = rank(a);
        const rb = rank(b);
        if (ra === 2 && rb === 2) continue;
        const minX = (a.w + b.w) / 2 + 10;
        const minY = (a.h + b.h) / 2 + 8;
        const dx = a.x - b.x || (Math.random() - 0.5) * 0.1;
        const dy = a.y - b.y || (Math.random() - 0.5) * 0.1;
        const ox = minX - Math.abs(dx);
        const oy = minY - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        const ka = ra > rb ? 0 : ra < rb ? 1 : 0.5;
        const kb = 1 - ka;
        // along whichever axis needs the smaller move
        if (ox / minX < oy / minY) {
          const m = Math.sign(dx) * ox;
          a.x += m * ka;
          b.x -= m * kb;
        } else {
          const m = Math.sign(dy) * oy;
          a.y += m * ka;
          b.y -= m * kb;
        }
      }
    }
    nodes.forEach((n, i) => {
      if (rank(n) === 2) {
        n.vx = 0;
        n.vy = 0;
        return;
      }
      clampToBox(n, w, h);
      n.vx = (n.x - prev[i][0]) / dt;
      n.vy = (n.y - prev[i][1]) / dt;
    });
  }, []);

  // Positions go straight to the DOM as a transform (nothing re-lays out) instead
  // of re-rendering the whole graph on every frame.
  const paint = useCallback(() => {
    const nodes = simRef.current;
    const c = nodes[0];
    if (!c) return;
    for (const n of nodes) {
      const el = elRefs.current.get(n.id);
      if (el) {
        el.style.transform = place(n);
        if (n.placed) el.style.visibility = "visible";
      }
      linkRefs.current.get(n.id)?.setAttribute("d", linkPath(c, n));
    }
  }, []);

  const ensureRunning = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    const snap = prefersReducedMotion();
    let last = -1;
    let acc = 0;
    let quiet = 0;
    const loop = (now: number) => {
      // real time in fixed steps; a stall (a background tab) is capped, not replayed
      acc += last < 0 ? STEP : Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      layout(); // pills are measured live: a font swap or a resize re-slots them
      while (acc >= STEP) {
        step(STEP, snap);
        acc -= STEP;
      }
      paint();
      const moving = simRef.current.some((n) => Math.abs(n.vx) > 3 || Math.abs(n.vy) > 3);
      quiet = moving || draggingId.current !== null ? 0 : quiet + 1;
      if (quiet > 10) {
        runningRef.current = false;
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [layout, step, paint]);

  // Measure the container and keep dims current. The canvas only mounts once the
  // family is known (often a fetch later), so this re-runs then — measuring on the
  // first render found no canvas and left a phone laid out as a 640px desktop.
  const hasFamily = related.length > 0;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth || 640;
      dimsRef.current = { w, h: el.clientHeight || 340 };
      setBoxW(w);
    };
    measure();
    const ro = new ResizeObserver(() => {
      measure();
      ensureRunning();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ensureRunning, hasFamily]);

  // Fonts land after first paint and change every pill's width — re-settle once.
  useEffect(() => {
    document.fonts?.ready.then(() => ensureRunning()).catch(() => {});
  }, [ensureRunning]);

  // (Re)build the simulation whenever the related set changes.
  useEffect(() => {
    if (related.length === 0) return;
    const key = `${word.id}|${relatedKey}`;
    if (initedKey.current === key) return;
    initedKey.current = key;
    const { w, h } = dimsRef.current;
    const cx = w / 2;
    const cy = h / 2;
    const nodes: SimNode[] = [
      { id: "__center__", label: word.word, kind: "center", saved: true, pinned: true, side: 1, x: cx, y: cy, vx: 0, vy: 0, w: 140, h: 40, hx: cx, hy: cy, placed: true, held: false, ox: 0, oy: 0 },
    ];
    // A pill already on screen (the family just grew by one) carries on from where
    // it is instead of dropping back to the centre; a new one flies out.
    const onScreen = new Map(simRef.current.map((n) => [n.id, n]));
    const spots = heldStore.get(word.id);
    // Synonyms go right, antonyms left — but a word with only one of the two
    // would leave half the canvas bare, so then both columns share that kind.
    const oneSided = related.every((r) => r.kind === related[0].kind);
    // Rough starting boxes near the centre; the first measured layout() seeds
    // each term toward its real slot and the springs carry it the rest of the way.
    related.forEach((r, i) => {
      const side: 1 | -1 = oneSided ? (i % 2 === 0 ? 1 : -1) : r.kind === "syn" ? 1 : -1;
      const was = onScreen.get(r.term);
      const spot = spots?.get(r.term);
      nodes.push({
        id: r.term,
        label: r.term,
        kind: r.kind,
        saved: savedMap.has(r.term.trim().toLowerCase()),
        pinned: false,
        side,
        x: was?.x ?? cx + side * (20 + Math.random() * 10),
        y: was?.y ?? cy + (Math.random() - 0.5) * 20,
        vx: was?.vx ?? 0,
        vy: was?.vy ?? 0,
        w: was?.w ?? 120,
        h: was?.h ?? 36,
        hx: cx + side * 120,
        hy: cy,
        placed: was?.placed ?? false,
        held: !!spot,
        ox: spot?.dx ?? 0,
        oy: spot?.dy ?? 0,
      });
    });
    simRef.current = nodes;
    elRefs.current.clear();
    linkRefs.current.clear();
    setAnyHeld(nodes.some((n) => n.held));
    setFrame((f) => (f + 1) % 1_000_000); // render the new set; the loop paints it from here
  }, [relatedKey, related, savedMap, word.id, word.word]);

  // Run the animation loop on every mount (guard-free), so React StrictMode's
  // mount→unmount→mount in dev — which cancels the first loop — can't leave the
  // graph frozen. Cleanup resets the flag so the next mount restarts it.
  useEffect(() => {
    ensureRunning();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
    };
  }, [ensureRunning, relatedKey]);

  // Refresh "saved" flags when the vocabulary list updates (e.g. after adding).
  useEffect(() => {
    for (const n of simRef.current) {
      if (n.kind !== "center") {
        const k = n.id.trim().toLowerCase();
        n.saved = savedMap.has(k) || addedIds.has(k);
      }
    }
    setFrame((f) => (f + 1) % 1_000_000);
  }, [savedMap, addedIds]);

  if (related.length === 0) return null;

  async function activate(node: SimNode) {
    const key = node.id.trim().toLowerCase();
    if (!key) return;
    const id = savedMap.get(key) ?? addedIds.get(key);
    if (id) {
      router.push(`/word/${id}`);
      return;
    }
    // One add at a time — rapid taps on several nodes must not spawn concurrent
    // jobs (which raced, overwrote each other's progress, and left blank cards).
    if (addingRef.current || addedIds.has(key)) return;
    addingRef.current = true;
    try {
      const ai = isAiSupported(word.sourceLang);
      const stored = getGraphAddMethod();
      let how: string | null;
      if (!ai) {
        how = "manual";
      } else if (stored !== "ask") {
        how = stored; // user chose "don't ask again" earlier
      } else {
        let remember = false;
        how = await choose({
          title: t("graph.addTitle", { word: node.label }),
          options: [
            { value: "ai", label: t("add.auto"), hint: t("graph.aiHint") },
            { value: "manual", label: t("add.manual"), hint: t("graph.manualHint") },
          ],
          checkboxLabel: t("graph.remember"),
          onResult: (checked) => {
            remember = checked;
          },
        });
        if (how && remember) setGraphAddMethod(how as GraphAddMethod);
      }
      if (!how) return;
      if (how === "manual") {
        await addManual.mutateAsync(node.label);
        return;
      }
      // AI path generates an example → make sure we know the level first.
      const { ok } = await ensureLevel(word.sourceLang);
      if (!ok) return;
      await add.mutateAsync(node.label);
    } catch {
      /* the mutation's onError already surfaced a toast */
    } finally {
      addingRef.current = false;
    }
  }

  function onDown(e: React.PointerEvent, node: SimNode) {
    if (node.pinned) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    const n = simRef.current.find((x) => x.id === node.id);
    if (!rect || !n) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      id: n.id,
      moved: false,
      sx: e.clientX,
      sy: e.clientY,
      gx: e.clientX - rect.left - n.x,
      gy: e.clientY - rect.top - n.y,
    };
    draggingId.current = n.id;
    ensureRunning();
  }
  function onMove(e: React.PointerEvent, node: SimNode) {
    const d = dragRef.current;
    if (d?.id !== node.id) return;
    // a finger never lands perfectly still — under the slop it's still a tap
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    const n = simRef.current.find((x) => x.id === node.id);
    if (!rect || !n) return;
    if (!d.moved) {
      d.moved = true;
      // lifted: it rides over the other pills and casts a deeper shadow
      const el = elRefs.current.get(n.id);
      if (el) {
        el.style.zIndex = "30";
        el.dataset.dragging = "";
      }
    }
    n.x = e.clientX - rect.left - d.gx;
    n.y = e.clientY - rect.top - d.gy;
    clampToBox(n, dimsRef.current.w, dimsRef.current.h);
    ensureRunning();
  }
  function onUp(node: SimNode, cancelled = false) {
    const d = dragRef.current;
    if (d?.id !== node.id) return;
    dragRef.current = null;
    draggingId.current = null;
    const el = elRefs.current.get(node.id);
    if (el) {
      el.style.zIndex = "";
      delete el.dataset.dragging;
    }
    const n = simRef.current.find((x) => x.id === node.id);
    const c = simRef.current[0];
    if (d.moved && n && c) {
      // it stays where it was dropped: that spot is its home from now on
      n.held = true;
      n.ox = n.x - c.hx;
      n.oy = n.y - c.hy;
      n.hx = n.x;
      n.hy = n.y;
      const spots = heldStore.get(word.id) ?? new Map<string, { dx: number; dy: number }>();
      spots.set(n.id, { dx: n.ox, dy: n.oy });
      heldStore.set(word.id, spots);
      setAnyHeld(true);
    }
    ensureRunning();
    if (!d.moved && !cancelled) activate(node); // treated as a tap
  }
  // Every dropped pill springs back to its slot.
  function resetLayout() {
    heldStore.delete(word.id);
    for (const n of simRef.current) n.held = false;
    setAnyHeld(false);
    ensureRunning();
  }

  const nodes = simRef.current;
  const center = nodes[0];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("word.family")}</p>
        <span className="text-[11px] text-ink-faint">{t("word.familyHint")}</span>
      </div>

      <div
        ref={wrapRef}
        style={{ height: boxH }}
        className="graph-canvas relative w-full touch-none select-none overflow-hidden rounded-[18px] border border-black/[0.06]"
      >
        {/* add-your-own controls, each under the column it grows */}
        <button
          type="button"
          onClick={() => promptAdd("ant")}
          className="absolute bottom-3 left-3 z-20 max-w-[45%] truncate rounded-full border border-dashed border-warn/50 bg-surface/80 px-2.5 py-1 text-[12px] font-semibold text-warn-text backdrop-blur transition-colors hover:bg-warn-bg"
        >
          + {t("word.antonyms")}
        </button>
        <button
          type="button"
          onClick={() => promptAdd("syn")}
          className="absolute bottom-3 right-3 z-20 max-w-[45%] truncate rounded-full border border-dashed border-sage/50 bg-surface/80 px-2.5 py-1 text-[12px] font-semibold text-sage-deep backdrop-blur transition-colors hover:bg-sage-tint"
        >
          + {t("word.synonyms")}
        </button>
        {anyHeld && (
          <button
            type="button"
            onClick={resetLayout}
            className="anim-fade-up absolute right-3 top-3 z-20 inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-surface/80 px-2.5 py-1 text-[12px] font-semibold text-ink-muted backdrop-blur transition-colors hover:bg-black/[0.04] hover:text-ink"
          >
            <RotateCcw className="h-3 w-3" /> {t("graph.resetLayout")}
          </button>
        )}

        {/* links — drawn out from the word as the family arrives */}
        {center && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" fill="none">
            {nodes.slice(1).map((n, i) => {
              const nkey = n.id.trim().toLowerCase();
              const saved = savedMap.has(nkey) || addedIds.has(nkey);
              const hot = hovered === n.id;
              return (
                <path
                  key={n.id}
                  ref={setLink(n.id)}
                  d={linkPath(center, n)}
                  pathLength={1}
                  className="graph-link"
                  style={{
                    stroke: n.kind === "syn" ? "var(--color-sage)" : "var(--color-warn)",
                    strokeWidth: hot ? 2.4 : 1.5,
                    // a saved word's link reads stronger than one still to add
                    opacity: hovered === null ? (saved ? 0.85 : 0.5) : hot ? 1 : 0.15,
                    animationDelay: `${110 + i * 45}ms`,
                  }}
                />
              );
            })}
          </svg>
        )}

        {/* nodes — w-max, or an absolute box shrinks to the room left before the
            canvas edge and a pill near it wraps word by word */}
        {nodes.map((n, i) => {
          if (n.kind === "center") {
            return (
              <div
                key={n.id}
                ref={setEl(n.id)}
                className="graph-node pointer-events-none absolute left-0 top-0 z-10 w-max -translate-x-1/2 -translate-y-1/2 p-1.5 will-change-transform"
                style={{ transform: place(n) }}
              >
                <div
                  style={{ maxWidth: centerMax }}
                  className={cn(
                    "graph-center relative rounded-[16px] bg-onyx px-4 py-2 text-center text-[15px] font-bold leading-snug text-white",
                    targetFont(word.sourceLang),
                  )}
                >
                  <span className="line-clamp-3 break-words">{n.label}</span>
                </div>
              </div>
            );
          }
          const dim = hovered !== null && hovered !== n.id;
          const nkey = n.id.trim().toLowerCase();
          const busy = pending === nkey;
          const saved = savedMap.has(nkey) || addedIds.has(nkey);
          return (
            <div
              key={n.id}
              ref={setEl(n.id)}
              className={cn(
                "graph-node group absolute left-0 top-0 z-10 w-max -translate-x-1/2 -translate-y-1/2 p-1.5 transition-opacity duration-200 will-change-transform",
                // hidden until its first real slot is known (paint() reveals it),
                // so the rough pre-measure spot never flashes
                !n.placed && "invisible",
                dim && "opacity-40",
                busy && "opacity-60",
              )}
              style={{ transform: place(n), animationDelay: `${60 + i * 45}ms` }}
              onPointerEnter={() => setHovered(n.id)}
              onPointerLeave={() => setHovered((h) => (h === n.id ? null : h))}
            >
              <button
                type="button"
                onPointerDown={(e) => onDown(e, n)}
                onPointerMove={(e) => onMove(e, n)}
                onPointerUp={() => onUp(n)}
                onPointerCancel={() => onUp(n, true)}
                title={saved ? n.label : `+ ${n.label}`}
                data-kind={n.kind}
                data-hot={hovered === n.id || undefined}
                style={{ maxWidth: labelMax }}
                className={cn(
                  "graph-pill block cursor-grab touch-none rounded-[14px] border px-3 py-1.5 text-center text-[13px] font-semibold leading-snug",
                  targetFont(word.sourceLang),
                  saved
                    ? n.kind === "syn"
                      ? "border-sage/50 bg-sage-tint text-sage-deep"
                      : "border-warn/40 bg-warn-bg text-warn-text"
                    : "border-dashed border-black/25 bg-paper text-ink-muted",
                )}
              >
                <span className="line-clamp-3 break-words">
                  {!saved && "+ "}
                  {n.label}
                </span>
              </button>
              {/* delete this synonym/antonym from the word (with confirm) */}
              <span
                role="button"
                aria-label={t("common.delete")}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  confirmRemove(n);
                }}
                className="absolute right-0 top-0 hidden h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-warn text-white shadow group-hover:flex"
              >
                <X className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] font-medium text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sage" /> {t("word.synonyms")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-warn" /> {t("word.antonyms")}
        </span>
      </div>
    </div>
  );
}
