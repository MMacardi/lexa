# Session handoff — 2026-10-20

- Task: Part 8 — Popup toggling, viewport bounds and useful previews, complete.
- Next implementation: Part 9 of PLAN-learner-bug-batch.md. Parts 1–8 complete;
  Parts 9–18 open. Implement only one part per session.
- Reader: selection remains per word; popup anchor identifies the occurrence.
  Same-anchor tap/Enter/Space closes; other occurrences open without deselection.
  Outside/Escape dismiss; switching saved/new cancels old popup/timer; lookup
  identities prevent late responses after close/switch from changing the popup.
- ReaderWordPopup measures loaded height, flips/constrains to available space,
  scrolls internally and follows viewport/page changes without rerendering text.
  The anchor stays uncovered for repeat tap. Phone dock/centered card preserved.
- Black repeating preview traced to WordFamilyGraph title → TitleTips. Its
  DictionaryPreview uses cached dictionary pinyin/localized meaning, loading/
  unavailable states; English only for English targets. No new AI preview calls.
  Graph word activation/removal remain separate keyboard-accessible controls.
- Relevant files: reader/page.tsx, ReaderWordPopup.tsx, DictionaryPreview.tsx,
  WordFamilyGraph.tsx, i18n.tsx; plan Part 8 and BACKLOG.md status updated.
- Checks passed: backend npx tsc --noEmit -p .; frontend npx next build (existing
  lint warnings); node frontend/scripts/check-reader-popups.mjs: Chromium desktop
  and Russian WebKit phone, real dictionary/controlled gloss latency. Screenshots
  in .playwright-cli/reader-popups/ visually inspected; throwaway users removed.
- Preserve Part 6 audio: Sambert/Zhijia short words; Cherry sentences. Diagnose
  reports before engine/cache changes. Part 7 HSK counting/metadata preserved.
- Grouped-word retention proof still needs actual evidence; landing deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
