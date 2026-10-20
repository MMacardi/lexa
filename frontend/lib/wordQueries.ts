import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { fetchWordsCached, mirrorWord, mirrorWords } from "./sync";
import type { Word } from "./api";
import { cacheScope } from "./sessionCache";

/** Keep list, open cards, and offline snapshots together as enrichment lands. */
export function updateWordCaches(qc: QueryClient, accountId: string, fresh: Word[], { list = true, details = true } = {}) {
  if (cacheScope().owner !== accountId) return;
  const byId = new Map(fresh.map((w) => [w.id, w]));
  if (list) {
    qc.setQueryData<Word[]>(["words", accountId], (words) => words?.map((w) => byId.get(w.id) ?? w));
    const words = qc.getQueryData<Word[]>(["words", accountId]);
    if (words) void mirrorWords(accountId, words);
  }
  for (const word of fresh) {
    const detail = qc.getQueryData<Word>(["word", word.id]);
    const merged = { ...detail, ...word };
    if (details && detail) qc.setQueryData(["word", word.id], merged);
    void mirrorWord(accountId, merged);
  }
}

export const wordsQuery = (accountId: string) => queryOptions({
  queryKey: ["words", accountId],
  queryFn: () => fetchWordsCached(accountId),
  enabled: !!accountId,
  // IndexedDB must run even when TanStack pauses ordinary network queries.
  networkMode: "always",
  refetchOnReconnect: true,
});
