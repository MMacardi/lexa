# Backlog — one item per session

**One list, in order — take the top unchecked item, do it, tick it, `/clear`.** Position is the
priority, so the numbers move; name items by **title** in commits, never by number. Bracketed tags
like `[H1]` are the old prefixes, kept only so older commits and `IDEAS.md` headings still resolve.
Details for an item: grep `IDEAS.md` for the quoted heading. The reasoning behind the ordering is
`STRATEGY.md`; the state of the app is §Done.

**Positioning (decided 2026-09-22).** HSK prep for Russian speakers: an honest readiness
mark, then the official word list and this week's textbook words turned into words the
learner can actually **use**. One exam first (HSK). IELTS is a possible second exam on the
same engine, only after HSK keeps strangers coming back. Everything else gets hidden, not
deleted — `onomika_old` holds the full-featured build.

**Re-centred 2026-09-23.** The focus pass built the framing (placement, readiness mark, gap deck)
before the reason to switch, and the first real use showed it: capture that waits 5–10 s on the
LLM, an HSK 1 deck for an HSK 4 learner, and scenes the author wouldn't use. The core is now the
author's original problem: **a word you meet becomes a review card instantly, with no card-making**
— dictionary first, AI only for what a dictionary can't do (the sense your sentence uses, a Russian
meaning, an example at your level). HSK stays as the source of daily words, not the headline.
Scenes, the coach and the readiness mark get no new work until the two-week test (item 5) passes.

## Open — one list, in order

**Top item is the next session.** Position *is* the priority; the numbers shift when the order
does, so commits and notes name the **title**, never the number. The old prefixes (F/H/V/U and
bare numbers) are noted in brackets only so older commits and `IDEAS.md` headings still resolve —
don't invent new ones.

**Where the line is.** Items 2–4 are the re-centred core; item 5 is the two-week test that decides
whether anything after it happens. 6–13 make the daily loop smoother while it runs (6 is the one
session-sized item; 8–13 are small). 14–17 make a beta survivable. 18 waits on the test. 19–22 make
it legal and named. 23–26 make the result mean something. 27+ is after that.

---

1. **Backups + one rehearsed restore.** `[H1]` Enable Railway Postgres backups, take one by hand
   via `DATABASE_PUBLIC_URL`, then **restore it into the local Docker Postgres (host 5433)** — an
   untested backup is not a backup. First because it is the only irreversible risk on the board:
   prod now has a working delete button (see item 14) and F2/F3 made the DB the only copy of the
   learner model. The review log and production ledger exist nowhere else and cannot be regenerated.
   Needs you in the Railway dashboard.

2. [x] **Instant capture: the dictionary makes the card, the AI comes second.** One session. The
   original problem, and the first thing STRATEGY §E says kills the product: *capture slower than
   "Pleco lookup + star"*. Today every add waits 5–10 s on the LLM, and a card is a blank shell
   until a background job fills it.
   - On add, write the card **synchronously** from `cedictLookup` (`services/cedict.ts`; ~11.4k HSK
     headwords already in `backend/data/cedict.jsonl`): headword, pinyin, glosses. It is reviewable
     the moment the tap returns.
   - The LLM runs **after**, only for what a dictionary can't do: the Russian meaning, the sense the
     source sentence actually uses, one example built from words the learner already has. It
     upgrades the card; it never gates it.
   - CEDICT glosses are English. Until the Russian arrives the card shows the English gloss,
     labelled. (BKRS would give Russian instantly — check its licence before shipping any of it.)
   - Folds in *No dead cards* `[F15]`: add `POST /api/words/:id/enrich` and a "fill this in" action,
     so a cancelled or failed enrichment never leaves an empty card. With CEDICT first, a non-empty
     card is the default anyway.
   - **The Reader is the main entry — photo or text → tap → card.** Today a tap waits on the LLM
     (`POST /api/gloss` → `glossInContext`) and throws the context away: `reader/page.tsx` calls
     `resolveMeaning({ word, sentence: wordText })`, so the "contextual" gloss never sees the sentence.
     Tap shows the CEDICT pinyin + gloss at once; pass the real sentence (`sentenceAround`) so the
     contextual Russian sense that follows is actually contextual. `addSelected` creates CEDICT-filled
     cards, not shells.
   - Words CEDICT doesn't have, and non-Chinese words, keep today's path.
   - **Done when:** adding 一下 / 打 / a textbook word returns a reviewable card in < 1 s with pinyin
     and gloss, and the Russian fills in behind it. `backend/scripts/check-capture.ts` asserts the
     card is complete before any LLM call; then add three words in the local app as a learner would.
   - **Shipped 2026-09-23.** `services/capture.ts`: a Chinese word CC-CEDICT knows is written with
     pinyin + English at once (single add, bot, Reader batch); one grounded `enrichWordEntry` call
     upgrades it behind the card — the Russian in the sense of the sentence the word came from, an
     example built from the learner's own words. No migration: "still the dictionary's English" is
     derived on read (`dictMeaning`, like the HSK badge), labelled "English · CC-CEDICT" on the card,
     list, review and Reader, and the pages poll while it fills in. `POST /api/words/:id/enrich` +
     "Fill this in" on the word page. The spell-check before an add skips the model for a CEDICT
     word, so nothing on the add path waits on it. The subset now keeps the base of each 儿 word
     (一下儿 → 一下). Measured in the local app: 0.3–0.8 s to a reviewable card, Russian at ~6 s;
     `scripts/check-capture.ts` passes with the model down, and with `--live`.

3. [x] **Pick HSK N, get HSK N words — every day.** `[F13 + F16 + F14]` One session, `services/hsk.ts`
   plus the deck step. The fault a real run found: an HSK 4 learner is handed 一下儿, 一些, 七, 三 …
   because `hskGapWords` walks levels 1→target in file order (alphabetical by pinyin) and HSK 1's
   ~500 unproven words fill every deck before level 2 is reached. The simplest version that is true:
   - Draw from the **target level** first, then target−1, … — never restart at HSK 1 unless
     everything above is exhausted. Words the learner tapped as unknown in the check
     (`PlacementAnswer.known = false`, no card yet) go first. Shuffle within a level.
   - A **daily drip, not a one-off build**: Today offers `dailyGoal` new words at the level, straight
     into review. (The learner's words: *"I thought it would always give me some words for my
     level."*) F11's separate refill button goes away.
   - **Every proposed word can be rejected.** The deck step renders static `<span>`s today; make them
     toggles and write a rejection as `PlacementAnswer{known: true}`, so the word never comes back.
   - Show the level badge on each word.
   - **Done when:** a seeded account targeting HSK 4 gets level-4 words, including the ones it
     tapped, and a rejected word never reappears — asserted in `backend/scripts/check-gap-deck.ts`
     (shape of `check-account-delete.ts`). Then pick HSK 4 in the local app and look at the deck.
   - **Shipped 2026-09-23.** `frontierOrder` in `services/hsk.ts`: tapped-unknown words, then the
     target level, then downwards; shuffled per learner per day (seeded, so a reload doesn't
     reshuffle; the level is shuffled *before* filtering, or every rejection reshuffled it — found
     in the browser run, now asserted). `GET /api/hsk/daily` + `HskDaily` on Today: `dailyGoal`
     words, counting today's cards as still in the offer, so it reads "done" until tomorrow
     instead of refilling; a rejection frees the slot for the next word. Deck and daily chips are
     toggles with a level badge (`HskWordChip`), rejections saved as `PlacementAnswer{known:true}`.
     F11's refill button and the refill variant of `HskFirstRun` are gone. No schema change.
     Local run: HSK 4 → the 4 tapped words, then HSK 4 only; next day 5 new HSK 4 words, reject →
     replacement → "done".

4. [x] **The official HSK lists as decks you can browse.** Small. Every HSK app has "HSK 1–6, add
   them": table stakes, not a differentiator, but without it the app looks empty. The lists are
   already data (`services/hsk.ts`), and the collections UI is only hidden by `FOCUS`
   (`frontend/lib/focus.ts`), not deleted. Show the six levels read-only, with "put this level in
   my daily words" and per-word add. Community collections stay hidden.
   - **Shipped 2026-09-23.** "Official HSK lists" at the top of Collections (`HskLists`, both lists,
     per-level word count and how many are yours, a tag on the daily-words level; counts come off
     the readiness endpoint). `/hsk/[version]/[level]`: the level read-only in list order, each word
     marked in review / known / can use or with a "+" (instant capture, ~0.2 s), "only words I
     don't have", and "Put this level in my daily words" (sets `hskTarget`; Today follows). New
     `GET /api/hsk/list`. Local run: HSK 5 → "+" 一下子 → daily level → Today shows HSK 5 words.

5. **Be user #1 — two weeks, and this is the test.** `[V0]` Not a session — a habit. After items
   2–4, use it daily for your own Chinese: photograph the page you are reading and tap the words you
   don't know, take the daily words, review.
   **Kill rule, set now:** if after two weeks you are not adding words without forcing yourself,
   stop and keep the project as a portfolio piece. If you skip a day, write down why; that reason
   outranks any feature idea. **Nothing after item 17 starts before this passes.** It has already
   paid for itself once: one hour of real use found the fault behind item 3.

6. [x] **Reader: HSK colours, pinyin only where you need it, how much of a text you know.** From the
   competitor pass (2026-09-25: Du Chinese, Migaku, Pleco). One session. Placed during the test on
   purpose: the Reader is the capture entry you use every day while it runs.
   - Underline each word in its HSK level's colour (the list the learner targets), and keep the
     states apart: new / in review / known (the Reader's `knownMap` + the card's FSRS state).
   - Pinyin mode puts pinyin only over words you don't know yet (Du Chinese's toggle), with a
     "show all" switch.
   - One line above the text: "You know 82% · 14 new words, 6 of them HSK 4" (Migaku's comprehension
     score), from the same counts; the % also on each saved text.
   - On a phone the word popup becomes a panel docked at the bottom (Pleco's reader): in thumb
     reach, never over the line being read, and it can't drift on a fast scroll.
   - **Done when:** a pasted HSK 4 lesson shows level colours and the % at iPhone width in the local
     app, and the % matches a hand count on a short text.
   - **Shipped 2026-09-25.** `POST /api/segment` tags each word with its HSK levels; the Reader
     underlines it in the level's colour on the learner's list (7 tokens, both themes): solid = no
     card, dashed = card in learning, faded = known (FSRS state ≥ 2 or can-use, the mark's
     "recognise"). Pinyin goes over unknown words only, with an Unknown / All switch. "You know
     60% · 4 new, 4 of them for HSK 4" + a legend over the text; the same % on each saved text,
     computed on list from `services/coverage.ts` (running words, a number isn't a word, other
     pairs don't count). On a phone both word popups dock at the bottom over the add bar, and the
     text scrolls the tapped word above them. `scripts/check-reader-coverage.ts` asserts the hand
     count (6/11 = 55%, 64% after a card graduates). Run at iPhone width: 60% on a 10-word text by
     hand, pinyin 4/10 → 10/10, a word at y=562 scrolled to 369 above a dock at 385.
     Not done: placement "I know this" answers don't count as known in the Reader (the mark counts
     them); and a card the segmenter can't match stays "new" (很多 and 每天 come out as two words
     because the CC-CEDICT subset doesn't list them).

7. **Cram a list now.** Hack Chinese's CRAM mode: drill one textbook lesson, collection or HSK level
   right away, outside the schedule, without moving it (logged with source `cram`, never graded into
   FSRS). Small — the quiz already filters by collection. For the class quiz on Friday.
   - **Done when:** "this week's lesson" → a five-minute drill of just those words, and their FSRS
     due dates are unchanged afterwards (asserted in a `scripts/check-cram.ts`).

8. **Undo the last grade in review.** Anki's most-used safety net: on a phone a mis-tap on Again or
   Easy silently reschedules the card, with no way back. Keep the card's state from before the
   grade; "Undo" restores it and deletes that review-log row (`POST /api/words/:id/undo`). Small.
   - **Done when:** grade a card Easy, undo, and its due date, stability and the review log are
     exactly as before (asserted in `scripts/check-undo.ts`).

9. **End of review → the next step.** The finish screen only offers "Back to setup". Point on, the
   Duolingo way: today's new words (HskDaily), the use-step, or the Reader — the loop, one tap at a
   time. Small.

10. **Play the word when the card flips.** A setting, on by default for Chinese (Anki and Pleco both
    have it): the word is spoken on reveal. Free listening and tones, which HSK listening needs.
    Small — `SpeakButton` already speaks it.

11. **A "Paste" button in the Reader and Add word.** One tap reads the clipboard
    (`navigator.clipboard.readText`), Pleco's clipboard reader: text copied from WeChat or a site
    is one tap from being read, not a long-press and a menu. Small.

12. **The streak and "today's goal done" on Today.** The count already exists (`stats.streak`) but
    lives only in the stats panel, hidden while focused. Just visibility — the freeze and the
    nudge stay under Later. Tiny.

13. **"Add to Home Screen".** Android: an install button from `beforeinstallprompt`. iPhone: a
    one-time sheet after the second day (Share → Add to Home Screen). Installed, it runs full
    screen without Safari's bars — which also avoids most of the viewport quirks fixed on
    2026-09-25 — and it is what web push on iOS needs later. Small–medium.

14. **A grace period on account deletion.** `[H5]` The delete shipped as a hard delete — one
   confirmation and the rows are gone. That optimised for the privacy promise and gave no weight to
   the misclick, which is the wrong balance for a beta where the author is also user #1. Soft-delete
   with a 7–30 day window plus a purge job; GDPR-compatible. **After item 1** — a grace period is not
   a backup.

15. **Error monitoring + uptime.** `[H2]` No Sentry anywhere in the repo, so a crash a tester hits is
   invisible unless they report it. Sentry (or similar) on backend + frontend, plus an uptime check
   on the existing `GET /health`. Keep the DSN out of git. Pairs with the Next bump that already
   landed, so the SDK matches the major.
   - **Code done 2026-09-23; switching it on needs you** (DEPLOY.md "Error monitoring and
     uptime"): a Sentry account, `SENTRY_DSN` on Railway, `NEXT_PUBLIC_SENTRY_DSN` on Vercel +
     redeploy, and a free UptimeRobot/Better Stack monitor on `/health`. Backend
     `lib/monitoring.ts` (`@sentry/node` 10 — 11 needs Node ≥ 20.19 and Railway's Node isn't
     pinned), frontend `instrumentation-client.ts` (`@sentry/browser`, loaded only when the DSN
     is set; shared JS unchanged without it). Both capture `console.error`, since most routes
     catch and log rather than throw. Verified against a local fake Sentry endpoint: an event
     arrives from each side with a DSN, nothing without one. Tick this once the DSNs are live.

16. **A feedback channel the tester can find.** `[H4]` The bug button and `deliverFeedback` already
    route reports to `FEEDBACK_TELEGRAM_CHAT`/`FEEDBACK_EMAIL`. What's missing is somewhere to
    *answer* — a Telegram chat or group linked from the app and from the landing page, so a 6-week
    beta is a conversation and not a one-way form. The landing already promises you answer.
    - **Code done 2026-09-23; needs you:** create the Telegram group, then set
      `NEXT_PUBLIC_TESTERS_CHAT_URL=https://t.me/+…` on Vercel and redeploy (DEPLOY.md table).
      With it set, "The testers' chat — the author answers there" shows in the bug dialog (above
      the form and after sending) and on the landing (the honesty section and the footer); unset,
      nothing shows. `lib/links.ts` accepts https links only. Checked with a test link in the
      local build, logged in and out. Tick once the real link is live.

17. [x] **Stop asking which language.** `[F17]` F8 kept English first-class as a *capability*; it leaked
    into the *interface*, so 14 surfaces still pose «что учу / что знаю» in an app whose positioning
    is a single pair. The pair belongs on the account (F2 stored it), shown as a labelled static chip
    — item 3g's fix, which must survive, because people really did set it backwards — with the picker
    behind the chip and in Settings only.
    - **Shipped 2026-09-23.** `PairChip`: "Learning Chinese · I know Russian" as one chip, the
      labelled pickers (and swap) in a popover behind it — on the add form (the backwards-pair
      nudge stays), the Reader and the Coach, where the Reader's and Coach's were bare "A ⇄ B"
      dropdowns. The import dialog lost its "English → Russian / Russian → English / custom"
      switch and opens on the shared pair (`getStudyPair()`, what onboarding saved). The Reader's
      recent-pair shortcuts are hidden behind `FOCUS`. Chats already had `ChatPairPicker`.
      Pickers remain where they are the question: onboarding, Settings, the add form's "which
      language did you type" prompt. Checked on words / reader / coach / import in the local app.

18. **A placement that finds your level, and a mark that isn't a lie.** `[F12]` **On hold until
    item 5 passes.** The readiness mark is framing, not the reason anyone switches, and the daily
    words plus rejections (item 3) may locate the frontier well enough on their own. If still needed:
   - **The test:** 24 evenly-spread taps measure nothing. The same budget spent as a ladder locates a
     frontier — ~8 words at the target, ≥70% known go up, ≤30% go down, otherwise stop. Three rounds,
     same 24 taps, an actual answer. Store `frontierLevel` on the User beside `hskTarget`.
   - **The mark:** `recognise` counts cards plus ticks, so a real HSK 4 learner sees ~30 of 1200 and
     concludes the app can't see them. Extrapolate per level from the sample rate and label measured
     vs estimated. F4's rule still holds — vocabulary coverage, never a predicted exam score — but a
     number that reads 30/1200 to someone who knows a thousand of them is wrong, not conservative,
     and it is the first thing they see.

19. **AI prompt-injection hardening.** `[5]` IDEAS: "AI prompt-injection hardening". F7 switched off
    the Tavily web-example path, which removed the worst untrusted-text surface. Left: OCR/photo
    capture (F9) and pasted Reader text, both of which reach prompts with no sanitising layer.

20. **Naming decision.** `[6]` Blocks item 21 — decide before buying anything. Criteria and the
    rename cost are under §Reference. Own session, no code.

21. **Domain + email.** `[6a]` Buy the `.com` (+ `.ru`), set `SMTP_URL` + `EMAIL_FROM`, send a test
    login link, attach the domain to Vercel. **Until this lands, email sign-in is a dead end:** with
    `SMTP_URL` empty the login link is written to the server log and nothing else, while the UI still
    offers the option. Either finish this or hide email sign-in. IDEAS: "Site email".

22. **Legal pages.** `[7]` Fill the eight `[ЗАПОЛНИТЬ: …]` placeholders across /privacy and /terms
    (operator identity, contact email, jurisdiction, min age) — they need a real address for deletion
    requests, so item 21 comes first. Add a line about the F1 event log and one about the F3
    production ledger. The deletion clause already points at the buttons rather than promising a
    reply. Item 20 will add a ToS clause about shared corrections; don't rewrite these twice.

23. **8–10 interviews** with target users. `[V1]` Classmates prepping HSK, Russian-speaking learners
    at Chinese universities — about how they handle new words *now*, before the beta, not during.
    Explicitly "done first" in STRATEGY.md's Verification table.

24. **Recruiting list.** `[V2]` Where the 30–50 actually come from, named: which communities, which
    student groups, who introduces you. Not friends without a Chinese exam.

25. **Kill-Test thresholds on `/admin`.** `[V3]` The funnel, rolling D1/D7/D30 and use-step quality
    already render (F1). Put the four thresholds next to the numbers — ≥50% activation, ≥20% week-4
    retention, ≥30% doing 3+ use-steps a week, ≥40% Sean Ellis — and write down what each miss would
    mean *before* seeing the data.

26. **Refresh the defence materials.** `[U1]` `2024998004014_Anton Volkov/` holds the report, the
    plan and a source zip, all from **June 2026** — they predate the strategy pass and every one of
    F0–F11, so they describe a different product. Re-export the zip and make the report tell the
    story the repo shows: the pivot from "learn English through the news" to HSK prep, the learner
    model (F2/F3), dictionary grounding with a measured result (F6), the focus flag.
    - Demo path: `NEXT_PUBLIC_FOCUS_MODE=off` restores the full build (Community, scenes, graphs).
      Check the flag still flips cleanly before the date.
    - Before quoting F6's eval, **mark it yourself** — the 99/100 vs 90/100 was marked by Claude.
      `npx tsx scripts/eval-senses.ts` regenerates the CSV; a number you marked by hand is the one
      that survives a question about methodology.

27. **Shared dictionary that learners correct (not just a cache).** `[F6a]` The full design note is
    under §Reference. Deliberately late: its whole argument is that it compounds *with users*, so it
    is worth least on the day you have none. With one user it is still your own verified dictionary,
    which is worth having anyway.

28. **Payments.** `[9]` DELAYED until retention exists. Then ONE Pro tier (~499 ₽) — no Pro Plus.
    Vercel Hobby forbids commercial use, so upgrade before charging. IDEAS: "Payment".

29. [x] **The Reader cuts Chinese into wrong words.** Found while testing instant capture: 他打了三个小时
    篮球 renders a tappable "了三", so the learner can't tap 了 on its own. The bot already has a
    CC-CEDICT longest-match segmenter (`segmentHanzi` in `services/botTutor.ts`); the Reader should
    use the same one. Small, but it sits on the main capture entry — reorder up if it bites.
    - **Shipped 2026-09-23** (done early: it sits on the capture path, see STRATEGY "Feasibility").
      Not the bot's segmenter after all: greedy matching against the HSK-only subset would chop
      every name and non-HSK compound. `services/segment.ts` keeps ICU's split and repairs it with
      CC-CEDICT — splits a token the dictionary lacks when every piece is a dictionary word
      (了三 → 了 三, 我想 → 我 想), joins neighbours that make one. `POST /api/segment`; the Reader
      uses it for Chinese and falls back to the browser's split. Cost: a name of common characters
      comes apart (蒙古 → 蒙 古). Also: the tap popover now shows the dictionary's reading, which
      matches its gloss (a bare 了 showed "liǎo" over "completed action marker").
      `scripts/check-segment.ts`.

30. [x] **Ground the Reader's tap gloss in CC-CEDICT.** Found in the same run: the contextual Russian
    for 了 in 他打了三个小时 came back «уже». `glossInContext` (`services/translate.ts`) is the one
    AI path that still invents its own sense; `enrichWordEntry` already passes the dictionary's
    inventory into the prompt, and the tap gloss should do the same.
    - **Shipped 2026-09-23.** `groundedGloss` in `services/translate.ts`: sentence, word and the
      listed senses go in the user message, the model names the sense it picked, then glosses it;
      the default model, since the fast one kept picking the wrong listed sense (a grounded tap
      blocks nothing now — the dictionary line shows first). Baseline 3/6 wrong → 12/12 right
      (`scripts/check-gloss.ts`, live). **Found on the way, and it reaches the add path and the
      word page too:** `cedictInventory` spent its gloss budget in order, so 得's dé (12 glosses)
      hid the particle de5 and děi "must" from every prompt. Now each reading gets a share.
      Re-run `scripts/eval-senses.ts` before quoting the 99/100 again — the inventory it measured
      has changed for multi-reading words.

## Later — only after the retention test passes

- **Weekly recap**, reshaped as the "know → can use" report + next week's gap words. `[10]`
- **A plan with a date** (Busuu's Study Plan). Onboarding asks when the exam is but keeps it only in
  the coach-memory goal text: store it, and show "at 15 words a day you cover HSK 4 by 12 March" on
  Today, recomputed from the readiness gap; suggest a higher daily goal when the date slips.
  `[competitor pass 2026-09-25]`
- **Stroke order and character parts on the word page.** Hanzi Writer (MIT, loads its own stroke
  data) for the animation and a practice-writing mode — HSK 3.0 adds handwriting. Parts that give the
  sound vs the meaning (Outlier's idea) from Make Me a Hanzi; check its dictionary licence first.
  `[competitor pass]`
- **Exam-format drills from your own words.** 选词填空 fill-the-gap and "hear a sentence, pick the
  meaning", with the exam's timer, built from target-level gap words rather than a question bank
  (HSKLord, hskmock and co. sell the bank). Base: the cloze quiz + TTS. `[competitor pass]`
- **A streak with a weekly freeze and an "ends tonight" nudge** (Duolingo: loss framing beats "come
  learn"). Show the streak on Today, one free freeze a week, the nudge from the bot at the reminder
  hour; web push for home-screen installs where Telegram is blocked. `[competitor pass]`
- **Fresh example per review / difficulty adaptation**, as part of resurfacing. `[13]`
- **Resurfacing.** Reader texts and scenes built from words you recognise but can't use. `[S2]`
- **Anki .apkg import with review history** → FSRS (reverses Anki's switching cost). `[S2]`
- **HSK speaking** (HSK 3.0 speaking section / HSKK): tones + pronunciation via Alibaba 口语评测
  (~¥0.004/call, researched in IDEAS "B5+"), prompts forcing your gap words. `[S2]`
- **Tutor mode.** A tutor sees a student's ledger and assigns words — the distribution engine. `[S2]`
- **IELTS as the second exam**, same ledger + speaking engine. Only with volume, because the only
  edge over SmallTalk2Me and co. is calibration against users' real band scores. `[S3]`

## Done

### Photos in Mika chat, and the basics of a chat app (2026-09-26, asked for directly)
Mika chat should cover what a learner would otherwise open DeepSeek or ChatGPT for.
- **Photos.** Paperclip, paste or drop, up to 4 per message, on `/mika` and the widget, plus a
  "photo of a page" preset or chip. A photo-only turn means "help me with this". Mika reads the
  studied-language text on it, explains it at the learner's level, and offers the words as one-tap
  cards (a zh→ru lesson list becomes 4 Russian-meaning cards in one tap). A turn with a photo in
  the window goes to `qwen3.5-plus` with thinking off (`CHAT_VISION_MODEL`, env
  `BAILIAN_CHAT_VISION_MODEL`). That's ¥0.8/¥4.8 per M, ~1.2k tokens for a photo turn, first token
  in under a second. Text-only chats stay on qwen-plus. Images are base64 `data:` URIs only
  (the server fetches nothing). The client shrinks them to ~1400 px; the newest 4 are resent each
  turn and older ones are named, not sent. The thread and history keep a 320 px thumbnail; the
  sharp copy is kept per tab (sessionStorage).
- **Basics:** Stop while an answer is being written (the partial text stays, and the model call is
  aborted), copy, answer again, edit-and-resend on the last question, try again after an error,
  and voice input (the coach's mic hook, in the answer language). `###` headings render.
- **Two old bugs fixed on the way.** The client sent every message, but the route takes at most
  20, so a long chat started failing. Answers over 4000 characters also failed validation. Mika
  also claimed "I added them" for words it had only offered.
- `backend/scripts/check-tutor-photo.ts` (live): the photo is read, streamed, offered as cards and
  billed under the vision model; a text follow-up still sees it; a text chat stays on qwen-plus.
  Local run at desktop and 390 px: preset → photo → answer → cards; paste, drop, stop, answer
  again, edit, reload (thumbnails and the sharp copy survive), History shows "Фото".

### Russian for every HSK word, a two-way add form, pinyin over examples (2026-09-25, asked for directly)
- **Default meanings, written once.** `data/hsk-ru.jsonl`: a Russian meaning for all 11,482
  CC-CEDICT subset headwords (`scripts/build-hsk-ru.ts`, qwen-plus picking and translating the
  dictionary's senses, 40 per call; ~¥1.1 total). An HSK card for a Russian speaker is now in Russian
  the moment it is added (`dictCardFields`); the per-card call is left with the example and details.
  The default gives way only to a sense the learner pointed at (the sentence it was met in, or the
  meaning typed on the AI path). Derived `dictDefault` keeps the pages polling until the example lands.
  A first slice of the shared dictionary (item 27, F6a) — no corrections or provenance yet.
- **The add form is a dictionary when you learn Chinese.** No "I type in": hanzi → the word (and
  longer words it starts, so a character drawn on the pad already offers 访问 for 访); Russian,
  English or pinyin → Chinese words with pinyin, level and Russian; a tap adds exactly what the row
  showed. `GET /api/dict/lookup` (`services/lookup.ts`), local data, 20–60 ms. The AI translate stays
  as the fallback. The draw pad is a labelled button under the field — it was hidden whenever
  "I type in: Russian" was on.
- **Pinyin over example sentences**: a toggle on the word page ("В контексте") and in Settings; in
  review the card's own word stays bare.
- **Reader tap in Russian at once.** `/api/dict` also returns the default and `settled` (one sense,
  one reading — 6,410 of 11,482 words): then `resolveMeaning` answers from the dictionary and asks
  no model. Otherwise the default shows at once ("уточняю значение…") and the grounded contextual
  gloss replaces it (打 in 打篮球 → «играть», 0.8 s). `lib/dictEntry.ts` shares the one request.
- `scripts/check-lookup.ts` (coverage, both directions, speed); `check-capture.ts` updated for
  Russian-first cards (offline and `--live` pass). Local run: «посещать» → 参观/访问/拜访…, tap →
  card in Russian, example in 5 s; 认 on the pad → 认真/认识…; word page and review with pinyin.

### Draw a character (2026-09-25, asked for directly — Pleco's handwriting input)
- Brush button on the add form when you type Chinese → a pad (米字格): the characters that look
  like your drawing line up above it, and part of one is enough (女 on the left → 好 妈 她 姐).
  Tap one to add it to the field; undo stroke, clear, delete last character. Open/closed is
  remembered.
- Offline, in a worker (`lib/handwriting.ts`): Make Me a Hanzi stroke medians (Arphic PL, licence
  in `public/handwriting/`) for all of GB2312, 605 KB fetched the first time a pad opens. Own
  matcher (no GPL HanziLookup): strokes paired by the Hungarian method (so order barely matters),
  plus a "completion" pass on the pad's own coordinates; ties go to lower HSK levels.
- `frontend/scripts/check-handwriting.ts` (needs graphics.txt + dictionary.txt): HSK 1–4, sloppy
  99% top-1 · strokes swapped 99% · a stroke missing 76% top-1 / 99% shown · left half only 62%
  shown. ~15–20 ms per stroke on a desktop.
- Tester fixes, same evening: (1) every downward stroke on the pad pulled the add sheet down, and
  a quick one threw it shut mid-character — the pad now owns its touches (`data-own-touch`,
  `useSheetDrag`); checked with finger events on a phone-sized page, and the check fails with the
  line taken out. (2) A 我 without its 提 wasn't in the list at all (Pleco: first). A stroke left
  out cost the same 0.9 as one too many, so six-stroke characters that paid nothing beat it; it
  now costs 0.3–0.9 by length (a forgotten dot or 提 is cheap). The check gained messier strokes
  and two drawings traced from the phone: a stroke missing 76 → 85% top-1, messy + missing
  62 → 76%, both traced 我 in the top 3, nothing else moved. Tried and dropped: re-fitting each
  template's scale/offset to the drawing — it helped wrong candidates more than the right one.
- Not solved: cursive (strokes joined, like a native speaker's 你). One template per character
  can't read it; that takes a model trained on real handwriting (Pleco, Google, the iOS
  handwriting keyboard). HanziLookup(JS) is the same template method and GPL.

### Tester fixes and the first-run pass (2026-09-24→25, outside the list)
Asked for directly after the first tester's report, so none of it is a numbered item.
- Reader on a phone: pinyin can't push the page sideways (`<wbr>` per word + minmax(0) grid
  columns; a global `.grid > * { min-width: 0 }` rule since), word popups are `absolute` in document
  coordinates (they drifted on a fast swipe), and no whole-text re-render per scroll event.
- Photos from the gallery too (no `capture`), several at once; every text the Reader opens is
  saved (edits update the row, a repeat is the same row, the translation is kept).
- HSK lists: "+" on every word without a card, including ones marked known in the check.
- "Words for you" on Today as well as the Coach, generated before the Coach is opened; for an HSK
  learner chosen from their target level's list (asked to "aim at HSK 4", the model gave HSK 7–9).
- Onboarding: one question per screen, and the whole first five minutes **before sign-in**:
  landing → questions → the check → "Building your plan…" → "Your plan is ready" with the first
  20 words → sign in (beta code first) → Today applies the plan once (`GuestPlan.tsx`) and the
  words are waiting. The check and the deck come from `routes/public.ts` (public list data, no
  account, no model call). The answers go to the account and the coach memory; the plan's words
  a day set both the daily drip and review's new-cards-per-day.
- Dialog scrims no longer stop halfway down after the iOS keyboard closes; Telegram login opens
  the app from the tap itself (no `about:blank` tab left behind to come back to).
- "Words for you" aren't fenced in by the target level (2026-09-25): the candidates add the
  basics the check says are missing (each word tapped as unknown, marked for the model, plus a
  sample of any lower level with a third or more missed) and ~20 words one level up, of which at
  most 2 of 8 picks. Tried with a learner who missed half of HSK 2: 自由, 怎么样 (2) and 具有 (3)
  came back beside HSK 4 travel words. The daily drip still walks down from the target.
- The goal is no longer quoted back: Coach's line uses the HSK level and the readiness count
  ("You recognise N of the M words HSK 4 asks for") instead of "I remember — your goal is “…”",
  and "Words for you" shows a saved goal as one line with "Change", not an open text box.
- Import dialog: the language menu opened behind the dialog (z-140 under z-200); the format
  sample and placeholder are Chinese for a Chinese learner.
- Stop on a batch of new cards is an undo (the learner's call, 2026-09-25): it removes the
  batch's cards except any already reviewed ("I stopped but it still created" — the cards exist
  from the moment of adding, Stop used to halt only the model). `scripts/check-import-stop.ts`.
- A Russian speaker doesn't read English: a batch's meanings are written in one model call before
  the per-card upgrades (`translateDictMeanings`; the 20 plan words in 5.8 s, was ~2 min of
  English), and while a meaning is on its way the list, word page and Reader show a placeholder,
  not the CC-CEDICT English — that stays only as a labelled fallback when the model never came.
- The import tracker is one slim bar (it took a third of a phone screen), in all 3 languages.
- Onboarding: "I'm learning another language" hidden while focused.
- The loading is real, and nothing gets around onboarding (`OnboardingGate`, 2026-09-25). After
  sign-in, the plan from the guest onboarding is made on a screen of its own: "Saving your plan ·
  Making your 20 cards · Writing their meanings in Russian", then "Welcome to Onomika — your 20
  words are ready" with each word and its meaning, and Continue (~5 s; `/words/batch` takes
  `meaningsFirst`). An account with no target and no cards — "I already have an account" tapped
  by someone who hadn't one — gets the onboarding full-screen on every route, no nav, ending the
  same way. Examples keep arriving in the background, without the tracker.
  Follow-up, not done: precompute the Russian for the ~11.4k HSK headwords once (one offline
  model pass over `data/cedict.jsonl`), so the plan screen could show meanings **before**
  sign-in and a Reader tap would never wait on the model for an HSK word — the thing the learner
  actually asked for ("while it loads you sign up"). Needs a way to keep the Reader's
  sentence-sense upgrade, which today only replaces the dictionary's English.

### The focus pass
F0–F11 shipped 2026-09-22→23. **F6a is the one left**, and deliberately last: its whole
argument is that it compounds *with users*, so it is worth least on the day you have none.
The focus pass made the app narrow and reachable; §Now above is what makes it *true*. V0–V3
still gate the invites, and nothing should be sent to a stranger before F13–F15 land.

- [x] **F0. Landing metadata (1 session, do it first — it's wrong right now).** `app/layout.tsx`
      still says "Onomika — learn English through the news" with a description about Chinese
      translations of English words: that is the Google result, the browser tab and the Telegram
      link preview. Fix title + description, add an `og:image` (links shared in Telegram render
      bare today), and detect `navigator.language` → ru in `I18nProvider` (`lib/i18n.tsx`, which
      reads localStorage only, so every first-time Russian visitor lands in English). Landing
      *copy* is left alone until the focused UI exists — it gets rewritten with F5/F7.
- [x] **F1. Measure anything.** No analytics exist, so the strategy is unrunnable blind.
      Activation funnel (sign-in → first card → first review → first use-step), D1/D7/D30,
      use-step completion. Privacy-friendly (Plausible or events in our own DB).
- [x] **F2. Learner-model foundation.** `ReviewEvent` keeps only userId + time. Log every
      review with wordId, grade and source (review / quiz / drill / scene / chat). Move
      level, native language, goal and retention out of localStorage onto the User. Keep the
      placement test's "known" answers instead of discarding them. Cannot be backfilled later.
- [x] **F3. Production state + "can use".** Stop collapsing "used it in a drill/scene" into an
      FSRS Good. Per-word production evidence (correct / partial / wrong, when, which error),
      separate from the recognition schedule, plus a "can use" status and a weekly
      "know → can use" count.
- [x] **F4. HSK lists + readiness mark.** Official HSK 2.0 (2026 exams) and 3.0 lists as data,
      a level tag per card, and a readiness mark per target level split into recognise vs can
      use. Label it *vocabulary* readiness — never a predicted exam score.
      - Both lists ship as `backend/src/data/hskWords.ts` (word + pinyin + level only, MIT
        source, regenerate with `scripts/build-hsk-lists.mjs`); the level tag is derived on
        read, so nothing needs backfilling when the lists change. Recognise = past the FSRS
        learning steps or "known" in the placement test; can use = F3's ledger; the target
        (list + level) lives on the User.
      - Known gap for F5: upstream is ~9 headwords short of the official HSK 2.0 5000 and
        has no 你好 entry (it counts 你 + 好). Worth a pass over the missing ones before the
        gap deck is built on these counts.
- [x] **F5. One onboarding path.** Target level → readiness check → gap deck → first review →
      first use-step, in ~5 minutes. Russian native by default; infer the pair from the input.
      Plus the textbook path: photo/paste this week's word list → cards with the sense met.
      - Found during F2: the bot's `add` passes no `level` at all, so a card added from
        Telegram is generated levelless while the same word added on the web is tuned to the
        learner's CEFR. The level now lives on the User, so the bot can read it — do it here.
      - Shipped as `components/HskFirstRun.tsx`, now the default first run; the generic
        flag-grid flow is kept behind "I'm learning another language". Two new list
        primitives back it: `GET /api/hsk/check` (a sample spread over levels 1..target,
        whose taps go back through the existing placement endpoint) and `GET /api/hsk/gap`
        (words up to the target with neither a card nor an "I know it"). The bot's `add`,
        `tut:addall` and practice drill now read the level off the User via `resolveUserPair`.
      - Left for F7/F8: the HSK path is chosen by the learner on that first screen, not by
        the focus flag — when the flag lands it should pick the path instead.
- [x] **F6. Dictionary-grounded Chinese senses (+ a RU/EN quality eval).** Senses are LLM-only
      today and produced 3 correctness bugs in 3 days, all on the Chinese→Russian path
      («включить» → 打开 only; the 指出 sense ticks). Design: **the dictionary owns the sense
      inventory, the model only picks and shortens.** Never let the LLM invent the list of senses,
      never show a raw dictionary entry.
      - `zh→en`: ground in **CC-CEDICT** (CC BY-SA — attribute it, and keep the derived data
        separable from the rest of the app).
      - `zh→ru`: the extra hop is where errors enter. **BKRS** has a downloadable dump (DSL,
        `dabkrs_vNN`) but states no licence, and Pleco's own forum says it reportedly contains
        entries copied from other dictionaries — so treat it as an **internal reference for QA
        first**, and ask bkrs.info before shipping its data inside anything paid. Fallback that is
        always safe: CC-CEDICT sense inventory → model writes the Russian gloss.
      - **Eval before deciding (do this first, it is one sitting):** 100 HSK 4–5 words weighted
        toward polysemous ones, generate `zh→ru` and `zh→en` cards, count wrong-sense and
        wrong-register errors against BKRS + CC-CEDICT. If the two rates match, plain generation is
        fine and grounding can wait; if Russian is worse, the numbers say where to spend the work.
      - Shipped: `data/cedict.jsonl` (CC-CEDICT cut down to the 11.4k HSK headwords, 29 of them
        not in the dictionary), built by `scripts/build-cedict.mjs` from the release stamped in
        the file's own `_meta`. Read by `services/cedict.ts`, which also counts misses — words
        outside the subset fall back to the ungrounded path, and the hit rate is a tile on the
        admin dashboard. Both places that could invent a sense are grounded: `agents/enrich.ts`
        (the add path) and `wordSenses` (the word page, senses v5). Attribution shows under the
        Meanings list, not just in a file header — BY-SA asks for it where the data is seen.
      - Grounding shipped ahead of the eval on purpose: the eval sizes the RU-vs-EN gap, it was
        never what decides whether the model invents senses — 打开 and 指出 already settled that.
      - **Eval run 2026-09-23** (`backend/eval-senses.csv`, 100 HSK 4–5 words, zh→ru, marked by
        Claude — spot-check before quoting it): ungrounded 90/100 right sense, grounded 99/100,
        9 fixed, 0 broken. But read the fixes: **6 of the 9 were the ungrounded arm answering in
        English** (打击 → "to strike, to hit"), not a wrong sense. On wrong sense alone it is
        96 → 99. So grounding's biggest measured win is that quoting a dictionary keeps the model
        in the right language, which was never the bug we set out to fix. The one error grounding
        did not touch: 护士 → "медсестра, сестра-хозяйка" (a matron, not a nurse) in both arms.
      - **Found by the eval — CC-CEDICT's gloss order is not frequency order**, and both grounded
        prompts say "pick the first listed sense". That is why 洞 now leads with пещера rather
        than "hole", 琴 narrows to the guqin rather than instruments generally, and 牌 chose
        signboard over playing card. Harmless at this sample size, wrong in principle. Fix when
        F6a lands (usage counts give a real frequency signal); until then a word whose first
        gloss is a surname, a classifier or a rare literary sense is the case to watch.
      - **Left for you (one sitting, offline):** re-run the eval. `npx tsx scripts/eval-senses.ts`
        generates the same 100 HSK 4–5 words through both the old prompt and the grounded one and
        writes a CSV; mark `ungrounded_ok` / `grounded_ok` 1 or 0 — one binary question, "is the
        sense right" — then `--score` it. zh→ru only, because 400 judgments is how an eval dies
        and zh→en is the path CC-CEDICT grounds directly. Register notes go in `notes`, not
        the score. Caveat while marking: the `reference` column *is* the grounded arm's source,
        so check contested words against BKRS or Pleco rather than treating it as an answer key.

- [x] **F7. Focus the surface.** One flag (`NEXT_PUBLIC_FOCUS_MODE`) hides Community/social,
      friend profiles, the graphs, the extra quiz modes and the second chat surface; nav becomes
      Today · Words · Capture. Delete nothing — the defence demo flips the flag back.
      Also switch **off the Tavily web-example path** here (Pro-only today, so no free-tier
      value is lost): `services/search.ts` restricts English to Reuters/BBC/Guardian/NPR/AP
      — the old "learn English through the news" engine — and sends Chinese to the open web.
      For HSK prep a level-controlled composed example beats a mined news sentence, it costs
      ~4× a reader-add (`UNIT_ECONOMICS.md`), and it splices untrusted web text into prompts,
      which is surface that item 5 would otherwise have to harden. Keep the code, keep
      `Example.sourceName/sourceUrl`, leave `TAVILY_API_KEY` optional. Revisit for advanced
      learners (HSK 7–9) or the IELTS stage — and then with a Chinese corpus or graded source,
      not open-web search.
      - Shipped as `frontend/lib/focus.ts` (`FOCUS`, on unless `NEXT_PUBLIC_FOCUS_MODE=off`)
        and `FOCUS` in `backend/src/lib/env.ts` (`FOCUS_MODE`). Nav is Today · Words · Reader,
        the rest under "More" on both the sidebar and the phone bar. Community, friends,
        public profiles and `/coach/chat` return 404; the deck-publish button, the word-family
        graph, the Today charts, the cloze/mixed quiz modes and the AI/web example picker are
        hidden. The backend ignores `exampleSource: "web"` while focused, so no stale client
        reaches Tavily.

- [x] **F8. Narrow the language pickers — keep BOTH Russian and English.** `LEARNING_LANGS`
      → Chinese first (English stays available), `PICKER_LANGS` → zh/en/ru, hide "add a custom
      language". Keep `LANGS` whole so old cards still render, and leave the backend permissive.
      **Both ru and en stay first-class** as interface languages and as the "I know" side: many
      Russian speakers deliberately study Chinese *through* English to practise both at once, and
      CC-CEDICT (F6) is Chinese→English anyway, so the zh→en path is well supported. That is a
      setting, not a second audience — marketing copy stays single-voice per visitor (F0 detects
      the locale). Reversible, no migration.
      - Also F5's leftover, left out of F7 on purpose: the first run's "I'm learning another
        language" link still exists while focused, because this item keeps English a
        first-class learning language. Decide here whether the focus flag hides that link.
      - Done in `frontend/lib/langs.ts`: focused, `PICKER_LANGS` = zh/en/ru (Chinese first)
        and `LEARNING_LANGS` = zh/en; `LANGS` stays all eight so old cards still render, and
        `DEFAULT_LEARNING_LANG` starts the generic first run on Chinese. "Add a language" is
        hidden in `LangSelect` while focused. **The "another language" link stays** — English
        is a first-class learning language here, so the link leads somewhere real. Backend
        untouched (still permissive), no migration; `NEXT_PUBLIC_FOCUS_MODE=off` restores all eight.
- [x] **F9. Bot as the daily trigger + capture inbox.** Fix the probable account split for
      Google/email users (`ensureBotUser` keys on the numeric Telegram id). Then: morning push →
      review → one use-step, and `add`/photo capture into the deck.
      - Identity: `ensureBotUser` now resolves the numeric id through `AuthIdentity` and returns
        the **canonical** `User.telegramId`; one middleware in `bot/index.ts` does it once per
        update and every handler reads `acct(ctx)` — no handler keys on `ctx.from.id` any more
        (except the `login_` deep link, which must stay a Telegram identity). Linking Telegram on
        the site no longer dead-ends either: `absorbStub` moves the identity (and the chat id) off
        an empty bot-created account instead of throwing. Verified against the local DB for all
        three cases — web-first, bot-first, and the real clash, which is still refused.
      - Daily loop: the nudge is **one** button ("Начать"), and when the review queue empties the
        bot offers the day's one use-step (`us:start` → a single-word coach drill, graded as
        production, not as a review). One tap, not automatic — it costs a model call.
      - Capture: send a **photo** → OCR (same `FREE_MONTHLY_OCR` allowance as the Reader, via the
        new request-free `takeMonthly`) → the Chinese words you don't have yet, as one-tap buttons.
        Segmentation is greedy longest-match over CC-CEDICT (`cedictHas`, which deliberately skips
        the coverage counters); single characters are dropped, and non-Chinese pairs get the text
        plus `add слово`. `/add <word>` now works alongside `add <word>`.

- [x] **F10. A landing a stranger can read.** F0 fixed the tab title and the Telegram preview
      but left the *copy* on purpose, "until the focused UI exists" — F5 and F7 have shipped, so
      that's now. Today an unrecruited visitor gets `BetaGate` and nothing else: "Onomika в
      закрытой бете, введите код". No promise, no screenshot, no reason to want a code. The
      positioning line from `STRATEGY.md` §Brand has nowhere to live yet, and `STRATEGY.md`
      §"If you accept this" (1) asks for it on the landing page.
      - One page above the code box: what it is (HSK readiness for Russian speakers), the loop in
        three steps (photo of the lesson list → review → use-step), the readiness mark as the
        picture, and one honest line that it is a closed beta. Russian first (F0 detects locale),
        en/ru/zh like every other string.
      - Never claim a predicted exam score — §F4's rule holds in marketing copy too.
      - This is the "simple landing/marketing page for the invite" in `BETA_CHECKLIST.md` 🟡. It is
        not optional any more: the 30–50 testers come from communities where the link is all they see.
      - Shipped as `components/FocusLanding.tsx`, picked by the focus flag in `GuestExperience`;
        the full-build landing is untouched behind `NEXT_PUBLIC_FOCUS_MODE=off`. The header chrome
        both share (`LangMenu`, `ThemeToggle`, `Reveal`) moved to `components/LandingChrome.tsx`.
      - The picture is a still of the real readiness card, with sample numbers whose level rows add
        up to the headline (HSK 2.0 cumulative to level 4 = 1200), the two-number track, and
        `hsk.subtitle`'s "not a predicted exam score" line kept under the title. A second paragraph
        says outright that we don't predict the score and why — the F4 rule, in marketing voice.
      - Copy lives in the file's own `copy` object (ru/en/zh), same pattern as `LandingScreen`;
        the review still borrows `review.again…easy` from i18n so the grade labels can't drift.
      - Backlog note, not done here: the "closed beta" bullet promises the author answers the bug
        button — that's H4, and the landing should link the channel once it exists.

- [x] **F11. The HSK track is a property of the account, not of having Chinese cards.**
      Found by using prod on an account that predates the pivot (V0, day one — exactly what it is
      for). F7 hid the surfaces that didn't serve the loop; it never removed the *questions* the
      loop already answers, and it never gave an existing account a door into the loop. Today:
      - `app/page.tsx` renders `FirstRun` — which holds the whole HSK path (target → check → gap
        deck) — only when `collected === 0`. One card on the account and it is gone forever.
      - `HskReadiness` returns null unless `stats.languages.includes("zh")`. So you need Chinese
        cards to see the HSK card, and the only screen that hands out Chinese cards requires zero
        cards. **A closed loop with no door**: an account with pre-pivot English cards sees the old
        app minus the hidden features and nothing HSK at all.
      - `api.hskGap` has exactly one caller in the codebase, inside that unreachable screen. So the
        gap deck is one-shot even for a *new* tester: they get their first 20 words, and in week two
        there is no way to ask for the next 20. The loop the whole strategy rests on runs once.
      - Fix: the track is `User.hskVersion`/`hskTarget` (already there from F2), not an inference
        from card languages. Readiness shows whenever a target is set; a repeatable "next gap words"
        action lives on it; an account with cards but no target gets a dismissible way in.
      - Shipped as `components/HskTrack.tsx` (mark / flow / dismissible offer), a `refill`
        variant of `HskFirstRun` whose placement check is optional, and a `Profile` type fix —
        `/auth/me` has always sent `hskTarget`, the client type just dropped it.
      - **The pair question was split out as F17.** **This made the loop reachable, not correct:**
        the deck it opens is the fault F13–F16 fix.

## Reference

### Shared dictionary — full design note (open, item 27)

- [ ] **F6a. Shared dictionary that learners correct (not just a cache).** Today every
      `addWordForUser` spends an LLM call even when another learner already has a good card for
      the same (word, pair). `UNIT_ECONOMICS.md` proposed this and it was never built.
      - **Split the card in two.** A shared `DictEntry` keyed (word, srcLang, tgtLang, version)
        holds the dictionary half: phonetic, POS, the **full sense inventory**, synonyms/antonyms
        and one default example. Everything personal stays on `Word`: which sense the learner
        picked, the sentence they met it in, their notes, FSRS and production state. Never copy a
        user's own sentence into the shared table.
      - **Keys that matter:** meaning style, CEFR level and example register change the output, so
        either key on them or cache a neutral base and vary only the example.
      - **Don't freeze today's error rate.** Cache only entries that F6 grounded (or that survived
        N users without an edit), and bump `version` to re-generate everything when prompts or
        grounding change. A user edit or report invalidates that entry.
      - **Free quality signal:** count uses and edits per entry. A high edit rate names exactly
        which senses the model gets wrong for this pair — this is the start of the pair-specific
        error data in STRATEGY.md §H, and it costs nothing to collect.
      - **Corrections are the point.** A learner who spots a wrong meaning fixes it. The fix
        lands on **their own card immediately** (never make someone argue with a queue to study),
        and becomes a **suggestion** against the shared entry. Promote a suggestion when it repeats
        across learners or when you approve it — reuse the `DeckReport` admin-queue pattern rather
        than building voting or reputation for a handful of users.
      - **Structured corrections, not free text:** wrong sense / missing sense / wrong register /
        bad example / typo. That turns edits into a labelled dataset of where the model fails for
        this pair, instead of noise. Free text stays as an optional note.
      - **Human fixes outrank regeneration.** Keep the AI original, the correction, who made it and
        when. A `version` bump re-generates untouched fields only — a verified field is never
        silently overwritten.
      - **Show provenance on the card** ("AI · verified by N learners" / "from CC-CEDICT"). It is a
        trust signal against Pleco, and later a marketing asset in its own right.
      - **Terms:** if contributions become a shared asset, the ToS has to say so, and CC-CEDICT-derived
        data keeps its BY-SA obligations. Fix this before the dictionary is worth anything.
      - **Why it matters more than cost:** tokens are already ~¥0.0007/card. The wins are latency
        (F5's 30-word list becomes a deck instantly on cache hits) and, over time, **a Chinese–Russian
        sense inventory verified by learners** — the one asset here that compounds and cannot be
        copied quickly (STRATEGY.md §H). It only compounds with users, so it stays after F1–F5.
        With one user it is still your own verified dictionary, which is worth having anyway.

### Naming criteria (item 20)
"Onomika" is disliked (too long). Every `onomika.*` is still free; 11 of 14 short alternatives
are taken. Own session: 2–3 syllables, readable in RU + EN, free `.com`, no obscene reading in
Russian (rules out pinyin *hui*), not locked to Chinese. Decide **before** buying the domain.
Renaming costs: bot handle, Vercel/Railway project names, docs, landing copy, the stale `lexa.*`
localStorage prefix and the repo name.

### Dropped 2026-09-22 (strategy pass — STRATEGY.md §G)
11 realtime WS read-aloud · 12 admin charts + CSV (a SQL query does it) · 14 meaning backfill ·
15 collection graph · custom free-text scenes · phoneme scoring for English accents (ELSA/Speak
territory; returns only as HSK tones in S2) · Pro Plus tier · further community/social work.

### Parked (🧊, only if asked)
Traditional Chinese toggle · Anki export (import matters more) · custom scenes.

### Done (pre-focus, 2026-06 → 2026-09)
- [x] **1. Deploy.** Merge `social` → `main` and push, then follow `DEPLOY.md` (Railway
      backend + Postgres, Vercel frontend). Needs you in the dashboards. Write the new
      URLs into DEPLOY.md.
- [x] **1a. Mika page.** A full `/mika` page (sidebar entry) reusing the floating tutor's
      chat + "add these words" logic, with a welcome screen of preset prompts that double
      as a tour of the app. IDEAS: "Mika page".
- [x] **1b. Social layer + Community tab.** Collection visibility (private / friends-only /
      share code / public; others read-only, owner edits). One-level folders (folders hold
      collections, never folders). Copy a whole deck (only words you don't have, with
      examples + synonyms) or single words, keeping a "from @friend's HSK4" credit.
      Community tab: popular this week, search by language + topic. Seed it with curated starter decks (IELTS, HSK 1–4, core
      adjectives, travel, phrasal verbs…) under an "Onomika Library" author with an
      "Official" badge (some decks "Picked by Mika, your AI tutor"), never fake users.
      Real-use counters: "added by N learners", "popular this week". Seed words are
      written by hand into a seed file (no Qwen cost). IDEAS: "Social layer".
- [x] **1c. Friend profiles + privacy.** Per-friend profile page: reviews-per-day graph,
      streak, mastered count, current languages, their public decks. Per-user privacy
      switches (profile and collections visible to friends / everyone / hidden).
      IDEAS: "Social layer".
- [x] **1d. Deck reports + moderation.** Report a shared deck; admin queue to keep or
      delist; no "add friend" on strangers' profiles (referral code only). IDEAS: "Social layer".
- [x] **1e. Mobile shell, pass 1.** Tab bar with Mika in the centre + 3 user-picked tabs
      (customize in More), header "+" quick-add sheet and bug button (no floating FABs on
      phones), Mika / More as bottom sheets, all dialogs keyboard-aware (visual viewport).
- [x] **1f. Mobile polish, pass 2.** Walk every page at 375px and fix cramped/overlapping
      layouts (reader toolbars, review/quiz controls, word page, collections).
- [x] **1g. My words tidy-up.** One filter block (search + sort, status segments, set/pair
      dropdowns; pair chips dropped), phone "Add a word" row opening the quick-add sheet,
      add form reordered (word field right under the pair), matching segment styles.
- [x] **2. Beta-gate fixes.** Skip the beta-code screen when `BETA_KEY` is empty; per-person
      rate limits behind the Vercel proxy (`trust proxy`). IDEAS: "Deploy / beta follow-ups".
- [x] **3. Coach scenes: UX + bugs.** Play through the scenes and judge whether they're
      fun; fix bugs; add more presets. IDEAS: "Scenes — backlog".
- [x] **3a. Word senses (Pleco-style).** Word page "Meanings": 2–4 numbered senses with
      part of speech + 1–2 short phrases each (pinyin + translation), replacing the flat
      Collocations row. Learner ticks which sense(s) the card tests (one, several or all)
      → rewrites `meaningZh`. Generated on first open, cached in a `senses` JSON column.
      IDEAS: "Word senses (Pleco-style)".
- [x] **3b. Collection → Practice drilled nothing.** "Практика" on a set handed the ids over,
      but the pair defaulted from the whole deck first and filtered them all out ("add some
      words first" on a full set). Fixed 2026-09-20.
- [x] **3c. Senses split by part of speech.** 仔细 shows "наречие внимательно" and
      "прилагательное внимательный" as two senses — one meaning, split by grammar. Merge POS
      variants into one row, keep sense order the same across en/ru/zh, bump the cache version.
      IDEAS: "Senses overlap".
- [x] **3d. Library decks have no synonyms/antonyms.** Seeded words store empty arrays, so the
      curated decks show an empty grid where AI-added words show a full one. Hide-when-empty +
      hand-written `syn`, or lazy enrichment on first open. IDEAS: "Library decks".
- [x] **3e. Stream LLM answers.** Prose (Mika chat, `/mika`, scenes, explanations) arrives as one
      finished wall of text after a spinner; stream it token by token over SSE. JSON pipelines and
      the bot stay as they are. Check token attribution still lands on aborted streams.
      IDEAS: "Streaming LLM output". Done 2026-09-20: Mika streams; the coach and scenes
      already did. Found along the way that `streamNdjson` listened on `req` "close", which
      never fires for a POST — so a disconnect kept generating (and paying) to the end.
- [x] **3f. Mika widget header.** The "Учу … отвечает на …" pair picker eats a third of the phone
      panel over two lines. One compact `EN → RU` chip opening a small sheet, same on `/mika`.
      IDEAS: "Mika widget header".
- [x] **3g. Add a word: which language is which.** "Русский → Китайский" between two bare
      dropdowns reads as a translation direction, so the pair gets set backwards and the card
      comes out in the language you already speak — and "Ввожу на" (type the meaning, get the
      word, the reason you open a dictionary) hid under Дополнительно. Both sides labelled
      Учу / Знаю, the typed side promoted onto the field with a line saying what the card
      will be, swap carries the typed language with it, and a dismissible nudge offers the
      swap when the studied language is the one the interface is in. Done 2026-09-20.
      Follow-up 2026-09-21: that guess misfired for anyone studying in the interface's language
      ("Learning Russian instead?" to a Russian learning English). A native-language pref now
      decides it: the first run saves "I know", Settings edits it, and until it's known the
      nudge asks which side is yours instead of offering the swap.
- [x] **3g. Mika chat: other languages, history, steady composer.** A chat started as en→en can't
      save the Chinese words it just explained (clear the chat, switch the pair, ask again); the
      "add to set" row appears a second after a reload; the composer only moves once the page
      scrolls and rests at a different height than it sticks at. Done 2026-09-20: Mika tags a
      suggested word's own language and those save into their own pair (zh→en from inside an
      en→en chat), the last 12 chats are kept in the browser behind a History menu on both Mika
      surfaces, the set row holds its place while the sets load, and `/mika` uses the coach
      pages' fixed-height layout so the composer never moves.
- [x] **3h. Senses ticked wrong in Chinese; explanations live in Mika now.** The word page read
      the ticks back out of the card's meaning by looking for any shared word, which is fine in
      Russian and wrong in Chinese, where senses share a head word: a card saying 指出 claimed
      both 指出（错误…）and 指明，指出（位置…）were on it, and saving both wrote "指出; 指明，指出".
      The pick is written down on the senses instead (with the meaning it was made for, so a
      hand-edited meaning drops it), overlapping terms are dropped when composing — "指出；指明",
      CJK punctuation and all — and the save shows what the card will say before it says it.
      "Объяснить с Onomika" now opens the Mika widget instead of a panel wedged into the page:
      the chat is about that card (its own endpoint, so it can still add synonyms, antonyms and
      examples to it, and "Проверь меня" is still there), it streams into the history like any
      other chat, and the widget's History moved next to the language chip with a search box.
      Done 2026-09-20.
- [x] **4. Per-user token cost + real ASR/OCR pricing.** IDEAS: "Per-user token attribution",
      "Accurate ASR/OCR cost". (Note: `pricing.ts` still prices ASR at ¥0 — audio-seconds
      are not captured.)
