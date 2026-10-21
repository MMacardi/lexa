# Session handoff — 2026-10-21

- Task: Zhijia for all Mandarin audio; complete.
- Backend: services/tts.ts now uses the existing Sambert/Zhijia WebSocket pipeline
  for words, sentences and Reader chunks. wordTts.ts allows bounded 16 MB WAVs.
- Rates: isolated characters 1.25; longer text 1.0. MP3 96 kbps for playback.
- Accepted word cache keys preserved; sentence DB keys retire Cherry.
  frontend/lib/api.ts versions sentence URLs with v=zhijia-1, words keep word-3.
- backend/.env.example documents the shared voice. inspect-tts.ts remains a Qwen
  comparison tool with its own default; word-audio check expects new sentence URL.
- Checks passed: backend npx tsc --noEmit -p .; frontend npx next build
  (existing warnings). Local Docker backend/frontend restarted after changes.
- check-tts-policy.ts and check-tts-http.ts passed: sentence model/rates, cache,
  large frames, provider/encoding failures, timeout and byte ranges.
- check-zhijia-sentences.mjs: real sentence + 300-character synthesis and cached
  replay passed; usage records sambert-zhijia-v1. Initial review selector was wrong;
  corrected it and --playback-only passed phone Reader + card real MP3 playback,
  new URL, normal rate, no browser fallback/errors. Test accounts cleaned.
- Evidence: .playwright-cli/zhijia-sentences/{sentence,passage}.mp3 and result.json.
- No migrations or production data used. Docker npm lockfile churn restored.
- Prior plan: PLAN-learner-bug-batch.md Parts 1–15 complete; Parts 16–18 open.
  Do not start Part 16 automatically in this task.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
- Grouped-word retention evidence and landing work remain deferred.
