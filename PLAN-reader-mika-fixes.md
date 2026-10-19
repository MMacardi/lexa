# Reader and Mika fixes from the author's screenshots

Requested 2026-10-19. All eight parts are complete. The author explicitly requested the
whole remaining plan in this session, overriding the original one-part-per-session scope.
Record verification here and in the backlog. Preserve unrelated local changes. Russian copy and local learner flows
come first; all new UI strings need Russian, English and Chinese.

Landing copy, layout and screenshots change only when the author explicitly asks for them.
Do not automatically start a final pass. When asked what is next, a reminder is welcome.

The existing grouped-words task has parts 1–3 finished; its seven-day check waits until
approximately 2026-10-21. It is not a blocker for this explicitly requested bug pass.

## Ordered sessions and acceptance criteria

1. [x] **Reader underlines and saved-word popups.** Done 2026-10-19. Offer a persistent switch to hide
   word underlines, on desktop and phone. Selection, adding words and opening cards still
   work with underlines off. Show the saved card's pinyin/transcription in its small popup,
   rather than recomputing a potentially different reading. A second tap on the same word
   closes its popup; tapping another word opens that word. Check keyboard interaction too.

2. [x] **Reader text management.** Done 2026-10-19. Add Delete to the open saved text with the existing
   delete confirmation. Replace the confusing saved-status action with a clear status and
   an Edit text action opening the existing full editor (the current Saved action), including
   title/collection and content. Remove the redundant button that returns to the paste box.
   Verify edit/save/reopen and deletion locally on desktop and phone.

3. [x] **Mika can read the open Reader text and offer text hand-off.** Send the active
   Reader text and the selected word/sentence as explicit context when Mika is opened there.
   Asking “read the text I am reading” must work without pasting it again. For text pasted
   or read from a photo in chat, offer a real Add/Open in Reader action, including when
   explicitly asked. Reuse Reader's save/open path; avoid false “saved” claims and duplicate
   texts. Handle long text with a stated boundary, not silent clipping. Check both Mika
   surfaces, history/reload, ownership and zh→ru. Changed prompts require the identity and
   formatting checks as well as a real Qwen run through Bailian.

4. [x] **Focused word suggestions.** A question about 无论 should offer 无论 first, without
   automatically filling the card chooser with 都/也/谁/什么/哪里/怎么/多少 from its explanation.
   Distinguish the question's subject from incidental example vocabulary. Additional words
   are appropriate when requested or deliberately recommended at the learner's level.
   Audit client extraction as well as the model's addWords. Keep explicit bulk requests working.

5. [x] **Enrichment notifications disappear when idle.** Completed cards fade out after
   inactivity; pointer/focus interaction pauses dismissal. Newly added words become visible
   immediately and restart the timer; old completed words must not obscure new work. Keep
   running/error progress useful, card links clickable, and a sensible size for batches.

6. [x] **Names in context translations and the related-word audit.** Trace the screenshot's
   小雨 → “Мелкий дождь” through capture, Reader translation and My words examples. Preserve
   person names as names using surrounding context, while literal 小雨 weather still translates
   as light rain. Check new and cached translations without silently overwriting learner edits.
   Explain the existing related-word algorithm from actual code/data. For 复杂 vs 难, explain
   complexity vs difficulty; do not force a synonym edge merely because Russian glosses overlap.
   Fix verified bad relations if the audit finds them, with focused regression examples.

7. [x] **Longer Mika dialogue context.** Verified starting point: client SEND_MESSAGES = 12;
   server tutorChat slices to the last 12 messages and 2000 characters per message. Audit
   HTTP limits, card-chat path and history storage too. Use a bounded token/character budget
   with older context retained through a summary or a larger window; make any remaining
   limitation understandable. Never discard the current question or overwrite newer turns
   with a stale summary. Verify recall after at least 15 user/assistant exchanges, reload,
   switching saved chats, and photo turns. Run chat identity/format checks and record cost.

8. [x] **Chinese selection aligned with full translation.** Return
   validated source/translation spans alongside whole-text translation; tapping a Chinese
   word highlights its Russian counterpart. Support many-to-one mappings (妈妈的 → “мамин”)
   and particles without a standalone translation, falling back to a phrase/sentence when
   precise alignment is unavailable. Define offsets consistently, validate bounds and cache
   compatibility. Verify repeat words, punctuation, sentence reordering, desktop and phone.

## Verification and hand-off

- Local Docker only; never test against production data.
- Backend TypeScript check and frontend build for each implementation part. Complete the
  changed learner flow locally; include narrow regression scripts where they test behavior.
- No new LLM provider: Qwen through Bailian only. No model pass over all stored data without
  first estimating its size/cost and following the established project workflow.
- Begin a fresh session with: “Read AGENTS.md and CLAUDE.md; continue the first unfinished part
  of PLAN-reader-mika-fixes.md. Do not change the landing.”

## Completed work

### Reader underlines and saved-word popups — 2026-10-19

- Added Word underlines on desktop and to the phone's reading-tools sheet; it hides HSK
  and learning underlines and their legend. Selection and saved-card actions still work.
  The hint changes when markings are hidden. The setting lives in this browser's existing
  learner-preferences store and survives reloads.
- The saved-word popup displays the card's own phonetic field. Repeated tap closes it,
  tapping another word reanchors it, and Enter/Space open/close it. Pointer-down on the
  anchor no longer starts an outside-click close timer before pointer-up.
- Verified with a throwaway account against local Docker: desktop Chromium at 1280 px and
  phone Chromium (360 px), WebKit (390 px), Firefox (390 px). Checked pinyin, repeated taps
  including a 220 ms press, switching words, keyboard, unknown-word selection, persistence
  after reopening the autosaved text, both underline states and horizontal overflow. Also
  added 图书馆 through the Reader's real batch action with underlines off (HTTP 201 and
  the card in the account's words). No
  browser errors. Screenshots inspected locally; no landing assets changed.
- Backend `npx tsc --noEmit -p .` and frontend `npx next build` pass. Build reports existing
  lint warnings in Reader and other files; no new warning introduced by this part.
- Continued with part 2 below; the remaining work was subsequently completed in the full pass.

### Reader text management — 2026-10-19

- Saved is a status; Edit text opens the existing full editor for title, collection,
  level and content. Removed the second edit action that returned to the paste box.
  The desktop toolbar and phone reading-tools sheet both offer Delete, using the app's
  existing confirmation dialog with the text's title and a reminder that cards are kept.
- Saving updates the passage on screen and the same saved row, without duplicates.
  Metadata edits preserve the cached translation and reading history, including when
  the same text was pasted again. Content edits clear the old translation and selections;
  editing waits for any whole-text translation already in flight. New text and successful
  deletion return to an empty input. Failed deletion leaves the text open for retry.
- Verified in Russian against local Docker with throwaway accounts: desktop Chromium
  (1280 px), phone Chromium (360 px), WebKit (390 px) and Firefox (390 px). Completed
  title/collection/content edit, save, reload and reopen; autosave reuse; cancellation,
  simulated failed deletion and successful retry; absence after reload; cards retained.
  Also checked cached translation/history preservation and the pending-translation guard.
  No browser errors or horizontal overflow; editor and confirmation screenshots inspected.
- Backend `npx tsc --noEmit -p .` and frontend `npx next build` pass, with the existing
  lint warnings only. No schema changes or LLM prompt changes. Test accounts removed.
- Parts 3–8 were subsequently completed in the full pass below.

### Related-word audit — 2026-10-19

- `frontend/components/WordFamilyGraph.tsx` renders the card's stored synonyms and
  antonyms, deduplicated and limited to six neighbours on phones or eight on desktop.
  It does not infer relations from Russian glosses or embeddings. When both arrays
  are empty, it requests the family once from `backend/src/services/vocab.ts`.
- `wordFamily` keeps existing relations; otherwise Chinese-to-Russian cards use the
  shared HSK page in `backend/data/hsk-pages.jsonl`. Words without a shared page use
  a Qwen dictionary call in the card's sense. `capture.ts` supplies these shared
  relations at capture and preserves non-empty learner lists during enrichment.
- Actual page data: 复杂 → synonym 棘手, antonyms 简单 / 单纯; 难 → synonym 困难,
  antonym 简单; 困难 → synonyms 难 / 艰难, antonym 容易. 棘手 describes something
  troublesome to handle and can connect to both complexity and difficulty in context.
- 复杂 means complex or intricate (many interacting parts); 难 means difficult
  (requires effort or skill). Both can be «сложный» in Russian, but that overlap
  does not make them interchangeable synonyms. No forced 复杂 ↔ 难 edge or mass
  relation rewrite was made; the regression checks protect this distinction.

### Full remaining pass, parts 3–8 — 2026-10-19

- Mika receives an explicit account-scoped snapshot of the Reader passage, selected word
  and sentence. It survives panel/full-page transitions and saved chat reloads. Saved text
  ids are ownership checked. Pasted/photo text can be opened through a real Reader save
  action; identical concurrent hand-offs reuse the same row. Reader context and individual
  questions have a visible 20,000-character boundary rather than silent truncation.
- Focused questions offer their Chinese subject (tested with 无论), while explicit bulk
  requests retain multiple suggestions. The client does not extract incidental example
  vocabulary. Completed enrichment fades after 6.5 seconds idle; hover/focus pauses it,
  new batches show immediately, and running/error progress and card links remain useful.
- Context prompts distinguish the person 小雨 / Сяоюй from literal light rain. Gloss caches
  include sentence and language pair. Background translation filling uses compare-and-set
  to preserve learner edits. Existing example translations can be regenerated as a draft:
  Cancel preserves the card, Save applies it, and late replies cannot overwrite typing.
- Mika and card follow-ups use up to 120 whole messages within 64,000 UTF-16 characters.
  Older messages outside that window are omitted; there is no summary or unlimited memory.
  Account history accepts 120 messages / 2 MB. Account-scoped tab mirrors, load-generation
  guards and continuation reconciliation protect newer turns and photos during reloads
  and history switches. Small autosaves use fetch keepalive during navigation.
- Chinese translation alignment stores validated UTF-16 spans tied to the exact source
  and translation. Qwen selects numbered word/sentence units; server code derives offsets.
  Repeated forms stay inside their paired sentences, including reordered translations.
  Many-to-one phrases and sentence fallback cover possessives and untranslated particles.
  Selection survives token regrouping and scrolls its Russian highlight above phone controls.
  Existing translations can be aligned without rewriting them. Source/translation edits
  invalidate mappings; stale asynchronous saves are rejected. The existing translation
  boundary is shown at 6,000 characters. Added the nullable Reader alignment migration
  `20261019000000_reader_alignment` and applied it only to the local test database.
- Verification: backend TypeScript and frontend production build pass (existing lint
  warnings only). `backend/scripts/check-reader-mika.ts` passes against local Docker with
  real Qwen/Bailian: ownership, five concurrent identical hand-offs, 13,500-character Reader
  context, focus/bulk/photo, names/weather, cached/manual edits, alignment validation and
  reordering, 16 dialogue exchanges plus recall/history/photo/card follow-up. Its final
  suite used 32 model calls, estimated ¥0.0458. Chat identity and formatting checks pass.
- `frontend/scripts/check-reader-mika.mjs` passes in Russian on desktop Chromium and phone
  Chromium (360 px), WebKit (iPhone 13) and Firefox (390 px), replaying those verified Qwen
  chat outputs; example retranslations remain live. Covered both Mika surfaces, reloads,
  account/history isolation, photo persistence, save/open/deduplication, explicit limits,
  alignment/keyboard/repeated words/phrase fallback, notification timing and example draft
  cancellation/save/concurrent edits. No browser errors or horizontal overflow. Screenshots
  inspected locally. A final desktop run with live Qwen responses also passes, including
  photo reload, long-chat recall and hand-off. The existing Reader management regression
  also passes. No landing changes.
