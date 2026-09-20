"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type TutorCard } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { useToast } from "@/lib/toast";
import { displayCode, isAiSupported, scriptFamily, scriptFamilyOfText } from "@/lib/langs";
import { getExampleSource, getExampleStyle, getLevel } from "@/lib/learnPrefs";
import { useEnsureLevel } from "@/lib/useEnsureLevel";

export type TutorMsg = {
  role: "user" | "assistant";
  content: string;
  addWords?: string[];
  addCards?: TutorCard[];
  streaming?: boolean;
  // Suggestions a card chat can apply to the card it is about.
  addSynonyms?: string[];
  addAntonyms?: string[];
  addExamples?: { sentence: string; translation: string }[];
};
/** One past conversation, as the history menu lists it. `hay` is what search reads. */
export type TutorChatEntry = { id: string; at: number; title: string; n: number; hay: string };
/** The card a chat is about, when Mika was opened from a word page. */
export type TutorCardCtx = { id: string; word: string; sourceLang: string; targetLang: string };

const PAIR_KEY = "lexa.wordPair"; // shared with Add/Reader
// The conversation lives in sessionStorage so the floating widget and the /mika
// page continue the same chat ("open full page" doesn't lose it).
const CHAT_KEY = "lexa.tutorChat";
const CHAT_ID_KEY = "lexa.tutorChatId";
// Past conversations, in localStorage so they outlive the tab. Deliberately small:
// the newest few chats, oldest dropped once the store grows past a couple of pages
// of text — history is a convenience, not something worth filling storage for.
const CHATS_KEY = "lexa.tutorChats";
const MAX_CHATS = 12;
const MAX_CHATS_BYTES = 180_000;

type StoredChat = { id: string; at: number; messages: TutorMsg[] };

// The learner's current pair (shared with Add/Reader). Tutor adds words to it.
function readPair(): { source: string; target: string } {
  if (typeof window === "undefined") return { source: "en", target: "zh" };
  try {
    const p = JSON.parse(localStorage.getItem(PAIR_KEY) ?? "null") as { sourceLang?: string; targetLang?: string };
    const source = p?.sourceLang && p.sourceLang !== "auto" ? p.sourceLang : "en";
    return { source, target: p?.targetLang || "zh" };
  } catch {
    return { source: "en", target: "zh" };
  }
}

function readChat(): TutorMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const r = JSON.parse(sessionStorage.getItem(CHAT_KEY) ?? "[]");
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Which saved chat the open conversation is — kept in sessionStorage next to the
// messages, so a reload continues that history entry instead of forking it.
function readChatId(): string {
  if (typeof window === "undefined") return "";
  try {
    const id = sessionStorage.getItem(CHAT_ID_KEY);
    if (id) return id;
    const fresh = newChatId();
    sessionStorage.setItem(CHAT_ID_KEY, fresh);
    return fresh;
  } catch {
    return "";
  }
}

function readChats(): StoredChat[] {
  if (typeof window === "undefined") return [];
  try {
    const r = JSON.parse(localStorage.getItem(CHATS_KEY) ?? "[]");
    return Array.isArray(r) ? (r as StoredChat[]).filter((c) => c?.id && Array.isArray(c.messages) && c.messages.length > 0) : [];
  } catch {
    return [];
  }
}

function writeChats(list: StoredChat[]) {
  let keep = list.slice(0, MAX_CHATS);
  while (keep.length > 1 && JSON.stringify(keep).length > MAX_CHATS_BYTES) keep = keep.slice(0, -1);
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(keep));
  } catch {
    /* out of quota — history is expendable */
  }
}

// A chat is titled by its opening question, which is what people look for.
const chatTitle = (m: TutorMsg[]) => (m.find((x) => x.role === "user")?.content ?? "").trim().slice(0, 80);
const summarize = (list: StoredChat[]): TutorChatEntry[] =>
  list.map((c) => ({
    id: c.id,
    at: c.at,
    title: chatTitle(c.messages),
    n: c.messages.length,
    // What the history search looks through: the whole conversation, capped —
    // people look for a chat by something said in it, not just by its first line.
    hay: c.messages
      .map((m) => m.content)
      .join(" ")
      .slice(0, 2000)
      .toLowerCase(),
  }));

// A suggested word doesn't have to be in the chat's own language: asking about a
// Chinese word inside an English chat should still offer a card — a Chinese one.
// Mika tags those ("lang"); a clearly different script is the fallback when it doesn't.
const SCRIPT_LANG: Record<string, string> = { cyrillic: "ru", han: "zh", jpn: "ja", kor: "ko" };

function termLang(card: TutorCard | undefined, word: string, source: string): string {
  const tagged = (card?.lang ?? "").trim();
  if (tagged && isAiSupported(tagged)) return tagged;
  const fam = scriptFamilyOfText(word);
  if (!fam || fam === scriptFamily(source)) return source;
  return SCRIPT_LANG[fam] ?? source;
}

/**
 * Chat state + actions for Mika (the global AI tutor), shared by the floating
 * widget (GlobalTutor) and the full /mika page.
 */
export function useTutorChat({ active = true }: { active?: boolean } = {}) {
  const { t } = useI18n();
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const { show, trackImport } = useToast();
  const ensureLevel = useEnsureLevel();

  const [pair, setPair] = useState(() => readPair());
  // Set when the chat is about one card (opened from a word page): asks go to that
  // card's own endpoint, which knows its meaning and can edit it in place.
  const [card, setCard] = useState<TutorCardCtx | null>(null);
  const [messages, setMessages] = useState<TutorMsg[]>(() => readChat());
  const [chatId, setChatId] = useState(() => readChatId());
  const [history, setHistory] = useState<TutorChatEntry[]>([]);
  const [input, setInput] = useState("");
  // An open-ended preset ("10 words about: ") put in the box; sending it untouched
  // just makes Mika ask for the topic, so Send waits until something is added.
  const [template, setTemplate] = useState<string | null>(null);
  const unfinished = !!template && input.trim() === template.trim();
  const [creating, setCreating] = useState(false);
  const [collIds, setCollIds] = useState<string[]>([]);
  const [wordSel, setWordSel] = useState<Record<number, string[]>>({}); // per-message word selection

  useEffect(() => {
    // A half-written answer isn't worth rewriting storage for on every token.
    if (messages[messages.length - 1]?.streaming) return;
    const trimmed = messages.slice(-40);
    try {
      sessionStorage.setItem(CHAT_KEY, JSON.stringify(trimmed));
    } catch {
      /* ignore */
    }
    if (!chatId) return;
    const stored = readChats();
    const rest = stored.filter((c) => c.id !== chatId);
    // Nothing said yet and nothing saved under this id → just show what history has.
    if (!trimmed.length && rest.length === stored.length) {
      setHistory(summarize(stored));
      return;
    }
    writeChats(trimmed.length ? [{ id: chatId, at: Date.now(), messages: trimmed }, ...rest] : rest);
    setHistory(summarize(readChats()));
  }, [messages, chatId]);

  // Refresh the pair + chat whenever the surface becomes active (they may have
  // changed elsewhere — another page, or the other Mika surface).
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  useEffect(() => {
    if (!active) return;
    setPair(readPair());
    setMessages(readChat());
    const id = readChatId();
    // A card chip belongs to the conversation it was opened for: if the other Mika
    // surface moved on to a different one while this was closed, the chat coming
    // back isn't about that card any more.
    if (id !== chatIdRef.current) setCard(null);
    setChatId(id);
    setHistory(summarize(readChats()));
  }, [active]);

  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
    enabled: active,
  });

  // The learner's existing deck, so we can flag words the tutor suggests that are
  // already saved (matched within each word's own language). Shares the Sidebar's
  // cache — no extra request in practice.
  const { data: myWords } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const owned = useMemo(() => {
    const byLang = new Map<string, Set<string>>();
    for (const w of myWords ?? []) {
      const k = displayCode(w.sourceLang);
      let set = byLang.get(k);
      if (!set) byLang.set(k, (set = new Set<string>()));
      set.add(w.word.trim().toLowerCase());
    }
    return byLang;
  }, [myWords]);
  const isAdded = (w: string, lang: string) => owned.get(displayCode(lang))?.has(w.trim().toLowerCase()) ?? false;

  // The language a suggested word will be saved under.
  const langOf = useCallback(
    (index: number, word: string) => {
      const key = word.trim().toLowerCase();
      const card = (messages[index]?.addCards ?? []).find((c) => c.word.trim().toLowerCase() === key);
      return termLang(card, word, pair.source);
    },
    [messages, pair.source],
  );

  const [busy, setBusy] = useState(false);
  const [isError, setIsError] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  // True while an answer is typing itself out into the last bubble.
  const streaming = !!messages[messages.length - 1]?.streaming;
  useEffect(() => () => inFlight.current?.abort(), []);

  // Mika's answer is streamed: the text lands token by token in an open bubble
  // instead of appearing as one finished paragraph after a long spinner.
  async function ask(msgs: TutorMsg[]) {
    const ac = new AbortController();
    inFlight.current = ac;
    setBusy(true);
    setIsError(false);
    // A chat about a card answers from the card's own endpoint (it has the word,
    // its meaning and its examples in hand) and may offer edits to that card.
    if (card) {
      try {
        const r = await api.askWord(
          card.id,
          msgs.map((m) => ({ role: m.role, content: m.content })),
        );
        if (inFlight.current !== ac) return; // the chat moved on while we waited
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: r.answer,
            addWords: r.addWords,
            addSynonyms: r.addSynonyms,
            addAntonyms: r.addAntonyms,
            addExamples: r.addExamples,
          },
        ]);
      } catch {
        if (inFlight.current === ac) setIsError(true);
      } finally {
        if (inFlight.current === ac) {
          inFlight.current = null;
          setBusy(false);
        }
      }
      return;
    }
    let acc = "";
    // Drop the half-written bubble (on error) or replace it (on the final answer).
    const closeOpen = (m: TutorMsg[], done?: TutorMsg) => {
      const rest = m[m.length - 1]?.streaming ? m.slice(0, -1) : m;
      return done ? [...rest, done] : rest;
    };
    try {
      const r = await api.tutorAskStream(
        {
          messages: msgs.map((m) => ({ role: m.role, content: m.content })),
          sourceLang: pair.source,
          targetLang: pair.target,
          level: getLevel(pair.source) ?? undefined,
          telegramId: accountId,
        },
        {
          onDelta: (chunk) => {
            acc += chunk;
            setMessages((m) => closeOpen(m, { role: "assistant", content: acc, streaming: true }));
          },
          signal: ac.signal,
        },
      );
      // Snap to the validated text and attach the one-tap "create cards" words.
      setMessages((m) => closeOpen(m, { role: "assistant", content: r.answer, addWords: r.addWords, addCards: r.addCards }));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setIsError(true);
      setMessages((m) => closeOpen(m));
    } finally {
      if (inFlight.current === ac) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  }

  function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy || (text === undefined && unfinished)) return;
    setTemplate(null);
    const next = [...messages, { role: "user" as const, content: q }];
    setMessages(next);
    setInput("");
    void ask(next);
  }

  // Drop whatever is in flight — shared by "new chat" and opening a past one.
  function stopAsking() {
    inFlight.current?.abort();
    inFlight.current = null;
    setBusy(false);
    setIsError(false);
  }

  // Start a new conversation and return its id (stored alongside the messages, so
  // a reload continues this entry instead of forking it).
  function freshChat(): string {
    const id = newChatId();
    setChatId(id);
    try {
      sessionStorage.setItem(CHAT_ID_KEY, id);
    } catch {
      /* ignore */
    }
    return id;
  }

  function reset() {
    stopAsking();
    setMessages([]);
    setWordSel({});
    setCard(null);
    // The chat just left stays in history; this one starts its own entry.
    freshChat();
  }

  /**
   * Open a chat about one card and ask for its explanation. The explanation is
   * cached on the card server-side, so re-opening a word costs nothing; follow-ups
   * keep the card in context and can add synonyms, antonyms or examples to it.
   */
  async function startCard(ctx: TutorCardCtx) {
    stopAsking();
    setWordSel({});
    setCard(ctx);
    // The chat is in the card's own pair, whatever the widget was last set to —
    // without touching the saved preference Add and the Reader share.
    setPair({ source: ctx.sourceLang, target: ctx.targetLang });
    freshChat();
    const opening: TutorMsg = { role: "user", content: t("word.explainSeed", { word: ctx.word }) };
    setMessages([opening]);
    const ac = new AbortController();
    inFlight.current = ac;
    setBusy(true);
    setIsError(false);
    try {
      const r = await api.explainWord(ctx.id);
      if (inFlight.current !== ac) return;
      setMessages([opening, { role: "assistant", content: r.explanation }]);
    } catch {
      if (inFlight.current === ac) setIsError(true);
    } finally {
      if (inFlight.current === ac) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  }

  // Apply a suggestion to the card the chat is about. The card's current lists are
  // read first, so two suggestions in a row can't overwrite each other.
  async function addToCard(index: number, kind: "syn" | "ant", terms: string[]) {
    if (!card || creating || terms.length === 0) return;
    setCreating(true);
    try {
      const w = await api.getWord(card.id);
      await api.updateWord(
        card.id,
        kind === "syn" ? { synonyms: [...w.synonyms, ...terms] } : { antonyms: [...w.antonyms, ...terms] },
      );
      qc.invalidateQueries({ queryKey: ["word", card.id] });
      qc.invalidateQueries({ queryKey: ["words"] });
      show({ icon: "🌱", title: t(kind === "syn" ? "word.synAdded" : "word.antAdded", { n: terms.length }) });
      setMessages((m) =>
        m.map((msg, i) => (i === index ? { ...msg, [kind === "syn" ? "addSynonyms" : "addAntonyms"]: [] } : msg)),
      );
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setCreating(false);
    }
  }

  // Append an example sentence the tutor wrote to the card the chat is about.
  async function addExampleToCard(index: number, ex: { sentence: string; translation: string }) {
    if (!card || creating) return;
    setCreating(true);
    try {
      await api.addManualExample(card.id, ex.sentence, ex.translation);
      qc.invalidateQueries({ queryKey: ["word", card.id] });
      qc.invalidateQueries({ queryKey: ["words"] });
      show({ icon: "🌱", title: t("word.exampleAdded") });
      setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, addExamples: [] } : msg)));
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setCreating(false);
    }
  }

  // Reopen a chat from history — it becomes the live conversation again. A card
  // chat reopened this way keeps its text but not its card, so follow-ups go to
  // Mika at large rather than silently editing a word page left long ago.
  function openChat(id: string) {
    const found = readChats().find((c) => c.id === id);
    if (!found) return;
    stopAsking();
    setWordSel({});
    setCard(null);
    setChatId(id);
    try {
      sessionStorage.setItem(CHAT_ID_KEY, id);
    } catch {
      /* ignore */
    }
    setMessages(found.messages);
  }

  function removeChat(id: string) {
    writeChats(readChats().filter((c) => c.id !== id));
    setHistory(summarize(readChats()));
    if (id === chatId) reset(); // the open chat was the deleted one
  }

  // Toggle a single suggested word's selection within a message.
  function toggleWord(index: number, all: string[], w: string) {
    setWordSel((s) => {
      const cur = s[index] ?? all;
      const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w];
      return { ...s, [index]: next };
    });
  }

  // Change the tutor's language pair and persist it (shared with Add/Reader).
  function changePair(next: { source: string; target: string }) {
    setPair(next);
    try {
      localStorage.setItem(PAIR_KEY, JSON.stringify({ sourceLang: next.source, targetLang: next.target }));
    } catch {
      /* ignore */
    }
  }

  async function createCards(index: number, terms: string[]) {
    if (creating || terms.length === 0) return;
    // Reuse the meaning + example the tutor already wrote (in addCards) so we can
    // save these cards WITHOUT a second AI call. Only when every selected word has
    // both a meaning and an example; otherwise fall back to normal AI enrichment.
    const byWord = new Map((messages[index]?.addCards ?? []).map((c) => [c.word.trim().toLowerCase(), c]));
    // Words from another language (a Chinese word inside an English chat) are saved
    // in THEIR own pair, so one tap can add a mixed batch.
    const groups = new Map<string, string[]>();
    for (const w of terms) {
      const lang = langOf(index, w);
      groups.set(lang, [...(groups.get(lang) ?? []), w]);
    }
    const canReuse = (words: string[]) =>
      words.every((w) => {
        const c = byWord.get(w.trim().toLowerCase());
        return !!c && !!c.meaning && !!c.example;
      });

    // A level is only needed when the AI will compose examples.
    for (const [lang, words] of groups) {
      if (canReuse(words) || !isAiSupported(lang)) continue;
      const { ok } = await ensureLevel(lang);
      if (!ok) return;
    }
    setCreating(true);
    try {
      let created = 0;
      for (const [lang, words] of groups) {
        const r = await api.batchAddWords(
          canReuse(words)
            ? {
                telegramId: accountId,
                sourceLang: lang,
                targetLang: pair.target,
                items: words.map((w) => {
                  const c = byWord.get(w.trim().toLowerCase())!;
                  return { word: w, meaning: c.meaning, sentence: c.example, exampleTr: c.exampleTr };
                }),
                source: "Onomika AI",
                enrich: false, // meaning + example are already known → no tokens spent
                collectionIds: collIds.length ? collIds : undefined,
              }
            : {
                telegramId: accountId,
                sourceLang: lang,
                targetLang: pair.target,
                words,
                level: getLevel(lang) ?? undefined,
                exampleStyle: getExampleStyle(),
                exampleSource: getExampleSource(),
                enrich: isAiSupported(lang),
                collectionIds: collIds.length ? collIds : undefined,
              },
        );
        created += r.created;
        if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words, total: r.job.total, processed: 0 });
      }
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      show({ icon: "🌱", title: t("word.cardsCreated", { n: created }) });
      setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, addWords: [] } : msg)));
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setCreating(false);
    }
  }

  return {
    pair,
    changePair,
    messages,
    input,
    setInput,
    fillTemplate: (text: string) => {
      setInput(text);
      setTemplate(text);
    },
    unfinished,
    send,
    reset,
    busy,
    streaming,
    isError,
    creating,
    createCards,
    collections,
    collIds,
    setCollIds,
    wordSel,
    setWordSel,
    toggleWord,
    isAdded,
    langOf,
    chatId,
    history,
    openChat,
    removeChat,
    card,
    startCard,
    addToCard,
    addExampleToCard,
  };
}

export type TutorChat = ReturnType<typeof useTutorChat>;
