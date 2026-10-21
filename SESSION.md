# Session handoff — 2026-10-21

- Task: dictionary meanings on word taps; complete.
- Files: frontend/lib/resolveMeaning.ts, glossCache.ts, api.ts;
  app/reader/page.tsx, components/TapGlossPills.tsx; backend route comment.
- Available Chinese dictionary meanings win even with a sentence, multiple senses
  or an older cached AI answer. English uses CC-CEDICT's gloss directly.
- AI remains the fallback for missing meanings in the learner's language;
  its cache stays per word/language pair/sentence. Saved deck meanings preserved.
- Reader removed its redundant cache and contextual-refinement pending notice.
  Meaning chips now share the resolver. Existing popup latency harnesses force
  a missing dictionary meaning when exercising delayed AI responses.
- Checks: backend npx tsc --noEmit -p .; frontend npx next build passed
  (existing warnings). Docker frontend restarted after build; stale dev bundle cleared.
- frontend/scripts/check-tap-dictionary.mjs passed: Russian phone Reader + card,
  real dictionary HSK/multiple senses, stale-cache precedence, zero known-word AI,
  controlled missing-Russian-meaning fallback + repeat cache; no browser errors.
- Evidence: .playwright-cli/tap-dictionary/result.json. Throwaway account cleaned.
- No schema changes or production data used. Docker npm lockfile churn restored.
- Prior plan: PLAN-learner-bug-batch.md Parts 1–15 complete; Parts 16–18 open.
  Do not start Part 16 automatically in this task.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
- Grouped-word retention evidence and landing work remain deferred.
