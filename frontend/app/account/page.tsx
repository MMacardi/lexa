"use client";

import { useAccount } from "@/lib/account";
import { useTheme } from "@/lib/theme";
import { useI18n, LOCALES } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "llmlangcardlearnerbot";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{title}</h2>
      {children}
    </section>
  );
}

export default function AccountPage() {
  const { accountId, profile, logout } = useAccount();
  const { theme, toggle } = useTheme();
  const { t, locale, setLocale } = useI18n();

  const viaTelegram = profile?.authVia === "telegram";
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  const displayName = fullName || (profile?.username ? `@${profile.username}` : accountId);
  const initial = (fullName || accountId || "?").charAt(0).toUpperCase();

  return (
    <div className="anim-fade-up mx-auto max-w-[640px] space-y-6">
      <div>
        <h1 className="font-serif text-[34px] font-medium tracking-[-0.01em] text-ink">{t("account.title")}</h1>
        <p className="mt-1.5 text-ink-soft">{t("account.subtitle")}</p>
      </div>

      {/* account */}
      <Section title={t("side.account")}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {profile?.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.photoUrl}
                alt={displayName}
                className="h-14 w-14 rounded-full border border-black/[0.08] object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sage-tint font-serif text-[22px] font-bold text-sage-deep">
                {initial}
              </div>
            )}
            <div>
              <div className="font-serif text-[20px] font-semibold text-ink">{displayName}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-medium">
                <span className={cn("h-2 w-2 rounded-full", viaTelegram ? "bg-sage" : "bg-taupe")} />
                <span className="text-ink-soft">
                  {viaTelegram ? t("account.viaTelegram") : t("account.devSession")}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-ink-faint">ID: {accountId}</div>
            </div>
          </div>
          <Button variant="outline" onClick={() => logout()}>
            {t("side.logout")}
          </Button>
        </div>
      </Section>

      {/* telegram */}
      <Section title={t("account.telegram")}>
        <p className="text-[15px] leading-relaxed text-ink-soft">{t("account.telegramHint")}</p>
        <a
          href={`https://t.me/${BOT}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
        >
          {t("account.openBot")}
        </a>
      </Section>

      {/* appearance */}
      <Section title={t("account.appearance")}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[15px] font-medium text-ink">{t("account.theme")}</span>
            <div className="flex gap-1 rounded-full bg-black/[0.05] p-1 text-sm font-semibold">
              {(["light", "dark"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    if ((m === "dark") !== (theme === "dark")) toggle();
                  }}
                  className={cn(
                    "rounded-full px-4 py-1.5 transition-colors",
                    theme === m ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {m === "light" ? `☀️ ${t("account.themeLight")}` : `🌙 ${t("account.themeDark")}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[15px] font-medium text-ink">{t("account.language")}</span>
            <div className="flex gap-1 rounded-full bg-black/[0.05] p-1 text-sm font-semibold">
              {LOCALES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLocale(l.code)}
                  className={cn(
                    "rounded-full px-4 py-1.5 transition-colors",
                    locale === l.code ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
