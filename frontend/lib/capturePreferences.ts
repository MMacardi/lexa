import { getExampleStyle, getLearnerLevel } from "./learnPrefs";

/** Captures reuse the saved example choices without interrupting each tap. */
export function capturePreferences(sourceLang: string) {
  return { exampleStyle: getExampleStyle(), level: getLearnerLevel(sourceLang) ?? undefined };
}
