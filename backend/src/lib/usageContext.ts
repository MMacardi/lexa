import { AsyncLocalStorage } from "node:async_hooks";

// Who is the current LLM call for? llm.ts has no `req`, so the caller's identity
// rides along the async chain instead: index.ts wraps every identified /api
// request, the bot wraps every update, and the import worker wraps each job.
// logUsage reads it to attribute token spend per user (null = unattributed).
// analytics.ts rides along too, so an event knows whether the action came from
// the web app or the Telegram bot without every service taking a `surface` param.
const store = new AsyncLocalStorage<{ telegramId: string; surface: Surface }>();

export type Surface = "web" | "bot";

/** Run `fn` (and everything it awaits or schedules) as `telegramId`. */
export function runAsUser<T>(telegramId: string, fn: () => T, surface: Surface = "web"): T {
  return store.run({ telegramId, surface }, fn);
}

/** The telegramId of the user the current async chain is working for, if any. */
export function currentUserId(): string | null {
  return store.getStore()?.telegramId ?? null;
}

/** Where the current async chain came from; "web" outside any bot update. */
export function currentSurface(): Surface {
  return store.getStore()?.surface ?? "web";
}
