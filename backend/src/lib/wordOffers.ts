// A single Chinese subject in a Russian/English question is not a request to
// collect every word used in its explanation. Bulk requests retain the model's list.
export function focusedWords(question: string, offered: string[]): string[] {
  const words = [...new Set(offered.map((w) => w.trim()).filter(Boolean))];
  if (/(?:все\s+слова|список|подборк|\d+\s+слов|несколько\s+слов|другие\s+слова|all\s+(?:the\s+)?words|vocabulary|\d+\s+words|word\s+list|suggest\s+words|全部|所有|生词|推荐.*词)/iu.test(question)) return words;
  const han = question.match(/[\p{Script=Han}]+/gu) ?? [];
  if (han.length !== 1 || han[0].length > 12 || (!/[a-zа-яё]/iu.test(question) && question.trim() !== han[0])) return words;
  return [han[0]];
}
