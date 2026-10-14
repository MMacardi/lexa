# Plan: new words that learn well together, straight from the dictionary

Written 2026-10-10 from the author's request. It is BACKLOG item 1e (the top open item), which it extends:
1e's first session made the next word frequent and cheap to learn; this adds **what goes into one day** and
**learning a new word without adding it first**. Nothing here is implemented yet. Do the parts **in order,
one per session**; tick each part here and in `BACKLOG.md` when it is done. Other sessions commit in this
tree: stage your own files by name.

## The author's decisions (don't re-litigate)

- **A day's new words are one group that is easier to learn together**, not the top N of a ranked list:
  one situation (transport one day), one character's family (the 坐 words), or words that meet in the
  same sentences. The same choice everywhere new words appear: Today's words, Flashcards, Writing.
- **A new word can be learned without adding it first.** Flashcards and Writing can hand out new words
  from the dictionary (the HSK list) when the learner wants more ("make the whole day for Chinese").
- **A dictionary word comes as a ready-made card**: meaning, pinyin, page and a ready example sentence.
  **No personalised sentence** at that point (no AI call); it can be asked for later on the card.
- **Top priority** (2026-10-10): this goes before everything else in §Open.
- **Slim groups** (2026-10-14, asked "do we need it at all"; shown the frequency order's first days, 而 此 自
  以及 却 / 曾 作为 应 处 根据, it chose this): a day leads with one situation and is named after it,
  near-synonyms never share a day, the words with no situation come a couple a day. **No character families
  and no sentence links**: a known character's words (二手 分手 手套) share little meaning, and the ranking
  already prefers words made of known characters.

## What is there today (verified 2026-10-10, no code changed)

- **Today's words** = `hskDailyWords` (`backend/src/services/hsk.ts:463`): the first `dailyGoal` words of
  `frontierOrder`, ranked by `nextWordValue` = log(1 + jieba count) − log(1 + characters not yet met)
  (1e session 1). No grouping: a day is whatever comes next in the ranking.
- **Situation tags exist and are unused for this.** `data/hsk-situations.jsonl`: 0–2 of 47 situations
  (`SITUATIONS` in `services/wordPages.ts`: airport, transit, restaurant, doctor, office, …) on all 11,470
  HSK words, from 1d's pass. Only `wordPages.ts` reads them. Labels exist in English only (prompt text).
- **Numbers for HSK 3.0 level 4** (972 words, the author's level; throwaway count, not kept):
  - 477 words (49%) have a situation. The biggest groups: family 30, office 30, classroom 29, business 27,
    doctor 26, shopping 24. Transit has 8 (列车 地下 大巴 巴士 晚点 轮船 长途 高铁). So situation days
    cover about half the level; the other half (而 此 却 以及, abstract verbs) has no situation.
  - Character families: 264 characters are shared by 3+ level words; 754 words (78%) are in one. The
    biggest are useless as a theme (子 17, 大 15, 不 10, 一 7, 于 7); meaningful ones look like
    手 (二手 分手 手套 手工 手术 手里), 业 (企业 失业 毕业 营业), 动 (激动 移动 电动车).
  - 355 words (37%) use only characters from HSK 1–3 words: cheap words a family day can lean on.
  - Example sentences: `data/hsk-sentences.jsonl` has a pool sentence for 967 of the 972; the level-checked
    `data/hsk-band-sentences.jsonl` has one for 505, and 247 of those also contain another level-4 word.
- **Taking Today's words** (`components/HskDaily.tsx:104`) calls `api.batchAddWords({ …, enrich: true })`:
  an AI call per word (personal meaning + example). The dictionary card itself is already instant
  (item 2, "the dictionary makes the card"), and item 0 serves pool/band sentences at the learner's level,
  so a ready-made card is the same add with `enrich: false`.
- **Flashcards and Writing only use words already in the list.** Flashcards' new cards are capped by
  `capNewCards` (`newPerDay`); Writing's "not yet written" are the learner's own words (`lib/writing.ts`).
  When those run out, the only way to more new words is adding them by hand or from Today.

## Part 1 — The group (backend + a check script) — done 2026-10-14, slim

**What shipped** (`services/wordGroups.ts`, `scripts/check-word-groups.ts`, no database needed):
`nextGroup(order, size, dropped)` is pure. Pool = the top **200** of `frontierOrder` (now exported; at 120 half
of 30 days found no situation with 3 words). A day of N: `round(0.4 N)` slots for words with no situation (none
for N < 3), the rest from the best situation (score = Σ (POOL − rank) of its words, 3 at least), then the next
situation for a big day, then the pool's other concrete words, then anything. Near-synonyms = a shared term of
the hsk-ru meaning (else CC-CEDICT's English), hints in brackets dropped. Measured on HSK 3.0 L4, a learner who
knows 1–3: 30 of 30 days of 5 themed (office: 主席 大会 机构 + 而 此; history: 历史 公元 传统 + 却 曾); the
frequency order's first 4 days held 而/以及, 而/却, 材料/资料, the groups none; ≤ 2 abstract a day, 40% overall;
the first 100 words cover 42.9% of the level's usage vs 46.1% (93%); 20-word days carry a theme every day
(business: 企业 行业 项目 形势 实施 扩大 利益 考察 合同 进口 促进 + 8 abstract + 1). The last ~15 of the
level's 195 days at 5 a day are mostly abstract (40% < their 51% share of the level): accepted.
`check-next-word`, `check-gap-deck`, `check-sweep` pass.

**For part 2 (wiring):** `order` must be the frontier as the day began, so build it with words said known
*today* still in it (skip = status from before today, plus today's cards as now) and pass those words as
`dropped`: the rest of the day stays and the gap fills from the same theme. `frontierInputs` needs the
known-today set for that. Mind day one after onboarding: the guest deck's 20 cards are today's adds, and Today
should still read "done" over them rather than offer a group beside them.

The original design, kept for reference:

A function, say `nextGroup` in a new `services/wordGroups.ts`, that turns the frontier into days:

1. **The pool** is the next ~120 words of `frontierOrder`, so a group never trades usefulness for a theme:
   everything in it is already among the most useful next words.
2. **Candidate groups** from the pool:
   - each **situation** with 3+ pool words;
   - each **anchor character** the learner already knows (from their cards and the levels below) that 3+
     pool words share, weighted by how much meaning it carries: a character that appears in very many HSK
     words (子 了 的 不 一 大 有 于 …) is a weak anchor; use its count across the HSK list as the penalty;
   - **sentence links**: two pool words in one pool/band sentence.
3. **Score** a group by the `nextWordValue` of its best n words times a cohesion weight (situation highest,
   then anchor family, then sentence links); take the best for today. Fill up to the day's size with pool
   words that share a sentence or a character with the picked ones, then from the top of the order.
4. **Keep near-synonyms apart** (the "ten colours" rule, already in 1e): two words whose Russian meanings
   (`hsk-ru.jsonl`) or CEDICT glosses overlap don't go into one day.
5. **Words with no situation** (而 此 却 以及): at most 1–2 a day, preferring ones in today's sentences, so
   they still come, never as a whole day of connectors.
6. **Fixed for the day**, like now (characters count from the day after), and a **name**: the situation
   ("Транспорт") or the character ("Слова с 手").

`scripts/check-word-groups.ts` (the `check-*.ts` pattern): an HSK 4 learner who knows HSK 1–3, 30 simulated
days. Each day has most of its words in one situation or family; no near-synonym pair in a day; the first
100 words still cover at least ~90% of the level usage the frequency-only order covers; the day holds still;
`check-next-word`, `check-gap-deck` and `check-sweep` still pass. Print a few days so a person can read them.

## Part 2 — Today shows the group, and taking it is instant — done 2026-10-14

**What shipped:** `hskDailyWords` moved to `services/wordGroups.ts` (hsk.ts importing wordGroups would close an
import cycle through cedict/wordPages) and returns `{ theme, words[].situation }`. The order keeps today's cards
*and* today's "I know it"s (`frontierInputs().knownToday`), and the latter go to `nextGroup` as `dropped`, so a
known word leaves and the theme fills its slot. Words tapped as unknown (the check, a sweep's "to learn") lead
the day (`nextGroup`'s `first`; `check-sweep` caught the group dropping them), the themes fill the rest. Once
`dailyGoal` frontier words were taken another way today (onboarding's deck) the day reads done over them.
Today reads «Сегодня: офис · 5 слов» (47 `situation.*` labels, en/ru/zh); "В повторение" sends the HSK words
with `enrich: false` and the batch route places the pool sentence anyway (`poolExamples`), so no job is queued;
topic words still go with `enrich: true` (they have no pool sentence). `scripts/check-daily-group.ts`; a local
run as a fresh HSK 4 learner: 主席 大会 机构 + 而 此, taken in ~0.5 s, each card with its pool sentence.

The plan as written:

- `hskDailyWords` returns the group and its name; Today reads "Сегодня: транспорт · 8 слов".
- The situation names in en/ru/zh (47 labels in `lib/i18n.tsx`).
- "Take them into review" adds ready-made cards: `enrich: false`, the pool or band sentence at the
  learner's level, no Qwen call, so it is instant and free. The card's own "write an example for me" stays.
- Run it: Today on the author's level shows a named group, the cards appear at once with an example.

## Part 3 — New words in Flashcards and Writing without adding them first — done 2026-10-14

**What shipped** (`services/newWords.ts`, `scripts/check-new-words.ts`): `GET /api/hsk/next?n=8` gives what is
left of today's group first (the same choice Today offers), then the group after it, as ready-made cards
(id `new:<word>`; dictionary meaning, page details, the pool sentence; nothing written). `POST /api/hsk/learn`
makes the card on the first grade and grades it (reading from Flashcards, writing from Writing, whose reading
schedule stays new); a first "Easy" in Flashcards is "I know it" (placement answer, no card); a word that is a
card already (an earlier "Again") is just graded. `POST /api/hsk/learn/undo` takes it back card and all.
Flashcards: a «Новые слова · офис 5» row under Due now / All words (three labels don't fit one row on a phone),
offered when nothing is due and on the end screen then; first grades go through the offline queue (`learn` op);
Undo works; the Easy button reads «Знаю»; no open/edit until a card exists. Writing: the same row; traced first,
written from memory at the end. Local run as a fresh HSK 4 learner: 5 offered, Good/Hard/Again then quit = 3
cards; Writing traced 而 and 此, wrote 而 = 1 card (writing scheduled, reading new), 此 none; «Знаю» on 此 = no
card and Today swapped it, Undo put it back, Good made it; then «Новые слова · новости и политика 8».

The plan as written:

- `GET /api/hsk/next?n=` returns the next group as ready-made cards: dictionary data, no database write.
- **Flashcards:** a third choice on the setup ("Новые слова", beside Due now and All words), and the end
  screen's Keep going offers "Новые слова: транспорт (8)" when nothing is due.
- **Writing:** the same choice; a dictionary word is traced first and written from memory at the end, as
  any word never written is now.
- **A word becomes a card on its first grade** (one call: ready-made add + first review, through the
  offline queue), so the list only holds words actually studied and a quit session adds nothing unseen.
  Easy on first sight marks it known (the sweep's status) instead of making a card. In Writing the first
  graded write creates the card; its reading schedule then starts as a new card in Flashcards.
- Run it: as the author, nothing due → Новые слова → 8 words of one group, grade 3 of them, quit; exactly
  3 cards exist. The same from Writing.

## Part 4 — The proof

1e's measure: new words kept after 7 days per 10 minutes of study, by order (shuffled before 2026-09-27,
frequency from then, groups from part 2's date). A read-only script like `check-placement-holdout.ts`:
kept = the first review at least 7 days after adding is not Again; minutes from `ReviewEvent` gaps (capped).
Needs a week of the author's reviews on the groups.

## Cost

No model calls in parts 1–3: the tags, families, sentences and meanings already exist. The only new text is
47 situation labels in three languages.
