import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { env } from "./env.js";

// Error monitoring (BACKLOG "Error monitoring + uptime"). Without it a crash a
// beta tester hits is invisible unless they report it. Off until SENTRY_DSN is
// set, so local runs and a missing env var change nothing.
//
// Most routes catch their own errors, log them with console.error and answer
// 500/502 — so an Express error handler alone would see almost nothing. Capturing
// console.error is what turns those logs into events. Errors only: no tracing,
// no request bodies, no IPs (sendDefaultPii stays off).
//
// Imported first in index.ts, so the SDK is set up before anything else runs.
export const monitoring = Boolean(env.SENTRY_DSN);

if (monitoring) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || "development",
    tracesSampleRate: 0,
    sendDefaultPii: false,
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
}

/** The last middleware: errors a route didn't catch itself. */
export function monitorExpress(app: Express) {
  if (monitoring) Sentry.setupExpressErrorHandler(app);
}
