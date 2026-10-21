"use client";

import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Headphones, Loader2, LocateFixed, Pause, Play, RotateCcw, Square, X } from "lucide-react";
import { ReaderPlayback } from "@/lib/readerPlayback";
import { useI18n } from "@/lib/i18n";
import { HoverTip } from "@/components/ui/HoverTip";
import { Select } from "@/components/ui/Select";

export function ReaderListeningPlayer({ playback, locate }: { playback: ReaderPlayback; locate: () => void }) {
  const { t } = useI18n();
  const s = useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (!open && restoreFocus.current) {
      triggerRef.current?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  }, [open]);
  if (!s.total) return null;
  const active = s.status === "playing" || s.status === "loading";
  const playLabel = t(active ? "listen.pause" : s.status === "error" ? "listen.retry" : s.status === "ended" ? "listen.replay" : s.status === "paused" ? "listen.resume" : "listen.play");
  const collapse = () => {
    restoreFocus.current = true;
    setOpen(false);
  };
  return <div data-reader-player data-playback-state={s.status} className="flex justify-end font-sans text-sm leading-normal">
    {!open && <button ref={triggerRef} type="button" aria-label={t("listen.title")} aria-expanded={false} aria-controls={panelId}
      onClick={() => setOpen(true)}
      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-sage/20 bg-surface px-3.5 text-xs font-semibold text-sage-deep shadow-sm transition-colors hover:bg-sage-tint focus-visible:outline-2 focus-visible:outline-sage">
      {s.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Headphones className="h-4 w-4" />}
      {t("listen.title")}
      {s.status !== "idle" && <span className="border-l border-sage/20 pl-2 tabular-nums text-ink-muted">{s.index + 1}/{s.total}</span>}
    </button>}
    {open && <section id={panelId} aria-label={t("listen.title")} aria-busy={s.buffering}
      onKeyDown={e => { if (e.key === "Escape" && !(e.target as Element).closest("[data-reader-speed]")) { e.stopPropagation(); collapse(); } }}
      className="anim-fade-up max-h-[calc(100dvh-200px)] w-full max-w-[360px] overflow-y-auto rounded-2xl border border-sage/20 bg-surface p-3 shadow-[0_8px_28px_rgba(46,42,38,0.14)] md:max-h-[calc(100dvh-48px)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sage-deep"><Headphones className="h-4 w-4" />{t("listen.title")}</span>
        <HoverTip title={t("listen.collapse")} className="inline-flex">
          <button type="button" aria-label={t("listen.collapse")} onClick={collapse}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-paper"><X className="h-4 w-4" /></button>
        </HoverTip>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" autoFocus aria-label={playLabel} onClick={active ? playback.pause : playback.play}
          className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-sage-tint px-3 text-xs font-semibold text-sage-deep">
          {s.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : active ? <Pause className="h-4 w-4" /> : s.status === "ended" ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {playLabel}
        </button>
        <HoverTip title={t("listen.stop")} className="inline-flex">
          <button type="button" aria-label={t("listen.stop")} onClick={playback.stop} disabled={s.status === "idle"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-paper disabled:opacity-40"><Square className="h-4 w-4" /></button>
        </HoverTip>
        <div data-reader-speed>
          <Select ariaLabel={t("listen.speed")} value={String(s.rate)} onChange={value => playback.setRate(Number(value))}
            options={[0.75, 1, 1.25, 1.5].map(rate => ({ value: String(rate), label: `${rate}×` }))}
            menuMinWidth={112} className="w-[76px] [&_button]:min-h-10" />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input type="range" min={1} max={s.total} step={1} value={s.index + 1}
          aria-label={t("listen.seek")} aria-valuetext={t("listen.position", { n: s.index + 1, total: s.total })}
          onChange={e => playback.seek(Number(e.target.value) - 1)} className="h-8 min-w-0 flex-1 accent-sage" />
        <span className="shrink-0 text-xs tabular-nums text-ink-muted">{s.index + 1} / {s.total}</span>
      </div>
      <p className="text-xs text-ink-muted" role="status">{s.status === "error" ? t("listen.error") : s.buffering || s.status === "loading" ? t("listen.loading") : s.status === "ended" ? t("listen.ended") : t("listen.position", { n: s.index + 1, total: s.total })}</p>
      {s.status !== "idle" && <p className="mt-1 text-[11px] text-ink-faint">{t("listen.loaded", { n: s.loaded, total: s.total })}</p>}
      <HoverTip title={t("listen.locate")} subtitle={t("listen.locateHint")} className="mt-1 inline-flex">
        <button type="button" aria-label={t("listen.locate")} aria-describedby={`${panelId}-locate`} onClick={locate} disabled={s.unit < 0}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-sage-deep hover:bg-sage-tint disabled:opacity-40"><LocateFixed className="h-4 w-4" />{t("listen.locate")}</button>
      </HoverTip>
      <span id={`${panelId}-locate`} className="sr-only">{t("listen.locateHint")}</span>
    </section>}
  </div>;
}
