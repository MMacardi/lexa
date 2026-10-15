import type { Situation } from "../services/wordPages.js";

// The goal and interests a learner picks in onboarding are kept as the chips' labels,
// in the language they answered in (coach memory, zh): "Технологии и IT, Игры и
// аниме". The model reads them as text; to use them as more than that, a label is
// read back to its chip. The labels are frontend lib/i18n.tsx's "onb.int.*" and
// "onb.goal.*", kept in step by hand.

const INTEREST_LABELS: Record<string, string[]> = {
  food: ["Food & cooking", "Еда и кулинария", "美食烹饪"],
  travel: ["Travel", "Путешествия", "旅行"],
  tech: ["Tech & IT", "Технологии и IT", "科技与 IT"],
  business: ["Business & money", "Бизнес и финансы", "商业与金融"],
  films: ["Films & dramas", "Кино и дорамы", "电影和电视剧"],
  music: ["Music", "Музыка", "音乐"],
  sport: ["Sport", "Спорт", "运动"],
  games: ["Games & anime", "Игры и аниме", "游戏和动漫"],
  science: ["Science", "Наука", "科学"],
  history: ["History & culture", "История и культура", "历史文化"],
  nature: ["Nature & animals", "Природа и животные", "自然与动物"],
  fashion: ["Fashion & beauty", "Мода и красота", "时尚美妆"],
};

const GOAL_LABELS: Record<string, string[]> = {
  study: ["Study in China", "Учёба в Китае", "去中国留学"],
  work: ["Work and business", "Работа и бизнес", "工作和商务"],
  travel: ["Travel", "Путешествия", "旅行"],
  media: ["Dramas, music, games", "Дорамы, музыка, игры", "剧、音乐、游戏"],
  people: ["Friends and family", "Друзья и семья", "朋友和家人"],
};

// The situations (services/wordPages SITUATIONS) a chip makes worth a day's theme.
// "Pass the HSK" and "For myself" name none: the exam's texts are about everything.
const INTEREST_SITUATIONS: Record<string, Situation[]> = {
  food: ["restaurant", "cooking", "market"],
  travel: ["airport", "transit", "hotel", "sightseeing", "directions", "driving"],
  tech: ["computers", "phone", "social_media", "science"],
  business: ["business", "office", "bank", "economy", "job_search"],
  films: ["arts"],
  music: ["arts", "party"],
  sport: ["fitness"],
  games: ["hobbies", "computers"],
  science: ["science", "environment", "university"],
  history: ["history", "festivals", "books"],
  nature: ["nature", "weather", "environment", "countryside"],
  fashion: ["clothes", "shopping"],
};

const GOAL_SITUATIONS: Record<string, Situation[]> = {
  study: ["university", "classroom", "renting"],
  work: ["office", "business", "job_search"],
  travel: ["airport", "transit", "hotel", "sightseeing", "directions", "restaurant"],
  media: ["arts", "hobbies", "social_media"],
  people: ["family", "dating", "party", "wedding"],
};

/** The chips a saved text names, matched in any of the three languages; anything typed stays out. */
function chipsOf(text: string, labels: Record<string, string[]>): string[] {
  const pieces = text
    .split(/\s*[,，、;；\n]\s*/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return Object.keys(labels).filter((id) => labels[id].some((l) => pieces.includes(l.toLowerCase())));
}

/**
 * The situations a learner's goal and interests point at. A goal's label holds commas
 * of its own ("Дорамы, музыка, игры"), so goals are matched on the whole text first.
 */
export function likedSituations(goal: string, interests: string): Set<Situation> {
  const out = new Set<Situation>();
  for (const id of chipsOf(interests, INTEREST_LABELS)) for (const s of INTEREST_SITUATIONS[id]) out.add(s);
  const g = goal.toLowerCase();
  for (const [id, labels] of Object.entries(GOAL_LABELS)) {
    if (labels.some((l) => g.includes(l.toLowerCase()))) for (const s of GOAL_SITUATIONS[id]) out.add(s);
  }
  return out;
}
