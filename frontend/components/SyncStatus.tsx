"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { flushOutbox, isOnline, pendingCount, subscribeSync } from "@/lib/sync";
import { RefreshCw, Clock } from "lucide-react";

// Queue status sits above the page so it cannot cover phone review grades.
// AppShell supplies the connection message; this adds pending mutation counts.
export function SyncStatus() {
  const { accountId, verified } = useAccount();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    const refresh = () => void pendingCount().then((n) => alive && setPending(n));
    // Flush, then refresh the badge and — if anything synced — the word list/stats.
    const flush = () =>
      void (verified ? flushOutbox(accountId) : Promise.resolve(0)).then((done) => {
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
  }, [accountId, verified, qc]);

  if (pending === 0) return null;
  const syncing = online && verified;

  return (
    <div className="mb-4 flex justify-center" role="status">
      <div
        className={
          "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold shadow-[0_10px_30px_rgba(46,42,38,0.2)] backdrop-blur " +
          (syncing
            ? "border-sage/30 bg-sage-tint/90 text-sage-deep"
            : "border-black/[0.08] bg-surface/95 text-ink-muted")
        }
      >
        {syncing ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> {t("sync.syncing", { n: pending })}
          </>
        ) : (
          <>
            <Clock className="h-3.5 w-3.5" /> {t("sync.pending", { n: pending })}
          </>
        )}
      </div>
    </div>
  );
}
