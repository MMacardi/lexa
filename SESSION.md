# Session handoff — 2026-10-22

- Task: independently audit/improve Mika reliability; partial mitigation implemented
  and locally verified. General grammar reliability remains unresolved.
- Starting main: 7a46f62; its Russian teaching guard is unchanged.
- zh→ru text: hidden qwen-plus draft → pinned qwen3.8-max-0902 review → existing
  bounded format repair. No unchecked-draft fallback; cancel stops between stages.
- Reviewer cannot expand word offers or rewrite Reader passage metadata.
  Photos/other language pairs keep their prior path. Shared web/Telegram service.
- Files: services/tutorChat.ts, tutorReview.ts, llm.ts; lib/pricing.ts;
  scripts/eval-tutor-app.ts, tutor-reliability-cases.ts, check-tutor-review.ts.
  scripts/tutor-review-compact.ts is a rejected experimental control only.
- Report: EVAL-tutor-reliability-followup.md; original report linked; BACKLOG Done
  updated. Manual verdict/explanation grading, timings/costs and limits included.
- 14 scenarios: 4 rubric passes, 9 misleading explanations, 1 delivery error.
  Baseline: 1 pass, 3 warnings, 1 wrong judgment, 9 delivery errors. Small sample.
- Actual local phone/browser: seeded 进行 error corrected, false objection resisted,
  vocabulary in Russian; streamed/final/saved history, Reader/profile checked.
  Throwaway user deleted. No production learner data or live Telegram access.
- Passed backend/script type-checks, check-tutor-review, check-mika-format,
  frontend production build (existing warnings), local browser behavior check.
- Evidence local/ignored: .playwright-cli/mika-reliability/*.json and
  .playwright-cli/mika-reliability-phone/result.json. Reproduction in report.
- Rollback: BAILIAN_TUTOR_REVIEW_MODEL=off, restart; Russian fix remains.
- Remaining: source-backed grammar references with explicit coverage and fresh
  human-graded cases. No other backlog/landing work authorized in this session.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
