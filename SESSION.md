# Session handoff — 2026-10-21

- Task: Part 13, clear Han-language settings including legacy accounts; complete.
- Files: frontend/app/account/page.tsx, components/AddWordForm.tsx, lib/i18n.tsx;
  status/evidence in PLAN-learner-bug-batch.md Part 13 and BACKLOG.md.
- Localized language selector, clear purpose/reset effect in ru/en/zh. Preserve
  browser-wide preference across accounts; no storage migration. Legacy Korean
  stays readable/stored with its existing Chinese fallback explained. Focused
  Add remains explicitly Chinese; unset preference keeps the settings row absent.
- Add uses useHanLang reactively: changes/reset affect mounted forms across tabs.
- Checks: backend npx tsc --noEmit -p .; frontend npx next build passed (existing
  warnings). Docker frontend stopped for build, restarted afterwards.
- Local disposable accounts: unset/zh/ja/ko, change/reset/reload, en/zh UI,
  A → B → A/browser scope, real Chinese/Russian manual card after reset. Russian
  phone Chromium settings screenshot inspected; no horizontal overflow.
- Isolated full-mode fixture: remembered Japanese, Korean fallback without data
  reset, Chinese choice, mounted cross-tab reset, selection/reload passed; no
  page errors. Local API/session gate used; temporary accounts cleaned.
- Evidence/check script: .playwright-cli/han-settings/; Part 13 explains harness
  adjustments. No hidden surfaces enabled in the actual app.
- Next: Part 14 of PLAN-learner-bug-batch.md (Mika memory); Parts 1–13 complete,
  Parts 14–18 open. Implement only one part per session.
- Grouped-word retention proof needs evidence; landing remains deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
