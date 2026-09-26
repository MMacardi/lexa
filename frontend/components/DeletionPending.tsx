"use client";

import { useState } from "react";
import { Download, Trash2, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useDialog } from "@/lib/dialog";
import { errText } from "@/lib/errText";
import { Button } from "@/components/ui/button";

// Shown in place of the app while the account waits out its deletion grace period
// (BACKLOG "A grace period on account deletion"). One screen, three answers:
// keep it (the common case — a mis-tap, a change of heart), take a copy, or erase
// it now after all. Nothing else in the app is reachable, because using it would
// quietly mean "keep" without anyone saying so.
export function DeletionPending({ deleteAfter }: { deleteAfter: string }) {
  const { refresh, logout } = useAccount();
  const { t, locale } = useI18n();
  const { confirm } = useDialog();
  const [busy, setBusy] = useState<"keep" | "export" | "now" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dl = locale === "ru" ? "ru-RU" : locale === "zh" ? "zh-CN" : "en-US";
  const when = new Date(deleteAfter).toLocaleDateString(dl, { day: "numeric", month: "long" });

  async function run(kind: "keep" | "export" | "now", fn: () => Promise<unknown>) {
    setErr(null);
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      setErr(errText(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function eraseNow() {
    const ok = await confirm({
      title: t("deleting.nowTitle"),
      message: t("deleting.nowMessage"),
      confirmLabel: t("deleting.now"),
      tone: "danger",
    });
    if (!ok) return;
    await run("now", async () => {
      await api.deleteAccount(true);
      await logout();
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="anim-fade-up w-full max-w-[440px] rounded-[24px] border border-black/[0.06] bg-surface p-6 text-center sm:p-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warn-bg text-warn-text">
          <Trash2 className="h-6 w-6" />
        </div>
        <h1 className="mt-4 font-serif text-[24px] font-medium text-ink">{t("deleting.title", { date: when })}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{t("deleting.body")}</p>
        <div className="mt-6 flex flex-col gap-2">
          <Button onClick={() => run("keep", async () => { await api.restoreAccount(); await refresh(); })} disabled={busy !== null}>
            <Undo2 className="mr-2 h-4 w-4" /> {busy === "keep" ? t("deleting.keeping") : t("deleting.keep")}
          </Button>
          <Button variant="outline" onClick={() => run("export", () => api.exportAccount())} disabled={busy !== null}>
            <Download className="mr-2 h-4 w-4" /> {busy === "export" ? t("data.exportBusy") : t("deleting.download")}
          </Button>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13px] font-medium">
          <button type="button" onClick={eraseNow} disabled={busy !== null} className="text-warn-text hover:underline disabled:opacity-50">
            {busy === "now" ? t("data.deleteBusy") : t("deleting.now")}
          </button>
          <button type="button" onClick={() => void logout()} disabled={busy !== null} className="text-ink-faint hover:text-ink">
            {t("deleting.signOut")}
          </button>
        </div>
        {err && <p className="mt-4 text-sm font-medium text-warn-text">{err}</p>}
      </div>
    </main>
  );
}
