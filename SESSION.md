# Session handoff — 2026-10-20

- Task: Part 10 — Whole-text Reader playback, speed and progress, complete.
- Next: Part 11 of PLAN-learner-bug-batch.md. Parts 1–10 complete;
  Parts 11–18 open. Implement only one part per session.
- ReaderListeningPlayer + lib/readerPlayback.ts: all source units, 120-char
  chunks, pause/resume/stop/replay, 0.75/1/1.25/1.5×, accessible fragment seek,
  honest loading/ready counts, passage highlight/locate, selection-safe following.
- Uses speak.ts's shared unlocked element; word/sentence playback cancels queue.
  Fetches current + one next; bounded 64-clip/24-MiB cache, no synthesis by speed.
  Abort/generation guards cover switches, edits, deletion and navigation;
  retry resumes failed chunk. Primer settles before first async clip replaces it.
- Pronunciation practice stays separate and limited to 12 sentences; listening
  has no such limit. Accepted Sambert/Zhijia words and Qwen/Cherry unchanged.
- Checks: backend npx tsc --noEmit -p .; frontend npx next build passed
  (existing lint warnings); check-reader-playback.mjs + check-sentence-audio.mjs.
- check-reader-listening.mjs phone-chromium passed: real MP3s, 16 units/18
  chunks, 342-char unit, complete replay, rate/pause/seek, 502/retry, saved-word
  interruption, selection, navigation/late fetch. lifecycle-only passed edit,
  content replacement, delete and quick text switch; test accounts removed.
- Evidence/screenshots: .playwright-cli/reader-listening. Windows WebKit fails
  the same MP3 directly and as a blob (NotSupportedError); actual iOS unverified.
- Part 18 must distinguish listening uses, cache hits, actual synthesis and
  prefetched work finishing after cancel; existing tts character/model log kept.
- Grouped-word retention proof needs evidence; landing deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
