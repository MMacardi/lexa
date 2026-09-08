// Hand-picked first words per LEARNING language — high-frequency, concrete and
// pleasant to see translated (greetings, everyday nouns, a verb, an adjective).
// The normal add flow enriches them into the learner's OWN native language, so a
// single curated list per source language covers every native language.
export const STARTER_DECKS: Record<string, string[]> = {
  en: ["hello", "thank you", "friend", "water", "food", "morning", "beautiful", "to learn", "money", "happy"],
  es: ["hola", "gracias", "amigo", "agua", "comida", "mañana", "bonito", "aprender", "dinero", "feliz"],
  fr: ["bonjour", "merci", "ami", "eau", "nourriture", "matin", "beau", "apprendre", "argent", "heureux"],
  de: ["hallo", "danke", "Freund", "Wasser", "Essen", "Morgen", "schön", "lernen", "Geld", "glücklich"],
  it: ["ciao", "grazie", "amico", "acqua", "cibo", "mattina", "bello", "imparare", "soldi", "felice"],
  pt: ["olá", "obrigado", "amigo", "água", "comida", "manhã", "bonito", "aprender", "dinheiro", "feliz"],
  ru: ["привет", "спасибо", "друг", "вода", "еда", "утро", "красивый", "учить", "деньги", "счастливый"],
  zh: ["你好", "谢谢", "朋友", "水", "食物", "早上", "漂亮", "学习", "钱", "开心"],
  "zh-Hant": ["你好", "謝謝", "朋友", "水", "食物", "早上", "漂亮", "學習", "錢", "開心"],
  ja: ["こんにちは", "ありがとう", "友だち", "水", "食べ物", "朝", "きれい", "習う", "お金", "嬉しい"],
  ko: ["안녕하세요", "감사합니다", "친구", "물", "음식", "아침", "예쁘다", "배우다", "돈", "행복하다"],
};

export function starterWords(lang: string): string[] {
  return STARTER_DECKS[lang] ?? [];
}

export function hasStarterDeck(lang: string): boolean {
  return (STARTER_DECKS[lang]?.length ?? 0) > 0;
}
