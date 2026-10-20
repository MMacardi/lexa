# Session handoff

Updated: 2026-10-19. Replace stale notes; keep under 30 lines.

- Task complete: `PLAN-learner-bug-batch.md` Part 1 (connection/startup).
- Next explicit session: Part 2 (example progress after every add); Parts 2–6 open.
  Stop after Part 1 in this session; previous Reader/Mika plan is complete.
- Transient auth failures preserve the shell; minimal display snapshot and scoped
  IndexedDB words/details support cached reading. Server cookie/invite gates remain
  authoritative. Logout/switch/revocation clear caches; offline logout retries.
- Queued writes now carry an account owner; legacy queues require a matching old
  prefs marker. Status no longer covers phone grades. Failed quick-add preloads
  are handled; verified refresh cancels pending cache reads before fetching.
- `/auth/me.hasWords` removes full-list onboarding blocking; no schema/migrations.
- Checks passed: backend `npx tsc --noEmit -p .` (Prisma client regenerated), final
  frontend `npx next build` (existing lint warnings), focused diff/reference review.
- Final local production-build flows pass: desktop Chromium; phone Chromium 360,
  iPhone 13 WebKit, Firefox 390. Offline read/review/queue/reload, reconnect, timeout,
  5xx, 401/403, invite revocation, 404, switching, logout and onboarding covered.
- `frontend/scripts/check-connection.mjs` creates/deletes only its test accounts;
  `measure-startup.mjs` records before/after; evidence and limits are in the plan.
- Cached slow-API word paint: 4,440 → 930 ms. Uncached assets/content still need
  network; no PWA rewrite. First dev compilation varied; no first-visit speed claim.
- Preserve unrelated modified `frontend/.env.example`, untracked `h3.txt`, `p.out`.
- Docker dev file watching missed some host edits; restart before retesting changes.
- Grouped-word Part 4 still needs actual seven-day evidence (~2026-10-21 earliest).
- Landing work stays deferred until explicitly requested. Workspace-only access.
