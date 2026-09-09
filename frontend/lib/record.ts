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

export interface Recording {
  /** Stop and resolve with the captured audio (base64 + format for /api/coach/stt). */
  stop(): Promise<{ base64: string; format: string }>;
}

/**
 * Start recording. Resolves `start()` with a controller; `stop()` resolves with
 * the audio, or rejects with "denied" (mic permission) / "fail" / "empty".
 * Recording auto-stops after `maxMs`; the promise from `stop()` still resolves
 * with everything captured up to that point.
 */
export async function startRecording(opts: { maxMs?: number } = {}): Promise<Recording> {
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
  }, maxMs);

  let finishing: Promise<{ base64: string; format: string }> | null = null;
  const finish = () => {
    if (finishing) return finishing;
    finishing = (async () => {
      clearTimeout(autoStop);
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
