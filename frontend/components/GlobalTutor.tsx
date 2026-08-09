"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { isAiSupported, langLabel } from "@/lib/langs";
import { getExampleStyle, getLevel } from "@/lib/learnPrefs";
import { useEnsureLevel } from "@/lib/useEnsureLevel";
import { CollectionMultiSelect } from "@/components/CollectionMultiSelect";

type Msg = { role: "user" | "assistant"; content: string; addWords?: string[] };

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
    enabled: open,
  });

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
    onSuccess: (r) => setMessages((m) => [...m, { role: "assistant", content: r.answer, addWords: r.addWords }]),
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

  async function createCards(index: number, terms: string[]) {
    if (creating) return;
    if (isAiSupported(pair.source)) {
      const { ok } = await ensureLevel(pair.source);
      if (!ok) return;
    }
    setCreating(true);
    try {
      const r = await api.batchAddWords({
        telegramId: accountId,
        sourceLang: pair.source,
        targetLang: pair.target,
        words: terms,
        level: getLevel(pair.source) ?? undefined,
        exampleStyle: getExampleStyle(),
        enrich: isAiSupported(pair.source),
        collectionIds: collIds.length ? collIds : undefined,
      });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words: terms, total: r.job.total, processed: 0 });
      show({ icon: "🌱", title: t("word.cardsCreated", { n: r.created }) });
      setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, addWords: [] } : msg)));
    } catch (e) {
      show({ icon: "⚠️", title: (e as Error).message });
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
          className="fixed bottom-[calc(64px_+_env(safe-area-inset-bottom))] right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sage to-sage-deep text-[24px] text-white shadow-[0_12px_32px_rgba(46,42,38,0.32)] transition-transform hover:scale-105 active:scale-95 md:bottom-6"
        >
          ✨
        </button>
      )}

      {/* chat panel */}
      {open && (
        <div className="fixed inset-x-2 bottom-[calc(64px_+_env(safe-area-inset-bottom))] z-50 mx-auto flex max-h-[75vh] w-auto max-w-[420px] flex-col overflow-hidden rounded-[22px] border border-black/[0.08] bg-surface shadow-[0_24px_60px_rgba(46,42,38,0.34)] sm:inset-x-auto sm:right-4 sm:bottom-6 sm:w-[400px]">
          {/* header */}
          <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] bg-gradient-to-br from-sage-tint/70 to-transparent px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-serif text-[17px] font-semibold text-ink">
                <span>✨</span>
                {t("tutor.title")}
              </div>
              <div className="text-[11px] font-medium text-ink-faint">
                {langLabel(pair.source)} → {langLabel(pair.target)}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setMessages([]);
                    ask.reset();
                  }}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-faint hover:bg-black/[0.04] hover:text-ink"
                >
                  ↻
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.cancel")}
                className="rounded-lg px-2 py-1 text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-ink"
              >
                ✕
              </button>
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
                  <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{m.content}</p>
                  {m.addWords && m.addWords.length > 0 && (
                    <div className="space-y-2 rounded-[14px] border border-sage/25 bg-sage-tint/40 p-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {m.addWords.map((w) => (
                          <span key={w} className="rounded-full bg-surface px-2 py-0.5 text-[12px] font-medium text-ink">
                            {w}
                          </span>
                        ))}
                      </div>
                      {collections && collections.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("tutor.toSet")}</span>
                          <CollectionMultiSelect options={collections} value={collIds} onChange={setCollIds} menuClassName="max-h-48" />
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={creating}
                        onClick={() => createCards(i, m.addWords!)}
                        className="w-full rounded-full bg-sage px-3 py-2 text-[13px] font-semibold text-white hover:bg-sage-deep disabled:opacity-50"
                      >
                        ＋ {t("word.createCards")} ({m.addWords.length})
                      </button>
                    </div>
                  )}
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
