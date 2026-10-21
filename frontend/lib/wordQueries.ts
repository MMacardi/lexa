import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { fetchWordsCached, forgetWordCache, mirrorWord, mirrorWords, wordWasDeleted } from "./sync";
import { api, ApiError, type Word } from "./api";
import { cacheScope, sameScope } from "./sessionCache";

/** Clear every surface that can still offer an action for this owned card. */
export async function removeWordCaches(qc: QueryClient, accountId: string, id: string, { detail = true } = {}) {
  const { revision } = cacheScope();
  if (cacheScope().owner !== accountId) return;
  const forgotten = forgetWordCache(accountId, id);
  await Promise.all([
    qc.cancelQueries({ queryKey: ["words", accountId] }),
    qc.cancelQueries({ queryKey: ["word", id] }),
    qc.cancelQueries({ queryKey: ["review"] }),
  ]);
  if (!sameScope(accountId, revision)) return;
  qc.setQueryData<Word[]>(["words", accountId], (words) => words?.filter((w) => w.id !== id));
  const query = qc.getQueryCache().find({ queryKey: ["word", id], exact: true });
  if (query) query.setState(detail
    ? { data: undefined, error: new ApiError("Word not found", 404), status: "error" }
    : { data: undefined });
  await forgotten;
  for (const key of ["words", "review", "stats", "collections"]) void qc.invalidateQueries({ queryKey: [key] });
}

export async function deleteWordCached(qc: QueryClient, accountId: string, id: string) {
  const { revision } = cacheScope();
  await api.deleteWord(id);
  if (sameScope(accountId, revision)) await removeWordCaches(qc, accountId, id);
}

/** Keep list, open cards, and offline snapshots together as enrichment lands. */
export function updateWordCaches(qc: QueryClient, accountId: string, fresh: Word[], { list = true, details = true } = {}) {
  if (cacheScope().owner !== accountId) return;
  fresh = fresh.filter((w) => !wordWasDeleted(accountId, w.id));
  const byId = new Map(fresh.map((w) => [w.id, w]));
  if (list) {
    qc.setQueryData<Word[]>(["words", accountId], (words) => words?.filter((w) => !wordWasDeleted(accountId, w.id)).map((w) => byId.get(w.id) ?? w));
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
