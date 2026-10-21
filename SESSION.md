# Session handoff — 2026-10-21

- Task: test Mika's contradictory Chinese grammar explanations; evaluation complete.
- backend/scripts/eval-tutor-reliability.ts captures the actual tutor system prompt
  through a loopback stub, then sends only synthetic exercises to Bailian directly.
- DB is isolated to an unused loopback port; no user creation or production data access.
- 73 live calls: 60 replies across qwen-plus/qwen3.5-plus × current/careful prompts,
  six replies per reasoning budget (1024/4096), plus one smoke call.
- Current qwen-plus and qwen3.5-plus can reverse correct 进行交流 answers under pressure.
- The careful paragraph helps some turns but can also preserve a seeded false answer;
  both models invent rules. More reasoning does not eliminate these failures.
- Two main first responses were JSON numbers rather than objects; app repair was
  intentionally excluded. This is a diagnosis, not an end-to-end error-rate benchmark.
- No production model, prompt, app behavior, learner UI or schema was changed.
- EVAL-tutor-reliability.md records method, manual rubric review, sources,
  timings and limitations. Raw synthetic evidence: .playwright-cli/mika-reliability/.
- Checks: backend npx tsc --noEmit -p .; separate strict script type-check; frontend
  npx next build passed (existing warnings). No UI changes; browser pass unnecessary.
- BACKLOG.md Done records the evaluation; the reliability issue is still unresolved.
- Follow-up would compare a stronger candidate on these failure types and unseen
  cases, then verify the chosen configuration through app repair/streaming.
- No tested variant is recommended for deployment on this evidence alone.
- Previous Reader source fix c28be5d is complete and pushed; unrelated work preserved.
- Part 18 remains open. Retention and landing work remain deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
