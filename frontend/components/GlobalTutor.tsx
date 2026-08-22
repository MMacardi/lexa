"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type TutorCard } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { useToast } from "@/lib/toast";
import { isAiSupported } from "@/lib/langs";
import { getExampleSource, getExampleStyle, getLevel } from "@/lib/learnPrefs";
import { useEnsureLevel } from "@/lib/useEnsureLevel";
import { CollectionMultiSelect } from "@/components/CollectionMultiSelect";
import { LangSelect } from "@/components/LangSelect";
import { RichText } from "@/components/RichText";
import { cn } from "@/lib/utils";
import { Sparkles, RotateCcw, X, LocateFixed, GripHorizontal, Check } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string; addWords?: string[]; addCards?: TutorCard[] };

// The learner's current pair (shared with Add/Reader). Tutor adds words to it.
function readPair(): { source: string; target: string } {
  if (typeof window === "undefined") return { source: "en", target: "zh" };
  try {
    const p = JSON.parse(localStorage.getItem("lexa.wordPair") ?? "null") as { sourceLang?: string; targetLang?: string };
    const source = p?.sourceLang && p.sourceLang !== "auto" ? p.sourceLang : "en";
    return { source, target: p?.targetLang || "zh" };
  } catch {
    return { source: "en", target: "zh" };
  }
}

export function GlobalTutor() {
  const { t } = useI18n();
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const { show, trackImport } = useToast();
  const ensureLevel = useEnsureLevel();

  const [open, setOpen] = useState(false);
  const [pair, setPair] = useState(() => readPair());
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [collIds, setCollIds] = useState<string[]>([]);
  const [wordSel, setWordSel] = useState<Record<number, string[]>>({}); // per-message word selection
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Draggable panel: offset from its docked corner, remembered across opens and
  // page reloads (localStorage). The "reset position" button clears it.
  const [offset, setOffset] = useState<{ x: number; y: number }>(() => {
    try {
      const r = localStorage.getItem("lexa.tutorPos");
      if (r) {
        const p = JSON.parse(r);
        if (typeof p?.x === "number" && typeof p?.y === "number") return p;
      }
    } catch {
      /* ignore */
    }
    return { x: 0, y: 0 };
  });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem("lexa.tutorPos", JSON.stringify(offset));
    } catch {
      /* ignore */
    }
  }, [offset]);
  function startDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button, a, input, select, [role='button']")) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
  }
  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  }
  function endDrag() {
    dragRef.current = null;
  }
  const moved = offset.x !== 0 || offset.y !== 0;

  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
    enabled: open,
  });

  // The learner's existing deck, so we can flag words the tutor suggests that are
  // already saved (matched within the current pair's source language). Shares the
  // Sidebar's cache — no extra request in practice.
  const { data: myWords } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const ownedSet = useMemo(() => {
    const s = new Set<string>();
    for (const w of myWords ?? []) if (w.sourceLang === pair.source) s.add(w.word.trim().toLowerCase());
    return s;
  }, [myWords, pair.source]);
  const isAdded = (w: string) => ownedSet.has(w.trim().toLowerCase());

  // Refresh the pair each time the panel opens (it may have changed elsewhere).
  useEffect(() => {
    if (open) setPair(readPair());
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ask = useMutation({
    mutationFn: (msgs: Msg[]) =>
      api.tutorAsk({
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
        sourceLang: pair.source,
        targetLang: pair.target,
      }),
    onSuccess: (r) => setMessages((m) => [...m, { role: "assistant", content: r.answer, addWords: r.addWords, addCards: r.addCards }]),
  });
  const busy = ask.isPending;

  function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user" as const, content: q }];
    setMessages(next);
    setInput("");
    ask.mutate(next);
  }

  function fillTemplate(template: string) {
    setInput(template);
    inputRef.current?.focus();
  }

  // Toggle a single suggested word's selection within a message.
  function toggleWord(index: number, all: string[], w: string) {
    setWordSel((s) => {
      const cur = s[index] ?? all;
      const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w];
      return { ...s, [index]: next };
    });
  }

  // Change the tutor's language pair and persist it (shared with Add/Reader).
  function changePair(next: { source: string; target: string }) {
    setPair(next);
    try {
      localStorage.setItem("lexa.wordPair", JSON.stringify({ sourceLang: next.source, targetLang: next.target }));
    } catch {
      /* ignore */
    }
  }

  async function createCards(index: number, terms: string[]) {
    if (creating || terms.length === 0) return;
    // Reuse the meaning + example the tutor already wrote (in addCards) so we can
    // save these cards WITHOUT a second AI call. Only when every selected word has
    // both a meaning and an example; otherwise fall back to normal AI enrichment.
    const byWord = new Map((messages[index]?.addCards ?? []).map((c) => [c.word.trim().toLowerCase(), c]));
    const reuseAll = terms.every((w) => {
      const c = byWord.get(w.trim().toLowerCase());
      return c && c.meaning && c.example;
    });

    // A level is only needed when the AI will compose examples.
    if (!reuseAll && isAiSupported(pair.source)) {
      const { ok } = await ensureLevel(pair.source);
      if (!ok) return;
    }
    setCreating(true);
    try {
      const r = await api.batchAddWords(
        reuseAll
          ? {
              telegramId: accountId,
              sourceLang: pair.source,
              targetLang: pair.target,
              items: terms.map((w) => {
                const c = byWord.get(w.trim().toLowerCase())!;
                return { word: w, meaning: c.meaning, sentence: c.example, exampleTr: c.exampleTr };
              }),
              source: "Lexa AI",
              enrich: false, // meaning + example are already known → no tokens spent
              collectionIds: collIds.length ? collIds : undefined,
            }
          : {
              telegramId: accountId,
              sourceLang: pair.source,
              targetLang: pair.target,
              words: terms,
              level: getLevel(pair.source) ?? undefined,
              exampleStyle: getExampleStyle(),
              exampleSource: getExampleSource(),
              enrich: isAiSupported(pair.source),
              collectionIds: collIds.length ? collIds : undefined,
            },
      );
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words: terms, total: r.job.total, processed: 0 });
      show({ icon: "🌱", title: t("word.cardsCreated", { n: r.created }) });
      setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, addWords: [] } : msg)));
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      {/* floating action button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("tutor.open")}
          className="fixed bottom-[calc(64px_+_env(safe-area-inset-bottom))] right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sage to-sage-deep text-white shadow-[0_12px_32px_rgba(46,42,38,0.32)] transition-transform hover:scale-105 active:scale-95 md:bottom-6"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {/* chat panel */}
      {open && (
        <div
          className="fixed inset-x-2 bottom-[calc(64px_+_env(safe-area-inset-bottom))] z-50 mx-auto flex max-h-[75vh] w-auto max-w-[420px] flex-col overflow-hidden rounded-[22px] border border-black/[0.08] bg-surface shadow-[0_24px_60px_rgba(46,42,38,0.34)] sm:inset-x-auto sm:right-4 sm:bottom-6 sm:w-[400px]"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
          {/* header — title, centered drag handle, clickable language pair, actions */}
          <div className="border-b border-black/[0.06] bg-gradient-to-br from-sage-tint/70 to-transparent px-4 pt-3 pb-4">
            <div className="relative flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-serif text-[17px] font-semibold text-ink">
                <Sparkles className="h-[18px] w-[18px] text-sage-deep" />
                {t("tutor.title")}
              </div>
              <div
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                aria-label={t("common.drag")}
                className="absolute left-1/2 flex -translate-x-1/2 cursor-grab touch-none select-none items-center px-6 py-1 text-ink-faint transition-colors hover:text-ink-muted active:cursor-grabbing"
              >
                <GripHorizontal className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-1.5">
                {moved && (
                  <button
                    type="button"
                    onClick={() => setOffset({ x: 0, y: 0 })}
                    aria-label={t("tutor.resetPos")}
                    title={t("tutor.resetPos")}
                    className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
                  >
                    <LocateFixed className="h-3.5 w-3.5" />
                  </button>
                )}
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMessages([]);
                      ask.reset();
                    }}
                    className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("common.cancel")}
                  className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[13px] text-ink-soft">
              <LangSelect value={pair.source} onChange={(v) => changePair({ source: v, target: pair.target })} className="h-8 min-w-0" />
              <span className="text-ink-faint">→</span>
              <LangSelect value={pair.target} onChange={(v) => changePair({ source: pair.source, target: v })} className="h-8 min-w-0" />
            </div>
          </div>

          {/* conversation / welcome */}
          <div ref={scrollRef} className="min-h-[160px] flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-[14px] leading-relaxed text-ink-soft">{t("tutor.welcome")}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Chip onClick={() => fillTemplate(t("tutor.topicTemplate"))}>{t("tutor.suggestTopic")}</Chip>
                  <Chip onClick={() => send(t("tutor.levelTemplate", { level: getLevel(pair.source) ?? "B1" }))}>
                    {t("tutor.suggestLevel")}
                  </Chip>
                  <Chip onClick={() => fillTemplate(t("tutor.explainTemplate"))}>{t("tutor.suggestExplain")}</Chip>
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "assistant" ? (
                <div key={i} className="space-y-2">
                  <RichText text={m.content} className="text-[14px] text-ink" />
                  {m.addWords &&
                    m.addWords.length > 0 &&
                    (() => {
                      const all = m.addWords;
                      const addable = all.filter((w) => !isAdded(w)); // exclude ones already in the deck
                      const selected = (wordSel[i] ?? addable).filter((w) => !isAdded(w));
                      return (
                        <div className="space-y-2 rounded-[14px] border border-sage/25 bg-sage-tint/40 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                              {t("reader.selectedN", { n: selected.length })}
                            </span>
                            <div className="flex gap-2 text-[11px] font-semibold">
                              <button type="button" onClick={() => setWordSel((s) => ({ ...s, [i]: [...addable] }))} className="text-sage hover:text-sage-deep">
                                {t("reader.selectAllNew")}
                              </button>
                              <button type="button" onClick={() => setWordSel((s) => ({ ...s, [i]: [] }))} className="text-ink-faint hover:text-ink-muted">
                                {t("reader.deselectAll")}
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {all.map((w) => {
                              const added = isAdded(w);
                              const on = !added && selected.includes(w);
                              return (
                                <button
                                  key={w}
                                  type="button"
                                  disabled={added}
                                  title={added ? t("tutor.alreadyAdded") : undefined}
                                  onClick={() => toggleWord(i, addable, w)}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                                    added
                                      ? "cursor-default border-black/[0.08] bg-black/[0.03] text-ink-faint line-through opacity-70"
                                      : on
                                        ? "border-sage bg-sage text-white"
                                        : "border-black/[0.12] bg-surface text-ink-muted hover:border-sage/60",
                                  )}
                                >
                                  {added && <Check className="h-3 w-3 shrink-0" />}
                                  {w}
                                </button>
                              );
                            })}
                          </div>
                          {collections && collections.length > 0 && (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("tutor.toSet")}</span>
                              <CollectionMultiSelect options={collections} value={collIds} onChange={setCollIds} menuClassName="max-h-48" />
                            </div>
                          )}
                          <button
                            type="button"
                            disabled={creating || selected.length === 0}
                            onClick={() => createCards(i, selected)}
                            className="w-full rounded-full bg-sage px-3 py-2 text-[13px] font-semibold text-white hover:bg-sage-deep disabled:opacity-50"
                          >
                            ＋ {t("word.createCards")} ({selected.length})
                          </button>
                        </div>
                      );
                    })()}
                </div>
              ) : (
                <div key={i} className="flex justify-end">
                  <span className="max-w-[85%] whitespace-pre-wrap rounded-[14px] rounded-br-sm bg-sage px-3.5 py-2 text-[13px] font-medium text-white">
                    {m.content}
                  </span>
                </div>
              ),
            )}
            {busy && <p className="text-sm text-ink-soft">{t("word.thinking")}</p>}
            {ask.isError && <p className="text-sm text-warn-text">{t("word.askError")}</p>}
          </div>

          {/* footer: input (collection choice appears with the "create cards" action) */}
          <div className="border-t border-black/[0.06] px-3 py-2.5">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("tutor.placeholder")}
                disabled={busy}
                className="h-10 flex-1 rounded-full border border-black/[0.08] bg-surface px-4 text-[16px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none sm:text-[14px]"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-40"
              >
                {t("word.send")}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-sage/40 bg-sage-tint/50 px-3 py-1.5 text-[12px] font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
    >
      {children}
    </button>
  );
}
