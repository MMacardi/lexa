"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Search } from "lucide-react";
import { api, type DeckSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { langFlag, langLabel } from "@/lib/langs";
import { DeckCard } from "@/components/DeckCard";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const POPULAR_COUNT = 6;

export default function CommunityPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [q, setQ] = useState(""); // debounced
  const [lang, setLang] = useState("all");
  const [target, setTarget] = useState("all");
  const [code, setCode] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const { data: decks, isLoading, isError, refetch } = useQuery({
    queryKey: ["community", "decks", q],
    queryFn: () => api.communityDecks({ q: q || undefined }),
  });
  const { data: friendDecks } = useQuery({
    queryKey: ["community", "friends"],
    queryFn: () => api.friendDecks(),
  });

  const openCode = useMutation({
    mutationFn: () => api.deckByCode(code),
    onSuccess: ({ id }) => router.push(`/community/${id}?code=${encodeURIComponent(code.trim().toUpperCase())}`),
  });

  const all = decks ?? [];
  const langs = Array.from(new Set(all.map((d) => d.sourceLang))).sort();
  const targets = Array.from(new Set(all.filter((d) => lang === "all" || d.sourceLang === lang).map((d) => d.targetLang))).sort();
  const filtered = all
    .filter((d) => lang === "all" || d.sourceLang === lang)
    .filter((d) => target === "all" || d.targetLang === target);
  const browsing = !q && lang === "all" && target === "all";
  const popular = filtered.filter((d) => d.weekLearners > 0 && !d.mine).slice(0, POPULAR_COUNT);
  const library = filtered.filter((d) => d.author.official);
  const others = filtered.filter((d) => !d.author.official);

  return (
    <div className="space-y-7">
      <div className="anim-fade-up">
        <h1 className="font-serif text-[28px] font-medium break-words sm:text-[34px] tracking-[-0.01em] text-ink">{t("nav.community")}</h1>
        <p className="mt-1.5 text-ink-soft">{t("community.subtitle")}</p>
      </div>

      <div className="anim-fade-up flex flex-col gap-3 rounded-[18px] border border-black/[0.06] bg-surface/70 p-4 sm:flex-row" style={{ animationDelay: "60ms" }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("community.searchPlaceholder")}
            className="pl-10"
          />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) openCode.mutate();
          }}
          className="flex gap-2"
        >
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("community.codePlaceholder")}
              maxLength={16}
              className="w-40 pl-10 uppercase"
            />
          </div>
          <Button type="submit" variant="outline" disabled={!code.trim() || openCode.isPending} className="shrink-0">
            {t("community.openCode")}
          </Button>
        </form>
      </div>
      {openCode.isError && <p className="-mt-4 text-sm font-medium text-warn-text">{errText(openCode.error, t)}</p>}

      {langs.length > 1 && (
        <div className="space-y-2">
          <Chips
            label={t("community.studying")}
            value={lang}
            options={langs}
            onChange={(v) => {
              setLang(v);
              setTarget("all");
            }}
          />
          {targets.length > 1 && <Chips label={t("community.translatedTo")} value={target} options={targets} onChange={setTarget} />}
        </div>
      )}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-[20px]" />
          ))}
        </div>
      )}
      {isError && <ErrorState message={t("common.error")} onRetry={() => refetch()} />}

      {decks && browsing && (
        <>
          {friendDecks && friendDecks.length > 0 && <Section title={t("community.fromFriends")} decks={friendDecks} />}
          {popular.length > 0 && <Section title={t("community.popular")} decks={popular} />}
          {library.length > 0 && <Section title={t("community.library")} hint={t("community.libraryHint")} decks={library} />}
          {others.length > 0 && <Section title={t("community.fromLearners")} decks={others} />}
        </>
      )}

      {decks && !browsing && (
        filtered.length === 0 ? (
          <p className="rounded-[18px] border border-dashed border-black/[0.12] bg-surface/60 p-8 text-center text-sm text-ink-soft">
            {t("community.noResults")}
          </p>
        ) : (
          <Section title={t("community.results", { n: filtered.length })} decks={filtered} />
        )
      )}

      <p className="text-center text-xs text-ink-faint">{t("community.shareHint")}</p>
    </div>
  );
}

function Section({ title, hint, decks }: { title: string; hint?: string; decks: DeckSummary[] }) {
  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{title}</p>
        {hint && <p className="mt-0.5 text-[13px] text-ink-soft">{hint}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {decks.map((d) => (
          <DeckCard key={d.id} deck={d} />
        ))}
      </div>
    </section>
  );
}

function Chips({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
      active ? "bg-sage text-white" : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[13px] font-medium text-ink-soft">{label}</span>
      <button onClick={() => onChange("all")} className={chip(value === "all")}>
        {t("common.all")}
      </button>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className={chip(value === o)}>
          {langFlag(o)} {langLabel(o)}
        </button>
      ))}
    </div>
  );
}
