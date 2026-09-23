"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { api, type PrivacyLevel } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useTheme } from "@/lib/theme";
import { useI18n, LOCALES } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/Select";
import { Segmented } from "@/components/ui/Segmented";
import { LangSelect } from "@/components/LangSelect";
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
  setNativeLang,
  setRetention,
  setShowTranscription,
  setShowTextLevel,
  setMeaningMode,
  setMeaningCustom,
  setGraphAddMethod,
  setMicEngine,
  clearMicBrowserFailed,
  useMeaningMode,
  useMeaningCustom,
  useShowTextLevel,
  useAllLevels,
  useExampleSource,
  useHanLang,
  useNativeLang,
  useRetention,
  useShowTranscription,
  useGraphAddMethod,
  useMicEngine,
  type CefrLevel,
  type ExampleSource,
  STYLE_ORDER,
  DEFAULT_EXAMPLE_STYLE,
  setExampleStyle,
  useExampleStyle,
  type MeaningMode,
  type GraphAddMethod,
  type MicEngine,
} from "@/lib/learnPrefs";
import { useIsPro } from "@/lib/useIsPro";
import { useUpsell } from "@/lib/useUpsell";
import { ProTag } from "@/components/ProTag";
import { cn } from "@/lib/utils";
import { FOCUS } from "@/lib/focus";
import { Sun, Moon, X, Pencil, Check, Eye, EyeOff, Sparkles, PenLine, type LucideIcon } from "lucide-react";
import { ConnectedAccounts } from "@/components/ConnectedAccounts";
import { BotInfo } from "@/components/BotInfo";
import { PlanUsage } from "@/components/PlanUsage";
import { CoachMemorySection } from "@/components/CoachMemorySection";
import { HoverTip } from "@/components/ui/HoverTip";

function LevelsSection() {
  const { t } = useI18n();
  const levels = useAllLevels();
  const hanLang = useHanLang();
  const native = useNativeLang();
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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-ink">{t("native.label")}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">{t("native.hint")}</p>
        </div>
        <LangSelect value={native ?? ""} onChange={setNativeLang} placeholder={t("native.unset")} className="w-[180px]" />
      </div>

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
        <Segmented
          size="lg"
          value={String(RETENTION_OPTIONS.find((r) => Math.abs(retention - r) < 1e-6) ?? retention)}
          onChange={(v) => setRetention(Number(v))}
          options={RETENTION_OPTIONS.map((r) => ({ value: String(r), label: `${Math.round(r * 100)}%` }))}
        />
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
  const style = useExampleStyle();
  const options: { value: ExampleSource; label: string }[] = [
    { value: "ai", label: t("exsrc.ai") },
    { value: "web", label: t("exsrc.web") },
  ];
  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("exsrc.title")}</h2>
      {/* Focused (F7), the web miner is off in the backend too, so there is
          nothing left to choose here — only the register below. */}
      {!FOCUS && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[15px] font-medium text-ink">{t("exsrc.label")}</span>
            <Segmented
              size="lg"
              value={source}
              onChange={setExampleSource}
              options={options.map((o) => ({
                value: o.value,
                label:
                  o.value === "ai" ? (
                    <>
                      {o.label}
                      <span className="-ml-0.5 opacity-70">· {t("exsrc.recommended")}</span>
                    </>
                  ) : (
                    o.label
                  ),
              }))}
            />
          </div>
          <p className="mt-2 text-[13px] leading-snug text-ink-soft">{t("exsrc.hint")}</p>
        </>
      )}

      {/* register of the sentences (AI-composed examples only; the web miner
          searches news, so the picker is hidden there) */}
      {(FOCUS || source === "ai") && (
        <div className={cn("mt-5 pt-4", !FOCUS && "border-t border-black/[0.06]")}>
          <span className="text-[15px] font-medium text-ink">{t("style.label")}</span>
          <Segmented
            className="mt-2 w-fit"
            scroll
            size="lg"
            value={style}
            onChange={setExampleStyle}
            options={STYLE_ORDER.map((s) => ({ value: s, label: t(`style.${s}`) }))}
          />
          <p className="mt-2 text-[13px] leading-snug text-ink-soft">
            {t(`style.desc.${style === "none" ? DEFAULT_EXAMPLE_STYLE : style}`)}
          </p>
        </div>
      )}
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
        <Segmented
          size="lg"
          itemClassName="px-4"
          value={on ? "on" : "off"}
          onChange={(v) => setShowTranscription(v === "on")}
          options={[
            { value: "on", label: t("common.on") },
            { value: "off", label: t("common.off") },
          ]}
        />
      </div>
      <p className="mt-2 text-[13px] leading-snug text-ink-soft">{t("tr.hint")}</p>
    </section>
  );
}

function MicSection() {
  const { t } = useI18n();
  const engine = useMicEngine();
  const options: MicEngine[] = ["auto", "browser", "server"];
  const label: Record<MicEngine, string> = {
    auto: t("mic.auto"),
    browser: t("mic.browser"),
    server: t("mic.server"),
  };
  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("mic.title")}</h2>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-ink">{t("mic.label")}</span>
        <Segmented
          size="lg"
          itemClassName="px-4"
          value={engine}
          onChange={(v) => {
            setMicEngine(v);
            // Choosing the browser engine is the learner asserting it works for them —
            // forget any past runtime failure so "auto" can reconsider it later too.
            if (v === "browser") clearMicBrowserFailed();
          }}
          options={options.map((v) => ({ value: v, label: label[v] }))}
        />
      </div>
      <p className="mt-2 text-[13px] leading-snug text-ink-soft">{t("mic.hint")}</p>
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
        <Segmented
          size="lg"
          itemClassName="px-4"
          value={on ? "on" : "off"}
          onChange={(v) => setShowTextLevel(v === "on")}
          options={[
            { value: "on", label: t("common.on") },
            { value: "off", label: t("common.off") },
          ]}
        />
      </div>
      <p className="mt-2 text-[13px] leading-snug text-ink-soft">{t("txtlvl.hint")}</p>
    </section>
  );
}

// Default method for adding a synonym/antonym from the word-family graph — the
// "remember my choice" checkbox in that chooser writes here, and this lets the
// user change it back. (The chooser's note points here.)
function GraphAddSection() {
  const { t } = useI18n();
  const method = useGraphAddMethod();
  const opts: { id: GraphAddMethod; label: string; icon?: LucideIcon }[] = [
    { id: "ask", label: t("graphadd.ask") },
    { id: "ai", label: t("add.auto"), icon: Sparkles },
    { id: "manual", label: t("add.manual"), icon: PenLine },
  ];
  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("graphadd.title")}</h2>
      <p className="mt-1 text-[13px] leading-snug text-ink-soft">{t("graphadd.hint")}</p>
      <Segmented
        className="mt-3 sm:inline-flex"
        itemClassName="flex-1 px-2 sm:flex-none sm:px-4"
        size="lg"
        value={method}
        onChange={setGraphAddMethod}
        options={opts.map((o) => ({ value: o.id, label: o.label, Icon: o.icon }))}
      />
    </section>
  );
}

// A small label that visually groups the setting cards below it.
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 pt-2 font-serif text-[19px] font-semibold text-ink">{children}</h2>
  );
}

function MeaningStyleSection() {
  const { t } = useI18n();
  const pro = useIsPro();
  const upsell = useUpsell();
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
      <Segmented
        className="mt-3 sm:inline-flex"
        itemClassName="flex-1 px-2 sm:flex-none sm:px-4"
        size="lg"
        value={effMode}
        onChange={(id) => (modes.find((m) => m.id === id)?.proOnly && !pro ? upsell() : setMeaningMode(id))}
        options={modes.map((m) => {
          const locked = m.proOnly && !pro;
          return {
            value: m.id,
            title: locked ? t("pro.locked") : undefined,
            label: (
              <>
                {m.label}
                {locked && <ProTag />}
              </>
            ),
          };
        })}
      />
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

// One privacy switch: hidden / friends / everyone as a segmented control.
function PrivacyRow({
  label,
  hint,
  value,
  onChange,
  t,
}: {
  label: string;
  hint: string;
  value: PrivacyLevel;
  onChange: (v: PrivacyLevel) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="text-[12px] text-ink-soft">{hint}</p>
      </div>
      {/* self-start: stacked on a phone, the row would stretch the track to the
          card's full width with the options bunched at its left end */}
      <Segmented
        className="shrink-0 self-start sm:self-auto"
        tone="outlined"
        value={value}
        onChange={onChange}
        options={(["hidden", "friends", "everyone"] as const).map((v) => ({
          value: v,
          label: t(`privacy.${v}`),
        }))}
      />
    </div>
  );
}

// A small eye toggle next to email / @tag: hide it from what friends can see.
function PrivacyEye({ hidden, onClick, t }: { hidden: boolean; onClick: () => void; t: (k: string) => string }) {
  return (
    <HoverTip title={hidden ? t("account.hiddenFromFriends") : t("account.visibleToFriends")}>
      <button
        type="button"
        onClick={onClick}
        aria-label={hidden ? t("account.hiddenFromFriends") : t("account.visibleToFriends")}
        className="shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:text-ink"
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </HoverTip>
  );
}

export default function AccountPage() {
  const { accountId, profile, logout, refresh, patchProfile } = useAccount();
  const { theme, toggle } = useTheme();
  const { t, locale, setLocale } = useI18n();

  const via = profile?.authVia ?? "";
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  const emailLocal = profile?.email ? profile.email.split("@")[0] : "";
  // A friendly name that never falls back to the raw "email:…" account key. A
  // display name the learner set themselves wins over the Telegram first name.
  const displayName =
    profile?.displayName ||
    fullName ||
    (profile?.username ? `@${profile.username}` : "") ||
    profile?.email ||
    (accountId.startsWith("email:") ? accountId.slice(6) : accountId);

  // Inline "edit my display name".
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  async function saveName() {
    setSavingName(true);
    try {
      await api.updateName(nameInput.trim());
      await refresh();
      setEditingName(false);
    } catch {
      /* ignore */
    } finally {
      setSavingName(false);
    }
  }
  // The switch moves on tap and the save follows; waiting for the save and then
  // a full profile reload before showing the new value felt like a dead button.
  // Only the latest tap's reply is applied, so a quick second tap isn't undone
  // by the first one's answer arriving after it.
  const privacySeq = useRef(0);
  async function togglePrivacy(patch: Parameters<typeof api.updatePrivacy>[0]) {
    const seq = ++privacySeq.current;
    patchProfile(patch);
    try {
      const saved = await api.updatePrivacy(patch);
      if (seq === privacySeq.current) patchProfile(saved);
    } catch {
      await refresh(); // put back what the server actually has
    }
  }
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
        <h1 className="font-serif text-[28px] font-medium break-words sm:text-[34px] tracking-[-0.01em] text-ink">{t("account.title")}</h1>
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
              {editingName ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    maxLength={60}
                    placeholder={t("account.namePlaceholder")}
                    className="h-9 w-[180px] rounded-[10px] border border-black/[0.1] bg-surface px-2.5 text-[15px] font-semibold text-ink focus:border-sage focus:outline-none"
                  />
                  <button type="button" onClick={saveName} disabled={savingName} aria-label={t("common.save")} className="flex h-8 w-8 items-center justify-center rounded-full bg-sage text-white hover:bg-sage-deep disabled:opacity-50">
                    <Check className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setEditingName(false)} aria-label={t("common.cancel")} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:bg-black/[0.05]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-serif text-[20px] font-semibold text-ink">{displayName}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setNameInput(profile?.displayName || fullName || "");
                      setEditingName(true);
                    }}
                    aria-label={t("account.editName")}
                    className="shrink-0 rounded-full p-1 text-ink-faint hover:bg-black/[0.05] hover:text-ink"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {profile?.email && (
                <div className="mt-0.5 flex items-center gap-1.5 text-[13px]">
                  <span className={cn("truncate", profile.hideEmail ? "text-ink-faint" : "text-ink-soft")}>{profile.email}</span>
                  <PrivacyEye hidden={!!profile.hideEmail} onClick={() => togglePrivacy({ hideEmail: !profile.hideEmail })} t={t} />
                </div>
              )}
              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-medium">
                <span className={cn("h-2 w-2 rounded-full", method.dot)} />
                <span className="text-ink-soft">{method.label}</span>
              </div>
              {profile?.username && (
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
                  <span>@{profile.username}</span>
                  <PrivacyEye hidden={!!profile.hideTag} onClick={() => togglePrivacy({ hideTag: !profile.hideTag })} t={t} />
                </div>
              )}
            </div>
          </div>
          <Button variant="outline" onClick={() => logout()}>
            {t("side.logout")}
          </Button>
        </div>
      </Section>

      {/* social privacy: who sees my profile page and my shared decks */}
      <div id="privacy" className="scroll-mt-6">
        <Section title={t("privacy.title")}>
          <div className="space-y-4">
            <PrivacyRow
              label={t("privacy.profile")}
              hint={t("privacy.profileHint")}
              value={profile?.profileVisibility ?? "friends"}
              onChange={(v) => togglePrivacy({ profileVisibility: v })}
              t={t}
            />
            <PrivacyRow
              label={t("privacy.decks")}
              hint={t("privacy.decksHint")}
              value={profile?.decksVisibility ?? "friends"}
              onChange={(v) => togglePrivacy({ decksVisibility: v })}
              t={t}
            />
            {profile?.id && (
              <Link href={`/profile/${profile.id}`} className="inline-block text-sm font-semibold text-sage-deep hover:underline">
                {t("privacy.viewMine")} →
              </Link>
            )}
          </div>
        </Section>
      </div>

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
            <Segmented
              size="lg"
              itemClassName="px-4"
              value={theme === "dark" ? "dark" : "light"}
              onChange={(m) => {
                if ((m === "dark") !== (theme === "dark")) toggle();
              }}
              options={[
                { value: "light", label: t("account.themeLight"), Icon: Sun },
                { value: "dark", label: t("account.themeDark"), Icon: Moon },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[15px] font-medium text-ink">{t("account.language")}</span>
            <Segmented
              size="lg"
              itemClassName="px-4"
              value={locale}
              onChange={setLocale}
              options={LOCALES.map((l) => ({ value: l.code, label: l.label }))}
            />
          </div>
        </div>
      </Section>

      {/* ── Coach: your personal mentor's memory ── */}
      <GroupHeading>{t("coach.title")}</GroupHeading>
      <CoachMemorySection />
      {/* which engine transcribes voice answers + pronunciation checks */}
      <MicSection />

      {/* ── Adding words: how new cards are created ── */}
      <GroupHeading>{t("settings.groupAdding")}</GroupHeading>
      {/* where example sentences come from (AI vs web) */}
      <ExampleSourceSection />
      {/* how card meanings are written (learner-editable prompt) */}
      <MeaningStyleSection />
      {/* default method when adding a synonym/antonym from the graph */}
      <GraphAddSection />

      {/* ── Study: scheduling + levels ── */}
      <GroupHeading>{t("settings.groupStudy")}</GroupHeading>
      {/* review scheduling (FSRS desired retention) */}
      <RetentionSection />
      {/* language levels */}
      <LevelsSection />

      {/* ── Reading: how words/texts are shown ── */}
      <GroupHeading>{t("settings.groupReading")}</GroupHeading>
      {/* transcription (pinyin/romaji) in quick tap lookups */}
      <TranscriptionSection />
      <TextLevelSection />
    </div>
  );
}
