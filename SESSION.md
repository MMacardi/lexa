# Session handoff

Updated: 2026-10-19. Replace stale notes; keep under 30 lines.

- Task complete: Mika keyboard/card/copy bugs, context hint, and header drag-to-close.
- Implemented in `mobileNav.ts`, review page, GlobalTutor, TutorComposer, TutorThread, i18n.
- Native card-back scrolling; recover pinned page after keyboard pan; preserve selection;
  copy both message roles with fallback; close Mika via header drag and blur before closing.
- Context remains a rolling 120 messages / 64,000 characters, without automatic compression.
  The hint now appears only after truncation. The user was told old saved messages drop too.
- Checks: backend `npx tsc --noEmit -p .`, Docker frontend `npx next build` passed.
- `node frontend/scripts/check-mika-card-touch.mjs webkit` and `chromium` passed.
  Evidence: `.playwright-cli/mika-card-touch`. Test accounts are deleted by the script.
- Desktop WebKit simulates keyboard viewport changes; real iPhone keyboard/FPS not measured.
- Previous task: learner bug batch Part 2 complete and pushed as `5144d95`; evidence and
  migration details are in `PLAN-learner-bug-batch.md`. Parts 3–6 remain open.
- Next planned implementation is Part 3; this explicit bug report took priority.
- Local :3001 runs a production build via `.playwright-cli/compose.production.yml`;
  default `docker compose up` restores dev command. Restart for changed host sources.
- Preserve unrelated modified `frontend/.env.example`, untracked `h3.txt`, `p.out`.
- Grouped-word proof still needs seven-day evidence (~2026-10-21 earliest).
- Landing work remains deferred until explicitly requested. Workspace-only access.
