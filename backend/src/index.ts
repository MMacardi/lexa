import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./lib/env.js";
import { wordsRouter } from "./routes/words.js";
import { authRouter } from "./routes/auth.js";

const app = express();
// Reflect the request origin and allow credentials so the browser can send the
// session cookie cross-site (Vercel frontend -> Railway backend).
app.use(cors({ origin: true, credentials: true }));
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
