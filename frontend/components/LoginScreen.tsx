"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GoogleLoginButton } from "@/components/GoogleLoginButton";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "";

export function LoginScreen() {
  const { loginDev, refresh } = useAccount();
  const { t } = useI18n();
  const router = useRouter();

  // After any successful sign-in, refresh the session and land on the home page.
  const finishLogin = async () => {
    await refresh();
    router.replace("/");
  };
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Telegram deep-link login state.
  const [waiting, setWaiting] = useState(false);
  const [tgUrl, setTgUrl] = useState<string | null>(null);
  const [tgToken, setTgToken] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Email magic-link state.
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function googleLogin(credential: string) {
    setErr(null);
    try {
      await api.loginGoogle(credential);
      await finishLogin();
    } catch (e) {
      setErr(errText(e, t));
    }
  }

  async function emailLogin() {
    const addr = email.trim();
    if (!addr || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.startEmailLogin(addr);
      setEmailSent(true);
      setDevLink(r.devLink ?? null);
    } catch (e) {
      setErr(errText(e, t));
    } finally {
      setBusy(false);
    }
  }

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => () => stopPolling(), []);

  // Re-check the moment the learner returns to this tab (e.g. right after they
  // confirmed in Telegram) so the redirect is instant, not up to a poll away.
  useEffect(() => {
    if (!waiting || !tgToken) return;
    const check = async () => {
      try {
        const profile = await api.pollTelegramLogin(tgToken);
        if (profile) {
          stopPolling();
          await finishLogin();
        }
      } catch {
        /* still pending */
      }
    };
    const onVis = () => document.visibilityState === "visible" && check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, tgToken]);

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
      setTgToken(token);
      if (win) win.location.href = url;
      setWaiting(true);
      // Poll until the bot confirms (poll sets the session cookie on success).
      pollRef.current = setInterval(async () => {
        try {
          const profile = await api.pollTelegramLogin(token);
          if (profile) {
            stopPolling();
            await finishLogin();
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
    setTgToken(null);
  }

  async function dev() {
    if (!id.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await loginDev(id.trim());
      router.replace("/");
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

        {/* Google */}
        <div className="mt-4 flex justify-center">
          <GoogleLoginButton onCredential={googleLogin} />
        </div>

        {/* Email magic-link */}
        <div className="mt-5">
          {emailSent ? (
            <div className="rounded-[16px] border border-black/[0.06] bg-paper/60 p-4 text-sm">
              <p className="flex items-center gap-1.5 font-medium text-ink"><Mail className="h-4 w-4 text-sage-deep" /> {t("login.emailSent")}</p>
              {devLink && (
                <a href={devLink} className="mt-2 inline-block font-semibold text-sage hover:underline">
                  {t("login.devLinkOpen")} ↗
                </a>
              )}
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                emailLogin();
              }}
            >
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("login.emailPlaceholder")}
              />
              <Button type="submit" disabled={busy || !email.trim()} variant="outline" className="shrink-0">
                {busy ? "…" : t("login.emailSend")}
              </Button>
            </form>
          )}
        </div>

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

        <p className="mt-6 text-[11px] leading-relaxed text-ink-faint">
          Входя, вы соглашаетесь с{" "}
          <a href="/terms" className="font-semibold text-ink-soft hover:text-ink hover:underline">
            Условиями
          </a>{" "}
          и{" "}
          <a href="/privacy" className="font-semibold text-ink-soft hover:text-ink hover:underline">
            Политикой конфиденциальности
          </a>
          .
        </p>
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
