import OpenAI from "openai";
import type { ZodSchema } from "zod";
import { env } from "../lib/env.js";
import { langName } from "../lib/langs.js";
import { createSayExtractor } from "../lib/sayStream.js";
import { prisma } from "./db.js";
import { currentUserId } from "../lib/usageContext.js";

// Qwen on Alibaba Bailian speaks the OpenAI Chat Completions protocol via its
// "compatible-mode" endpoint, so we reuse the official OpenAI SDK and just point
// its baseURL at Bailian. No Qwen-specific client needed.
//
// Built lazily: the OpenAI constructor throws if the key is empty, so we must
// not construct it at import time (that would crash the server before any key
// is configured). Memoized so we still reuse one client across calls.
let client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!env.BAILIAN_API_KEY) {
    throw new Error("BAILIAN_API_KEY is not set — add it to backend/.env");
  }
  client ??= new OpenAI({
    apiKey: env.BAILIAN_API_KEY,
    baseURL: env.BAILIAN_BASE_URL,
    timeout: 60_000, // generous enough for larger generations; a dead network
    maxRetries: 1, // still fails fast via undici's ~10s connect timeout

  });
  return client;
}

// Turn low-level SDK connection failures into a message the UI can show, instead
// of a raw "Request timed out." that hides what actually went wrong.
function friendlyLlmError(err: unknown): Error {
  // The SDK error classes don't set `.name`, so match on the constructor name
  // (and the message) to catch connection/timeout failures reliably.
  const ctor = (err as { constructor?: { name?: string } })?.constructor?.name ?? "";
  const msg = (err as { message?: string })?.message ?? "";
  const status = (err as { status?: number })?.status;

  if (status === 401) {
    return new Error("The Bailian API key was rejected (401). Check BAILIAN_API_KEY and the matching endpoint region.");
  }
  if (
    ctor.includes("APIConnection") ||
    /timed out|timeout|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg)
  ) {
    return new Error(
      "The AI service (Qwen/Bailian) is unreachable right now. Check your network or the BAILIAN_BASE_URL endpoint and try again.",
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

// qwen-plus: good quality/cost balance for sentence selection + translation.
const MODEL = "qwen-plus";

// qwen-flash: cheaper/faster tier for trivial calls (gloss, translate, transcribe,
// suggest, lang-check, coach-memory, tutor dictionary). Env override lets us roll
// back to qwen-plus instantly without a code change.
export const FAST_MODEL = process.env.BAILIAN_FAST_MODEL || "qwen-flash";

// Log per-call token usage so we can compare prompt strategies (combined vs
// separate) with real numbers, AND persist a row so the owner admin dashboard can
// show real spend by day/feature/model. Bailian returns OpenAI-style `usage`.
// `cached` comes from prompt_tokens_details.cached_tokens on implicit-cache hits;
// `ms` is wall-clock latency around the create() call.
//
// The DB write is fire-and-forget: usage logging must never block or break the
// request, so it is not awaited and swallows its own errors.
function logUsage(
  label: string,
  model: string,
  kind: "text" | "ocr" | "asr",
  completion: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } },
  ms: number,
) {
  const u = completion.usage;
  if (!u) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cached = (u as any).prompt_tokens_details?.cached_tokens as number | undefined;
  const cachedStr = cached ? ` cached=${cached}` : "";
  console.log(`[llm usage] ${label} in=${u.prompt_tokens ?? "?"} out=${u.completion_tokens ?? "?"} total=${u.total_tokens ?? "?"}${cachedStr} ms=${ms}`);
  const feature = label.replace(/\.stream$/, "");
  void prisma.tokenUsage
    .create({
      data: {
        feature,
        model,
        kind,
        promptTokens: u.prompt_tokens ?? 0,
        completionTokens: u.completion_tokens ?? 0,
        totalTokens: u.total_tokens ?? 0,
        cachedTokens: cached ?? 0,
        ms,
        telegramId: currentUserId(),
      },
    })
    .catch(() => {});
}

/**
 * Single reusable LLM call that returns validated JSON.
 * Asks the model for a JSON object, parses it, and validates it against `schema`
 * so a malformed response throws here instead of poisoning the database.
 */
export async function chatJson<T>(opts: {
  system: string;
  user: string;
  schema: ZodSchema<T>;
  // Optional per-call timeout override (ms). Bulk import can produce a large
  // array of cards that takes longer than a single-word lookup.
  timeoutMs?: number;
  label?: string; // for token-usage logging
  model?: string; // override MODEL (e.g. FAST_MODEL for trivial calls)
}): Promise<T> {
  let completion;
  const t0 = Date.now();
  try {
    completion = await getClient().chat.completions.create(
      {
        model: opts.model ?? MODEL,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      },
      opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
    );
  } catch (err) {
    throw friendlyLlmError(err);
  }
  logUsage(opts.label ?? "chatJson", opts.model ?? MODEL, "text", completion, Date.now() - t0);

  const raw = completion.choices[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM did not return valid JSON: ${raw.slice(0, 200)}`);
  }
  return opts.schema.parse(parsed);
}

// Qwen-VL (vision) model for OCR. Configurable per deployment/region.
const VISION_MODEL = process.env.BAILIAN_VISION_MODEL || "qwen-vl-plus";

/**
 * Extract readable text from an image (OCR) using a Qwen vision model. Used by
 * the Reader's "scan a photo" flow. `dataUrl` is a base64 data: URI.
 */
export async function ocrImage(opts: { dataUrl: string; sourceLang?: string }): Promise<string> {
  const langHint = opts.sourceLang && opts.sourceLang !== "auto" ? ` The text is mostly in ${langName(opts.sourceLang)}.` : "";
  let completion;
  const t0 = Date.now();
  try {
    completion = await getClient().chat.completions.create(
      {
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `Read ALL the text in this image and return it verbatim, preserving reading order ` +
                  `and line breaks. The text may be HANDWRITTEN — read the handwriting as best you can, ` +
                  `keeping a word-list layout (one entry per line, and any "word — translation" pairs) ` +
                  `intact. Do not translate, summarize, or add any commentary — output only the text ` +
                  `found in the image.${langHint}`,
              },
              { type: "image_url", image_url: { url: opts.dataUrl } },
            ],
          },
        ],
        temperature: 0,
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    throw friendlyLlmError(err);
  }
  logUsage("ocr", VISION_MODEL, "ocr", completion, Date.now() - t0);
  return (completion.choices[0]?.message?.content ?? "").trim();
}

// Qwen audio model for speech-to-text (Telegram voice answers, Reader read-aloud).
// "qwen-audio-asr" was retired on the Beijing endpoint (404); qwen3-asr-flash is the
// documented non-realtime ASR model that accepts OpenAI-compatible `input_audio`.
const AUDIO_MODEL = process.env.BAILIAN_AUDIO_MODEL || "qwen3-asr-flash";

/**
 * Transcribe a short voice clip to text via a Qwen audio model (OpenAI-compatible
 * `input_audio` content). Best-effort: returns "" on any failure so the caller can
 * fall back to asking the learner to type. Telegram voice is OGG/Opus.
 */
export async function transcribeAudio(opts: { base64: string; format?: string; sourceLang?: string }): Promise<string> {
  const format = opts.format || "ogg";
  // qwen3-asr-flash auto-detects language and can guess wrong (e.g. returns Cyrillic for
  // English speech). Pin it with asr_options.language when the caller knows the language.
  const language = opts.sourceLang && opts.sourceLang !== "auto" ? opts.sourceLang : undefined;
  try {
    // qwen3-asr-flash is a dedicated ASR task: it wants ONLY the audio part — a text
    // prompt or an explicit `format` field makes it reject the request. The mediatype
    // in the data URI carries the format.
    // The installed OpenAI types don't model `input_audio`/`asr_options` yet, hence the loose cast.
    const content = [{ type: "input_audio", input_audio: { data: `data:audio/${format};base64,${opts.base64}` } }];
    // Docs: a system message provides context to qwen3-asr-flash. asr_options.language
    // alone was ignored in testing, so state the language in the system message too.
    const messages = language
      ? [
          { role: "system", content: [{ type: "text", text: `The speech is in ${langName(language)}. Transcribe it in ${langName(language)}.` }] },
          { role: "user", content },
        ]
      : [{ role: "user", content }];
    const t0 = Date.now();
    const completion = await getClient().chat.completions.create(
      {
        model: AUDIO_MODEL,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
        temperature: 0,
        ...(language ? { asr_options: { language } } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      { timeout: 45_000 },
    );
    logUsage("asr", AUDIO_MODEL, "asr", completion, Date.now() - t0);
    return (completion.choices[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("transcribeAudio failed:", (err as Error).message);
    return "";
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Multi-turn chat that returns validated JSON (used by the actionable tutor). */
export async function chatJsonConversation<T>(opts: {
  messages: ChatMessage[];
  schema: ZodSchema<T>;
  timeoutMs?: number;
  label?: string;
  model?: string; // override MODEL (e.g. FAST_MODEL for trivial calls)
}): Promise<T> {
  let completion;
  const t0 = Date.now();
  try {
    completion = await getClient().chat.completions.create(
      {
        model: opts.model ?? MODEL,
        messages: opts.messages,
        response_format: { type: "json_object" },
        temperature: 0.4,
      },
      opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
    );
  } catch (err) {
    throw friendlyLlmError(err);
  }
  logUsage(opts.label ?? "chatJsonConversation", opts.model ?? MODEL, "text", completion, Date.now() - t0);
  const raw = completion.choices[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM did not return valid JSON: ${raw.slice(0, 200)}`);
  }
  return opts.schema.parse(parsed);
}

/**
 * Streaming variant of chatJsonConversation: forwards the live text of the "say"
 * key via `onDelta` as the model generates it, then parses + validates the full
 * JSON exactly like the non-streaming path. Used by the coach chat/scene NDJSON
 * endpoints so the reply types out instead of arriving as one blob.
 *
 * Aborts (client disconnect) are rethrown as an error whose `name` is "AbortError"
 * so the route can swallow them silently. `final` is never unvalidated: if the
 * stream completes but the JSON is malformed/off-schema, this throws like chatJson.
 */
export async function chatJsonConversationStream<T>(opts: {
  messages: ChatMessage[];
  schema: ZodSchema<T>;
  onDelta: (chunk: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  label?: string;
  model?: string;
}): Promise<T> {
  const extractor = createSayExtractor(opts.onDelta);
  let raw = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let usage: any;
  const t0 = Date.now();

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  try {
    stream = await getClient().chat.completions.create(
      {
        model: opts.model ?? MODEL,
        messages: opts.messages,
        response_format: { type: "json_object" },
        temperature: 0.4,
        stream: true,
        stream_options: { include_usage: true },
      },
      {
        ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    );
  } catch (err) {
    if (opts.signal?.aborted) throw abortError();
    throw friendlyLlmError(err);
  }

  try {
    for await (const chunk of stream) {
      if (opts.signal?.aborted) break;
      const piece = chunk.choices?.[0]?.delta?.content;
      if (piece) {
        raw += piece;
        extractor.push(raw);
      }
      // With include_usage, Bailian sends usage on a final chunk with empty choices.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((chunk as any).usage) usage = (chunk as any).usage;
    }
  } catch (err) {
    if (opts.signal?.aborted) throw abortError();
    throw friendlyLlmError(err);
  }

  if (opts.signal?.aborted) throw abortError();

  logUsage(opts.label ?? "chatJsonConversationStream", opts.model ?? MODEL, "text", { usage }, Date.now() - t0);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM did not return valid JSON: ${raw.slice(0, 200)}`);
  }
  return opts.schema.parse(parsed);
}

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

/**
 * Free-form multi-turn chat that returns plain text (no JSON schema). Used by the
 * word "ask a follow-up" mini-chat, where the answer is prose, not structured.
 */
export async function chatText(opts: { messages: ChatMessage[]; timeoutMs?: number }): Promise<string> {
  let completion;
  try {
    completion = await getClient().chat.completions.create(
      {
        model: MODEL,
        messages: opts.messages,
        temperature: 0.4,
      },
      opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
    );
  } catch (err) {
    throw friendlyLlmError(err);
  }
  return (completion.choices[0]?.message?.content ?? "").trim();
}
