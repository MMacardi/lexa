import { z } from "zod";
import { chatJson } from "./llm.js";

// Adding a custom language used to accept any typed string, so «Klingon» or a stray
// word got full AI enrichment that confidently produced garbage. One cheap call
// decides whether the name is a real human language the model can actually work with;
// when it isn't, the client keeps the language but turns AI off (manual entry only).

const checkSchema = z.object({
  isLanguage: z.boolean(),
  canonicalName: z.string().default(""),
});

export interface LangCheck {
  isLanguage: boolean;
  canonicalName: string;
}

export async function checkLanguage(name: string): Promise<LangCheck> {
  const r = await chatJson({
    system:
      `You validate language names for a vocabulary app. Decide whether the input names a REAL, attested ` +
      `human language a multilingual model could plausibly translate to and from — including regional, ` +
      `minority and planned languages with real reference material (Esperanto counts). It is NOT a language ` +
      `if it is a country, a city, a fictional or joke language (Klingon, Elvish, Dothraki), a random word, ` +
      `a person's name, or nonsense. Be lenient with spelling, casing, and the fact that the name may be an ` +
      `endonym written in another script. ` +
      `Return "canonicalName": the language's standard English name ("" if it is not a language). ` +
      'Respond as JSON: {"isLanguage": boolean, "canonicalName": string}.',
    user: `Input: ${name.trim().slice(0, 120)}`,
    schema: checkSchema,
    label: "lang.check",
    timeoutMs: 20000,
  });
  return { isLanguage: !!r.isLanguage, canonicalName: (r.canonicalName ?? "").trim() };
}
