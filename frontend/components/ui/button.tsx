import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "dark" | "outline" | "warn" | "ghost";
type Size = "default" | "sm" | "lg";

const variants: Record<Variant, string> = {
  default: "bg-sage text-white hover:bg-sage-deep",
  dark: "bg-ink text-paper hover:bg-ink/90",
  outline: "border border-black/[0.08] bg-surface text-ink-muted hover:bg-black/[0.03]",
  warn: "border-[1.5px] border-warn bg-surface text-warn-text hover:bg-warn-bg",
  ghost: "text-ink-muted hover:bg-black/[0.04]",
};

const sizes: Record<Size, string> = {
  default: "h-11 px-5 text-[15px]",
  sm: "h-9 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
