// The mounted Reader publishes its current passage; each sent turn keeps a snapshot
// so expanding Mika, reloading or reopening history retains the passage discussed.
export type ReaderContext = {
  id?: string; title?: string; content: string; selection?: string; sentence?: string;
  sourceLang: string; targetLang: string;
};
let current: ReaderContext | undefined;
let owner = "";
export const getReaderContext = (accountId: string) => owner === accountId ? current : undefined;
export const setReaderContext = (value?: ReaderContext, accountId = "") => { current = value; owner = accountId; };
export const CHAT_TURNS = 120;
export const CHAT_CHARS = 64_000;
export function chatWindow<T extends { content: string }>(messages: T[]): T[] {
  let chars = 0;
  let start = messages.length;
  while (start > 0 && messages.length - start < CHAT_TURNS) {
    const size = messages[start - 1].content.length;
    if (chars + size > CHAT_CHARS) break;
    chars += size;
    start--;
  }
  return messages.slice(start);
}
