// Mic recording via getUserMedia + MediaRecorder, for pronunciation checks that
// go through OUR server STT (qwen-audio-asr) instead of the browser's Web Speech
// recogniser. Unlike the recogniser, this path works in mainland China (audio
// never touches Google) and in any modern mobile browser, iOS Safari included.

export function recorderSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined"
  );
}

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return ""; // let the browser choose its default
}

// "audio/webm;codecs=opus" → "webm" (the backend forwards it to the ASR model).
function formatOf(mime: string, fallback = "webm"): string {
  const m = /^audio\/(\w+)/.exec(mime);
  return m ? m[1] : fallback;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Ends a take on the speaker's own pause instead of a second tap: speech, then
// `silenceMs` of quiet, calls `onSilence` (as does `noSpeechMs` with no speech at
// all). The room's own level over the first quarter second sets what counts as
// speech. Returns the teardown. Where Web Audio is missing, it simply never fires
// and the tap (or maxMs) ends the take as before.
function watchSilence(stream: MediaStream, silenceMs: number, noSpeechMs: number, onSilence: () => void): () => void {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return () => {};
  let ctx: AudioContext;
  try {
    ctx = new AC();
  } catch {
    return () => {};
  }
  void ctx.resume?.().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const meter = ctx.createAnalyser();
  meter.fftSize = 1024;
  src.connect(meter);
  const buf = new Float32Array(meter.fftSize);
  const began = performance.now();
  let floor = 0.01;
  let spoke = false;
  let quietSince = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(tick);
    src.disconnect();
    void ctx.close().catch(() => {});
  };
  const tick = window.setInterval(() => {
    meter.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const level = Math.sqrt(sum / buf.length);
    const now = performance.now();
    // Capped, so a word said the instant the mic opens isn't taken for the room.
    if (now - began < 250) {
      floor = Math.min(0.03, Math.max(floor, level));
      return;
    }
    if (level > Math.max(0.015, floor * 2.5)) {
      spoke = true;
      quietSince = 0;
    } else if (spoke) {
      quietSince ||= now;
      if (now - quietSince < silenceMs) return;
      stop();
      onSilence();
    } else if (now - began >= noSpeechMs) {
      stop();
      onSilence();
    }
  }, 50);
  return stop;
}

export interface Recording {
  /** Stop and resolve with the captured audio (base64 + format for /api/coach/stt). */
  stop(): Promise<{ base64: string; format: string }>;
}

/**
 * Start recording. Resolves `start()` with a controller; `stop()` resolves with
 * the audio, or rejects with "denied" (mic permission) / "fail" / "empty".
 * Recording auto-stops after `maxMs`, or after `silenceMs` of quiet once the
 * speaker has spoken; either way `onAutoStop` tells the caller to collect it with
 * `stop()`, which resolves with everything captured up to that point.
 */
export async function startRecording(
  opts: { maxMs?: number; silenceMs?: number; noSpeechMs?: number; onAutoStop?: () => void } = {},
): Promise<Recording> {
  const maxMs = opts.maxMs ?? 20000;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((e) => {
    throw new Error(e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "denied" : "fail");
  });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  // Auto-stop resolves the same promise a manual stop() waits on, so a later
  // stop() call still returns everything captured up to the auto-stop.
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });
  rec.start();
  const autoStop = setTimeout(() => {
    if (rec.state !== "inactive") rec.stop();
    opts.onAutoStop?.();
  }, maxMs);
  const unwatch = opts.silenceMs
    ? watchSilence(stream, opts.silenceMs, opts.noSpeechMs ?? maxMs, () => opts.onAutoStop?.())
    : () => {};

  let finishing: Promise<{ base64: string; format: string }> | null = null;
  const finish = () => {
    if (finishing) return finishing;
    finishing = (async () => {
      clearTimeout(autoStop);
      unwatch();
      if (rec.state !== "inactive") rec.stop();
      await stopped;
      stream.getTracks().forEach((tr) => tr.stop());
      if (!chunks.length) throw new Error("empty");
      const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
      const base64 = toBase64(await blob.arrayBuffer());
      if (!base64) throw new Error("empty");
      return { base64, format: formatOf(rec.mimeType || mime) };
    })();
    return finishing;
  };
  return { stop: finish };
}
