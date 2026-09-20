"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type TutorCard } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { useToast } from "@/lib/toast";
import { isAiSupported } from "@/lib/langs";
import { getExampleSource, getExampleStyle, getLevel } from "@/lib/learnPrefs";
import { useEnsureLevel } from "@/lib/useEnsureLevel";

export type TutorMsg = { role: "user" | "assistant"; content: string; addWords?: string[]; addCards?: TutorCard[]; streaming?: boolean };

const PAIR_KEY = "lexa.wordPair"; // shared with Add/Reader
// The conversation lives in sessionStorage so the floating widget and the /mika
// page continue the same chat ("open full page" doesn't lose it).
const CHAT_KEY = "lexa.tutorChat";

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
  const [messages, setMessages] = useState<TutorMsg[]>(() => readChat());
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
    try {
      sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* ignore */
    }
  }, [messages]);

  // Refresh the pair + chat whenever the surface becomes active (they may have
  // changed elsewhere — another page, or the other Mika surface).
  useEffect(() => {
    if (!active) return;
    setPair(readPair());
    setMessages(readChat());
  }, [active]);

  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
    enabled: active,
  });

  // The learner's existing deck, so we can flag words the tutor suggests that are
  // already saved (matched within the current pair's source language). Shares the
  // Sidebar's cache — no extra request in practice.
  const { data: myWords } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const ownedSet = useMemo(() => {
    const s = new Set<string>();
    for (const w of myWords ?? []) if (w.sourceLang === pair.source) s.add(w.word.trim().toLowerCase());
    return s;
  }, [myWords, pair.source]);
  const isAdded = (w: string) => ownedSet.has(w.trim().toLowerCase());

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

  function reset() {
    inFlight.current?.abort();
    inFlight.current = null;
    setBusy(false);
    setIsError(false);
    setMessages([]);
    setWordSel({});
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
    const reuseAll = terms.every((w) => {
      const c = byWord.get(w.trim().toLowerCase());
      return c && c.meaning && c.example;
    });

    // A level is only needed when the AI will compose examples.
    if (!reuseAll && isAiSupported(pair.source)) {
      const { ok } = await ensureLevel(pair.source);
      if (!ok) return;
    }
    setCreating(true);
    try {
      const r = await api.batchAddWords(
        reuseAll
          ? {
              telegramId: accountId,
              sourceLang: pair.source,
              targetLang: pair.target,
              items: terms.map((w) => {
                const c = byWord.get(w.trim().toLowerCase())!;
                return { word: w, meaning: c.meaning, sentence: c.example, exampleTr: c.exampleTr };
              }),
              source: "Onomika AI",
              enrich: false, // meaning + example are already known → no tokens spent
              collectionIds: collIds.length ? collIds : undefined,
            }
          : {
              telegramId: accountId,
              sourceLang: pair.source,
              targetLang: pair.target,
              words: terms,
              level: getLevel(pair.source) ?? undefined,
              exampleStyle: getExampleStyle(),
              exampleSource: getExampleSource(),
              enrich: isAiSupported(pair.source),
              collectionIds: collIds.length ? collIds : undefined,
            },
      );
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words: terms, total: r.job.total, processed: 0 });
      show({ icon: "🌱", title: t("word.cardsCreated", { n: r.created }) });
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
  };
}

export type TutorChat = ReturnType<typeof useTutorChat>;
