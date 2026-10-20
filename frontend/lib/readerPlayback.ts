import { ttsUrl } from "./api";
import { sentences, speechChunks } from "./sentences";
import { claimSpeechPlayer, stopSpeech, unlockSpeech } from "./speak";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error" | "ended";
type Clip = { url: string; bytes: number };
type PlaybackSnapshot = {
  status: PlaybackStatus; index: number; unit: number; total: number; loaded: number;
  rate: number;
  buffering: boolean;
};
const CACHE_BYTES = 24 * 1024 * 1024;
const CACHE_CLIPS = 64;

/** One text's lazy queue. At most the current and next chunk are requested. */
export class ReaderPlayback {
  readonly chunks;
  private snapshot: PlaybackSnapshot;
  private listeners = new Set<() => void>();
  private cache = new Map<number, Clip>();
  private requests = new Map<number, { controller: AbortController; promise: Promise<Clip> }>();
  private element: HTMLAudioElement | null = null;
  private unlocking: Promise<void> = Promise.resolve();
  private generation = 0;
  private disposed = false;
  private readyIndex: number | null = null;
  private playAttempt = 0;

  constructor(text: string, private lang: string, private owner: string) {
    this.chunks = sentences(text).flatMap((s, unit) => speechChunks(s.text)
      .filter(c => c.text.trim()).map(c => ({ ...c, start: s.start + c.start, end: s.start + c.end, unit })));
    this.snapshot = { status: "idle", index: 0, unit: -1, total: this.chunks.length, loaded: 0, rate: 1, buffering: false };
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private update(patch: Partial<PlaybackSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(l => l());
  }
  private abortRequests(keep?: number) {
    for (const [index, { controller }] of this.requests) {
      if (index === keep) continue;
      controller.abort(); this.requests.delete(index);
    }
  }
  private cancelled = () => {
    this.generation++;
    this.abortRequests();
    this.element = null;
    this.readyIndex = null;
    this.update({ status: "idle", index: 0, unit: -1, buffering: false });
  };
  private claim() {
    if (!this.element) {
      const lease = claimSpeechPlayer(this.owner, this.cancelled);
      this.element = lease.element;
      this.unlocking = lease.unlocked;
    }
    return this.element;
  }
  private async clip(index: number): Promise<Clip> {
    const cached = this.cache.get(index);
    if (cached) {
      this.cache.delete(index); this.cache.set(index, cached);
      return cached;
    }
    const pending = this.requests.get(index);
    if (pending) return pending.promise;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 75_000);
    const promise = (async () => {
      const response = await fetch(ttsUrl(this.chunks[index].text, this.lang), {
        credentials: "include", signal: controller.signal,
      });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Audio unavailable");
      const blob = await response.blob();
      if (controller.signal.aborted || this.disposed) throw new Error("Cancelled");
      if (!blob.size) throw new Error("Empty audio");
      const clip = { url: URL.createObjectURL(blob), bytes: blob.size };
      this.cache.set(index, clip);
      let bytes = [...this.cache.values()].reduce((sum, c) => sum + c.bytes, 0);
      for (const [key, old] of this.cache) {
        if (bytes <= CACHE_BYTES && this.cache.size <= CACHE_CLIPS) break;
        if (key === this.snapshot.index || key === index) continue;
        URL.revokeObjectURL(old.url); bytes -= old.bytes; this.cache.delete(key);
      }
      this.update({ loaded: this.cache.size });
      return clip;
    })().finally(() => {
      clearTimeout(timeout);
      if (this.requests.get(index)?.controller === controller) this.requests.delete(index);
    });
    this.requests.set(index, { controller, promise });
    return promise;
  }
  private fail(id: number) {
    if (id !== this.generation || this.disposed) return;
    this.generation++;
    this.abortRequests();
    if (this.element) {
      this.element.onplaying = this.element.onended = this.element.onerror = null;
      this.element.pause();
      this.element.removeAttribute("src"); this.element.load();
    }
    const failed = this.cache.get(this.snapshot.index);
    if (failed) { URL.revokeObjectURL(failed.url); this.cache.delete(this.snapshot.index); }
    this.readyIndex = null;
    this.update({ status: "error", loaded: this.cache.size, buffering: false });
  }
  private async start(el: HTMLAudioElement, id: number) {
    const attempt = ++this.playAttempt;
    try { await el.play(); }
    catch {
      // Pause can reject a pending play promise after a later Resume succeeds.
      if (attempt === this.playAttempt) this.fail(id);
    }
  }
  private async load(index: number, paused = false) {
    const el = this.claim();
    const id = ++this.generation;
    this.abortRequests(index);
    el.onplaying = el.onended = el.onerror = null;
    // Let the gesture's silent primer finish while the first fetch is pending.
    // Cancelling that play immediately leaves iOS's element locked.
    if (this.readyIndex !== null) el.pause();
    this.readyIndex = null;
    this.update({ index, unit: this.chunks[index].unit, status: paused ? "paused" : "loading", buffering: true });
    try {
      const clip = await this.clip(index);
      // Resume during loading can start a newer gesture primer.
      let unlocking: Promise<void>;
      do {
        unlocking = this.unlocking;
        await unlocking;
        if (id !== this.generation || this.disposed) return;
      } while (unlocking !== this.unlocking);
      el.pause();
      el.removeAttribute("src"); el.load();
      el.src = clip.url;
      this.readyIndex = index;
      this.update({ buffering: false });
      el.preservesPitch = true;
      (el as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
      el.playbackRate = this.snapshot.rate;
      el.onplaying = () => {
        if (id !== this.generation) return;
        // A play promise can settle after Pause was tapped.
        if (this.snapshot.status === "paused") { el.pause(); return; }
        this.update({ status: "playing" });
      };
      el.onerror = () => this.fail(id);
      el.onended = () => {
        if (id !== this.generation) return;
        if (index + 1 < this.chunks.length) void this.load(index + 1, this.snapshot.status === "paused");
        else {
          stopSpeech(this.owner);
          this.update({ status: "ended", index, unit: this.chunks[index].unit });
        }
      };
      if (index + 1 < this.chunks.length) void this.clip(index + 1).catch(() => {});
      if (this.snapshot.status !== "paused") {
        await this.start(el, id);
      }
    } catch {
      this.fail(id);
    }
  }
  play = () => {
    if (this.disposed || !this.chunks.length) return;
    if (this.snapshot.status === "paused" && this.element) {
      this.update({ status: "loading" });
      // Loading may still be in progress; its continuation will start playback.
      if (this.readyIndex !== this.snapshot.index) {
        this.unlocking = unlockSpeech(this.owner) ?? this.unlocking;
        return;
      }
      const id = this.generation;
      void this.start(this.element, id);
      return;
    }
    this.claim();
    void this.load(this.snapshot.status === "ended" ? 0 : this.snapshot.index);
  };
  pause = () => {
    if (!["loading", "playing"].includes(this.snapshot.status)) return;
    this.playAttempt++;
    this.element?.pause();
    this.update({ status: "paused" });
  };
  stop = () => {
    if (this.element) stopSpeech(this.owner);
    else this.cancelled();
  };
  seek = (index: number) => {
    if (this.disposed || !this.chunks.length) return;
    index = Math.max(0, Math.min(this.chunks.length - 1, Math.round(index)));
    const paused = !["loading", "playing"].includes(this.snapshot.status);
    void this.load(index, paused);
  };
  setRate = (rate: number) => {
    if (![0.75, 1, 1.25, 1.5].includes(rate)) return;
    this.update({ rate });
    if (this.element) this.element.playbackRate = rate;
  };
  dispose = () => {
    this.stop();
    this.disposed = true;
    for (const clip of this.cache.values()) URL.revokeObjectURL(clip.url);
    this.cache.clear();
    this.update({ loaded: 0 });
  };
  activate = () => { this.disposed = false; };
}
