# Session handoff — 2026-10-20

- Task: Part 9 — Reliable audio for numbered and unpunctuated passages, complete.
- Next implementation: Part 10 of PLAN-learner-bug-batch.md. Parts 1–9 complete;
  Parts 10–18 open. Implement only one part per session.
- Reader speech spans keep exact source offsets; numbered labels and inline/
  separate A–F options stay displayed but are not spoken. Bare labels have no audio.
- speak.ts queues bounded chunks within each logical unit; no whole-text player yet.
  300-character provider synthesis timed out locally; 120-character chunks passed.
  Source pauses/word boundaries preferred; surrogate pairs preserved.
- Mandarin media errors are visible with retry, never a silent browser fallback.
  Retry resumes the failed chunk; stop/switch invalidates late chunk events.
  Non-Mandarin browser speech and the shared iOS-unlocked element are preserved.
- Preserve accepted Part 6 audio: Sambert/Zhijia short words; Qwen/Cherry sentences.
  Engine/rates/cache policy unchanged. Screenshot 13 word/reading/clip unavailable;
  requested from author. Tone diagnosis/listening comparison awaits identification.
- Relevant: frontend/lib/{sentences,speak}.ts, SpeakButton.tsx, i18n.tsx,
  review/quiz pages; backend route comment; plan Part 9 and backlog updated.
- Checks passed: backend npx tsc --noEmit -p .; frontend npx next build (existing
  lint warnings); node frontend/scripts/check-sentence-audio.mjs; node
  frontend/scripts/check-sentence-audio-ui.mjs (desktop + Russian phone Chromium).
  Final phone rerun passed after copy/unlock changes; retry screenshot inspected.
- Evidence: .playwright-cli/sentence-audio; 342 characters played as 120/120/102,
  real HTTP 206 media and cached HTTP 200 MP3 bytes; review/quiz smoke passed.
  Throwaway local accounts removed. Restart Docker frontend after local edits if
  its Windows file watcher serves stale code; wait for startup before browser tests.
- Grouped-word retention proof still needs actual evidence; landing deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
