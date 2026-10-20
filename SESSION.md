# Session handoff — 2026-10-20

- Task: Part 7 — Reader level and honest HSK vocabulary counts, complete.
- Next implementation: Part 8 of PLAN-learner-bug-batch.md. Parts 1–7 complete;
  Parts 8–18 open. Implement only one part per session; do not restart earlier work.
- Reader now analyzes all tagged tokens on the chosen HSK 2.0/3.0 list: lowest
  level covering >=95% of listed occurrences; off-list counts shown separately.
  New words remain unique keys; target copy names HSK 1–4 / 1–9, including zero.
- Chinese level estimation uses no LLM. Other-language CEFR behavior is unchanged.
- Nullable ReaderText.levelSource migration applied locally; no content/level
  backfill. Distinct manual/requested/legacy labels; reopen recomputes vocabulary.
  Untouched edit pickers and export/import preserve the original level/source.
- Relevant files: readerVocabulary.ts, ReaderLevelBadge.tsx, Reader page/library/
  save tools, readerText.ts, accountData.ts, Prisma migration, ru/en/zh copy.
- Checks passed: backend npx tsc --noEmit -p .; frontend npx next build (existing
  lint warnings); backend/scripts/check-reader-vocabulary.ts; one Russian WebKit
  phone flow frontend/scripts/check-reader-vocabulary.mjs (also en/zh copy).
- 76/62 fixture: 76 unique words; 62 <=HSK 4; HSK 3 covers 558/572 occurrences.
  Verified 95% boundary, repeats, off-list/names, >1,500 chars, both lists, 7–9,
  metadata preservation/reopen, generation sources, CEFR and export/import.
  Phone evidence: .playwright-cli/reader-vocabulary/; throwaway users removed.
- Preserve Part 6 audio: Sambert/Zhijia short words; Cherry sentences. Diagnose
  new reports before engine/cache changes. Mika memory/AI accounting remain later.
- Grouped-word retention proof still needs actual evidence; landing deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
