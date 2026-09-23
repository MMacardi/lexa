// The focus pass (STRATEGY §G / BACKLOG F7). The app keeps one loop in view —
// readiness mark → gap deck → review → use — so Community, friend profiles, the
// graphs, the extra quiz modes and the coach's own chat are hidden behind this
// flag. Nothing is deleted: `NEXT_PUBLIC_FOCUS_MODE=off` brings the full build
// back for the defence demo.
//
// It defaults to ON so production is focused without an env var being set
// anywhere; only the demo has to opt out.
export const FOCUS = !["off", "false", "0"].includes((process.env.NEXT_PUBLIC_FOCUS_MODE ?? "on").toLowerCase());
