// UTF-16 character budget, shared by Mika and card follow-ups. Keep whole turns:
// the newest question is never clipped to make room for an older answer.
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
