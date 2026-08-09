# Unit economics (estimate)

Goal: how much a user *costs us* in AI/search spend. Compute engine (FSRS,
reviews, quizzes, stats) is **$0** — all client/DB. Cost comes only from LLM
(Qwen/Bailian) and web search (Tavily) calls.

> ⚠️ The per-action **call counts** below are exact (read from the code). The
> **prices** are ballpark and must be re-checked against current Bailian / Tavily
> rates — plug real numbers into the formulas.

## Price assumptions (verify!)
| Resource | Assumed price |
|---|---|
| Qwen `qwen-plus` text call (short, ~0.5–3K tok) | ~$0.001 / call |
| Qwen `qwen-vl-plus` vision call (OCR, 1 image) | ~$0.004 / call |
| Tavily web search | ~$0.006 / search (first 1,000/mo free) |

## Calls per action (from code)
| Action | LLM calls | Tavily | Est. cost |
|---|---|---|---|
| Add word (auto) | tutor 1 + example (select+translate, sometimes compose) 2–3 | 1 | ~$0.009 |
| Add word from **Reader** (context) | tutor 1 + translate sentence 1 | 0 | ~$0.002 |
| Add word (manual) | 0 | 0 | $0 |
| Spell-check "did you mean" | 1 | 0 | ~$0.001 |
| Import preview (whole paste) | 1 (larger) | 0 | ~$0.002 |
| Import per card (details+example) | tutor 1 + example 2–3 | 1 | ~$0.009 |
| Regenerate / add example | 1–3 | 0–1 | ~$0.004 |
| Explain / ask (per chat msg) | 1 | 0 | ~$0.001 |
| Translate all (reader) | 1 (larger) | 0 | ~$0.002 |
| Word tap gloss / context gloss | 1 | 0 | ~$0.001 |
| Photo OCR | 1 vision | 0 | ~$0.004 |
| **Review / quiz / stats** | 0 | 0 | **$0** |

## Monthly cost per active learner (scenarios)
Assume a месяц of use:

**Casual** — 30 new words (20 auto, 10 reader), 5 translates, 10 glosses, daily reviews:
- 20×$0.009 + 10×$0.002 + 5×$0.002 + 10×$0.001 ≈ **$0.22 / user / month**

**Engaged** — 100 new words (50 auto, 50 reader), 1 OCR, 30 explains/asks, 20 translates:
- 50×$0.009 + 50×$0.002 + 1×$0.004 + 30×$0.001 + 20×$0.002 ≈ **$0.66 / user / month**

**Power** — 300 words (150 auto, 150 reader), 10 OCR, 100 chat msgs, 60 translates:
- 150×$0.009 + 150×$0.002 + 10×$0.004 + 100×$0.001 + 60×$0.002 ≈ **$2.0 / user / month**

Tavily's first 1,000 searches/month are free, so for small user counts search is
effectively $0; the LLM calls dominate.

## Takeaways
- Even a power user is ~**$2/mo**; casual ~**$0.20/mo**. A $3–5/mo subscription (or
  modest ad/one-time) covers all tiers with healthy margin.
- Biggest lever: **auto-add costs ~4× a reader-add** (Tavily + extra example calls).
  Pushing users toward the Reader (context example, no search) roughly quarters
  the per-word cost.
- Cheap safety valves already in place: manual add ($0), FSRS review ($0), the
  opt-in nature of translate/explain/OCR, and the gloss cache.
- If costs ever bite: cache tutor/example results per (word, pair) globally so the
  same word added by many users is generated once; batch tutor+example into one
  call; and keep heavy features (OCR, chat) behind the existing opt-in toggles.
