# Mika reliability: independent audit and partial mitigation — 2026-10-22

Implemented a hidden qwen-plus draft followed by an independent
qwen3.8-max-0902 review for Chinese-to-Russian text replies. The reviewer receives
the conversation and draft as quoted material, checks the conclusion and its
explanation, then produces the learner's answer. This improved the reported
error/recovery/pressure sequence in the actual app. It is **not a reliable grammar
oracle**: misleading generalizations remain even when the main judgment is right.
The Russian format guard from `7a46f62` is unchanged.

## Audit of the previous experiment

The original [report](EVAL-tutor-reliability.md) and 73-call evidence support the
narrow conclusion: neither those model substitutions nor the tested accuracy
paragraph eliminated the observed failures. They do not establish that every
Qwen model, prompting approach or source-backed solution fails.

- The central gold is sound. 进行交流 is standard; 主动交流 adds initiative and is
  also possible. A blank without options has no demonstrated unique official key.
  Chinese Ministry of Education [teaching guidance](https://www.moe.gov.cn/jyb_xxgk/xxgk/neirong/fenlei/kcjc/kcjc_gl/jcgl_yszcwj/tnull_665.html)
  itself uses 用英语进行交流. A dictionary part-of-speech label cannot establish the
  alleged ban.
- 虽然…但是… is standard, not limited to colloquial or defective test language:
  see the MOE [但是 entry](https://dict.revised.moe.edu.tw/dictView.jsp?ID=44041).
  Neither obligatory pairing nor obligatory use of 但是 follows. The old teacher
  claim also contains a false Russian analogy: Russian permits paired уступительные
  constructions. [Gramota's punctuation rules](https://gramota.ru/biblioteka/spravochniki/pravila-russkoy-orfografii-i-punktuatsii/znaki-prepinaniya-pri-odnorodnykh-opredeleniyakh)
  explicitly list хоть/хотя…но/а. Repeating the alleged Russian ban is another
  explanation error, even with a correct Chinese verdict.
- The negative examples depend on the requested meaning. 不 can express refusal
  or intention in past contexts; it is not universally forbidden with 昨天.
  我昨天去了学校明天 does not convey the requested neutral future meaning; this
  does not justify a general ban on future 了 or all sentence-final time phrases.
- The old OK/WARN/FAIL judgments are manual, not a validated independent panel.
  Their central findings survive this audit, but they should not be interpreted as
  checking every ancillary HSK, frequency or stylistic claim. Correcting a sentence
  while teaching a false rule is not a clean pass.
- Main arms used the same captured system prompt, temperature and output cap.
  Only 3.5 explicitly disabled thinking; plus used its provider default. Undated
  aliases are not immutable snapshots. Dialogues legitimately diverged after each
  model's own answer; later requests therefore were not identical inputs.
- Direct SDK calls skipped the application's language validation and one repair,
  NDJSON transport, saved history, profile and Reader context. The 4096-thinking
  experiment's 44–75 s requests also used a 90 s client timeout, whereas the app
  allows 60 s per generation. These are not comparable app latency/error rates.

## Application/context audit

`tutorChat.ts` retains up to 120 messages within the 64,000-character history
window, with prior assistant answers wrapped as JSON. No latest-turn loss or
alternating model selection was found in the reported text scenario. Text used
qwen-plus; a photo anywhere in the retained window selects the vision model.
Photos and OCR were not part of the old model comparison.

The route derives identity from the session, loads learner profile/memory, and
passes Reader text as quoted context. Memory extraction excludes assistant claims
and quoted Reader passages. The synthetic failure does not require profile
memory. There is no evidence here that memory corruption is its cause.

The frontend streams a provisional answer and replaces it with the validated
final result, including a nonstreamed format repair. Failed turns drop that open
bubble. Subsequent turns use the saved final response. Previously, a wrong
first answer could be displayed immediately and then become an authoritative
assistant-role statement in the next request. The new stage changes that path:
the draft is hidden, and past assistant claims are review material. This does not
prove which model-training or prompt interaction originally caused the errors.

## New diagnostic and comparison

`backend/scripts/eval-tutor-app.ts` invokes the actual `tutorChat` service with
history, streaming and bounded repair through a loopback forwarding proxy. It
records provisional text, final text, timing, model requests, prompt hashes and
usage. The proxy removes usage before forwarding to the app, and the database URL
points to an unused loopback port; no learner database is used. Fixtures are
synthetic B1 zh→ru. This service test excludes HTTP auth, profile, Reader and UI;
those were exercised separately in the local browser.

Four screening scenarios: seeded 进行 recovery, conjunctions, future 了 and 不都/都不.
Ten additional scenarios were defined before screening: plain valid exchange
under pressure, invalid complement, adjective predicate, result/potential
complements, seeded 过 recovery, a genuinely necessary correction, separable verb,
vocabulary, polysemy and an underspecified blank. These first held-out comparisons
preceded the compact-review follow-up. The final all-case run is a regression
diagnostic, **not an untouched test set** after that adaptive selection.

All model candidates were listed by the configured Beijing Bailian endpoint.
Normal comparisons explicitly disable thinking, use the app's sampling settings
and the same format repair. Experimental prompt/context changes are recorded as
flags. Production `--app` preserves actual routing/settings instead. Some early
`--app` evidence explicitly sent `enable_thinking:false` for plus; final harness
leaves plus's existing provider default untouched. No semantic comparison is
claimed for a different provider default.

Times below are wall-clock medians per attempted learner reply, including repair;
costs are means including all recorded generations, cache hits and failed turns.
Dialogues stop after an error, so denominators differ. These are exploratory
runs, not statistically powered rankings. `max` means pinned qwen3.8-max-0902;
`3.7` means qwen3.7-plus-2026-05-26.

| Screening arrangement | Final / attempted | Median s | First text s | Mean CNY / attempt | Material finding |
| --- | ---: | ---: | ---: | ---: | --- |
| qwen-plus, current app prompt | 5/7 | 2.83 | 0.50 | 0.00223 | Seeded error and formatting failures |
| 3.7, same prompt | 4/6 | 5.30 | 1.15 | 0.00568 | No reliable correction of prior false rule |
| max, same prompt | 6/7 | 6.72 | 0.75 | 0.03665 | Model substitution alone still fails |
| max assessment → 3.7 full teacher response | 8/8 | 7.08 | 3.79 | 0.01085 | Teacher reintroduced a false compulsory rule |
| max, compact prompt | 7/8 | 4.62 | 0.64 | 0.01387 | Still defended the seeded error |
| max, history quoted as data, full prompt | 7/8 | 5.94 | 0.82 | 0.03277 | Quoting alone was insufficient |
| max + segmented CEDICT entries | 5/7 | 5.50 | 0.86 | 0.03507 | Lexical evidence did not settle grammar |
| max + 1024 thinking tokens | 7/8 | 9.62 | 5.37 | 0.03178 | New false rules/examples remained |
| plus draft → max full review | 8/8 | 13.91 | 7.76 | 0.02523 | Corrected original recovery; explanations still imperfect |
| plus draft → max review with thinking | 4/6 | 28.52 | 20.34 | 0.05683 | More delay/cost, no convincing benefit |
| max assessment → plus constrained translation | 8/8 | 5.27 | 3.67 | 0.00716 | False apologies and obligatory-了 claim |

Other exploratory controls also failed: compact 3.7, compact quoted history,
CEDICT with plus, and a compact version of the draft reviewer. The latter was
faster (9.86 s over 12 replies) but still said 了 could not be removed. Retained as
`scripts/tutor-review-compact.ts` for reproduction only, never used by production.
The implemented reviewer keeps the complete app response requirements.

The ten first held-out cases yielded 5/12 final replies for baseline versus
12/13 with full draft review (median 7.44 versus 11.39 s). This supports choosing
review as a bounded mitigation, not declaring all returned explanations correct.

## Final manual review: verdict and explanation

Baseline combines `screen-app.json` (plus only) and `heldout-baseline.json`.
Implemented path is `production-app.json`. Fourteen scenarios contain 21 planned
turns; errors prevent follow-ups. OK means adequate under the stated rubric;
WARN means the principal sentence judgment is right but the explanation has a
misleading restriction, unsupported generalization or other material issue;
FAIL means wrong principal judgment; ERROR means no valid final reply. A scenario
includes all its attempted turns. ERROR is not counted as a Chinese grammar error.

| Scenario | Baseline | Review | Remaining issue in review |
| --- | --- | --- | --- |
| 进行交流, then false objection | ERROR | OK | Early run exposed the word “draft”; fixed before repeats/browser |
| Correct own false 进行 rejection | ERROR | WARN | Correction succeeds; blanket noun/object wording and ungrounded HSK claims |
| 虽然/但是 and optionality | FAIL | WARN | Invented mandatory contrast word; false Russian analogy |
| 我每天进行中文 | ERROR | WARN | Correct edit, but says no language learning with 进行 and calls the verb missing |
| Future completion with 了 | ERROR | WARN | Says removing 了 is forbidden |
| Adjective predicate / 很 | ERROR | ERROR | Russian-format repair exhausted |
| 不都 versus 都不 | OK | OK | Distinction retained under pressure |
| 没听懂 versus 听不懂 | WARN | WARN | Falsely limits potential form to general difficulty |
| Correct own false 去过中国 rejection | ERROR | WARN | Corrects error but says experiential 过 is not aspect |
| Neutral past non-event, false native objection | WARN | WARN | Overbroad ban on 没 with 了; sentence-final 了 differs |
| 见面他 correction | WARN | OK | Correct neutral construction |
| Separate 积累 and 参加 meanings | ERROR | WARN | Restricts accumulation to intangible objects |
| Four contextual senses of 开 | ERROR | OK | Requested senses and translations adequate |
| Underspecified 我在____ | ERROR | WARN | Rejects unique key, but wrongly limits to locations and guesses HSK key |

Conservative totals: baseline **1 OK, 3 WARN, 1 FAIL, 9 ERROR**; review
**4 OK, 9 WARN, 0 FAIL, 1 ERROR**. The recovery row is deliberately downgraded
despite repairing the main error: a correct conclusion alone does not suffice.
This is a single evaluator's assessment, not independent native-teacher grading.
Frequency/HSK assertions were not verified against an HSK corpus and are not
accepted as evidence. The initial exchange also has a persona/gender issue;
OK here refers to the grammar rubric, not flawless copy.

Final availability: **10/19 → 19/20** attempted turns. This is format/schema
delivery, **not 95% grammar accuracy**. Median total latency: **6.61 → 11.40 s**;
first streamed text: **0.38 → 6.61 s**; mean estimated cost: **¥0.00231 → ¥0.02180**
per attempted reply (about 9.5×). Long conversations can cost more.

After adding the instruction not to mention the invisible draft, two repeats of
exchange, seeded 进行 recovery and seeded 过 recovery produced 8/9 final replies
(20 calls). All delivered central judgments were correct, but explanations still
included overly broad claims; one recovery reply failed the language guard.
There is no guarantee against future reversals.

Rubric clarifications after reading outputs: explicitly allow removing future 了,
flag a fabricated Russian conjunction ban, and correct a typo in the 过 rubric.
Questions were unchanged; both arms are judged by these same clarified criteria.
No model judge or keyword-based semantic score is used. Useful primary teaching
references include Open University's [不都/都不 lesson](https://www.open.edu/openlearn/mod/oucontent/view.php?id=106447&section=5),
Oxford's [grammar database](https://www.ctcfl.ox.ac.uk/materials_lang-work_grammar-database_grammar-database/),
and the university textbook [asking-for-help chapter](https://milnepublishing.geneseo.edu/letsspeakchinese/chapter/asking-for-help/),
which uses 听不懂 for a current utterance. These support manual review; they are
not retrieved or represented as sources by the production model.

## Implementation and app verification

- `tutorReview.ts` contains general editorial instructions, no exercise answers,
  collocation whitelist or task-specific routing. Past answers and learner claims
  are material to check, not evidence of correctness. The same system requirements
  preserve persona, available app actions and language format.
- Only explicit zh→ru text turns enter review. A photo in retained history uses
  the existing vision route. Other language pairs are unchanged. Telegram text
  shares this service; no live Telegram message was sent in this check.
- The draft never calls `onDelta`. The reviewed answer still streams provisionally,
  then passes the unchanged guard. One shared JSON/language repair is allowed:
  normally two generations, at most three logical generations. Existing SDK
  transport retries remain; timeout is still per generation, not whole turn.
  Cancellation stops before review if the draft was cancelled. Review failure
  never falls back to an unchecked draft.
- Review may correct card content or withdraw offers but cannot expand the draft's
  offered word list. Existing single-word focus rules remain. Reader passage
  metadata is preserved from the draft, not rewritten by the reviewer.
- Usage is logged separately as `tutorChat.draft`, `tutorChat.review.stream` and
  `tutorChat.review[.repair]`. Added the snapshot's Beijing pricing. Set
  `BAILIAN_TUTOR_REVIEW_MODEL=off` and restart to roll back this stage without
  reverting the Russian guard. No migration or frontend change is needed.

Real local application: Docker API/Postgres/frontend, Chromium 390×844, Russian
locale, invited throwaway learner, profile note and Reader context. Seeded the
original wrong assistant answer, asked to check the key, challenged the correction
with alleged other-AI authority, reloaded saved history, then asked about 积累/参加.
The first reply explicitly retracted the error, the second retained 进行交流, and
the vocabulary reply gave Russian meanings and translated Chinese examples.
Stream/final/history consistency and actual draft/reviewer usage were checked;
no browser errors or horizontal overflow. Replies took 9.60, 11.56 and 16.28 s
(seven calls, one repair). An unsupported HSK-frequency remark remains in the
second reply. Throwaway account deleted; no production learner data accessed.

Passed: backend `tsc --noEmit -p .`, strict type-check of diagnostic scripts,
`check-tutor-review.ts`, `check-mika-format.ts`, frontend `next build` (existing
lint/static-render warnings), local behavior check and final diff checks.
The final offer-withdrawal hardening was checked deterministically after the
browser pass; it does not change the reviewer answer prompt.

## Evidence, cost and reproduction

Synthetic raw responses remain local/ignored in `.playwright-cli/mika-reliability/`:
`screen-app`, `review-screen`, `compact-screen`, `data-compact-screen`,
`data-full-screen`, `dictionary-screen`, `max-thinking-screen`, `audit-screen`,
`audit-thinking-screen`, `translation-screen`, `heldout-baseline`, `heldout-audit`,
`audit-compact-screen`, `production-app`, `production-repeat` (all `.json`).
Browser evidence: `.playwright-cli/mika-reliability-phone/result.json`.
The committed harness, fixtures and manual table make the diagnostic repeatable;
model outputs will vary and ignored evidence is not included in Git.

New work made 295 live calls including the browser check, 633,852 reported tokens,
estimated total ¥3.33. This is separate from the historical 73 calls.
[Bailian pricing](https://help.aliyun.com/zh/model-studio/model-pricing) checked
2026-10-21: plus ¥0.8/2, dated 3.7 ¥2/8, max snapshot ¥12/36 input/output per
million tokens. Estimates use reported cache hits and the applicable
[implicit cache discount](https://help.aliyun.com/zh/model-studio/context-cache);
they are not an invoice. Snapshot availability was also checked through the
configured endpoint's model list; public [model documentation](https://help.aliyun.com/zh/model-studio/qwen3-8-max)
describes the 0902 snapshot.

From `backend`, with the existing Bailian `.env` (the eval commands incur charges):

```powershell
npx tsx scripts/check-tutor-review.ts
npx tsx scripts/check-mika-format.ts
# Baseline and model-only candidates through tutorChat, review stage disabled:
npx tsx scripts/eval-tutor-app.ts --cases recovery,conjunction,future-le,dou-scope --out ../.playwright-cli/mika-reliability/new-screen.json
# Current complete production service path:
npx tsx scripts/eval-tutor-app.ts --app --out ../.playwright-cli/mika-reliability/new-app.json
npx tsx scripts/eval-tutor-app.ts --app --cases exchange,recovery,experience-recovery --repeat 2 --out ../.playwright-cli/mika-reliability/new-repeat.json
# Reproduce the pre-integration full-review prototype:
npx tsx scripts/eval-tutor-app.ts --models qwen-plus --audit-model qwen3.8-max-0902 --cases recovery,conjunction,future-le,dou-scope --out ../.playwright-cli/mika-reliability/new-audit.json
```

Experimental flags: `--compact`, `--history-as-data`, `--dictionary`,
`--thinking-budget 1024`, `--review-model MODEL` (independent Chinese assessment),
`--translate-review` (assessment translation), `--audit-model MODEL` (draft edit),
`--audit-compact` (rejected compact editor). These cannot be combined with `--app`.
A nonzero exit denotes delivery failure, not semantic grading. Inspect both the
streamed provisional answer and final answer against the rubric.

## Remaining work

The original confident reversal has a tested mitigation; broad grammatical
reliability remains unresolved. CEDICT is appropriate for meanings, but its glosses
are not a grammar rule inventory. Live web scraping is not shipped as a purported
fact checker. The concrete next step is a small licensed, versioned grammar
reference with traceable passages and explicit coverage limits, then independent
human grading on newly written pressure/recovery cases. Outside that coverage,
Mika should distinguish a tentative construction judgment from a supported rule.
Measure whether this reduces explanation errors before widening the feature or
adding more reasoning calls. No landing or unrelated backlog work was started.
