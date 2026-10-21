"use client";

import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { useAccount } from "@/lib/account";
import { useLearnerLevel } from "@/lib/learnPrefs";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const EVENT = "onomika-mika-pinyin";
export function useMikaPinyin(lang: string) {
  const { accountId } = useAccount();
  const level = useLearnerLevel(lang);
  const key = `onomika.mikaPinyin:${encodeURIComponent(accountId)}:${lang}`;
  const [choice, setChoice] = useState<{ key: string; value: boolean } | null>(null);
  useEffect(() => {
    const sync = (event?: Event) => {
      if (event instanceof CustomEvent && event.detail?.key === key) {
        setChoice(event.detail);
        return;
      }
      try {
        const saved = localStorage.getItem(key);
        setChoice(saved === "true" || saved === "false" ? { key, value: saved === "true" } : null);
      } catch { setChoice(null); }
    };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, [key]);
  const on = choice?.key === key ? choice.value : Number(level ?? "4") <= 4;
  const toggle = () => {
    if (!accountId) return;
    setChoice({ key, value: !on });
    try { localStorage.setItem(key, String(!on)); } catch { /* usable for this session */ }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, value: !on } }));
  };
  return { on, toggle };
}

export function MikaPinyinToggle({ lang }: { lang: string }) {
  const { t } = useI18n();
  const { on, toggle } = useMikaPinyin(lang);
  if (lang !== "zh" && lang !== "zh-Hant") return null;
  return <button type="button" aria-label={t("mika.pinyin")} aria-pressed={on} onClick={toggle}
    className={cn("inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-semibold", on ? "border-sage/40 bg-sage-tint text-sage-deep" : "border-black/10 text-ink-muted")}>
    <Languages className="h-3.5 w-3.5" aria-hidden />{t("mika.pinyin")}
  </button>;
}
