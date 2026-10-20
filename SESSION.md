# Session handoff

Updated: 2026-10-20. Replace stale notes; keep under 30 lines.

- Task complete: Part 4 of `PLAN-learner-bug-batch.md` (sentence audio).
- Reader sentence spans exclude list-number/decimal boundaries and retain closing
  punctuation; final word/pinyin and one compact audio group stay together.
- Reader and My words share saved sentence speed (1× default / 0.75×), Play/Stop
  and loading/playing state. Server speed preserves pitch without separate clips;
  browser rate changes replay the sentence. Word defaults remain unchanged.
- Shared stop cancels delayed starts/voice waits/fallback; ownership, route and
  page-hide cleanup stop stale playback. iOS element reuse/onset primer retained.
- Relevant files: `frontend/lib/{speak,sentences}.ts`, `SpeakButton`, `ExampleText`,
  `SpeechLifecycle`, Reader/word pages, providers and ru/en/zh i18n.
- Checks passed: backend tsc (local Prisma client refreshed), frontend production
  build (existing warnings), `frontend/scripts/check-sentence-audio.mjs`.
- `frontend/scripts/check-sentence-audio-ui.mjs`: Russian 390px WebKit and desktop
  Chromium pass layout/pinyin, controls/races/fallback, route/reload and review/quiz.
- Chromium played real Qwen MP3; identical Reader/word text had same clip/duration
  at 1×. Windows WebKit used controlled speech fallback; physical iOS not tested.
- Evidence: `.playwright-cli/sentence-audio`; throwaway local accounts removed.
- Next planned task: Part 5; Parts 5–6 remain open. Stop after Part 4.
- Local :3001 serves the verified production build using
  `.playwright-cli/compose.verified.yml`; default compose restores dev mode.
- Preserve unrelated modified `frontend/.env.example`, untracked `h3.txt`, `p.out`.
- Grouped-word proof still needs seven-day evidence (~2026-10-21 earliest).
- Landing remains deferred until explicitly requested. Workspace-only access.
