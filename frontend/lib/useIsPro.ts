"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useSimulateFree } from "@/lib/learnPrefs";

// Whether the current account is on Pro (uncapped). Reuses the plan/usage query
// so it's one shared request, and honours the "test the free tier" toggle (the
// usage endpoint reflects it). Defaults to Pro while loading to avoid flashing
// locks on Pro/beta accounts.
export function useIsPro(): boolean {
  const { accountId } = useAccount();
  const simFree = useSimulateFree();
  const { data } = useQuery({
    queryKey: ["ai-usage", accountId, simFree],
    queryFn: () => api.aiUsage(accountId),
    staleTime: 60_000,
  });
  return data?.pro ?? true;
}
