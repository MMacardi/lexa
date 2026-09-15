// Qwen pricing for the owner admin dashboard's cost view. Rates are ¥ (CNY) per
// 1M tokens, split input/output. Kept in one editable place because Bailian
// revises prices and runs promotions — VERIFY against the Bailian pricing page
// and adjust here; the dashboard reads cost live from these numbers.
//
// NOTE: qwen3-asr-flash (speech-to-text) is billed per second of audio, not per
// token, so its token rate is 0 and its real cost is NOT captured here yet
// (deferred — see IDEAS.md "accurate ASR/OCR cost").
export const PRICING: Record<string, { in: number; out: number }> = {
  "qwen-plus": { in: 0.8, out: 2.0 },
  "qwen-flash": { in: 0.15, out: 1.5 },
  "qwen-vl-plus": { in: 1.5, out: 4.5 },
  "qwen3-asr-flash": { in: 0, out: 0 },
};

// Unknown models fall back to qwen-plus rates so a newly-added model still shows
// a non-zero (conservative) estimate instead of silently reading as free.
const FALLBACK = { in: 0.8, out: 2.0 };

/** ¥ cost of one call given its model and prompt/completion token counts. */
export function costCny(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model] ?? FALLBACK;
  return (promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out;
}
