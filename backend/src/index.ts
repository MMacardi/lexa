import express from "express";
import cors from "cors";
import { env } from "./lib/env.js";
import { wordsRouter } from "./routes/words.js";

const app = express();
app.use(cors()); // dev: allow the Next.js frontend (different port) to call us
app.use(express.json());

// Liveness probe. Railway and Docker can hit this to know the server is up.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// REST API consumed by the frontend.
app.use("/api", wordsRouter);

app.listen(env.PORT, () => {
  console.log(`Backend listening on http://localhost:${env.PORT}`);
});

// NOTE: The Telegram entry point is now OpenClaw (a self-hosted assistant
// gateway), which calls this REST API. The old in-process Telegraf bot is kept
// as backup in src/bot/index.ts but is no longer launched here.
