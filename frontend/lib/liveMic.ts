// Near-live mic capture for the Reader's read-aloud highlighting.
//
// getUserMedia → AudioContext → raw Float32 PCM, downsampled to 16 kHz mono and
// chopped into ~2.5 s WAV clips. Each clip is handed to the caller, which posts it
// to the existing /api/coach/stt (qwen3-asr-flash) and grows the live transcript.
//
// This is the "works everywhere" path: unlike the browser's Web Speech recogniser
// (lib/dictation.ts) it never routes audio to Google, so it runs on iOS Safari and
// in mainland China too. Silent clips are dropped by a cheap RMS gate so pauses
// don't burn ASR seconds. A hard session cap auto-stops a forgotten mic.

export interface LiveMicController {
  stop(): void;
}

export interface LiveMicOptions {
  /** MAX milliseconds of audio per emitted clip (default 3500). */
  chunkMs?: number;
  /** Minimum clip length before a pause may cut it (default 1000 ms). */
  minChunkMs?: number;
  /** Trailing silence that marks a natural phrase end and cuts the clip (default 320 ms). */
  pauseMs?: number;
  /** RMS below which a frame counts as silence (default 0.012). */
  vadThreshold?: number;
  /** Hard session cap, then auto-stop (default 180000 ms). */
  maxMs?: number;
  /** Each non-silent clip: base64 WAV (16 kHz mono PCM16) + its length in seconds. */
  onChunk: (wavBase64: string, seconds: number) => void;
  /** Live input level 0..1, throttled to ~10 Hz (for a meter). */
  onLevel?: (level: number) => void;
  /** Mic permission denied / no capture API / fatal failure. */
  onError?: (kind: "denied" | "unsupported" | "fail") => void;
  /** Fired when the session hit maxMs and stopped itself. */
  onAutoStop?: () => void;
}

const TARGET_RATE = 16000;

export function liveMicSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== "undefined" &&
    !!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)
  );
}

function getAudioContext(): AudioContext | null {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

function concat(buffers: Float32Array[]): Float32Array {
  let total = 0;
  for (const b of buffers) total += b.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const b of buffers) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// Average-decimate to the target rate (good enough for ASR; avoids aliasing noise).
function downsample(input: Float32Array, srcRate: number): Float32Array {
  if (srcRate === TARGET_RATE) return input;
  const ratio = srcRate / TARGET_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

const WORKLET_SRC = `
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}
registerProcessor('onomika-pcm', PCMProcessor);
`;

/**
 * Start near-live capture. Resolves with a controller, or calls onError and resolves
 * null if the mic is unavailable/denied. `stop()` ends capture and releases the mic.
 */
export async function startLiveMic(opts: LiveMicOptions): Promise<LiveMicController | null> {
  if (!liveMicSupported()) {
    opts.onError?.("unsupported");
    return null;
  }
  const chunkMs = opts.chunkMs ?? 3500;
  const minChunkMs = opts.minChunkMs ?? 1000;
  const pauseMs = opts.pauseMs ?? 320;
  const vadThreshold = opts.vadThreshold ?? 0.012;
  const maxMs = opts.maxMs ?? 180000;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    opts.onError?.(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "fail");
    return null;
  }

  const ctx = getAudioContext();
  if (!ctx) {
    stream.getTracks().forEach((t) => t.stop());
    opts.onError?.("unsupported");
    return null;
  }
  void ctx.resume?.();

  const srcRate = ctx.sampleRate;
  const maxSamples = Math.max(1, Math.floor((srcRate * chunkMs) / 1000));
  const minSamples = Math.max(1, Math.floor((srcRate * minChunkMs) / 1000));
  const pauseSamples = Math.max(1, Math.floor((srcRate * pauseMs) / 1000));
  const source = ctx.createMediaStreamSource(stream);

  let buffers: Float32Array[] = [];
  let bufSamples = 0;
  let silenceSamples = 0; // trailing quiet frames; a long enough run = phrase end
  let stopped = false;
  let lastLevelAt = 0;
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let workletNode: any = null;
  let scriptNode: ScriptProcessorNode | null = null;

  function emitLevel(samples: Float32Array) {
    if (!opts.onLevel) return;
    const now = Date.now();
    if (now - lastLevelAt < 100) return;
    lastLevelAt = now;
    opts.onLevel(Math.min(1, rms(samples) * 5));
  }

  function flush() {
    if (!bufSamples) return;
    const frame = concat(buffers);
    buffers = [];
    bufSamples = 0;
    const level = rms(frame);
    if (level < vadThreshold) return; // silence — skip, don't spend an ASR call
    const ds = downsample(frame, srcRate);
    if (!ds.length) return;
    const wav = toBase64(encodeWav(ds, TARGET_RATE));
    opts.onChunk(wav, ds.length / TARGET_RATE);
  }

  function push(frame: Float32Array) {
    if (stopped || !frame.length) return;
    emitLevel(frame);
    buffers.push(frame);
    bufSamples += frame.length;
    // Cut on a natural pause (not a fixed timer) so clip boundaries land between
    // phrases — that keeps the ASR's own punctuation aligned with real sentence
    // ends instead of sprinkling periods mid-sentence.
    silenceSamples = rms(frame) < vadThreshold ? silenceSamples + frame.length : 0;
    const endedOnPause = bufSamples >= minSamples && silenceSamples >= pauseSamples;
    if (bufSamples >= maxSamples || endedOnPause) {
      silenceSamples = 0;
      flush();
    }
  }

  function cleanup() {
    if (stopped) return;
    stopped = true;
    if (autoStopTimer) clearTimeout(autoStopTimer);
    try {
      workletNode?.port?.close?.();
      workletNode?.disconnect?.();
    } catch {
      /* ignore */
    }
    try {
      if (scriptNode) {
        scriptNode.onaudioprocess = null;
        scriptNode.disconnect();
      }
    } catch {
      /* ignore */
    }
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close?.();
  }

  const controller: LiveMicController = {
    stop() {
      cleanup();
    },
  };

  autoStopTimer = setTimeout(() => {
    const had = bufSamples > 0;
    if (had) flush(); // don't lose the trailing partial clip
    cleanup();
    opts.onLevel?.(0);
    opts.onAutoStop?.();
  }, maxMs);

  // Prefer an AudioWorklet (off the main thread); register its processor from an
  // inline Blob URL so there's no extra public file. Fall back to the deprecated
  // (but universally supported) ScriptProcessorNode if worklets are unavailable.
  try {
    if (ctx.audioWorklet) {
      const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      workletNode = new AudioWorkletNode(ctx, "onomika-pcm", { numberOfOutputs: 0 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workletNode.port.onmessage = (e: any) => push(e.data as Float32Array);
      source.connect(workletNode);
      return controller;
    }
  } catch {
    /* fall through to ScriptProcessor */
  }

  try {
    scriptNode = ctx.createScriptProcessor(4096, 1, 1);
    scriptNode.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      push(new Float32Array(data));
    };
    source.connect(scriptNode);
    scriptNode.connect(ctx.destination); // some browsers need it connected to fire
    return controller;
  } catch {
    cleanup();
    opts.onError?.("fail");
    return null;
  }
}
