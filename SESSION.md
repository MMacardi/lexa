# Session handoff — 2026-10-21

- Task: Part 11 — Russian dictionary loading and consistent saved meanings, complete.
- Next: Part 12 of PLAN-learner-bug-batch.md. Parts 1–11 complete;
  Parts 12–18 open. Implement only one part per session.
- Lookup uses the target language and canonical card wording; no previous-query
  rows or English fallback in Russian loading/failure states. Retry in Add,
  Reader popups, saved-word popups, detail and review; review updates live.
- localizedDictionary.ts shares grounded off-list adaptations across lookup/add/
  enrichment/detail, with singleflight and a persistent inventory/version cache.
- Additive migration 20261021080823_dictionary_adaptation_cache applied locally;
  no learner-row changes. Prepared data first; gaps keep generated definitions.
- wordPages.ts shares punctuation/synonym/grammatical-variant matching. Explicit
  picks preserve readings/flags; contextual mappings preserve their wording.
  Meaning/reading/senses CAS guards protect in-flight edits. No deduplication.
- Checks: backend npx tsc --noEmit -p .; frontend npx next build passed
  (existing lint warnings). check-dictionary-meanings.ts controlled + --live:
  照镜子, 仔细, 及时, 背, 蛤蜊, 拮据的; edit/selection races and context mapping.
- A fresh process with Qwen disabled reused persisted dictionary translations.
- Phone Chromium: Add loading/502/retry/query switch, real detail/reload, review,
  Reader failure; focused recovery verified raw-English hiding and live retry.
  Evidence: .playwright-cli/dictionary-meanings. Test accounts cleaned up.
- Part 18: distinguish listening/cache/synthesis/prefetch usage (Part 10 handoff).
- Grouped-word retention proof needs evidence; landing remains deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
