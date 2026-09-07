# Lexa — Ideas & Roadmap

Living backlog of cool ideas. Add here whenever something interesting comes up.
Status: ✅ done · 🔨 building · ⏭ approved/next · 💡 idea · 🧊 later

---

## Done (UX + coach session)
- ✅ **Reverse translation, done right** — type a word in your own language and
  get a card in the language you're learning. Explicit "I type in […]" selector
  under the pair (remembered) + a live "Card in {lang}" hint so a backwards pair
  is obvious; a script/LLM auto-nudge remains as a fallback. Reuses /api/translate.
- ✅ **Synonym level** — tune a card's synonyms to a target CEFR level (IELTS prep);
  threaded through enrich + web-mined (tutor) paths. Free.
- ✅ **Reader: pronounce the word** in all three popups (tap gloss, known-word,
  press-and-hold card) via SpeakButton.
- ✅ **Reader dictaphone** — live speech-to-text into the text box (lecture mode).
- ✅ **Quiz Mixed preview = carousel** cycling the formats it mixes (choice/type/cloze).
- ✅ **Home de-clutter** — one primary action (coach briefing), not three CTAs.
- ✅ **Achievements progress bars**; **New-picks loading** fix.
- ✅ **My words**: sort (recent / A–Z / most-reviewed / due) + a Due filter pill;
  single-delete now visible on touch. **Add form** tuning collapsed under "Advanced".

## Next up (proposed clusters — 2026-09-07)
- 💡 **B5 Pronunciation scoring** — compare browser-STT transcript to the target
  word in practice/reader, show a score/colour. (IDEAS "voice scoring — later".)
- 💡 **B6 Fresh example per review / difficulty adaptation** — behind a toggle (tokens).
- 💡 **B7 Meaning backfill** — shorten old long meanings on demand.
- ⏭ **Launch cluster C**: payment (YooKassa/TG), domain+transactional email, fill
  Legal placeholders, bump Next.js (audit), gate Coach behind Pro Plus + flip
  `BETA_ALL_PRO=false`.

---

## Dev notes — browser vision (Playwright MCP)
- **What it is:** an MCP server (`@playwright/mcp`) that gives Claude a real
  browser — it can navigate, take DOM snapshots and screenshots, click, type and
  read console/network. Config lives in `.mcp.json`:
  `{"mcpServers":{"playwright":{"command":"cmd","args":["/c","npx","-y","@playwright/mcp@latest"]}}}`
  (the `cmd /c` wrapper is what makes `npx` resolve on Windows).
- **Status: DISABLED** — renamed to `.mcp.json.disabled`. Every `browser_snapshot`
  / screenshot costs tens of thousands of tokens, which was burning the 5-hour
  limit fast. Re-enable by renaming back to `.mcp.json` + restarting the session
  only when a visual check is truly worth the spend.
- **Takeaway:** I can read/reason about the code and CSS, but I cannot see
  rendered pixels without this tool on. Prefer describing expected layout over
  spending tokens to verify it in a live browser.

## Context — the "Coach" direction (pre-paywall discussion)
The wedge vs Quizlet: Lexa should feel like a **personal AI mentor**, not a
flashcard box. It tells you *what* to learn for your level + language, builds a
daily plan, adapts to weak spots, and can turn *anything* (a photo of a notebook,
a txt, a PDF, a messy word list) into a structured deck. That framing is what
makes the marketing lines honest. See the **Coach (Pro Plus)** section below for
the shipped/next pieces.

---

## Done (live-test feedback batch)
- ✅ **Pro upsell popup** — tapping a locked Pro control now opens a small
  marketing popup (echoes the word you were adding) before /pro, and /pro's back
  link is contextual ("Back to my words") + shows that word.
- ✅ **Import parses source-lang synonyms** — "awesome - cool, astonishing" now
  files cool/astonishing as synonyms (decided by language, not punctuation) and
  keeps them; added a format hint under the paste box.
- ✅ **No more blank cards** — the import worker falls back to a plain translation
  when enrichment fails/returns nothing, so a graph-added synonym is never empty;
  the "N skipped" toast is reworded (the cards were added).
- ✅ **Remember graph add-method** — the AI-vs-manual chooser has a "don't ask
  again" checkbox; the choice persists and is changeable in Account.
- ✅ **Grouped settings** — the growing toggle list is now under headings (Adding
  words / Study / Reading).
- ✅ **Consistent icons** — Collections Study/Quiz use lucide icons (not 🃏/🎯);
  toasts already map their emoji to line icons.
- ✅ **Tutor can't be lost** — clamps back on-screen; fixed the on-navigation drift.

## Done
- ✅ **Beta bug reporter** — floating "report a bug/idea" form, app-wide. Sends
  the message + auto context (route, env, recent JS/network errors) + optional
  page screenshot to the owner over email and/or Telegram. Popovers everywhere
  fixed to allow copying their value (no dismiss on inside-tap), follow on scroll,
  and fade out gently. Logo → Today.
- ✅ **Example register/level knobs + labels** — the inline "+ add example" AI
  button now picks source (AI/web), register and CEFR level; AI examples record
  how they were made and show it as chips next to "Lexa AI" on the word page.

## Economics — cost per AI action
Model: **qwen-plus** on Alibaba **Bailian (China region, CNY)** — lowest tier
(our calls are ~500 tokens, always ≤128K): **input ¥0.8 / output ¥2 per 1M tokens**.
New accounts get 1M free tokens per model. (Intl `dashscope-intl` endpoint bills in
USD and differs.) Numbers below use measured token counts where we have them.

| Action | Tokens (in/out) | Cost (¥) | ≈ USD |
|---|---|---|---|
| **Add card** (combined enrich + spell-check) | ~440 / ~170 | **¥0.0007** | ~$0.0001 |
| — combined enrich only (measured) | 338 / 153 | ¥0.00058 | — |
| Gloss tap (reader/word-page) — cached repeat = 0 | ~50 / 20 | ¥0.00008 | — |
| Tutor chat message | ~400 / 200 | ¥0.00072 | — |
| Reader text generation | ~300 / 800 | ¥0.0018 | ~$0.0003 |
| OCR scan (qwen-vl-plus, image tokens dominate) | varies | ~¥0.001–0.005 | approx |

Rules of thumb: **~10,000 added cards ≈ ¥7 (~$1)**. A free user at 20 adds/day ≈
**¥0.4/mo**; a heavy Pro user ≈ **¥2–3/mo** — so at ~$4–5/mo Pro the margin is >90%.
Token cost is negligible: the paywall is a **conversion** lever, not a cost one.
`[llm usage]` logs give real per-call numbers to refine this during the beta.

## Coach (Pro Plus) — the "personal AI mentor" layer
Positioning wedge vs Quizlet: it tells you WHAT to learn, plans, adapts to weak
spots, practises actively, and eats anything. Architecture rule: assemble context
from OUR DB (deck, level, FSRS) + ONE structured call + post-filter — not agents.
- ✅ **Words for you** — level-appropriate picks the learner lacks (deduped
  against the deck server-side). One call, verified relevant + zero dups.
- ✅ **Today's plan** — due / weak spots / new goal + actions (pure data, no AI).
- ✅ **Drill weak words** — focused review session of high-lapse cards.
- ✅ **PDF/text/photo → deck** — upload a list, PDF, or a photo (incl. a
  handwritten page, via Qwen-VL OCR) → parsed into a reviewable deck.
- ✅ **Adaptive practice drill** (the wedge — genuinely agentic) — `/coach/practice`:
  the coach quizzes you on your OWN weak/due words, asks you to use each, grades
  the answer (correct/partial/wrong), adapts difficulty, and feeds the grade back
  into FSRS (correct=Good, partial=Hard, wrong=Again). Reads in your language.
  Next: pronunciation input, and run the same drill over Telegram.
- ✅ **Practice any deck** — the drill accepts a specific word set; collection
  pages have a "Practice" action, so an imported deck → coach drill in one tap.
- ✅ **Review plan / pacing** — a "new words per day" cap phases a big import
  (500 HSK words) into a schedule instead of dumping every new card as due; the
  Coach shows the plan (N new · X/day → ~Y days · ~Z min/day) with a pace picker.
- ✅ **Coach voice on Home** — an adaptive one-liner + next step on Today (weak →
  due → new → idle), computed from the deck. The mentor is now a presence.
- ✅ **Personalized "Words for you"** — picks follow the learner's recent words
  (topic continuity) or an explicit theme they type. One AI call, post-filtered.
- ✅ **"This week" recap** — token-free progress card (added/reviewed/mastered +
  trickiest words to watch, with a one-tap drill).
- ✅ **Proactive Telegram nudges** — the daily reminder now also reports weak
  words and offers a one-tap "practice your weak words" button.
- ✅ **Practice over Telegram** — /practice runs the adaptive drill in chat
  (text or a voice answer, transcribed via Qwen audio best-effort), grading into
  the SRS. Voice pronunciation scoring itself is still a later idea.
- ✅ **Coach memory (personal agent)** — persistent per-learner memory (goal,
  interests, model-maintained notes of recurring mistakes) injected into the
  drill, tutor and picks on web + Telegram, updated after each session. Editable
  in Account. Verified: the drill tailors tasks to the learner's interests.
  Direction: ONE mentor, two modes (ambient tutor + focused practice) sharing this
  memory — not merged into one UI. Web practice also got a proper chat UI (pair &
  scope pickers, live-preview voice via browser SpeechRecognition, hints, avatars,
  animated word card with TTS).
- ⏭ **Weekly recap / coaching**.
- 🧊 **Anki .apkg export** — deprioritized: we're a full Anki replacement, so an
  export mostly undercuts positioning; keep only as a migration/marketing checkbox.
- ⏭ Gate the Coach behind a real **Pro Plus** tier (add plan tier + /pro column).

## Monetization / paywall
- ✅ **Gates** — daily "generation" pool (add/example/tutor, 20/day), monthly
  quotas (reader-gen 3, OCR 5), Pro-only params (web examples / detailed+custom
  meaning / 2-3 examples), free import cap (25). Gloss/read stays free.
- ✅ **Simulate-free toggle** (Account → Plan) to preview the free tier on a Pro
  account, via `X-Simulate-Free` header.
- ✅ **Upfront UI locks** — free users see "Pro" tags on locked knobs (+ request
  sanitizer), no surprise 403.
- ✅ **/pro screen** — benefits, Free-vs-Pro table, pricing; CTA = "coming soon".
- ⏭ **Payment** — wire YooKassa (самозанятый) and/or Telegram Payments to the
  /pro CTA; webhook sets `User.plan="pro"` + `planUntil`.
- ✅ **Persist usage counters** — daily/monthly caps now live in a Postgres
  `UsageCounter` table (survive restarts + multiple instances). Pro-only 403s no
  longer spend a daily action.
- ⏭ **Flip `BETA_ALL_PRO=false`** at public launch (new users default to free).

## Token-cost follow-ups (combined-enrich already cut single-add 3→1)
- ✅ **Batch import (importWorker)** — already 1 call/card for the normal AI path
  (routes through `enrichWordEntry`). The only 2-call cases left are Reader-context
  (details + a cheap translate) and web examples (Pro; needs a separate web
  search) — not worth merging. Note was stale.
- ⏭ **Extra "+ add example"** — merge compose+translate into one call (2→1).

## Pre-launch checklist
- 💡 **Comparison table on the landing** (competitors vs us, checkmarks) — PARKED:
  do it once the competitor set is clear. We sit between "flashcards/SRS" and
  "AI conversation tutor", which have different competitors, so a table now would
  be arbitrary. Revisit after positioning is settled (coach-forward vs cards).
- ⏭ **Site email** — buy a domain + wire a transactional provider (Resend/
  Postmark) as `SMTP_URL`, sender `no-reply@<domain>`; point `FEEDBACK_EMAIL`
  at an inbox. Powers magic-links, retention mail, and bug reports.
- ⏭ **Bump Next.js** before public launch — `npm audit` flags advisories in the
  pinned Next (plus generic transitive DoS in brace-expansion/js-yaml/nanoid,
  mostly dev-only). Not urgent for the closed beta.
- 💡 **Meaning backfill** — existing cards keep their long meanings; an on-demand
  AI pass could shorten them (costs tokens). Offered, awaiting your call.
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
- ✅ **AI-graded free recall** — the word-page tutor has a "Test me" chip: it quizzes
  you and grades your written answer. Right in chat, no separate page.
- 💡 **Difficulty adaptation** — tune example difficulty to performance.
  → The two open ones behind a per-user toggle (default off) to control token spend.

## Done (big recent batches)
- ✅ **Reader upgrades** — saved texts + collections, AI-generated texts at a chosen
  CEFR level, tap-transcription (pinyin/romaji), background generation.
- ✅ **AI explanation cache** on the card (free re-opens; cleared on edits).
- ✅ **Billing groundwork** — free/pro plans, daily AI cap, BETA_ALL_PRO, owner allowlist.
- ✅ **Telegram bot** — reply-keyboard buttons for popular actions.
- ✅ **PWA + offline review** — installable app icon, service worker, offline card
  review with an IndexedDB outbox that syncs on reconnect. (Needs a real browser to
  exercise the offline path.)
- ✅ **Pro-looking icons** — replaced emoji UI icons with a lucide set.
- ✅ **Achievements** — 16 milestones with plain-language descriptions.
- ✅ **Friends + referral** — invite code, see friends' languages/streak/achievements.

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
- ✅ **Cache AI explanation** on the card (avoid re-spending tokens on re-open).
- ✅ **Quiz hotkeys** — 1–4 pick answers, Enter/Space to continue; number badges on options.
