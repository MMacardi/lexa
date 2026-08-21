"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { flushOutbox, isOnline, pendingCount, subscribeSync } from "@/lib/sync";

// A small status pill: shows "offline" when there's no network, and "N waiting
// to sync" while queued changes haven't reached the server. Flushes the queue on
// reconnect and on mount. Hidden when online with nothing pending.
export function SyncStatus() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    const refresh = () => void pendingCount().then((n) => alive && setPending(n));
    // Flush, then refresh the badge and — if anything synced — the word list/stats.
    const flush = () =>
      void flushOutbox(accountId).then((done) => {
        refresh();
        if (done > 0) {
          qc.invalidateQueries({ queryKey: ["words"] });
          qc.invalidateQueries({ queryKey: ["stats"] });
        }
      });
    refresh();
    const unsub = subscribeSync(refresh);
    const onOnline = () => {
      setOnline(true);
      flush();
    };
    const onOffline = () => setOnline(false);
    setOnline(isOnline());
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (isOnline()) flush();
    return () => {
      alive = false;
      unsub();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [accountId, qc]);

  if (online && pending === 0) return null;

  return (
    <div className="fixed bottom-[calc(64px+env(safe-area-inset-bottom))] left-1/2 z-[70] -translate-x-1/2 md:bottom-4">
      <div
        className={
          "rounded-full border px-3.5 py-1.5 text-[12px] font-semibold shadow-[0_10px_30px_rgba(46,42,38,0.2)] backdrop-blur " +
          (online
            ? "border-sage/30 bg-sage-tint/90 text-sage-deep"
            : "border-black/[0.08] bg-surface/95 text-ink-muted")
        }
      >
        {pending > 0
          ? online
            ? `↻ ${t("sync.syncing", { n: pending })}`
            : `⏳ ${t("sync.pending", { n: pending })}`
          : `📴 ${t("sync.offline")}`}
      </div>
    </div>
  );
}
