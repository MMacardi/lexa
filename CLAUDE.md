# Onomika — AI vocabulary app (monorepo)

Anki-style FSRS flashcards + Quizlet-style collections/quizzes + an AI tutor ("Coach":
chat, scenes, practice drill) + a Reader. Web app + Telegram bot (@onomikabot).
Graded university final project; the student is the sole author.

**Focus (decided 2026-09-22, see `STRATEGY.md`):** HSK prep for Russian speakers — a readiness
mark, then the official list + this week's textbook words turned into words you can *use*.
One exam first (HSK); IELTS only later. New work serves that loop; the rest of the app is
hidden behind a focus flag, not deleted (`onomika_old` holds the full build).

## Layout
- `backend/` Express + Prisma (Postgres) + TypeScript, ESM. Entry `src/index.ts`.
  - `src/routes/` HTTP (`words.ts` is the big one), `src/services/` logic,
    `src/agents/` LLM prompt pipelines, `src/lib/` env/auth/gate/rateLimit/pricing.
  - `src/bot/index.ts` Telegraf bot (runs in-process when `ENABLE_TELEGRAM_BOT=true`).
  - LLM = Qwen via Bailian only (`services/llm.ts`, OpenAI SDK). Never add other providers.
- `frontend/` Next.js 15 App Router, Tailwind 4, TanStack Query. `lib/api.ts` = the
  one typed API client; `lib/i18n.tsx` = en/ru/zh strings; pages in `app/`, UI in `components/`.

## Commands
- Everything local: `docker compose up -d` → app :3001, API :3000 (Postgres on host **5433**, not 5432).
- Backend type-check: `cd backend && npx tsc --noEmit -p .`
- Frontend build check: `cd frontend && npx next build`
- New migration: `cd backend && npx prisma migrate dev --name <name>`

## Rules
- Commits: plain messages, **no Co-Authored-By trailer**. Solo phase (until beta testers
  arrive): after a finished task, push to `main` (prod auto-deploys) without asking.
- Match surrounding code style and comment density; every new UI string goes in all 3 languages.
- Closed beta: every `/api` route needs a session + invite (`lib/gate.ts`); identity comes
  from the session cookie only, never from a body/query `telegramId`.

## Keep sessions cheap
- One task per session: take the **top unchecked item** of `BACKLOG.md` §Open — it is one ordered
  list and position is the priority, so don't shop around in it. Numbers move; name the item by
  **title** in the commit. Don't read `IDEAS.md` whole (34 KB); grep it for the item's heading.
- Grep first, then read only the needed line ranges. Skip `node_modules`, `.next`, `dist`,
  `package-lock.json`.
- Use an Explore subagent for broad "where is X" searches instead of reading many files.
- Don't WebFetch large doc pages; ask a narrow question or use WebSearch.
- Browser allowed without asking (granted 2026-09-23): `npx -y @playwright/cli@latest <cmd>` via
  Bash, run outside the repo. Use `find` or grep the saved snapshot instead of printing full
  snapshots. No Playwright MCP — it returns a ~3 KB snapshot per action.
- When a task is done: tick it in `BACKLOG.md` (and IDEAS.md status), then end the session.

## Finish by running it, not by type-checking it
`tsc` and `next build` passing is not evidence a feature works. For anything a learner touches,
complete the flow as a learner would — local Docker only, never prod (it holds real data, backups
are still item 1, and account delete is irreversible). For backend logic a throwaway
`backend/scripts/check-*.ts` that seeds a user and asserts the output is cheaper than a browser run
and survives as a regression guard; `check-account-delete.ts` is the pattern.

Why this is a rule: on 2026-09-23 two tasks shipped clean builds on top of a step that was broken
underneath — the gap deck hands an HSK 4 learner the alphabetical head of HSK 1 and ignores the
words they tapped. One real run would have caught what no amount of reading did.

## Docs
`BACKLOG.md` open work · `DEPLOY.md` Railway+Vercel · `BETA_CHECKLIST.md` launch prep ·
`IDEAS.md` full idea history · `UNIT_ECONOMICS.md` costs · `STRATEGY.md` positioning, market and
feature triage (why the backlog is ordered the way it is).
