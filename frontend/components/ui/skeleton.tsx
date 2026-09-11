import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

// Shimmer placeholder shown while data loads (see `.skeleton` in globals.css).
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton rounded-md", className)} {...props} />;
}
