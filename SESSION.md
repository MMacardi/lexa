# Session handoff — 2026-10-21

- Task: audit Reader/card tap definitions; complete. No app-code changes.
- Confirmed: uncached sentence taps call AI even for settled dictionary words;
  Reader shows dictionary first; owned words use saved meanings. Cache is per sentence.
- Check: actual resolveMeaning with controlled dependencies passed dictionary-only,
  contextual AI, repeat cache and different-sentence cases; no real model calls.
- Prior task: PLAN-learner-bug-batch.md Part 15 complete; Part 16 not started.
- Backend: lib/teachingLanguage.ts, answerFormat.ts, services/tutorChat.ts,
  vocab.ts and llm.ts. Russian prose/translation validation, one silent repair,
  cancellation, distinct usage labels; invalid cached explanations regenerated.
- Frontend: RichText, TutorThread, MikaPinyinToggle, lib/mikaPinyin,
  GlobalTutor, app/mika/page, i18n. Local context readings for completed lines;
  no per-token transcription. Safe markdown, legacy reading cleanup, plain copy.
- Display choice is browser-persistent, keyed by account + source language;
  default on through HSK 4, off HSK 5+. Manual choice overrides level changes.
- Part 15 checks: backend tsc and frontend build passed; Docker frontend restarted.
- scripts/check-mika-format.ts: deterministic quotation/translation/retry/abort
  checks pass; real local Qwen general + card follow-up Russian replies pass.
- frontend/scripts/check-mika-pinyin.mjs: full flow passed defaults, isolation,
  history, streaming, phone/copy, partial-bold context. Final --render-only passed
  second-dash translation preservation and shared toggle; no browser errors.
- Live opening explanation also passed invalid-cache regeneration + cache reuse.
- Part 15 evidence: .playwright-cli/mika-pinyin; throwaway accounts cleaned.
- Next: Part 16 only. Parts 1–15 complete; Parts 16–18 remain open.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
- Grouped-word retention evidence and landing work remain deferred.
