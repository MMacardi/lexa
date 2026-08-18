import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A small pill for one-tap quick selection (recent pairs, collections, …).
export function QuickChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors",
        active
          ? "border-sage bg-sage text-white"
          : "border-black/[0.12] bg-surface text-ink-muted hover:border-sage/60",
      )}
    >
      {children}
    </button>
  );
}
