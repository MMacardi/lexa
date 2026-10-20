# Session handoff

Updated: 2026-10-20. Replace stale notes; keep under 30 lines.

- Part 5 of `PLAN-learner-bug-batch.md` complete: compact shared popups, accurate
  Reader hints in ru/en/zh, cold-cache saved status and keyboard interaction.
- Files: `frontend/components/{WordMeaningPop,ExampleText}.tsx`, Reader page,
  i18n; `backend/src/services/importWords.ts` scopes duplicate checks to the pair.
- No migration or existing-card edits. Reader's mobile bottom popup and centered
  second card remain; desktop hold works, mobile hint uses tap/open-card.
- Checks passed: backend `npx tsc --noEmit -p .`; frontend `npx next build`
  (existing warnings); source review of persistence and account/pair scoping.
- Local flows: `frontend/scripts/check-compact-popups.mjs` — Russian phone WebKit
  and desktop Chromium; capture/repeat/pairs, cold links/reload, keyboard/focus,
  viewport corners, loading/errors, auto-gloss/underlines, ru/en/zh, chat/scene.
- Evidence: `.playwright-cli/compact-popups`; throwaway accounts removed.
- Deferred finding in backlog: cold hidden scene `?session=<id>` returned to setup;
  new-scene shared popup works. No hidden feature exposed.
- Part 6 (short-word Mandarin pronunciation) remains open; stop after Part 5.
- Local :3001 serves the verified production build using
  `.playwright-cli/compose.verified.yml`; default compose restores dev mode.
- Preserve unrelated modified `frontend/.env.example`, untracked `h3.txt`, `p.out`.
- Grouped-word proof still needs seven-day evidence (~2026-10-21 earliest).
- Landing remains deferred until explicitly requested. Workspace-only access.
