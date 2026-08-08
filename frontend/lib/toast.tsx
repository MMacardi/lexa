"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type ImportJob, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";

export interface Toast {
  id: number;
  icon: string;
  title: string;
  subtitle?: string;
  tone?: "achievement" | "goal";
}

type ShowInput = Omit<Toast, "id">;
type ImportTracker = {
  jobId: string;
  telegramId: string;
  words: string[];
  total: number;
  processed: number;
  status: ImportJob["status"];
  errors: string[];
  errorMessage: string | null;
};

const ToastCtx = createContext<{ show: (t: ShowInput) => void; trackImport: (t: Omit<ImportTracker, "status" | "errors" | "errorMessage">) => void }>({
  show: () => {},
  trackImport: () => {},
});
export const useToast = () => useContext(ToastCtx);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { accountId } = useAccount();
  const [toasts, setToasts] = useState<(Toast & { leaving?: boolean })[]>([]);
  const [tracker, setTracker] = useState<ImportTracker | null>(null);
  // Once enrichment finishes, resolve the enriched words → their card ids so the
  // list in the toast is clickable (opens the freshly-made word page).
  const [wordIds, setWordIds] = useState<Record<string, string>>({});

  const remove = useCallback((id: number) => {
    // play the exit animation, then unmount
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 280);
  }, []);

  const show = useCallback(
    (t: ShowInput) => {
      const id = ++counter;
      setToasts((list) => [...list, { ...t, id }]);
      setTimeout(() => remove(id), 4600);
    },
    [remove],
  );

  const trackImport = useCallback((payload: Omit<ImportTracker, "status" | "errors" | "errorMessage">) => {
    setWordIds({});
    setTracker({ ...payload, status: "queued", errors: [], errorMessage: null });
  }, []);

  useEffect(() => {
    if (!tracker) return;
    if (tracker.status === "completed" || tracker.status === "failed") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await api.getImportJob(tracker.jobId, tracker.telegramId || accountId);
        if (cancelled) return;
        setTracker((current) =>
          current
            ? {
                ...current,
                status: next.status,
                total: next.total,
                processed: next.processed,
                errors: next.errors,
                errorMessage: next.errorMessage,
              }
            : current,
        );
      } catch {
        if (cancelled) return;
      }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };

    timer = setTimeout(poll, 300);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tracker, accountId]);

  // When enrichment completes, map the enriched words to their new card ids.
  useEffect(() => {
    if (!tracker || tracker.status !== "completed") return;
    let cancelled = false;
    (async () => {
      try {
        const list: Word[] = await api.listWords(tracker.telegramId || accountId);
        if (cancelled) return;
        const wanted = new Set(tracker.words.map((w) => w.trim().toLowerCase()));
        const map: Record<string, string> = {};
        for (const w of list) {
          const k = w.word.trim().toLowerCase();
          if (wanted.has(k) && !map[k]) map[k] = w.id; // first (most recent) match
        }
        setWordIds(map);
      } catch {
        /* ignore — links just won't be available */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tracker?.status, tracker?.jobId, tracker, accountId]);

  const currentWord = useMemo(() => {
    if (!tracker) return null;
    return tracker.words[tracker.processed] ?? tracker.words[tracker.words.length - 1] ?? null;
  }, [tracker]);

  return (
    <ToastCtx.Provider value={{ show, trackImport }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[330px] max-w-[calc(100vw-2rem)] flex-col gap-2.5">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
      {tracker && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[75] w-[360px] max-w-[calc(100vw-2rem)]">
          <div className="group pointer-events-auto overflow-hidden rounded-[18px] border border-black/[0.08] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.22)]">
            <div className="h-1 w-full bg-sage-tint">
              <div
                className="h-full bg-sage transition-all duration-300"
                style={{ width: `${tracker.total ? Math.min(100, (tracker.processed / tracker.total) * 100) : 0}%` }}
              />
            </div>
            <div className="flex items-start gap-3.5 p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sage-tint text-[22px] text-sage-deep">
                {tracker.status === "completed" ? "✓" : tracker.status === "failed" ? "!" : "…"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-faint">
                  {tracker.status === "completed"
                    ? "AI enrichment complete"
                    : tracker.status === "failed"
                      ? "AI enrichment failed"
                      : "AI enrichment in progress"}
                </div>
                <div className="truncate font-serif text-[18px] font-semibold leading-tight text-ink">
                  {tracker.processed} / {tracker.total} cards
                </div>
                <div className="text-[13px] text-ink-soft">
                  {currentWord ? `Current: ${currentWord}` : "Preparing cards…"}
                </div>

                <div
                  className={
                    tracker.status === "completed"
                      ? "mt-3 overflow-hidden"
                      : "mt-3 max-h-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:max-h-56 group-hover:opacity-100"
                  }
                >
                  <div className="rounded-[14px] border border-black/[0.06] bg-paper/80 p-2">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-faint">
                      {tracker.status === "completed" ? "Tap a word to open it" : "Hover details"}
                    </div>
                    <div className="max-h-40 space-y-1.5 overflow-auto pr-1">
                      {tracker.words.map((word, index) => {
                        const done = index < tracker.processed;
                        const active = index === tracker.processed && tracker.status !== "completed";
                        const id = wordIds[word.trim().toLowerCase()];
                        const label = (
                          <span className={done ? "text-sage-deep" : active ? "font-semibold text-ink" : "text-ink-soft"}>
                            {word}
                          </span>
                        );
                        return (
                          <div key={word + index} className="flex items-center justify-between gap-2 text-sm">
                            {id ? (
                              <Link href={`/word/${id}`} className="truncate hover:underline">
                                {label}
                              </Link>
                            ) : (
                              label
                            )}
                            <span className={done ? "text-sage" : "text-ink-faint"}>
                              {done ? (id ? "↗" : "✓") : active ? "…" : "•"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {tracker.errors.length > 0 && (
                      <div className="mt-2 text-[12px] text-warn-text">
                        {tracker.errors.length} words skipped
                      </div>
                    )}
                    {tracker.errorMessage && (
                      <div className="mt-2 text-[12px] text-warn-text">{tracker.errorMessage}</div>
                    )}
                  </div>
                </div>

                {tracker.status === "completed" && (
                  <button
                    type="button"
                    onClick={() => setTracker(null)}
                    className="mt-3 text-sm font-semibold text-sage hover:text-sage-deep"
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

function ToastCard({
  toast,
  onClose,
}: {
  toast: Toast & { leaving?: boolean };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const goal = toast.tone === "goal";
  return (
    <div
      onClick={onClose}
      className={`pointer-events-auto cursor-pointer overflow-hidden rounded-[18px] border border-black/[0.07] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.22)] ${
        toast.leaving ? "anim-toast-out" : "anim-toast-in"
      }`}
    >
      {/* top shimmer accent bar */}
      <div
        className="h-1 w-full"
        style={{
          background: goal
            ? "linear-gradient(90deg,#c09180,#e0b58f,#c09180)"
            : "linear-gradient(90deg,#7c9885,#a9c6b0,#7c9885)",
          backgroundSize: "220% 100%",
          animation: "lexaShine 1.8s linear infinite",
        }}
      />
      <div className="flex items-center gap-3.5 p-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[24px] ${
            goal ? "bg-warn-bg" : "bg-sage-tint"
          }`}
        >
          {toast.icon}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-faint">
            {goal ? t("toast.goalLabel") : t("toast.achievement")}
          </div>
          <div className="truncate font-serif text-[18px] font-semibold leading-tight text-ink">
            {toast.title}
          </div>
          {toast.subtitle && (
            <div className="truncate text-[13px] text-ink-soft">{toast.subtitle}</div>
          )}
        </div>
      </div>
    </div>
  );
}
