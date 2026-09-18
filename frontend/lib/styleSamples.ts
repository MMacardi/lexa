import type { ExampleStyle } from "./learnPrefs";

type Register = Exclude<ExampleStyle, "none">;

// One simple word ("rain") written in each example register, per language — the
// style picker shows these so a learner compares real sentences instead of
// abstract labels. Hand-written (no model call). Unknown languages fall back to
// English.
export const STYLE_SAMPLES: Record<string, Record<Register, string>> = {
  en: {
    casual: "Take an umbrella — it's going to rain later.",
    dialogue: "— Is it still raining? — Yeah, pouring. Let's wait a bit.",
    news: "Heavy rain is expected to disrupt traffic across the region on Monday.",
    literary: "The rain whispered against the window like an old secret.",
  },
  ru: {
    casual: "Возьми зонт — вечером будет дождь.",
    dialogue: "— Дождь ещё идёт? — Ага, льёт как из ведра. Давай подождём.",
    news: "В понедельник сильный дождь может осложнить движение в регионе.",
    literary: "Дождь тихо шептал в окно, словно старую тайну.",
  },
  zh: {
    casual: "带把伞吧，晚上要下雨。",
    dialogue: "——还在下雨吗？——对，下得很大，我们等一会儿吧。",
    news: "预计周一强降雨将影响全区交通。",
    literary: "雨轻轻敲着窗，像在诉说一个古老的秘密。",
  },
  es: {
    casual: "Coge el paraguas, que esta tarde viene lluvia.",
    dialogue: "— ¿Sigue la lluvia? — Sí, y fuerte. Esperemos un poco.",
    news: "Se prevé que la lluvia intensa afecte al tráfico en toda la región el lunes.",
    literary: "La lluvia susurraba contra la ventana como un viejo secreto.",
  },
  de: {
    casual: "Nimm einen Schirm mit, heute Abend gibt's Regen.",
    dialogue: "— Ist der Regen schon vorbei? — Nee, es schüttet. Lass uns kurz warten.",
    news: "Starker Regen dürfte am Montag den Verkehr in der gesamten Region beeinträchtigen.",
    literary: "Der Regen flüsterte gegen das Fenster wie ein altes Geheimnis.",
  },
  fr: {
    casual: "Prends un parapluie, il y aura de la pluie ce soir.",
    dialogue: "— La pluie s'est arrêtée ? — Non, il tombe des cordes. On attend un peu.",
    news: "De fortes pluies devraient perturber la circulation dans toute la région lundi.",
    literary: "La pluie murmurait contre la vitre comme un vieux secret.",
  },
  ja: {
    casual: "傘持っていきなよ、夜は雨だって。",
    dialogue: "「まだ雨降ってる？」「うん、すごいよ。ちょっと待とう。」",
    news: "月曜日は大雨により、地域全体で交通の乱れが予想されます。",
    literary: "雨は古い秘密をささやくように、窓を静かに叩いていた。",
  },
  ko: {
    casual: "우산 챙겨, 저녁에 비 온대.",
    dialogue: "“아직 비 와?” “응, 엄청 와. 좀 기다리자.”",
    news: "월요일 많은 비로 지역 전역에서 교통 혼잡이 예상됩니다.",
    literary: "비는 오래된 비밀을 속삭이듯 창문을 두드렸다.",
  },
};

export function styleSample(lang: string, style: Register): string {
  const base = lang.split("-")[0];
  return (STYLE_SAMPLES[lang] ?? STYLE_SAMPLES[base] ?? STYLE_SAMPLES.en)[style];
}

// Is there a hand-written sample for this language (vs the English fallback)?
export function hasStyleSample(lang: string): boolean {
  return !!(STYLE_SAMPLES[lang] ?? STYLE_SAMPLES[lang.split("-")[0]]);
}
