// Error monitoring in the browser (BACKLOG "Error monitoring + uptime"): a crash a
// beta tester hits is otherwise invisible unless they report it. Next runs this
// file before the app starts. Off unless NEXT_PUBLIC_SENTRY_DSN is set at build
// time, and loaded lazily, so a build without it ships none of the SDK.
//
// console.error is captured as well as uncaught errors: React reports the errors
// an error boundary catches that way, and so does most of our own error handling.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/browser").then((Sentry) =>
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
    }),
  );
}
