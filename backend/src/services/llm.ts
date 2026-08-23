import OpenAI from "openai";
import type { ZodSchema } from "zod";
import { env } from "../lib/env.js";
import { langName } from "../lib/langs.js";

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

// Log per-call token usage so we can compare prompt strategies (combined vs
// separate) with real numbers. Bailian returns OpenAI-style `usage`.
function logUsage(label: string, completion: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }) {
  const u = completion.usage;
  if (!u) return;
  console.log(`[llm usage] ${label} in=${u.prompt_tokens ?? "?"} out=${u.completion_tokens ?? "?"} total=${u.total_tokens ?? "?"}`);
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
}): Promise<T> {
  let completion;
  try {
    completion = await getClient().chat.completions.create(
      {
        model: MODEL,
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
  logUsage(opts.label ?? "chatJson", completion);

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
                  `and line breaks. Do not translate, summarize, or add any commentary — output only ` +
                  `the text found in the image.${langHint}`,
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
  return (completion.choices[0]?.message?.content ?? "").trim();
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Multi-turn chat that returns validated JSON (used by the actionable tutor). */
export async function chatJsonConversation<T>(opts: {
  messages: ChatMessage[];
  schema: ZodSchema<T>;
  timeoutMs?: number;
  label?: string;
}): Promise<T> {
  let completion;
  try {
    completion = await getClient().chat.completions.create(
      {
        model: MODEL,
        messages: opts.messages,
        response_format: { type: "json_object" },
        temperature: 0.4,
      },
      opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
    );
  } catch (err) {
    throw friendlyLlmError(err);
  }
  logUsage(opts.label ?? "chatJsonConversation", completion);
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
