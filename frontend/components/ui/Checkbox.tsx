"use client";

import { cn } from "@/lib/utils";

// App-styled checkbox (a controlled button, not a native <input>) so it looks
// consistent in light and dark themes instead of the stark native box.
export function Checkbox({
  checked,
  onChange,
  ariaLabel,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onChange(!checked);
      }}
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors",
        checked
          ? "border-sage bg-sage text-white"
          : "border-ink-faint/50 bg-surface hover:border-sage/70",
        className,
      )}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
