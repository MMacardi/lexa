import { translationsOf } from "@/lib/i18n";
import { GOALS } from "@/components/HskFirstRun";

// The goal and interests are text in the coach memory (the model reads text), but
// for Chinese they are picked the way onboarding picks them: chips. The text is
// read back into chips by matching the labels in any interface language; what
// matches none stays as a chip of its own, so nothing typed earlier is lost. The
// old "HSK 4 (in 1–3 months)" is the exam reason — the level and day live in the
// plan above now, and the coach reads them from there.
export function parseChips(text: string, options: { id: string; key: string }[]) {
  const on = new Set<string>();
  const extra: string[] = [];
  for (const piece of text.split(/\s*[,，、;；]\s*/).map((p) => p.trim()).filter(Boolean)) {
    if (/^HSK\s*[\d–-]/i.test(piece) && options.some((o) => o.id === "exam")) {
      on.add("exam");
      continue;
    }
    const hit = options.find((o) => translationsOf(o.key).some((l) => l.toLowerCase() === piece.toLowerCase()));
    if (hit) on.add(hit.id);
    else if (!extra.includes(piece)) extra.push(piece);
  }
  return { on, extra };
}

// The saved goal as the learner reads it now. It is kept as the labels of the language
// onboarding was answered in, so a Russian screen showed "Pass the HSK"; each reason is
// read back to its id, as the chips do, and named in today's language. Typed text stays.
// GOALS is read in the call, not at load: HskFirstRun imports CoachPicks, which imports this.
export function goalInLocale(text: string, t: (key: string) => string): string {
  const why = GOALS.map((g) => ({ id: g.id, key: `onb.goal.${g.id}` }));
  const { on, extra } = parseChips(text, why);
  return [...why.filter((o) => on.has(o.id)).map((o) => t(o.key)), ...extra].join(", ");
}
