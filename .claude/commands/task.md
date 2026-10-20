---
description: Complete one focused task and update the handoff
argument-hint: item title (or resume SESSION.md)
---

Work on **$ARGUMENTS** under `AGENTS.md`. Explicit user task first; otherwise resume
`SESSION.md`, then take the first incomplete `BACKLOG.md` Open item in order.

1. Search headings, then read only the item and relevant plan section. Search
   `IDEAS.md`/`STRATEGY.md` if intent is unclear; never load them whole.
2. Implement within scope. Record unrelated findings in backlog/ideas. Ask for
   unresolved decisions; leave time/data-gated work open and ask before skipping.
   Russian first, all new UI strings in ru/en/zh; hide out-of-focus features.
3. Code: backend `npx tsc --noEmit -p .`, frontend `npx next build`.
   Explain migrations before running backend `npx prisma migrate dev --name <name>`
   against local Docker. Review schema/learner-model persistence before pushing;
   for the former F2/F3 changes, run `/code-review` in Claude or equivalent review.
4. Verify changed learner flows locally, Russian phone UI first where relevant.
   Never test production data. Useful commands/patterns:
   - `backend/scripts/check-*.ts`: meaningful behavior checks with a throwaway local
     user; clean it up. `check-account-delete.ts` is the pattern.
   - `node frontend/scripts/phone-audit.mjs <out>`: phone pages in WebKit/Chromium/Firefox.
   - Chat prompts: `backend/scripts/check-chat-identity.ts` (Mika never names the model)
     and `backend/scripts/check-chat-format.ts`.
   - Browser is authorized locally; prefer project-local tools. If needed,
     `npx -y @playwright/cli@latest <cmd>` runs inside the workspace, with profiles
     and artifacts here. Search saved snapshots; avoid full dumps and Playwright
     MCP's large per-action snapshots where smaller output works.
   - Docs-only: diff/reference/consistency checks, no app builds.
5. Update relevant backlog/idea status and the short `SESSION.md`. Preserve unrelated
   dirty files, stage explicitly, commit by title without Co-Authored-By, push finished
   verified work to `main`, then stop. Save remaining steps/checks before interrupting.

Why runtime verification matters: on 2026-09-23 the gap deck passed builds while
ignoring selected words and giving an HSK 4 learner the start of HSK 1.
