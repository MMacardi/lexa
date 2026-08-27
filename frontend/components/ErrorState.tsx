"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

// Friendly error block with an optional retry action (e.g. backend down).
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-[18px] border border-warn/40 bg-warn-bg p-6 text-center">
      <p className="text-sm font-semibold text-warn-text">{t("errState.title")}</p>
      <p className="mt-1 text-sm text-warn-text/80">{message}</p>
      <p className="mt-2 text-xs text-ink-faint">{t("errState.hint")}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          {t("errState.retry")}
        </Button>
      )}
    </div>
  );
}
