# Session handoff

Updated: 2026-10-19. Replace stale notes; keep under 30 lines.

- Task complete: added proportional verification rules to `AGENTS.md` at the user's request.
- Default: required checks once, focused behavior verification, one relevant phone/browser
  spot-check for learner UI. Screenshots need a visual purpose; broad matrices and unrelated
  regressions need an explicit request or concrete risk. Rerun only affected checks.
- Docs-only verification: reviewed diffs and consistency; no app builds or browser runs.
- Previous task: learner bug batch Part 2 complete and pushed as `5144d95`; evidence and
  migration details are in `PLAN-learner-bug-batch.md`. Parts 3–6 remain open.
- Next explicit implementation session is Part 3; do not start it during this docs task.
- Local :3001 runs a production build via `.playwright-cli/compose.production.yml`;
  default `docker compose up` restores dev command. Restart for changed host sources.
- Preserve unrelated modified `frontend/.env.example`, untracked `h3.txt`, `p.out`.
- Grouped-word proof still needs seven-day evidence (~2026-10-21 earliest).
- Landing work remains deferred until explicitly requested. Workspace-only access.
