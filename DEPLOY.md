# Deploying Onomika — Railway + Vercel

## What runs where

```
Browser ──► Vercel (Next.js frontend)
              │  /api/* is proxied server-side (next.config.ts rewrite)
              ▼
            Railway: backend (Express API + Telegram bot + import worker) ──► Railway: Postgres
              ▲
Telegram ─────┘  @onomikabot, long polling from inside the backend
```

- **Railway**: 2 services in one project, `backend` (root dir `backend/`) and `Postgres`.
- **Vercel**: 1 project, the Next.js app (root dir `frontend/`). Free Hobby plan.
- The **Telegram bot runs inside the backend** (`ENABLE_TELEGRAM_BOT=true`). It handles
  "Continue with Telegram" login, `/practice`, reminders and bug-report delivery.

### What it costs

Railway Hobby is **$5/month and includes $5 of usage**. Usage is billed per resource:
RAM $10/GB/month, CPU $20/vCPU/month, volumes $0.15/GB/month, egress $0.05/GB.
An idle Node backend (~150–250 MB) plus a small Postgres (~100 MB) usually comes to
about **$3–5/month**, so the included credit covers it for a small beta. Watch the
real number on Railway → **Usage** during the first week. You can set a hard spending
limit on the same page.

Vercel Hobby is free, but it is for **non-commercial use only**. Once Onomika takes real
payments, move the frontend to Vercel Pro.

---

## 0. Before you start

1. **Deploy from `main`.** Railway and Vercel build the production branch, which is
   `main`. Merge your working branch first (`social` → `main`) and push. Alternatively,
   set the production branch to your working branch in both dashboards.
2. **Collect the secrets** (the same values as your local `backend/.env`):
   - `BAILIAN_API_KEY`, `TAVILY_API_KEY`
   - `TELEGRAM_BOT_TOKEN` for **@onomikabot** (BotFather → `/mybots` → API Token)
   - a new `JWT_SECRET`:
     ```powershell
     node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
     ```
   - a `BETA_KEY` you will give to testers, e.g. `ONOMIKA-AUTUMN`
3. **Only one process may poll a bot token.** When the Railway bot is live, stop any
   local backend that has `ENABLE_TELEGRAM_BOT=true` with the same token, or create a
   second bot in BotFather for local development. If two processes poll one token,
   Telegram returns `409 Conflict` to one of them and bot login stops working.

## 1. Railway — Postgres + backend

1. railway.com → **New Project → Deploy from GitHub repo** → pick the repo.
2. Open the new service → **Settings**:
   - **Root Directory** = `backend`
   - Build and start commands are detected from `package.json`:
     `npm run build` (Prisma client + `tsc`) and `npm start`
     (`prisma migrate deploy`, then the server). Do not override them.
   - **Region**: choose the one closest to your testers. Southeast Asia (Singapore) is
     also the closest to Bailian's China endpoint.
   - **Healthcheck Path** = `/health`
   - Leave **Replicas = 1** and **Serverless (app sleeping) off**. Login tokens and
     rate limits live in memory, and the bot and import worker must run all the time.
3. In the project canvas: **New → Database → PostgreSQL**.
4. Backend service → **Variables → Raw Editor**, paste and fill in:
   ```env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   NODE_ENV=production
   JWT_SECRET=<random string from step 0>
   COOKIE_SECURE=true
   ALLOW_DEV_LOGIN=false

   BAILIAN_API_KEY=<key>
   BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
   TAVILY_API_KEY=<key>

   TELEGRAM_BOT_TOKEN=<@onomikabot token>
   ENABLE_TELEGRAM_BOT=true

   PRO_ALLOWLIST=<your Telegram id>
   ADMIN_TELEGRAM_IDS=<your Telegram id>
   BETA_KEY=<shared beta code>
   BETA_ALL_PRO=true

   # Fill these after step 2 (the Vercel URL, https, no trailing slash):
   CORS_ORIGIN=https://<your-project>.vercel.app
   FRONTEND_URL=https://<your-project>.vercel.app
   ```
   Optional: `SMTP_URL`, `EMAIL_FROM`, `FEEDBACK_EMAIL` (see [Email](#email)) and
   `GOOGLE_CLIENT_ID` (Google sign-in).
5. **Settings → Networking → Generate Domain**. Railway gives you something like
   `https://onomika-production.up.railway.app`. This is **BACKEND_URL**.
6. Deploy, then check it:
   - `https://<BACKEND_URL>/health` returns `{"status":"ok"}`
   - the deploy logs show `Telegram tutor bot started (long polling).`

## 2. Vercel — frontend

1. vercel.com → **Add New → Project** → import the repo.
   - **Root Directory** = `frontend` (framework preset: Next.js)
   - Project name = `onomika`. It becomes `https://onomika-<something>.vercel.app`.
     You can pick a nicer free alias later in **Settings → Domains**.
2. **Environment Variables** (Production):

   | Name | Value | Notes |
   |---|---|---|
   | `BACKEND_URL` | `https://<BACKEND_URL>` | Server-side only. `/api/*` is proxied here. |
   | `NEXT_PUBLIC_BOT_USERNAME` | `onomikabot` | No `@`. Must be the bot whose token the backend uses. |
   | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | *(optional)* | Leave it out to hide Google sign-in. |
   | `NEXT_PUBLIC_API_URL` | **do not add it** | Must stay unset in prod, see below. |

   Why `NEXT_PUBLIC_API_URL` must stay unset: when it is empty, the browser calls
   `/api/...` on the Vercel domain and Vercel forwards the call to Railway. The session
   and beta cookies then belong to the Vercel domain (first-party). If you point the
   browser straight at Railway, the cookies become cross-site. Safari, and more and more
   other browsers, silently drop cross-site cookies, and users can't stay logged in.
3. Deploy. Copy the production URL. This is **FRONTEND_URL**.

`BACKEND_URL` and every `NEXT_PUBLIC_*` variable are **baked in at build time**. After
you change one, redeploy (Deployments → ⋯ → Redeploy).

## 3. Connect the two

On Railway, set `CORS_ORIGIN` and `FRONTEND_URL` to the exact FRONTEND_URL (https, no
trailing slash), then deploy the staged change. The backend needs both:

- `CORS_ORIGIN`: Vercel forwards the browser's `Origin` header, and the backend rejects
  an origin that is not on its allowlist.
- `FRONTEND_URL`: used to build the links in magic-link emails.

If you add a custom domain later, add it to `CORS_ORIGIN` as a comma-separated list.

## 4. Smoke test (about 5 minutes)

1. `BACKEND_URL/health` returns `ok`.
2. Open FRONTEND_URL → **Start** → enter the `BETA_KEY` → **Continue with Telegram** →
   the bot opens → confirm → you are back in the app and logged in.
3. Reload the page. You should still be logged in. Also try once on an iPhone in Safari.
4. Add a word. The card fills in, which confirms the Bailian key works.
5. Start a Coach scene. The reply should appear word by word. That means streaming
   works through the Vercel proxy.
6. Open `/admin`. The stats load because you are on `ADMIN_TELEGRAM_IDS`.
7. Send yourself a bug report with the in-app button. It arrives in Telegram, or by
   email if SMTP is configured.

## 5. Inviting testers

There are two ways in, and you can use both at the same time.

**A. Shared beta code (the easy way).** Send testers the site link and the `BETA_KEY`.
Their flow: landing → Start → type the code → sign in (Telegram / email / Google).
Their account is marked `invited` at that login. Anyone who has the code can join, so
change `BETA_KEY` if it leaks. Accounts that already joined stay invited.

**B. Personal single-use codes (you control each seat).** Generate them against the
Railway database from your PC. Postgres service → **Variables** → copy
`DATABASE_PUBLIC_URL`, then:

```powershell
cd backend
$env:DATABASE_URL = "<DATABASE_PUBLIC_URL>"
node scripts/generate-invites.mjs 10 "wave 1"
Remove-Item Env:DATABASE_URL
```

It prints codes like `ONM-7KQ2-XH9D`. Each code works once. The tester's flow: landing →
Start → **"I have a personal invite code"** → sign in → the app asks for the code.

You (`PRO_ALLOWLIST`) never need a code. During the beta every invited user is Pro
(`BETA_ALL_PRO=true`). `/admin` shows how many codes have been used.

## Day-to-day

- **Deploying**: push to `main`. Railway and Vercel both redeploy. Database migrations
  run automatically on backend start (`prisma migrate deploy`).
- **Logs**: Railway → backend → Deployments → View logs. Vercel → Logs (kept for 1 hour
  on Hobby).
- **Backups**: take one before inviting people. Use the Postgres service **Backups** tab
  if your plan has it; otherwise run
  `pg_dump "<DATABASE_PUBLIC_URL>" -Fc -f onomika.dump` from your PC.
- **AI spend**: see `/admin` (token cost per model and feature). Also set a billing alert
  in Bailian. Rate limits: 40 AI calls/min per user.

## Error monitoring and uptime (do this before the beta)

Both are off until you set them up, and both are free at beta size.

1. **Sentry.** Create a free account at sentry.io and two projects: *Node* (backend) and
   *Browser JavaScript* (frontend). Each gives you a DSN (a URL). Then:
   - Railway → backend → Variables: `SENTRY_DSN=<Node project DSN>`.
   - Vercel → Settings → Environment Variables: `NEXT_PUBLIC_SENTRY_DSN=<Browser project DSN>`,
     then **redeploy** (it is baked in at build time, like every `NEXT_PUBLIC_*`).
   Never commit either DSN. Unset = no SDK loaded and nothing sent. What gets reported:
   uncaught errors plus everything logged with `console.error` — most routes catch their own
   errors and log them, so that is where the real crashes show up. No tracing, no IPs.
   Check it works: Sentry shows the first event within a minute of any failing request.
2. **Uptime.** A free monitor (UptimeRobot or Better Stack) on
   `https://<your-backend>.up.railway.app/health`, every 5 minutes, alerting your email or
   Telegram. `/health` answers without a session, so the gate doesn't get in the way.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Login works, then a reload logs you out (worst in Safari) | `NEXT_PUBLIC_API_URL` is set on Vercel. Delete it and redeploy. Also check `COOKIE_SECURE=true`. |
| Every `/api` call fails; Railway logs say `CORS blocked for origin` | `CORS_ORIGIN` doesn't exactly match the site URL (https, no trailing slash). |
| Backend crashes on boot: `JWT_SECRET must be set` | `NODE_ENV=production` with no `JWT_SECRET`. Set it. |
| "Continue with Telegram" never confirms | `ENABLE_TELEGRAM_BOT` isn't `true`, another process polls the same token (look for `409 Conflict`), or `NEXT_PUBLIC_BOT_USERNAME` names a different bot. |
| Railway build fails with a Prisma `libssl` / `openssl` error | Add the variable `RAILPACK_DEPLOY_APT_PACKAGES=openssl` and redeploy. |
| Frontend calls go to `localhost:3000` in prod | `BACKEND_URL` was missing at build time. Set it and redeploy. |
| Coach replies arrive in one piece instead of streaming | The proxy is buffering. Proxied calls also time out after 120 s without a first byte. |
| Testers in mainland China can't open the site | `*.vercel.app` is often blocked there. Attach a custom domain on Vercel. |

## Email

Magic-link sign-in and emailed bug reports go through `nodemailer`
(`backend/src/services/mailer.ts`). No code change is needed, only these variables:

- `SMTP_URL`: `smtp://user:pass@host:port` for any SMTP provider (Resend, Postmark,
  Yandex, QQ, …). **If it is empty, no mail is sent.** The message is only written to
  the backend log, so email sign-in does not work in prod.
- `EMAIL_FROM`: e.g. `Onomika <no-reply@yourdomain>`. Use a domain you control; some
  providers reject a mismatched sender.
- `FEEDBACK_EMAIL`: the inbox for in-app bug reports. When empty, reports go to Telegram
  (`FEEDBACK_TELEGRAM_CHAT`, otherwise the first id in `PRO_ALLOWLIST`).

Until SMTP is set, testers should sign in with Telegram (or Google). Never enable
`ALLOW_DEV_LOGIN` in prod: it lets anyone sign in as anyone, and it returns email login
links in API responses.

---

## Local development

```bash
# From the repo root: Postgres + backend + frontend
docker compose up -d
# App:     http://localhost:3001
# Backend: http://localhost:3000/health

# If 3001 is busy:
FRONTEND_PORT=3010 docker compose up -d

docker compose down
```

Local secrets live in `backend/.env` (git-ignored). Compose overrides `DATABASE_URL` to use
its own Postgres container (host port 5433), and it enables `ALLOW_DEV_LOGIN` for local
sign-in. Locally, the frontend calls the backend directly through `NEXT_PUBLIC_API_URL`.
