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
  setShowTranscription,
  setShowTextLevel,
  setMeaningMode,
  setMeaningCustom,
  useMeaningMode,
  useMeaningCustom,
  useShowTextLevel,
  useAllLevels,
  useExampleSource,
  useHanLang,
  useRetention,
  useShowTranscription,
  type CefrLevel,
  type ExampleSource,
  type MeaningMode,
} from "@/lib/learnPrefs";
import { useIsPro } from "@/lib/useIsPro";
import { ProTag } from "@/components/ProTag";
import { cn } from "@/lib/utils";
import { Sun, Moon, X } from "lucide-react";
import { ConnectedAccounts } from "@/components/ConnectedAccounts";
import { BotInfo } from "@/components/BotInfo";
import { PlanUsage } from "@/components/PlanUsage";

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
                  className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-black/[0.04] hover:text-warn-text"
                >
                  <X className="h-4 w-4" />
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

function TranscriptionSection() {
  const { t } = useI18n();
  const on = useShowTranscription();
  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("tr.title")}</h2>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-ink">{t("tr.label")}</span>
        <div className="flex gap-1 rounded-full bg-black/[0.05] p-1 text-sm font-semibold">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setShowTranscription(v)}
              className={cn(
                "rounded-full px-4 py-1.5 transition-colors",
                on === v ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
              )}
            >
              {v ? t("common.on") : t("common.off")}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-snug text-ink-soft">{t("tr.hint")}</p>
    </section>
  );
}

function TextLevelSection() {
  const { t } = useI18n();
  const on = useShowTextLevel();
  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("txtlvl.title")}</h2>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-ink">{t("txtlvl.label")}</span>
        <div className="flex gap-1 rounded-full bg-black/[0.05] p-1 text-sm font-semibold">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setShowTextLevel(v)}
              className={cn(
                "rounded-full px-4 py-1.5 transition-colors",
                on === v ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
              )}
            >
              {v ? t("common.on") : t("common.off")}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-snug text-ink-soft">{t("txtlvl.hint")}</p>
    </section>
  );
}

function MeaningStyleSection() {
  const { t } = useI18n();
  const pro = useIsPro();
  const mode = useMeaningMode();
  const custom = useMeaningCustom();
  const modes: { id: MeaningMode; label: string; hint: string; proOnly: boolean }[] = [
    { id: "concise", label: t("meaning.concise"), hint: t("meaning.conciseHint"), proOnly: false },
    { id: "detailed", label: t("meaning.detailed"), hint: t("meaning.detailedHint"), proOnly: true },
    { id: "custom", label: t("meaning.custom"), hint: t("meaning.customHint"), proOnly: true },
  ];
  // A free user is always effectively "concise" regardless of a stale stored mode.
  const effMode: MeaningMode = pro ? mode : "concise";
  const active = modes.find((m) => m.id === effMode) ?? modes[0];
  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("meaning.title")}</h2>
      <p className="mt-1 text-[13px] leading-snug text-ink-soft">{t("meaning.hint")}</p>
      <div className="mt-3 inline-flex flex-wrap gap-1 rounded-full bg-black/[0.05] p-1 text-sm font-semibold">
        {modes.map((m) => {
          const locked = m.proOnly && !pro;
          return (
            <button
              key={m.id}
              type="button"
              disabled={locked}
              title={locked ? t("pro.locked") : undefined}
              onClick={() => setMeaningMode(m.id)}
              className={cn(
                "inline-flex items-center rounded-full px-4 py-1.5 transition-colors",
                effMode === m.id ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
                locked && "cursor-not-allowed opacity-50",
              )}
            >
              {m.label}
              {locked && <ProTag />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[13px] leading-snug text-ink-soft">{active.hint}</p>
      {effMode === "custom" && (
        <textarea
          value={custom}
          onChange={(e) => setMeaningCustom(e.target.value)}
          rows={3}
          placeholder={t("meaning.placeholder")}
          className="mt-3 w-full resize-y rounded-[12px] border border-black/[0.1] bg-paper px-3 py-2.5 text-[14px] leading-relaxed text-ink outline-none focus:border-sage/60"
        />
      )}
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

  const via = profile?.authVia ?? "";
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  const emailLocal = profile?.email ? profile.email.split("@")[0] : "";
  // A friendly name that never falls back to the raw "email:…" account key.
  const displayName =
    fullName ||
    (profile?.username ? `@${profile.username}` : "") ||
    profile?.email ||
    (accountId.startsWith("email:") ? accountId.slice(6) : accountId);
  const initial = (fullName || emailLocal || accountId || "?").charAt(0).toUpperCase();

  // Sign-in method → label + status-dot colour.
  const method =
    via === "telegram"
      ? { label: t("account.viaTelegram"), dot: "bg-sage" }
      : via === "google"
        ? { label: t("account.viaGoogle"), dot: "bg-[#4285F4]" }
        : via === "email"
          ? { label: t("account.viaEmail"), dot: "bg-sage" }
          : { label: t("account.devSession"), dot: "bg-taupe" };

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
            <div className="min-w-0">
              <div className="truncate font-serif text-[20px] font-semibold text-ink">{displayName}</div>
              {profile?.email && (
                <div className="mt-0.5 truncate text-[13px] text-ink-soft">{profile.email}</div>
              )}
              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-medium">
                <span className={cn("h-2 w-2 rounded-full", method.dot)} />
                <span className="text-ink-soft">{method.label}</span>
              </div>
              {!accountId.startsWith("email:") && (
                <div className="mt-0.5 text-[11px] text-ink-faint">ID: {accountId}</div>
              )}
            </div>
          </div>
          <Button variant="outline" onClick={() => logout()}>
            {t("side.logout")}
          </Button>
        </div>
      </Section>

      {/* plan + today's AI usage */}
      <PlanUsage />

      {/* sign-in methods (link Telegram / Google / email to one account) */}
      <ConnectedAccounts />

      {/* what the Telegram bot can do (+ open it) */}
      <BotInfo />

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
                    "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-colors",
                    theme === m ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {m === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  {m === "light" ? t("account.themeLight") : t("account.themeDark")}
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

      {/* how card meanings are written (learner-editable prompt) */}
      <MeaningStyleSection />

      {/* transcription (pinyin/romaji) in quick tap lookups */}
      <TranscriptionSection />
      <TextLevelSection />

      {/* language levels */}
      <LevelsSection />
    </div>
  );
}
