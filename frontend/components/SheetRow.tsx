"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// A row in a phone bottom sheet (MobileSheet): an action, or a setting with a
// switch when `on` is given. Thumb-sized, with an optional line on what it does.
export function SheetRow({
  Icon,
  label,
  hint,
  on,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  hint?: string;
  on?: boolean;
  onClick: () => void;
}) {
  const isSwitch = on !== undefined;
  return (
    <button
      type="button"
      role={isSwitch ? "switch" : undefined}
      aria-checked={isSwitch ? on : undefined}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-black/[0.03] active:bg-black/[0.05]"
    >
      <Icon className={cn("h-[19px] w-[19px] shrink-0", on ? "text-sage-deep" : "text-ink-soft")} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-faint">{hint}</span>}
      </span>
      {isSwitch && (
        <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-sage" : "bg-black/15")}>
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200",
              on ? "left-[18px]" : "left-0.5",
            )}
          />
        </span>
      )}
    </button>
  );
}
