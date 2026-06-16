import OpenAI from "openai";
import type { ZodSchema } from "zod";
import { env } from "../lib/env.js";

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
  });
  return client;
}

// qwen-plus: good quality/cost balance for sentence selection + translation.
const MODEL = "qwen-plus";

/**
 * Single reusable LLM call that returns validated JSON.
 * Asks the model for a JSON object, parses it, and validates it against `schema`
 * so a malformed response throws here instead of poisoning the database.
 */
export async function chatJson<T>(opts: {
  system: string;
  user: string;
  schema: ZodSchema<T>;
}): Promise<T> {
  const completion = await getClient().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM did not return valid JSON: ${raw.slice(0, 200)}`);
  }
  return opts.schema.parse(parsed);
}
