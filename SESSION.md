# Session handoff — 2026-10-21

- Task: Part 17 — Search saved words by pinyin without spaces; complete.
- Plan: PLAN-learner-bug-batch.md Part 17; Parts 1–17 complete, 18 open.
- Reproduced locally: saved 你好 matches hanzi but not nihao; 女孩 not nvhai.
- Changes: memoized saved-word search fields; Chinese readings normalize tones,
  spaces/separators/case and ü/u:/v without conflating plain u. Saved readings
  win; missing/blank zh/zh-Hant phonetics use existing offline localTranscribe.
  No transcription per keystroke; no dictionary/AI calls or saved-data changes.
- Files: frontend/lib/useWordSearch.ts, app/words/page.tsx, lib/i18n.tsx,
  scripts/check-word-pinyin-search.mjs. Search hint/accessible name in ru/en/zh.
- Checks: backend npx tsc --noEmit -p .; frontend npx next build passed
  (existing warnings); focused browser script passed seven behavior groups.
- Behavior: tone/spacing/case/separator and ü/u:/v variants; saved chóng versus
  legacy zhòng for separate 重 cards; legacy traditional/blank phonetics;
  Russian/hanzi/clear/invalid/unsaved queries; pair/collection/study filters;
  Russian Chromium phone 390×844 typing/focus/result action. Zero typing API
  requests or browser errors; card count/readings unchanged.
- Evidence: .playwright-cli/word-pinyin-search/{before,result}.json.
- Local throwaway account/data cleaned. No migrations, production data or live AI.
- Next: Part 18 only when requested. Retention evidence and landing remain deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
