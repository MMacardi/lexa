"use client";

import { useRouter } from "next/navigation";

// Returns a function that takes the learner to the Pro upgrade screen — used when
// a free user taps a locked Pro control.
export function useUpsell(): () => void {
  const router = useRouter();
  return () => router.push("/pro");
}
