"use client";

import { cn } from "@/lib/utils";

// App-styled checkbox so it looks consistent in light and dark themes instead
// of the stark native box. By default it's an interactive <button>; pass
// `presentational` when it lives inside another clickable element (e.g. a row
// <button>) — it then renders a non-interactive <span> so we don't nest a
// button inside a button (invalid HTML → hydration error) and let the parent
// handle the click.
export function Checkbox({
  checked,
  onChange,
  ariaLabel,
  className,
  presentational = false,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  ariaLabel?: string;
  className?: string;
  presentational?: boolean;
}) {
  const boxClass = cn(
    "flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors",
    checked
      ? "border-sage bg-sage text-white"
      : "border-ink-faint/50 bg-surface hover:border-sage/70",
    className,
  );

  const icon = checked && (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  if (presentational) {
    return (
      <span role="checkbox" aria-checked={checked} aria-label={ariaLabel} className={boxClass}>
        {icon}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onChange?.(!checked);
      }}
      className={boxClass}
    >
      {icon}
    </button>
  );
}
