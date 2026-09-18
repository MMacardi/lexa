"use client";

import { useDialog } from "./dialog";
import { useI18n } from "./i18n";
import { langLabel } from "./langs";
import { DEFAULT_EXAMPLE_STYLE, STYLE_ORDER, hasChosenExampleStyle, setExampleStyle, getExampleStyle, type ExampleStyle } from "./learnPrefs";
import { hasStyleSample, styleSample } from "./styleSamples";

const cjkFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" ? "font-zh" : "");

/**
 * Companion to useEnsureLevel: the first time an AI example is about to be
 * written, ask what the sentences should sound like — each option shows the same
 * simple word in that register, in the language being learned (plus a gloss in
 * the app language). Asked once; dismissing keeps the default (casual) and never
 * blocks the add.
 */
export function useEnsureStyle() {
  const { choose } = useDialog();
  const { t, locale } = useI18n();

  return async (lang: string): Promise<ExampleStyle> => {
    if (hasChosenExampleStyle()) return getExampleStyle();
    const sampleLang = lang && lang !== "auto" && hasStyleSample(lang) ? lang : "en";
    const picked = await choose({
      title: t("style.askTitle"),
      message: t("style.askQuestion", { lang: langLabel(sampleLang) }),
      layout: "list",
      options: STYLE_ORDER.filter((s) => s !== "none").map((s) => {
        const reg = s as Exclude<ExampleStyle, "none">;
        return {
          value: s,
          label: t(`style.${s}`),
          hint: t(`style.hint.${s}`),
          example: styleSample(sampleLang, reg),
          exampleClass: cjkFont(sampleLang),
          // gloss in the interface language when the sample is in another one
          exampleNote: sampleLang !== locale ? styleSample(locale, reg) : undefined,
          exampleNoteClass: cjkFont(locale),
          recommended: s === DEFAULT_EXAMPLE_STYLE,
        };
      }),
    });
    const style = (picked as ExampleStyle | null) ?? DEFAULT_EXAMPLE_STYLE;
    setExampleStyle(style); // remember either way so it's asked only once
    return style;
  };
}
