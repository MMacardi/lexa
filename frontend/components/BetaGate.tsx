"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Pre-login shared beta gate. A guest enters the single BETA_KEY, which sets a
// signed httpOnly cookie; logging in afterwards marks the account invited (see
// finishLogin in the backend). Everyone gets the one shared code; there is no
// personal-code path on this screen. With BETA_KEY empty the screen is skipped.
export function BetaGate({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Hold the form back until /beta/status answers, so a guest who will skip the
  // gate never sees it flash.
  const [ready, setReady] = useState(false);
  const checked = useRef(false);

  // Gate off (no BETA_KEY on the server) or a returning guest whose beta cookie
  // is still valid: skip straight to login.
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    api
      .betaStatus()
      .then((s) => {
        if (!s.enabled || s.unlocked) onUnlock();
        else setReady(true);
      })
      .catch(() => setReady(true));
  }, [onUnlock]);

  if (!ready) return <main className="min-h-screen bg-paper" />;

  async function submit() {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.unlockBeta(value);
      onUnlock();
    } catch (e) {
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
        <h1 className="mt-4 text-lg font-semibold text-ink">{t("beta.title")}</h1>
        <p className="mt-2 text-sm text-ink-soft">{t("beta.body")}</p>

        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("beta.placeholder")}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="text-center uppercase tracking-[0.18em]"
          />
          <Button type="submit" disabled={busy || !code.trim()} className="shrink-0">
            {busy ? t("beta.loading") : t("beta.submit")}
          </Button>
        </form>

        {err && <p className="mt-3 text-sm text-warn-text">{err}</p>}
      </div>
    </main>
  );
}
