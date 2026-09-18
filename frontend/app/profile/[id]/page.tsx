"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Flame, GraduationCap, Lock, Repeat } from "lucide-react";
import { api, type LearnerProfile, type Stats } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useDailyGoal } from "@/lib/goal";
import { errText } from "@/lib/errText";
import { langFlag, langLabel } from "@/lib/langs";
import { computeBadges } from "@/lib/achievements";
import { ActivityHeatmap } from "@/components/ActivityHeatmap";
import { DeckCard } from "@/components/DeckCard";
import { ErrorState } from "@/components/ErrorState";
import { HoverTip } from "@/components/ui/HoverTip";
import { Skeleton } from "@/components/ui/skeleton";

// Stats-shaped view of a profile's public numbers, so the same badge logic works.
// Daily-goal isn't meaningful for someone else's snapshot, so it stays locked.
function asStats(s: NonNullable<LearnerProfile["stats"]>): Stats {
  return {
    total: s.total,
    mastered: s.mastered,
    learning: Math.max(0, s.total - s.mastered),
    due: 0,
    trainedToday: 0,
    streak: s.streak,
    reviews: s.reviews,
    languages: s.languages,
    days: [],
    heat: s.heat,
  };
}

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const [goal] = useDailyGoal();
  const { data: p, isLoading, error } = useQuery({
    queryKey: ["profile", id],
    queryFn: () => api.learnerProfile(id),
    retry: false,
  });

  if (isLoading)
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-24 rounded-[18px]" />
        <Skeleton className="h-40 rounded-[18px]" />
      </div>
    );
  if (error || !p)
    return (
      <div className="space-y-4">
        <Link href="/friends" className="text-sm font-semibold text-ink-soft hover:text-ink">
          ← {t("nav.friends")}
        </Link>
        <ErrorState message={errText(error, t)} />
      </div>
    );

  const badges = p.stats ? computeBadges(asStats(p.stats), goal).filter((b) => b.done) : [];
  const since = new Date(p.since).toLocaleDateString(locale, { month: "long", year: "numeric" });

  return (
    <div className="anim-fade-up space-y-7">
      <div className="space-y-2">
        <Link href="/friends" className="text-sm font-semibold text-ink-soft hover:text-ink">
          ← {t("nav.friends")}
        </Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[28px] font-medium break-words sm:text-[34px] tracking-[-0.01em] text-ink">{p.name}</h1>
          {p.isFriend && (
            <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-deep">{t("profile.friend")}</span>
          )}
          {p.isMe && (
            <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-deep">{t("profile.you")}</span>
          )}
        </div>
        <p className="text-[13px] text-ink-faint">{t("profile.since", { date: since })}</p>
        {p.stats && p.stats.languages.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {p.stats.languages.map((l) => (
              <span key={l} className="rounded-full bg-sage-tint px-2.5 py-0.5 text-[12px] font-semibold text-sage-deep">
                {langFlag(l)} {langLabel(l)}
              </span>
            ))}
          </div>
        )}
      </div>

      {p.isMe && p.privacy && (
        <div className="flex flex-wrap items-center gap-2 rounded-[16px] border border-black/[0.06] bg-paper/60 px-4 py-3 text-[13px] text-ink-soft">
          <Lock className="h-4 w-4 text-ink-faint" />
          <span className="flex-1">
            {t("profile.myPrivacy", { profile: t(`privacy.${p.privacy.profile}`), decks: t(`privacy.${p.privacy.decks}`) })}
          </span>
          <Link href="/account#privacy" className="font-semibold text-sage-deep hover:underline">
            {t("profile.changePrivacy")} →
          </Link>
        </div>
      )}

      {p.stats ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile Icon={BookOpen} label={t("profile.words")} value={p.stats.total} />
            <Tile Icon={GraduationCap} label={t("profile.mastered")} value={p.stats.mastered} />
            <Tile Icon={Flame} label={t("profile.streak")} value={p.stats.streak} iconCls="text-orange-500" />
            <Tile Icon={Repeat} label={t("profile.reviews")} value={p.stats.reviews} />
          </div>

          <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("profile.activity")}</p>
            <ActivityHeatmap heat={p.stats.heat} />
          </section>

          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {badges.map((b) => (
                <HoverTip key={b.id} title={t(b.labelKey)} subtitle={t(b.descKey)} className="flex h-9 w-9 items-center justify-center rounded-full bg-sage-tint">
                  <b.Icon className="h-4 w-4 text-sage-deep" />
                </HoverTip>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="rounded-[16px] border border-dashed border-black/[0.12] bg-surface/60 p-5 text-center text-sm text-ink-soft">
          {t("profile.statsClosed")}
        </p>
      )}

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("profile.decks")}</p>
        {p.decksHidden ? (
          <p className="text-sm text-ink-faint">{t("profile.decksClosed")}</p>
        ) : p.decks.length === 0 ? (
          <p className="text-sm text-ink-faint">{p.isMe ? t("profile.noDecksMe") : t("profile.noDecks")}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {p.decks.map((d) => (
              <DeckCard key={d.id} deck={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({
  Icon,
  label,
  value,
  iconCls = "text-ink-faint",
}: {
  Icon: typeof BookOpen;
  label: string;
  value: number;
  iconCls?: string;
}) {
  return (
    <div className="rounded-[18px] border border-black/[0.06] bg-surface p-4">
      <Icon className={`h-4 w-4 ${iconCls}`} />
      <p className="mt-2 font-serif text-[28px] font-semibold leading-none text-ink">{value}</p>
      <p className="mt-1 text-[12px] font-medium text-ink-soft">{label}</p>
    </div>
  );
}
