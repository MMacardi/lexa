import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./lib/env.js";
import { wordsRouter } from "./routes/words.js";
import { authRouter } from "./routes/auth.js";

const app = express();

const allowedOrigins = new Set(
  [env.CORS_ORIGIN, process.env.FRONTEND_URL, "http://localhost:3001"]
    .flatMap((value) => (value ? value.split(",") : []))
    .map((value) => value.trim())
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
app.use(express.json());
app.use(cookieParser());

// Liveness probe. Railway and Docker can hit this to know the server is up.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// REST API consumed by the frontend and the bot.
app.use("/api", authRouter);
app.use("/api", wordsRouter);

app.listen(env.PORT, () => {
  console.log(`Backend listening on http://localhost:${env.PORT}`);
});

// NOTE: The Telegram entry point is now OpenClaw (a self-hosted assistant
// gateway), which calls this REST API. The old in-process Telegraf bot is kept
// as backup in src/bot/index.ts but is no longer launched here.
