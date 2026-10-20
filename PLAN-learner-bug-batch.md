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
the words or grading controls. Parts 2–6 remain open.

## Part 2 — Example progress after every add

- [ ] Implement and verify.

**Code findings.** `components/AddWordForm.tsx` dictionary rows use `addHit` →
`addWithChecks` → the same mutation as the main field; quick add does not simply
omit generation. `components/DictMeaningLabel.tsx` infers pending status from
`dictMeaning` / `dictDefault`, missing part of speech and a two-minute window,
not example generation. This can stop polling a dictionary-complete card before
its personalized example arrives: a likely contributor, not a reproduced runtime
diagnosis. Word pages already poll through this helper.

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

## Part 3 — Capture examples, preferences and removal

- [ ] Implement and verify. Depends on part 2's readiness contract.

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

## Part 4 — Sentence audio controls, placement and pace

- [ ] Implement and verify.

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

## Part 5 — Compact popups and accurate Reader copy

- [ ] Implement and verify. Independent if explicitly selected.

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
карточку.» Keep the visual legend instead of repeating dashed/faded explanations.
Verify wording with auto-gloss enabled/disabled; adapt en/zh.

**Acceptance.** Example's 长 and Reader's 语言: compact consistent popups, no
«НОВОЕ», correct add/added status before/after navigation/reload. Unknown/saved
words, tap/hold, auto-gloss, underlines on/off, viewport edges, phone. Check shared
callers (examples, Mika/chat, existing hidden scene surfaces) without exposing them.

## Part 6 — Short-word pronunciation and tones

- [ ] Implement and verify. Compare with part 4 at 1×.

**Code findings.** `services/tts.ts` uses Bailian `qwen3-tts-flash` / `Cherry`
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

## Finishing each implementation session

Run backend `npx tsc --noEmit -p .` and frontend `npx next build` from their
directories, plus meaningful logic tests and the part's local learner flows under
`.claude/commands/task.md`. Record evidence next to that part; only then check it
off and update backlog/handoff. Commit explicit files and push verified finished
work to main under the project rules. Stop after the selected part.

Session prompt: `Implement Part N of PLAN-learner-bug-batch.md. Complete and verify
only that part, update its status and SESSION.md, then commit and push the verified
changes. Preserve unrelated work and follow AGENTS.md.`
