# Closed-beta launch checklist

What to prepare before inviting testers. Grouped by priority.

## 🔴 Must-do before any external user

### Security / config (prod env)
- [ ] `ALLOW_DEV_LOGIN` **unset or `false`** on Railway (default is now `false`; never `true` in prod — it lets anyone log in as anyone and leaks email login links).
- [ ] `COOKIE_SECURE=true` (cookies are sent `Secure` + `SameSite=None`; required whenever frontend and backend are on different origins).
- [ ] **Same-origin `/api` proxy (recommended on Vercel)** — set `BACKEND_URL` = the Railway URL and leave `NEXT_PUBLIC_API_URL` **empty**. The browser then calls `/api/*` on the Vercel domain and Next proxies it to Railway (`next.config.ts`), so the session/beta cookies are **first-party**. Without this, a split Vercel↔Railway call makes the cookie cross-site and Safari (ITP) silently drops it — users can't stay logged in. See `DEPLOY.md` §2.
- [ ] `JWT_SECRET` = long random string (not the dev default). Rotating it logs everyone out.
- [ ] **Mint invite codes** (if you hand out personal codes): from `backend/`, point `DATABASE_URL` at Railway's `DATABASE_PUBLIC_URL` and run `node scripts/generate-invites.mjs 10 "beta wave 1"`. It prints single-use `ONM-XXXX-XXXX` codes; see `DEPLOY.md` §5. Locally: `docker exec onomika-backend node scripts/generate-invites.mjs 10`. The whole app is gated behind an invite (shared `BETA_KEY` or a code); existing users are grandfathered by the migration and `PRO_ALLOWLIST` accounts always pass.
- [ ] **`BETA_KEY`** — set ONE code guests type *before* logging in (`POST /api/beta/unlock` → signed `beta` cookie → next login flips `invited`). Set it even if you mostly use single-use codes: the landing always shows the beta-code screen, and with it empty, testers can only get past it through the small "I have a personal invite code" link.
- [ ] **`ADMIN_TELEGRAM_IDS`** = your Telegram id so `/admin` + `GET /api/admin/stats` (usage + token/cost dashboard) open for you. Falls back to `PRO_ALLOWLIST` if unset; everyone else gets 403 / a 404 page.
- [ ] `CORS_ORIGIN` / `FRONTEND_URL` = the real Vercel URL (no localhost).
- [ ] Secrets set as env vars, never committed: `BAILIAN_API_KEY`, `TAVILY_API_KEY`, `TELEGRAM_BOT_TOKEN`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `SMTP_URL`.
- [ ] Confirm only **one** process polls the Telegram token (prod backend vs your local backend) — two pollers fight (`409 Conflict`).

### Auth delivery
- [ ] **Email login**: set `SMTP_URL` + `EMAIL_FROM` (e.g. Resend/Postmark), or email sign-in won't deliver in prod. Send a test link.
- [ ] **Google login** (optional): create an OAuth client, authorise the Vercel origin, set `GOOGLE_CLIENT_ID` (backend) + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Vercel).
- [ ] **Telegram login**: `NEXT_PUBLIC_BOT_USERNAME` = the bot that runs the backend (`onomikabot`); the backend must run with `ENABLE_TELEGRAM_BOT=true`, and no other process may poll the same token (your local backend included).

### Legal (pages exist at /privacy and /terms — fill the placeholders)
- [ ] Replace every `[ЗАПОЛНИТЬ: …]` in `/privacy` and `/terms` (operator name, contact email, jurisdiction, min age).
- [ ] Have a real contact email for data-deletion / takedown requests.
- [ ] Decide operator identity (individual vs company) — affects the docs.
- [ ] (If EU/RU users) confirm the privacy basics fit GDPR / 152-ФЗ: purpose, processors, deletion, rights — the template covers these; a lawyer review is recommended for a public launch.

### Data safety
- [ ] Enable **database backups** on Railway (Postgres), or `pg_dump` via `DATABASE_PUBLIC_URL`. Take one before the beta.
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
- **Closed-beta invite gate** — every non-auth `/api` route requires a verified session (`requireIdentity`) and a redeemed invite (`requireInvited`); single-use codes, race-safe atomic claim, `PRO_ALLOWLIST` never locked out, existing users grandfathered.
- **Session-only identity** — `callerId`/`callerKey` trust the session cookie alone (no body/query `telegramId`), closing the impersonation + rate-limit-bucket-rotation holes; prod boot fails closed on the dev `JWT_SECRET`.
- **Shared `BETA_KEY` pre-login gate** — a guest can enter one shared code (`BetaGate`, before login) to unlock the app; on the next login the user is auto-flagged `invited`. Coexists with single-use `InviteCode`s (post-login `InviteGate`): the gate has a "personal code" link that skips the shared code so one-off-code testers still reach the single-use redeem. Constant-time compare + rate-limited; disabled when `BETA_KEY` is empty.
- **Owner admin dashboard** — `/admin` (frontend) + `GET /api/admin/stats` (backend, `requireAdmin` via `ADMIN_TELEGRAM_IDS`→`PRO_ALLOWLIST` fallback): users/signups, content + engagement counts, invites, and **per-call LLM token & ¥ cost** by model/feature/day. Every LLM call (text, OCR, ASR) is logged fire-and-forget to the `TokenUsage` table; prices in `backend/src/lib/pricing.ts` (verify against Bailian).
