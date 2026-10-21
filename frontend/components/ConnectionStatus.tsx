"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";

export function ConnectionStatus() {
  const { connection, refresh } = useAccount();
  const { t } = useI18n();
  const [slowCheck, setSlowCheck] = useState(false);

  useEffect(() => {
    setSlowCheck(false);
    if (connection !== "checking") return;
    // A routine session check should not flash an offline warning on every open.
    const timer = setTimeout(() => setSlowCheck(true), 1500);
    return () => clearTimeout(timer);
  }, [connection]);

  if (connection === "online" || (connection === "checking" && !slowCheck)) return null;

  return (
    <div role="status" data-testid="connection-status" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-black/[0.08] bg-surface p-3 text-sm text-ink-soft">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{t(connection === "offline" ? "connection.offline" : "connection.reconnecting")}</span>
      <button type="button" onClick={() => void refresh()} className="min-h-9 px-2 font-semibold text-sage-deep">{t("errState.retry")}</button>
    </div>
  );
}
