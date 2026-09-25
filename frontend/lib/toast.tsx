"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api, type ImportJob, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  TriangleAlert, Sprout, Folders, BookOpen, Target, Languages, WifiOff,
  PenLine, Library, FileText, Save, Home, Layers, Sparkles, Bell, PartyPopper,
  Trophy, UserPlus, Trash2, Loader2, Check, Square, X, ChevronDown, type LucideIcon,
} from "lucide-react";

// Map the emoji that call sites pass to a clean line icon, so toasts match the
// rest of the UI. Unknown strings fall back to being rendered as-is.
const TOAST_ICONS: Record<string, LucideIcon> = {
  "⚠️": TriangleAlert, "🌱": Sprout, "🗂": Folders, "📖": BookOpen, "🎯": Target,
  "🔤": Languages, "📴": WifiOff, "📝": PenLine, "📚": Library, "📄": FileText,
  "💾": Save, "🏠": Home, "🃏": Layers, "✨": Sparkles, "🔔": Bell, "🎉": PartyPopper,
  "🏆": Trophy, "👥": UserPlus, "🗑": Trash2,
};

function ToastIcon({ icon }: { icon: string }) {
  const Icon = TOAST_ICONS[icon.trim()];
  if (!Icon) return <>{icon}</>;
  return <Icon className={icon.trim() === "⚠️" ? "h-6 w-6 text-warn-text" : "h-6 w-6 text-sage-deep"} />;
}

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
  removed?: number; // cards Stop took back (undo the add)
};

const ToastCtx = createContext<{ show: (t: ShowInput) => void; trackImport: (t: Omit<ImportTracker, "status" | "errors" | "errorMessage">) => void }>({
  show: () => {},
  trackImport: () => {},
});
export const useToast = () => useContext(ToastCtx);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [toasts, setToasts] = useState<(Toast & { leaving?: boolean })[]>([]);
  // Several imports can run at once (e.g. add 3 cards, then add 1 more while they
  // enrich). We keep every active job and show ONE combined tracker so the count
  // stays correct (0/4, not 0/1 when the second job would overwrite the first).
  const [jobs, setJobs] = useState<ImportTracker[]>([]);
  // Once enrichment finishes, resolve the enriched words → their card ids so the
  // list in the toast is clickable (opens the freshly-made word page).
  const [wordIds, setWordIds] = useState<Record<string, string>>({});
  const mappedRef = useRef<Set<string>>(new Set()); // jobIds whose words we've resolved
  const [trackerOpen, setTrackerOpen] = useState(false); // the word list under the bar
  const closeTracker = useCallback(() => setJobs([]), []);
  // Stop = undo the add: every running job stops and takes back its cards, bar
  // any the learner has already reviewed (the server keeps those).
  const stopTracker = useCallback(async () => {
    const active = jobs.filter((j) => !isTerminal(j.status));
    const results = await Promise.all(active.map((j) => api.cancelImportJob(j.jobId).catch(() => null)));
    setJobs((cur) =>
      cur.map((x) => {
        const r = results.find((n) => n?.id === x.jobId);
        return r ? { ...x, status: r.status, processed: r.processed, removed: r.removed ?? 0 } : x;
      }),
    );
    for (const key of ["words", "stats", "hskDaily", "hskReadiness", "hskLists"]) qc.invalidateQueries({ queryKey: [key] });
  }, [jobs, qc]);

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

  const isTerminal = (s: ImportJob["status"]) => s === "completed" || s === "failed" || s === "cancelled";

  const trackImport = useCallback((payload: Omit<ImportTracker, "status" | "errors" | "errorMessage">) => {
    setTrackerOpen(false);
    setJobs((cur) => {
      // Keep only still-running jobs, then append the new one (a fresh batch after
      // everything finished starts clean; a job added mid-flight joins the total).
      const active = cur.filter((j) => !isTerminal(j.status));
      if (active.some((j) => j.jobId === payload.jobId)) return cur;
      if (active.length === 0) {
        setWordIds({});
        mappedRef.current = new Set();
      }
      return [...active, { ...payload, status: "queued", errors: [], errorMessage: null }];
    });
  }, []);

  // Poll every active job and update it in place.
  useEffect(() => {
    const active = jobs.filter((j) => !isTerminal(j.status));
    if (active.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      await Promise.all(
        active.map(async (j) => {
          try {
            const next = await api.getImportJob(j.jobId, j.telegramId || accountId);
            if (cancelled) return;
            setJobs((cur) =>
              cur.map((x) =>
                x.jobId === j.jobId
                  ? { ...x, status: next.status, total: next.total, processed: next.processed, errors: next.errors, errorMessage: next.errorMessage }
                  : x,
              ),
            );
          } catch {
            /* keep trying */
          }
        }),
      );
      if (!cancelled) timer = setTimeout(poll, 1500);
    };

    timer = setTimeout(poll, 300);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobs, accountId]);

  // When a job completes, map its enriched words to their new card ids (once).
  useEffect(() => {
    const done = jobs.filter((j) => (j.status === "completed" || j.status === "cancelled") && !mappedRef.current.has(j.jobId));
    if (done.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const list: Word[] = await api.listWords(accountId);
        if (cancelled) return;
        // Push the freshly-enriched cards into the query cache so every view (My
        // words, the word page…) shows the filled-in meaning/example without an F5.
        qc.setQueryData(["words", accountId], list);
        qc.invalidateQueries({ queryKey: ["stats"] });
        const wanted = new Set(done.flatMap((j) => j.words).map((w) => w.trim().toLowerCase()));
        const map: Record<string, string> = {};
        for (const w of list) {
          const k = w.word.trim().toLowerCase();
          if (wanted.has(k) && !map[k]) map[k] = w.id;
        }
        done.forEach((j) => mappedRef.current.add(j.jobId));
        setWordIds((prev) => ({ ...prev, ...map }));
      } catch {
        /* ignore — links just won't be available */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobs, accountId, qc]);

  // One combined view across all active jobs (correct totals when several run).
  const tracker = useMemo(() => {
    if (jobs.length === 0) return null;
    const allTerminal = jobs.every((j) => isTerminal(j.status));
    const status: ImportJob["status"] = allTerminal
      ? jobs.every((j) => j.status === "failed")
        ? "failed"
        : jobs.some((j) => j.status === "cancelled")
          ? "cancelled"
          : "completed"
      : jobs.some((j) => j.status === "processing")
        ? "processing"
        : "queued";
    return {
      total: jobs.reduce((s, j) => s + j.total, 0),
      processed: jobs.reduce((s, j) => s + j.processed, 0),
      words: jobs.flatMap((j) => j.words),
      removed: jobs.reduce((s, j) => s + (j.removed ?? 0), 0),
      errors: jobs.flatMap((j) => j.errors),
      errorMessage: jobs.find((j) => j.errorMessage)?.errorMessage ?? null,
      status,
    };
  }, [jobs]);

  const currentWord = useMemo(() => {
    const active = jobs.find((j) => !isTerminal(j.status));
    if (!active) return null;
    return active.words[active.processed] ?? active.words[active.words.length - 1] ?? null;
  }, [jobs]);

  return (
    <ToastCtx.Provider value={{ show, trackImport }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[330px] max-w-[calc(100vw-2rem)] flex-col gap-2.5">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
      {/* Card-filling tracker: one slim bar, top on a phone and bottom-left on a
          desktop (clear of the tutor). It used to be a card that took a third of a
          phone screen to say "1 / 20". The word list opens from the bar. */}
      {tracker && (() => {
        const running = !isTerminal(tracker.status);
        const title =
          tracker.status === "completed"
            ? t("import.trackDone")
            : tracker.status === "failed"
              ? t("import.trackFailed")
              : tracker.status === "cancelled"
                ? t("import.stoppedTitle")
                : t("import.trackRunning");
        const sub =
          tracker.status === "cancelled"
            ? [t("import.removedN", { n: tracker.removed }), tracker.removed < tracker.total ? t("import.keptReviewed", { n: tracker.total - tracker.removed }) : ""]
                .filter(Boolean)
                .join(" · ")
            : running && tracker.processed === 0
              ? t("import.trackPreparing")
              : [t("import.trackCards", { done: tracker.processed, total: tracker.total }), running && currentWord ? currentWord : ""]
                  .filter(Boolean)
                  .join(" · ");
        return (
          <div className="pointer-events-none fixed inset-x-3 top-3 z-[75] sm:inset-x-auto sm:bottom-4 sm:left-4 sm:top-auto sm:w-[340px]">
            <div className="pointer-events-auto overflow-hidden rounded-[14px] border border-black/[0.08] bg-surface/95 shadow-[0_10px_28px_rgba(46,42,38,0.18)] backdrop-blur">
              <div className="flex items-center gap-2.5 px-3 py-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage-tint text-sage-deep">
                  {running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : tracker.status === "completed" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : tracker.status === "failed" ? (
                    <TriangleAlert className="h-3.5 w-3.5 text-warn-text" />
                  ) : (
                    <Square className="h-3 w-3" />
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setTrackerOpen((v) => !v)}
                  aria-expanded={trackerOpen}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">{title}</span>
                    <span className="block truncate text-[12px] text-ink-soft">{sub}</span>
                  </span>
                  {tracker.status !== "cancelled" && (
                    <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform", trackerOpen && "rotate-180")} />
                  )}
                </button>
                {running && (
                  <button
                    type="button"
                    onClick={() => void stopTracker()}
                    title={t("import.stopHint")}
                    className="shrink-0 rounded-full border border-black/[0.1] px-2.5 py-1 text-[12px] font-semibold text-ink-soft hover:bg-black/[0.04] hover:text-ink"
                  >
                    {t("import.stop")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeTracker}
                  aria-label={t("common.close")}
                  className="shrink-0 rounded-md p-1 text-ink-faint hover:bg-black/[0.05] hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="h-0.5 w-full bg-sage-tint">
                <div
                  className="h-full bg-sage transition-all duration-300"
                  style={{ width: `${tracker.total ? Math.min(100, (tracker.processed / tracker.total) * 100) : 0}%` }}
                />
              </div>
              {trackerOpen && tracker.status !== "cancelled" && (
                <div className="p-2">
                  <div className="rounded-[14px] border border-black/[0.06] bg-paper/80 p-2">
                    {tracker.status === "completed" && (
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-faint">{t("import.trackOpenWord")}</div>
                    )}
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
                        {t("import.enrichFailed", { n: tracker.errors.length })}
                      </div>
                    )}
                    {tracker.errorMessage && (
                      <div className="mt-2 text-[12px] text-warn-text">{tracker.errorMessage}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
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
  // Only real milestone toasts get the celebratory eyebrow; generic toasts (saves,
  // errors, info) show just their title so an error never reads as an achievement.
  const eyebrow = goal ? t("toast.goalLabel") : toast.tone === "achievement" ? t("toast.achievement") : null;
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
            goal || toast.icon.trim() === "⚠️" ? "bg-warn-bg" : "bg-sage-tint"
          }`}
        >
          <ToastIcon icon={toast.icon} />
        </div>
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-faint">{eyebrow}</div>
          )}
          <div className={`truncate font-serif font-semibold leading-tight text-ink ${eyebrow ? "text-[18px]" : "text-[16px]"}`}>
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
