"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { GoogleLoginButton } from "@/components/GoogleLoginButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HoverTip } from "@/components/ui/HoverTip";
import { cn } from "@/lib/utils";
import { Send, Mail, Check } from "lucide-react";

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
      setErr(errText(e, t));
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
      setErr(errText(e, t));
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
      setErr(errText(e, t));
    } finally {
      setBusy(null);
    }
  }

  // What every row needs to show its linked state and unlink itself.
  const method = (p: Prov) => ({
    linked: !!linked(p),
    detail: linked(p)?.subject,
    onlyOne: count <= 1,
    busy: busy === p,
    onUnlink: () => unlink(p),
  });

  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("acct.connected")}</h2>
      <p className="mt-1 text-[13px] leading-snug text-ink-soft">{t("acct.connectedHint")}</p>

      <div className="mt-4 space-y-2">
        <MethodRow
          {...method("telegram")}
          icon={<Send className="h-[18px] w-[18px] text-[#229ED9]" />}
          label={t("acct.provTelegram")}
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
          <MethodRow
            {...method("google")}
            icon={<span className="text-[15px] font-bold text-[#4285F4]">G</span>}
            label={t("acct.provGoogle")}
            connect={<GoogleLoginButton onCredential={connectGoogle} />}
          />
        )}

        <MethodRow
          {...method("email")}
          icon={<Mail className="h-[18px] w-[18px] text-ink-muted" />}
          label={t("acct.provEmail")}
          below={
            !emailSent && emailOpen ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  connectEmail();
                }}
              >
                <Input
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("login.emailPlaceholder")}
                  className="h-10 min-w-0 flex-1"
                />
                <Button type="submit" size="sm" className="shrink-0" disabled={busy === "email" || !email.trim()}>
                  {busy === "email" ? "…" : "→"}
                </Button>
              </form>
            ) : null
          }
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
            ) : emailOpen ? null : (
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

// One sign-in method. Top-level on purpose: declared inside ConnectedAccounts it
// was a new component type on every render, so React remounted the row (and the
// email field in it lost focus) on each keystroke.
function MethodRow({
  icon,
  label,
  detail,
  linked,
  onlyOne,
  busy,
  onUnlink,
  connect,
  below,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string | null;
  linked: boolean;
  /** The last method left can't be disconnected. */
  onlyOne: boolean;
  busy: boolean;
  onUnlink: () => void;
  connect?: React.ReactNode;
  /** A full-width line under the row (the email form: it doesn't fit beside the label on a phone). */
  below?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-[14px] border border-black/[0.06] bg-paper/50 px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-[17px]">{icon}</span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-ink">{label}</div>
            {linked ? (
              <div className="flex items-center gap-1 truncate text-[12px] text-sage-deep"><Check className="h-3 w-3 shrink-0" /> {detail || t("acct.provEmail")}</div>
            ) : (
              <div className="text-[12px] text-ink-faint">—</div>
            )}
          </div>
        </div>
        {linked ? (
          <HoverTip title={onlyOne ? t("acct.onlyMethod") : ""} className="inline-flex shrink-0">
            <button
              type="button"
              onClick={onUnlink}
              disabled={onlyOne || busy}
              className="shrink-0 rounded-full border border-black/[0.08] px-3 py-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:bg-black/[0.03] disabled:opacity-40"
            >
              {t("acct.disconnect")}
            </button>
          </HoverTip>
        ) : (
          connect && <div className="shrink-0">{connect}</div>
        )}
      </div>
      {!linked && below && <div className="mt-3">{below}</div>}
    </div>
  );
}
