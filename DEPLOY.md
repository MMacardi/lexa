# Deployment Guide — Lexa Vocabulary Assistant

## Architecture
```
Telegram ──► OpenClaw gateway (Railway, Docker) ──┐
                                                  ├─► Backend REST API (Railway) ──► PostgreSQL (Railway)
Web app (Vercel, Next.js) ────────────────────────┘
```
- **Backend + PostgreSQL** → Railway
- **Frontend** → Vercel
- **OpenClaw** (Telegram entry point) → Railway (Docker), always-on

---

## 1. Backend + PostgreSQL (Railway)
1. New Project → **Deploy from GitHub repo** → pick this repo.
2. Service **Settings → Root Directory = `backend`**.
3. Add a **PostgreSQL** database (New → Database → PostgreSQL).
4. Backend service **Variables**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `BAILIAN_API_KEY` = your Qwen/Bailian key
   - `BAILIAN_BASE_URL` = `https://dashscope.aliyuncs.com/compatible-mode/v1`
   - `TAVILY_API_KEY` = your Tavily key
   - (`PORT` is provided by Railway automatically)
5. Deploy. `npm run build` generates the Prisma client + compiles; `npm start` runs
   `prisma migrate deploy` then the server. Health check: `GET /<url>/health`.
6. Copy the public URL → call it **BACKEND_URL**.

## 2. Frontend (Vercel)
1. New Project → import this repo → **Root Directory = `frontend`** (framework: Next.js).
2. **Environment Variables**:
   - `NEXT_PUBLIC_API_URL` = `BACKEND_URL`
   - `NEXT_PUBLIC_TELEGRAM_ID` = `865277762` (your Telegram id)
3. Deploy → public site URL.

## 3. OpenClaw (Railway, Docker)
1. In the same Railway project: **New → GitHub repo → this repo**, Root Directory = `openclaw`
   (Railway auto-detects the `Dockerfile`).
2. **Variables**:
   - `TELEGRAM_BOT_TOKEN` = the bot token (the bot used for OpenClaw)
   - `BAILIAN_API_KEY` = your Qwen/Bailian key (OpenClaw agent LLM)
   - `VOCAB_API_URL` = `BACKEND_URL`
   - `TELEGRAM_ALLOW_FROM` = `865277762` (comma-separate to allow more users)
3. Add a **Volume** mounted at `/root/.openclaw` (persists config/sessions).
4. Deploy. The entrypoint injects the token + Qwen key, writes the allow-list, and
   runs `openclaw gateway` (Telegram long polling — no inbound port needed).
5. Only one process may poll a given bot token at a time, so **stop any local
   `openclaw gateway`** once the cloud one is live.

---

## Local development
```bash
# backend
cd backend && docker compose up -d && npm install && npm run dev   # :3000
# frontend
cd frontend && npm install && npm run dev -- -p 3001               # :3001
```
Secrets live in `backend/.env` and `frontend/.env.local` (git-ignored; see the
`.env.example` files).
