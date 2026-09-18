import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./lib/env.js";
import { wordsRouter } from "./routes/words.js";
import { authRouter } from "./routes/auth.js";
import { friendsRouter } from "./routes/friends.js";
import { feedbackRouter } from "./routes/feedback.js";
import { invitesRouter } from "./routes/invites.js";
import { adminRouter } from "./routes/admin.js";
import { betaRouter } from "./routes/beta.js";
import { requireIdentity, requireInvited } from "./lib/gate.js";
import { readSession } from "./lib/auth.js";
import { runAsUser } from "./lib/usageContext.js";
import { startImportWorker } from "./services/importWorker.js";
import { launchBot } from "./bot/index.js";

// Fail closed: never boot a production server with the guessable dev signing key.
if (process.env.NODE_ENV === "production" && env.JWT_SECRET === "dev-insecure-secret-change-me") {
  throw new Error("JWT_SECRET must be set to a strong secret in production");
}

const app = express();

function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

const allowedOrigins = new Set(
  [env.CORS_ORIGIN, process.env.FRONTEND_URL, "http://localhost:3001"]
    .flatMap((value) => (value ? value.split(",") : []))
    .map(normalizeOrigin)
    .filter(Boolean),
);

// Use an explicit allowlist so Render never emits `Access-Control-Allow-Origin: *`
// together with credentials. That combination is rejected by browsers.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "15mb" })); // room for base64 photo uploads (OCR)
app.use(cookieParser());

// Liveness probe. Railway and Docker can hit this to know the server is up.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Closed-beta gate. Mounted at /api, so req.path here is the un-prefixed route
// ("/auth/me", "/words", …). Identity is required everywhere except the login
// routes (they establish the session) and the pre-login beta unlock (a guest has
// no session yet); the invite check additionally exempts the beta unlock, the
// redeem endpoint (a signed-in-but-uninvited user must reach it) and feedback (so
// anyone can still report "I can't get in").
// Every /api response is per-user. In prod the browser reaches us through Vercel's
// /api rewrite, and Vercel's CDN honours upstream cache headers on external
// rewrites — so say "never store" explicitly rather than rely on their absence.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const EXEMPT_IDENTITY = /^\/(auth|beta)\//;
const EXEMPT_INVITED = /^\/(auth\/|beta\/|invites\/redeem$|feedback$)/;
app.use("/api", (req, res, next) =>
  EXEMPT_IDENTITY.test(req.path) ? next() : requireIdentity(req, res, next),
);
app.use("/api", (req, res, next) =>
  EXEMPT_INVITED.test(req.path) ? next() : requireInvited(req, res, next),
);
// Tag the rest of the request with the caller so llm.ts can attribute token spend.
app.use("/api", (req, _res, next) => {
  const id = readSession(req);
  return id ? runAsUser(id, next) : next();
});

// REST API consumed by the frontend and the bot.
app.use("/api", authRouter);
app.use("/api", betaRouter);
app.use("/api", invitesRouter);
app.use("/api", adminRouter);
app.use("/api", friendsRouter);
app.use("/api", feedbackRouter);
app.use("/api", wordsRouter);

app.listen(env.PORT, () => {
  console.log(`Backend listening on http://localhost:${env.PORT}`);
  startImportWorker();
  // No-op unless ENABLE_TELEGRAM_BOT=true (keeps OpenClaw as the default poller).
  launchBot();
});

// NOTE: The Telegram entry point is now OpenClaw (a self-hosted assistant
// gateway), which calls this REST API. The old in-process Telegraf bot is kept
// as backup in src/bot/index.ts but is no longer launched here.
