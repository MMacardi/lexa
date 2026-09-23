"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Trash2 } from "lucide-react";

// "Take your data" and "delete my account", the two halves /privacy promises.
// Deliberately the last section on the page, and deliberately one section: the
// download sits next to the delete so the way to keep a copy is in front of you
// at the moment you're about to destroy it.
export function AccountDataSection() {
  const { t } = useI18n();
  const { logout } = useAccount();
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [arming, setArming] = useState(false);
  const [typed, setTyped] = useState("");

  const word = t("data.deleteWord");
  const matches = typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase();

  async function exportData() {
    setErr(null);
    setBusy("export");
    try {
      await api.exportAccount();
    } catch (e) {
      setErr(errText(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    if (!matches) return;
    setErr(null);
    setBusy("delete");
    try {
      await api.deleteAccount();
      // The session cookie is already cleared server-side; logout() drops the
      // client's own state and sends them to the landing page.
      await logout();
    } catch (e) {
      setErr(errText(e, t));
      setBusy(null);
    }
  }

  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("data.title")}</h2>

      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-[400px]">
            <p className="text-[15px] font-medium text-ink">{t("data.exportLabel")}</p>
            <p className="mt-0.5 text-[13px] text-ink-soft">{t("data.exportHint")}</p>
          </div>
          <Button variant="outline" onClick={exportData} disabled={busy !== null}>
            <Download className="mr-1.5 h-4 w-4" />
            {busy === "export" ? t("data.exportBusy") : t("data.exportBtn")}
          </Button>
        </div>

        <div className="border-t border-black/[0.06] pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 max-w-[400px]">
              <p className="text-[15px] font-medium text-ink">{t("data.deleteLabel")}</p>
              <p className="mt-0.5 text-[13px] text-ink-soft">{t("data.deleteHint")}</p>
            </div>
            {!arming && (
              <Button variant="outline" onClick={() => setArming(true)} className="text-warn-text">
                <Trash2 className="mr-1.5 h-4 w-4" />
                {t("data.deleteBtn")}
              </Button>
            )}
          </div>

          {arming && (
            <div className="mt-4 rounded-[14px] border border-warn bg-warn-bg p-4">
              <p className="text-[13px] text-ink-soft">{t("data.deleteConfirm", { word })}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && matches) deleteAccount();
                    if (e.key === "Escape") setArming(false);
                  }}
                  placeholder={word}
                  className="h-9 w-[160px]"
                />
                <Button variant="warn" onClick={deleteAccount} disabled={!matches || busy !== null}>
                  {busy === "delete" ? t("data.deleteBusy") : t("data.deleteBtn")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setArming(false);
                    setTyped("");
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>

        {err && <p className="text-[13px] text-warn-text">{err}</p>}
      </div>
    </section>
  );
}
