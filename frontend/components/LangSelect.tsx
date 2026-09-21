"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { PICKER_LANGS, displayCode, langLabel } from "@/lib/langs";
import { addCustomLang, removeCustomLang, useCustomLangs } from "@/lib/customLangs";
import { useI18n } from "@/lib/i18n";
import { useDialog } from "@/lib/dialog";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/motion";

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
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  menuClassName?: string;
  allowAuto?: boolean;
  autoLabel?: string;
  placeholder?: string; // shown while value is "" (nothing picked yet)
}) {
  const { t } = useI18n();
  const { prompt, confirm } = useDialog();
  const [open, setOpen] = useState(false);
  const menu = usePresence(open);
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const custom = useCustomLangs();
  const all = [
    ...(allowAuto ? [{ code: "auto", label: autoLabel, name: autoLabel }] : []),
    // zh-Hant (legacy traditional records) is not offered anywhere; such a value
    // still resolves to the plain "Chinese" entry for display.
    ...PICKER_LANGS.map((l) => ({ code: l.code, label: langLabel(l.code), name: l.name })),
    ...custom.map((c) => ({ code: c.code, label: c.name, name: c.name })),
  ];
  const current = all.find((l) => l.code === displayCode(value));

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
    ? all.filter(
        (l) =>
          l.label.toLowerCase().includes(q) || l.name.toLowerCase().includes(q) || l.code.includes(q),
      )
    : all;

  const onAddLanguage = async () => {
    const name = (
      await prompt({
        title: t("dialog.addLanguageTitle"),
        message: t("col.langPrompt"),
        placeholder: "Portuguese",
        confirmLabel: t("common.add"),
      })
    )?.trim();
    if (!name) {
      setOpen(false);
      return;
    }
    // A learner can type anything here, so the AI decides whether it is a language it
    // can actually work with: recognized → full AI cards under its canonical name;
    // unrecognized → warn, and keep it as manual-entry only if they still want it.
    setChecking(true);
    let finalName = name;
    let ai = true;
    try {
      const r = await api.checkLanguage(name);
      if (r.isLanguage) {
        finalName = r.canonicalName || name;
      } else {
        const anyway = await confirm({
          title: t("lang.notATitle", { name }),
          message: t("lang.notAMsg", { name }),
          confirmLabel: t("common.add"),
        });
        if (!anyway) {
          setOpen(false);
          return;
        }
        ai = false;
      }
    } catch {
      /* best-effort: a failed check keeps AI on rather than downgrading a real language */
    } finally {
      setChecking(false);
    }
    setOpen(false);
    const lang = addCustomLang(finalName, { ai });
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
        <span className={cn(!value && "text-ink-faint")}>{current?.label ?? (value || placeholder)}</span>
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

      {menu.mounted &&
        rect &&
        createPortal(
          <div
            data-closing={menu.closing || undefined}
            ref={menuRef}
            // Marks the menu as part of the picker for popovers that host one and
            // close on an outside click (the Mika pair popover) — it renders here,
            // in a portal, not inside them.
            data-lang-menu=""
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
                const manualOnly = custom.some((c) => c.code === l.code && c.ai === false);
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
                      <span className="truncate">{l.label}</span>
                      {manualOnly && (
                        <span className="ml-2 shrink-0 rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-semibold text-ink-faint">
                          {t("lang.manualOnly")}
                        </span>
                      )}
                      {active && <span className="ml-2 shrink-0 text-sage">✓</span>}
                    </button>
                    {isCustom && (
                      <button
                        type="button"
                        aria-label={t("col.removeLang")}
                        onClick={async () => {
                          // Removing the language only removes it from the picker: cards
                          // already saved in it keep their language code and stay in the deck.
                          const ok = await confirm({
                            title: t("col.removeLangTitle"),
                            message: t("col.removeLangConfirm", { name: l.name }),
                            confirmLabel: t("common.delete"),
                            tone: "danger",
                          });
                          if (!ok) return;
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
                  disabled={checking}
                  className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm font-semibold text-sage-deep hover:bg-black/[0.03] disabled:opacity-60"
                >
                  {checking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {checking ? t("lang.checking") : t("col.addLanguage")}
                </button>
              </li>
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
