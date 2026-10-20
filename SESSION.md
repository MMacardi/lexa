# Session handoff

Updated: 2026-10-20. Replace stale notes; keep under 30 lines.

- Task complete: opening a saved Reader text starts at the top of the page.
- A layout effect resets scroll on entering reading or switching saved-text IDs,
  after the library is replaced. Normal scrolling during reading is preserved.
- Relevant file: `frontend/app/reader/page.tsx`; status note in `BACKLOG.md`.
- Checks passed: backend `npx tsc --noEmit -p .`, frontend `npx next build`
  (existing warnings), Russian mobile WebKit at 390px.
- Browser: library scroll 930/964px -> reading scroll 0; switching saved texts,
  reopening the same text, visible top toolbar, normal reading scroll all pass.
- Check: `.playwright-cli/check-reader-open-scroll.mjs`; local throwaway user removed.
- Prior mobile popup work complete: small popup stays at bottom; second card is
  centered/immovable, close sits beside word without a blank strip; hold removed.
- Part 4 (sentence audio) complete; Parts 5-6 of `PLAN-learner-bug-batch.md` open.
- Local :3001 serves the verified production build using
  `.playwright-cli/compose.verified.yml`; default compose restores dev mode.
- Preserve unrelated modified `frontend/.env.example`, untracked `h3.txt`, `p.out`.
- Grouped-word proof still needs seven-day evidence (~2026-10-21 earliest).
- Landing remains deferred until explicitly requested. Workspace-only access.
