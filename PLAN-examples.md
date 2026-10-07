# Plan: examples at the learner's level, one HSK scale, cheaper enrichment

Written 2026-10-06 from the author's screenshots of the Today drip (16 HSK 4 words + 3 topic words added at once).
Nothing here is implemented yet. Do the parts **in order, one per session**; tick each part here and in
`BACKLOG.md` when it is done. Other sessions commit in this tree: stage your own files by name.

## The author's decisions (don't re-litigate)

- **Examples are written at the level the learner chose, not a measured "reading level".** They set B2 = HSK 4
  and want to train HSK 4, yet every example says "слова вокруг: HSK 1–2". The word itself may be HSK 1; the
  sentence around it is at their level.
- **No "at most one unknown word" rule** (`MAX_UNKNOWN`, i+1 by expected-unknown count) for choosing or keeping
  examples: even a week in, the app doesn't know which words a learner knows.
- **No separate rewrite pass to push a sentence down** (`holdToLevel`). The level goes into the personal-sentence
  call we already make (`enrichWordEntry` from `upgradeCard`). The naturalness judge (`keepIfNatural`) stays.
- **For Chinese, levels are HSK 1–6 (+7–9), never A1–C2**, everywhere the learner sees or sets one.
- The personal example stays at add time (it is the "personalization sentence we already do").

## Why it is HSK 1–2 today (verified 2026-10-06, no code changed)

1. **The personal sentence** ("Onomika AI · Бытовой", e.g. 他每天都上网，却只看不说话): `exampleBrief` →
   `learnerReading` (`backend/src/services/sentences.ts:221`) sets `level` = highest n such that levels 1..n are
   each known at ≥ `SURE` = 0.9 (studyPlan `levelRates` over ~12 check taps per level, after false-alarm
   correction). The author's comes out 2, so the prompt says "Besides X, use only words of HSK 2 and below"
   (`agents/enrich.ts:119-121`). The same call also gets `level: "B2"` → "The learner's CEFR level is B2"
   (`enrich.ts:76`): two contradicting instructions. Label = `writtenLabel` → `levelLabel(2)` = "HSK 1–2".
2. **The pool sentence** (天很热，他却穿大衣): each HSK word has up to 3 pool sentences, ceilings c1 (HSK 1–2 words
   only), c2 (up to the word's level), c3 (natural). `pickPoolSentence` takes the fewest expected unknowns, so c1
   nearly always wins. 却 has only c1 sentences (91 pool words are c1-only; 1,253 have no c3).
3. A throwaway probe (real code, synthetic HSK 4 learner on the 2.0 list): HSK 3 at 10/12 → label **HSK 1** (unasked
   HSK 1–2 inherit HSK 3's rate); 11/12 → HSK 1–3, but one extra claimed fake word → HSK 1; even 12/12 → 10 of 17
   words still get the c1 sentence. A learner's reviewed cards never count toward the level share.

## Part 1 — examples follow the chosen level (backend) — [x] done 2026-10-07

**As built** (differences from the text below): a word's level in a sentence is read on the learner's own list
(`hskVersion`), falling back to its lowest on the other, not `minLevel`. On the 2.0 list 重视 and 味道 are HSK 4,
so 教育's and 却's "HSK 1–2" sentences read HSK 1–4 there. The pool label is now the sentence's level on that list
(a c3 sentence is labelled too), and on open a card's pool sentence is relabelled if its label has changed. The
learner's own sentence is also written when the pool's best is *above* L (`pooledAt > L`: 进行's are all HSK 5).
Per `scripts/check-sentences.ts` and a local run (HSK 4, 2.0 list, Today's 20 words): 却 and 记者 come with an HSK 1–4
pool sentence; 通过 (pool tops at HSK 2), 成为, 其中 and 进行 also get their own at HSK 1–4, written first.
The prompt line names the list and says "nothing harder". Measured on 12 words, the sentence read ≤ HSK 4 on 2.0 in
9/12 cases (the first wording managed 4/12). With "Tech & IT" interests it was 6/12 (first wording 2/12), because
the theme pulls in 软件, 内存, 续航. Part 3's example-only prompt is the place to tighten it further.

**The level.** New helper, e.g. `exampleLevel(userId): number | null` (HSK, 1–7) in `services/sentences.ts`:
`user.hskTarget` → else `User.levels.zh` mapped A1→1, A2→2, B1→3, B2→4, C1→5, C2→6 → else null (no level line).
Onboarding writes `levels.zh` from the target anyway (`frontend/components/HskFirstRun.tsx:326`, `CEFR_FOR_HSK`),
so for the author both say 4. Part 2 makes the Chinese level picker write `hskTarget`, so there is one value.

**Pool pick, without "knows".** Give each pool sentence a level: the highest list level among its words besides
the headword (`minLevel` over its stored tokens `s.t`). **Don't count an off-list token as HSK 7**: in 5,259 of the
11,712 natural sentences the off-list tokens are mostly numbers and one-character pieces of split compounds (一 882,
款 154, 实 106, 警 98…), not hard words; skip numbers and single-character off-list pieces, and count a
multi-character off-list word as one level above the list's highest word in the sentence (a name or a rare compound).
Probe it on real pool rows before trusting it. Pick the sentence with
the **highest level ≤ L**; tie → higher ceiling (more natural); none ≤ L → the lowest-level one. Replace
`pickPoolSentence`/`better`/`scored` with this. Users of the old pick:
- `placePoolExamples` (`sentences.ts:295`): always place the pick (drop the `MAX_UNKNOWN` skip).
- `refreshPoolExample` (`sentences.ts:320`): on open, swap the pool sentence when the new pick differs (this is
  what moves the author's existing cards off their HSK 1–2 pool sentences). Keep the retired-sentence and
  corrected-translation branches as they are.
- `upgradeCard` (`services/capture.ts:289-298`): place the pick when none is pooled; no unknown gate.
- `services/vocab.ts:124` and `:432` use `placePoolExamples` / `exampleBrief`: adapt.

**The personal sentence** (`upgradeCard`, `capture.ts:299-390`; and "Add example" in `agents/exampleSearch.ts:244, :290`):
- `exampleBrief` returns `{ level, knownWords, themes }` instead of `reading`.
  `personal = withExample && (!hasPool || themes || poolLevel < L - 1)`: the pool can't serve every level with
  three fixed sentences (below), so a learner with no interests set still gets one at their level when the pool's
  best is too easy. This is what covers 却 (only HSK 1–2 sentences) without a bulk pool run.
- `enrichWordEntry` gets `hskLevel: L`. Reword the line at `enrich.ts:119-121` so it aims *at* the level, not
  under it: "Write it for an HSK L learner: besides X, words up to HSK L, and use level-L vocabulary where it is
  natural; don't simplify to HSK 1–2." For Chinese, drop the CEFR `levelLine` (`enrich.ts:76`) so there is one
  instruction. Soften `knownWords` from "build mostly from" to "may reuse" (the HSK line is the rule).
- Remove the `holdToLevel` call and the two `MAX_UNKNOWN` branches (`capture.ts:370-374`): a natural personal
  sentence is kept. Keep `keepIfNatural` and the "word must be a word of its own" check.
- Label: `levelLabel(L)` ("HSK 1–4").
- Then delete what is dead: `learnerReading`, `SURE`, `unknownIn`, `MAX_UNKNOWN`, `holdToLevel`, `half`, etc.
  (grep `src/` and `scripts/` first). Don't touch `studyPlan.levelRates`: the readiness plan uses it.

**Check.** `backend/scripts/check-sentences.ts` asserts the old i+1 rules: rewrite those sections. New asserts:
a user with `hskTarget: 4` on 2.0, words 却 通过 教育 各 记者 + one HSK 1 word added through `importWordsForUser`:
each pool pick's level is the highest ≤ 4 the pool has (通过/记者 get c2 or c3, not c1); the label is not "HSK 1–2"
where a higher one existed; an HSK 1 word gets a sentence above HSK 2 when its pool has one. Then a local Docker run:
Today → Add → open 却 and 通过 → read the labels and sentences (never prod).

## Part 2 — one HSK scale in the UI (frontend + prompts) — [x] done 2026-10-07

**As built.** The badge (`HskBadge`) reads `profile.hskVersion` itself, so every user of it follows (CoachPicks
already passed a tag on the learner's list). The topic row reads "{topic} · beyond HSK 4" / "сверх HSK 4" /
"超出 HSK 4". One helper in `lib/learnPrefs.ts` serves every level picker: `levelOptions` (Chinese HSK 1–6, 7–9
only on 3.0; A1–C2 otherwise), `getLearnerLevel` / `setLearnerLevel` / `useLearnerLevel` (Chinese = the HSK target;
saving writes `hskTarget` and `levels.zh = CEFR_FOR_HSK[n]`), `levelName`. `lib/account.tsx` mirrors the target
locally and, when a picker changes it, patches the profile and refetches Today, the plan and the readiness mark.
Pickers: the add form and its first-time prompt, `useEnsureLevel`, AddExampleInline, ImportWordsDialog,
PracticeBar, the account's Levels, FirstRun, the Reader's save and "AI text" pickers ("Level · HSK" 1–6). The
CEFR synonym-level picker is hidden for Chinese and not sent. Every request level for Chinese is the HSK number
(Today, onboarding and the HSK list page too); `savePlacement` keeps CEFR (its schema). Backend `lib/level.ts`
reads either scale, so prompts say HSK for Chinese: `enrich`, `exampleSearch`, `coachSuggest`, `starterCandidates`,
`tutorChat`, the coach `levelGuide` (the CEFR band's rule, named "HSK 4"), the Reader's generate and estimate
(stored "HSK 4"); a request level stored as an example label reads "HSK 1–4"; the bot reads `hskTarget`.
Checked: `next build`; a local run at 390 px: My words shows 教育 HSK 4 (2.0, as Today), the tooltip both lists; the
add form offers A1–C2 for English and HSK 1–6 for Chinese with HSK 4 ticked; picking HSK 5 saved target 5 (C1),
back to 4; the Reader's level buttons are 49 px with no sideways scroll.

- **Badge**: `frontend/components/HskBadge.tsx:13` always prefers 3.0; Today uses the account's version (author:
  2.0, so 教育 = HSK 4 on Today and HSK 2 in My words). Show the level on `profile.hskVersion` (as
  `app/reader/page.tsx:365` does), fall back to the other list only if the word isn't on it; the tooltip already
  lists both. Users: `app/words/page.tsx:372`, `app/word/[id]/page.tsx`, `AddWordForm`, `CoachPicks`.
- **Topic row label**: `topic.label` ("{topic} · вне списка HSK", `lib/i18n.tsx:1691`) is wrong for 开发 (HSK 2.0
  level 5): the filter (`backend/src/services/topic.ts:75`) drops words *at or below the target*. Rename to
  "{topic} · beyond HSK {level}" / "сверх HSK {level}" / "HSK {level} 以上" (true for off-list words too).
- **Level pickers for Chinese**: `CEFR_LEVELS` options at `components/AddWordForm.tsx:411`,
  `components/AddExampleInline.tsx:189`, `lib/useEnsureLevel.tsx:27`, `components/ReaderTextTools.tsx:125, :264`,
  `components/GlobalTutor.tsx:246`. For `zh`: HSK 1–6 and 7–9; saving writes `hskTarget` via
  `api.updateLearnerPrefs` (and `levels.zh = CEFR_FOR_HSK[n]` for old paths; note `CEFR_FOR_HSK` maps 5 and 6 both
  to C1). Requests that pass `level` for Chinese pass the HSK number. Every new string in en/ru/zh.
- **Prompts**: for Chinese say HSK, not CEFR: `agents/enrich.ts:76`, `agents/exampleSearch.ts:121`. The Reader's
  `services/levelGuide.ts:33` and `services/readerText.ts:113` are a follow-up if the session runs short.
- **Check**: `next build`, then a local run at 390 px: My words badge = Today's level for 教育; the add form's level
  picker shows HSK for Chinese and A1–C2 for English.

## Part 3 — cheaper, faster enrichment for HSK words — [x] done 2026-10-07

**As built.** `pageCardFields` (capture.ts) puts the page's part of speech, synonyms, antonyms and the lead sense's
first three phrases (as collocations: the Reader's word panel and a custom card layout show them) on the card at
creation, in the batch add and the single add (not for a card made in a picked sense). In `upgradeCard` a card with
a page, the default meaning and no sentence or typed sense pointing at another sense is *settled*: one
`enrich(example only)` call (`enrichWordEntry({ exampleOnly })`, the Part 1 level line, the card's meaning named),
then the judge — and no call at all when the pool's sentence serves. Off-list words keep the full call. The worker
runs 3 cards at a time. `scripts/check-enrich-fast.ts` drives it against a fake OpenAI server and counts calls by
label; `check-capture.ts` now fails an upgrade on the German card (认真 on its Russian default needs no call).
Measured: the example-only call is ~460 tokens in / 36–70 out, 1.2–1.9 s, against ~1,010 / 115–141, 3–3.6 s.
Local Today → Add, HSK 4 on 2.0: 5 words were cards in 0.2 s and the job was done in 1.8 s with **no model call**
(each pool sentence served HSK 4); 3 topic words took 6.3 s together (full entry + judge each).
**Level, still open:** on 12 words (使用 其中 发展 发生 各 市场 经济 记者 通过 成为 教育 方面) the example-only sentence read
≤ HSK 4 on 2.0 in 5/12 with no interests, 4/12 with travel/film, 2/12 with IT; the full entry on the same words
3/12. Two tighter wordings (list each word's level first; an explicit word budget) gave 5/12 & 5/12 and 4/12 & 5/12,
the first less natural, so Part 1's wording stays. The model doesn't know the 2.0 levels (采访, 蔬菜, 员工 are HSK 5):
that is the case for Part 4's checked sentences per level band.

Today per card (`services/importWorker.ts:97`, sequential): `upgradeCard` → `enrichWordEntry` (meaning, POS,
collocations, synonyms, antonyms, example), then after Part 1 `keepIfNatural` (1–2 `qwen3.5-plus` calls). For a
word with an HSK page most of that is discarded: the default meaning stays (`capture.ts:330`), POS/syn/ant come from
the page (`capture.ts:395-403`). 19 cards took a few minutes.
1. At creation (`services/importWords.ts:139-165`), a Chinese word with `hskPage(word, targetLang)` gets
   `partOfSpeech`, `synonyms`, `antonyms` from the page at once; collocations from the page's phrases only if the
   card view shows `collocations` (grep the word page first).
2. In `upgradeCard`, a card with a page and a default meaning skips the full entry: an example-only call (a flag on
   `enrichWordEntry` or a small new prompt) with the Part 1 level line, then `keepIfNatural`. Off-list words (topic
   words) keep the full call.
3. `importWorker` processes 3 cards at a time (`Promise.all` per chunk), checks cancel per chunk, persists
   `processed` after each chunk. A restart redoes at most one chunk; safe, since `upgradeCard` only adds an example
   to a card without one of its own and meanings are compare-and-set.
4. **Check**: a `scripts/check-*.ts` that adds 5 HSK words and asserts POS/synonyms are set before the job runs and
   that the job makes one model call per card + the judge (count by `label`). Then Today → Add locally and time it.

## Part 4 — pool gaps (costs ¥, ask first; optional once Part 1 writes the personal sentence at L) — [x] done 2026-10-07

**As built so far.** Why words lack c3: 1,290 of the 1,291 lost theirs in the naturalness pass (dropped, no
replacement). The gap that matters: 1,919 of the 3,317 words at HSK ≤ 4 have no pool sentence reading HSK 3–4 on
both lists (4,592 of 7,419 lack one at 5–6). The author chose the 3–4 band, written by Claude Sonnet agents: on the
same 50 words through `scripts/build-band-sentences.ts`'s check (every other word HSK ≤ 4 on both lists, the sentence
HSK ≥ 3 on each, one write + two fixes) Sonnet passed 50/50, Qwen 16/50 (its fixes went simpler: 夏天我们吃西瓜). The
band sentences live in `data/hsk-band-sentences.jsonl` (`c: 4`), added to the pool at load; the pick reads their
level like any other. Done: the pilot's 50 and batches 01–19 = **1,000 words** (9 stragglers rewritten by hand, all
pass), ~1.32M Sonnet tokens (~65k a batch). `check-sentences` and `check-enrich-fast` guard it: an HSK 4 learner's
却 通过 教育 各 记者 朋友 are all served at HSK 3–4 by the pool now, no model call; on the local server, opening 通过 moved
it from 我通过考试了 (HSK 1–2) to 我们通过电子邮件联系，所以很方便 (HSK 1–4). Batches 20–38 (919 words) in a second
session: 887/919 by the agents, the 32 stragglers and 2 wrong-sense lines found in a 70-line read (定 for 订 "book",
"I plan to graduate") rewritten by hand. **All 1,919 done**; `check-sentences` now asserts each is served at HSK 3–4 to
an HSK 4 learner on both lists. The 5–6 band is not planned. Then a native editor's read of all 1,919
(`build-band-sentences.ts --judge`, qwen3.5-plus, 20 a call, ¥0.12): 99 flagged, about half wrong (一根香蕉, 戴帽子,
他半天没应 are fine); the rest rewritten by hand and checked — 37 sentences (法/国/妹/力 bare where Chinese wants
法律/国家/妹妹/力气, 处于 for a place, a fire reported to the police, 药物…使用, 一边…同时, 读书 for magazines) and 11
Russian translations (едя, пару новой обуви) — and the 48 read again: 0 flagged.

The real gap is not "no natural sentence" but "no sentence at HSK 3–4": the natural (c3) ones are mostly news-style
and hard (教育: 家庭教育对儿童性格形成具有深远影响; 方面: 这项政策在经济和社会两个方面都产生了深远影响), the c1 ones
HSK 1–2. A rough simulation of the Part 1 pick for an HSK 4 learner over all 11,434 pool words (off-list tokens
over-counted, so treat as an upper bound on the gap): ~5,070 get an HSK 3–4 sentence, ~3,980 only HSK 1–2, ~2,390
have nothing ≤ HSK 4. Of the author's 17 drip words, 9 move up (使用 其中 发展 发生 各 市场 经济 记者 通过) and 8
stay HSK 1–2 (内 分之 却 成为 教育 方面 由于 旅行). If the personal sentence isn't enough, the fix is a sentence per
level band (HSK 3–4, 5–6) rather than more c3.

91 pool words have only c1 sentences (却), 1,253 have no natural c3 (by word level: 49 HSK 1, 49 HSK 2, 80 HSK 3,
88 HSK 4, 140 HSK 5, 345 HSK 6, 491 HSK 7–9). What matters for "a sentence at your level", first: the c1-only
words, and HSK 1–3 words with no c3 (their c2 caps at HSK 2–3, so an HSK 4 learner has nothing at their level).
For an HSK 4+ word a missing c3 matters less: its c2 already reaches the word's own level. Not yet checked why
those words lack c3 (dropped by the editor pass, or never written). `scripts/build-hsk-sentences.ts` writes and
judges them. Per the Bailian-budget rule, give the author the ¥ estimate before running (the 1,815-sentence judge
pass cost ¥0.26 with qwen-plus).

## Not in scope

- Re-writing personal sentences already on prod cards (they keep their "HSK 1–2" label; "Add example" writes a
  new one). Pool sentences move on open via `refreshPoolExample` after Part 1.
- The readiness mark and study plan math.
