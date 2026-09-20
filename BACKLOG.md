# Backlog — one item per session

Take the top unchecked item, do it, tick it, `/clear`. Details for each item: grep
`IDEAS.md` for the quoted heading. New ideas go in IDEAS.md plus one line here.

## Now
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
- [ ] **3c. Senses split by part of speech.** 仔细 shows "наречие внимательно" and
      "прилагательное внимательный" as two senses — one meaning, split by grammar. Merge POS
      variants into one row, keep sense order the same across en/ru/zh, bump the cache version.
      IDEAS: "Senses overlap".
- [ ] **3d. Library decks have no synonyms/antonyms.** Seeded words store empty arrays, so the
      curated decks show an empty grid where AI-added words show a full one. Hide-when-empty +
      hand-written `syn`, or lazy enrichment on first open. IDEAS: "Library decks".
- [ ] **3e. Stream LLM answers.** Prose (Mika chat, `/mika`, scenes, explanations) arrives as one
      finished wall of text after a spinner; stream it token by token over SSE. JSON pipelines and
      the bot stay as they are. Check token attribution still lands on aborted streams.
      IDEAS: "Streaming LLM output".
- [ ] **3f. Mika widget header.** The "Учу … отвечает на …" pair picker eats a third of the phone
      panel over two lines. One compact `EN → RU` chip opening a small sheet, same on `/mika`.
      IDEAS: "Mika widget header".

## Before public launch
- [x] **4. Per-user token cost + real ASR/OCR pricing.** IDEAS: "Per-user token attribution",
      "Accurate ASR/OCR cost".
- [ ] **5. AI prompt-injection hardening.** IDEAS: "AI prompt-injection hardening".
- [ ] **6. Domain + email.** Buy a domain, set `SMTP_URL` (Resend/Postmark), attach it to
      Vercel (also fixes China access). IDEAS: "Site email".
- [ ] **7. Legal pages.** Fill the `[ЗАПОЛНИТЬ: …]` placeholders in /privacy and /terms.
- [ ] **8. Bump Next.js** + `npm audit`. IDEAS: "Bump Next.js".
- [ ] **9. Payments.** YooKassa / Telegram Payments → `User.plan`; a Pro Plus tier for the
      Coach; flip `BETA_ALL_PRO=false`. IDEAS: "Payment", "Launch cluster C".

## Later
- [ ] 10. Weekly recap / coaching message.
- [ ] 11. Realtime WebSocket read-aloud. IDEAS: "True realtime WS read-aloud".
- [ ] 12. Admin charts + CSV export; owner alert emails.
- [ ] 13. Fresh example per review / difficulty adaptation (token toggle). IDEAS: "B6".
- [ ] 14. Meaning backfill (shorten old meanings). IDEAS: "B7".

## Parked (🧊, only if asked)
Phoneme-level pronunciation scoring · Traditional Chinese toggle · OpenClaw revival · Custom free-text scenes · Anki export.
