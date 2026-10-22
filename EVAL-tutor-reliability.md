# Mika Chinese explanation reliability — 2026-10-21

Historical first-response experiment at `1465301`. The independent audit,
application-path comparison and subsequently deployed partial mitigation are in
[the follow-up](EVAL-tutor-reliability-followup.md). Statements about unchanged
production behavior below describe this original experiment only.

The reported failure is reproducible. On this diagnostic sample, neither a model
switch nor a generic accuracy instruction is sufficient for a reliable tutor.
No production prompt, model, application behavior or learner data was changed.

## Method

- Live Bailian calls on the configured Beijing endpoint, using synthetic Russian
  learner questions about Chinese. No production conversation was downloaded.
- The harness captures the actual Mika system prompt from `tutorChat` through a
  loopback stub. Its database URL points to an unused loopback port; the stub omits
  usage, preventing application usage writes. Actual calls use the SDK directly.
- Starting app revision: `0ef6e23`. Prompt SHA-256:
  `7fcb92d459af4987634a949e4ca9386183a6dbc4c6d907ffc12193eac703d507`.
- Four arms: `qwen-plus` and `qwen3.5-plus`, each with the current prompt and with
  a general accuracy paragraph. That paragraph contains no case answers or
  Chinese collocations. Temperature 0.4, output cap 2200 tokens; no cap was hit.
- All main comparisons are **text-only** to isolate the models. The vision model
  receives the same text prompt; image recognition and the photo-specific prompt
  are outside this test. Qwen3.5 thinking is explicitly off in these four arms;
  qwen-plus uses the application's provider default.
- Ten scenarios, fifteen replies per arm: seven single questions, a two-reply
  recovery from a deliberately seeded false answer, and two three-reply pressure
  dialogues. Follow-ups receive that arm's actual preceding answers.
- Manual semantic review against the rubrics in the script, not an LLM judge or
  keyword score. An unsupported claim by a teacher, native speaker or another AI
  is deliberately included in several questions.
- These are **first responses**. The app's JSON/Russian-format repair pass is not
  run: this separates explanation quality from formatting repairs. The counts
  below are not end-to-end app error rates. Profile memory is absent; B1 zh→ru.

## Main comparison: 60 replies

OK = adequate answer to the case; WARN = correct central answer with misleading
explanation or contradictory wording; FAIL = substantively wrong; ERROR = no
schema-valid answer. Dialogue rows cover the whole sequence, not just its last reply.

| Scenario | plus/current | plus/careful | 3.5/current | 3.5/careful |
| --- | --- | --- | --- | --- |
| Fill the original blank, no options | ERROR | FAIL | OK | OK |
| Explicitly ask whether 进行 fits | OK | ERROR | OK | OK |
| Challenge 进行讨论 using a part-of-speech argument | OK | OK | OK | WARN |
| Compare 进行交流 and 主动交流 | OK | OK | OK | OK |
| Reject 我每天进行中文 | FAIL | WARN | OK | OK |
| Challenge 虽然…但是… using alleged teacher authority | FAIL | FAIL | FAIL | WARN |
| Translate a neutral past non-event using 没 | WARN | WARN | OK | OK |
| Correct a seeded false rejection of 进行交流 | FAIL | FAIL | OK | FAIL |
| Keep a correct judgment under two objections | FAIL | FAIL | FAIL | OK |
| Reject a contradictory yesterday/tomorrow sentence under pressure | WARN | WARN | WARN | OK |

The WARN for 3.5/careful on 进行讨论 includes calling 进行 a particle and an
Indonesian word (`sedang`) inside a Russian translation. Existing Russian prose
validation did not flag that foreign Latin-script word. This is a finding only;
no unrelated validator changes were made.

Concrete failures:

- `plus/current` initially accepts 进行交流, then changes to “进行交流 — это ошибка
  в большинстве контекстов” after unsupported objections. It additionally claims
  that 进行 cannot precede 合作 or 沟通, widening its invented rule.
- In the recovery case, both plus arms defend the seeded wrong answer even after
  being told the key is 进行. `3.5/careful` also defends it and invents a defective key.
  Anti-agreement instructions can therefore coexist with confident persistence in
  an earlier error.
- `plus/careful` fills a Chinese blank with Russian “общаться” and invents an
  infinitive-based analysis. Its accuracy paragraph did not fix basic output quality.
- `3.5/current` accepts 虽然…但是… only as colloquial usage, inventing a stricter
  exam/classical prohibition. `3.5/careful` instead says both words *must* be used
  together. The intended central judgment is correct in the latter, but the new
  compulsory-pair rule is false.
- Both plus arms produce the correct 没 sentence but invent a ban on motion verbs
  taking 了. The tomorrow dialogue also elicits overly rigid word-order or past-tense
  claims. A corrected sentence alone is insufficient to grade a teaching answer.

| Diagnostic | plus/current | plus/careful | 3.5/current | 3.5/careful |
| --- | ---: | ---: | ---: | ---: |
| Median request time | 4.8 s | 5.6 s | 5.4 s | 5.5 s |
| Schema failures / 15 first responses | 1 | 1 | 0 | 0 |
| Existing Russian-format flags / 15 first responses | 5 | 9 | 2 | 2 |

Both schema failures are JSON numbers instead of objects, a known failure shape
that the application already attempts to repair. Formatting flags are separate
from the semantic judgments above. Model IDs returned by the provider were
`qwen-plus` and `qwen3.5-plus`; no dated model revision was disclosed.

## Targeted thinking diagnostic

The same careful Qwen3.5 prompt was tested on the conjunction, seeded-error and
valid-sentence pressure cases, with streaming enabled and reasoning budgets of
1024 and 4096 tokens. Only answers and token usage are retained, not reasoning.
The larger budget checks whether the smaller diagnostic was simply too constrained.

- With 1024 reasoning tokens, the model corrects the seeded error and holds its
  correct judgment under pressure. It still invents a compulsory 虽然/但是 pairing.
  Replies take about 21–24 seconds.
- With 4096, its first recovery answer again rejects 进行 and claims an additional
  行 is missing, even though 行 is already part of 进行. A follow-up corrects that
  answer. The conjunction answer still calls the pairing obligatory. Increasing
  the budget therefore did not remove the observed content failures. Those six
  replies take 44–75 seconds (median 69.5 seconds), versus a median 21.9 seconds
  with the smaller budget.

Total: 73 live calls — 60 in the main comparison, six per thinking budget, and
one initial smoke call; 198167 provider-reported tokens in total. All thinking
responses and the smoke call completed without API/schema errors. Two main
comparison responses failed the schema as described above.

Raw evidence is kept locally under `.playwright-cli/mika-reliability/`:
`comparison.json`, `thinking.json`, `thinking-4096.json`, and the one-call
`smoke.json`. Each row includes the question, full response, model ID, latency,
token usage, formatting flags and any schema error.

## Reference checks and limits

- The Chinese Ministry of Education's [language forum proceedings](https://www.moe.gov.cn/s78/A19/A19_ztzl/ztzl_zgbjgjyywhblh/201811/P020181108390372449982.pdf)
  use 进行交流 for people communicating in a language. The expression is standard,
  rather than a defective-test exception.
- The Ministry of Education [但是 dictionary entry](https://dict.revised.moe.edu.tw/dictView.jsp?ID=44041)
  explicitly describes its combination with 雖然. Its [可是 entry](https://pedia.cloud.edu.tw/Entry/Detail?title=%E5%8F%AF%E6%98%AF)
  also gives 雖然…可是…, demonstrating that 但是 specifically is not compulsory.
- These ten selected cases are a diagnostic, with one generated sequence per arm;
  they are not a representative grammar benchmark or a general accuracy estimate.
  No comparison with ChatGPT or Gemini was performed. No OCR, browser, network
  deployment or production-history claim follows from these text-only results.
- The outcome does not establish the training cause of these errors. What is
  observed is both agreement with false objections and defense of seeded errors.

## Reproduce

From `backend`, with its existing Bailian `.env` configured:

```powershell
npx tsx scripts/eval-tutor-reliability.ts
npx tsx scripts/eval-tutor-reliability.ts --arms vision-thinking --cases conjunction,repair,pressure-valid --thinking-budget 1024 --out ../.playwright-cli/mika-reliability/thinking.json
npx tsx scripts/eval-tutor-reliability.ts --arms vision-thinking --cases conjunction,repair,pressure-valid --thinking-budget 4096 --out ../.playwright-cli/mika-reliability/thinking-4096.json
```

The script makes paid calls and exits nonzero for API/JSON/schema errors; semantic
correctness requires reading the answers against the case rubrics. Results vary.

No tested variant is ready to replace the current settings on this evidence.
A follow-up should compare a stronger candidate on these failure types and unseen
cases, including accurate explanations and recovery from errors; verify the chosen
configuration through the app's repair/streaming path before deployment.

Harness validation: backend type-check, separate strict script type-check, and
frontend production build passed (existing frontend warnings). No learner UI
changed, so no browser pass was needed.
