"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, isDue, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { getLevel } from "@/lib/learnPrefs";
import { langLabel } from "@/lib/langs";
import { SpeakButton } from "@/components/SpeakButton";
import { cn } from "@/lib/utils";
import { MessageCircle, ArrowLeft, Send, Mic, Square, Sparkles, Check, User, Trophy } from "lucide-react";

type Turn = { role: "user" | "assistant"; content: string };
type PairKey = { source: string; target: string };

function speechLang(src?: string): string {
  const map: Record<string, string> = {
    en: "en-US", ru: "ru-RU", zh: "zh-CN", "zh-Hant": "zh-TW", ja: "ja-JP", ko: "ko-KR",
    es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-PT", nl: "nl-NL",
    pl: "pl-PL", tr: "tr-TR", uk: "uk-UA", hi: "hi-IN", ar: "ar-SA",
  };
  return map[src ?? "en"] ?? src ?? "en-US";
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Highlight any of the learner's words-in-play wherever they appear in a message,
// so the vocab visibly "lives" inside the conversation. Words already used glow green.
function Highlighted({ text, pool, used }: { text: string; pool: string[]; used: Set<string> }) {
  const re = useMemo(
    () => (pool.length ? new RegExp(`\\b(${pool.map(esc).join("|")})\\b`, "gi") : null),
    [pool],
  );
  if (!re) return <>{text}</>;
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) => {
        const isWord = pool.some((w) => w.toLowerCase() === p.toLowerCase());
        if (!isWord) return <span key={i}>{p}</span>;
        const hit = used.has(p.toLowerCase());
        return (
          <span
            key={i}
            className={cn(
              "rounded-md px-1 py-0.5 font-semibold",
              hit ? "bg-sage text-white" : "bg-sage-tint text-sage-deep",
            )}
          >
            {p}
          </span>
        );
      })}
    </>
  );
}

export default function CoachChatPage() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();

  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const deck = useMemo(() => words ?? [], [words]);

  const pairs = useMemo(() => {
    const m = new Map<string, PairKey>();
    for (const w of deck) m.set(`${w.sourceLang}|${w.targetLang}`, { source: w.sourceLang, target: w.targetLang });
    return [...m.values()];
  }, [deck]);

  const [pair, setPair] = useState<PairKey | null>(null);
  const [scope, setScope] = useState<string>("smart");
  useEffect(() => {
    if (pair || deck.length === 0) return;
    const counts = new Map<string, number>();
    deck.forEach((w) => {
      const k = `${w.sourceLang}|${w.targetLang}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) {
      const [source, target] = top.split("|");
      setPair({ source, target });
    }
  }, [deck, pair]);

  const collections = useMemo(() => {
    if (!pair) return [] as { id: string; name: string; count: number }[];
    const m = new Map<string, { id: string; name: string; count: number }>();
    for (const w of deck) {
      if (w.sourceLang !== pair.source || w.targetLang !== pair.target) continue;
      for (const c of w.collections ?? []) {
        const e = m.get(c.id) ?? { id: c.id, name: c.name, count: 0 };
        e.count++;
        m.set(c.id, e);
      }
    }
    return [...m.values()];
  }, [deck, pair]);

  // The pool of words in play — same idea as the drill: weak → due → any (or a chosen
  // collection / a broad shuffle), capped so the conversation has room to breathe.
  const poolWords = useMemo(() => {
    if (!pair) return [] as Word[];
    let pool = deck.filter((w) => w.sourceLang === pair.source && w.targetLang === pair.target);
    if (scope.startsWith("coll:")) {
      const cid = scope.slice(5);
      pool = pool.filter((w) => (w.collections ?? []).some((c) => c.id === cid));
    }
    if (scope === "all") return [...pool].sort(() => Math.random() - 0.5).slice(0, 10);
    const weak = pool.filter((w) => (w.lapses ?? 0) >= 2);
    const due = pool.filter(isDue);
    return [...new Map([...weak, ...due, ...pool].map((w) => [w.id, w])).values()].slice(0, 10);
  }, [deck, pair, scope]);

  const poolStrings = useMemo(() => poolWords.map((w) => w.word), [poolWords]);
  const wordPayload = useMemo(() => poolWords.map((w) => ({ word: w.word, meaning: w.meaningZh ?? "" })), [poolWords]);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function sendTurn(history: Turn[]) {
    if (!pair) return;
    setBusy(true);
    try {
      const res = await api.coachChat({
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        words: wordPayload,
        sourceLang: pair.source,
        targetLang: pair.target,
        level: getLevel(pair.source) ?? undefined,
        telegramId: accountId,
      });
      setTurns((cur) => [...cur, { role: "assistant", content: res.say }]);
      // Reward: celebrate any word the learner just used for the first time.
      if (res.used?.length) {
        const fresh = res.used.map((w) => w.toLowerCase()).filter((w) => !used.has(w));
        if (fresh.length) {
          setUsed((s) => new Set([...s, ...fresh]));
          const label = res.used.find((w) => fresh.includes(w.toLowerCase())) ?? "";
          show({ icon: "🎯", title: t("chat.scored", { word: label }) });
        }
      }
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (poolWords.length === 0 || busy) return;
    setStarted(true);
    setTurns([]);
    setUsed(new Set());
    await sendTurn([]);
  }

  async function sendText(text: string) {
    const v = text.trim();
    if (!v || busy) return;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    setRecording(false);
    setInterim("");
    const next: Turn[] = [...turns, { role: "user", content: v }];
    setTurns(next);
    setInput("");
    await sendTurn(next);
  }

  // ---- voice answer via the browser's SpeechRecognition (free, on-device) ----
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const baseInputRef = useRef("");

  function toggleRecord() {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
    if (!SR) {
      show({ icon: "⚠️", title: t("coach.practiceMicUnsupported") });
      return;
    }
    const rec = new SR();
    rec.lang = speechLang(pair?.source);
    rec.interimResults = true;
    rec.continuous = true;
    baseInputRef.current = input.trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let finalTxt = "";
      let interimTxt = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTxt += r[0].transcript;
        else interimTxt += r[0].transcript;
      }
      setInterim(interimTxt);
      const base = baseInputRef.current;
      setInput([base, (finalTxt + interimTxt).trim()].filter(Boolean).join(" "));
    };
    rec.onerror = () => {
      setRecording(false);
      setInterim("");
      show({ icon: "⚠️", title: t("coach.practiceSttFail") });
    };
    rec.onend = () => {
      setRecording(false);
      setInterim("");
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setRecording(true);
    } catch {
      setRecording(false);
      show({ icon: "⚠️", title: t("coach.practiceMicUnsupported") });
    }
  }

  const srcFontCls = pair && (pair.source === "zh" || pair.source === "zh-Hant" || pair.source === "ja") ? "font-zh" : "";

  return (
    <div className="anim-fade-up mx-auto flex h-[calc(100dvh-140px)] max-w-[720px] flex-col">
      <div className="mb-3">
        <Link href="/coach" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {t("coach.title")}
        </Link>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 font-serif text-[26px] font-medium tracking-[-0.01em] text-ink">
            <MessageCircle className="h-6 w-6 text-sage-deep" /> {t("chat.title")}
          </h1>
          {started && poolStrings.length > 0 && (
            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sage-tint px-3 py-1 text-[13px] font-semibold text-sage-deep">
              <Trophy className="h-3.5 w-3.5" /> {used.size}/{poolStrings.length}
            </div>
          )}
        </div>
      </div>

      {!started ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-[22px] border border-black/[0.06] bg-surface p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sage text-white">
            <MessageCircle className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-serif text-[22px] font-semibold text-ink">{t("chat.heroTitle")}</h2>
          <p className="mt-2 max-w-[460px] text-[14px] leading-relaxed text-ink-soft">{t("chat.heroSub")}</p>

          {deck.length === 0 ? (
            <p className="mt-6 rounded-[12px] border border-dashed border-black/[0.12] bg-paper/50 px-4 py-3 text-[13px] text-ink-soft">
              {t("coach.practiceNoWords")}
            </p>
          ) : (
            <>
              {pairs.length > 1 && (
                <div className="mt-6 w-full max-w-[440px]">
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{t("coach.practicePairLabel")}</div>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {pairs.map((p) => {
                      const on = pair?.source === p.source && pair?.target === p.target;
                      return (
                        <button
                          key={`${p.source}|${p.target}`}
                          type="button"
                          onClick={() => {
                            setPair(p);
                            setScope("smart");
                          }}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors",
                            on ? "border-sage bg-sage text-white" : "border-black/[0.1] text-ink-muted hover:border-sage/50",
                          )}
                        >
                          {langLabel(p.source)} → {langLabel(p.target)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-5 w-full max-w-[440px]">
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{t("coach.practiceScope")}</div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {[
                    { id: "smart", label: t("coach.scopeSmart") },
                    { id: "all", label: t("coach.scopeAll") },
                    ...collections.map((c) => ({ id: `coll:${c.id}`, label: `${c.name} · ${c.count}` })),
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setScope(s.id)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors",
                        scope === s.id ? "border-sage bg-sage-tint text-sage-deep" : "border-black/[0.1] text-ink-muted hover:border-sage/50",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {poolWords.length > 0 ? (
                <>
                  <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                    {poolWords.map((w) => (
                      <span key={w.id} className="rounded-full border border-black/[0.06] bg-paper px-2.5 py-0.5 text-[13px] text-ink-muted">
                        {w.word}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={start}
                    className="mt-6 inline-flex items-center gap-2 rounded-full bg-sage px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
                  >
                    <Sparkles className="h-4 w-4" /> {t("chat.start")}
                  </button>
                </>
              ) : (
                <p className="mt-6 rounded-[12px] border border-dashed border-black/[0.12] bg-paper/50 px-4 py-3 text-[13px] text-ink-soft">
                  {t("coach.practiceNoWords")}
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {/* words in play — chips that light up as you actually use them */}
          {poolStrings.length > 0 && (
            <div className="mb-3 flex gap-1.5 overflow-x-auto rounded-[16px] border border-black/[0.06] bg-surface px-3 py-2.5">
              {poolWords.map((w) => {
                const hit = used.has(w.word.toLowerCase());
                return (
                  <span
                    key={w.id}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] font-semibold transition-colors",
                      hit ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-paper text-ink-muted",
                      srcFontCls,
                    )}
                  >
                    {hit && <Check className="h-3 w-3" strokeWidth={3} />}
                    {w.word}
                  </span>
                );
              })}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto rounded-[22px] border border-black/[0.06] bg-surface p-4 sm:p-5">
            {turns.map((turn, i) => (
              <Bubble key={i} turn={turn} pool={poolStrings} used={used} speakLang={pair?.source ?? "en"} />
            ))}
            {busy && (
              <div className="flex items-center gap-2.5">
                <ChatAvatar />
                <div className="flex items-center gap-1.5 rounded-[16px] rounded-bl-md border border-black/[0.06] bg-paper px-3.5 py-3">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint" />
                </div>
              </div>
            )}
          </div>

          <div className="mt-3">
            {recording && (
              <div className="mb-2 flex items-center gap-2.5 rounded-[14px] border border-warn/30 bg-warn-bg/60 px-3.5 py-2.5">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn-text opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warn-text" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                  {interim ? interim : <span className="text-ink-faint">{t("coach.practiceRec")}</span>}
                </span>
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendText(input);
              }}
              className="flex items-end gap-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendText(input);
                  }
                }}
                rows={1}
                placeholder={t("chat.input")}
                disabled={busy}
                className="max-h-32 min-h-[46px] flex-1 resize-none rounded-[16px] border border-black/[0.08] bg-surface px-4 py-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
              />
              <button
                type="button"
                onClick={toggleRecord}
                disabled={busy}
                aria-label={t("coach.practiceMic")}
                className={cn(
                  "flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[16px] border transition-colors disabled:opacity-40",
                  recording ? "border-warn/50 bg-warn-bg text-warn-text" : "border-black/[0.08] bg-surface text-ink-muted hover:border-sage/50 hover:text-sage-deep",
                )}
              >
                {recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
              </button>
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[16px] bg-sage text-white transition-colors hover:bg-sage-deep disabled:opacity-40"
              >
                <Send className="h-5 w-5" />
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function ChatAvatar() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-full bg-sage text-white">
      <MessageCircle className="h-[18px] w-[18px]" />
    </span>
  );
}

function Bubble({ turn, pool, used, speakLang }: { turn: Turn; pool: string[]; used: Set<string>; speakLang: string }) {
  if (turn.role === "user") {
    return (
      <div className="flex items-end justify-end gap-2.5">
        <div className="max-w-[78%] rounded-[16px] rounded-br-md bg-sage px-3.5 py-2.5 text-[15px] leading-relaxed text-white">
          {turn.content}
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-taupe/30 text-ink-muted">
          <User className="h-[17px] w-[17px]" />
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-end justify-start gap-2.5">
      <ChatAvatar />
      <div className="max-w-[82%]">
        <div className="group flex items-end gap-1.5">
          <div className="whitespace-pre-wrap rounded-[16px] rounded-bl-md border border-black/[0.06] bg-paper px-3.5 py-2.5 text-[15px] leading-relaxed text-ink">
            <Highlighted text={turn.content} pool={pool} used={used} />
          </div>
          <SpeakButton text={turn.content} lang={speakLang} size="sm" className="opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
    </div>
  );
}
