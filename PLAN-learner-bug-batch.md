# Reader, examples, audio and connection fixes

Requested 2026-10-19 from the author's screenshots. Implementation status and
verification are recorded under each part. Implement one part per session, in
order, unless the author explicitly chooses another part. The previous
`PLAN-reader-mika-fixes.md` is complete; do not restart it.

## Boundaries and decisions

- Preserve unrelated work: modified `frontend/.env.example`; untracked `h3.txt`
  and `p.out`. Do not inspect/stage those for this task.
- Before implementation read `.claude/commands/task.md`. Use local test accounts
  and data; verify changed learner flows on desktop and phone. Adapt UI copy to
  ru/en/zh. No landing copy, layout or screenshot work; auth routing is in scope.
- Attribute examples accurately. The prepared sentence pool is not CC-CEDICT;
  do not label generated examples as dictionary quotations.
- The screenshot's two 顺序 rows warrant a duplicate-path check, not automatic
  deduplication: separate senses may be intentional. Do not modify existing data.
- Grouped-word retention proof remains open until actual seven-day evidence
  exists (earliest approximately 2026-10-21). This explicit bug batch takes priority.

## Session order and Codex settings

Effort choices below are engineering recommendations for this repository, not an
OpenAI requirement. Use GPT-6.1 Sol when available; GPT-6 Sol is a fallback.

| Part | Outcome | Model | Reasoning effort |
| --- | --- | --- | --- |
| 1 | Connection failures preserve the app; fewer blocking startup states | GPT-6.1 Sol | High |
| 2 | Every add shows example progress and updates without reload | GPT-6.1 Sol | High |
| 3 | Reader captures get a useful second example; examples can be removed | GPT-6.1 Sol | High |
| 4 | Sentence playback: stop, slow speed, placement and consistent pace | GPT-6.1 Sol | High |
| 5 | Compact popups and short, accurate Reader instructions | GPT-6.1 Sol | Medium |
| 6 | Diagnose and improve isolated-word Mandarin pronunciation | GPT-6.1 Sol | High |

Part 5 can also use GPT-6 Luna / High. For part 6, Astra / Medium is an optional
escalation after controlled tests leave the cause ambiguous; it cannot replace
listening to Mandarin audio. Max/Ultra are unnecessary for these scoped sessions;
retain the project's no-delegation rule.

Official guidance checked 2026-10-19: [models and reasoning effort](https://learn.chatgpt.com/docs/models).
It recommends GPT-6.1 Sol for complex coding when available and Luna for focused,
repeatable work. Account/client availability varies.

## Part 1 — Connection failures and startup

- [x] Implement and verify (2026-10-19).

**Code findings.** `frontend/lib/account.tsx` catches every `/auth/me` failure,
tries Telegram auto-login, then clears account/profile. `components/AppShell.tsx`
renders `GuestExperience` when that happens. A network failure becomes a signed-out
state: a real defect, not normal offline behavior. `lib/sync.ts` mirrors words in
IndexedDB for review, but `app/words/page.tsx` calls `api.listWords` directly.
Startup blocks the shell on `/auth/me`; later request costs are not yet measured.

**Implement.** Distinguish confirmed sign-out from offline, timeout and server
errors. Preserve a verified in-memory account on transient failure. For reloads,
use a minimal account-scoped snapshot to display cached content with an offline/
reconnecting status. Cached identity must never authorize server access or bypass
session/invite gates. Clear/scope snapshots on logout, account switch and confirmed
access revocation. Without a prior snapshot, show connection/retry feedback if
verification fails; do not pretend the user signed out.

Make My words and previously loaded details readable from that account's cache.
Review `fetchWordsCached` before reuse: its catch includes auth failures. Ensure
local reads run even when TanStack Query pauses network queries offline; adding
a catch alone is insufficient. Reconnect refreshes automatically without blanking
readable content. Preserve existing offline review/outbox behavior and isolation.

Measure warm and throttled cold startup: account gate, onboarding, profile and
words queries (`app/providers.tsx`, account, shell, onboarding). Remove measured
unnecessary blocking and use cached content/skeletons with background refresh.
Do not promise zero first-visit loading or full offline cold startup without cached
assets. A general service-worker/PWA rewrite is outside this part.

**Acceptance.** Online → offline, offline reload after a prior visit, direct cached
word navigation, reconnect, slow API, API 5xx, actual sign-out/forbidden responses,
logout and account switching. No landing on transient failure, endless spinner or
cross-account data. Record before/after startup timings under identical conditions
and document offline limits.

**Implementation (2026-10-19).** Account verification now distinguishes HTTP
401/403 from transient errors. A minimal display snapshot restores the learner
shell, with ru/en/zh offline/reconnecting feedback and retry; absent a snapshot,
failed verification offers retry instead of the guest landing. Protected reads
wait for the cookie-backed `/auth/me` result, and stale responses/writes are
discarded when the account scope changes. Logout, switching and confirmed invite
revocation clear account caches; offline logout persists until the server cookie
can be cleared. Telegram auto-login runs only after a confirmed 401.

My words, Today, Sidebar and Review share the account-scoped IndexedDB list;
visited details keep their own snapshot. Local queries use `networkMode: always`,
and reconnect cancels pending cache reads before starting verified refreshes.
Cached content stays readable during refresh. The queue carries its account owner;
legacy operations migrate only with the previous matching prefs owner marker.
Queue status sits above content so it cannot cover phone grading controls, and
failed background quick-add chunk preloads no longer throw unhandled errors.
`/auth/me.hasWords` removes the full-list onboarding gate for returning learners
without an HSK target. No schema changes or migrations.

**Offline limits.** The stored shell identity is display-only, never a credential.
Only cached words/details and the existing review/outbox work offline. API-offline
reloads are supported when app assets can load. A full browser reload without
reachable/cached HTML and JS, unvisited route chunks, new dictionary/AI content,
and full PWA/service-worker asset caching are outside this part.

**Startup measurements.** `node frontend/scripts/measure-startup.mjs before|after`,
local Docker dev server, Chromium 1280×900, Russian, one saved word and no HSK
target; identical browser/routing/data setup. Cold = fresh browser context with
no account/content snapshot; warm = reload after that visit. Throttled runs add
1,500 ms to every API request. Values below are navigation-to-shell / readable
word, in milliseconds; raw request traces stay in `.playwright-cli/connection/`.

| Scenario | Before, shell / word | After, shell / word |
| --- | --- | --- |
| Cold, no API delay (includes first dev compilation) | 7,623 / 7,642 | 14,349 / 14,481 |
| Warm, no API delay | 1,155 / 1,173 | 945 / 1,009 |
| Cold, 1,500 ms API delay | 5,613 / 5,621 | 3,889 / 5,735 |
| Warm, 1,500 ms API delay | 4,434 / 4,440 | 879 / 930 |

The controlled bottleneck was `/auth/me` → full words list → onboarding shell.
Measured from the first `/auth/me` request, the throttled cold shell wait fell
from 3,359 to 1,805 ms: it now waits for profile verification, then loads words
in the background. Profile is included in `/auth/me`, without a second profile
request. Words, collections, usage and stats then run in parallel. Warm cached
content paints before verification finishes. QueryClient's existing 30 s in-memory
cache does not survive a reload, hence the IndexedDB hydration. The first dev
compile varies substantially and got slower in this sample; these diagnostic
timings do not establish production first-visit performance. An uncached word
still waits for its network request, as the throttled cold content numbers show.

**Verification.** Backend `npx tsc --noEmit -p .` and final frontend
`npx next build` pass; the stale local Prisma client was regenerated, without a
schema change. Existing lint warnings remain outside the changed logic. The final
`frontend/scripts/check-connection.mjs` run passes against the local production
build in desktop Chromium, 360 px phone Chromium, iPhone 13 WebKit and 390 px
phone Firefox. All use throwaway local users, removed in `finally`.

Covered: loaded app offline, API-offline reload/list/direct detail, cached review
grading, queue persistence and reconnect flush, `/auth/me` and words 5xx,
10 s timeout with/without a snapshot, retry and fresh content, no Telegram
auto-login on 5xx, legacy matching/mismatching queue owners, account switching,
online/offline logout (including reload and cookie cleanup), actual invite
revocation and the unchanged server 403 gate, `/auth/me` 401/403, data-route 403,
detail 404 and empty-account onboarding. No unexpected JavaScript page errors;
the harness classifies WebKit's deliberately aborted local-resource reports as
expected network failures. Phone offline layout inspected; status does not cover
the words or grading controls. Part 1 ended with Parts 2–6 open; see Part 2 below.

## Part 2 — Example progress after every add

- [x] Implement and verify (2026-10-19).

**Original code findings.** `components/AddWordForm.tsx` dictionary rows use `addHit` →
`addWithChecks` → the same mutation as the main field; quick add does not simply
omit generation. `components/DictMeaningLabel.tsx` infers pending status from
`dictMeaning` / `dictDefault`, missing part of speech and a two-minute window,
not example generation. This can stop polling a dictionary-complete card before
its personalized example arrives; the runtime reproduction is recorded below.
Word pages already polled through this helper.

**Implement.** Reproduce both 顺序 add paths and establish the actual job lifecycle.
Track example readiness separately from meaning using reliable server/job state
where needed: queued, generating, ready, failed, disabled. Keep creation instant;
allow immediate card opening with «Готовим пример…». Reuse existing progress UI
and `lib/toast.tsx` where appropriate, without fake percentages. Retry recovers
without a second card; explicit «Без примера» must not look pending.

Update list and detail caches on completion, including navigation/reload during
generation. Inspect `services/vocab.ts`, `capture.ts`, `importWords.ts`,
`importWorker.ts`, `routes/words.ts`, `frontend/lib/api.ts`, pending helpers,
`app/words/page.tsx`, `app/word/[id]/page.tsx` and existing add-progress wiring.
Preserve the tracker behavior completed in the previous Reader/Mika plan.

**Acceptance.** Main field, dictionary row/plus, Reader batch, example-word popup:
create once → open immediately → visibly pending → examples arrive without reload.
Test work beyond two minutes, failure/retry, navigation/reload, disabled examples,
already-owned words, intentional separate senses and double taps. Record paths tested.

**Implementation (2026-10-19).** Reproduced both `顺序` paths: creation returned in
36/23 ms, already with a part of speech and one pool sentence; the old pending
helper returned false, then the personalized example arrived about four seconds
later. Single-card upgrades now use the durable import queue. Word records track
`enrichmentStatus` and `exampleStatus` independently; polling has no age cutoff.
The worker records queued/generating/ready/failed states, including failures after
only one of two examples. Explicit no-example cards remain disabled. Retries queue
the existing card once and preserve sense/style/level options; cancelling a retry
cannot undo the original add. Reader/popup captures track their supplied sentence's
translation; their second personalized example is still Part 3.

List rows (including phones), immediate card opening and the existing tracker show
progress; completion refreshes list/detail query and offline caches. Tracker links
use the job's actual card IDs, including same-spelling cards and skipped words.
Synchronous guards cover double taps in the form, Reader and example popup. All
new copy has ru/en/zh versions. Migration `20261019180000_card_example_progress`
adds two terminal-by-default status columns; existing examples and schedules stay
as they were. Applied only to local Docker Postgres on port 5433 for verification.

**Verification.** Backend `npx tsc --noEmit -p .` and final frontend `npx next build`
pass (existing lint warnings). `backend/scripts/check-example-progress.ts` passes:
both add variants, dictionary-complete/three-minute-old pending cards, model failure,
concurrent retry, partial-example recovery, original sense, disabled examples,
Reader translation, already-owned skip, intentional duplicates, Stop and retry
cancellation. The existing `check-enrich-fast.ts` passes, retaining two examples,
pool attribution, level targeting and three-card concurrency.

`frontend/scripts/check-example-progress.mjs` exercises real local Qwen/worker
completion with controlled job holds: main field, dictionary row/plus, two-word
Reader batch and example-word popup; open while pending, navigation/reload, list
progress, failure/retry, disabled examples, duplicate confirmation, double taps and
both IndexedDB snapshots. Desktop Chromium, phone Chromium 360, iPhone 13 WebKit
and Firefox 390 pass on the final production build, including the console check.
A held job stayed
visibly pending for 125 seconds before real worker completion without reload;
expired-lease recovery is also exercised. This is a controlled slow-job check,
not a claim about normal model latency. Screenshots: `.playwright-cli/example-progress/`.
WebKit navigation-cancelled local resource reports are classified separately, as
in Part 1. The harness lets lazy component scripts finish before full navigation
while API polling continues; this avoids a Firefox navigation-aborted chunk report.
The full desktop `check-reader-mika.mjs --fixtures` regression passes,
including tracker fade/hover/focus, links, failed-state persistence and new work.
Its fixture now includes job card IDs and its stale alignment-copy assertion was
updated to the existing UI wording. Test accounts are deleted by both harnesses.
Focused diff, ownership, migration and learner-state persistence review passed.
Parts 3–6 remain open; stop after Part 2.

## Part 3 — Capture examples, preferences and removal

- [x] Implement and verify. Completed 2026-10-20.

**Code findings.** Reader `addSelected` sends context/source but no style/level.
`routes/words.ts` uses `generateExamples: b.enrich && !useContext`; a source
sentence disables generated examples. `capture.ts:upgradeCard` also treats any
non-pool example as already having an example of its own. `importWords.ts` places
pool examples only when its flags permit. These explain the exercise fragment
without a prepared/personalized second example. `lib/learnPrefs.ts` defaults to
`casual`; main add passes chosen style/level. Audit other entry points rather than
assuming they already share those preferences.

**Implement.** Keep Reader's original sentence and source; add one useful level-fit
example in the selected sense. Prefer personalized generation using the same saved
style/level as main add; reuse an appropriate prepared sentence when generation
is unavailable and label its source accurately. Do not force three examples.
Ordinary adds keep their prepared + personalized policy. Honor «Без примера» for
generated examples while retaining intentionally captured context. Apply this
contract to quick dictionary and example/chat captures without prompting on every
tap. Do not silently rewrite imported exercise fragments as normal sentences.

Add an accessible per-example Remove action on the word page with confirmation or
undo consistent with the app. Keep the card, FSRS, other examples and Reader text.
Preserve remaining examples' ids, URLs, register, level and validation metadata.
`PATCH /words/:id` accepts an examples list: inspect `services/vocab.ts:updateWord`
before choosing it versus atomic per-example deletion, especially with concurrent
enrichment. Enforce session ownership. Support removing the last example; do not
silently regenerate it. A running/retried job must not resurrect deleted examples
or overwrite edits.

**Acceptance.** Capture 然而 from the pictured A/B/C exercise: original preserved,
one readable additional example, saved style/level and selected sense respected,
progress visible. Check formal/casual/internet, missing pool entry, «Без примера»,
failure/retry. Remove original/generated/last example; reopen/reload, check review
and Reader panels, concurrent generation and another account. Verify metadata/FSRS.

**Shipped 2026-10-20.** Reader, example/character popups and chat captures pass the
saved style and level without another picker. Captured context/source stays intact;
the durable worker adds one personalized example and translates the original.
Ordinary adds keep their existing two-example policy; no-example captures retain
only their supplied context. A checked pool sentence can stand in on generation
failure when its default sense and register fit; otherwise failure stays retryable.
Quick dictionary already uses AddWordForm's saved preferences.

Word pages now offer a confirmed, accessible Remove action per example in ru/en/zh.
The session-owned atomic endpoint removes only that row; list/detail/offline caches
update together. The additive migration `20261020065907_capture_example_choices`
adds captured-context provenance and per-card example revision/automatic-generation
controls. Edits/removals invalidate in-flight writes and disable automatic refill,
including retries; explicit manual additions still work. Full-list edits are atomic,
validate example ownership, and retain untouched metadata. No existing rows were
deduplicated or rewritten.

**Verification.** Backend `npx tsc --noEmit -p .` and frontend `npx next build` pass
in local Docker (existing frontend lint warnings remain). Local-model checks in
`backend/scripts/check-capture-examples.ts` cover casual/formal/internet, HSK level,
selected sense, missing pool, no-example, failure/retry, prepared fallback, generation
finishing after deletion, last-example removal, edits, metadata and FSRS. Existing
`check-example-progress.ts` also passes. Live Qwen runs through
`node frontend/scripts/check-capture-examples.mjs phone-webkit` and
`desktop-chromium` pass: 然而 from an A/B/C fragment keeps the exact captured text,
gets one readable HSK 4 example in the saved register, and shows progress. Both
check removal of original/generated/last, reload, Reader/review, another account,
unchanged Reader text and FSRS. Evidence and the inspected phone screenshot are
under `.playwright-cli/capture-examples`; throwaway accounts are deleted. Persistence,
ownership and concurrent-write paths were reviewed. Parts 4–6 remain open.

## Part 4 — Sentence audio controls, placement and pace

- [x] Implement and verify (2026-10-20).

**Code findings.** `components/SpeakButton.tsx` only starts playback.
`lib/speak.ts` shares one audio element, loading state and browser fallback at 0.95.
Reader inserts controls after non-word tokens containing `[.!?。！？]`, which can
produce a control beside `24.` and another isolated after a newline. Reader and
word examples share playback code; no separate slower word-page default was found.
Different clips, punctuation or fallback may affect pace; compare identical text.

**Implement.** Recognize real sentence boundaries, excluding list numbers/decimals.
Attach one compact control group to the sentence ending, keeping it with final
punctuation/word where possible, including pinyin and narrow screens. Avoid isolated
icons below paragraphs or toolbars under every line. While playing, Play becomes
Stop; expose compact 1× / 0.75× sentence speed. Use 1× as the common natural default
in Reader and My words and keep chosen speed consistent between them.

Track loading/playing/stopped for server and browser speech. Stop cancels pending
playback and delayed fallback, so audio cannot start afterwards. Guard races on
rapid sentence switches and route changes. Preserve pitch when slowing Mandarin.
Do not generate/cache separate clips just for speed. Preserve review/quiz automatic
playback and iOS audio unlocking when changing shared APIs.

**Acceptance.** Numbered screenshot, paragraphs, decimals, Chinese/Latin punctuation,
multiline/pinyin, desktop and 390px phone. Play → slow → stop → replay, stop while
loading, rapid switches, fallback, unavailable voice and route change. Compare
identical text on both pages at 1×. No duplicated controls, overlap, stuck states
or clipped onset. Listening review/quiz still works.

**Completed and verified (2026-10-20).** Reader now uses source-offset sentence
spans for playback and capture context: list markers/decimals do not add controls,
closing quotes stay with punctuation, and wrapped lines do not each get a toolbar.
One compact Play/Stop + 1×/0.75× group stays with the final word, including ruby;
My words examples use the same placement and saved sentence-speed preference.
Server playback changes speed on the existing clip with pitch preservation;
browser speech replays at the selected rate with unchanged pitch. No speed-specific
clip/cache entries are created. Word pronunciation defaults remain unchanged.

Shared playback tracks loading/playing/stopped on both engines. Stop invalidates
callbacks, clears delayed starts/voice listeners, cancels synthesis and unloads
pending media. Ownership cleanup and route/page-hide cleanup prevent late starts;
the shared iOS-unlocked element and browser onset primer are retained.

Checks: backend `npx tsc --noEmit -p .` (refreshed stale local generated Prisma
client first); frontend `npx next build` passes with existing lint warnings.
`node frontend/scripts/check-sentence-audio.mjs` covers list/decimal/quote/paragraph
boundaries and exact text reconstruction, stale media/utterance/rejection callbacks,
stop during voice loading/cancel delay, rate changes, unavailable voices and unlock.
`node frontend/scripts/check-sentence-audio-ui.mjs` passes Russian 390px WebKit and
desktop Chromium against the production build: pinyin layout without overflow or
isolated controls, play/slow/stop/replay, held-response cancellation, rapid switching,
fallback/end/unavailable voice, internal navigation/reload, review and quiz audio.
Chromium plays the real Qwen MP3: identical text uses the same URL, duration and
1× rate in Reader/My words. Windows WebKit cannot play this MP3 in the test runtime;
its fallback uses a controlled speech engine, so physical iOS audio/listening is
not claimed. Evidence: `.playwright-cli/sentence-audio` (layouts, screenshots,
pace comparisons and local MP3). Throwaway local accounts are cleaned up.

## Part 5 — Compact popups and accurate Reader copy

- [x] Implemented and verified on 2026-10-20.

Shared example/chat/scene popups now size to content (240px maximum), use Reader's
compact hierarchy, omit «НОВОЕ», and show a compact add/saved state. Measured
placement handles viewport corners, asynchronous content, visual viewport changes
and long-content scrolling. Example words support Enter/Space; Escape and close
restore focus. Ownership is checked from the account's word query even on a cold
card link; Add stays disabled until that check succeeds, with retry on failure.
Batch capture now checks duplicates within the exact language pair: a saved
Chinese→English word no longer makes Chinese→Russian capture silently skip it.
No existing cards or separate senses were changed; no schema migration.

Reader hints follow auto-gloss, not underlines, omit repeated legend explanations,
and show the saved-word instruction only when that pair has saved words. ru/en/zh
verified; the existing mobile bottom popup and centered second card remain.

Checks: backend `npx tsc --noEmit -p .`, frontend `npx next build` (existing warnings),
and local Russian phone WebKit / desktop Chromium learner flows in
`frontend/scripts/check-compact-popups.mjs`. Verified 长 capture, other-pair
preservation, same-pair repeat skip, saved status on cold navigation/reload,
keyboard/focus, compact width, both bottom corners, loading/failure states,
Reader 语言, auto-gloss and underlines on/off, ru/en/zh hints, empty-deck hints,
desktop hold, and the shared chat/hidden scene callers without exposing features.
Visual evidence: `.playwright-cli/compact-popups`; throwaway accounts removed.
Source review checked account/pair scoping and preserved existing records.

**Separate mobile request (2026-10-20).** The small Reader word popup stays at
the bottom with its existing layout. Only the second popup, opened by «Открыть
карточку», is centered in the visible viewport and cannot be dragged on phones;
long cards scroll internally. Follow-up: close sits beside the word, with the empty
mobile title strip removed, and stays accessible while scrolling. Mobile hold-to-open
is removed; tap the saved word,
then open its card. Reader hints match this in ru/en/zh; desktop hold remains.
This scoped change does not complete the shared-popup work below.
Verified with backend tsc, frontend production build (existing warnings), and
Russian mobile WebKit at 390px/320px: bottom popup, centered second card, attempted
drag, internal/page scrolling, hold removed, Escape/outside/close and viewport fit.
Evidence: `.playwright-cli/reader-centered`; throwaway local account removed.

**Code findings.** `components/WordMeaningPop.tsx` serves example/chat lookups,
uses a fixed 228px width and uppercase `pop.new`. Reader renders its own smaller
popup in `app/reader/page.tsx`. Reader combines `reader.tapHint` / `tapHintPlain`
with `holdHint`; the last incorrectly promises contextual meaning on hold. Saved
word hold actually opens the card panel; short tap already looks up/selects words.

**Implement.** Match Reader's compact spacing/hierarchy and content-based width;
keep word/audio, reading, meaning and compact add/already-added state. Remove
«НОВОЕ». Preserve loading/errors and ownership state, including when the word list
is not in cache. Support viewport edges, phones and keyboard. Share presentation
where useful without rewriting unrelated interaction behavior.

Suggested ru: «Нажми на слово — увидишь перевод. Незнакомые можно выбрать и
добавить.» Only when saved words exist: «Зажми добавленное слово, чтобы открыть
карточку.» (Desktop only; mobile uses the tap/open-card flow above.) Keep the visual
legend instead of repeating dashed/faded explanations.
Verify wording with auto-gloss enabled/disabled; adapt en/zh.

**Acceptance.** Example's 长 and Reader's 语言: compact consistent popups, no
«НОВОЕ», correct add/added status before/after navigation/reload. Unknown/saved
words, tap/hold, auto-gloss, underlines on/off, viewport edges, phone. Check shared
callers (examples, Mika/chat, existing hidden scene surfaces) without exposing them.

## Part 6 — Short-word pronunciation and tones

- [x] Implemented and verified (2026-10-20), including comparison with part 4 at 1×.

**Final result.** Author accepted Zhijia after comparing isolated xu4 with a human
recording: “okay if natives say like that … this zhijia is awesome”. Short words
(1–4 Han characters) now use Bailian `sambert-zhijia-v1`, native 48 kHz, plain
text, pitch 1.0; single characters use synthesis rate 1.25, longer words 1.0.
Playback stays at 1×. Sentences retain Qwen/Cherry, their existing cache keys,
URLs and 1×/0.75× behavior. No carrier sentences, trimming or pitch processing.

- Added bounded Sambert WebSocket transport with provider failure, early close,
  malformed response, empty/oversize audio and 30-second timeout handling. Failed
  provider/encoding jobs never reach the cache and can retry on a later tap.
- Word MP3 uses 96 kbps; sentence encoding remains 48 kbps. Word DB keys include
  model/rate/`dictionary-v3`/encoding, browser URLs use `v=word-3`; no global wipe.
  Usage logs the actual model; [Sambert pricing](https://help.aliyun.com/en/model-studio/model-pricing)
  is ¥1/10,000 input characters. Uses the existing Bailian Beijing key/endpoint.
- Removed production ASR screening/retries and the superseded no-store experiment.
  Live checks consistently transcribe the reviewed isolated xu4 as 戏, including
  raw WAV before encoding (normal raw take also produced 细雨). That transcript
  must not force browser fallback or certify tones. ASR remains diagnostic only;
  five other final clips match recognized readings. No claim of universal tone
  correctness or disambiguation of every polyphonic dictionary reading.
- Passed backend `npx tsc --noEmit -p .`, frontend `npx next build` (existing lint
  warnings), deterministic cache/concurrency/failure checks and real-route/local
  WebSocket checks including the timeout. Six live fresh/cache clips have identical
  replay bytes and DB reads of 2–5 ms. `check-tts-words.ts` retains the 序 ASR mismatch.
- Final Russian phone and desktop Chromium checks: all six real MP3s/replays,
  auth, range/immutable cache, new word URLs, slow word clip with pitch preserved,
  Cherry sentence 1×/0.75× and matching Reader/word-page clip/rate; controlled
  fallback passes. Throwaway users cleaned up. Six native-WAV/final-MP3 waveform
  comparisons have correlation ≥0.9895 and no gross truncation. Existing Windows
  WebKit API-media fallback and actual Safari voice acoustics remain unverified.
- Final listening fixtures: `http://127.0.0.1:8766/zhijia-service/`; repeatable
  diagnostic scripts and earlier comparisons below. Native reference recordings
  are not shipped in the app; their unspecified upstream license version therefore
  does not block this selected TTS implementation. No schema migration.

**Investigation record.** Earlier experiments and interim pending decisions below
are superseded by the final result above.

**Original code findings.** `services/tts.ts` used Bailian `qwen3-tts-flash` / `Cherry`
by default and cached MP3. Words of 1–4 Han characters get a full stop and up to
three ASR-checked takes. The check uses `toneType: "none"`; it checks syllables,
not tone accuracy. `scripts/check-tts-words.ts` also ignores tones. This establishes
a verification blind spot, not the actual tone of the author's audio clip.

**Investigate first.** Locally compare 顺 (shùn), 序 (xù), 顺序 and the characters
in short natural sentences. Save fixtures inside the project, identify provider/
fallback, and compare fresh/cache, appended punctuation, compression/onset and
1×/slow playback. Read current official Bailian docs before selecting supported
pronunciation controls or a new voice/model; retain Qwen/Bailian only. Recognized
text and its pinyin do not constitute acoustic tone verification.

Make the smallest evidence-backed change to synthesis input/settings, supported
pronunciation guidance, voice/model or cache handling. Do not add audible hidden
carrier sentences or cut them out using guessed timestamps. Version affected cache
keys when behavior changes; avoid a global cache wipe. Provide repeatable listening
fixtures, record subjective/unverified aspects and include human listening feedback
when automated evidence cannot establish tone accuracy.

**Acceptance.** Listen to fresh/replayed 顺/序/顺序 and existing 味/儿/味道 fixtures,
alone/in context, normal/slow. No extra syllables, wrong language or clipped onset;
cache hits retain speed. Record model/provider and limits. Do not claim accurate
Mandarin tones solely because the current ASR tests pass.

**2026-10-20 implementation and investigation.** Kept Bailian Beijing
(`dashscope.aliyuncs.com`), `qwen3-tts-flash` / Cherry, Chinese, 24 kHz WAV →
48 kbps MP3. No model/voice switch, carrier sentence, trimming, migration or global
cache wipe. Current [Qwen API](https://help.aliyun.com/zh/model-studio/qwen-tts-api),
[voice list](https://help.aliyun.com/en/model-studio/qwen-tts-voice-list) and
[instruction scope](https://help.aliyun.com/en/model-studio/non-realtime-tts-user-guide)
were checked. Instructions are scoped to Instruct models, not the configured base
model. Both `qwen3-tts-instruct-flash` and `qwen3-tts-flash-2025-11-27` returned
404 / “Model not exist” on the configured endpoint; neither is a dependency.

- Controlled raw/full-stop WAV and MP3 fixtures: 18 each for Cherry and Serena;
  Ethan was also sampled, with no clear recognition advantage and intermittent
  provider timeouts. Sentences consistently transcribed correctly; isolated takes
  sometimes added syllables or changed the recognized reading. ASR itself varies
  on identical audio, so its transcript remains only a filter.
- Author listening feedback: both sentence voices good, isolated Hanzi weak;
  Cherry bare 味道 natural, full-stop version lacked the same fourth-tone feel;
  raw 儿 (“儿爷” transcript) sounded interrupted; raw 序 (“去”) too long/weak.
  Serena sometimes clearer but 味道 overly expressive. Retained Cherry; no blanket
  claim that another voice fixes dictionary pronunciation.
- Prefer bare input for 2–4 Han characters, full stop first for single characters;
  alternate punctuation after a rejected take. Compare recognized numbered
  readings, rejecting 二/儿 and 嘘/序 mismatches previously accepted tonelessly.
  This cannot establish acoustic tones or solve every polyphonic reading.
- After three rejected takes, use the existing synthesis-error/browser fallback;
  never retain a rejected “closest” take. An ASR outage can play the provider take
  with no DB storage and HTTP `no-store`, including range responses.
- Short-word DB keys use `heard-v2`; browser URLs add `v=word-2` to bypass old
  year-long immutable entries. Sentence keys, URLs and playback speed stay intact.
- Passed backend `npx tsc --noEmit -p .`, frontend `npx next build` (existing
  warnings), deterministic `check-tts-policy.ts`, real-route `check-tts-http.ts`,
  and existing `check-sentence-audio.mjs`. Final real `check-tts-words.ts`: all six
  recognized readings match, fresh/cached bytes identical, DB replay 1–3 ms.
  Initial runs exposed a provider timeout and all-three rejected 序 takes;
  those failures were retained in the investigation, not counted as successes.
- Phone and desktop Chromium: six real word MP3s/replays, auth/range/immutable
  cache, new short-word URLs, sentence 1×/0.75×, same Reader/word-page clip and
  pace, controlled fallback pass. Throwaway accounts removed. Windows WebKit
  native API media returns `NotSupportedError` and falls back; Part 4's saved
  `phone-webkit-pace.json` already records browser-fixture fallback. Its actual
  browser voice and Safari device acoustics remain unverified.
- Eighteen WAV/MP3 comparisons preserve waveform correlation (>0.85), full length
  and ~46 ms encoder delay; no gross onset/tail truncation detected. This does
  not prove pronunciation or perceptual quality at either playback speed.
- Repeatable fixtures: `backend/scripts/inspect-tts.ts [voice] [model]`,
  `check-tts-words.ts [words…]`; artifacts in `.playwright-cli/word-audio`.
  Serve there with `python -m http.server 8766 --bind 127.0.0.1`; `/Cherry/` and
  `/Serena/` have IDs 01–18, `/service/` has the six final fresh/cache pairs and
  pitch-preserving 1×/0.75× controls. Browser check:
  `node frontend/scripts/check-word-audio.mjs [phone-chromium|desktop-chromium]`.

**Author rejection and second-system investigation (2026-10-20).** The author
rejected the revised `/service/` clips: isolated words still sound too relaxed,
especially the drawn-out ending of 味道. Sentence Cherry remains good. The author
explicitly authorized checking other pronunciation systems, superseding this
part's original Qwen-only restriction for isolated-word pronunciation.

- Both CosyVoice v2 (`longxiaochun_v2`, `longxiaoxia_v2`) and Sambert
  (`sambert-zhichu-v1`) work through the existing Bailian Beijing key. Generated
  six bare words plus two sentence controls per candidate, original WAV only.
  CosyVoice HTTP synthesis also responds successfully; Sambert uses the documented
  one-way WebSocket protocol. No new provider account or production switch.
- Repeatable script: `backend/scripts/inspect-tts-engines.ts
  [probe|fixtures|recognize]`. Its diagnostic `ws@8.22.0` dependency is confined to
  ignored `.playwright-cli/tts-tools` (installation command is in the script).
  `/engines/` on the same local listening server compares A = current Cherry,
  B/C = CosyVoice, D = Sambert, with unique IDs such as `6-D` and 1×/0.75× controls.
- All 24 generated WAVs parse as mono PCM; all 30 comparison URLs are available.
  Phone Chromium plays the Sambert WAV at pitch-preserving 0.75×. Sambert's 味道
  fixture is 0.425 s versus 0.720 s for these CosyVoice fixtures; shorter duration
  is not evidence of correct acoustic tones.
- One ASR screen of all 18 isolated alternatives: all six Sambert recognized
  readings match; both CosyVoice candidates' 顺 was recognized as 愤/份 and 儿
  as 嗯. These results help reject candidates but do not establish tone accuracy.
- Corrected the original diagnostic's overly specific `wèidào` label: the shipped
  CC-CEDICT entry for 味道 is `wei4 dao5` (neutral 道), while pinyin-pro returns
  `wei4 dao4`. This distinction does not settle the author's concern about drawn-out
  delivery. Dictionary-supported pronunciation controls should use dictionary
  readings when a provider is selected, rather than treating ASR pinyin as truth.
- Official references: [Sambert protocol](https://help.aliyun.com/en/model-studio/sambert-client-events),
  [CosyVoice voice list](https://help.aliyun.com/en/model-studio/cosyvoice-voice-list),
  [CosyVoice HTTP API](https://help.aliyun.com/en/model-studio/cosyvoice-tts-http-api),
  [SSML pronunciation controls](https://help.aliyun.com/en/model-studio/ssml-latex-user-guide).
  Sambert is Beijing-only; documented price is ¥1/10,000 input characters,
  CosyVoice v2 ¥2/10,000 ([pricing](https://help.aliyun.com/en/model-studio/model-pricing)).

**Remaining acceptance:** author comparison of `/engines/` was requested. Select
and integrate an acceptable word provider, keep Cherry sentences, version affected
caches again, and run the focused final checks before marking Part 6 complete and
pushing. Existing source changes remain experimental and uncommitted. Do not
describe ASR readings or waveform checks as proof of accurate Mandarin tones.

**Further author feedback and refined candidates.** The author confirmed B/C
read 顺 like “fen” and fail 儿; D has better pronunciation but a dirty/unpleasant
timbre and too-short 儿. Cherry remains preferred for sentence voice quality.
The base Cherry model has no documented instruction control; the tested Instruct
model is unavailable. No claim that prompt text can reliably repair its tones.
The author briefly proposed trimming elongated vowels, then explicitly cancelled
that idea because the main issue is tone pronunciation. No audio trimming or
duration-compression changes were made.

`inspect-tts-engines.ts refined` generated a separate `/engines/refined.html`:
E = Sambert Zhiqi (gentle female, native 48 kHz), F = Sambert Zhijia (standard
female, native 48 kHz), both synthesized at 0.9× to address the short-word pace;
G = CosyVoice v2 Anpei (education/training voice) with supported SSML phonemes
explicitly specifying the dictionary readings. Pitch is unchanged; the raw source
WAVs are preserved. The initial Zhichu comparison used 16 kHz; these new Sambert
voices use their documented 48 kHz source rate.

The refined ASR screen accepts five E readings (序 → 去) and five F readings
(序 → 戏); G recognizes 顺/序/顺序/味/味道 correctly or as same-reading homophones,
but 儿 → Latin “r”. These are unresolved candidate-screen limitations, not acoustic
tone assessments or production acceptance. All six words plus two context controls
are saved per candidate, with stable IDs `1-E`…`6-G`. Await listening feedback
before choosing/integrating a provider. Sentence Cherry is unchanged.

**Acoustic check requested by the author.** Anpei's tones sounded acceptable but
its voice/pitch too electronic; Zhiqi too soft. Zhijia's timbre was preferred,
with a concern that isolated 序 sounded prolonged and third-tone-like while the
final 序 in 顺序 sounded fine. No switch was authorized as fully accepted.

- Added normal-rate Zhijia probes (`inspect-tts-engines.ts zhijia-pitch`): 序,
  顺序, both with punctuation, same-vowel 虚/徐/许 controls for tones 1/2/3,
  homophone 续 and fourth-tone 去. Original refined F samples remain at 0.9.
- `python -B backend/scripts/analyze-word-pitch.py` measures actual PCM with
  Parselmouth 0.4.7 / Praat 6.1.38, raw autocorrelation and raw cross-correlation,
  5 ms frames, pitch floors 70/100/130 Hz, ceiling 600 Hz and a voicing/energy gate.
  Local dependencies are under `.playwright-cli/tts-tools/python`.
- In the actual reviewed F samples, isolated 序's measured voiced vowel spans
  ~280 ms and falls from ~305 to 166 Hz; word-final 序 spans ~155 ms, ~252 to
  162 Hz (CC70; start/end are medians over the first/last 20% of the interval).
  This establishes a real duration/register difference. The isolated contour is
  consistently falling across all six tracking settings; the same-voice 许
  control dips and then rises. These samples do not support calling isolated 序
  third tone solely on the basis of its pitch contour. This is not a native
  listener's certification of ideal teaching pronunciation.
- At synthesis rate 1.0 the corresponding spans are ~265/130 ms, so removing the
  0.9 setting barely changes the isolated contour or solves the relative length.
  Full stops produce essentially the same isolated contour. 序 and homophone 续
  have essentially matching curves. No source audio was trimmed or modified.
- One raw-AC70 trace doubles F0 at the tail of the word sample; cross-correlation
  and AC at floors 100/130 continue falling. It is flagged as a possible octave
  error; raw tracks and sensitivity results are preserved rather than treating
  this one trace as a real rising tone.
- Sambert streaming WAVs contain placeholder ~2 GB length fields. Analysis parses
  only actual PCM bytes, avoiding Praat padding the missing samples. Listening
  copies fix only container lengths and assert PCM identity; source hashes and
  PCM hashes are in the report. No pitch/time processing or cropped carrier.
- Report, plots, source listening copies and full measurements:
  `http://127.0.0.1:8766/pitch/`, `.playwright-cli/word-audio/pitch/`.
  Voicing spans are algorithmic and exclude unvoiced /x/, not exact syllable
  boundaries. Artifact PNGs visually reviewed. This follow-up changes diagnostic
  scripts/docs only; app builds and learner flows were not repeated.

Part 6 remains open for the final pronunciation/provider decision and integration;
the acoustic result explains the observed difference without silently switching
voices or claiming that every Zhijia fourth tone is correct.

**Focused diction test after the author asked how to proceed.** No app/provider
switch was made: normal-rate Zhijia had not resolved the perceived isolated tone.
Sambert's current [SDK reference](https://help.aliyun.com/zh/model-studio/sambert-python-sdk)
links supported [SSML pinyin controls](https://help.aliyun.com/zh/isi/user-guide/ssml-overview).
`inspect-tts-engines.ts zhijia-diction` now compares A = plain rate 1.0,
B = explicit numbered pinyin at 1.0, C = plain rate 1.25, D = pinyin at 1.25.
All native 48 kHz; no trimming, carrier, or client pitch/speed processing.
- Six inputs: 序, 顺, 味, 去, 顺序, 味道 (the latter explicitly wei4 dao5 in B/D).
  Explicit pinyin barely changes the four isolated fourth-tone contours/durations.
- `analyze-word-pitch.py --diction` retains all six Praat tracker settings per take.
  For 序, measured voiced interval is A/B 265 ms, C 220 ms, D 210 ms. CC70
  start/end remain about 304→168 Hz (A) and 307→166 Hz (D). Whole clip
  487.5→390 ms. This establishes shorter delivery, not human tone acceptance.
- Listening page: `http://127.0.0.1:8766/engines/zhijia-diction.html`.
  Start with **1-A vs 1-C**, then 1-D; other words are controls, not a required
  24-clip listening sweep. Browser verifies all 24 valid durations at playback 1×
  and first-row four clips play to completion at phone width. PCM identity checked
  when repairing only the WAV length headers. Full measurements are in ignored
  `.playwright-cli/word-audio/diction-measurements/measurements.json`.
- Recommendation pending listening: use shorter native synthesis for isolated
  characters only if the delivery is acceptable; retain Cherry sentences. If it
  is still unclear, investigate reviewed/licensed native recordings. No recording
  source selected, downloaded, or integrated. Part 6 remains open; no final
  production switch, completion claim, commit, or push.

**Native reference follow-up.** Author reports 1-C is better but still less clear
than 序 inside 顺序; faster synthesis is a partial improvement, not acceptance.
- Added `npx tsx scripts/inspect-native-words.ts`: downloads unchanged public MP3
  references from [Audio-cmn](https://github.com/hugolpz/audio-cmn), pinned commit
  `59dbafbda8b172ffc3b8b295cd5938ae1b3de803`, with SHA-256, source URLs,
  speaker/credits, upstream README and missing-file records. No learner data.
  Source states CC BY-SA; its README does not specify a version. Production
  licensing/attribution must be resolved before integrating a selected set.
- `/native/` compares Chen Wang's **1-P, standalone xu4**, with shorter Zhijia
  1-C. Yue Tan's word corpus lacks standalone 序 and 儿; those missing files are
  not disguised as available recordings. The syllable set supplies xu4 and er2;
  five whole-word references cover 顺, 味, 去, 顺序, 味道. No syllable stitching.
- Ten native MP3s downloaded; browser verifies all ten plus twelve existing TTS
  controls have valid metadata at playback 1×, and native xu4/顺序/味道/er2 play
  to completion at phone width. Public listening page has credits/source links.
  No app implementation changed and no app builds repeated for this probe.
- Author asked to compare only 1-P and 1-C, establishing whether an actual isolated
  native reading meets the requested delivery. Human review and final integration
  remain pending. Sentences remain Cherry. No completion claim/commit/push.

## Finishing each implementation session

Run backend `npx tsc --noEmit -p .` and frontend `npx next build` from their
directories, plus meaningful logic tests and the part's local learner flows under
`.claude/commands/task.md`. Record evidence next to that part; only then check it
off and update backlog/handoff. Commit explicit files and push verified finished
work to main under the project rules. Stop after the selected part.

Session prompt: `Implement Part N of PLAN-learner-bug-batch.md. Complete and verify
only that part, update its status and SESSION.md, then commit and push the verified
changes. Preserve unrelated work and follow AGENTS.md.`
