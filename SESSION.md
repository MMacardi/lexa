# Session handoff — 2026-10-22

- Task: fixed false translation highlight «боль» → «больнице»; verified.
- Files: frontend/components/GlossText.tsx; scripts/check-gloss-highlight.mjs.
- Short Russian stems require a matching inflected stem; боль/боли/болью still mark.
- Passed frontend next build (existing warnings), Russian Chromium iPhone 13
  against local production build: reported long definition, hospital unmarked,
  pain inflections marked, no overflow/page errors. Throwaway account deleted.
- Reproduce: node frontend/scripts/check-gloss-highlight.mjs (local :3000/:3001).
- Screenshot/result: ignored .playwright-cli/gloss-highlight/.
- Backend tsc passed before the experiment; final backend code unchanged.
- 伤口上撒盐 is absent from connected CC-CEDICT. One real Qwen test of a generic
  equivalent-first instruction gave the wrong idiom «добавлять масла в огонь».
- Reverted the instruction and removed experiment script. Existing card unchanged.
- Parked lexical idiom fallback in BACKLOG at user's token-budget request;
  resume only when asked. Suggested card wording: «сыпать соль на рану».
- Mika source-backed grammar remains separately parked (BACKLOG); no work on it.
  EVAL-tutor-reliability-followup.md; rollback: BAILIAN_TUTOR_REVIEW_MODEL=off.
- Preserved unrelated frontend/.env.example, h3.txt, p.out.
- Prior character recovery/handwriting work remains committed and verified.
- Local backend bot remains disabled via capture-input/compose-check.yml.
