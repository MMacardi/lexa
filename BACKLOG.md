# Backlog — one item per session

Take the top unchecked item, do it, tick it, `/clear`. Details for each item: grep
`IDEAS.md` for the quoted heading. The reasoning behind this ordering is `STRATEGY.md`.

**Positioning (decided 2026-09-22).** HSK prep for Russian speakers: an honest readiness
mark, then the official word list and this week's textbook words turned into words the
learner can actually **use**. One exam first (HSK). IELTS is a possible second exam on the
same engine, only after HSK keeps strangers coming back. Everything else gets hidden, not
deleted — `onomika_old` holds the full-featured build.

## Now — the focus pass
F0–F10 shipped 2026-09-22→23. **F6a is the one left**, and deliberately last: its whole
argument is that it compounds *with users*, so it is worth least on the day you have none.
The next thing that matters is not code — it's V0–V3 below, and the invites F10 now has
somewhere to point.

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

## Before public launch
- [ ] **5. AI prompt-injection hardening.** IDEAS: "AI prompt-injection hardening".
      F7 switched off the Tavily web-example path, which removed the worst untrusted-text
      surface; OCR/photo capture (F9) and pasted Reader text are the ones left.
- [ ] **6. Naming decision.** Blocks item 6a — decide before buying anything. Criteria and the
      rename cost are in "Naming (open)" below. Own session, no code.
- [ ] **6a. Domain + email.** After the naming decision: buy the `.com` (+ `.ru`), set `SMTP_URL`
      + `EMAIL_FROM` and send a test login link, attach the domain to Vercel. IDEAS: "Site email".
- [ ] **7. Legal pages.** Add a line to /privacy about the F1 event log (signin / card
      added / review / use-step, kept in our own DB, no third-party tracker, no page views),
      and one about the F3 production ledger. Fill the four `[ЗАПОЛНИТЬ: …]` placeholders in
      each of /privacy and /terms (operator identity, contact email, jurisdiction, min age) —
      they need a real contact address for deletion requests, so item 6a comes first.
      F6a will add a ToS clause about shared corrections; don't rewrite these pages twice.
- [ ] **8. Bump Next.js** + `npm audit`. IDEAS: "Bump Next.js".
- [ ] **9. Payments.** DELAYED until retention exists. Then ONE Pro tier (~499 ₽) — no Pro Plus.
      Vercel Hobby forbids commercial use, so upgrade before charging. IDEAS: "Payment".

## Launch hygiene — in BETA_CHECKLIST.md but never in this backlog
`STRATEGY.md` §"If you accept this" (7) names backups and Sentry next to items 5–8; they were
in the checklist and so never got a session. None of them is a feature, all of them are things
you only notice the absence of after a stranger has hit them.
- [ ] **H1. Backups + one rehearsed restore.** Enable Railway Postgres backups, take one by hand
      via `DATABASE_PUBLIC_URL`, then **restore it into the local Docker Postgres (host 5433)** —
      an untested backup is not a backup. F2/F3 made the DB the only copy of the learner model:
      the review log and the production ledger exist nowhere else and cannot be regenerated.
- [ ] **H2. Error monitoring + uptime.** No Sentry anywhere in the repo today, so a crash a
      tester hits is invisible unless they report it. Sentry (or similar) on backend + frontend,
      plus an uptime check on the existing `GET /health`. Keep the DSN out of git.
- [x] **H3. Account data export + delete, in the UI.** `BETA_CHECKLIST.md` 🟡, but /privacy is
      about to promise deletion rights (item 7) and today deletion is "by request" — the promise
      and the product have to match. The cascade already exists; this is a button and a JSON dump.
      - It was **not** just a button: `Word.user` is the one relation in the schema with no
        `onDelete: Cascade`, so `prisma.user.delete()` fails on `Word_userId_fkey` for anyone who
        ever added a card (verified against the local DB, not assumed). And four tables carry the
        owner as a plain string with no foreign key at all — `ReviewEvent.userId`,
        `ProductionEvent.userId`, `AnalyticsEvent.telegramId`, `UsageCounter.key` — so Postgres
        would have left the F1 activity log and the F2/F3 learner model behind and nothing in the
        app would ever have noticed. `services/accountData.ts` holds export and delete together so
        a new table can't be added to one and forgotten in the other.
      - `TokenUsage` is kept but **anonymised** (telegramId → null) rather than deleted: those rows
        are what the month actually cost (`UNIT_ECONOMICS.md`), and with the id gone they name
        nobody. Everything else that points at the learner is deleted outright.
      - `GET /api/account/export` (a JSON download) and `POST /api/account/delete` (body
        `{confirm:"DELETE"}`). Both skip the **invite** gate but not the identity one — someone who
        signed in and never redeemed a code still owns their data. The typed confirmation also does
        real work: prod cookies are `SameSite=None`, and a cross-site HTML form post has no CORS
        preflight to stop it, but `express.json()` won't parse a form body, so `confirm` arrives
        undefined and the request dies. Verified end to end with curl.
      - Found and fixed next door: `GET /auth/me` answered a session whose account no longer exists
        with a hollow 200 profile, which the client renders as "signed in" — a deleted account on a
        second device got an app shell where every route 403s. It now clears the cookie and 401s.
      - `scripts/check-account-delete.ts` builds a user with a row in every affected table, exports
        it, deletes it and fails loudly if anything survives. Run it after adding a table that
        stores a userId or telegramId.
- [ ] **H4. Feedback channel the tester can find.** The bug button and `deliverFeedback` exist;
      what's missing is a place to *answer* — a Telegram chat or group linked from the app and
      from the F10 landing, so a 6-week beta is a conversation rather than a one-way form.

## Before inviting strangers (no code — the strategy runs on these)
`STRATEGY.md` §Verification. Nothing here is a feature, and skipping it is how the focus pass
ends up measured against nobody.
- [ ] **V0. Step 0: be user #1.** Use it daily for your own next HSK level for 2–3 weeks before
      recruiting anyone. If you skip a day, find out why — that reason is the next backlog item,
      and it is worth more than any feature guess. This is the gate on everything below.
- [ ] **V1. 8–10 interviews** with target users (classmates prepping HSK, Russian-speaking
      learners at Chinese universities) about how they handle new words *now* — before the beta,
      not during. Explicitly "done first" in the Verification table.
- [ ] **V2. Recruiting list.** Where the 30–50 actually come from, named: which communities,
      which student groups, who introduces you. Not friends without a Chinese exam.
- [ ] **V3. Read the funnel weekly.** `/admin` already renders the activation funnel, rolling
      D1/D7/D30 and use-step quality (F1). Put the four Kill-Test thresholds next to the numbers
      so a miss is visible, and write down what each miss would mean *before* seeing the data.

## University deliverable (graded project)
- [ ] **U1. Refresh the defence materials.** `2024998004014_Anton Volkov/` holds
      `Volkov_Anton_2024998004014.docx`, `Project_Plan.docx` and `source_code_final_project.zip`,
      all from **June 2026** — they predate the strategy pass and every one of F0–F9, so they
      describe a different product. Re-export the source zip, and make the report tell the story
      the repo actually shows: the pivot from "learn English through the news" to HSK prep, the
      learner model (F2/F3), dictionary grounding with a measured result (F6), and the focus flag.
      - Demo path: `NEXT_PUBLIC_FOCUS_MODE=off` restores the full build (Community, scenes,
        graphs) for the defence — check the flag still flips cleanly before the date.
      - Before quoting F6's eval in the report, **mark it yourself**: the 99/100 vs 90/100 in the
        F6 notes was marked by Claude. `npx tsx scripts/eval-senses.ts` regenerates the CSV;
        a number you marked by hand is the one that survives a question about methodology.

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
