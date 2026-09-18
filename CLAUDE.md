# Onomika — AI vocabulary app (monorepo)

Anki-style FSRS flashcards + Quizlet-style collections/quizzes + an AI tutor ("Coach":
chat, scenes, practice drill) + a Reader. Web app + Telegram bot (@onomikabot).
Graded university final project; the student is the sole author.

## Layout
- `backend/` Express + Prisma (Postgres) + TypeScript, ESM. Entry `src/index.ts`.
  - `src/routes/` HTTP (`words.ts` is the big one), `src/services/` logic,
    `src/agents/` LLM prompt pipelines, `src/lib/` env/auth/gate/rateLimit/pricing.
  - `src/bot/index.ts` Telegraf bot (runs in-process when `ENABLE_TELEGRAM_BOT=true`).
  - LLM = Qwen via Bailian only (`services/llm.ts`, OpenAI SDK). Never add other providers.
- `frontend/` Next.js 15 App Router, Tailwind 4, TanStack Query. `lib/api.ts` = the
  one typed API client; `lib/i18n.tsx` = en/ru/zh strings; pages in `app/`, UI in `components/`.
- `openclaw/` legacy Telegram gateway, NOT deployed (see DEPLOY.md).

## Commands
- Everything local: `docker compose up -d` → app :3001, API :3000 (Postgres on host **5433**, not 5432).
- Backend type-check: `cd backend && npx tsc --noEmit -p .`
- Frontend build check: `cd frontend && npx next build`
- New migration: `cd backend && npx prisma migrate dev --name <name>`

## Rules
- Commits: plain messages, **no Co-Authored-By trailer**. Don't push/merge without asking.
- Match surrounding code style and comment density; every new UI string goes in all 3 languages.
- Closed beta: every `/api` route needs a session + invite (`lib/gate.ts`); identity comes
  from the session cookie only, never from a body/query `telegramId`.

## Keep sessions cheap
- One task per session: pick it from `BACKLOG.md`. Don't read `IDEAS.md` whole (34 KB);
  grep it for the item's heading when you need details.
- Grep first, then read only the needed line ranges. Skip `node_modules`, `.next`, `dist`,
  `package-lock.json`.
- Use an Explore subagent for broad "where is X" searches instead of reading many files.
- Don't WebFetch large doc pages; ask a narrow question or use WebSearch.
- No browser automation (Playwright MCP disabled on purpose: too many tokens).
- When a task is done: tick it in `BACKLOG.md` (and IDEAS.md status), then end the session.

## Docs
`BACKLOG.md` open work · `DEPLOY.md` Railway+Vercel · `BETA_CHECKLIST.md` launch prep ·
`IDEAS.md` full idea history · `UNIT_ECONOMICS.md` costs.
