# Session handoff — 2026-10-20

- Completed Part 6 of PLAN-learner-bug-batch.md; all six batch parts checked off.
- Author accepted Zhijia after comparing isolated xu4 with a native recording.
  Short words (1–4 Han): Sambert/Zhijia, native 48 kHz → 96 kbps MP3.
  Synthesis rate 1.25 for single characters, 1.0 for words; playback 1×.
  Cherry sentences, sentence keys/URLs and speed controls retained.
- No carrier, trimming, pitch editing, native-recording integration or migration.
  Word keys dictionary-v3; browser URLs v=word-3; existing caches not deleted.
- ASR moved to diagnostics: reviewed 序 gets 戏 even before encoding. Its text
  cannot verify tones or veto playback. Provider/encoding failures never cached.
- Files: services/tts.ts + wordTts.ts, lib/pricing.ts, frontend/lib/api.ts,
  backend dependency/env examples, check-tts scripts and diagnostic scripts.
- Passed backend tsc --noEmit; frontend next build (existing lint warnings);
  deterministic concurrency/cache/provider/encoder recovery; actual-route local
  WebSocket failures/30-second timeout; six live fresh/cache clips, replay 2–5 ms.
- Final phone + desktop Chromium: six actual MP3s/replay, auth/ranges/cache,
  word 1×/slow pitch preservation, Cherry sentence 1×/0.75×, same Reader pace,
  controlled fallback. Test users cleaned up. Six WAV/MP3 correlations ≥0.9895.
- Windows WebKit API-media fallback predates this change; Safari sound unverified.
  No universal tone accuracy claim. Native comparison is listening evidence only.
- Listening server :8766: /zhijia-service/ final; /native/, /pitch/, /engines/
  retain investigation references. Ignored artifacts: .playwright-cli/word-audio.
- Local :3001 production build; compose.verified.yml keeps Telegram disabled.
- Grouped-word proof waits for ~2026-10-21; landing deferred. No next task started.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
