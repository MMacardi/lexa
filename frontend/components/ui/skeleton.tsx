import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

// Subtle shimmer placeholder shown while data loads.
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-slate-200/70", className)}
      {...props}
    />
  );
}
