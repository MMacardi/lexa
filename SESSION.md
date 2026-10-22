# Session handoff — 2026-10-22

- Task: recorded requested idiom-card format in BACKLOG Parked; docs only.
- Format: short figurative meaning, then a native/target-language equivalent if
  the same sense/register fits; otherwise no equivalent. No implementation requested.
- Checks: docs diff/references/consistency; no app builds needed for this follow-up.
- Previous fix: false translation highlight «боль» → «больнице», verified.
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
- Updated existing parked idiom task at user's request; resume only when asked.
  Example: «усугублять чужую боль или переживания; аналог: сыпать соль на рану».
- Mika source-backed grammar remains separately parked (BACKLOG); no work on it.
  EVAL-tutor-reliability-followup.md; rollback: BAILIAN_TUTOR_REVIEW_MODEL=off.
- Preserved unrelated frontend/.env.example, h3.txt, p.out.
- Prior character recovery/handwriting work remains committed and verified.
- Local backend bot remains disabled via capture-input/compose-check.yml.
