"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, isDue } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useNewPerDay } from "@/lib/learnPrefs";
import { Compass, ArrowRight } from "lucide-react";

// The coach's daily voice on the Today screen: one warm, adaptive line + a single
// clear next step, computed from the deck (no AI, no tokens). It makes the mentor
// feel like a presence rather than a separate page — it always knows what to do next.
export function CoachBriefing() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const router = useRouter();
  const newPerDay = useNewPerDay();

  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const deck = words ?? [];

  const brief = useMemo(() => {
    const weakIds = deck.filter((w) => (w.lapses ?? 0) >= 2).map((w) => w.id);
    const due = deck.filter(isDue).length;
    const reviewDue = deck.filter((w) => w.reviewCount > 0 && isDue(w)).length;
    const newLeft = deck.filter((w) => w.reviewCount === 0).length;

    // Priority: shore up weak spots → clear reviews → meet new words → idle nudge.
    if (weakIds.length > 0) {
      return {
        text: t("coach.briefWeak", { n: weakIds.length }),
        cta: t("coach.briefWeakCta"),
        run: () => {
          try {
            sessionStorage.setItem("lexa.coachFocusIds", JSON.stringify(weakIds.slice(0, 8)));
          } catch {
            /* ignore */
          }
          router.push("/coach/practice");
        },
      };
    }
    if (reviewDue > 0) {
      return { text: t("coach.briefDue", { n: reviewDue }), cta: t("coach.briefDueCta"), run: () => router.push("/review") };
    }
    if (newLeft > 0) {
      return {
        text: t("coach.briefNew", { n: Math.min(newLeft, newPerDay) }),
        cta: t("coach.briefNewCta"),
        run: () => router.push("/review"),
      };
    }
    return { text: t("coach.briefIdle"), cta: t("coach.briefIdleCta"), run: () => router.push("/coach") };
  }, [deck, newPerDay, router, t]);

  if (deck.length === 0) return null;

  return (
    <button
      type="button"
      onClick={brief.run}
      className="anim-fade-up group flex w-full items-center gap-4 rounded-[20px] border border-sage/25 bg-gradient-to-br from-sage-tint/55 via-surface to-surface p-4 text-left transition-shadow hover:shadow-[0_12px_32px_rgba(46,42,38,0.09)] sm:p-5"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sage text-white">
        <Compass className="h-[22px] w-[22px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-sage-deep/80">{t("coach.title")}</span>
        <span className="mt-0.5 block text-[15px] font-medium leading-snug text-ink">{brief.text}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors group-hover:bg-sage-deep sm:inline-flex">
        {brief.cta} <ArrowRight className="h-4 w-4" />
      </span>
    </button>
  );
}
