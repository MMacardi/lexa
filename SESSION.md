# Session handoff — 2026-10-21

- Task: explicit Reader audio layout request, complete.
- Player starts as a small listening button at the source card's lower-right
  edge on phone/desktop; expands above navigation, away from the header.
- Minimize keeps playback/position; a different text starts collapsed. Speed
  uses the themed Select. Locate has a visible label and hover help in ru/en/zh;
  locate/follow scrolling keeps the active passage above the expanded panel.
- Files: ReaderListeningPlayer.tsx, reader/page.tsx, lib/i18n.tsx,
  scripts/check-reader-listening.mjs; follow-up in BACKLOG and Part 10 plan.
- Checks: backend npx tsc --noEmit -p . and frontend npx next build passed
  (existing warnings). Build rerun with Docker frontend stopped to avoid
  shared .next dev/build collision; frontend restarted afterwards.
- check-reader-listening.mjs phone-chromium layout-only and desktop-chromium
  layout-only passed: real local MP3, pause/resume, minimize/reopen, speeds
  without new fetches, header/nav bounds, long/short text, locate visibility,
  hover explanation, keyboard/focus and text reset. Screenshots inspected in
  .playwright-cli/reader-listening; temporary accounts cleaned. Physical iOS
  remains unverified (Part 10 documents the Windows WebKit MP3 limitation).
- Next: Part 13 of PLAN-learner-bug-batch.md; Parts 1–12 complete,
  Parts 13–18 open. Implement only one part per session.
- Part 18: distinguish listening/cache/synthesis/prefetch usage (Part 10).
- Grouped-word retention proof needs evidence; landing remains deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
