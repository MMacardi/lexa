# Session handoff — 2026-10-21

- Task: Part 15, Russian Mika explanations and toggleable ruby pinyin; complete.
- Plan: PLAN-learner-bug-batch.md, Part 15; do not start Part 16 here.
- Backend: lib/teachingLanguage.ts, answerFormat.ts, services/tutorChat.ts,
  vocab.ts and llm.ts. Russian prose/translation validation, one silent repair,
  cancellation, distinct usage labels; invalid cached explanations regenerated.
- Frontend: RichText, TutorThread, MikaPinyinToggle, lib/mikaPinyin,
  GlobalTutor, app/mika/page, i18n. Local context readings for completed lines;
  no per-token transcription. Safe markdown, legacy reading cleanup, plain copy.
- Display choice is browser-persistent, keyed by account + source language;
  default on through HSK 4, off HSK 5+. Manual choice overrides level changes.
- Phrase readings include 到达, 银行/行走 across partial bold, and 还给.
- Checks: final backend npx tsc --noEmit -p . and frontend npx next build passed
  (existing warnings). Docker frontend stopped for build, restarted afterwards.
- scripts/check-mika-format.ts: deterministic quotation/translation/retry/abort
  checks pass; real local Qwen general + card follow-up Russian replies pass.
- frontend/scripts/check-mika-pinyin.mjs: full flow passed defaults, isolation,
  history, streaming, phone/copy, partial-bold context. Final --render-only passed
  second-dash translation preservation and shared toggle; no browser errors.
- Live opening explanation also passed invalid-cache regeneration + cache reuse.
- Evidence: .playwright-cli/mika-pinyin/{result,render-result}.json and inspected
  phone-ruby.png. All throwaway local accounts cleaned; no schema changes.
- Next: Part 16 only. Parts 1–15 complete; Parts 16–18 remain open.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
- Grouped-word retention evidence and landing work remain deferred.
