# Session handoff — 2026-10-21

- Task: Part 12 — Existing-card action, deleted-card links and useful errors, complete.
- Next: Part 13 of PLAN-learner-bug-batch.md. Parts 1–12 complete;
  Parts 13–18 open. Implement only one part per session.
- AddWordForm uses explicit existing-card choices for the exact owned pair,
  showing readings/meanings; opening creates nothing. Cancel/Add anyway and the
  session preference remain. Success links follow the live deck/account.
- wordQueries.ts centralizes list/detail/bulk deletion and 404 eviction; sync.ts
  clears offline snapshots and guards late responses with per-account tombstones.
  Background import refreshes respect deletion. Reader clears missing-card popups,
  panels and removed saved highlights. No schema or backend behavior changes.
- Old card URLs have a calm deleted/not-found message and My words route.
  ErrorState separates auth/not-found/transient failures; retry only helps the
  latter. Developer-facing server hints removed in ru/en/zh. Cached cards survive 502.
- Checks: backend npx tsc --noEmit -p . passed after regenerating the project-local
  Prisma client for Part 11; frontend npx next build passed (existing warnings).
- check-existing-card.mjs passed: Russian phone Chromium exact pair/multiple
  meanings, same owned ID/no creation, Cancel/Add anyway/preference, deleted Add/
  URL/Reader, foreign-ID 404, cached 404 eviction, cached/uncached 502; desktop
  live Add banner clears on list deletion. No page errors. Test accounts cleaned.
- Evidence: .playwright-cli/existing-card/results.json and phone-duplicate.png.
- Part 18: distinguish listening/cache/synthesis/prefetch usage (Part 10 handoff).
- Grouped-word retention proof needs evidence; landing remains deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
