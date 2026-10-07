"use client";

import { type HskTag, type HskVersion } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// The level tag on a card. A word usually sits at different levels in the two
// lists, so the badge shows the level on the learner's own list (the one Today
// and the Reader count on: 教育 is HSK 4 on 2.0, HSK 2 on 3.0), the other list
// only for a word that isn't on theirs, and the title spells out every list.
export function HskBadge({ hsk, className }: { hsk?: HskTag | null; className?: string }) {
  const { t } = useI18n();
  const { profile } = useAccount();
  if (!hsk) return null;
  const own: HskVersion = profile?.hskVersion ?? "3.0";
  const version: HskVersion = hsk[own] ? own : own === "3.0" ? "2.0" : "3.0";
  const level = hsk[version];
  if (!level) return null;

  const title = (["3.0", "2.0"] as HskVersion[])
    .filter((v) => hsk[v])
    .map((v) => t("hsk.tag", { v, n: hsk[v] === 7 ? "7–9" : hsk[v]! }))
    .join(" · ");

  return (
    <span
      title={title}
      className={cn(
        "shrink-0 rounded-full bg-sage-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sage-deep",
        className,
      )}
    >
      {level === 7 ? t("hsk.band79") : t("hsk.level", { n: level })}
    </span>
  );
}
