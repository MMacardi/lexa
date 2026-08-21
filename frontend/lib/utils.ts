// Tiny className combiner (clsx-lite). Filters out falsy values and joins.
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

// Only allow http(s) links out. Source URLs on examples come from the LLM / web
// search / user input, and React will happily render a `javascript:` href — so we
// vet the scheme before using one as a link. Returns null when it's not safe.
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
