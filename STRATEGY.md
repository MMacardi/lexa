# Onomika — product strategy (decided 2026-09-22)

_The decision and the research behind it. Ordering in `BACKLOG.md` follows §G of this file._

**Evidence used:**
- The whole repo: code, the Prisma schema, the bot, BACKLOG.md, all 601 lines of IDEAS.md, UNIT_ECONOMICS, BETA_CHECKLIST, TASKS, and git history (319 commits, 2026-06-16 → 09-22).
- Current web research on 25+ competitors. Sources are at the end; "unverified" marks claims I couldn't confirm from a primary source.
- Your answers:
  - Friends were invited and none stayed, so you are the only real user.
  - You can reach Russian speakers learning Chinese and Russian speakers learning English.
  - The original goal was a tool for **your own HSK and IELTS prep** (university, then work).
  - **Chinese is your biggest headache** now.
  - The IELTS idea is a speaking bot, trained on IELTS speaking videos, that gives a band mark for grammar, pronunciation and so on. It came up because you and your friends plan to take IELTS.

**Decision: WEDGE → SWISS ARMY KNIFE.**
- **Wedge: HSK prep for Russian speakers.** Show the learner their HSK readiness, then turn the official list plus their textbook's words into words they can actually *use*.
- **One product, not two.** HSK first. IELTS is a possible second exam on the same engine later, only if HSK retains strangers.
- **Subtraction first.** The product today is already a Swiss Army knife, and it retained no one. The first job is to remove surfaces and add one missing data layer: whether the learner *recognises* a word or *can use* it. More features come later.

---

## Your follow-up: one app for HSK and another for IELTS?

**No. Build one product, for one exam, first: HSK.**

**Why HSK and not IELTS:**
1. **It's your biggest headache.** You'll use it every day and feel every flaw. So far you're the only user who comes back, so build for the problem you personally have daily.
2. **The codebase is already a Chinese tool.** Senses, pinyin, CJK segmentation, HSK decks, Qwen's Chinese strength. An IELTS grader would be a new product from scratch.
3. **The competition is very different.**
   - "AI IELTS speaking examiner with a band score" already exists in quantity: SmallTalk2Me (claims 2.5M+ learners), IELTSpeaking (video examiner, band per criterion), Speechful, Socrally, TalkFace AI, SpeakPrac, "IELTS Speaking Practice AI" (claims phoneme-level feedback), IELTS 9, IELTS Evaluator. ELSA and Speak cover it too, and the official British Council and IDP prep apps are free.
   - You haven't seen them, but they're easy to find. That doesn't make the idea bad; it means it isn't a gap.
   - HSK tooling in Russian is thin (§D).
4. **HSK is a ladder, IELTS is a window.**
   - HSK runs over 9 levels and years of study, and each level is a new goal: that's retention.
   - IELTS prep lasts 1–3 months and then the user leaves.
5. **HSK has a timing window.**
   - HSK 3.0's final syllabus (Nov 2025) changes the word lists (cumulative 300 / 500 / 1,000 / 2,000 / 3,600 / 5,400 for levels 1–6) and adds speaking from level 3.
   - A pilot ran on 31 Jan 2026. Regular 2026 exams still use HSK 2.0, and CTI will announce the formal start separately (one source claims 13 Dec 2026, unverified).
   - Existing materials and decks go stale during the transition, so "which new-list words can I actually use?" is a timely question.
   - Test-takers: 719k in 2024; 414k in H1 2025 (+19.6% YoY); ~750k expected in 2025 (China Daily, citing CTI).

**About "trained on IELTS speaking videos":**
- A solo developer can't train a speech-scoring model. There are only dozens of officially banded sample videos, and they're copyrighted.
- Every IELTS grader above does the same thing instead: ASR, plus a pronunciation-assessment API, plus an LLM scoring against the public band descriptors.
- That makes it a commodity pipeline with no moat. Its hard part is **calibration** (does "6.5" mean 6.5?), and the only real fix is real exam results reported by many users.
- Use the official sample videos as a test set, not as training data.
- For your own and your friends' IELTS prep, use SmallTalk2Me or IELTSpeaking. Note where they fail; that's free research if you ever add IELTS.

**What your IELTS idea gets right, and should shape the HSK product:** *"give me my mark"*. An immediate, meaningful score is exactly what the current app lacks in its first session. So the HSK product should open with a **readiness mark**: "you're at HSK 4 level; you recognise 1,410 of the 2,000 words, and can use 380". The whole loop then exists to move that number.

---

## A. Current Product Thesis: what we are actually building

**What the repo says we are:**
- CLAUDE.md: "Anki-style FSRS + Quizlet-style collections + an AI tutor + a Reader".
- The landing page makes two promises: "Turn everything you study into a personal memory system" and "Your personal AI language tutor".
- IDEAS.md: "a personal AI mentor, not a flashcard box".

**What the code says we are:** an AI-built personal vocabulary deck, scheduled with FSRS, for a Russian speaker learning Chinese or English. Around it sit about 12 surfaces, each re-implementing part of a competitor:

| Surface | Re-implements | State |
|---|---|---|
| Review, offline PWA, retention setting, card layouts | Anki | solid |
| Collections, folders, Community, "added by N", reports/moderation | Quizlet | solid, unused |
| Word page: senses, pinyin, family graph, explain | Pleco | solid; senses are LLM-only (3 correctness bugs in 3 days: 3a/3c/3h) |
| Reader: paste / OCR / AI text, tap-gloss, batch save with sentence | LingQ-lite | solid; no URL, video or PDF |
| Coach scenes (22 presets, twist, corrections, report card) | Praktika / Duolingo Video Call | solid |
| Mika widget + /mika page | ChatGPT | solid; **does not see the deck**; history only in localStorage |
| Achievements, streak, heatmap, friends, profiles | Duolingo | solid |
| Telegram bot: review, voice practice, reminders, `add <word>` | — | solid; the bot probably opens a separate empty account for Google/email users (`ensureBotUser`) |

**The one distinctive mechanism is buried.**

What works today:
- The Coach builds its word pool from the learner's own weak, then due, words.
- The drill, chat and scenes make the learner *use* those words, and the grade goes back into FSRS (`practice/page.tsx` L190–202, `chat/page.tsx` L279–288, `scene/page.tsx` L282–295).
- Taps in the Reader and in chat save a word together with the sentence it came from.

That is a closed loop: meet → save → recognise → produce → reschedule. But:
- **Production is collapsed into an ordinary FSRS "Good".** The system cannot tell "recognises" from "can use".
- **The data underneath is thin.**
  - `ReviewEvent` stores only userId and time: no word, grade or source.
  - Scene `corrections` are never read.
  - The placement test throws away the words you already know.
  - Level, native language, goal and retention live only in **localStorage**.
  - Coach memory is 900 characters of prose, updated only after drills and scenes.
- **The learner never sees the loop.** No screen says "words you can now use".

**Where effort went (last 100 commits):** ~18 mobile/UI polish, ~13 add-word flow, ~13 word page/senses, ~13 launch plumbing, ~10 coach/scenes, ~8 Mika, 4 social. Close to zero went to activation, measurement (there are no analytics), acquisition or payments.

**Duplication:**
- 5 chat surfaces plus the drill.
- 5 practice surfaces.
- 7 ways to add new words.
- 4 "what to do today" surfaces. One dedup already happened because they contradicted each other.
- The social layer was written up in IDEAS as "Why NOT for the beta… the beta must prove the AI-mentor loop and the paywall first". It shipped anyway on 2026-09-18.

**Ideas that keep recurring:**
- Token cost (5+ entries).
- Paywall / Pro Plus.
- Pronunciation / realtime ASR (5 entries; built and removed twice).
- China reachability.
- Chinese correctness (senses ×3, pinyin, script).
- "Which language is which" (×3).

The real recurring pains are Chinese correctness and onboarding confusion. Pronunciation is a recurring temptation.

**Thesis:** *Today Onomika is a well-built AI Anki-plus-Pleco for Russian speakers. It has a hidden production loop, is spread across a dozen surfaces, and has no retained users besides its author.*

---

## B. Market Map

### Positioning: whose content × what counts as success

```
                         SUCCESS = RECOGNITION / EXPOSURE                 SUCCESS = PRODUCTION / SPEAKING
                  ┌──────────────────────────────────────────┬──────────────────────────────────────────────┐
 PLATFORM'S       │ Duolingo lessons, Memrise, Babbel,        │ Speak ($100M ARR), Praktika, Pingo, ELSA,     │
 CONTENT          │ Clozemaster, HelloChinese/SuperChinese,   │ Duolingo Video Call, Babbel Speak, Busuu,     │
                  │ Lingopie catalog, Du Chinese              │ Google Translate Practice (free)              │
                  │ → habit + curriculum; very crowded        │ → most crowded, commoditising fastest         │
                  ├──────────────────────────────────────────┼──────────────────────────────────────────────┤
 LEARNER'S OWN    │ Anki, LingQ, Language Reactor, Migaku,    │ Langua (saved words → stories/conversations), │
 CONTENT / WORDS  │ Readlang, Trancy, Yomitan, RemNote,       │ Readlang Ami (chat mistakes → cards),          │
                  │ Quizlet, Pleco, Hanzii                    │ Praktika uploads (photo/PDF), ChatGPT (DIY,    │
                  │ → tools; switching costs = history        │ no schedule), Lexirise (claims)               │
                  │                                          │ → least crowded, NOT empty, nobody owns it    │
                  └──────────────────────────────────────────┴──────────────────────────────────────────────┘
```

Onomika's code already sits in the bottom-right quadrant. Its product surface (menus, landing page) sits in all four.

### Competitor profiles: why each has what it has

| Product | Core user · job | Distribution / retention engine | Strongest · weakest | What users pay for (price) | Strategic role of their AI moves | Hard for us to copy · commoditising |
|---|---|---|---|---|---|---|
| **Duolingo** (+Max) | Mass casual learners · daily habit + feeling of progress | Brand, free tier, social; streaks/leagues (a June 2026 streak revival brought back 15M+ lapsed users). 58.7M DAU, 140.6M MAU, 12.7M paid (Q2 2026) | Motivation engine · Energy friction, "AI slop" perception; Chinese course ~HSK 3 by reviewers' estimates | No ads/energy, Video Call. Super ~$12.99/mo; Max $29.99/mo | AI = cheaper content (20,500 units in Q1 2026) plus conversation to defend against ChatGPT. Explain My Answer free since Jan 2026; Video Call moved into Super; Max may be sunset (secondary). They are pushing AI *down* their price tiers because it's commodity | A/B-tuned gamification at 58M DAU · conversation, explanations |
| **Speak** | Adults (East Asia first) · speak out loud confidently | OpenAI-backed; B2B (500 companies); ~15M downloads, $100M ARR (Nov 2025) | Speaking volume and latency · lenient ASR, repetitive at higher levels | Unlimited speaking reps. $17.99–39.99/mo | Adding course scaffolding (vocab side quests, refreshers, concept mastery); Mandarin to B1 (Jun 2026); GPT-Live-1 live tutor (Sep 2026) | Speech pipeline, B2B · open conversation |
| **Praktika** | Wants a "$8 personal tutor" · avatar conversation | Performance marketing; claims 30M+ learners; $35.5M Series A | **Memory layer** (goals, preferences, past mistakes), per OpenAI's customer story: +24% Day-1 retention, 2× revenue · avatar glitches | Tutor feel. $6.99–9.99/mo | Memory is their retention bet; photo/PDF/voice upload → practice | Avatars at scale · conversation |
| **Pingo AI** | Nervous beginners · "stop tapping, start talking" | Viral snarky persona (1B+ views), influencers; 4-person YC team | Virality · no SRS ("saved words never reintroduced"), beginner-only; revenue fell from ~$480K/mo to ~$350K/mo (36Kr) | $14.99–17.99/mo | Shows a conversation wrapper is easy to build and hard to retain | Their content engine · everything else |
| **ELSA** | Asian/workplace English · pronunciation, tests | B2B/schools; 90M+ downloads (claim) | Phoneme scoring · upselling, voice-detection failures | $19.99/mo, ~$99–130/yr | 2026 redesign adds roleplay and custom scenarios, converging with conversation apps | Proprietary accent-robust model · roleplay |
| **Memrise** | Vocab-first learners · real-world listening | Legacy SRS base; native-speaker video | Native videos · forced flow, dropped community courses | ~$62/yr, $330 lifetime (mapping unverified) | SRS app becoming AI app: MemBot, Podchats, Exam Prep (Feb 2026) | Video library · AI chat |
| **Babbel / Busuu** | Structured adults · courses with grammar (Busuu: native-speaker corrections) | Brand, B2B | Pedagogy · dated content (Babbel); vocab management (Busuu) | $17.99/mo; $70–140/yr | Bolt-on AI conversation (Babbel Speak Sep 2025; Busuu Conversations) | Curricula · conversation |
| **Language Reactor** | Desktop Netflix/YouTube watchers · understand native video | 2M Chrome users; lives inside your viewing habit | Dual subtitles · reliability (2026 outages), no mobile app | Word saving, Anki export. ~$5.95/mo (secondary) | Lexa AI dictionary; Aria chat with editable memory (Pro). No documented link to saved words | Streaming integrations · dual subtitles |
| **LingQ** | Input-first readers/listeners · read anything with lookups | Steve Kaufmann YouTube; 50K lessons | Import + known-words count · known-words model unreliable | Unlimited LingQs/imports. $14.99–29.99/mo | Lynx coach (Jun 2026), AI simplification, YouTube import | Library, community, known-word history · the reader itself |
| **Anki** (+AnkiHub) | Disciplined self-learners, medicine · long-term retention | Free, open source, community decks; AnkiDroid 23M downloads | FSRS + add-ons · setup/UX. Handed to AnkiHub on 2 Feb 2026 | AnkiMobile $24.99 one-time | None built in; AI via add-ons | Years of review history, AnkiConnect ecosystem · FSRS itself |
| **RemNote** | Students · notes + flashcards | Student word of mouth | Notes graph + FSRS · no media or speaking | AI credits. $8 / $18 per month | Paste text → vocab cards; **imports Anki review history**; "Cards to Learn" queue (Jul 2026) | Note graph · AI card generation |
| **Quizlet** | School students · memorise sets | Schools, SEO, 500M+ sets, 60M+ users | UGC scale · no context, no immersion | Plus ~$7.99/mo (secondary) | Added an SRS scheduler (Aug 2026), a ChatGPT app, and the Coconote acquisition; Q-Chat reportedly discontinued | Set network effects · flashcards, AI generation |
| **Clozemaster** | Intermediates · high-volume cloze | Niche word of mouth | Sentence volume · looks near-stagnant | ~$8–13/mo (conflicting) | AI sentence explanations (2024) | Little · most of it |
| **Migaku** | Serious immersion learners (ja/zh/ko) · Yomitan+Anki without the setup | Extension (50K) + apps | Known-words model, comprehension % · "you never speak" | No-setup mining. ~$10/mo (secondary) | AI dictionary using subtitle context, AI subtitles, reader (2026) | CJK parsing, sync · popup lookup |
| **Langua** | Speaking-first learners · conversation + reuse of saved words | 30K+ learners | **Closest to our loop**: saved words → flashcards, stories, conversations; practice on "words you struggled with" · thin immersion; no recognise-vs-produce model found | $19.99–29.99/mo (secondary) | Converging from the speaking side toward the word ledger | Cloned native voices · the loop, if they formalise it |
| **Google Translate Practice / Gemini** | Everyone with Translate · casual practice | Billions of users; free; streaks added (Dec 2025); pronunciation feedback (2026) | Zero price, reach · "directionless"; no RU→ZH pairs yet | Free | Commoditises scenario practice for the mass market | Distribution · all of it |
| **ChatGPT** | Everyone · ask anything | Free tier; memory on by default; GPT-Live-1 voice free (mini) | Flexibility · no curriculum, SRS or progress. Not served in Russia or mainland China | Free / $8 / $20 | Supplier *and* competitor (powers Speak and Praktika) | — · explanations, role-play, voice |
| **Pleco / Hanzii** (RU→ZH direct) | Chinese learners · lookup (+ flashcards / HSK notebooks) | Pleco is the default dictionary; Hanzii has 1M+ learners and RU App Store presence | Pleco: dictionary depth, no licensed Russian dictionary (users hack BKRS in). Hanzii: AI dictionary + HSK 1–9 cards + AI grammar check | Hanzii $49.99/yr, $56.99 lifetime | Hanzii adding AI features, a dictionary-first route toward our space | Dictionary data · AI glosses |

### Capability matrix
Legend: ● strong · ◐ partial · ○ none/weak · ? unverified.

| | AI | SRS | Speak | Listen | Read | Vocab | Grammar | Personal. | Cross-session memory | Content gen | Own content / UGC | Integrations | Switching cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Duolingo | ● | ◐ | ● | ● | ○ | ◐ | ◐ | ◐ | ◐ (Lily's "facts") | ● | ○ | ○ | streak (psychological) |
| Speak | ● | ◐? | ● | ◐ | ○ | ◐ | ◐ | ● | ? | ● | ○ | B2B | low |
| Praktika | ● | ? | ● | ◐ | ◐ | ◐ | ◐ | ● | ● (biographical) | ● | ◐ uploads | ○ | tutor memory |
| Pingo | ● | ○ | ● | ◐ | ○ | ○ | ○ | ◐ | ? | ● | ○ | ○ | none |
| ELSA | ● | ? | ● phoneme | ◐ | ○ | ◐ | ○ | ◐ | ? | ◐ | ◐ sets | B2B | low |
| Memrise | ● | ● | ◐ | ● | ◐ | ● | ◐ | ◐ | ? | ◐ | ○ | ○ | low |
| Language Reactor | ◐ | ◐ | ○ | ● | ● | ◐ | ○ | ○ | ◐ (Aria) | ○ | ● (your Netflix) | ● | low |
| LingQ | ◐ | ◐ | ○ | ● | ● | ● | ○ | ◐ | ● known words (receptive) | ◐ | ● | ◐ | high |
| Anki | ○ | ● | ○ | ◐ | ○ | ● | ○ | ● DIY | ● review history | ○ | ● | ● | very high |
| RemNote | ● | ● | ○ | ○ | ◐ | ◐ | ○ | ◐ | ◐ | ● | ◐ | ◐ | medium |
| Quizlet | ◐ | ◐ new | ○ | ◐ | ○ | ● | ○ | ◐ | ○ | ◐ | ● | ◐ | sets/classes |
| Clozemaster | ◐ | ◐ | ○ | ◐ | ◐ | ● | ○ | ○ | ◐ | ○ | ○ | ○ | low |
| Migaku | ◐ | ● | ○ | ● | ● | ● | ○ | ◐ | ● known words (receptive) | ○ | ● | ● | medium |
| Langua | ● | ● | ● | ◐ | ◐ | ● | ◐ | ● | ◐ | ● | ◐ | ○ | low–medium |
| **Onomika today** | ● | ● FSRS | ◐ | ○ (TTS only) | ◐ | ● | ○ | ◐ | ◐ (prose notes) | ● | ◐ | ◐ Telegram | none |

No column where Onomika shows ● is unique to Onomika.

---

## C. Market Convergence: is "all-in-one" becoming a commodity?

**Yes, feature breadth is commodity. Integration is only valuable when a shared learner state sits under it.**

Evidence the parts are commodity:
- **AI conversation / role-play.**
  - 10+ players offer it, and Google Translate Practice and ChatGPT give it away free.
  - Duolingo's cost per call fell below $0.01, and it moved Video Call from Max down into Super.
  - GPT-Live-1 through the API costs ~$0.05/min, so any solo developer can ship Speak-grade voice.
- **Explanations.** Duolingo made Explain My Answer free (Jan 2026); every LLM app does it.
- **SRS.**
  - FSRS is an open library (TS/Rust/Swift/Go) and ships in Anki and RemNote; Migaku claims compatibility.
  - Quizlet added a scheduler in Aug 2026.
  - MaiMemo, where FSRS originated, supported its open-sourcing.
- **Other parts.**
  - AI card generation from text/PDF/video: RemNote, Quizlet, Anki add-ons.
  - Dual subtitles and click-to-translate: Language Reactor, Trancy (from ~$3.49/mo), Lingopie, Migaku, Lingoku.
  - Streaks: even Google Translate has them.
  - Mass AI course content: Duolingo published 20,500 units in one quarter.
  - Biographical memory ("remembers your goals and mistakes"): Duolingo's Lily, Praktika, LR's Aria, ChatGPT.
- **Convergence from both sides.**
  - Conversation apps are adding review and scaffolding: Speak, ELSA.
  - Course and SRS apps are adding conversation: Memrise, Babbel, Busuu, Duolingo.
  - Immersion tools are adding chatbots: Language Reactor, LingQ, Readlang.

| Dimension | Commodity? | What still matters |
|---|---|---|
| Feature breadth | **Yes.** Onomika itself proves it: one student built 12 surfaces in 3 months | Nothing |
| Product integration | Surface-level integration (one nav bar) is commodity | Integration through a **shared per-learner model** is rare |
| Learning effectiveness | Nobody credibly competes on it; it can't be marketed by a small player | Visible proxies ("words I can use") can be |
| Personalization | Level, interests and biographical memory are commoditising | **Word-level history** of seen, recognised and produced is scarce |
| Distribution | **No, the decisive asset.** Duolingo 140M MAU, Google billions, Pingo virality, Speak/ELSA B2B, Quizlet schools | For us: a niche community + a language pair the giants don't prioritise |
| Retention | Streak mechanics are copyable; scale-tuned retention isn't | Memory measurably helps (Praktika +24% D1) |
| Data / network effects | Duolingo's course data, Quizlet/Anki shared decks | Pair-specific learner-error data (RU→ZH) is unclaimed |
| Switching costs | Low for conversation apps; high for Anki (review history) and LingQ (known words) | RemNote now imports Anki history, so switching costs can be reversed |
| Content | Licensed catalogs and native video are costly | The student's own textbook is free content nobody structures |
| Workflow ownership | LR owns Netflix, Pleco owns lookup, Anki owns review, ChatGPT owns "ask" | For students: the weekly word list and the use-step are unowned |

### The Swiss Army knife idea, brutally (brief §4)
- **Nobody experiences "a stack" as the pain.** They experience one step as painful: making cards, forgetting, freezing when speaking. Consolidation is only felt *after* adopting everything, which is the hardest possible first ask. Your friends were offered the whole knife and used none of it.
- **Each tool in the stack is best-in-class and free or cheap.** Being 70% as good at six jobs loses to six tools at 100% for anyone who has the stack. For anyone who doesn't, 12 blades is intimidating.
- **"All-in-one" can't be said in one sentence.** IDEAS.md parked the landing comparison table because "we sit between flashcards/SRS and AI conversation tutor… revisit after positioning is settled." The two promises on the landing page are the same symptom.
- **Integration is an advantage only when data flows**, so that step N+1 is better *because of* step N. In today's code that happens in one place (Coach pool → FSRS). Mika, Community, Quiz, scene presets, Achievements and the graphs are tools sitting side by side.
- **Why would someone switch from their current stack?**
  - As a Swiss Army knife: "fewer tabs". **That answer is weak.**
  - As the wedge: "it turns this week's words into words you can actually use, in Russian, with proof, in ~7 minutes a day; nothing in your stack does that step." That is specific and testable.

---

## D. Strategic Opportunity: where the whitespace is

1. **A word-level learner ledger that separates *recognises* from *can use*.** Both research sweeps found no product that verifiably does this.
   - Langua comes closest (saved words → conversations, "words you struggled with").
   - Speak's per-concept mastery rises with use in Free Talk (per one review).
   - LingQ and Migaku track recognition only. Pingo's saved words are "never systematically reintroduced".
   - The pain is widely voiced: "remember in Anki but not in real conversations" (Lampariello; Refold's "only mining, never freeflowing").
   - **The window is closing.** This is a feature a funded team could ship in a quarter.
2. **The student's own course as the content source.** Every immersion tool assumes self-directed input and every course app assumes its own curriculum. Students have a free, weekly, externally-paced input (the textbook lesson) that nobody turns into a loop. Praktika's photo/PDF upload is the nearest thing, and it's used for conversation, not a vocabulary ledger.
3. **Russian-speaking learners of Chinese.**
   - Demand is rising: Kommersant reports +11% in two years; vacancies requiring Chinese grew ~1.6× in 2025; 20,000+ Russian students are at Chinese universities (Interfax).
   - Tooling is thin: Pleco has no licensed Russian dictionary (the community hand-converts BKRS); Duolingo takes no Russian cards and stops around HSK 3 (reviewer estimates); OpenAI doesn't serve Russia or mainland China.
   - Direct competition is dictionary-first: Hanzii, trainchinese, ReWord.
   - HSK-prep tools are multiplying but are English-first and either mock-test-centric or flashcard-centric: hsktest.ai (levels 1–9, AI speaking/writing grading), HSK Ace (AI-scored HSKK), HSKMockTest, HSKLord, Hack Chinese (~$18/mo). I found none that works in Russian or tracks which exam words you can *use*.
   - Qwen is strong in Chinese and reachable from China.
   - The exam is growing (719k takers in 2024, +19.6% in H1 2025) and switching to HSK 3.0, with new lists and speaking from level 3.
4. **Not whitespace:** AI conversation, pronunciation scoring, subtitle immersion, AI card generation, community decks, streaks.

### Wedge evaluation (brief §5; qualitative, no scores)

| Wedge | Market / competition | Pain · willingness to pay (WTP) | Frequency · retention | Difficulty · defensibility | Small-team odds · expansion | Verdict |
|---|---|---|---|---|---|---|
| Learn from YouTube/Netflix | Large; crowded: LR (2M), Trancy, Migaku, Lingopie extension (Apr 2026), Lingoku | Real; WTP proven but low ($3.5–10/mo) | High | Extension + streaming DOM; fragile; repo has nothing | Poor: late and platform-dependent | **No** |
| AI reading immersion (LingQ-style) | Medium; LingQ, Readlang, Migaku reader, Du Chinese | Moderate; self-directed users | Medium | Reader exists; little defensibility | Medium; commodity | Supporting (resurface engine) |
| "Learn from anything" → deck | Large and fuzzy; RemNote, Quizlet, Anki add-ons | Real (card-making takes hours) but generic | Bursty | Easy; commoditised | Good entry point, weak alone | Part of wedge (capture) |
| **Active vocabulary: recognise → can use** | Unclear size; Langua, Readlang Ami and Lexirise approaching; nobody owns it | Strong, openly voiced pain; WTP unproven | Daily if the use-step is short | Moderate (grading quality, production state); defensible via accumulated production data | Good: the loop half-exists in code; feeds every modality later; the window is closing | **Core of wedge** |
| AI conversation tutor with memory | Huge; most crowded; free from Google and OpenAI | Strong; WTP proven | Daily | Voice quality; commodity models | Poor for us | **No** (scenes stay as a use venue) |
| **HSK exam readiness** (vocab you can use, per level) | ~750k takers/yr, growing; HSK 3.0 transition. Competitors are English-first mock-test sites and flashcards | Strong, deadline-driven; highest WTP of our options; you have this pain | Daily for months; the 9-level ladder renews the goal | Official lists are public (easy); readiness + production ledger is the hard part | Good: founder = user, codebase fit, RU gap · expands to HSK speaking, then a second exam | **The wedge's frame** |
| AI IELTS speaking examiner (band score) | Very crowded: SmallTalk2Me (2.5M+), IELTSpeaking, Speechful, Socrally, TalkFace, SpeakPrac, ELSA, official free prep apps | Strong; WTP proven | Intense for 1–3 months, then churn | Commodity pipeline (ASR + pronunciation API + LLM rubric); calibration is the hard part; no data to calibrate | Poor now: 10+ incumbents, no edge · possible second exam later on the same engine | **No (not now)** |
| Exam vocab, IELTS side | Large; Memrise Exam Prep, many IELTS vocab apps | Moderate | Exam window | Easy | Commodity | Stage 3 at most |
| **Chinese for Russian speakers** (audience) | Medium, growing; thin tooling | Real (Russian + sense precision) | Daily for students | Qwen strength; repo fit high (senses, pinyin, HSK decks) | Good: you can reach them; expands to RU→EN | **Beachhead audience** |
| Telegram-native coach (channel) | Huge RU/CIS reach; fragile | — | High | Bot exists; Telegram throttled/blocked in RU (Apr 2026), blocked in CN | A channel, not a product | Supporting channel |
| Intermediate plateau generalist | Large; underserved | Real but vague | — | — | Too broad to market | Framing only |
| Tutor companion (B2B2C) | Medium; many RU tutors of Chinese/English | Tutors pay to save prep and see progress | Weekly per student | Needs the ledger first | Strong distribution later | Stage 2 |
| Character writing | Niche; Skritter | Real | Daily | Stroke data; none in repo | Poor | **No** |
| Community decks (Quizlet-like) | Quizlet network effects | Low for our user | — | Needs scale and moderation | Poor | **No** (built: hide) |
| "Language-learning OS" | A vision; nobody searches for it | — | — | — | End state | Stage 3 only |

---

## E. Recommended Wedge

**User.** A Russian-speaking learner of Chinese preparing for a specific HSK level (roughly HSK 3–5), with a deadline.
- **User #1 is you.** Chinese is your biggest headache, and you need HSK for your studies.
- Then your classmates and Russian-speaking students at Chinese universities (20,000+ from Russia alone).
- Then Russian university students and professionals learning Chinese for work.
- IELTS is a possible *second exam* on the same engine later (see "Your follow-up").

**What they use today.**
- Pleco with a hand-converted BKRS for lookup, or BKRS on the web.
- Hanzii or trainchinese (RU UI); HelloChinese/SuperChinese courses.
- Anki with HSK decks.
- The textbook's word lists.
- DeepSeek/Doubao/Qwen chat, or ChatGPT via VPN, for explanations.
- Duolingo only as a beginner habit, if at all.

**Problem: two pains, one workflow.**
1. **Capture.** New words arrive every week (lesson list, teacher, WeChat, signs). Turning them into good cards with a Russian meaning and the *right* sense is slow; Pleco → Anki is manual.
2. **Use.** "I recognise hundreds of words but can't produce them."

**Workflow to own: "Know exactly how ready I am for HSK N, and close the gap with words I can actually use."**
0. **First session: the mark.** Pick a target level → a 5-minute check against the official HSK 3.0 list. The placement flow exists; keep its "known" answers instead of throwing them away. Result: "HSK 4: you recognise ~1,400/2,000, you can use ~380. Gap: 600 words."
1. **Weekly capture.** A photo or paste of this week's textbook list, or taps in the Reader/chat, gives Russian cards with the right sense, pinyin and the source sentence. Each card is tagged with its HSK level.
2. **Daily:** 3–5 minutes of review, then a 2-minute use-step (write or say), on web or in the bot.
3. **Weekly:** the readiness mark moves ("recognise +45, can use +22 this week") and the report names the gap words for next week.

**Why they'd switch.**
- It's in Russian and precise about Chinese senses, where Pleco is English-first and BKRS is a bare dictionary.
- A photo of the list gives a deck in seconds instead of manual entry.
- It makes them *use* the words and shows proof.
- It works where OpenAI doesn't.

**V1 must do** (mostly subtraction and wiring on top of existing code):
- **Official HSK word lists as data, with a level tag on each card.** HSK 2.0 is still used for 2026 exams and HSK 3.0 comes later, so load both and let the learner pick. Also a readiness mark per target level, split into recognise vs can use. This is the first-session payoff your IELTS idea was reaching for.
  - Label it as *vocabulary* readiness. Don't predict an exam score until users report real results to calibrate against.
- **One onboarding path.** Target level → readiness check → gap deck → first review → first use-step in ~5 minutes. Russian as the default native language; infer the pair from the input.
- **Dictionary-grounded Chinese senses.** CC-CEDICT (CC BY-SA) as the backbone; the LLM for Russian glosses and explanations.
- **A learner-model foundation.**
  - Per-review log (word, grade, source: review / drill / scene / chat).
  - Production evidence per word, stored separately from FSRS.
  - Level, native language and goal stored on the server.
  - Keep the placement test's "known" words.
- **The daily loop on web and in the bot.** Review → use → "can use" count. Fix the bot account split first. The bot is a channel, not the foundation.
- **Instrumentation.** Activation funnel, D1/D7/D30, use-step completion.
- **Navigation.** Today · Words · Capture/Reader; everything else under "More".
- **Launch hygiene before strangers arrive.**
  - Prompt-injection hardening, legal pages, domain + email (also fixes China access), DB backups, Sentry.
  - Vercel Hobby forbids commercial use: upgrade before charging.

**Explicitly NOT now:**
- Community/social growth.
- Scene presets or artwork.
- Pronunciation scoring, realtime ASR.
- Pro Plus.
- More quiz modes or card layouts.
- Graphs.
- More chat surfaces.
- Video/YouTube, browser extension.
- Marketing to other language pairs.
- An IELTS speaking grader (a second product in a crowded category; see "Your follow-up").

---

## F. Product Loop

**Competitors' loops:**
- **Duolingo:** streak → *their* lesson → XP/league. Habit is the product.
- **Anki:** due count → review. *Your* card; success = recognition.
- **LingQ / Migaku:** import or watch → save → known-words count. Success = recognition.
- **Speak / Praktika / Pingo:** daily call or lesson in *their* scenario. Success = minutes spoken; Praktika adds biographical memory.
- **Langua:** conversation ↔ saved words. The nearest to ours.

**Your brief's generic loop (content → save → SRS → speak → weakness → practice → meet again) is not stronger as written.**
- Step 1 depends on the learner *bringing* content every week, and most don't.
- "Meet it again in real content" can't be controlled.
- There is no visible score pulling the learner back.

**Proposed loop: "met it → can use it"**

```
 steady input the learner already has         ← students: this week's lesson list, class, WeChat, signs
        │  capture in ≤2 taps (photo / paste / forward to bot / tap in Reader or chat)
        ▼
 card in YOUR language, with the sense you met ← source sentence kept; zh sense dictionary-grounded
        ▼
 RECOGNISE: FSRS review, 3–5 min               ← exists
        ▼
 USE: 2-min production step                     ← write/say 2–3 of today's words; AI grades;
        │                                          production evidence per word (NEW, separate from FSRS)
        ▼
 "can use" status ──► HSK-N readiness mark: recognise X / can use Y of the level list   ← the visible score (NEW)
        ▼
 RESURFACE: a short text or scene built from "know but can't use yet" words at your level
        └──► tap new words in it → capture → …   (AI-made input: the loop never waits for content)
```

**Why this beats the competitors' loops:**
- The unit is *the learner's own word*, and success is *production*. Nobody displays "words I can actually use", and that is exactly what intermediate learners feel they lack.
- The score means something outside the app: it is readiness for a real exam the learner has booked, not XP.
- Students' input is externally paced (a new lesson every week), and generated text covers everyone else, so the loop never stalls.
- Every existing surface becomes a *step*, not a tab: Reader/OCR = capture, Review = recognise, drill/scene/chat = use, AI Reader text = resurface, bot = trigger.

**What kills it:**
- Capture slower than "Pleco lookup + star".
- A use-step that feels like homework.
- Grading the learner doesn't trust.
- A wrong Chinese sense.

All four are quality problems, not missing features.

### Killer workflows (brief §9) and the honest comparison

**W1. Lesson list → can use by Friday (the wedge).**
- **Steps:**
  - Monday: photo of lesson 12's 30 words → Russian cards with the textbook sense in ~30 seconds.
  - Daily: 5-minute review, then a 2-minute use-step ("one sentence about your dorm with 仔细 and 安排", then say it). Errors are logged per word.
  - Friday: "22/30 recognised, 9/30 you can use; the other 13 go into tomorrow's text."
- **Stack today:** Pleco lookups one by one (English); typing Anki cards; ChatGPT via VPN with no memory next week; Duolingo/HelloChinese isn't your textbook.
- **Verdict: materially better.** It saves 20–40 minutes a week of card-making and adds a production step nobody schedules. The next step is chosen from the learner's record, so it's more than tools in one UI.

**W2. Met it in the wild.**
- **Steps:** A WeChat message says 你安排一下 → forward a screenshot to the bot → card with *that* sense and sentence → tomorrow's review → the next use-step.
- **Stack today:** Pleco clipboard reader + star.
- **Verdict: better only if** capture really is ≤2 taps *and* the bot works on the student's network (Telegram needs a VPN in China). A PWA share target is the fallback.

**W3. Read what I almost know.**
- **Steps:** A 250-character HSK 4 text built from 8 "know but can't use" words plus ≤3% new words → tap-save → a use-step on the 8.
- **Stack today:** Du Chinese (fixed library), LingQ (doesn't target gaps), ChatGPT (doesn't know your deck).
- **Verdict: better, and cheap.** The Reader's AI text exists; it needs word targeting.

**W4. Conversation that remembers.**
- **Steps:** A scene whose mission words are your weak production words; corrections are stored per word; the next drill re-tests them.
- **Stack today:** Praktika remembers your goals and mistakes; Langua reuses saved words.
- **Verdict: marginal.** They're better at conversation; we're better only at *which words*. Keep it as a use venue.

**W5. Three minutes in the messenger.**
- **Steps:** Push → 5 cards inline → one voice sentence.
- **Stack today:** Duolingo's push opens its app; Anki has no push.
- **Verdict:** a channel advantage, not a workflow one. Fragile in RU/CN.

**Bottom line:** W1 and W3 are genuinely better, not "existing tools in one UI". W4 and W5 are mostly UI bundling. Build around W1, with W3 as its engine.

---

## G. Feature Priorities

Classes: **A** core to the wedge · **B** supporting · **C** commodity · **D** distracting · **E** future expansion.

| Feature (status) | Class | Verdict |
|---|---|---|
| AI card from word/sentence, source sentence kept, sense pick (shipped) | A | Keep; stop adding knobs |
| FSRS review + offline (shipped) | A (commodity inside) | Freeze |
| Reader tap-save, OCR/photo/PDF import (shipped) | A | Reframe as **capture**; make "photo of this week's list" the headline path |
| Drill graded into SRS (shipped) | A | Becomes the daily **use** step; store production separately |
| Coach memory (shipped) | A | Feed it structured per-word mistakes, not just prose |
| Telegram reminders + /practice + `add` (shipped) | A | Daily trigger + capture inbox; fix the account split first |
| Scenes (shipped) | B | Use venue fed by weak-production words; no new presets |
| AI Reader text at level (shipped) | B | Becomes **resurface** (target not-yet-usable words) |
| Word senses (shipped) | B → A for zh | Ground in CC-CEDICT; LLM explains |
| Word-level pronunciation check (shipped) | B | Keep, no investment |
| Quiz modes, card layouts, achievements, heatmap, family graph (shipped) | C | Freeze; fold Quiz into Review over time |
| Mika widget + /mika + word chat (shipped) | C | One assistant entry that *sees the deck*, or hide it |
| Community, public decks, friend profiles, privacy, reports (shipped) | D | Hide from nav; keep "share a deck by link" |
| 5 Prompt-injection hardening | hygiene | Build before strangers arrive |
| 6 Domain + email | hygiene | Build (also China access) |
| 7 Legal pages | hygiene | Build |
| 8 Next.js bump | hygiene | Build |
| 9 Payments / Pro Plus / flip BETA_ALL_PRO | B | **Delay** until retention; then one Pro tier, no Pro Plus |
| 10 Weekly recap | A | Reshape into the "know → can use" weekly report |
| 11 Realtime WS read-aloud | D | Delete |
| 12 Admin charts + CSV | D | Delete (SQL does it) |
| 13 Fresh example per review / difficulty adaptation | E | Later, inside resurfacing |
| 14 Meaning backfill | D | Delete |
| 15 Collection graph | D | Delete |
| Parked: phoneme scoring | E | Not for English accents (ELSA/Speak territory). Comes back in Stage 2 only as HSK speaking/tones |
| Parked: Traditional Chinese | E | Only if target users ask |
| Parked: custom free-text scenes | D | Delete |
| Parked: Anki export | E | Later, as a trust signal; **Anki import with history** matters more (Stage 2) |
| NEW: analytics / activation funnel | A | **Build first** |
| NEW: per-review log (word, grade, source) | A | **Build first**; can't be backfilled later |
| NEW: production state per word + "can use" count | A | **Build first**; the product's face |
| NEW: server-side level/native/goal; keep placement "known" words | A | Build first |
| NEW: single persona onboarding (target level → readiness check → gap deck → review → use) | A | Build first |
| NEW: official HSK 3.0 lists (levels 1–6) as data, level tag per card, readiness mark (recognise / can use) | A | Build first |
| NEW: CC-CEDICT-grounded zh senses | A | Build first |
| HSK 3.0 speaking section / HSKK practice with pronunciation assessment (Alibaba 口语评测 supports Chinese; already researched in IDEAS B5+) | E | Stage 2; this is where the parked phoneme scoring comes back, for HSK |
| IELTS speaking band grader (your idea) | D now / E later | Not now: crowded, no calibration data. Revisit as a second exam only after HSK retains strangers |

**Net:**
- Of 11 open backlog items: delete 4 (11, 12, 14, 15) plus 2 parked; delay 2 (9, 13); reshape 1 (10); keep the 4 hygiene items.
- About a third of shipped surfaces get hidden, not deleted.

**Looks impressive, adds little:** family graph, collection graph, scene artwork/presets, community, heatmap, realtime read-aloud, phoneme scoring, Pro Plus.

**Could create a moat:** per-word production evidence, per-word mistake history, pair-specific confusion data, owning the capture point.

---

## H. Moat

**We currently do not have a moat.**
- Everything in the repo was built by one person in three months, so any funded team, or a chatbot, can reproduce any single feature in weeks.
- FSRS is open source.
- Cards, explanations, role-play, tap-gloss, OCR and graded AI texts are commodity.
- Biographical AI memory is spreading (Lily, Praktika, Aria, ChatGPT).

**What could become one, and by what mechanism:**
1. **A lexicon ledger with production evidence.**
   - What it holds, per word: where it was met, its recognition schedule, each correct or incorrect production, and the typical error.
   - Why it compounds: each week makes the next recommendation better and leaving costlier. You lose not just cards but the record of what you *can use*.
   - Anki holds recognition history, LingQ/Migaku hold receptive known-words; no product found holds production history.
   - *Mechanism: accumulated per-user state, plus decisions that depend on it.*
2. **Pair-specific confusion and error data (RU→ZH).**
   - Which senses Russian speakers conflate (e.g. включить → 打开/开/启动), and which errors recur.
   - At hundreds or thousands of learners this improves sense picks, grading and drills for this pair.
   - Duolingo has this for its own courses, not for learner-generated RU→ZH vocabulary.
   - *Mechanism: data network effect; worthless below a few hundred active learners.*
3. **Owning the capture point.** Pleco owns lookup; LR owns Netflix. For students the point is the lesson-list photo, the forwarded message and the share sheet. *Mechanism: workflow habit.*
4. **Niche trust and distribution.**
   - Being *the* tool Russian-speaking China students recommend to each other.
   - Later, tutors who assign words through it (B2B2C).
   - Not structural, but the only moat a solo founder can build in year one.
5. **Infrastructure access. Temporary, not a moat.** Qwen works where OpenAI doesn't; roubles via YooKassa where Duolingo can't take them. Useful for 1–2 years; local assistants (Yandex, GigaChat, DeepSeek, Doubao) and politics can erase it.

**Why incumbents are unlikely to do this soon** (reasons of priority, not impossibility):
- **Duolingo** sells a standardised, A/B-tuned curriculum, and user-imported vocabulary cuts against content control. It is chasing 100M DAU with chess, math and music, not intermediate Chinese for Russians.
- **Anki** is volunteer-built, AI-less by design, and just changed stewardship.
- **Pleco** is dictionary-first with no Russian licence.
- **Speak/Praktika** sell *their* scenarios on OpenAI models. Speak's Mandarin now reaches B1 (Jun 2026), but for English speakers.
- **Chatbots** have no per-word state, no scheduler and no push.
- **Watch:**
  - Langua, converging from the speaking side.
  - Hanzii ($49.99/yr, RU App Store presence, AI grammar check), which is one feature away from a production step.

---

## I. Expansion Strategy

**Stage 1: the narrow product people seek out (months 0–6).**
- "HSK readiness you can trust", for Russian speakers: readiness mark → gap deck + textbook capture → recognise → use → the mark moves. Web plus bot.
- They seek it out for Russian + precise Chinese + an honest mark against the new HSK 3.0 lists.
- You are user #1: the product has to get *you* through your next HSK level.
- Gate to Stage 2: the Kill Test thresholds, met by strangers. Then one Pro tier (~499 ₽) with a paid conversion signal among monthly actives.

**Stage 2: the central workflow for that user (months 6–18).** Each step extends an existing data flow:
- **Capture breadth.** PWA share target, a browser extension for web reading/subtitles, textbook lesson packs, Anki .apkg import *with review history into FSRS* (RemNote proves this reverses Anki's lock-in).
- **Resurfacing.** Level texts and scenes built from "know but can't use" words.
- **HSK speaking.** Practice for the HSK 3.0 speaking section and HSKK: tones and pronunciation via Alibaba 口语评测 (already researched, ~¥0.004/call), plus prompts that force *your* gap words. The speaking engine gets built here, for Chinese, where the competition is thin.
- **Tutor mode.** A tutor sees the student's ledger and assigns words and use-tasks. This is the distribution engine.
- **Second exam: IELTS.** Only if HSK retains strangers. Same ledger (academic vocabulary you can use) plus the speaking engine from HSK. The one edge over SmallTalk2Me and co. would be calibration: ask users for their real band afterwards and correct the estimator. That is a data flywheel, and it only works at volume.

**Stage 3: a language-learning operating system (18–36+ months).**
- The ledger becomes the shared state every modality reads and writes:
  - listening (podcasts/video matched to your words);
  - speaking (scenes targeting weak production; pronunciation for your words only);
  - writing (corrections logged per word).
- Pair-specific error models.
- Community decks return once there is scale to moderate them.
- The result is all-in-one, organised around *one learner model* rather than a menu of tools.

**Why each stage leads to the next:**
- Stage 1 produces production data.
- Stage 2 spends that data (deciding what to capture, resurface and assign), and tutors bring users.
- Stage 3 modalities are better *because* they read the ledger.
- Skip the ledger and Stage 3 is the Swiss Army knife you already have.

---

## J. Kill Test: why this product should not exist

1. **Nobody has chosen it.**
   - 319 commits in 3 months, one user; friends were asked and didn't come back.
   - "They're lazy" is the least useful explanation. The likelier ones:
     - they had no live learning goal;
     - the first session demands setup (pair, level, style, placement picks) before any value;
     - the app offers twelve things instead of one.
   - Until a stranger with the problem returns weekly, this outranks every feature.
2. **The free stack is good enough.** Pleco (+BKRS), Anki, DeepSeek/Qwen/ChatGPT chat, Duolingo/HelloChinese, each best-in-class. People who built the stack like control; people who didn't don't want a system.
3. **Every step is free elsewhere.**
   - Google Translate Practice is free, with streaks.
   - ChatGPT's GPT-Live-1 voice is free, with memory on by default.
   - Duolingo gave away Explain My Answer and moved Video Call into Super.
   - We win only on memory and scheduling across *weeks*, which a first session can't show.
4. **Anki's switching cost.** Years of review history; we can't import .apkg today.
5. **AI Chinese senses erode trust.** Three sense bugs in three days, and senses are LLM-only (CC-CEDICT deliberately unused). Intermediate learners compare with Pleco; one wrong sense and they leave.
6. **The Lingualeo precedent.** Russia has had "click a word in real content → personal dictionary → trainings" since ~2009 (Lingualeo, 23M claimed users). It became a gamified course. The loop alone didn't hold users; habit mechanics did.
7. **The gap is being approached.**
   - Langua (saved words → conversations, "words you struggled with"), Readlang Ami (chat mistakes → cards), Lexirise ("missions from your learning").
   - Quizlet added SRS (Aug 2026).
   - Speaking-first money is arriving: Lucida £5.3M (Jun 2026), Eevi (Sep 2026).
   - "Recognise vs can use" may be a feature, not a company.
8. **Conversation wrappers churn.** Pingo (4 people, viral) hit ~$480K/mo, then fell to ~$350K; users complain saved words vanish. Easy to build, hard to retain.
9. **Channel and infrastructure fragility.**
   - Telegram was ~95% blocked in Russia in April 2026 until Telegram disguised its traffic; it is blocked in mainland China.
   - Vercel is unreliable in China, and Vercel Hobby forbids commercial use.
   - Payments: YooKassa needs self-employed status; Telegram requires Stars for digital goods.
10. **Low WTP.** RU/CIS students anchor on 0 (chatbots) and ~499 ₽.
11. **Founder constraint.** Solo, on a graded project. The pattern so far is breadth-first polish, and graduation removes the forcing function.
12. **HSK-specific risks.**
    - **Crowding.** AI HSK mock-test sites are multiplying (hsktest.ai, HSK Ace, HSKMockTest), and any of them could add Russian.
    - **Churn after the target level.** Many learners stop once they reach the level they need (e.g. the one admission requires).
    - **HSK 3.0 timing is unsettled.** 2026 exams are still HSK 2.0, so V1 must carry both lists.
    - **A "readiness" mark is only vocabulary coverage**, not a predicted exam score. Overclaiming it would destroy trust the first time someone fails with "90% ready".
    - **Building for yourself can overfit** to one learner's habits.

**What would have to be true to overcome this:**
- A narrow group (Russian-speaking HSK 3–5 students) feels the capture pain or the "can't use" pain enough to open the app ≥4 days/week without you asking.
- Capture from their real input beats "Pleco lookup + star" on speed.
- Chinese senses are dictionary-grade.
- The "can use" number moves in week one, before the SRS payoff arrives.
- You can personally work a channel: Chinese-learner Telegram/VK communities, Russian student associations at Chinese universities, tutors of Chinese.

---

## K. Final Decision: **WEDGE → SWISS ARMY KNIFE**

**Why.** The Swiss Army knife as a *starting point* has already been tested: it is the current product, and it retained no one. A pure niche would be safe, but it would waste the one structural asset in the architecture, which is that every surface can read and write the same per-learner record. That is the only route to breadth that isn't a feature list. So breadth comes last, and the data has to earn it.

**The wedge.** HSK prep for Russian speakers (HSK 3–5), with you as user #1, then your classmates and Russian-speaking students in China.
- **What they use today:** Pleco with a hacked-in BKRS, Anki, a chatbot, and their textbook.
- **Why they'd switch:** Onomika gives them an honest readiness mark against the official list. It turns the gap words and this week's textbook words into words they can *use*, in Russian, with correct Chinese senses, in about 7 minutes a day.
- **One product, not an HSK app plus an IELTS app.** AI IELTS graders are crowded, and you have no calibration data. IELTS can become the second exam on the same engine only after HSK retains strangers.

**V1 is mostly subtraction and wiring:**
- HSK lists (2.0 and 3.0) with a readiness mark split into recognise and can use;
- one onboarding path;
- dictionary-grounded senses;
- production tracked separately from recognition, with a per-review log;
- a daily review → use step on web and bot;
- a visible "words I can use" count;
- analytics;
- hide social, the extra chat surfaces and the graphs.

**Do not build, and how to expand instead.** No community growth, more scenes, pronunciation scoring, realtime ASR, Pro Plus, graphs, video, extensions, or other language pairs in marketing. Expansion goes capture breadth → resurfacing → exam and tutor modes → RU→EN → other modalities, and each step must read and write the ledger.

**What the decision rests on.** It stands or falls on one six-week test with 30–50 strangers from the wedge. If they don't come back, change the wedge, not the feature list.

---

## Languages: hide the extra ones, delete nothing

**Question:** should Spanish, Korean and the rest be deleted so the platform is only for English and Russian speakers?

**Answer: no — narrow what's *offered*, keep what's *supported*.** These are two different axes, and the app already blurs them (the "which language is which" confusion was fixed three times):
- **Interface language:** Russian and English both first-class; Chinese exists and stays.
- **Learning pair:** Chinese for the wedge. The "I know" side can be Russian *or* English: many
  Russian speakers deliberately study Chinese through English to practise both at once, and
  CC-CEDICT is Chinese→English anyway, so zh→en is well supported. It is a setting, not a
  second audience — recruiting, copy and the readiness framing stay aimed at Russian speakers.

**Why not delete:**
1. **It costs nothing to keep.** The whole multi-language support is two small data files: `LANG_NAMES` in [backend/src/lib/langs.ts](backend/src/lib/langs.ts) (~25 lines) and the `LANGS` array in [frontend/lib/langs.ts](frontend/lib/langs.ts). There's no per-language code to maintain.
2. **Deleting is risky work.** Existing cards carry `sourceLang`/`targetLang`; there's a legacy `zh-Hant` code, user-added custom languages in localStorage, and i18n strings. Removing a language means rows that no longer render.
3. **Your own plan needs English.** RU→EN (IELTS) is the Stage 2 second exam; deleting it now just means re-adding it later.
4. **It's reversible.** Hiding is a one-line constant change; deleting is a migration.

**What the real problem is:** a first screen with 8 flags says "generic vocabulary app" while you're claiming "HSK prep for Russian speakers". That's a positioning problem, fixed in the picker, not the schema.

**Concretely:**
- In [frontend/lib/langs.ts](frontend/lib/langs.ts), keep `LANGS` whole (rendering, flags and labels must still resolve for old data) and narrow only the picker sets:
  - `LEARNING_LANGS` → Chinese (optionally English second).
  - `PICKER_LANGS` → Chinese, English, Russian.
- Hide "add a custom language" while the wedge runs: it's a Swiss-army feature and AI quality there is unverified.
- Leave the backend permissive, so old rows and the bot's `/lang` keep working.
- Keep the legacy `zh-Hant` handling exactly as it is.

**About the trilingual UI rule.** CLAUDE.md requires every new string in en/ru/zh. Chinese UI serves Chinese speakers learning other languages, who are not the wedge, so that rule taxes every feature you build. Suggestion: keep the Chinese UI, but stop treating it as blocking — batch-translate it before releases instead of per-feature. One caveat: this is a graded project at a Chinese university, so if the trilingual UI counts toward your grade, keep the rule until after the defence. Your call.

---

## Brand and domain: park the name decision

You don't like "Onomika" (too long, 4 syllables) — that's a fair objection, and it's the one weakness a tagline can't fix.

**Recommendation: park it, and give it one dedicated session later.** A quick scan of 14 short candidates found 11 already taken (`nomika.com`, `omika.com`, `onoma.com`, `voka.com`, `slovi.com`, `mika.ru`, `tolk.app`, `nado.app`, `shuoka.com`, `hanka.com`, `yonga.com`), 2 inconclusive, and only `zapas.io` free — without the `.com`. Finding a short, meaningful name with a free `.com` is a search, not a lookup, so it deserves its own session rather than a rushed choice.

**Meanwhile, nothing is blocked and nothing is lost:**
- Every `onomika.*` is still free (checked 2026-09-22 against registry RDAP with control domains: `onomika.com`, `.ru`, `.app`, `.dev`, `.io`, `.ai`, `.org`, `.net`, `.me`, `.co`; `.ru` has no RDAP so confirm at a registrar). No company, app or trademark by that name turned up. Nobody is going to take it this month.
- Renaming is cheapest *now*, at zero users, and it gets more expensive after the domain, the bot handle and the first real testers exist. So decide before you buy the domain, not after.
- The naming session should start from criteria, not from a list: 2–3 syllables, readable in Russian and English, free on `.com`, no obscene reading in Russian (this rules out pinyin syllables like *hui*, as in 词汇 *cihui*), and not locked to Chinese so it survives the IELTS stage.

**Two rules that apply to whatever name you pick:**
- **Don't put "HSK" in the brand or app name.** It's CTI's exam name. Competitors use it in domains and page titles (hsktest.ai, hsklord.com); that's the safer pattern — keep it for SEO pages like `<brand>.com/hsk`.
- **Whatever the name, the line beside it does the work:** "Слова HSK, которые ты действительно можешь использовать." The landing page currently makes two different promises; replacing them matters more than the wordmark.

**When you do buy:** the brand `.com` as primary (plus `no-reply@` for magic links, which closes BACKLOG item 6) and the `.ru` for Russian-audience trust (Russian registrars want passport data from individuals). Skip `.ai` and `.io`. Note that a custom domain may help where `*.vercel.app` is blocked, but it does not guarantee mainland-China reachability, and hosting inside mainland China needs an ICP licence.

---

## Appendix: the "Onomika" assessment (if you keep it)

Kept for the naming session, since this is the baseline any new name has to beat.

**Availability, checked 2026-09-22 via registry RDAP + DNS (control domains behaved correctly):**

| Domain | Status |
|---|---|
| onomika.com | **free** (Verisign RDAP 404, NXDOMAIN) |
| onomika.ru | **very likely free** (NXDOMAIN; .ru has no RDAP, so confirm at a registrar) |
| onomika.app · .dev · .io · .ai · .org · .net · .me · .co | **free** |
| No company, app or trademark named "Onomika" found in search | — |

Owning one name across every TLD, including the `.com`, is rare for a 7-letter pronounceable word. That alone is worth more than a marginally better name with a taken `.com`.

**What's good about it:** ownable everywhere; no collisions; neutral, so it still fits when the product grows past HSK (a name like "HSKpro" wouldn't); readable in Russian, English and transliterable for Chinese; the root is Greek *ónoma*, "name", so it is at least word-adjacent; and "Mika", the tutor, sits inside "Onomika", which is a nice accident.

**What's weak about it, honestly:**
- It says nothing to a Russian student preparing for HSK.
- In Russian, "Ономика" rhymes with "экономика" and many will hear that first.
- The stress is ambiguous (оНОмика / ономИка), and so is the spelling in English (onomika / onomica).
- Four syllables, no search value.

**Candidates already checked (so the naming session doesn't repeat them):**

| Candidate | Idea | Status |
|---|---|---|
| zapas (*словарный запас* — the exact Russian term for vocabulary) | Meaningful in Russian, meaningless in English | zapas.com, zapas.ru **taken**; only zapas.io free |
| keyong (可用, "usable") | Insider signal for Chinese learners | keyong.com **taken**; keyong.app free |
| yongfa (用法, "usage") | Same | yongfa.app free; obscure to Russians |
| nomika · omika · onoma · voka · slovi | Shorter, still abstract | all **.com taken** |
| mika · slova · slovo · hanzi · tolk · nado (.app) | Short and descriptive | all **taken** |
| cihui (词汇, "vocabulary") | Perfect meaning | **Rejected:** reads obscenely in Russian; .com taken too |

**Rename cost, for planning:** one session — bot username, Vercel/Railway project names, docs, the landing copy, plus the stale `lexa.*` localStorage prefix and repo name still left over from the previous rename. Cheapest now; more expensive after the domain, the bot handle and real testers exist.

---

## Repo: same repo, same branch, one safety tag

**Same repo.** This plan reuses almost everything: cards, FSRS, Reader, coach, bot, auth, billing groundwork. It's subtraction and rewiring, not a rewrite. A new repo would throw away 319 commits of history — which is also your evidence of work for a graded project — and would mean re-pointing Railway and Vercel for nothing.

**Mostly straight to main**, as CLAUDE.md says. There are no users, so a broken prod costs nothing; branches here are for your own sanity, not user safety.
- Straight to main: backlog rewrite, picker narrowing, analytics, onboarding copy, positioning.
- A short-lived branch (`feat/learner-model`) only for the schema work — per-review log, production state, readiness mark — if it spans more than one session and leaves the app half-wired. Merge as soon as it's green; don't let it live for weeks.

**Before you hide anything, tag today's build:**
```
git tag -a v1.0-full -m "full-featured build before the focus pass" && git push --tags
```
Free insurance, and a fixed point you can demo.

**Hide behind a flag, don't delete.** One constant (or `NEXT_PUBLIC_FOCUS_MODE`) that controls which nav entries and pickers appear. Then:
- testers see the focused product;
- **your university defence can still show the whole thing** — Community, scenes, graphs, the lot — by flipping the flag.
- If your defence is soon, don't delete a single surface before it. Breadth is worth marks even when it's wrong for the market.

**A new repo only for a genuinely different product** — for example, if you ever build the IELTS grader. Not for this.

**If you rename later:** rename the GitHub repo instead of creating a new one. History survives and old remotes redirect.

---

## Feasibility check (2026-09-23, after instant capture shipped)

The question: can one person, on a graded project, actually get from here to "a stranger comes back
weekly"? Short answer: **the software is feasible and mostly proven; the market test is feasible
but slow; the binding constraint is your calendar, not the code.** Details, most certain first.

### Technical: feasible, and the hard part is now measured
- **Capture beats "Pleco lookup + star" on speed for dictionary words.** Measured in the local app:
  0.3–0.8 s from Enter to a reviewable card with pinyin and gloss; the Russian meaning and an
  example land 3–4 s later (the page shows them ~6 s in, on its 3 s poll). The model being down
  no longer blocks an add (`backend/scripts/check-capture.ts`). This was §E's first kill condition.
- **Senses are close to dictionary-grade.** CC-CEDICT grounding: 99/100 right sense vs 90/100
  ungrounded (HSK 4–5, zh→ru) — but marked by Claude; mark it yourself before quoting it.
- **Instant *Russian* is not available legally, so the English-first step is the ceiling.** BKRS
  was checked: its core is the Soviet-era dictionary, digitised by volunteers without the rights
  holders' permission, plus added dictionaries whose licensing can't be verified. Shipping any of
  it inside a product is a risk you can't audit. So the Russian comes from the model, a few seconds
  late. **Risk for the wedge:** a learner who doesn't read English sees an English gloss first.
  Cheapest fix if it bites: run the meaning-only upgrade on the fast model (qwen-flash) and leave
  the example to the slower one.
- **Coverage.** The CEDICT subset is the 11.5k HSK headwords. Names, slang and textbook compounds
  outside HSK take the old path (~5 s, model only). The admin miss counter says whether to widen it;
  the full dictionary is ~4 MB, so widening is cheap if the numbers ask for it.
- **One real defect on the main entry:** the Reader splits Chinese with the browser's segmenter
  ("了三" as one word). The bot already has a CEDICT segmenter. Small fix; it belongs with capture,
  not at the bottom of the list.
- **Cost is a non-issue at beta scale.** ~$0.30–2 per active user per month (UNIT_ECONOMICS); a
  30–50 person, 6-week beta is well under $100 of model spend. Instant capture didn't add calls
  (one upgrade call replaces the old combined call) and removed the spell-check call for dictionary
  words.

### Infrastructure: one risk is underweighted
- **The first recruits are in China, and so is the hosting's weak spot.** §E names Russian students
  at Chinese universities first; §J.9 notes Vercel is unreliable in China and Telegram is blocked
  there. For this wedge that is not a footnote: if the app doesn't load without a VPN on a campus
  network, activation fails before onboarding matters. **Test it before recruiting:** one classmate,
  phone, no VPN, open the site. If it fails, a mainland-reachable front (or at least a China-tested
  CDN) moves ahead of every feature.

### Market: plausible, unproven, and the gate is right
- Zero retained users so far (§J.1). Nothing built since changes that; only use does. The two-week
  self-test (BACKLOG item 5) is the right gate and costs no code.
- The beta thresholds (≥20% week-4 retention, ≥40% Sean Ellis) are ambitious for a first beta of a
  solo project. Missing them is the likely outcome; hitting half of them would still be a real signal.
  Decide now what "half" means so the result can't be argued with afterwards.
- **Interviews don't depend on code** and the Verification table says they come first, yet they sit
  at BACKLOG 15. They can run in parallel with item 5, this week.

### Founder time: the binding constraint
- Calendar, not effort: 2 weeks of self-test + 8–10 interviews + recruiting + a 6-week beta is
  **~10 weeks minimum** before a verdict, and items 12–14 (name, domain, legal) are calendar time too.
- **The defence and the market test want different things.** The defence wants breadth, a working
  demo (the focus flag flips back) and a report that tells the pivot story (item 18). The market test
  wants depth on one loop. Put the defence date into BACKLOG and schedule item 18 against it; at
  position 18 it will be done in a rush.
- **Out of the project horizon** (cut, not delayed): payments (self-employed status or Stars, and
  retention doesn't exist yet), the shared learner-corrected dictionary (needs users), IELTS (needs
  HSK to retain first).

### What is feasible for the code in the next sessions
Items 3 (HSK N words daily), 4 (official lists as decks), the Reader segmenter, and 9 (stop asking
which language) are code-only and can each be built and checked locally. Item 7 (Sentry) can be
wired so it's switched on by setting a DSN. Item 8 needs a group link that only you can create.
Items 1, 5 and 12–16 need you; item 6 waits for item 1 by design.

---

## Verification: how we'll know if this strategy is right
**Step 0: you.** Use it yourself daily for your next HSK level for 2–3 weeks before recruiting anyone. If you skip days, find out why first.

**Then:** a 6-week, instrumented beta with 30–50 people recruited from the wedge (classmates preparing for HSK, Russian-speaking Chinese-learner communities, Russian student groups at Chinese universities), **not** friends without a Chinese exam. The thresholds below are my suggestions, not market facts.

| Signal | Target by week 6 | If missed |
|---|---|---|
| Activation: completes list → cards → review → first use-step in session 1 | ≥50% of sign-ups | Fix onboarding before anything else |
| Week-4 retention of activated users | ≥20% | The wedge is wrong or the pain is weak: re-interview |
| Weekly actives completing ≥3 use-steps/week | ≥30% | The use-step is homework: redesign it |
| Sean Ellis "very disappointed without it" among weekly actives | ≥40% | No must-have yet |
| Before the beta: 8–10 interviews with target users on how they handle new words now | Done first | — |

## If you accept this (one BACKLOG item per session, per CLAUDE.md)
1. Rewrite BACKLOG.md to match §G. Add the new A-items, delete/delay the D-items, and put the one-line positioning statement (see Brand) into CLAUDE.md/IDEAS.md and on the landing page, replacing the two competing promises.
1a. Narrow the language pickers (`LEARNING_LANGS` / `PICKER_LANGS`) to Chinese-first, keep everything else supported, and hide "add a custom language". One small change, reversible.
1b. Naming session (separate, whenever you want): decide the name from the criteria above, then register the `.com` + `.ru` and wire `no-reply@` — that closes BACKLOG item 6. Do it before buying a domain, not after.
2. Analytics + per-review log + server-side learner prefs (the foundation; can't be backfilled).
3. HSK 2.0 + 3.0 word lists as data, a level tag per card, and the readiness mark (recognise / can use).
4. Production state per word + "can use" count + reshaped weekly report.
5. Single persona onboarding (target level → readiness check → gap deck → review → use-step), plus textbook-list capture.
6. CC-CEDICT-grounded Chinese senses.
7. Launch hygiene (items 5–8, backups, Sentry, fix the bot account split), then step 0 (you), then recruit the 30–50.

---

## Sources (primary where possible; "secondary" = third-party)
- **Duolingo:**
  - [Q2 2026 letter (SEC)](https://www.sec.gov/Archives/edgar/data/1562088/000162828026053299/q2fy26duolingo6-30x26share.htm)
  - [Q1 2026 letter](https://www.sec.gov/Archives/edgar/data/1562088/000162828026029790/q1fy26duolingo3-31x26share.htm)
  - [Q4 2024 letter (Max 5%)](https://www.sec.gov/Archives/edgar/data/1562088/000156208825000039/q4fy24duolingo12-31x24shar.htm)
  - [Explain My Answer free](https://blog.duolingo.com/explain-my-answer-now-free)
  - [Video Call memory](https://blog.duolingo.com/ai-and-video-call/)
  - [Fortune on Translate threat](https://fortune.com/2025/08/27/duolingo-existential-crisis-ai-google-translate-language-learning-live-translation)
  - [Chinese course ~HSK3 (GoEast)](https://goeastmandarin.com/can-you-learn-chinese-from-duolingo/)
  - [Russian card payments (vc.ru)](https://vc.ru/services/3012698-sposoby-oplaty-podpiski-duolingo-iz-rossii)
- **Speak:**
  - [Series C](https://www.speak.com/blog/series-c)
  - [Forbes $100M ARR](https://www.forbes.com/sites/rashishrivastava/2025/11/12/this-startup-is-racing-duolingo-to-replace-human-language-tutors-with-ai/)
  - [Chinese on Speak](https://www.speak.com/blog/chinese-now-available-on-speak)
  - [GPT-Live-1 tutor](https://www.speak.com/blog/live-tutor-lessons-powered-by-openais-gpt-live-1)
- **Praktika:**
  - [OpenAI customer story](https://openai.com/index/praktika/) (via snippet)
  - [TechCrunch Series A](https://techcrunch.com/2024/05/22/praktika-raises-35-5m-to-use-ai-avatars-to-make-learning-languages-feel-more-natural)
- **Pingo:** [36Kr](https://eu.36kr.com/en/p/3954984408120451) · [LanguaTalk review (competitor-owned)](https://languatalk.com/blog/pingo-ai-review/)
- **ELSA:** [redesign](https://blog.elsaspeak.com/en/discover-the-new-elsa-speak-experience/)
- **Memrise:** [walkthrough](https://www.memrise.com/blog/team-update-full-walkthrough)
- **Babbel:** [Babbel Speak](https://www.babbel.com/press/en-us/releases/babbel-speak)
- **Busuu:** [Busuu Conversations](https://www.busuu.com/en/languages/language-learning-with-busuu-conversations)
- **Google:**
  - [Translate Practice launch](https://blog.google/products-and-platforms/products/translate/language-learning-live-translate/)
  - [Practice help](https://support.google.com/translate/answer/16475590?hl=en)
  - [9to5Google Dec update](https://9to5google.com/2025/12/12/google-translate-gemini-headphones/)
- **OpenAI:**
  - [Study mode (CNBC)](https://www.cnbc.com/2025/07/29/openai-announces-new-study-mode-product-for-students-.html)
  - [GPT-Live-1 (TechCrunch)](https://techcrunch.com/2026/07/08/openai-releases-new-voice-models-for-more-natural-live-conversations/)
  - [Supported countries](https://help.openai.com/en/articles/7947663-chatgpt-supported-countries)
- **Language Reactor:**
  - [Chrome Web Store](https://chromewebstore.google.com/detail/language-reactor/hoombieeljmmljlkjmnheibnpciblicm)
  - [outage thread](https://forum.languagelearningwithnetflix.com/t/language-reactor-stuck-on-loading-subtitles-on-netflix/41812)
  - [pricing (secondary, Linglass)](https://linglass.app/blog/linglass-vs-language-reactor)
- **LingQ:**
  - [pricing](https://www.lingq.com/en/signup/)
  - [SRS](https://lingq-support.groovehq.com/help/how-does-the-lingq-srs-review-work)
  - [Aug 2026 update](https://forum.lingq.com/t/new-navigation-panel-ai-lesson-reformatting-content-archiving-and-lynx-improvements-update-log-august-2026/2622308)
- **Anki:**
  - ["Anki's Growing Up"](https://forums.ankiweb.net/t/ankis-growing-up/68610)
  - [FSRS default issue](https://github.com/ankitects/anki/issues/3616)
  - [AnkiMobile](https://apps.apple.com/us/app/ankimobile-flashcards/id373493387)
- **FSRS:** [open-spaced-repetition](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler) · [awesome-fsrs](https://github.com/open-spaced-repetition/awesome-fsrs)
- **RemNote:** [pricing](https://www.remnote.com/pricing) · [language flashcards / Anki import](https://www.remnote.com/subject/language-flashcards) · [1.27 changelog](https://feedback.remnote.com/changelog/remnote-1-27)
- **Quizlet:** [Feb 2026 PR](https://www.prnewswire.com/news-releases/quizlet-supercharges-studying-with-new-product-innovations-and-strategic-acquisition-302679622.html) · [Aug 2026 PR (SRS)](https://www.prnewswire.com/news-releases/quizlet-launches-new-study-tools-built-for-the-way-students-learn-302841833.html)
- **Migaku:** [changelog](https://migaku.com/blog/changelog) · [Japademy review](https://www.japademy.com/japanese-course-reviews/migaku)
- **Readlang:** [pricing](https://readlang.com/pricing) · [Ami chatbot](https://forum.readlang.com/t/new-conversational-chatbot-for-language-learning/2744?page=2)
- **Langua:** [try-langua](https://languatalk.com/try-langua)
- **Trancy:** [pricing](https://www.trancy.org/pricing)
- **Lingopie:** [extension](https://lingopie.com/blog/lingopie-new-chrome-extension/)
- **Lexirise:** [pricing](https://lexirise.app/pricing)
- **Funding:** [Lucida seed](https://slator.com/ai-language-learning-startup-lucida-5m-seed-round/) · [Eevi](https://tech.eu/2026/09/22/eevi-raises-pre-seed-funding-to-get-language-learners-speaking-from-day-one)
- **DIY-stack pains:** [Refold on sentence mining](https://refold.la/roadmap/library/sentence-mining) · [Lampariello on flashcards](https://www.lucalampariello.com/vocabulary-flashcards/) · [HN thread](https://news.ycombinator.com/item?id=44020591)
- **RU→ZH market:**
  - [Kommersant +11%](https://www.kommersant.ru/doc/8291809)
  - [Interfax: 20,000+ Russian students in China](https://interfax.com/newsroom/top-stories/117706/)
  - [Pleco forum: no Russian licence](https://www.plecoforums.com/threads/russian-dictionary.4174/)
  - [BKRStoPleco](https://github.com/amurgit/BKRStoPleco)
  - [Hanzii App Store](https://apps.apple.com/us/app/hanzii-learn-chinese-hsk/id1468400944)
  - [Hanzii RU listing](https://apps.apple.com/ru/app/hanzii-%D1%83%D1%87%D0%B8%D1%82%D1%8C-%D0%BA%D0%B8%D1%82%D0%B0%D0%B9%D1%81%D0%BA%D0%B8%D0%B9-%D0%B8-hsk/id1468400944)
  - [Hack Chinese pricing (Capterra)](https://www.capterra.com/p/231719/Hack-Chinese/)
  - [HelloChinese vs SuperChinese](https://languavibe.com/hellochinese-vs-superchinese/)
- **HSK exam and HSK prep tools:**
  - [China Daily: HSK 3.0 and 719k takers](https://global.chinadaily.com.cn/a/202511/12/WS6913cfcda310fc20369a486b.html)
  - [HSK 3.0 status: pilot, lists, 2026 exams still HSK 2.0 (StudyCLI)](https://studycli.org/hsk/the-new-hsk/)
  - [hsktest.ai](https://hsktest.ai/)
  - [HSK Ace (HSKK AI-scored)](https://hskace.com/hskk-beginner-mock-test)
  - [HSKMockTest](https://hskmocktest.com/)
  - [HSKLord guide](https://hsklord.com/blog/new-hsk-3-0-complete-guide)
- **AI IELTS speaking graders:**
  - [SmallTalk2Me IELTS](https://smalltalk2.me/ielts)
  - [IELTSpeaking](https://ieltspeaking.com/)
  - [IELTSpeaking on AI score accuracy](https://ieltspeaking.com/guides/ai-ielts-speaking-score-accuracy.html)
  - [Speechful grader](https://speechful.ai/ielts-speaking-ai-grader)
  - [Socrally](https://socrally.ai/ielts-speaking-checker)
  - [TalkFace AI](https://apps.apple.com/us/app/ielts-prep-app-talkface-ai/id6446065891)
  - [SpeakPrac](https://speakprac.com/ielts-speaking-app/)
  - [IELTS Speaking Practice AI (Google Play)](https://play.google.com/store/apps/details?id=com.edukeyt.ieltsspeakingai&hl=en)
- **Lingualeo:** [HSE "Jungle"](https://www.hse.ru/news/life/68105740.html) · [App Store](https://apps.apple.com/ru/app/lingualeo-%D1%83%D1%87%D0%B8-%D0%B0%D0%BD%D0%B3%D0%BB%D0%B8%D0%B9%D1%81%D0%BA%D0%B8%D0%B9-%D1%8F%D0%B7%D1%8B%D0%BA/id480952151)
- **Channels and payments:**
  - [Telegram Stars rules](https://core.telegram.org/bots/payments-stars)
  - [Telegram blocking in Russia (Moscow Times)](https://www.themoscowtimes.com/2026/02/10/roskomnadzor-tightens-restrictions-on-telegram-as-users-report-disruptions-a91907)
  - [Carnegie on Telegram](https://carnegieendowment.org/russia-eurasia/politika/2026/03/russia-internet-telegram-restrictions)
