"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Collection } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { Checkbox } from "@/components/ui/Checkbox";
import { cn } from "@/lib/utils";

// Pretty dropdown multi-select for collections (same look as LangSelect, but you
// can tick several). Menu is portalled to <body> so it floats above the page.
export function CollectionMultiSelect({
  options,
  value,
  onChange,
  className,
  menuClassName,
}: {
  options: Collection[];
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
  menuClassName?: string;
}) {
  const { t } = useI18n();
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Create a new set inline and immediately select it.
  const createSet = useMutation({
    mutationFn: (name: string) => api.createCollection(name, accountId),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["collections"] });
      onChange([...value, created.id]);
      setNewName("");
    },
  });

  useLayoutEffect(() => {
    if (open && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    if (open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const reposition = () => {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    };
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

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  const selected = options.filter((o) => value.includes(o.id));
  const summary =
    selected.length === 0
      ? t("col.noCollection")
      : selected.length === 1
        ? selected[0].name
        : t("col.nSets", { n: selected.length });

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 min-w-[160px] items-center justify-between gap-2 rounded-[12px] border bg-surface px-3 text-sm font-medium transition-colors",
          open ? "border-sage" : "border-black/[0.08] hover:border-black/20",
          selected.length ? "text-ink" : "text-ink-faint",
        )}
      >
        <span className="truncate">{summary}</span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          className={cn("shrink-0 text-ink-faint transition-transform", open && "rotate-180")}
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
            style={{ left: rect.left, top: rect.bottom + 6, minWidth: Math.max(rect.width, 220) }}
          >
            {options.length > 6 && (
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("col.searchSets")}
                className="border-b border-black/[0.06] bg-transparent px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
              />
            )}
            <ul className="overflow-auto p-1.5">
              {filtered.length === 0 && (
                <li className="px-3 py-3 text-center text-sm text-ink-faint">{t("col.noSets")}</li>
              )}
              {filtered.map((o) => {
                const on = value.includes(o.id);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => toggle(o.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm transition-colors",
                        on ? "text-sage-deep" : "text-ink hover:bg-black/[0.03]",
                      )}
                    >
                      <Checkbox presentational checked={on} />
                      <span className="flex-1 truncate font-medium">{o.name}</span>
                      <span className="text-xs text-ink-faint">{o.count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {/* create a new set inline (like the rest of the app) */}
            <form
              className="flex items-center gap-1.5 border-t border-black/[0.06] p-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const name = newName.trim();
                if (name && !createSet.isPending) createSet.mutate(name);
              }}
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("col.newSetPlaceholder")}
                className="h-8 min-w-0 flex-1 rounded-[10px] border border-black/[0.08] bg-surface px-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newName.trim() || createSet.isPending}
                className="shrink-0 rounded-[10px] bg-sage px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sage-deep disabled:opacity-40"
              >
                ＋
              </button>
            </form>
          </div>,
          document.body,
        )}
    </div>
  );
}
