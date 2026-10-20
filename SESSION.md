# Session handoff

Updated: 2026-10-20. Replace stale notes; keep under 30 lines.

- Task complete: mobile Reader card popup, explicitly requested by the author.
- Small word popup retains its original bottom dock, layout and scroll clearance.
- Second popup (Open card) stays centered in the visible mobile viewport; no drag
  handle/offset on phones. Long cards scroll internally with the close button visible.
- Mobile hold shortcut removed; saved-word tap then Open card is the entry.
- Desktop hold/drag preserved. Reader hints updated in ru/en/zh.
- Files: `frontend/app/reader/page.tsx`, `frontend/lib/i18n.tsx`,
  `BACKLOG.md`, scoped note in Part 5 of `PLAN-learner-bug-batch.md`.
- Checks passed: backend `npx tsc --noEmit -p .`, frontend `npx next build`
  (existing warnings), focused Russian mobile WebKit at 390px and 320px.
- Browser verified bottom popup, centered second card, attempted drag, internal/page
  scroll, hold removed, Escape/outside/close, viewport fit; screenshots inspected.
- Evidence/check script: `.playwright-cli/reader-centered`,
  `.playwright-cli/check-reader-centered.mjs`. Throwaway local account removed.
- Prior Part 4 (sentence audio) complete; Parts 5-6 remain open. No new task started.
- Local :3001 serves the verified production build using
  `.playwright-cli/compose.verified.yml`; default compose restores dev mode.
- Preserve unrelated modified `frontend/.env.example`, untracked `h3.txt`, `p.out`.
- Grouped-word proof still needs seven-day evidence (~2026-10-21 earliest).
- Landing remains deferred until explicitly requested. Workspace-only access.
