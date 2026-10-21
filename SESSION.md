# Session handoff — 2026-10-21

- Task: Part 14, Mika memory in popup/full page; complete.
- Files: backend services/mikaMemory.ts, coachMemory.ts, accountData.ts, vocab.ts;
  routes/words.ts, index.ts, Prisma schema + mika_memory_checkpoints migration;
  frontend useTutorChat, MikaMemoryLink, CoachMemorySection, Mika headers/i18n/API.
- Server checkpoints completed replies before final response; durable worker,
  idempotent hashes, batches ≤20, input ≤4k/statement, notes ≤900, ≤3 attempts.
- Manual revisions invalidate pending/in-flight writes; learner notes pinned.
  Delete/restore and hard deletion cannot resurrect memory or recreate a user.
  Per-account/source-language data, session-only identity and usage attribution.
- Memory controls linked in both surfaces, ru/en/zh. Fixed discarded Strict Mode
  chat ID in sessionStorage: one history across popup/page/reload.
- Checks: backend npx tsc --noEmit -p .; frontend npx next build passed (existing
  warnings). Docker frontend stopped for builds, restarted afterwards.
- Deterministic lifecycle: backend/scripts/check-mika-memory.ts passed on local
  throwaway accounts: retries, leases, concurrent edits/clear, isolation/deletion.
- Live Qwen: Russian train preference retained, new chat used train example;
  matching tab/request/server IDs across popup/page/reload. Notes now use native
  language. Phone controls rerun passed edit/clear/reload, A/B, spoofed IDs/401s.
- UI script: frontend/scripts/check-mika-memory.mjs; --controls-only isolates
  phone checks. Evidence .playwright-cli/mika-memory/, inspected phone-memory.png.
- Review: additive migration, cascade deletion, bounded inference and session
  identity. Test users cleaned. Raw long dev-name overflow recorded separately.
- Card HTTP check: check-mika-memory-card.ts passed live boat preference + zh
  checkpoint; card-context requests also carry the conversation ID.
- Next: Part 15 only; Parts 1–14 complete, 15–18 open. Live 到达 pinyin errors
  recorded in Part 15. Grouped-word retention evidence/landing remain deferred.
- Preserve unrelated frontend/.env.example and untracked h3.txt/p.out.
