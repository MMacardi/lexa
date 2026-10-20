"use client";

import { useSyncExternalStore } from "react";
import { Headphones, Loader2, LocateFixed, Pause, Play, RotateCcw, Square } from "lucide-react";
import { ReaderPlayback } from "@/lib/readerPlayback";
import { useI18n } from "@/lib/i18n";

export function ReaderListeningPlayer({ playback, locate }: { playback: ReaderPlayback; locate: () => void }) {
  const { t } = useI18n();
  const s = useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
  if (!s.total) return null;
  const active = s.status === "playing" || s.status === "loading";
  const playLabel = t(active ? "listen.pause" : s.status === "error" ? "listen.retry" : s.status === "ended" ? "listen.replay" : s.status === "paused" ? "listen.resume" : "listen.play");
  return <section aria-label={t("listen.title")} aria-busy={s.buffering} data-reader-player data-playback-state={s.status}
    className="rounded-2xl border border-sage/20 bg-surface p-3 shadow-sm">
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-auto inline-flex items-center gap-1.5 text-sm font-semibold text-sage-deep"><Headphones className="h-4 w-4" />{t("listen.title")}</span>
      <button type="button" aria-label={playLabel} onClick={active ? playback.pause : playback.play}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-sage-tint px-3 text-xs font-semibold text-sage-deep">
        {s.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : active ? <Pause className="h-4 w-4" /> : s.status === "ended" ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        {playLabel}
      </button>
      <button type="button" aria-label={t("listen.stop")} onClick={playback.stop} disabled={s.status === "idle"}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-paper disabled:opacity-40"><Square className="h-4 w-4" /></button>
      <label className="text-xs text-ink-muted"><span className="sr-only">{t("listen.speed")}</span>
        <select aria-label={t("listen.speed")} value={s.rate} onChange={e => playback.setRate(Number(e.target.value))}
          className="min-h-10 rounded-lg border border-black/10 bg-surface px-1 font-semibold text-ink">
          {[0.75, 1, 1.25, 1.5].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
      </label>
    </div>
    <div className="mt-2 flex items-center gap-2">
      <input type="range" min={1} max={s.total} step={1} value={s.index + 1}
        aria-label={t("listen.seek")} aria-valuetext={t("listen.position", { n: s.index + 1, total: s.total })}
        onChange={e => playback.seek(Number(e.target.value) - 1)} className="h-7 min-w-0 flex-1 accent-sage" />
      <span className="shrink-0 text-xs tabular-nums text-ink-muted">{s.index + 1} / {s.total}</span>
      <button type="button" aria-label={t("listen.locate")} onClick={locate} disabled={s.unit < 0}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sage-deep hover:bg-sage-tint disabled:opacity-40"><LocateFixed className="h-4 w-4" /></button>
    </div>
    <p className="text-xs text-ink-faint" role="status">{s.status === "error" ? t("listen.error") : s.buffering || s.status === "loading" ? t("listen.loading") : s.status === "ended" ? t("listen.ended") : t("listen.position", { n: s.index + 1, total: s.total })}</p>
    <p className="mt-0.5 text-[11px] text-ink-faint">{t("listen.loaded", { n: s.loaded, total: s.total })}</p>
  </section>;
}
