"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { GoogleLoginButton } from "@/components/GoogleLoginButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "";
const GOOGLE_ON = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

type Prov = "telegram" | "google" | "email";

export function ConnectedAccounts() {
  const { profile, refresh } = useAccount();
  const { t } = useI18n();
  const identities = profile?.identities ?? [];
  const linked = (p: Prov) => identities.find((i) => i.provider === p);
  const count = identities.length;

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Telegram connect (deep-link + poll).
  const [tgWaiting, setTgWaiting] = useState(false);
  const [tgUrl, setTgUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function connectTelegram() {
    if (!BOT_USERNAME) return;
    setErr(null);
    const win = window.open("", "_blank");
    try {
      const { token } = await api.startTelegramLogin();
      const url = `https://t.me/${BOT_USERNAME}?start=login_${token}`;
      setTgUrl(url);
      setTgWaiting(true);
      if (win) win.location.href = url;
      pollRef.current = setInterval(async () => {
        const p = await api.pollTelegramLogin(token).catch(() => null);
        if (p) {
          if (pollRef.current) clearInterval(pollRef.current);
          setTgWaiting(false);
          await refresh();
        }
      }, 2000);
    } catch {
      win?.close();
      setErr(t("login.telegramError"));
    }
  }

  async function connectGoogle(credential: string) {
    setErr(null);
    try {
      await api.loginGoogle(credential);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  // Email connect (magic link; clicking it while signed in links to this account).
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  async function connectEmail() {
    const addr = email.trim();
    if (!addr) return;
    setBusy("email");
    setErr(null);
    try {
      const r = await api.startEmailLogin(addr);
      setEmailSent(true);
      setDevLink(r.devLink ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function unlink(p: Prov) {
    if (count <= 1) return;
    setBusy(p);
    setErr(null);
    try {
      await api.unlinkIdentity(p);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const Row = ({
    prov,
    icon,
    label,
    detail,
    connect,
  }: {
    prov: Prov;
    icon: React.ReactNode;
    label: string;
    detail?: string | null;
    connect?: React.ReactNode;
  }) => {
    const on = linked(prov);
    return (
      <div className="flex items-center justify-between gap-3 rounded-[14px] border border-black/[0.06] bg-paper/50 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-[17px]">{icon}</span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-ink">{label}</div>
            {on ? (
              <div className="truncate text-[12px] text-sage-deep">✓ {detail || t("acct.provEmail")}</div>
            ) : (
              <div className="text-[12px] text-ink-faint">—</div>
            )}
          </div>
        </div>
        {on ? (
          <button
            type="button"
            onClick={() => unlink(prov)}
            disabled={count <= 1 || busy === prov}
            title={count <= 1 ? t("acct.onlyMethod") : undefined}
            className="shrink-0 rounded-full border border-black/[0.08] px-3 py-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:bg-black/[0.03] disabled:opacity-40"
          >
            {t("acct.disconnect")}
          </button>
        ) : (
          <div className="shrink-0">{connect}</div>
        )}
      </div>
    );
  };

  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("acct.connected")}</h2>
      <p className="mt-1 text-[13px] leading-snug text-ink-soft">{t("acct.connectedHint")}</p>

      <div className="mt-4 space-y-2">
        <Row
          prov="telegram"
          icon="✈️"
          label={t("acct.provTelegram")}
          detail={linked("telegram")?.subject}
          connect={
            BOT_USERNAME ? (
              tgWaiting ? (
                <div className="text-right text-[12px] text-ink-soft">
                  {t("acct.tgWaiting")}
                  {tgUrl && (
                    <a href={tgUrl} target="_blank" rel="noreferrer" className="ml-1 font-semibold text-[#229ED9] hover:underline">
                      ↗
                    </a>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={connectTelegram}
                  className="rounded-full bg-[#229ED9] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1c8ac0]"
                >
                  {t("acct.connect")}
                </button>
              )
            ) : null
          }
        />

        {GOOGLE_ON && (
          <Row
            prov="google"
            icon="🇬"
            label={t("acct.provGoogle")}
            detail={linked("google")?.subject}
            connect={<GoogleLoginButton onCredential={connectGoogle} />}
          />
        )}

        <Row
          prov="email"
          icon="✉️"
          label={t("acct.provEmail")}
          detail={linked("email")?.subject}
          connect={
            emailSent ? (
              <div className="text-right text-[12px] text-ink-soft">
                {t("acct.emailWaiting")}
                {devLink && (
                  <a href={devLink} className="ml-1 font-semibold text-sage hover:underline">
                    ↗
                  </a>
                )}
              </div>
            ) : emailOpen ? (
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  connectEmail();
                }}
              >
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("login.emailPlaceholder")}
                  className="h-9 w-[160px]"
                />
                <Button type="submit" size="sm" disabled={busy === "email" || !email.trim()}>
                  {busy === "email" ? "…" : "→"}
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setEmailOpen(true)}
                className={cn(
                  "rounded-full border border-black/[0.08] px-3 py-1.5 text-[12px] font-semibold text-ink-muted",
                  "transition-colors hover:bg-black/[0.03]",
                )}
              >
                {t("acct.connect")}
              </button>
            )
          }
        />
      </div>

      {err && <p className="mt-3 text-sm text-warn-text">{err}</p>}
    </section>
  );
}
