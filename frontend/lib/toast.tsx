"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, type ImportJob, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import {
  TriangleAlert, Sprout, Folders, BookOpen, Target, Languages, WifiOff,
  PenLine, Library, FileText, Save, Home, Layers, Sparkles, Bell, PartyPopper,
  Trophy, UserPlus, Trash2, type LucideIcon,
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
  // Several imports can run at once (e.g. add 3 cards, then add 1 more while they
  // enrich). We keep every active job and show ONE combined tracker so the count
  // stays correct (0/4, not 0/1 when the second job would overwrite the first).
  const [jobs, setJobs] = useState<ImportTracker[]>([]);
  // Once enrichment finishes, resolve the enriched words → their card ids so the
  // list in the toast is clickable (opens the freshly-made word page).
  const [wordIds, setWordIds] = useState<Record<string, string>>({});
  const mappedRef = useRef<Set<string>>(new Set()); // jobIds whose words we've resolved
  const [trackerMin, setTrackerMin] = useState(false); // collapsed to a small pill
  const closeTracker = useCallback(() => setJobs([]), []);

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

  const isTerminal = (s: ImportJob["status"]) => s === "completed" || s === "failed";

  const trackImport = useCallback((payload: Omit<ImportTracker, "status" | "errors" | "errorMessage">) => {
    setTrackerMin(false);
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
    const done = jobs.filter((j) => j.status === "completed" && !mappedRef.current.has(j.jobId));
    if (done.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const list: Word[] = await api.listWords(accountId);
        if (cancelled) return;
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
  }, [jobs, accountId]);

  // One combined view across all active jobs (correct totals when several run).
  const tracker = useMemo(() => {
    if (jobs.length === 0) return null;
    const allTerminal = jobs.every((j) => isTerminal(j.status));
    const status: ImportJob["status"] = allTerminal
      ? jobs.every((j) => j.status === "failed")
        ? "failed"
        : "completed"
      : jobs.some((j) => j.status === "processing")
        ? "processing"
        : "queued";
    return {
      total: jobs.reduce((s, j) => s + j.total, 0),
      processed: jobs.reduce((s, j) => s + j.processed, 0),
      words: jobs.flatMap((j) => j.words),
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
      {/* AI-enrichment tracker — top on mobile, bottom-LEFT on desktop, so it never
          overlaps the bottom-right tutor. Collapsible to a pill and dismissible. */}
      {tracker && trackerMin && (
        <div className="fixed left-4 top-4 z-[75] sm:bottom-4 sm:left-4 sm:top-auto">
          <button
            type="button"
            onClick={() => setTrackerMin(false)}
            className="flex items-center gap-2 rounded-full border border-black/[0.08] bg-surface px-3 py-2 shadow-[0_10px_28px_rgba(46,42,38,0.2)]"
          >
            <span className="text-[15px]">{tracker.status === "completed" ? "✓" : tracker.status === "failed" ? "!" : "…"}</span>
            <span className="text-[13px] font-semibold text-ink">
              {tracker.processed} / {tracker.total}
            </span>
          </button>
        </div>
      )}
      {tracker && !trackerMin && (
        <div className="pointer-events-none fixed inset-x-4 top-4 z-[75] max-w-[calc(100vw-2rem)] sm:inset-x-auto sm:bottom-4 sm:left-4 sm:top-auto sm:w-[360px]">
          <div className="group pointer-events-auto overflow-hidden rounded-[18px] border border-black/[0.08] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.22)]">
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Lexa</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setTrackerMin(true)}
                  aria-label="Minimize"
                  className="rounded-md px-1.5 py-0.5 text-ink-faint hover:bg-black/[0.05] hover:text-ink"
                >
                  –
                </button>
                <button
                  type="button"
                  onClick={closeTracker}
                  aria-label="Close"
                  className="rounded-md px-1.5 py-0.5 text-ink-faint hover:bg-black/[0.05] hover:text-ink"
                >
                  ✕
                </button>
              </div>
            </div>
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
                    onClick={closeTracker}
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
