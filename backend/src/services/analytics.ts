import { prisma } from "./db.js";
import { currentUserId, currentSurface, type Surface } from "../lib/usageContext.js";

// Product analytics. The strategy (STRATEGY.md §G) is unrunnable blind: we need
// the activation funnel, retention and use-step completion before we can tell
// whether a change helped. Events are written here, server-side, from the route
// that performed the action — never posted by the browser, so nothing can be
// forged and no tracker script ships to the learner.

/** The only events we record. Adding one here is the whole registration step. */
export type EventName =
  | "signin" // a session was issued (any provider)
  | "word_add" // a card was created
  | "review" // a card was graded
  | "use_step"; // the learner *used* a word: drill answer, scene turn, coach chat

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
