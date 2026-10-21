// Chinese terms must be intentional quotations; examples get their own line.
export function teachingLanguageIssue(answer: string, target: string): string | null {
  if (target !== "ru") return null;
  if (!/[А-Яа-яЁё]/.test(answer)) return "The explanation and translations must be in Russian.";
  const lines = answer.split(/\r?\n|(?:\\r)?\\n/);
  const plainLine = (s: string) => s.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "");
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
    const example = line.replace(/^(?:Пример|Исправленный вариант|Правильно):\s*/i, "");
    // Indentation marks the translated half of an example in this layout.
    // Its source must not be Russian, even when the model drops all Chinese.
    const nextLine = lines[i + 1] ?? "";
    if (/[А-Яа-яЁё]/.test(example) && /^\s{2,}\S/.test(nextLine) && /[А-Яа-яЁё]/.test(nextLine)) {
      return "Write each example sentence entirely in the studied language, followed by its complete Russian translation. Do not repeat a Russian sentence as both the example and its translation, or insert a Chinese word into a Russian example. Keep Russian explanations with quoted terms on their own prose lines.";
    }
    if (!/\p{Script=Han}/u.test(line)) continue;
    // Chinese-only prose used to pass as an example, including untranslated
    // introductions. An actual example needs its own Russian translation.
    if (!/[А-Яа-яЁё]/.test(example)) {
      let next = i + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      // Keep older answers with a separate pinyin line readable too.
      if (/[\p{Script=Latin}]/u.test(lines[next] ?? "") && /^[\p{Script=Latin}\p{M}\d\s.,!?…'’"():;—–*\-]+$/u.test(plainLine(lines[next] ?? ""))) {
        next++;
        while (next < lines.length && !lines[next].trim()) next++;
      }
      const translation = lines[next] ?? "";
      if (!/[А-Яа-яЁё]/.test(translation) || /\p{Script=Han}/u.test(translation)) {
        return "Untranslated Chinese-only line: introductions and explanations must be in Russian. Keep Chinese only as taught terms or example sentences, each followed immediately by a complete Russian translation. For word meanings, begin with each requested term and its Russian meaning.";
      }
      continue;
    }
    const previous = lines[i - 1] ?? "";
    if ((/^\s{2,}\S/.test(raw) && /\p{Script=Han}/u.test(previous) && !/[А-Яа-яЁё]/.test(previous)) || /^\s*(?:Перевод|По-русски):/i.test(line)) {
      return "Translate the example completely into Russian. Do not hide an untranslated Chinese fragment inside bold or quotes in the translation line.";
    }
    const prose = line.replace(/\*\*[^*]+\*\*|`[^`]+`|«[^»]+»|“[^”]+”|"[^"]+"|「[^」]+」/g, "");
    if (/\p{Script=Han}/u.test(prose)) return "Untranslated Chinese in Russian prose: put taught terms in **bold** or quotation marks, examples on their own lines, and translate every clause fully into Russian.";
  }
  return null;
}

export const russianTeachingRule = (target: string) => target === "ru"
  ? " RUSSIAN EXPLANATIONS: write coherent Russian prose, including the opening, labels and connecting words. For a vocabulary question, begin with each requested term and its Russian meaning; do not preface the meanings with a Chinese introduction or level announcement. Put every Chinese term inside **bold** or quotation marks; Chinese example sentences belong on separate lines, followed by a fully Russian translation. An example must be entirely in the studied language, never a Russian sentence with a foreign term inserted. Never leave a Chinese clause or word untranslated inside a Russian translation. Quoting a term intentionally is fine. Earlier mixed-language replies are not a style to copy."
  : "";

// One silent repair at most. The caller's final event replaces provisional deltas.
export async function checkedTeachingReply<T extends { answer: string }>(
  ask: (repair?: string) => Promise<T>, target: string, signal?: AbortSignal,
): Promise<T> {
  let issue: string | null;
  try {
    const result = await ask();
    issue = teachingLanguageIssue(result.answer, target);
    if (!issue) return result;
  } catch (err) {
    if (signal?.aborted || (err as Error).name === "AbortError") throw err;
    if ((err as Error).name !== "ZodError" && !(err as Error).message.startsWith("LLM did not return valid JSON")) throw err;
    issue = 'Return a JSON object using the requested schema and all required fields, never a bare string.';
  }
  signal?.throwIfAborted();
  const result = await ask(issue);
  signal?.throwIfAborted();
  if (teachingLanguageIssue(result.answer, target)) throw new Error("Mika could not produce an explanation in the requested language. Please try again.");
  return result;
}
