import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

// Multi-line field styling (matches Input, but wraps so long examples/notes are
// fully visible and editable instead of being clipped in a one-line box).
// `field-sizing:content` auto-grows the box to fit the text, so the whole example
// is visible by default (no manual dragging); resize-y still allows manual tweak.
export const textareaClass =
  "w-full resize-y rounded-[14px] border border-black/[0.08] bg-surface px-4 py-2.5 text-[16px] leading-relaxed text-ink placeholder:text-[#b3aa9a] focus:border-sage focus:outline-none sm:text-[15px] [field-sizing:content] min-h-[46px]";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        // 16px on mobile prevents iOS Safari from auto-zooming on focus; 15px from sm up.
        "h-11 w-full rounded-[14px] border border-black/[0.08] bg-surface px-4 text-[16px] text-ink placeholder:text-[#b3aa9a] focus:border-sage focus:outline-none sm:text-[15px]",
        className,
      )}
      {...props}
    />
  );
}
