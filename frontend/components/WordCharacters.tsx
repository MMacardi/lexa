"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { api, type CharWord, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { errText } from "@/lib/errText";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Pinyin } from "@/components/Pinyin";
import { SpeakButton } from "@/components/SpeakButton";
import { StrokeOrder } from "@/components/StrokeOrder";

const HAN = /\p{Script=Han}/u;

/**
 * The word page's Characters block (learning audit 8e), Pleco's: each character
 * with its reading and meaning, its stroke order, and up to six HSK words built
 * on it, the easiest first. A word the learner has opens its card; any other is
 * one tap from being added. Between HSK 4 and 5 the characters are what let a
 * new word be guessed and kept. Dictionary data, no model call.
 */
export function WordCharacters({ word }: { word: Word }) {
  const { t } = useI18n();
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const { show, trackImport } = useToast();
  const [adding, setAdding] = useState<string | null>(null);
  const on = word.sourceLang === "zh" && HAN.test(word.word);
  const { data } = useQuery({
    queryKey: ["dictChars", accountId, word.word, word.phonetic ?? "", word.targetLang],
    queryFn: () => api.dictChars(word.word, word.phonetic ?? "", word.targetLang),
    enabled: on,
    staleTime: 5 * 60_000,
  });
  const chars = data?.chars ?? [];
  if (!on || !chars.length) return null;
  const someEnglish = word.targetLang !== "en" && chars.some((c) => c.english || c.words.some((w) => w.english));

  // The Reader's capture: the dictionary's card at once, filled in behind.
  async function add(w: CharWord) {
    if (adding) return;
    setAdding(w.word);
    try {
      const r = await api.batchAddWords({
        telegramId: accountId,
        sourceLang: word.sourceLang,
        targetLang: word.targetLang,
        items: [{ word: w.word }],
        enrich: true,
      });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["dictChars"] });
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words: [w.word], total: r.job.total, processed: 0 });
      show({ icon: "🌱", title: t("pop.addedToast", { word: w.word }) });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setAdding(null);
    }
  }

  const meaning = (w: CharWord) => (
    <span className={cn("min-w-0 truncate", w.english && word.targetLang !== "en" ? "italic text-ink-faint" : "text-ink-soft")}>
      {w.meaning}
    </span>
  );

  return (
    <section className="space-y-3">
      <h2 className="font-serif text-[15px] font-medium italic text-ink-soft">{t("chars.title")}</h2>
      {chars.map((c) => (
        <div key={c.word} className="rounded-[18px] border border-black/[0.06] bg-surface p-4">
          <div className="flex items-start gap-4">
            <StrokeOrder char={c.word} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {c.id ? (
                  <Link href={`/word/${c.id}`} className="font-zh text-[28px] leading-none text-ink hover:text-sage-deep">
                    {c.word}
                  </Link>
                ) : (
                  <span className="font-zh text-[28px] leading-none text-ink">{c.word}</span>
                )}
                {c.pinyin && <Pinyin text={c.pinyin} className="text-[17px] text-ink-muted" />}
                <SpeakButton text={c.word} lang={word.sourceLang} size="sm" />
                {c.level != null && (
                  <span className="rounded-full border border-black/[0.08] px-2 py-0.5 text-[11px] font-semibold text-ink-faint">
                    {c.level === 7 ? t("hsk.band79") : t("hsk.level", { n: c.level })}
                  </span>
                )}
              </div>
              <p className={cn("break-words text-[15px] leading-snug", c.english && word.targetLang !== "en" ? "italic text-ink-soft" : "text-ink")}>
                {c.meaning}
              </p>
            </div>
          </div>
          {c.words.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                {t("chars.wordsWith", { c: c.word })}
              </p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {c.words.map((w) => (
                  <li key={w.word}>
                    {w.id ? (
                      // One of the learner's words: the bridge from what they know.
                      <Link
                        href={`/word/${w.id}`}
                        title={t("chars.yours")}
                        className="flex items-center gap-2 rounded-[12px] border border-sage/30 bg-sage-tint/50 px-3 py-2 text-[14px] transition-colors hover:border-sage"
                      >
                        <span className="shrink-0 whitespace-nowrap font-zh text-[17px] text-sage-deep">{w.word}</span>
                        <Pinyin text={w.pinyin} className="shrink-0 text-[12px] text-ink-muted" />
                        {meaning(w)}
                        <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-sage-deep" />
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2 rounded-[12px] border border-black/[0.06] px-3 py-2 text-[14px]">
                        <span className="shrink-0 whitespace-nowrap font-zh text-[17px] text-ink">{w.word}</span>
                        <Pinyin text={w.pinyin} className="shrink-0 text-[12px] text-ink-muted" />
                        {meaning(w)}
                        <button
                          type="button"
                          onClick={() => void add(w)}
                          disabled={adding !== null}
                          aria-label={t("chars.add", { word: w.word })}
                          title={t("chars.add", { word: w.word })}
                          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/[0.08] text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
      {/* CC-CEDICT's licence asks for its name wherever its data shows. */}
      {data?.credit && (
        <p className="text-[11px] text-ink-faint">
          {someEnglish && <>{t("chars.englishNote")} </>}
          <a href={data.credit.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-ink-soft">
            {data.credit.source}
          </a>
          {" · "}
          <a href={data.credit.licenseUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-ink-soft">
            {data.credit.license}
          </a>
        </p>
      )}
    </section>
  );
}
