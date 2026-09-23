"use client";

import { type HskTag, type HskVersion } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// The level tag on a card. A word usually sits at different levels in the two
// lists, so the badge shows the HSK 3.0 one (the standard the textbooks are
// moving to) and the title spells out every list it appears on.
export function HskBadge({ hsk, className }: { hsk?: HskTag | null; className?: string }) {
  const { t } = useI18n();
  if (!hsk) return null;
  const version: HskVersion = hsk["3.0"] ? "3.0" : "2.0";
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
