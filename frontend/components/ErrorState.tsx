"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { ApiError, isAccessError, isTransientError } from "@/lib/api";

// Friendly error block with an optional retry action (e.g. backend down).
export function ErrorState({
  message,
  onRetry,
  error,
  kind = error instanceof ApiError && error.status === 404 ? "notFound" : isAccessError(error) ? "auth" : error && !isTransientError(error) ? "other" : "transient",
}: {
  message: string;
  onRetry?: () => void;
  kind?: "transient" | "notFound" | "auth" | "other";
  error?: unknown;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-[18px] border border-warn/40 bg-warn-bg p-6 text-center">
      <p className="text-sm font-semibold text-warn-text">{t(kind === "notFound" ? "word.notFound" : kind === "auth" ? "errState.auth" : "errState.title")}</p>
      <p className="mt-1 text-sm text-warn-text/80">{kind === "auth" ? t("errState.authHint") : message}</p>
      {kind === "transient" && <p className="mt-2 text-[13px] text-ink-faint">{t("errState.hint")}</p>}
      {onRetry && kind === "transient" && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          {t("errState.retry")}
        </Button>
      )}
    </div>
  );
}
