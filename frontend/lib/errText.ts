// Turn any thrown error into localized text. Backend errors carry a machine-
// readable `code` (see http() in api.ts); known codes map to a specific message,
// and anything else falls back to a localized generic — so a raw English backend
// message never leaks into a non-English UI.
type T = (key: string, params?: Record<string, string | number>) => string;

const CODE_KEYS: Record<string, string> = {
  ai_quota: "err.aiQuota",
  quota_monthly: "err.quotaMonthly",
  pro_only: "err.proOnly",
  import_limit: "err.importLimit",
  rate_limit: "err.rateLimit",
  own_code: "friends.errOwnCode",
  no_code: "friends.errNoCode",
  not_found: "friends.errNotFound",
  no_input: "friends.errNoInput",
};

export function errText(e: unknown, t: T): string {
  const code = (e as { code?: string } | null)?.code;
  if (code && CODE_KEYS[code]) return t(CODE_KEYS[code]);
  return t("common.error");
}
