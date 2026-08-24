"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { useToast } from "@/lib/toast";
import { X } from "lucide-react";
import { useDialog } from "@/lib/dialog";
import { useEnsureLevel } from "@/lib/useEnsureLevel";
import { isAiSupported } from "@/lib/langs";
import { getExampleSource, getExampleStyle, getLevel, getGraphAddMethod, setGraphAddMethod, type GraphAddMethod } from "@/lib/learnPrefs";
import { cn } from "@/lib/utils";

type Kind = "center" | "syn" | "ant";
interface SimNode {
  id: string;
  label: string;
  kind: Kind;
  saved: boolean;
  pinned: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const targetFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" ? "font-zh" : "");

// A live, Obsidian-style force-directed "word family": the current word sits in
// the middle, its synonyms/antonyms orbit it. Nodes repel each other, links pull
// them toward a rest length, and everything is draggable — release to watch it
// spring back into place. No graph library; a tiny custom simulation on rAF.
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
    word.synonyms.forEach((s) => push(s, "syn"));
    word.antonyms.forEach((a) => push(a, "ant"));
    return out.slice(0, 8);
  }, [word.synonyms, word.antonyms]);

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
  const dimsRef = useRef({ w: 640, h: 320 });
  const [, setFrame] = useState(0); // bump to re-render node positions
  const simRef = useRef<SimNode[]>([]);
  const runningRef = useRef(false);
  const rafRef = useRef<number | undefined>(undefined);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const draggingId = useRef<string | null>(null);
  const initedKey = useRef<string>("");
  const addingRef = useRef(false); // serialize adds so rapid taps don't race

  const relatedKey = related.map((r) => r.term).join("|");

  const clampX = (x: number) => Math.max(52, Math.min(dimsRef.current.w - 52, x));
  const clampY = (y: number) => Math.max(44, Math.min(dimsRef.current.h - 44, y));

  const tick = useCallback(() => {
    const nodes = simRef.current;
    const { w, h } = dimsRef.current;
    const cx = w / 2;
    const cy = h / 2;
    const rest = Math.min(w, h) * 0.32;
    // pairwise repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          d2 = 1;
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
        }
        const d = Math.sqrt(d2);
        const f = 7000 / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    // spring: every related node linked to the centre
    const center = nodes[0];
    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i];
      const dx = n.x - center.x;
      const dy = n.y - center.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - rest) * 0.04;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      n.vx -= fx;
      n.vy -= fy;
      // keep synonyms on the right, antonyms on the left: nudge only when a node
      // is on the wrong side (so it still settles once separated).
      const want = n.kind === "syn" ? 1 : -1;
      const off = n.x - center.x;
      if (Math.sign(off) !== want || Math.abs(off) < 24) n.vx += want * 0.9;
    }
    // integrate
    for (const n of nodes) {
      if (n.pinned) {
        n.x = cx;
        n.y = cy;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      if (draggingId.current === n.id) {
        n.vx = 0;
        n.vy = 0;
        continue; // position is driven by the pointer
      }
      n.vx *= 0.85;
      n.vy *= 0.85;
      n.x = clampX(n.x + n.vx);
      n.y = clampY(n.y + n.vy);
    }
  }, []);

  const ensureRunning = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    const loop = () => {
      tick();
      setFrame((f) => (f + 1) % 1_000_000);
      const e = simRef.current.reduce((s, n) => s + n.vx * n.vx + n.vy * n.vy, 0);
      if (e < 0.03 && draggingId.current === null) {
        runningRef.current = false;
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [tick]);

  // Measure the container and keep dims current.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      dimsRef.current = { w: el.clientWidth || 640, h: el.clientHeight || 320 };
    };
    measure();
    const ro = new ResizeObserver(() => {
      measure();
      ensureRunning();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ensureRunning]);

  // (Re)build the simulation whenever the related set changes.
  useEffect(() => {
    if (related.length === 0) return;
    if (initedKey.current === relatedKey) return;
    initedKey.current = relatedKey;
    const { w, h } = dimsRef.current;
    const cx = w / 2;
    const cy = h / 2;
    const r0 = Math.min(w, h) * 0.3; // start already spread, then physics refines
    const nodes: SimNode[] = [
      { id: "__center__", label: word.word, kind: "center", saved: true, pinned: true, x: cx, y: cy, vx: 0, vy: 0 },
    ];
    // Group synonyms on the right, antonyms on the left; spread each group
    // vertically. A separation force in tick() keeps the two sides apart.
    const counts = { syn: 0, ant: 0 };
    const totals = {
      syn: related.filter((r) => r.kind === "syn").length,
      ant: related.filter((r) => r.kind === "ant").length,
    };
    related.forEach((r) => {
      const side = r.kind === "syn" ? 1 : -1;
      const total = totals[r.kind];
      const idx = counts[r.kind]++;
      const frac = total <= 1 ? 0.5 : idx / (total - 1); // 0..1 down the column
      const ang = (-52 + 104 * frac) * (Math.PI / 180); // fan of ±52° from horizontal
      nodes.push({
        id: r.term,
        label: r.term,
        kind: r.kind,
        saved: savedMap.has(r.term.trim().toLowerCase()),
        pinned: false,
        x: cx + side * Math.cos(ang) * r0,
        y: cy + Math.sin(ang) * r0,
        vx: 0,
        vy: 0,
      });
    });
    simRef.current = nodes;
  }, [relatedKey, related, savedMap, word.word]);

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
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: node.id, moved: false };
    draggingId.current = node.id;
  }
  function onMove(e: React.PointerEvent, node: SimNode) {
    if (dragRef.current?.id !== node.id) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current.moved = true;
    const n = simRef.current.find((x) => x.id === node.id);
    if (n) {
      n.x = clampX(e.clientX - rect.left);
      n.y = clampY(e.clientY - rect.top);
    }
    ensureRunning();
  }
  function onUp(node: SimNode) {
    const moved = dragRef.current?.moved;
    dragRef.current = null;
    draggingId.current = null;
    ensureRunning(); // let it spring back
    if (!moved) activate(node); // treated as a tap
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
        className="relative h-[300px] w-full touch-none select-none overflow-hidden rounded-[18px] border border-black/[0.06] bg-[radial-gradient(circle_at_50%_45%,rgba(124,152,133,0.10),transparent_70%)] bg-surface sm:h-[360px]"
      >
        {/* add-your-own controls, on the canvas */}
        <div className="absolute right-3 top-3 z-20 flex gap-1.5">
          <button
            type="button"
            onClick={() => promptAdd("syn")}
            className="rounded-full border border-dashed border-sage/50 bg-surface/80 px-2.5 py-1 text-[12px] font-semibold text-sage-deep backdrop-blur transition-colors hover:bg-sage-tint"
          >
            + {t("word.synonyms")}
          </button>
          <button
            type="button"
            onClick={() => promptAdd("ant")}
            className="rounded-full border border-dashed border-warn/50 bg-surface/80 px-2.5 py-1 text-[12px] font-semibold text-warn-text backdrop-blur transition-colors hover:bg-warn-bg"
          >
            + {t("word.antonyms")}
          </button>
        </div>

        {/* links */}
        {center && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {nodes.slice(1).map((n) => {
              const active = hovered === null || hovered === n.id;
              return (
                <line
                  key={n.id}
                  x1={center.x}
                  y1={center.y}
                  x2={n.x}
                  y2={n.y}
                  stroke={n.kind === "syn" ? "rgba(124,152,133,0.55)" : "rgba(192,145,128,0.6)"}
                  strokeWidth={hovered === n.id ? 2.4 : 1.5}
                  opacity={active ? 1 : 0.25}
                />
              );
            })}
          </svg>
        )}

        {/* nodes */}
        {nodes.map((n) => {
          if (n.kind === "center") {
            return (
              <div
                key={n.id}
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: n.x, top: n.y }}
              >
                <div className={cn("max-w-[160px] truncate rounded-full bg-onyx px-4 py-2 text-[15px] font-bold text-white shadow-[0_6px_18px_rgba(0,0,0,0.25)]", targetFont(word.sourceLang))}>
                  {n.label}
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
              className={cn(
                "group absolute z-10 -translate-x-1/2 -translate-y-1/2 p-2 transition-opacity",
                dim && "opacity-40",
                busy && "opacity-60",
              )}
              style={{ left: n.x, top: n.y }}
              onPointerEnter={() => setHovered(n.id)}
              onPointerLeave={() => setHovered((h) => (h === n.id ? null : h))}
            >
              <button
                type="button"
                onPointerDown={(e) => onDown(e, n)}
                onPointerMove={(e) => onMove(e, n)}
                onPointerUp={() => onUp(n)}
                title={saved ? n.label : `+ ${n.label}`}
                className={cn(
                  "block max-w-[160px] cursor-grab touch-none truncate rounded-full border px-3 py-1.5 text-[13px] font-semibold shadow-sm transition-[transform,box-shadow] active:cursor-grabbing",
                  saved
                    ? n.kind === "syn"
                      ? "border-sage/50 bg-sage-tint text-sage-deep"
                      : "border-warn/40 bg-warn-bg text-warn-text"
                    : n.kind === "syn"
                      ? "border-dashed border-black/25 bg-paper text-ink-muted hover:border-sage hover:text-sage-deep"
                      : "border-dashed border-black/25 bg-paper text-ink-muted hover:border-warn hover:text-warn-text",
                  hovered === n.id && "scale-[1.06]",
                  hovered === n.id &&
                    (n.kind === "ant"
                      ? "border-warn shadow-[0_8px_22px_rgba(192,80,60,0.38)]"
                      : "border-sage shadow-[0_8px_22px_rgba(124,152,133,0.4)]"),
                )}
              >
                {!saved && "+ "}
                {n.label}
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
