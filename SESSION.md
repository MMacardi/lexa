# Session handoff — 2026-10-21

- Task: dictionary / contextual AI tap setting; complete.
- Settings: Account → More settings → Reading. Dictionary is default; AI in context
  is optional. learnPrefs stores the choice per account in this browser (no schema).
- Files: frontend app/account, app/reader, ExampleText, WordMeaningPop,
  lib/{learnPrefs,resolveMeaning,api,i18n}; backend routes/words + services/lookup.
- Reader/card examples use contextual AI for saved and unsaved words when selected;
  saved definitions remain untouched. Pending popups invalidate on mode/account
  changes or close. Dictionary mode prefers dictionary data over cached AI.
- API /gloss defaults to dictionary; absent translations keep the free AI fallback.
  contextual=true uses the existing daily AI pool; Pro/beta remains uncapped.
  Cap shows the Pro upsell + localized error while keeping dictionary text readable.
- Server dictionary responses carry dictionary=true and never enter the AI cache.
- Checks: backend npx tsc --noEmit -p . and frontend npx next build passed
  (existing warnings). Local Docker backend/frontend restarted for verification.
- check-tap-dictionary.mjs: default dictionary/gaps, settings persistence,
  Reader/card AI for saved/unsaved words, distinct sentences/cache, unchanged cards
  passed. Corrected second-account fixture; --settings-quota-only passed account
  isolation, real daily charging, exhausted cap, free dictionary/gap and phone upsell.
- Focused actual-resolver check: failed client lookup/server dictionary response
  cannot mask a later contextual AI answer; AI replay cached.
- Evidence: .playwright-cli/tap-dictionary/{result.json,phone-settings.png}.
  All throwaway local accounts cleaned. No migrations or production data used.
- Prior plan: PLAN-learner-bug-batch.md Parts 1–15 complete; Parts 16–18 open.
  Do not start Part 16 automatically. Retention evidence and landing remain deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
