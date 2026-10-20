# Session handoff

Updated: 2026-10-20. Replace stale notes; keep under 30 lines.

- Task complete: Part 3 of `PLAN-learner-bug-batch.md` (capture examples/removal).
- Reader/example/character/chat captures reuse saved style/level, preserve original
  context/source and add one useful example; no-example retains supplied context.
- Word pages have confirmed per-example deletion; remaining metadata/FSRS/text stay.
- Additive migration `20261020065907_capture_example_choices`: captured provenance,
  example revision and automatic-example control; applied to local Docker only.
- Edits/removals invalidate running writes and disable automatic refill/retry;
  explicit additions work. Full-list edits validate row ownership and are atomic.
- Checks passed: backend tsc, frontend production build (existing lint warnings),
  `backend/scripts/check-capture-examples.ts`, existing `check-example-progress.ts`.
- Live Qwen browser checks: `frontend/scripts/check-capture-examples.mjs`
  phone-webkit and desktop-chromium; progress, removal/reload, Reader/review,
  ownership and FSRS pass. Evidence: `.playwright-cli/capture-examples`.
- Next planned task: Part 4 (sentence audio); Parts 4-6 remain open. Stop here.
- Local :3001 serves the verified production build using
  `.playwright-cli/compose.verified.yml`; default compose restores dev mode.
- Preserve unrelated modified `frontend/.env.example`, untracked `h3.txt`, `p.out`.
- Grouped-word proof still needs seven-day evidence (~2026-10-21 earliest).
- Landing remains deferred until explicitly requested. Workspace-only access.
