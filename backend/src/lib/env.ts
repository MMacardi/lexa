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
  ENABLE_TELEGRAM_BOT: z.string().default("false"),
  // "true" runs the daily due-review reminder sweep alongside the bot.
  ENABLE_BOT_REMINDERS: z.string().default("false"),
  // Hour of day (0–23, server local time) to send the daily reminder.
  BOT_REMINDER_HOUR: z.coerce.number().min(0).max(23).default(9),
  // Auth / sessions
  JWT_SECRET: z.string().default("dev-insecure-secret-change-me"),
  ALLOW_DEV_LOGIN: z.string().default("true"), // "true" enables /api/auth/dev
  COOKIE_SECURE: z.string().default("false"), // "true" in production (cross-site cookies)
});

export const env = schema.parse(process.env);
