"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LANGS } from "@/lib/langs";
import { addCustomLang, removeCustomLang, useCustomLangs } from "@/lib/customLangs";
import { useI18n } from "@/lib/i18n";
import { useDialog } from "@/lib/dialog";
import { cn } from "@/lib/utils";

// Pretty custom dropdown for picking a language. The menu is rendered in a
// portal (position: fixed) so it always floats above the page, repositions on
// scroll/resize (instead of closing), and has a search box.
export function LangSelect({
  value,
  onChange,
  className,
  menuClassName,
  allowAuto = false,
  autoLabel = "Auto-detect",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  menuClassName?: string;
  allowAuto?: boolean;
  autoLabel?: string;
}) {
  const { t } = useI18n();
  const { prompt } = useDialog();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const custom = useCustomLangs();
  const all = [
    ...(allowAuto ? [{ code: "auto", name: autoLabel }] : []),
    ...LANGS.map((l) => ({ code: l.code, name: l.name })),
    ...custom,
  ];
  const current = all.find((l) => l.code === value);

  useLayoutEffect(() => {
    if (open && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    if (open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? all.filter((l) => l.name.toLowerCase().includes(q) || l.code.includes(q))
    : all;

  const onAddLanguage = async () => {
    setOpen(false);
    const name = (
      await prompt({
        title: t("dialog.addLanguageTitle"),
        message: t("col.langPrompt"),
        placeholder: "Portuguese",
        confirmLabel: t("common.add"),
      })
    )?.trim();
    if (!name) return;
    const lang = addCustomLang(name);
    onChange(lang.code);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-[14px] border bg-surface px-3.5 text-[15px] font-medium text-ink transition-colors",
          open ? "border-sage" : "border-black/[0.08] hover:border-black/20",
        )}
      >
        <span>{current?.name ?? value}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          className={cn("text-ink-faint transition-transform", open && "rotate-180")}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            className={cn(
              "anim-scale-in fixed z-[80] flex max-h-72 flex-col overflow-hidden rounded-[14px] border border-black/[0.08] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.18)]",
              menuClassName,
            )}
            style={{ left: rect.left, top: rect.bottom + 6, minWidth: Math.max(rect.width, 160) }}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("col.searchLang")}
              className="border-b border-black/[0.06] bg-transparent px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <ul className="overflow-auto p-1.5">
              {filtered.length === 0 && (
                <li className="px-3 py-3 text-center text-sm text-ink-faint">{t("common.noMatches")}</li>
              )}
              {filtered.map((l) => {
                const active = l.code === value;
                const isCustom = custom.some((c) => c.code === l.code);
                return (
                  <li key={l.code} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onChange(l.code);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex min-w-0 flex-1 items-center justify-between rounded-[10px] px-3 py-2 text-left text-[15px] transition-colors",
                        active ? "bg-sage-tint font-semibold text-sage-deep" : "text-ink hover:bg-black/[0.03]",
                      )}
                    >
                      <span className="truncate">{l.name}</span>
                      {active && <span className="shrink-0 text-sage">✓</span>}
                    </button>
                    {isCustom && (
                      <button
                        type="button"
                        aria-label={t("col.removeLang")}
                        title={t("col.removeLang")}
                        onClick={() => {
                          removeCustomLang(l.code);
                          if (l.code === value) onChange("en"); // reset if we deleted the selected one
                        }}
                        className="shrink-0 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-warn-text"
                      >
                        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none">
                          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </li>
                );
              })}
              <li className="mt-1 border-t border-black/[0.06] pt-1">
                <button
                  type="button"
                  onClick={onAddLanguage}
                  className="w-full rounded-[10px] px-3 py-2 text-left text-sm font-semibold text-sage-deep hover:bg-black/[0.03]"
                >
                  {t("col.addLanguage")}
                </button>
              </li>
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
