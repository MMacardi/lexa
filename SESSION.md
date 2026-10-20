# Session handoff

Updated: 2026-10-19. Replace stale notes; keep under 30 lines.

- Task complete: `PLAN-learner-bug-batch.md` Part 2 (example progress after every add).
- Word enrichment/example states persist independently; single adds use the import
  queue. Retry preserves the original sense/options and card, including partial
  example failure. Explicit no-example stays disabled; Reader translation is tracked.
- Main/dictionary/Reader/popup progress updates query + offline caches; job links
  use actual card IDs. Double-tap guards and retry cancellation preserve saved cards.
- Migration `20261019180000_card_example_progress` applied to local Docker DB :5433;
  two status columns only, no example/schedule rewrites. Server applies on startup.
- Passed: backend tsc, final frontend build (existing lint warnings), focused backend
  example-progress checks, existing enrich-fast checks, full desktop Reader/Mika fixtures.
- Final production-build UI suite passes desktop Chromium, phone Chromium 360,
  iPhone 13 WebKit and Firefox 390, including console checks and phone layout.
- A held job stayed visibly pending 125 seconds, then completed without reload;
  expired leases, navigation/reload and both IndexedDB snapshots verified.
- Plan/backlog updated; focused diff, ownership and schema/persistence review passed.
- Local :3001 runs a production build via `.playwright-cli/compose.production.yml`;
  default `docker compose up` restores dev command. Restart for changed host sources.
- Stop after Part 2. Next explicit session is Part 3; Parts 3–6 remain open.
- Preserve unrelated modified `frontend/.env.example`, untracked `h3.txt`, `p.out`.
- Grouped-word proof still needs seven-day evidence (~2026-10-21 earliest).
- Landing work remains deferred until explicitly requested. Workspace-only access.
