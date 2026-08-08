# Lexa — Ideas & Roadmap

Living backlog of cool ideas. Add here whenever something interesting comes up.
Status: ✅ done · 🔨 building · ⏭ approved/next · 💡 idea · 🧊 later

---

## Done
- ✅ **Cloze cards from examples** — Quiz has a "Fill the blank" mode: the target
  word is hidden in its example sentence, learner types it. (RemNote-inspired #1)
- ✅ **AI "Explain / when to use"** — word page button: nuance, register, synonym
  differences, common mistakes, in the learner's own language. On-demand (#2)

## Done (SRS)
- ✅ **FSRS scheduler** (via `ts-fsrs`) — 4 grades Again/Hard/Good/Easy, target
  retention 90%, per-card state persisted. Review page has 4 buttons (swipe =
  quick Again/Good); Quiz grades Good/Again. `nextReviewAt` kept in sync for
  due-logic/stats. Zero AI tokens.

## Done (SRS cont.)
- ✅ **Interval preview on grade buttons** — each Again/Hard/Good/Easy button
  shows when the card returns (e.g. 10м / 2д / 5д), computed client-side via ts-fsrs.

## Done (reader + mobile)
- ✅ **#3 In-context reader** — paste any text → tap unknown words → batch-add as
  cards. Mobile-first (tap-to-select + sticky "Add N cards" bar, no per-word modals).
  Known words dimmed & link to their card; CJK word segmentation handled natively by
  `Intl.Segmenter`. Reuses level/style + recent pairs. Select-all-new / deselect-all;
  select-none so mouse-drag doesn't fight taps.
- ✅ **Reader "Translate all"** — one button translates the whole passage
  (`POST /api/translate`, Qwen); shows side-by-side on desktop, stacked on mobile;
  cached per text + toggle show/hide.
- ✅ **Mobile UX pass** — viewport-fit/theme-color meta, 16px inputs (no iOS zoom),
  Reader added to nav + home, responsive page titles, compact study headers.

## Done (tutor + examples + audio)
- ✅ **AI tutor mini-chat** (replaces "Regenerate") — the explanation is turn one,
  then you ask follow-ups inline (`POST /api/words/:id/ask`, grounded on the card,
  answers in the learner's language, last-12-turns context).
- ✅ **Better examples** — dialogue style now always a real 2-3 turn exchange (line
  breaks preserved in UI); global rule bans bare context-free one-liners.
- ✅ **Han picker captions** — 中文/日本語/한국어 now show Chinese/Japanese/Korean under them.
- ✅ **Speak/TTS hardening** — unconditional cancel→speak-next-tick, start-check retry,
  boot-time resume() for engines that start paused.

## Done (SRS tuning)
- ✅ **FSRS "desired retention" setting** — account page presets (80/85/90/95%),
  stored locally; sent with every review so the server schedules with it, and the
  grade-button interval previews update to match. Zero AI tokens.

## Done (reader cont.)
- ✅ **Reader per-word quick gloss** — tapping a new word selects it AND pops a small
  translation of that word (reuses `/api/translate`, cached per word, dismiss on
  scroll/Esc). Lets you preview meaning before committing the batch add.

## Done (practice + family + background)
- ✅ **Reader background add** — selected words are queued via a batch endpoint
  (`POST /api/words/batch`) that creates bare cards + one import job; the existing
  background worker enriches them and the persistent progress toast tracks it, so
  you can leave the Reader immediately.
- ✅ **#4 Mixed practice** — Quiz has a "Mixed" mode: each question is a random
  format (multiple-choice / typing / fill-the-blank) per word.
- ✅ **#5 Word-family graph** — synonyms/antonyms on the word page are a small
  radial graph; tap a saved word to open it, tap a new one to add it (background).

## AI-enhanced review (opt-in — costs tokens, toggle it)
- 💡 **Fresh example each review** — new sentence per repetition (no rote memorizing one line).
- 💡 **AI-graded free recall** — learner writes a free answer, AI judges it (not just self-grade).
- 💡 **Difficulty adaptation** — tune example difficulty to performance.
  → All three behind a per-user toggle (default off) to control token spend.

## Done (cards + practice polish)
- ✅ **Custom card layout** — Flashcards setup has presets (Default / Reverse /
  By synonyms / Production) plus per-side field toggles, so you can train e.g.
  word → synonyms. Stored locally; the flip card renders the chosen front/back.
- ✅ **Scrollable card back** — back shows all chosen fields (all examples, notes…)
  in a scroll area that doesn't trigger flip/swipe.
- ✅ **Notes field** — free-form personal notes on a card (schema + edit + display).
- ✅ **Highlighted target word** in example sentences (word page, flashcard, quiz).
- ✅ **Quick open card from practice** — "Card ↗" opens the word page in a new tab,
  leaving the practice session intact.
- ✅ **Editable long examples** — example fields in the editor are textareas now
  (were single-line and clipped).
- ✅ **Audio start-clip fix** — silent primer + no pre-cancel so "little" isn't "tle".

## Smaller wins
- 💡 **Cache AI explanation** on the card (avoid re-spending tokens on re-open).
- ✅ **Quiz hotkeys** — 1–4 pick answers, Enter/Space to continue; number badges on options.
