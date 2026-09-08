# Closed-beta launch checklist

What to prepare before inviting testers. Grouped by priority.

## 🔴 Must-do before any external user

### Security / config (prod env)
- [ ] `ALLOW_DEV_LOGIN` **unset or `false`** on Railway (default is now `false`; never `true` in prod — it lets anyone log in as anyone and leaks email login links).
- [ ] `COOKIE_SECURE=true` (cross-site cookies Vercel → Railway need Secure + SameSite=None).
- [ ] `JWT_SECRET` = long random string (not the dev default). Rotating it logs everyone out.
- [ ] `CORS_ORIGIN` / `FRONTEND_URL` = the real Vercel URL (no localhost).
- [ ] Secrets set as env vars, never committed: `BAILIAN_API_KEY`, `TAVILY_API_KEY`, `TELEGRAM_BOT_TOKEN`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `SMTP_URL`.
- [ ] Confirm only **one** process polls the Telegram token (the tutor bot vs OpenClaw) — two pollers fight.

### Auth delivery
- [ ] **Email login**: set `SMTP_URL` + `EMAIL_FROM` (e.g. Resend/Postmark), or email sign-in won't deliver in prod. Send a test link.
- [ ] **Google login** (optional): create an OAuth client, authorise the Vercel origin, set `GOOGLE_CLIENT_ID` (backend) + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Vercel).
- [ ] **Telegram login**: `NEXT_PUBLIC_BOT_USERNAME` = the bot that runs the backend (`llmlangcardlearnerbot`); the bot must be running with `ENABLE_TELEGRAM_BOT=true`.

### Legal (pages exist at /privacy and /terms — fill the placeholders)
- [ ] Replace every `[ЗАПОЛНИТЬ: …]` in `/privacy` and `/terms` (operator name, contact email, jurisdiction, min age).
- [ ] Have a real contact email for data-deletion / takedown requests.
- [ ] Decide operator identity (individual vs company) — affects the docs.
- [ ] (If EU/RU users) confirm the privacy basics fit GDPR / 152-ФЗ: purpose, processors, deletion, rights — the template covers these; a lawyer review is recommended for a public launch.

### Data safety
- [ ] Enable **database backups** on Railway (Postgres). Take one before the beta.
- [ ] Know how to delete a user on request (account delete cascades words/texts/identities).

## 🟠 Strongly recommended

- [ ] **Error monitoring** (Sentry or similar) on backend + frontend, so you see crashes testers hit.
- [ ] Basic **uptime check** on `/health`.
- [ ] A **feedback channel** (a Telegram chat / form) linked in the app for testers.
- [ ] Watch **AI spend**: rate limits are in place (40 AI calls/min per user; email 5/10min), but set a billing alert on Bailian/Tavily. See `UNIT_ECONOMICS.md`.
- [ ] Seed / demo content so a new account isn't empty (a sample deck).
- [ ] Test the full new-user flow on a phone: sign in → add word → review → reader → bot.

## 🟡 Nice to have

- [ ] Account **data export** (JSON) and one-click **delete account** in the UI (currently by request).
- [ ] Merge duplicate accounts (if someone made separate Telegram + email before linking).
- [ ] Cookie/consent banner (only the session cookie is used, so a short notice suffices in most regions).
- [ ] Analytics (privacy-friendly, e.g. Plausible) to see what testers use.
- [ ] A simple landing/marketing page for the invite.

## Already done (no action needed)
- IDOR protection on all per-item routes; rate limiting on auth + AI endpoints.
- Passwordless auth (Telegram / Google / email), multi-method account linking.
- Timing-safe Telegram HMAC; `javascript:` links blocked; CORS allowlist.
- Secure-by-default dev login (off unless explicitly enabled).
