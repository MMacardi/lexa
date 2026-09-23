"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { HskReadiness } from "@/components/HskReadiness";
import { HskFirstRun } from "@/components/HskFirstRun";
import { HskDaily } from "@/components/HskDaily";
import { Button } from "@/components/ui/button";
import { GraduationCap } from "lucide-react";

// The door into the HSK loop for an account that already has cards (F11).
//
// It used to have none. The whole path — target, check, gap deck — lived inside
// FirstRun, which app/page.tsx renders only when the account holds zero cards,
// and the readiness mark rendered only for accounts that already held Chinese
// cards. So you needed Chinese cards to see the mark, and an empty account to
// get Chinese cards. Anyone who added a single word by any other route, or who
// used the app before the pivot, was locked out of the product's one loop — and
// even a brand-new learner got their gap deck exactly once, with no way to ask
// for the next batch in week two.
//
// The track is now the saved target on the account (User.hskTarget, there since
// F2), so this renders one of three things: today's words and the mark, the flow
// itself while it's open, or — for someone with no target yet — an offer they
// can decline for good. The next words used to be a button ("add more gap
// words"); they are now a daily drip (HskDaily) that doesn't wait to be asked.

const DISMISS_KEY = "lexa.hskOfferDismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false; // private mode / blocked storage: showing the offer is the safe miss
  }
}

export function HskTrack() {
  const { accountId, profile, refresh } = useAccount();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);

  const { data: stats } = useQuery({
    queryKey: ["stats", accountId],
    queryFn: () => api.stats(accountId),
  });

  const onTrack = profile?.hskTarget != null;
  const studiesChinese = stats?.languages.includes("zh") ?? false;

  if (open)
    return (
      <HskFirstRun
        onClose={() => {
          setOpen(false);
          // The flow saves the target on the account; the profile in context is
          // what decides whether the mark shows, so re-read it before closing.
          void refresh();
        }}
      />
    );

  if (onTrack || studiesChinese)
    return (
      <>
        <HskDaily />
        <HskReadiness />
      </>
    );

  if (dismissed) return null;

  return (
    <section className="anim-fade-up overflow-hidden rounded-[24px] border border-sage/25 bg-gradient-to-br from-sage-tint/50 via-surface to-surface p-6">
      <div className="flex items-center gap-2 text-sage-deep">
        <GraduationCap className="h-5 w-5" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">HSK</span>
      </div>
      <h3 className="mt-1.5 font-serif text-[22px] font-medium text-ink">{t("hskTrack.offerTitle")}</h3>
      <p className="mt-1.5 max-w-[540px] text-[15px] leading-relaxed text-ink-soft">{t("hskTrack.offerSub")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => setOpen(true)}>
          <GraduationCap className="mr-2 h-4 w-4" />
          {t("hskTrack.offerGo")}
        </Button>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(DISMISS_KEY, "1");
            } catch {
              /* a dismissal that doesn't persist is better than a crash */
            }
          }}
          className="text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          {t("hskTrack.offerDismiss")}
        </button>
      </div>
    </section>
  );
}
