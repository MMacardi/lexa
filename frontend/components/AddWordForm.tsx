"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { isOnline, queueAdd } from "@/lib/sync";
import { errText } from "@/lib/errText";
import { ArrowRightLeft, X, Plus, Sparkles, Globe, Ban } from "lucide-react";
import { useDialog } from "@/lib/dialog";
import { isAiSupported, isAmbiguousHan, langLabel } from "@/lib/langs";
import {
  CEFR_LEVELS,
  EXAMPLE_STYLES,
  LEVEL_HINT,
  getExampleSource,
  getHanLang,
  getLevel,
  pushRecentPair,
  setHanLang,
  setLevel,
  useExampleStyle,
  setExampleStyle,
  useExampleSource,
  setExampleSource,
  getExampleCount,
  getMeaningPrompt,
  setExampleCount,
  useExampleCount,
  useLevel,
  useRecentPairs,
  type CefrLevel,
  type ExampleStyle,
} from "@/lib/learnPrefs";
import { useIsPro } from "@/lib/useIsPro";
import { useUpsell } from "@/lib/useUpsell";
import { ProTag } from "@/components/ProTag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/Select";
import { LangSelect } from "@/components/LangSelect";
import { CollectionMultiSelect } from "@/components/CollectionMultiSelect";
import { cn } from "@/lib/utils";

type Mode = "auto" | "manual";

const MODE_KEY = "lexa.wordAddMode";
const PAIR_KEY = "lexa.wordPair";

// Session-scoped "don't warn me about duplicates again" — resets on full reload,
// which is what you want when bulk-adding many known duplicates in one sitting.
let skipDupWarn = false;

function readStoredPair() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PAIR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sourceLang?: string; targetLang?: string };
    if (!parsed.sourceLang || !parsed.targetLang) return null;
    return { sourceLang: parsed.sourceLang, targetLang: parsed.targetLang };
  } catch {
    return null;
  }
}

type AddVars = {
  chosen: string;
  manual: boolean;
  sourceLangOverride?: string;
  level?: string;
  exampleStyle?: ExampleStyle;
};

// `defaultCollectionId` is the active "Set" filter from My words ("all" or an
// id). When it's a real collection, the new word is pre-assigned to it.
export function AddWordForm({ defaultCollectionId }: { defaultCollectionId?: string }) {
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const { confirm, choose } = useDialog();

  const [mode, setMode] = useState<Mode>("auto");
  const [word, setWord] = useState("");
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("zh");
  const [pairReady, setPairReady] = useState(false);
  const [modeReady, setModeReady] = useState(false);
  const [resolvedSourceLang, setResolvedSourceLang] = useState<string | null>(null);
  const [swapSpin, setSwapSpin] = useState(false);

  // Prefill the word from a ?word= deep link (e.g. "Create ‹word›" on a set page).
  // (?mode= is handled by the mode-init effect below, so it wins over last-used.)
  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get("word");
    if (w) setWord(w);
  }, []);

  // Swap source ⇄ target (skipped when the source is auto-detect).
  const swapLangs = () => {
    if (sourceLang === "auto") return;
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    setSwapSpin((v) => !v);
  };
  // manual fields
  const [meaning, setMeaning] = useState("");
  const [manualEx, setManualEx] = useState<{ en: string; tr: string }[]>([{ en: "", tr: "" }]);
  const [src, setSrc] = useState("");
  const MAX_EX = 10;
  const updateEx = (i: number, patch: Partial<{ en: string; tr: string }>) =>
    setManualEx((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addExRow = () => setManualEx((rows) => (rows.length >= MAX_EX ? rows : [...rows, { en: "", tr: "" }]));
  const removeExRow = (i: number) => setManualEx((rows) => (rows.length <= 1 ? rows : rows.filter((_, idx) => idx !== i)));
  // optional collections to drop the word into (multi-select)
  const [collIds, setCollIds] = useState<string[]>([]);
  // AI spell-check ("did you mean") state
  const [checking, setChecking] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);

  // learner prefs (example difficulty + register)
  const pro = useIsPro(); // Pro-only knobs (web examples, 2-3 examples) are locked for free
  const upsell = useUpsell();
  const style = useExampleStyle();
  const exSource = useExampleSource();
  const exCount = useExampleCount();
  // One control for where examples come from: AI-composed, mined from the web, or
  // none. Derived from the style/source prefs so it stays a single source of truth.
  const exMode: "ai" | "web" | "none" = style === "none" ? "none" : exSource === "web" ? "web" : "ai";
  const setExMode = (m: "ai" | "web" | "none") => {
    if (m === "none") {
      setExampleStyle("none");
    } else if (m === "web") {
      setExampleSource("web");
      setExampleStyle("news"); // the web miner searches news/articles
    } else {
      setExampleSource("ai");
      if (style === "none") setExampleStyle("casual");
    }
  };
  const currentLevel = useLevel(sourceLang);
  const recentPairs = useRecentPairs();
  // Remembered choice for Han-only input (Chinese vs Japanese; never Korean).
  const [hanChoice, setHanChoice] = useState<"zh" | "ja">("zh");
  useEffect(() => {
    const h = getHanLang();
    if (h === "zh" || h === "ja") setHanChoice(h);
  }, []);
  const showHanPicker = sourceLang === "auto" && isAmbiguousHan(word);

  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
  });
  // Words are already cached (Sidebar/My words use the same key) — used to spot
  // duplicates before adding another card for the same spelling.
  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });

  useEffect(() => {
    const stored = readStoredPair();
    if (stored) {
      setSourceLang(stored.sourceLang);
      setTargetLang(stored.targetLang);
    }
    setPairReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // A ?mode= deep link wins over the last-used mode.
    const urlMode = new URLSearchParams(window.location.search).get("mode");
    const stored = localStorage.getItem(MODE_KEY) as Mode | null;
    const initial = urlMode === "auto" || urlMode === "manual" ? urlMode : stored;
    if (initial === "auto" || initial === "manual") setMode(initial);
    setModeReady(true);
  }, []);

  useEffect(() => {
    if (!pairReady) return;
    localStorage.setItem(PAIR_KEY, JSON.stringify({ sourceLang, targetLang }));
  }, [pairReady, sourceLang, targetLang]);

  useEffect(() => {
    if (!modeReady) return;
    localStorage.setItem(MODE_KEY, mode);
  }, [modeReady, mode]);

  // Follow the active "Set" filter as the default selection.
  useEffect(() => {
    setCollIds(defaultCollectionId && defaultCollectionId !== "all" ? [defaultCollectionId] : []);
  }, [defaultCollectionId]);

  // The AI only knows the built-in languages; a custom source language forces
  // manual cards (the model can't reliably define a word in a language it may
  // not know).
  const aiSupported = isAiSupported(sourceLang);
  useEffect(() => {
    if (!aiSupported && mode === "auto") setMode("manual");
  }, [aiSupported, mode]);

  const reset = () => {
    setWord("");
    setMeaning("");
    setManualEx([{ en: "", tr: "" }]);
    setSrc("");
    setResolvedSourceLang(null);
  };

  // Adds a word. `manual:true` skips the AI agents and creates a bare/manual
  // card — used in Manual mode and for "Add as typed" (a word the AI doesn't
  // know, so we must not let it fabricate a definition).
  const mutation = useMutation({
    mutationFn: async ({ chosen, manual, sourceLangOverride, level, exampleStyle }: AddVars) => {
      const base = {
        word: chosen.trim(),
        telegramId: accountId,
        sourceLang: sourceLangOverride ?? sourceLang,
        targetLang,
      };
      let created;
      if (manual) {
        const fromForm = mode === "manual";
        const rows = fromForm ? manualEx.filter((r) => r.en.trim()).slice(0, MAX_EX) : [];
        const single = rows.length === 1 ? rows[0] : undefined;
        created = await api.addWordManual({
          ...base,
          meaningZh: fromForm ? meaning.trim() || undefined : undefined,
          example: single
            ? { sentenceEn: single.en.trim(), sentenceZh: single.tr.trim() || undefined, sourceName: src.trim() || undefined }
            : undefined,
        });
        // More than one example → set the full list on the freshly-created card.
        if (rows.length > 1) {
          created = await api.updateWord(created.id, {
            examples: rows.map((r) => ({ sentenceEn: r.en.trim(), sentenceZh: r.tr.trim(), sourceName: src.trim() || "Manual entry" })),
          });
        }
      } else {
        created = await api.addWord({
          ...base,
          level,
          exampleStyle,
          // Free plan: never send Pro-only params (web source, 2-3 examples, custom
          // meaning) — the UI locks them, this is the safety net against a stale pref.
          exampleSource: pro ? getExampleSource() : "ai",
          exampleCount: pro ? getExampleCount() : 1,
          meaningPrompt: pro ? getMeaningPrompt() || undefined : undefined,
        });
      }
      await Promise.all(collIds.map((id) => api.addWordToCollection(id, created.id)));
      return created;
    },
    onSuccess: (created) => {
      pushRecentPair(created.sourceLang, created.targetLang);
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      setSuggestions(null);
      reset(); // keep collIds so several words can go into the same set(s)
    },
  });

  // Ask (once) for the l2earner's level in a concrete language; store it.
  async function ensureLevel(lang: string): Promise<string | undefined> {
    const stored = getLevel(lang);
    if (stored) return stored;
    const picked = await choose({
      title: t("level.title"),
      message: t("level.question", { lang: langLabel(lang) }),
      options: CEFR_LEVELS.map((l) => ({ value: l, label: l, hint: LEVEL_HINT[l] })),
    });
    if (!picked) return undefined;
    setLevel(lang, picked as CefrLevel);
    return picked;
  }

  // Run pre-add checks (level prompt + duplicate warning), then add.
  async function addWithChecks(vars: AddVars) {
    if (mutation.isPending) return;
    const effLang = vars.sourceLangOverride ?? sourceLang;

    // Level applies to AI example search in a concrete source language.
    let level: string | undefined;
    if (!vars.manual && effLang !== "auto") {
      const had = getLevel(effLang);
      level = await ensureLevel(effLang);
      // First-time picker dismissed without a choice → don't proceed.
      if (!had && !level) return;
    }

    // Duplicate warning. Manual-from-form: only when the same translation
    // already exists; otherwise: any card with the same spelling.
    if (!skipDupWarn) {
      const w = vars.chosen.trim().toLowerCase();
      const matches = (words ?? []).filter((x) => x.word.toLowerCase() === w);
      const fromForm = vars.manual && mode === "manual";
      const isDup = fromForm
        ? matches.some((x) => (x.meaningZh ?? "").trim().toLowerCase() === meaning.trim().toLowerCase())
        : matches.length > 0;
      if (isDup) {
        const existingMeaning = matches.map((x) => x.meaningZh).find(Boolean);
        let dontAsk = false;
        const ok = await confirm({
          title: t("dup.title"),
          message: existingMeaning
            ? t("dup.withMeaning", { word: vars.chosen.trim(), meaning: existingMeaning })
            : t("dup.plain", { word: vars.chosen.trim() }),
          confirmLabel: t("dup.addAnyway"),
          checkboxLabel: t("dup.dontAsk"),
          onResult: (c) => (dontAsk = c),
        });
        if (dontAsk) skipDupWarn = true;
        if (!ok) return;
      }
    }

    mutation.mutate({ ...vars, level, exampleStyle: style });
  }

  // Only the word (auto) — or word + meaning (manual) — are required.
  const canSubmit = word.trim().length > 0 && (mode === "auto" || meaning.trim().length > 0);
  const busy = mutation.isPending || checking;

  // AI mode: spell-check first, then either add directly or show "did you mean".
  async function handleSubmit() {
    const typed = word.trim();
    if (!canSubmit || busy) return;
    // Offline: adding needs the server (spell-check + AI enrichment), so queue the
    // raw word — it'll be added automatically when the connection is back.
    if (!isOnline()) {
      await queueAdd(typed, resolvedSourceLang ?? (sourceLang === "auto" ? "en" : sourceLang), targetLang);
      show({ icon: "📴", title: t("add.queuedOffline") });
      setWord("");
      return;
    }
    if (mode === "manual") {
      addWithChecks({ chosen: typed, manual: true, sourceLangOverride: resolvedSourceLang ?? sourceLang });
      return;
    }
    setChecking(true);
    setSuggestions(null);
    try {
      const r = await api.suggestWord(typed, sourceLang);
      // Kanji-only input is ambiguous — use the inline picker's remembered choice
      // instead of interrupting with a modal.
      const detectedSourceLang =
        sourceLang === "auto" && r.ambiguousHan ? hanChoice : r.detectedLang ?? sourceLang;
      setResolvedSourceLang(detectedSourceLang);
      const typedLc = typed.toLowerCase();
      const alts = r.suggestions.filter(Boolean);
      // The word is already correctly spelled → add it straight away. "Did you
      // mean…" only makes sense for an actual typo (the model corrected it to
      // something else); alternatives for a valid word are just noise.
      if (r.corrected === typedLc) {
        addWithChecks({ chosen: typedLc, manual: false, sourceLangOverride: detectedSourceLang });
      } else {
        setSuggestions(alts.length ? alts : [r.corrected]);
      }
    } catch {
      addWithChecks({ chosen: typed, manual: false, sourceLangOverride: sourceLang }); // on any hiccup, add with AI
    } finally {
      setChecking(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      className="space-y-2.5 rounded-[18px] border border-black/[0.06] bg-surface/70 p-4"
    >
      {/* mode toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full bg-black/[0.04] p-1 text-sm font-semibold w-fit">
          {(["auto", "manual"] as Mode[]).map((m) => {
            const disabled = m === "auto" && !aiSupported;
            return (
              <button
                key={m}
                type="button"
                disabled={disabled}
                title={disabled ? t("add.aiUnsupported", { lang: langLabel(sourceLang) }) : undefined}
                onClick={() => !disabled && setMode(m)}
                className={cn(
                  "rounded-full px-3 py-1 transition-colors",
                  mode === m ? "bg-sage text-white" : "text-ink-muted",
                  disabled && "cursor-not-allowed opacity-40",
                )}
              >
                {m === "auto" ? t("add.auto") : t("add.manual")}
              </button>
            );
          })}
        </div>
        {!aiSupported && (
          <span className="text-[12px] font-medium text-ink-faint">{t("add.aiUnsupported", { lang: langLabel(sourceLang) })}</span>
        )}
      </div>

      {/* language pair */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <LangSelect value={sourceLang} onChange={setSourceLang} allowAuto autoLabel={t("add.autoDetect")} />
        <button
          type="button"
          onClick={swapLangs}
          disabled={sourceLang === "auto"}
          aria-label={t("add.swap")}
          title={t("add.swap")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-surface text-ink-muted transition-colors hover:border-sage hover:text-sage-deep disabled:opacity-40"
        >
          <ArrowRightLeft className={cn("h-[15px] w-[15px] transition-transform duration-300", swapSpin && "rotate-180")} />
        </button>
        <LangSelect value={targetLang} onChange={setTargetLang} />
      </div>

      {/* recently used pairs — quick re-select */}
      {recentPairs.filter((p) => !(p.s === sourceLang && p.t === targetLang)).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("add.recent")}</span>
          {recentPairs
            .filter((p) => !(p.s === sourceLang && p.t === targetLang))
            .map((p) => (
              <button
                key={`${p.s}>${p.t}`}
                type="button"
                onClick={() => {
                  setSourceLang(p.s);
                  setTargetLang(p.t);
                }}
                className="rounded-full border border-black/[0.08] bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-sage hover:text-sage-deep"
              >
                {langLabel(p.s)} → {langLabel(p.t)}
              </button>
            ))}
        </div>
      )}

      {/* Example tuning (auto mode): where examples come from + register + level */}
      {mode === "auto" && (
        <div className="space-y-2">
          {/* source of examples: AI-composed, mined from the web, or none */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("exmode.label")}</span>
            <div className="inline-flex rounded-full bg-black/[0.05] p-0.5 text-xs font-semibold">
              {([
                ["ai", Sparkles],
                ["web", Globe],
                ["none", Ban],
              ] as const).map(([m, Icon]) => {
                const locked = m === "web" && !pro; // web-sourced examples are Pro
                return (
                  <button
                    key={m}
                    type="button"
                    title={locked ? t("pro.locked") : undefined}
                    onClick={() => (locked ? upsell({ word }) : setExMode(m))}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors",
                      exMode === m ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
                      locked && "opacity-60",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {t(`exmode.${m}`)}
                    {locked && <ProTag />}
                  </button>
                );
              })}
            </div>
          </div>

          {exMode !== "none" && (
            <div className="flex flex-wrap items-center gap-2">
              {/* register only applies to AI-composed examples */}
              {exMode === "ai" && (
                <>
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("style.label")}</span>
                  <Select
                    value={style}
                    onChange={(v) => setExampleStyle(v as ExampleStyle)}
                    ariaLabel={t("style.label")}
                    className="w-[150px]"
                    options={EXAMPLE_STYLES.filter((s) => s !== "none").map((s) => ({ value: s, label: t(`style.${s}`), hint: t(`style.hint.${s}`) }))}
                  />
                </>
              )}
              {sourceLang !== "auto" && (
                <>
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("level.pick")}</span>
                  <Select
                    value={currentLevel ?? ""}
                    onChange={(v) => setLevel(sourceLang, v as CefrLevel)}
                    ariaLabel={t("level.title")}
                    placeholder={t("level.pick")}
                    className="w-[136px]"
                    options={CEFR_LEVELS.map((l) => ({ value: l, label: l, hint: LEVEL_HINT[l] }))}
                  />
                </>
              )}
              {pro ? (
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("count.label")}</span>
              ) : (
                <button type="button" onClick={() => upsell({ word })} className="inline-flex items-center text-xs font-semibold uppercase tracking-wide text-ink-faint hover:text-ink-muted">
                  {t("count.label")}
                  <ProTag />
                </button>
              )}
              <Select
                value={String(pro ? exCount : 1)}
                onChange={(v) => setExampleCount(Number(v))}
                ariaLabel={t("count.label")}
                className="w-[92px]"
                // Free plan can only add 1 example per word; 2-3 is Pro.
                options={(pro ? [1, 2, 3] : [1]).map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
          )}

          {/* plain-language hint */}
          <p className="text-[12px] leading-snug text-ink-faint">
            {exMode === "ai" ? t(`style.desc.${style}`) : exMode === "web" ? t("exmode.webDesc") : t("style.desc.none")}
            {exMode !== "none" && sourceLang !== "auto" && currentLevel ? ` · ${t("level.forLevel", { level: currentLevel })}` : ""}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={word}
          onChange={(e) => {
            setWord(e.target.value);
            if (suggestions) setSuggestions(null);
          }}
          placeholder={t("add.wordPlaceholder", { lang: sourceLang === "auto" ? t("add.autoDetect") : langLabel(sourceLang) })}
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !canSubmit} className="shrink-0">
          {checking
            ? t("add.checking")
            : mutation.isPending
              ? mode === "auto"
                ? t("add.searching")
                : t("add.saving")
              : t("add.submit")}
        </Button>
      </div>

      {/* Ideograph language picker — appears only for kanji-only input in
          auto-detect; disappears the moment kana/hangul is typed. */}
      {showHanPicker && (
        <div className="anim-fade-up flex flex-wrap items-center gap-2 rounded-[14px] border border-sage/30 bg-sage-tint/40 p-2.5">
          <span className="text-[12px] font-semibold text-sage-deep">{t("han.inlinePrompt")}</span>
          <div className="flex gap-1 rounded-[16px] bg-black/[0.05] p-1 text-sm font-semibold">
            {/* Only Chinese vs Japanese — pure Han input is never Korean (Korean uses
                hangul), and offering it caused mis-detections like 月 → 월. */}
            {(["zh", "ja"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => {
                  setHanChoice(l);
                  setHanLang(l); // remember for the rest of the session
                }}
                className={cn(
                  "flex flex-col items-center rounded-[12px] px-3 py-1 leading-tight transition-colors",
                  hanChoice === l ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
                )}
              >
                <span>{l === "zh" ? "中文" : "日本語"}</span>
                <span
                  className={cn(
                    "text-[10px] font-medium",
                    hanChoice === l ? "text-white/80" : "text-ink-faint",
                  )}
                >
                  {l === "zh" ? t("han.chinese") : t("han.japanese")}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {suggestions && (
        <div className="anim-fade-up space-y-2 rounded-[14px] border border-sage/30 bg-sage-tint/50 p-3">
          <p className="text-sm font-semibold text-sage-deep">{t("add.didYouMean")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={mutation.isPending}
                onClick={() =>
                  addWithChecks({
                    chosen: s,
                    manual: false,
                    sourceLangOverride: resolvedSourceLang ?? sourceLang,
                  })
                }
                className="rounded-full bg-sage px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-50"
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                addWithChecks({ chosen: word.trim(), manual: true, sourceLangOverride: resolvedSourceLang ?? sourceLang })
              }
              title="The AI may not know this word — it's added as a blank card you can edit."
              className="rounded-full border border-black/[0.1] bg-surface px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-black/[0.03] disabled:opacity-50"
            >
              {t("add.asTyped", { word: word.trim() })}
            </button>
            <button
              type="button"
              onClick={() => setSuggestions(null)}
              className="text-sm font-semibold text-ink-faint hover:text-ink-muted"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {mode === "manual" && (
        <div className="space-y-2">
          <Input value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder={t("add.meaningPlaceholder", { lang: langLabel(targetLang) })} />
          {manualEx.map((row, i) => (
            <div key={i} className="space-y-2 rounded-[14px] border border-black/[0.06] bg-paper/40 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {t("add.exampleN", { n: i + 1 })}
                </span>
                {manualEx.length > 1 && (
                  <button type="button" onClick={() => removeExRow(i)} aria-label={t("word.delete")} className="rounded-md p-1 text-ink-faint hover:text-warn-text">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Input value={row.en} onChange={(e) => updateEx(i, { en: e.target.value })} placeholder={t("add.examplePlaceholder", { lang: langLabel(sourceLang) })} />
              <Input value={row.tr} onChange={(e) => updateEx(i, { tr: e.target.value })} placeholder={t("add.exampleTrPlaceholder", { lang: langLabel(targetLang) })} />
            </div>
          ))}
          {manualEx.length < MAX_EX && (
            <button
              type="button"
              onClick={addExRow}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-black/[0.03]"
            >
              <Plus className="h-3.5 w-3.5" /> {t("add.exampleAdd")}
            </button>
          )}
          <Input value={src} onChange={(e) => setSrc(e.target.value)} placeholder={t("add.sourcePlaceholder")} />
        </div>
      )}

      {/* optional collections — pretty dropdown multi-select */}
      {collections && collections.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t("add.toSet")}
          </span>
          <CollectionMultiSelect options={collections} value={collIds} onChange={setCollIds} />
        </div>
      )}

      {mutation.isError && (
        <p className="text-sm font-medium text-warn-text">{errText(mutation.error, t)}</p>
      )}
      {mutation.isPending && mode === "auto" && !suggestions && (
        <p className="text-sm text-ink-soft">{t("add.findingSentence")}</p>
      )}
    </form>
  );
}
