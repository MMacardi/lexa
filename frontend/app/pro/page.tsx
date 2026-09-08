"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { useIsPro } from "@/lib/useIsPro";
import { cn } from "@/lib/utils";
import { Infinity as InfinityIcon, Globe, Sparkles, BookOpen, Layers, PackageOpen, Star, Check, ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Marketing / upgrade screen. Lays out every Pro benefit, a Free-vs-Pro table and
// pricing. Payment isn't wired yet — the CTA is a friendly "coming soon".
export default function ProPage() {
  const { t } = useI18n();
  const pro = useIsPro();
  const [notice, setNotice] = useState(false);

  // Where the user came from (set by the upsell popup): drives a contextual back
  // link and echoes the word they were adding. Falls back to the account page.
  const [origin, setOrigin] = useState<{ from?: string; word?: string }>({});
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("lexa.upsell");
      if (raw) setOrigin(JSON.parse(raw));
    } catch {}
  }, []);

  const from = origin.from;
  const back =
    from && (from === "/" || from.startsWith("/words"))
      ? { href: from, label: t("pro.backWords") }
      : from && !from.startsWith("/account")
        ? { href: from, label: t("pro.backHome") }
        : { href: "/account", label: t("pro.back") };

  const benefits: { Icon: LucideIcon; title: string; desc: string }[] = [
    { Icon: InfinityIcon, title: t("pro.b1"), desc: t("pro.b1d") },
    { Icon: Globe, title: t("pro.b2"), desc: t("pro.b2d") },
    { Icon: Sparkles, title: t("pro.b3"), desc: t("pro.b3d") },
    { Icon: BookOpen, title: t("pro.b4"), desc: t("pro.b4d") },
    { Icon: Layers, title: t("pro.b5"), desc: t("pro.b5d") },
    { Icon: PackageOpen, title: t("pro.b6"), desc: t("pro.b6d") },
  ];

  // [feature, free, pro] — a value of "✓"/"—" renders as an icon, text renders as-is.
  const rows: [string, string, string][] = [
    [t("pro.rCore"), "✓", "✓"],
    [t("pro.rDaily"), "20", "∞"],
    [t("pro.rMeaning"), t("pro.rMeaningFree"), t("pro.rMeaningPro")],
    [t("pro.rExamples"), "1", t("pro.rExamplesPro")],
    [t("pro.rTutor"), t("pro.rLimited"), "∞"],
    [t("pro.rReaderGen"), "3 / " + t("pro.perMonth"), "∞"],
    [t("pro.rOcr"), "5 / " + t("pro.perMonth"), "∞"],
    [t("pro.rImport"), "25", t("pro.rImportPro")],
    [t("pro.rGloss"), "✓", "✓"],
  ];

  const Cell = ({ v, strong }: { v: string; strong?: boolean }) =>
    v === "✓" ? (
      <Check className={cn("mx-auto h-4 w-4", strong ? "text-sage-deep" : "text-sage")} />
    ) : v === "—" ? (
      <span className="text-ink-faint">—</span>
    ) : (
      <span className={cn(strong ? "font-semibold text-ink" : "text-ink-soft")}>{v}</span>
    );

  return (
    <div className="anim-fade-up mx-auto max-w-[880px] space-y-10 pb-16">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Link href={back.href} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {back.label}
        </Link>
        {origin.word && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1 text-[13px] text-ink-soft">
            <span className="text-ink-faint">{t("pro.typedWord")}:</span>
            <span className="font-semibold text-ink">{origin.word}</span>
          </span>
        )}
      </div>

      {/* hero */}
      <div className="relative overflow-hidden rounded-[26px] border border-sage/25 bg-gradient-to-br from-sage-tint/70 via-surface to-surface p-8 text-center sm:p-12">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sage px-3 py-1 text-[13px] font-semibold text-white">
          <Star className="h-3.5 w-3.5 fill-current" /> Onomika Pro
        </span>
        <h1 className="mt-4 font-serif text-[34px] font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[44px]">
          {t("pro.heroTitle")}
        </h1>
        <p className="mx-auto mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-soft sm:text-[17px]">
          {t("pro.heroSub")}
        </p>
        {pro && (
          <p className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-sage/15 px-3 py-1.5 text-[13px] font-semibold text-sage-deep">
            <Check className="h-4 w-4" /> {t("pro.already")}
          </p>
        )}
      </div>

      {/* benefits grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {benefits.map(({ Icon, title, desc }) => (
          <div key={title} className="rounded-[18px] border border-black/[0.07] bg-surface p-5">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] bg-sage-tint text-sage-deep">
              <Icon className="h-5 w-5" />
            </span>
            <h3 className="mt-3 font-serif text-[18px] font-semibold text-ink">{title}</h3>
            <p className="mt-1 text-[14px] leading-snug text-ink-soft">{desc}</p>
          </div>
        ))}
      </div>

      {/* comparison */}
      <div>
        <h2 className="mb-3 font-serif text-[22px] font-medium text-ink">{t("pro.compareTitle")}</h2>
        <div className="overflow-hidden rounded-[18px] border border-black/[0.08]">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-black/[0.08] bg-surface text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 text-left font-semibold">{t("pro.feature")}</th>
                <th className="px-3 py-3 text-center font-semibold">{t("pro.free")}</th>
                <th className="px-3 py-3 text-center font-semibold text-sage-deep">Pro</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([feature, free, proVal], i) => (
                <tr key={feature} className={cn("border-b border-black/[0.05] last:border-b-0", i % 2 ? "bg-black/[0.015]" : "bg-surface")}>
                  <td className="px-4 py-2.5 text-left text-ink">{feature}</td>
                  <td className="px-3 py-2.5 text-center"><Cell v={free} /></td>
                  <td className="bg-sage-tint/30 px-3 py-2.5 text-center"><Cell v={proVal} strong /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* pricing */}
      <div>
        <h2 className="mb-3 font-serif text-[22px] font-medium text-ink">{t("pro.pricingTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* monthly */}
          <div className="flex flex-col rounded-[20px] border border-black/[0.08] bg-surface p-6">
            <div className="text-[13px] font-semibold uppercase tracking-wide text-ink-faint">{t("pro.monthly")}</div>
            <div className="mt-2 font-serif text-[34px] font-semibold text-ink">
              499 ₽<span className="text-[15px] font-medium text-ink-faint">{t("pro.perMonthSuffix")}</span>
            </div>
            <p className="mt-1 text-[13px] text-ink-soft">{t("pro.monthlyHint")}</p>
            <button
              type="button"
              onClick={() => setNotice(true)}
              className="mt-5 w-full rounded-full border border-sage/50 bg-sage-tint/40 px-4 py-2.5 text-sm font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
            >
              {t("pro.cta")}
            </button>
          </div>
          {/* annual — highlighted */}
          <div className="relative flex flex-col rounded-[20px] border-2 border-sage bg-gradient-to-br from-sage-tint/50 to-surface p-6 shadow-[0_18px_44px_rgba(46,42,38,0.12)]">
            <span className="absolute right-5 top-5 rounded-full bg-sage px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
              {t("pro.save")}
            </span>
            <div className="text-[13px] font-semibold uppercase tracking-wide text-sage-deep">{t("pro.annual")}</div>
            <div className="mt-2 font-serif text-[34px] font-semibold text-ink">
              3 990 ₽<span className="text-[15px] font-medium text-ink-faint">{t("pro.perYearSuffix")}</span>
            </div>
            <p className="mt-1 text-[13px] text-ink-soft">{t("pro.annualHint")}</p>
            <button
              type="button"
              onClick={() => setNotice(true)}
              className="mt-5 w-full rounded-full bg-sage px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
            >
              {t("pro.cta")}
            </button>
          </div>
        </div>
        {notice && (
          <p className="mt-3 rounded-[12px] border border-dashed border-black/[0.12] bg-paper/50 p-3 text-center text-[13px] text-ink-soft">
            {t("pro.soon")}
          </p>
        )}
        <p className="mt-4 text-center text-[12px] leading-snug text-ink-faint">{t("pro.footnote")}</p>
      </div>
    </div>
  );
}
