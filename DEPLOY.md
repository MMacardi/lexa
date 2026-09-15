# Deployment Guide — Onomika Vocabulary Assistant

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
   - `NEXT_PUBLIC_TELEGRAM_ID` = `123456789` (your Telegram id)
3. Deploy → public site URL.

## 3. OpenClaw (Railway, Docker)
1. In the same Railway project: **New → GitHub repo → this repo**, Root Directory = `openclaw`
   (Railway auto-detects the `Dockerfile`).
2. **Variables**:
   - `TELEGRAM_BOT_TOKEN` = the bot token (the bot used for OpenClaw)
   - `BAILIAN_API_KEY` = your Qwen/Bailian key (OpenClaw agent LLM)
   - `VOCAB_API_URL` = `BACKEND_URL`
   - `TELEGRAM_ALLOW_FROM` = `123456789` (comma-separate to allow more users)
3. Add a **Volume** mounted at `/root/.openclaw` (persists config/sessions).
4. Deploy. The entrypoint injects the token + Qwen key, writes the allow-list, and
   runs `openclaw gateway` (Telegram long polling — no inbound port needed).
5. Only one process may poll a given bot token at a time, so **stop any local
   `openclaw gateway`** once the cloud one is live.

---

## Render alternative
If you want to move the backend and OpenClaw off Railway, use Render like this:

### Backend on Render Web Service
1. Create a new **Web Service** from this GitHub repo.
2. Set **Root Directory = `backend`**.
3. Use these commands:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
4. Add a **Render PostgreSQL** database and set `DATABASE_URL` from the database connection string.
5. Add environment variables:
   - `BAILIAN_API_KEY`
   - `BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`
   - `TAVILY_API_KEY`
   - `JWT_SECRET`
   - `ALLOW_DEV_LOGIN=false`
   - `COOKIE_SECURE=true`
   - `CORS_ORIGIN=https://<your-vercel-app>.vercel.app`
   - `PORT` is provided by Render automatically
6. After deploy, copy the public backend URL and set the frontend `NEXT_PUBLIC_API_URL` to it in Vercel.

If you use a custom Vercel domain or preview URL, add it to `CORS_ORIGIN` as a comma-separated list. The backend must answer with an exact origin match when `credentials: include` is used on the frontend.

### OpenClaw on Render Background Worker
1. Create a new **Background Worker** from the same repo.
2. Set **Root Directory = `openclaw`**.
3. Render can build from the `Dockerfile` in that folder.
4. Add environment variables:
   - `TELEGRAM_BOT_TOKEN`
   - `BAILIAN_API_KEY`
   - `VOCAB_API_URL` = your Render backend URL
   - `TELEGRAM_ALLOW_FROM` = `123456789` or a comma-separated allow-list
5. Add a persistent disk mounted at `/root/.openclaw` so OpenClaw keeps its config.
6. Keep only one OpenClaw instance running per bot token, or Telegram polling will conflict.

Render is a good fit for the backend + worker pair; Vercel can stay on the frontend.

---

## Making email arrive

Transactional mail (magic-link sign-in + the in-app bug-report form) is already
wired through `nodemailer` in `backend/src/services/mailer.ts` and
`backend/src/services/feedback.ts` — **no code change is needed**, only env vars.

- `SMTP_URL` — `smtp://user:pass@host:port` of any SMTP provider (Yandex, QQ,
  163, Resend, Postmark, …). **If empty, mail is not sent: the message is only
  written to the backend log** (handy in dev, useless in prod). Set it for the beta.
- `EMAIL_FROM` — the `From:` header, e.g. `Onomika <no-reply@yourdomain>`. Use a
  real domain you control once you have one; some providers reject a mismatched sender.
- `FEEDBACK_EMAIL` — inbox that receives the in-app bug reports. If empty, feedback
  falls back to Telegram (`FEEDBACK_TELEGRAM_CHAT`, else the first id in `PRO_ALLOWLIST`).

Dev behaviour: with `SMTP_URL` empty the magic-link email is logged, not sent. The
sign-in link is only surfaced to the client when `ALLOW_DEV_LOGIN=true` (the
`devLink` field) — keep that **off in prod** (it would leak login links).

Smoke test: set the four vars, restart the backend, request an email login and
confirm the message lands; then submit the in-app bug form and confirm it reaches
`FEEDBACK_EMAIL` (or the Telegram fallback).

## Closed beta & admin env

Two access layers ship together (see `BETA_CHECKLIST.md`):

- `BETA_KEY` — ONE shared code a guest types **before** logging in
  (`POST /api/beta/unlock`, sets a signed `beta` cookie; the next login flips the
  user to `invited`). Constant-time compare, rate-limited. **Leave empty to disable
  the shared-code gate** (single-use `InviteCode`s still work). Case-insensitive.
- `ADMIN_TELEGRAM_IDS` — comma-separated Telegram ids allowed to open `/admin` and
  `GET /api/admin/stats` (usage + token/cost dashboard). **Falls back to
  `PRO_ALLOWLIST`** when empty, so the owner is never locked out. Non-admins get a
  403 (`code: forbidden`) and the `/admin` page renders a 404.

Token spend is recorded per LLM call in the `TokenUsage` table (migration
`20260915120000_token_usage`, applied automatically by `prisma migrate deploy` on
boot). Prices live in `backend/src/lib/pricing.ts` (¥ per 1M tokens) — verify them
against the Bailian price page; ASR (`qwen3-asr-flash`) is billed per audio-second,
not tokens, so it's priced ¥0 there for now.

---

## Local development
```bash
# From repo root: start Postgres + backend + frontend
docker compose up -d

# Open app at http://localhost:3001
# Backend health: http://localhost:3000/health

# If 3001 is busy on your machine, choose another host port:
# FRONTEND_PORT=3010 docker compose up -d

# Optional: also start OpenClaw (Telegram gateway)
docker compose --profile bot up -d

# Stop everything
docker compose down
```
Local secrets live in `backend/.env` (git-ignored). The root compose file reads
that file for backend and OpenClaw and overrides `DATABASE_URL` internally to
use the Docker Postgres service.
