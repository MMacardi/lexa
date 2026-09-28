// The focus pass (STRATEGY §G / BACKLOG F7). The app keeps one loop in view —
// readiness mark → gap deck → review → use — so Community, friend profiles, the
// stats graphs and the extra quiz modes are hidden behind this flag (the coach's
// free chat was too, until 2026-09-28). Nothing is deleted: `NEXT_PUBLIC_FOCUS_MODE=off` brings the full build
// back for the defence demo.
//
// It defaults to ON so production is focused without an env var being set
// anywhere; only the demo has to opt out.
export const FOCUS = !["off", "false", "0"].includes((process.env.NEXT_PUBLIC_FOCUS_MODE ?? "on").toLowerCase());
