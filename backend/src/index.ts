// First: error monitoring has to be set up before anything else runs.
import { monitorExpress } from "./lib/monitoring.js";
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
import { publicRouter } from "./routes/public.js";
import { communityRouter } from "./routes/community.js";
import { accountRouter } from "./routes/account.js";
import { seedLibrary } from "./services/librarySeed.js";
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

// Guests reach us via Vercel's /api rewrite, which sets X-Forwarded-For to the
// client IP, then Railway's edge appends Vercel's IP. Trusting exactly those hops
// makes req.ip the real guest, so /beta/unlock and auth-start limits are
// per-person instead of one shared bucket. (A request aimed straight at the
// Railway domain can still forge that header; accepted for a closed beta.)
const trustHops = env.TRUST_PROXY_HOPS
  ? Number(env.TRUST_PROXY_HOPS)
  : process.env.NODE_ENV === "production" ? 2 : 0;
if (trustHops > 0) app.set("trust proxy", trustHops);

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
// routes (they establish the session), the pre-login beta unlock (a guest has
// no session yet) and /public (read-only HSK list data for the onboarding a guest
// does before signing in); the invite check additionally exempts those, the
// redeem endpoint (a signed-in-but-uninvited user must reach it) and feedback (so
// anyone can still report "I can't get in").
// Every /api response is per-user. In prod the browser reaches us through Vercel's
// /api rewrite, and Vercel's CDN honours upstream cache headers on external
// rewrites — so say "never store" explicitly rather than rely on their absence.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const EXEMPT_IDENTITY = /^\/(auth|beta|public)\//;
// account/export + account/delete skip the invite gate but NOT the identity one:
// someone who signed in and never redeemed a code still owns their data and must
// be able to take it and leave. Refusing that would make "delete my account" a
// feature you unlock with an invite.
const EXEMPT_INVITED = /^\/(auth\/|beta\/|public\/|invites\/redeem$|feedback$|account\/(export|delete)$)/;
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
app.use("/api", accountRouter);
app.use("/api", betaRouter);
app.use("/api", publicRouter); // onboarding before sign-in: public HSK list reads only
app.use("/api", invitesRouter);
app.use("/api", adminRouter);
app.use("/api", friendsRouter);
app.use("/api", feedbackRouter);
app.use("/api", communityRouter);
app.use("/api", wordsRouter);

// Uncaught route errors reach Sentry when it is on (lib/monitoring.ts).
monitorExpress(app);

app.listen(env.PORT, () => {
  console.log(`Backend listening on http://localhost:${env.PORT}`);
  startImportWorker();
  // Onomika Library starter decks for the Community tab (skips unchanged decks).
  seedLibrary().catch((err) => console.error("[library] seed failed:", err));
  // No-op unless ENABLE_TELEGRAM_BOT=true.
  launchBot();
});
