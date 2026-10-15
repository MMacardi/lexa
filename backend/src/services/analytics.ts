import { prisma } from "./db.js";
import { currentUserId, currentSurface, type Surface } from "../lib/usageContext.js";

// Product analytics. The strategy (STRATEGY.md §G) is unrunnable blind: we need
// the activation funnel, retention and use-step completion before we can tell
// whether a change helped. Events are written here, server-side, from the route
// that performed the action, so nothing can be forged and no tracker script ships
// to the learner. One exception: the steps of onboarding before sign-in
// ("onboarding"), which happen in the browser with no account to act on. Those come
// from POST /api/public/funnel — a fixed list of step names and a random id the
// browser keeps, nothing else; a forged one only adds a count.

/** The only events we record. Adding one here is the whole registration step. */
export type EventName =
  | "signin" // a session was issued (any provider)
  | "word_add" // a card was created
  | "review" // a card was graded
  | "use_step" // the learner *used* a word: drill answer, scene turn, coach chat
  | "onboarding"; // a guest reached a step before sign-in: {visitor, step} (FUNNEL_STEPS)

/**
 * The first five minutes, in order (BACKLOG "The first five minutes"): the landing, its
 * start button, the level and target, the check, the pace, why Chinese and the
 * interests, the plan being built, the words, the lesson on five of them, its review
 * and its end, the beta code, sign-in, and the plan landing on the new account. Which
 * of them a visitor reached says where people leave.
 */
export const FUNNEL_STEPS = [
  "landing",
  "start",
  "level",
  "target",
  "check",
  "daily",
  "goal",
  "interests",
  "building",
  "ready",
  "lesson",
  "quiz",
  "learned",
  "beta",
  "login",
  "signed_in",
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

type Props = Record<string, string | number | boolean | null>;

/**
 * Record one event. Fire-and-forget: never awaited by a request handler, and a
 * failed insert is logged, not thrown (same contract as llm.ts logUsage).
 * `telegramId` and `surface` default to the caller on the current async chain.
 */
export function track(name: EventName, opts: { surface?: Surface; telegramId?: string | null; props?: Props } = {}): void {
  void prisma.analyticsEvent
    .create({
      data: {
        name,
        telegramId: opts.telegramId ?? currentUserId(),
        surface: opts.surface ?? currentSurface(),
        props: opts.props ?? undefined,
      },
    })
    .catch((err) => console.error("[analytics] insert failed:", (err as Error).message));
}
