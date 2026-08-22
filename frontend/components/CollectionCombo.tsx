"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Plus } from "lucide-react";

// Pretty dropdown for choosing a collection — styled like LangSelect, but freeform:
// pick an existing collection, clear it, or type a new name to create one. The
// menu is portaled (fixed) so it floats above the modal and repositions on scroll.
export function CollectionCombo({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (open && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    if (open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => triggerRef.current && setRect(triggerRef.current.getBoundingClientRect());
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
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

  const q = query.trim();
  const filtered = q ? options.filter((c) => c.toLowerCase().includes(q.toLowerCase())) : options;
  const canCreate = q.length > 0 && !options.some((c) => c.toLowerCase() === q.toLowerCase());

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-[14px] border bg-surface px-3.5 text-[15px] transition-colors",
          open ? "border-sage" : "border-black/[0.08] hover:border-black/20",
        )}
      >
        <span className={cn("truncate font-medium", value ? "text-ink" : "text-ink-faint font-normal")}>
          {value || placeholder}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-faint transition-transform", open && "rotate-180")} />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            className="anim-scale-in fixed z-[95] flex max-h-72 flex-col overflow-hidden rounded-[14px] border border-black/[0.08] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.18)]"
            style={{ left: rect.left, top: rect.bottom + 6, minWidth: Math.max(rect.width, 200) }}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length === 1) pick(filtered[0]);
                  else if (canCreate) pick(q);
                }
              }}
              placeholder={t("reader.collSearch")}
              className="border-b border-black/[0.06] bg-transparent px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <ul className="overflow-auto p-1.5">
              {/* clear selection */}
              <li>
                <button
                  type="button"
                  onClick={() => pick("")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-[15px] transition-colors",
                    !value ? "bg-sage-tint font-semibold text-sage-deep" : "text-ink-muted hover:bg-black/[0.03]",
                  )}
                >
                  {t("reader.collNone")}
                  {!value && <Check className="h-4 w-4 text-sage" />}
                </button>
              </li>
              {filtered.map((c) => {
                const active = c === value;
                return (
                  <li key={c}>
                    <button
                      type="button"
                      onClick={() => pick(c)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-[15px] transition-colors",
                        active ? "bg-sage-tint font-semibold text-sage-deep" : "text-ink hover:bg-black/[0.03]",
                      )}
                    >
                      <span className="truncate">{c}</span>
                      {active && <Check className="h-4 w-4 shrink-0 text-sage" />}
                    </button>
                  </li>
                );
              })}
              {canCreate && (
                <li className="mt-1 border-t border-black/[0.06] pt-1">
                  <button
                    type="button"
                    onClick={() => pick(q)}
                    className="flex w-full items-center gap-1.5 rounded-[10px] px-3 py-2 text-left text-sm font-semibold text-sage-deep hover:bg-black/[0.03]"
                  >
                    <Plus className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t("reader.collCreate", { name: q })}</span>
                  </button>
                </li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
