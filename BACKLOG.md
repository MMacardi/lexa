# Backlog — one item per session

Take the top unchecked item, do it, tick it, `/clear`. Details for each item: grep
`IDEAS.md` for the quoted heading. The reasoning behind this ordering is `STRATEGY.md`.

**Positioning (decided 2026-09-22).** HSK prep for Russian speakers: an honest readiness
mark, then the official word list and this week's textbook words turned into words the
learner can actually **use**. One exam first (HSK). IELTS is a possible second exam on the
same engine, only after HSK keeps strangers coming back. Everything else gets hidden, not
deleted — `onomika_old` holds the full-featured build.

## Now — the focus pass
- [ ] **F0. Landing metadata (1 session, do it first — it's wrong right now).** `app/layout.tsx`
      still says "Onomika — learn English through the news" with a description about Chinese
      translations of English words: that is the Google result, the browser tab and the Telegram
      link preview. Fix title + description, add an `og:image` (links shared in Telegram render
      bare today), and detect `navigator.language` → ru in `I18nProvider` (`lib/i18n.tsx`, which
      reads localStorage only, so every first-time Russian visitor lands in English). Landing
      *copy* is left alone until the focused UI exists — it gets rewritten with F5/F7.
- [ ] **F1. Measure anything.** No analytics exist, so the strategy is unrunnable blind.
      Activation funnel (sign-in → first card → first review → first use-step), D1/D7/D30,
      use-step completion. Privacy-friendly (Plausible or events in our own DB).
- [ ] **F2. Learner-model foundation.** `ReviewEvent` keeps only userId + time. Log every
      review with wordId, grade and source (review / quiz / drill / scene / chat). Move
      level, native language, goal and retention out of localStorage onto the User. Keep the
      placement test's "known" answers instead of discarding them. Cannot be backfilled later.
- [ ] **F3. Production state + "can use".** Stop collapsing "used it in a drill/scene" into an
      FSRS Good. Per-word production evidence (correct / partial / wrong, when, which error),
      separate from the recognition schedule, plus a "can use" status and a weekly
      "know → can use" count.
- [ ] **F4. HSK lists + readiness mark.** Official HSK 2.0 (2026 exams) and 3.0 lists as data,
      a level tag per card, and a readiness mark per target level split into recognise vs can
      use. Label it *vocabulary* readiness — never a predicted exam score.
- [ ] **F5. One onboarding path.** Target level → readiness check → gap deck → first review →
      first use-step, in ~5 minutes. Russian native by default; infer the pair from the input.
      Plus the textbook path: photo/paste this week's word list → cards with the sense met.
- [ ] **F6. Dictionary-grounded Chinese senses.** Senses are LLM-only today (3 correctness bugs
      in 3 days). Ground them in CC-CEDICT (CC BY-SA); the LLM writes the Russian gloss and the
      explanation. Trust is the price of entry against Pleco.
- [ ] **F7. Focus the surface.** One flag (`NEXT_PUBLIC_FOCUS_MODE`) hides Community/social,
      friend profiles, the graphs, the extra quiz modes and the second chat surface; nav becomes
      Today · Words · Capture. Delete nothing — the defence demo flips the flag back.
- [ ] **F8. Narrow the language pickers — keep BOTH Russian and English.** `LEARNING_LANGS`
      → Chinese first (English stays available), `PICKER_LANGS` → zh/en/ru, hide "add a custom
      language". Keep `LANGS` whole so old cards still render, and leave the backend permissive.
      **Both ru and en stay first-class** as interface languages and as the "I know" side: many
      Russian speakers deliberately study Chinese *through* English to practise both at once, and
      CC-CEDICT (F6) is Chinese→English anyway, so the zh→en path is well supported. That is a
      setting, not a second audience — marketing copy stays single-voice per visitor (F0 detects
      the locale). Reversible, no migration.
- [ ] **F9. Bot as the daily trigger + capture inbox.** Fix the probable account split for
      Google/email users (`ensureBotUser` keys on the numeric Telegram id). Then: morning push →
      review → one use-step, and `add`/photo capture into the deck.

## Before public launch
- [ ] **5. AI prompt-injection hardening.** IDEAS: "AI prompt-injection hardening".
- [ ] **6. Domain + email.** After the naming decision (see below): buy the `.com` (+ `.ru`),
      set `SMTP_URL`, attach to Vercel. IDEAS: "Site email".
- [ ] **7. Legal pages.** Fill the `[ЗАПОЛНИТЬ: …]` placeholders in /privacy and /terms.
- [ ] **8. Bump Next.js** + `npm audit`. IDEAS: "Bump Next.js".
- [ ] **9. Payments.** DELAYED until retention exists. Then ONE Pro tier (~499 ₽) — no Pro Plus.
      Vercel Hobby forbids commercial use, so upgrade before charging. IDEAS: "Payment".

## Later (Stage 2 — only after the retention test passes)
- [ ] **10. Weekly recap**, reshaped as the "know → can use" report + next week's gap words.
- [ ] **13. Fresh example per review / difficulty adaptation**, as part of resurfacing.
- [ ] **S2. Resurfacing.** Reader texts and scenes built from words you recognise but can't use.
- [ ] **S2. Anki .apkg import with review history** → FSRS (reverses Anki's switching cost).
- [ ] **S2. HSK speaking** (HSK 3.0 speaking section / HSKK): tones + pronunciation via Alibaba
      口语评测 (~¥0.004/call, researched in IDEAS "B5+"), prompts forcing your gap words.
- [ ] **S2. Tutor mode.** A tutor sees a student's ledger and assigns words — the distribution engine.
- [ ] **S3. IELTS as the second exam**, same ledger + speaking engine. Only with volume, because
      the only edge over SmallTalk2Me and co. is calibration against users' real band scores.

## Dropped 2026-09-22 (strategy pass — STRATEGY.md §G)
11 realtime WS read-aloud · 12 admin charts + CSV (a SQL query does it) · 14 meaning backfill ·
15 collection graph · custom free-text scenes · phoneme scoring for English accents (ELSA/Speak
territory; returns only as HSK tones in S2) · Pro Plus tier · further community/social work.

## Naming (open)
"Onomika" is disliked (too long). Every `onomika.*` is still free; 11 of 14 short alternatives
are taken. Own session: 2–3 syllables, readable in RU + EN, free `.com`, no obscene reading in
Russian (rules out pinyin *hui*), not locked to Chinese. Decide **before** buying the domain.
Renaming costs: bot handle, Vercel/Railway project names, docs, landing copy, the stale `lexa.*`
localStorage prefix and the repo name.

## Parked (🧊, only if asked)
Traditional Chinese toggle · Anki export (import matters more) · custom scenes.

## Done (pre-focus, 2026-06 → 2026-09)
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
