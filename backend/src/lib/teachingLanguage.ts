// Chinese terms must be intentional quotations; examples get their own line.
export function teachingLanguageIssue(answer: string, target: string): string | null {
  if (target !== "ru") return null;
  if (!/[А-Яа-яЁё]/.test(answer)) return "The explanation and translations must be in Russian.";
  const lines = answer.split(/\r?\n|(?:\\r)?\\n/);
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
    if (!/\p{Script=Han}/u.test(line)) continue;
    // An example is Chinese only, optionally introduced by an explicit label.
    const example = line.replace(/^(?:Пример|Исправленный вариант|Правильно):\s*/i, "");
    if (!/[А-Яа-яЁё]/.test(example)) continue;
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
  ? " RUSSIAN EXPLANATIONS: write coherent Russian prose. Put every Chinese term inside **bold** or quotation marks; Chinese example sentences belong on separate lines, followed by a fully Russian translation. Never leave a Chinese clause or word untranslated inside a Russian translation. Quoting a term intentionally is fine."
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
