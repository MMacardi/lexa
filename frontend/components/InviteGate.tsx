"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Shown to a signed-in user who hasn't redeemed a beta invite yet. The whole app
// is gated behind this (AppShell), and the backend enforces the same rule
// independently (requireInvited), so this screen is just the friendly face of
// that 403 — redeeming a code flips profile.invited and the app unlocks.
export function InviteGate() {
  const { refresh, logout } = useAccount();
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function redeem() {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.redeemInvite(value);
      await refresh(); // profile.invited → true, so AppShell renders the app
    } catch (e) {
      // A 409 "already invited" is effectively success — refresh clears the gate.
      if ((e as { code?: string })?.code === "already_invited") {
        await refresh();
        return;
      }
      setErr(errText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="anim-pop w-full max-w-[420px] rounded-[24px] border border-black/[0.06] bg-surface p-8 text-center shadow-sm">
        <div className="flex items-center justify-center gap-2">
          <span className="font-serif text-[30px] font-semibold text-ink">Onomika</span>
          <span className="h-2 w-2 rounded-full bg-sage" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-ink">{t("invite.title")}</h1>
        <p className="mt-2 text-sm text-ink-soft">{t("invite.body")}</p>

        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            redeem();
          }}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("invite.placeholder")}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="text-center uppercase tracking-[0.18em]"
          />
          <Button type="submit" disabled={busy || !code.trim()} className="shrink-0">
            {busy ? t("invite.loading") : t("invite.submit")}
          </Button>
        </form>

        {err && <p className="mt-3 text-sm text-warn-text">{err}</p>}

        <button
          type="button"
          onClick={logout}
          className="mt-6 text-xs font-semibold text-ink-faint hover:text-ink"
        >
          {t("invite.logout")}
        </button>
      </div>
    </main>
  );
}
