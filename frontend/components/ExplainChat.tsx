"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

// AI tutor for a word: the first answer is the full explanation, then the learner
// can keep asking follow-up questions in a little chat (replaces "Regenerate").
export function ExplainChat({ wordId }: { wordId: string }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const explain = useMutation({
    mutationFn: () => api.explainWord(wordId),
    onSuccess: (r) => setMessages([{ role: "assistant", content: r.explanation }]),
  });

  const ask = useMutation({
    mutationFn: (msgs: Msg[]) => api.askWord(wordId, msgs),
    onSuccess: (r) => setMessages((m) => [...m, { role: "assistant", content: r.answer }]),
  });

  const started = messages.length > 0 || explain.isPending || explain.isError;
  const busy = ask.isPending;

  // Keep the latest turn in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function send() {
    const q = input.trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user" as const, content: q }];
    setMessages(next);
    setInput("");
    ask.mutate(next);
  }

  if (!started) {
    return (
      <button
        type="button"
        onClick={() => explain.mutate()}
        className="inline-flex items-center gap-2 rounded-full border border-sage/40 bg-sage-tint/40 px-4 py-2 text-sm font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
      >
        🤔 {t("word.explain")}
      </button>
    );
  }

  return (
    <div className="rounded-[18px] border border-sage/25 bg-sage-tint/40 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-serif text-[15px] font-medium italic text-sage-deep">{t("word.explainTitle")}</h2>
        {messages.length > 0 && !busy && (
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              explain.reset();
              ask.reset();
            }}
            className="text-xs font-semibold text-sage hover:text-sage-deep"
          >
            ↻ {t("word.restart")}
          </button>
        )}
      </div>

      {/* conversation */}
      <div ref={scrollRef} className="max-h-[420px] space-y-3 overflow-y-auto">
        {explain.isPending && <p className="text-sm text-ink-soft">{t("word.explaining")}</p>}
        {explain.isError && (
          <p className="text-sm text-warn-text">{(explain.error as Error).message}</p>
        )}
        {messages.map((m, i) =>
          m.role === "assistant" ? (
            <p key={i} className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
              {m.content}
            </p>
          ) : (
            <div key={i} className="flex justify-end">
              <span className="max-w-[85%] whitespace-pre-wrap rounded-[14px] rounded-br-sm bg-sage px-3.5 py-2 text-[14px] font-medium text-white">
                {m.content}
              </span>
            </div>
          ),
        )}
        {busy && <p className="text-sm text-ink-soft">{t("word.thinking")}</p>}
        {ask.isError && <p className="text-sm text-warn-text">{t("word.askError")}</p>}
      </div>

      {/* follow-up input */}
      {messages.length > 0 && (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("word.askPlaceholder")}
            disabled={busy}
            className="h-10 flex-1 rounded-full border border-black/[0.08] bg-surface px-4 text-[16px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none sm:text-[14px]"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className={cn(
              "shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep",
              "disabled:opacity-40",
            )}
          >
            {t("word.send")}
          </button>
        </form>
      )}
    </div>
  );
}
