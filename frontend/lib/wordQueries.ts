import { queryOptions } from "@tanstack/react-query";
import { fetchWordsCached } from "./sync";

export const wordsQuery = (accountId: string) => queryOptions({
  queryKey: ["words", accountId],
  queryFn: () => fetchWordsCached(accountId),
  enabled: !!accountId,
  // IndexedDB must run even when TanStack pauses ordinary network queries.
  networkMode: "always",
  refetchOnReconnect: true,
});
