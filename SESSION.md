# Session handoff — 2026-10-21

- Task: fix the unrelated Chinese source shown on a fresh Reader visit; complete.
- Root cause: opening a saved text persisted its title in lexa.readerSource,
  while the passage itself remained transient and disappeared on navigation/reload.
- frontend/app/reader/page.tsx now owns source attribution as local React state.
  Fresh visits ignore the old storage value; saved-text opening sets its title;
  custom and saved sources still reach word/example attribution.
- frontend/lib/learnPrefs.ts: removed the unused persistent Reader source helper.
- BACKLOG.md Done records this directly requested fix; no backlog item started.
- Checks: backend npx tsc --noEmit -p . and frontend npx next build passed.
  Existing lint warnings remain. Russian Chromium 390×844 passed stale-source,
  custom/saved word attribution, New text, reload, overflow and browser-error checks.
- Local check: .playwright-cli/check-reader-source.mjs (ignored); throwaway users deleted.
  Initial sessionStorage handoff fixture timed out in dev; saved-text attribution
  was verified through the library instead. No app changes followed the checks.
- No schema changes or production data access. Fix c28be5d pushed to main.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
- Previous Mika model investigation remains read-only; no tutor changes made.
- Part 18 remains open. Retention and landing work remain deferred.
