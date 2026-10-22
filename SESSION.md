# Session handoff — 2026-10-22

- Task: fixed missing 程 meaning and handwriting insertion/selection; verified.
- Starting main: 619e148. Preserved unrelated frontend/.env.example, h3.txt, p.out.
- 程 now has prepared CC-CEDICT-backed Russian senses in data/everyday-ru.jsonl.
- General localization: one failed gap no longer discards successful character
  meanings. Partial results expose retry; completed entries reuse shared cache.
- Words without prepared Russian may still hit network/model failures.
- AddWordForm remembers the input selection across pad focus, inserts/replaces at
  the caret and restores its position without reopening the phone keyboard.
- Pad backspace uses selection/caret, handles supplementary Unicode; ru/en/zh label.
- Files: backend services/characters.ts, routes/words.ts, everyday-ru.jsonl;
  frontend AddWordForm, WordCharacters, ui/input, i18n.
- Passed backend tsc --noEmit -p ., frontend next build (existing warnings),
  check-characters.ts and check-character-recovery.ts (controlled invalid sense).
- Russian Chromium iPhone 13 viewport tested local production build: prepared 程
  with no localization request; partial translation/retry; actual handwriting
  recognition at start/middle/end, repeated insertions, selection replacement,
  empty input, backspace and Unicode. No overflow/browser errors. Test users deleted.
- Reproduce: node frontend/scripts/check-capture-input.mjs (local :3000/:3001);
  docker compose exec -T backend npx tsx scripts/check-character-recovery.ts.
- Evidence: ignored .playwright-cli/capture-input/result.json. No schema changes.
- Local backend bot disabled via .playwright-cli/capture-input/compose-check.yml.
- Parked at user's request: source-backed Mika grammar explanations; resume only
  when asked (BACKLOG Parked). Previous reviewed-draft mitigation remains;
  general grammar reliability unresolved. EVAL-tutor-reliability-followup.md.
- Mika rollback: BAILIAN_TUTOR_REVIEW_MODEL=off and restart; Russian guard remains.
