import "dotenv/config";
import { z } from "zod";

// Validate environment once, at startup. API keys default to "" so the server
// still boots before they're filled in; the services that need them throw a
// clear error at call time instead of crashing the whole process here.
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().default(""),
  BAILIAN_API_KEY: z.string().default(""),
  BAILIAN_BASE_URL: z.string().url(),
  TAVILY_API_KEY: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  // "true" starts the in-process Telegram tutor bot (long polling). Keep it off
  // when another process (e.g. OpenClaw) already polls the same bot token.
  // Reminders are per-user opt-in (via /remind), so no extra flag is needed.
  ENABLE_TELEGRAM_BOT: z.string().default("false"),
  // Auth / sessions
  JWT_SECRET: z.string().default("dev-insecure-secret-change-me"),
  // Secure by default: dev sign-in (and the email dev-link leak) are OFF unless a
  // trusted environment (local docker-compose) explicitly opts in. Never "true" in prod.
  ALLOW_DEV_LOGIN: z.string().default("false"), // "true" enables /api/auth/dev
  COOKIE_SECURE: z.string().default("false"), // "true" in production (cross-site cookies)
  // Public URL of the frontend, used to build email magic-links.
  FRONTEND_URL: z.string().default("http://localhost:3001"),
  // Google Sign-In: the OAuth client id the frontend uses; verified as the ID
  // token's audience server-side.
  GOOGLE_CLIENT_ID: z.string().default(""),
  // Email magic-link delivery: a nodemailer SMTP URL (smtp://user:pass@host:port)
  // and the From address. When SMTP_URL is empty we log the link instead of
  // sending (dev), and expose it in the API response only if ALLOW_DEV_LOGIN.
  SMTP_URL: z.string().default(""),
  EMAIL_FROM: z.string().default("Lexa <no-reply@lexa.app>"),
  // Billing / entitlements. During the closed beta every signed-in user is Pro
  // (the invite link is the gate), so nobody hits the wall. Flip to "false" at
  // public launch — new users default to "free" and get FREE_DAILY_AI AI actions
  // a day; comp your beta friends by setting their User.plan = "pro".
  BETA_ALL_PRO: z.string().default("true"),
  FREE_DAILY_AI: z.coerce.number().default(25), // free-tier AI actions per day
  // Comma-separated telegramIds that are always Pro (owner / comped friends),
  // regardless of BETA_ALL_PRO or billing.
  PRO_ALLOWLIST: z.string().default(""),
});

export const env = schema.parse(process.env);
