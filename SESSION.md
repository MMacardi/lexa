# Session handoff

Updated: 2026-10-19. Replace stale notes; keep under 30 lines.

- Task: plan the new screenshot bug batch; planning complete, app fixes not started.
- Next: `PLAN-learner-bug-batch.md` Part 1 (connection failures and startup).
- Six parts, one per implementation session; user may explicitly choose another.
- Findings: account refresh clears auth on all failures; My words skips offline cache;
  example polling infers readiness from dictionary fields; Reader context disables
  generated examples; short-word TTS checks syllables without tones.
- Plan includes example deletion/preferences, progress without reload, playback
  stop/speed/layout, compact popups and accurate ru/en/zh instructions.
- Model settings and copyable session prompt are in the plan; current official
  OpenAI model guidance checked. Only the external openai-docs SKILL.md was read,
  with the user's explicit permission; no permission for other outside files.
- Checks: docs-only diff, plan/backlog references and status consistency; no app
  builds, live application API calls or learner-flow checks in this planning session.
- Preserve unrelated work: modified `frontend/.env.example`; untracked `h3.txt`,
  `p.out`. Stage only plan, backlog and this handoff for the planning commit.
- `PLAN-reader-mika-fixes.md`: all eight parts complete; do not restart it.
- `PLAN-word-groups.md` Part 4: still needs seven-day review evidence, earliest
  approximately 2026-10-21; leave open and never access production data.
- Landing copy/layout/screenshots, including any final pass, remain deferred until
  explicitly requested. Auth routing fixes are within the new batch's scope.
