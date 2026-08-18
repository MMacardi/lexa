"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "";

export function LoginScreen() {
  const { loginDev, refresh } = useAccount();
  const { t } = useI18n();
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Telegram deep-link login state.
  const [waiting, setWaiting] = useState(false);
  const [tgUrl, setTgUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => () => stopPolling(), []);

  async function telegramLogin() {
    if (!BOT_USERNAME || busy) return;
    setErr(null);
    setBusy(true);
    // Open the tab synchronously so the browser doesn't block the popup; we set
    // its URL once we have the token.
    const win = window.open("", "_blank");
    try {
      const { token } = await api.startTelegramLogin();
      const url = `https://t.me/${BOT_USERNAME}?start=login_${token}`;
      setTgUrl(url);
      if (win) win.location.href = url;
      setWaiting(true);
      // Poll until the bot confirms (poll sets the session cookie on success).
      pollRef.current = setInterval(async () => {
        try {
          const profile = await api.pollTelegramLogin(token);
          if (profile) {
            stopPolling();
            await refresh();
          }
        } catch {
          /* keep polling; token may still be pending */
        }
      }, 2000);
    } catch {
      win?.close();
      setErr(t("login.telegramError"));
    } finally {
      setBusy(false);
    }
  }

  function cancelTelegram() {
    stopPolling();
    setWaiting(false);
    setTgUrl(null);
  }

  async function dev() {
    if (!id.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await loginDev(id.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="anim-pop w-full max-w-[420px] rounded-[24px] border border-black/[0.06] bg-surface p-8 text-center shadow-sm">
        <div className="flex items-center justify-center gap-2">
          <span className="font-serif text-[30px] font-semibold text-ink">Lexa</span>
          <span className="h-2 w-2 rounded-full bg-sage" />
        </div>
        <p className="mt-2 text-ink-soft">{t("login.tagline")}</p>

        {/* Telegram login */}
        {BOT_USERNAME && (
          <div className="mt-7">
            {!waiting ? (
              <>
                <button
                  type="button"
                  onClick={telegramLogin}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2.5 rounded-full bg-[#229ED9] px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#1c8ac0] disabled:opacity-60"
                >
                  <TelegramGlyph />
                  {t("login.telegram")}
                </button>
                <p className="mt-2 text-xs text-ink-faint">{t("login.telegramHint")}</p>
              </>
            ) : (
              <div className="rounded-[16px] border border-black/[0.06] bg-paper/60 p-4">
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-ink">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sage border-t-transparent" />
                  {t("login.waiting")}
                </div>
                {tgUrl && (
                  <a
                    href={tgUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-sm font-semibold text-[#229ED9] hover:underline"
                  >
                    {t("login.openTelegram")} ↗
                  </a>
                )}
                <button
                  type="button"
                  onClick={cancelTelegram}
                  className="mt-3 block w-full text-xs font-semibold text-ink-faint hover:text-ink"
                >
                  {t("common.cancel")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Developer sign-in — tucked away; only useful locally (ALLOW_DEV_LOGIN). */}
        <details className="mt-6 text-left">
          <summary className="cursor-pointer text-center text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t("login.devToggle")}
          </summary>
          <div className="mt-3 flex gap-2">
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={t("login.idPlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && dev()}
            />
            <Button onClick={dev} disabled={busy || !id.trim()} className="shrink-0">
              {busy ? "…" : t("login.enter")}
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-faint">{t("login.devNote")}</p>
        </details>

        {err && <p className="mt-3 text-sm text-warn-text">{err}</p>}
      </div>
    </main>
  );
}

function TelegramGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21.94 4.3 18.9 19.1c-.23 1.02-.84 1.27-1.7.79l-4.7-3.46-2.27 2.18c-.25.25-.46.46-.94.46l.34-4.78 8.7-7.86c.38-.34-.08-.53-.59-.19L6.7 13.2l-4.64-1.45c-1.01-.32-1.03-1.01.21-1.5L20.63 2.9c.84-.31 1.57.2 1.31 1.4Z" />
    </svg>
  );
}
