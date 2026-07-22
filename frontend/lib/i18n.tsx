"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Locale = "en" | "ru" | "zh";
export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "ru", label: "RU" },
  { code: "zh", label: "中" },
];

// Flat translation dictionary. Each key holds all three locales so they stay in
// sync. Use {var} placeholders; pass values via the second arg of t().
type Entry = { en: string; ru: string; zh: string };
const DICT: Record<string, Entry> = {
  // --- nav / chrome ---
  "nav.today": { en: "Today", ru: "Сегодня", zh: "今天" },
  "nav.flashcards": { en: "Flashcards", ru: "Карточки", zh: "闪卡" },
  "nav.recall": { en: "Quiz", ru: "Квиз", zh: "测验" },
  "nav.words": { en: "My words", ru: "Мои слова", zh: "我的单词" },
  "nav.collections": { en: "Collections", ru: "Коллекции", zh: "合集" },
  "side.mastered": { en: "words mastered", ru: "слов выучено", zh: "已掌握" },
  "side.collectedDue": { en: "{total} collected · {due} due", ru: "всего {total} · повторить {due}", zh: "{total} 个 · {due} 待复习" },
  "side.logout": { en: "Log out", ru: "Выйти", zh: "退出" },
  "side.account": { en: "Account", ru: "Аккаунт", zh: "账户" },
  "common.loading": { en: "Loading…", ru: "Загрузка…", zh: "加载中…" },

  // --- account / settings ---
  "account.title": { en: "My account", ru: "Мой аккаунт", zh: "我的账户" },
  "account.subtitle": { en: "Appearance, language and your connection.", ru: "Оформление, язык и подключение.", zh: "外观、语言与连接。" },
  "account.signedInAs": { en: "Signed in as", ru: "Вы вошли как", zh: "已登录为" },
  "account.appearance": { en: "Appearance", ru: "Оформление", zh: "外观" },
  "account.theme": { en: "Theme", ru: "Тема", zh: "主题" },
  "account.themeLight": { en: "Light", ru: "Светлая", zh: "浅色" },
  "account.themeDark": { en: "Dark", ru: "Тёмная", zh: "深色" },
  "account.language": { en: "Interface language", ru: "Язык интерфейса", zh: "界面语言" },
  "account.telegram": { en: "Telegram", ru: "Telegram", zh: "Telegram" },
  "account.telegramHint": { en: "Message @llmlangcardlearnerbot on Telegram to add words straight from your phone — they sync here automatically.", ru: "Напишите боту @llmlangcardlearnerbot в Telegram, чтобы добавлять слова прямо с телефона — они появятся здесь автоматически.", zh: "在 Telegram 给 @llmlangcardlearnerbot 发消息，即可用手机添加单词——会自动同步到这里。" },
  "account.openBot": { en: "Open the bot →", ru: "Открыть бота →", zh: "打开机器人 →" },
  "account.viaTelegram": { en: "Connected via Telegram", ru: "Вход через Telegram", zh: "已通过 Telegram 登录" },
  "account.devSession": { en: "Local dev session", ru: "Локальная сессия (dev)", zh: "本地会话" },

  // --- login ---
  "login.tagline": { en: "Learn English through the news. Sign in to start.", ru: "Учите языки по новостям. Войдите, чтобы начать.", zh: "通过新闻学语言。登录开始。" },
  "login.dev": { en: "dev sign-in", ru: "вход для разработки", zh: "开发登录" },
  "login.idPlaceholder": { en: "Telegram ID (e.g. 865277762)", ru: "Telegram ID (напр. 865277762)", zh: "Telegram ID（如 865277762）" },
  "login.enter": { en: "Enter", ru: "Войти", zh: "进入" },
  "login.devNote": { en: "The dev sign-in is for local testing; production uses Telegram login.", ru: "Этот вход нужен для локального теста; в продакшене — вход через Telegram.", zh: "开发登录用于本地测试；生产环境使用 Telegram 登录。" },

  // --- common ---
  "common.cancel": { en: "Cancel", ru: "Отмена", zh: "取消" },
  "common.save": { en: "Save", ru: "Сохранить", zh: "保存" },
  "common.add": { en: "Add", ru: "Добавить", zh: "添加" },
  "common.all": { en: "All", ru: "Все", zh: "全部" },
  "common.allWords": { en: "All words", ru: "Все слова", zh: "全部单词" },
  "common.noMatches": { en: "No matches.", ru: "Ничего не найдено.", zh: "无匹配。" },

  // --- today ---
  "today.emptyTitle": { en: "Start your collection", ru: "Соберите свою коллекцию", zh: "开始你的单词库" },
  "today.emptyText": { en: "Add your first word — I'll find a real news sentence and translate it.", ru: "Добавьте первое слово — я найду живой пример из новостей и переведу его.", zh: "添加第一个单词——我会找到真实的新闻例句并翻译。" },
  "today.greeting": { en: "Good day — ready for today's words?", ru: "Добрый день! Повторим слова?", zh: "你好——准备好今天的单词了吗？" },
  "today.startReview": { en: "Start review →", ru: "Начать повтор →", zh: "开始复习 →" },
  "today.dueForReview": { en: "due for review", ru: "к повторению", zh: "待复习" },
  "today.wordsCollected": { en: "words collected", ru: "слов в коллекции", zh: "已收集" },
  "today.stillLearning": { en: "still learning", ru: "в процессе", zh: "学习中" },
  "today.mastered": { en: "mastered", ru: "выучено", zh: "已掌握" },
  "today.duePanel": { en: "Due for review", ru: "Пора повторить", zh: "待复习" },
  "today.wordsReady": { en: "words ready", ru: "слов к повторению", zh: "个单词" },
  "today.dueBlurb": { en: "A quick flashcard session keeps your memory fresh — just a few minutes.", ru: "Короткая тренировка с карточками поможет закрепить слова.", zh: "快速闪卡练习让记忆常新——只需几分钟。" },
  "today.openFlashcards": { en: "Open flashcards →", ru: "Открыть карточки →", zh: "打开闪卡 →" },
  "today.wotd": { en: "Word of the day", ru: "Слово дня", zh: "每日单词" },
  "today.recent": { en: "Recently · from the news", ru: "Недавние · из новостей", zh: "最近 · 来自新闻" },
  "today.viewAll": { en: "View all →", ru: "Все слова →", zh: "查看全部 →" },

  // --- stats ---
  "stats.title": { en: "Your progress", ru: "Ваш прогресс", zh: "你的进度" },
  "stats.streakSummary": { en: "🔥 {n}-day streak", ru: "🔥 {n} дн. подряд", zh: "🔥 连续 {n} 天" },
  "stats.tile.collected": { en: "words collected", ru: "слов в коллекции", zh: "已收集" },
  "stats.tile.mastered": { en: "mastered", ru: "выучено", zh: "已掌握" },
  "stats.tile.trainedToday": { en: "trained today", ru: "повторено сегодня", zh: "今日练习" },
  "stats.tile.streak": { en: "day streak", ru: "дней подряд", zh: "连续天数" },
  "stats.wordsCollected": { en: "Words collected", ru: "Рост словаря", zh: "已收集单词" },
  "stats.metricCollected": { en: "Collected", ru: "Собрано", zh: "已收集" },
  "stats.metricMastered": { en: "Mastered", ru: "Выучено", zh: "已掌握" },
  "stats.total": { en: "{n} total", ru: "всего {n}", zh: "共 {n}" },
  "stats.today": { en: "today", ru: "сегодня", zh: "今天" },
  "stats.goal": { en: "Daily goal", ru: "Цель на день", zh: "每日目标" },
  "stats.goalReached": { en: "🎉 Daily goal reached!", ru: "🎉 Цель на день выполнена!", zh: "🎉 完成每日目标！" },
  "stats.goalGreat": { en: "Great work today.", ru: "Отличная работа!", zh: "今天做得很好。" },
  "stats.goalToGo": { en: "{n} cards to go", ru: "ещё {n} карточек", zh: "还差 {n} 张" },
  "stats.goalDone": { en: "done", ru: "готово", zh: "完成" },
  "stats.last7": { en: "Last 7 days", ru: "Последние 7 дней", zh: "最近 7 天" },
  "stats.byPair": { en: "By language pair", ru: "По языковым парам", zh: "按语言对" },
  "stats.byProgress": { en: "By progress", ru: "По прогрессу", zh: "按进度" },
  "stats.mastered": { en: "Mastered", ru: "Выучено", zh: "已掌握" },
  "stats.learning": { en: "Learning", ru: "В процессе", zh: "学习中" },
  "stats.new": { en: "New", ru: "Новые", zh: "新词" },
  "stats.achievements": { en: "Achievements · {done}/{total}", ru: "Достижения · {done}/{total}", zh: "成就 · {done}/{total}" },

  // --- achievements ---
  "ach.firstWord": { en: "First word", ru: "Первое слово", zh: "第一个词" },
  "ach.10words": { en: "10 words", ru: "10 слов", zh: "10 个词" },
  "ach.50words": { en: "50 words", ru: "50 слов", zh: "50 个词" },
  "ach.firstMastered": { en: "First mastered", ru: "Первое выучено", zh: "首个掌握" },
  "ach.10mastered": { en: "10 mastered", ru: "10 выучено", zh: "掌握 10 个" },
  "ach.streak3": { en: "3-day streak", ru: "3 дня подряд", zh: "连续 3 天" },
  "ach.streak7": { en: "7-day streak", ru: "7 дней подряд", zh: "连续 7 天" },
  "ach.dailyGoal": { en: "Daily goal", ru: "Цель на день", zh: "每日目标" },

  // --- toasts ---
  "toast.achievement": { en: "Achievement unlocked", ru: "Новое достижение", zh: "解锁成就" },
  "toast.milestone": { en: "Milestone reached!", ru: "Цель достигнута!", zh: "达成里程碑！" },
  "toast.goalTitle": { en: "Daily goal reached — {n} cards!", ru: "Цель на день выполнена — {n} карточек!", zh: "完成每日目标——{n} 张！" },
  "toast.goalSub": { en: "Keep the streak alive 🔥", ru: "Не прерывайте серию 🔥", zh: "保持连续 🔥" },
  "toast.goalLabel": { en: "Daily goal", ru: "Цель на день", zh: "每日目标" },

  // --- my words ---
  "words.title": { en: "My words", ru: "Мои слова", zh: "我的单词" },
  "words.count": { en: "{n} words", ru: "слов: {n}", zh: "{n} 个单词" },
  "words.empty": { en: "No words yet — add one above.", ru: "Слов пока нет — добавьте выше.", zh: "还没有单词——在上面添加。" },
  "words.set": { en: "Set", ru: "Набор", zh: "合集" },
  "words.pair": { en: "Pair", ru: "Пара", zh: "语言对" },
  "words.search": { en: "🔍  Search your words", ru: "🔍  Поиск по словам", zh: "🔍  搜索单词" },
  "words.pill.all": { en: "All {n}", ru: "Все {n}", zh: "全部 {n}" },
  "words.pill.learning": { en: "Learning {n}", ru: "В процессе {n}", zh: "学习 {n}" },
  "words.pill.mastered": { en: "Mastered {n}", ru: "Выучено {n}", zh: "掌握 {n}" },
  "words.col.word": { en: "Word", ru: "Слово", zh: "单词" },
  "words.col.meaning": { en: "Meaning", ru: "Значение", zh: "释义" },
  "words.col.source": { en: "Source", ru: "Источник", zh: "来源" },
  "words.col.mastery": { en: "Mastery", ru: "Прогресс", zh: "掌握度" },
  "words.deleteConfirm": { en: "Delete \"{word}\"?", ru: "Удалить «{word}»?", zh: "删除“{word}”？" },

  // --- add word form ---
  "add.auto": { en: "✨ Auto (AI)", ru: "✨ Авто (ИИ)", zh: "✨ 自动 (AI)" },
  "add.manual": { en: "✍️ Manual", ru: "✍️ Вручную", zh: "✍️ 手动" },
  "add.wordPlaceholder": { en: "Word in {lang}", ru: "Слово на языке: {lang}", zh: "{lang} 单词" },
  "add.meaningPlaceholder": { en: "Meaning ({lang}) — required", ru: "Значение ({lang}) — обязательно", zh: "释义（{lang}）— 必填" },
  "add.examplePlaceholder": { en: "Example sentence ({lang})", ru: "Пример предложения ({lang})", zh: "例句（{lang}）" },
  "add.exampleTrPlaceholder": { en: "Example translation ({lang})", ru: "Перевод примера ({lang})", zh: "例句翻译（{lang}）" },
  "add.sourcePlaceholder": { en: "Source (optional)", ru: "Источник (необязательно)", zh: "来源（可选）" },
  "add.submit": { en: "Add word →", ru: "Добавить →", zh: "添加 →" },
  "add.searching": { en: "Searching…", ru: "Ищу…", zh: "搜索中…" },
  "add.saving": { en: "Saving…", ru: "Сохраняю…", zh: "保存中…" },
  "add.checking": { en: "Checking…", ru: "Проверяю…", zh: "检查中…" },
  "add.toSet": { en: "Add to set", ru: "В набор", zh: "加入合集" },
  "add.didYouMean": { en: "Did you mean…", ru: "Возможно, вы имели в виду…", zh: "你是想输入…" },
  "add.asTyped": { en: "Add “{word}” manually", ru: "Добавить «{word}» вручную", zh: "手动添加“{word}”" },
  "add.findingSentence": { en: "Finding a real sentence and translating it — a few seconds…", ru: "Ищу живой пример и перевожу — пара секунд…", zh: "正在查找真实例句并翻译——几秒钟…" },

  // --- review (flashcards) ---
  "review.title": { en: "Quick review", ru: "Быстрое повторение", zh: "快速复习" },
  "review.direction": { en: "Direction", ru: "Направление", zh: "方向" },
  "review.wordToMeaning": { en: "Word → Meaning", ru: "Слово → Значение", zh: "单词 → 释义" },
  "review.meaningToWord": { en: "Meaning → Word", ru: "Значение → Слово", zh: "释义 → 单词" },
  "review.collection": { en: "Collection", ru: "Коллекция", zh: "合集" },
  "review.pairs": { en: "Language pairs", ru: "Языковые пары", zh: "语言对" },
  "review.onlyDue": { en: "Only words due for review", ru: "Только слова на повтор", zh: "仅待复习的词" },
  "review.start": { en: "Start — {n} cards →", ru: "Начать — карточек: {n} →", zh: "开始 — {n} 张 →" },
  "review.startOne": { en: "Start — {n} card →", ru: "Начать — 1 карточка →", zh: "开始 — {n} 张 →" },
  "review.nothing": { en: "Nothing to train in this selection", ru: "В этом выборе нечего повторять", zh: "此筛选下没有可练习的词" },
  "review.complete": { en: "Session complete", ru: "Сессия завершена", zh: "本组完成" },
  "review.reviewed": { en: "You reviewed {n} words.", ru: "Вы повторили слов: {n}.", zh: "你复习了 {n} 个单词。" },
  "review.known": { en: "known", ru: "знаю", zh: "认识" },
  "review.learningCount": { en: "learning", ru: "учу", zh: "学习中" },
  "review.backToSetup": { en: "Back to setup", ru: "К настройкам", zh: "返回设置" },
  "review.setup": { en: "⚙ Setup", ru: "⚙ Настройки", zh: "⚙ 设置" },
  "review.clickReveal": { en: "Click to reveal · {lang}", ru: "Нажмите, чтобы открыть · {lang}", zh: "点击显示 · {lang}" },
  "review.stillLearning": { en: "✕ Still learning", ru: "✕ Ещё учу", zh: "✕ 还在学" },
  "review.iKnow": { en: "✓ I know it", ru: "✓ Знаю", zh: "✓ 认识" },
  "review.dragHint": { en: "Drag the card left or right, or use the buttons.", ru: "Перетаскивайте карточку влево или вправо — или нажимайте кнопки.", zh: "左右拖动卡片，或使用按钮。" },
  "review.knowBadge": { en: "KNOW", ru: "ЗНАЮ", zh: "认识" },
  "review.learningBadge": { en: "LEARNING", ru: "УЧУ", zh: "学习" },
  "review.noWords": { en: "No words to review yet.", ru: "Пока нечего повторять.", zh: "还没有可复习的单词。" },
  "review.addFirst": { en: "Add some first.", ru: "Сначала добавьте слова.", zh: "先添加一些。" },
  "review.learningLabel": { en: "Learning {n}", ru: "Учу {n}", zh: "学习 {n}" },
  "review.knownLabel": { en: "Known {n}", ru: "Знаю {n}", zh: "认识 {n}" },

  // --- quiz (recall) ---
  "quiz.title": { en: "Quiz", ru: "Квиз", zh: "测验" },
  "quiz.answerMode": { en: "Answer mode", ru: "Формат ответа", zh: "作答方式" },
  "quiz.choice": { en: "Multiple choice", ru: "Выбор варианта", zh: "选择题" },
  "quiz.type": { en: "Type it", ru: "Ввод слова", zh: "拼写" },
  "quiz.start": { en: "Start — {n} questions →", ru: "Начать — вопросов: {n} →", zh: "开始 — {n} 题 →" },
  "quiz.needFour": { en: "Need at least 4 words in this selection", ru: "В этом выборе нужно минимум 4 слова", zh: "此筛选下至少需要 4 个词" },
  "quiz.notEnough": { en: "Not enough words yet", ru: "Слов пока недостаточно", zh: "单词还不够" },
  "quiz.notEnoughText": { en: "You need at least 4 words for a recall check.", ru: "Для проверки нужно минимум 4 слова.", zh: "测验至少需要 4 个单词。" },
  "quiz.addMore": { en: "Add more →", ru: "Добавить ещё →", zh: "添加更多 →" },
  "quiz.done": { en: "Quiz complete", ru: "Квиз пройден", zh: "测验完成" },
  "quiz.score": { en: "You got {x} of {y} right.", ru: "Правильно: {x} из {y}.", zh: "答对 {x}/{y}。" },
  "quiz.whichWord": { en: "Which {lang} word means:", ru: "Какое слово ({lang}) означает:", zh: "哪个 {lang} 单词意为：" },
  "quiz.pickMeaning": { en: "Pick the {lang} meaning of:", ru: "Выберите значение ({lang}) для слова:", zh: "选择以下词的 {lang} 释义：" },
  "quiz.typeAnswer": { en: "Type the {lang} answer…", ru: "Введите ответ ({lang})…", zh: "输入 {lang} 答案…" },
  "quiz.check": { en: "Check", ru: "Проверить", zh: "检查" },
  "quiz.right": { en: "Exactly right.", ru: "Верно!", zh: "完全正确。" },
  "quiz.wrong": { en: "Not quite — the answer is “{answer}”.", ru: "Почти — правильный ответ «{answer}».", zh: "不对——答案是“{answer}”。" },
  "quiz.next": { en: "Next question →", ru: "Дальше →", zh: "下一题 →" },
  "quiz.seeResults": { en: "See results", ru: "Результаты", zh: "查看结果" },

  // --- word detail ---
  "word.back": { en: "← My words", ru: "← Мои слова", zh: "← 我的单词" },
  "word.share": { en: "↗ Share", ru: "↗ Поделиться", zh: "↗ 分享" },
  "word.edit": { en: "✎ Edit", ru: "✎ Изменить", zh: "✎ 编辑" },
  "word.reviewedTimes": { en: "reviewed {n}×", ru: "повторений: {n}", zh: "复习 {n} 次" },
  "word.collections": { en: "Collections", ru: "Коллекции", zh: "合集" },
  "word.collocations": { en: "Collocations", ru: "Сочетания", zh: "搭配" },
  "word.synonyms": { en: "Synonyms", ru: "Синонимы", zh: "同义词" },
  "word.antonyms": { en: "Antonyms", ru: "Антонимы", zh: "反义词" },
  "word.fromNews": { en: "From the news", ru: "Из новостей", zh: "来自新闻" },
  "word.notFound": { en: "Word not found.", ru: "Слово не найдено.", zh: "未找到该词。" },

  // --- edit word form ---
  "edit.word": { en: "Word", ru: "Слово", zh: "单词" },
  "edit.from": { en: "From", ru: "С языка", zh: "源语言" },
  "edit.to": { en: "To", ru: "На язык", zh: "目标语言" },
  "edit.phonetic": { en: "Phonetic", ru: "Транскрипция", zh: "音标" },
  "edit.pos": { en: "Part of speech", ru: "Часть речи", zh: "词性" },
  "edit.meaning": { en: "Meaning", ru: "Значение", zh: "释义" },
  "edit.collocations": { en: "Collocations (comma)", ru: "Сочетания (через запятую)", zh: "搭配（逗号分隔）" },
  "edit.synonyms": { en: "Synonyms (comma)", ru: "Синонимы (через запятую)", zh: "同义词（逗号分隔）" },
  "edit.antonyms": { en: "Antonyms (comma)", ru: "Антонимы (через запятую)", zh: "反义词（逗号分隔）" },
  "edit.example": { en: "Example", ru: "Пример", zh: "例句" },
  "edit.exampleTr": { en: "Example translation", ru: "Перевод примера", zh: "例句翻译" },
  "edit.source": { en: "Source", ru: "Источник", zh: "来源" },
  "edit.saveChanges": { en: "Save changes", ru: "Сохранить", zh: "保存修改" },

  // --- collections ---
  "col.newCollection": { en: "+ New collection", ru: "+ Новая коллекция", zh: "+ 新建合集" },
  "col.newPlaceholder": { en: "New collection…", ru: "Новая коллекция…", zh: "新合集…" },
  "col.noCollection": { en: "No collection", ru: "Без набора", zh: "无合集" },
  "col.nSets": { en: "{n} sets", ru: "наборов: {n}", zh: "{n} 个合集" },
  "col.searchSets": { en: "Search sets…", ru: "Поиск наборов…", zh: "搜索合集…" },
  "col.noSets": { en: "No sets found.", ru: "Наборы не найдены.", zh: "未找到合集。" },
  "col.pageSubtitle": { en: "Group words into sets like IELTS or adjectives, then study or quiz just that set.", ru: "Группируйте слова в наборы — например, «IELTS» или «прилагательные» — и учите или проверяйте только их.", zh: "把单词分组（如 IELTS、形容词），然后只学习或测验该合集。" },
  "col.create": { en: "Create set", ru: "Создать набор", zh: "创建合集" },
  "col.creating": { en: "Creating…", ru: "Создаю…", zh: "创建中…" },
  "col.createPlaceholder": { en: "New collection name (e.g. IELTS adjectives)", ru: "Название набора (напр. «IELTS adjectives»)", zh: "合集名称（如 IELTS 形容词）" },
  "col.emptyList": { en: "No collections yet — create your first set above.", ru: "Наборов пока нет — создайте первый выше.", zh: "还没有合集——在上面创建第一个。" },
  "col.words": { en: "{n} words", ru: "слов: {n}", zh: "{n} 个词" },
  "col.word": { en: "{n} word", ru: "слов: {n}", zh: "{n} 个词" },
  "col.cardEmpty": { en: "Empty — add words from any word page.", ru: "Пусто — добавляйте слова со страницы любого слова.", zh: "空——从单词页添加单词。" },
  "col.more": { en: "+{n} more", ru: "+{n} ещё", zh: "+{n} 个" },
  "col.study": { en: "🃏 Study", ru: "🃏 Учить", zh: "🃏 学习" },
  "col.quiz": { en: "🎯 Quiz", ru: "🎯 Квиз", zh: "🎯 测验" },
  "col.viewWords": { en: "View words →", ru: "Открыть слова →", zh: "查看单词 →" },
  "col.needWords": { en: "Add words to this set first", ru: "Сначала добавьте слова в набор", zh: "请先向该合集添加单词" },
  "col.needFour": { en: "Needs at least 4 words for a quiz", ru: "Для квиза нужно минимум 4 слова", zh: "测验至少需要 4 个单词" },
  "col.open": { en: "Manage", ru: "Открыть", zh: "管理" },
  "col.inSet": { en: "In this set", ru: "В наборе", zh: "合集内" },
  "col.addWords": { en: "Add your words", ru: "Добавить ваши слова", zh: "添加你的单词" },
  "col.searchWords": { en: "Search your words…", ru: "Поиск по вашим словам…", zh: "搜索你的单词…" },
  "col.noneToAdd": { en: "All your words are already in this set.", ru: "Все ваши слова уже в этом наборе.", zh: "你的单词都已在该合集中。" },
  "col.noWordFound": { en: "You don't have such a word.", ru: "У вас нет такого слова.", zh: "你没有这样的单词。" },
  "col.emptySet": { en: "No words in this set yet — add some below.", ru: "В наборе пока нет слов — добавьте ниже.", zh: "该合集还没有单词——在下面添加。" },
  "col.deleteConfirm": { en: "Delete collection \"{name}\"? (words are kept)", ru: "Удалить набор «{name}»? Слова останутся.", zh: "删除合集“{name}”？（单词保留）" },
  "col.addLanguage": { en: "+ Add language…", ru: "+ Добавить язык…", zh: "+ 添加语言…" },
  "col.searchLang": { en: "Search language…", ru: "Поиск языка…", zh: "搜索语言…" },
  "col.langPrompt": { en: "New language name (in English, e.g. Portuguese):", ru: "Название нового языка (по-английски, напр. Portuguese):", zh: "新语言名称（用英文，如 Portuguese）：" },

  // --- command palette ---
  "cmd.placeholder": { en: "Search words or jump to a page…", ru: "Найти слово или открыть страницу…", zh: "搜索单词或跳转页面…" },
  "cmd.goToday": { en: "Go to Today", ru: "Открыть «Сегодня»", zh: "前往 今天" },
  "cmd.openFlashcards": { en: "Open Flashcards", ru: "Открыть «Карточки»", zh: "打开 闪卡" },
  "cmd.openRecall": { en: "Open Quiz", ru: "Открыть «Квиз»", zh: "打开 测验" },
  "cmd.openWords": { en: "Open My words", ru: "Открыть «Мои слова»", zh: "打开 我的单词" },
  "cmd.openCollections": { en: "Open Collections", ru: "Открыть «Коллекции»", zh: "打开 合集" },
  "cmd.themeLight": { en: "Switch to light theme", ru: "Светлая тема", zh: "切换浅色主题" },
  "cmd.themeDark": { en: "Switch to dark theme", ru: "Тёмная тема", zh: "切换深色主题" },
  "cmd.noMatches": { en: "No matches.", ru: "Ничего не найдено.", zh: "无匹配。" },
  "cmd.navHint": { en: "↑↓ to navigate · ↵ to open", ru: "↑↓ — выбор · ↵ — открыть", zh: "↑↓ 导航 · ↵ 打开" },
  "cmd.escHint": { en: "Esc to close", ru: "Esc — закрыть", zh: "Esc 关闭" },
};

const I18nCtx = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}>({ locale: "en", setLocale: () => {}, t: (k) => k });

const KEY = "lexa.locale";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const stored = localStorage.getItem(KEY) as Locale | null;
    if (stored && ["en", "ru", "zh"].includes(stored)) setLocaleState(stored);
  }, []);

  const setLocale = (l: Locale) => {
    localStorage.setItem(KEY, l);
    setLocaleState(l);
  };

  const t = (key: string, vars?: Record<string, string | number>) => {
    const entry = DICT[key];
    let str = entry ? entry[locale] : key;
    if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, String(v));
    return str;
  };

  return <I18nCtx.Provider value={{ locale, setLocale, t }}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
