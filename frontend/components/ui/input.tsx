import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-[14px] border border-black/[0.08] bg-surface px-4 text-[15px] text-ink placeholder:text-[#b3aa9a] focus:border-sage focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}
