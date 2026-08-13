"use client";

import { useAccount } from "@/lib/account";
import { useTheme } from "@/lib/theme";
import { useI18n, LOCALES } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/Select";
import { langLabel } from "@/lib/langs";
import {
  CEFR_LEVELS,
  LEVEL_HINT,
  RETENTION_OPTIONS,
  DEFAULT_RETENTION,
  clearHanLang,
  removeLevel,
  setExampleSource,
  setLevel,
  setRetention,
  useAllLevels,
  useExampleSource,
  useHanLang,
  useRetention,
  type CefrLevel,
  type ExampleSource,
} from "@/lib/learnPrefs";
import { cn } from "@/lib/utils";

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "llmlangcardlearnerbot";

function LevelsSection() {
  const { t } = useI18n();
  const levels = useAllLevels();
  const hanLang = useHanLang();
  const langs = Object.keys(levels).sort();
  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("level.sectionTitle")}</h2>
      <p className="mt-1 text-[13px] leading-snug text-ink-soft">{t("level.sectionHint")}</p>
      {langs.length === 0 ? (
        <p className="mt-4 rounded-[14px] border border-dashed border-black/[0.12] bg-paper/60 p-4 text-center text-[13px] text-ink-faint">
          {t("level.empty")}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {langs.map((lang) => (
            <li key={lang} className="flex items-center justify-between gap-3">
              <span className="text-[15px] font-medium text-ink">{langLabel(lang)}</span>
              <div className="flex items-center gap-1.5">
                <Select
                  value={levels[lang]}
                  onChange={(v) => setLevel(lang, v as CefrLevel)}
                  ariaLabel={t("level.title")}
                  className="w-[150px]"
                  options={CEFR_LEVELS.map((l) => ({ value: l, label: l, hint: LEVEL_HINT[l] }))}
                />
                <button
                  type="button"
                  onClick={() => removeLevel(lang)}
                  aria-label="Remove"
                  className="rounded-lg px-2 py-1 text-sm text-ink-faint transition-colors hover:bg-black/[0.04] hover:text-warn-text"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {hanLang && (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-4">
          <span className="text-[13px] text-ink-soft">
            {t("han.remembered")}{" "}
            <span className="font-semibold text-ink">{hanLang === "zh" ? "中文" : hanLang === "ja" ? "日本語" : "한국어"}</span>
          </span>
          <button
            type="button"
            onClick={() => clearHanLang()}
            className="rounded-full border border-black/[0.08] px-3 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:bg-black/[0.03]"
          >
            {t("han.reset")}
          </button>
        </div>
      )}
    </section>
  );
}

function RetentionSection() {
  const { t } = useI18n();
  const retention = useRetention();
  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("account.srs")}</h2>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-ink">{t("retention.label")}</span>
        <div className="flex gap-1 rounded-full bg-black/[0.05] p-1 text-sm font-semibold">
          {RETENTION_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRetention(r)}
              className={cn(
                "rounded-full px-3.5 py-1.5 transition-colors",
                Math.abs(retention - r) < 1e-6 ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
              )}
            >
              {Math.round(r * 100)}%
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-snug text-ink-soft">
        {t("retention.hint")}
        {Math.abs(retention - DEFAULT_RETENTION) < 1e-6 ? ` · ${t("retention.balanced")}` : ""}
      </p>
    </section>
  );
}

function ExampleSourceSection() {
  const { t } = useI18n();
  const source = useExampleSource();
  const options: { value: ExampleSource; label: string }[] = [
    { value: "ai", label: t("exsrc.ai") },
    { value: "web", label: t("exsrc.web") },
  ];
  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("exsrc.title")}</h2>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-ink">{t("exsrc.label")}</span>
        <div className="flex gap-1 rounded-full bg-black/[0.05] p-1 text-sm font-semibold">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setExampleSource(o.value)}
              className={cn(
                "rounded-full px-3.5 py-1.5 transition-colors",
                source === o.value ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
              )}
            >
              {o.label}
              {o.value === "ai" ? <span className="ml-1 opacity-70">· {t("exsrc.recommended")}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-snug text-ink-soft">{t("exsrc.hint")}</p>
    </section>
  );
}

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

      {/* review scheduling (FSRS desired retention) */}
      <RetentionSection />

      {/* where example sentences come from (AI vs web) */}
      <ExampleSourceSection />

      {/* language levels */}
      <LevelsSection />
    </div>
  );
}
