"use client";

import { useState } from "react";
import { localDay } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

// The exam day, picked on a month grid rather than typed or guessed from "in 1–3
// months" (BACKLOG "A plan with a date"): the bucket went stale the week after it
// was chosen, a day doesn't. Past days can't be picked; "No date yet" clears it.

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function dateLocale(locale: string) {
  return locale === "ru" ? "ru-RU" : locale === "zh" ? "zh-CN" : "en-US";
}

/** "22 November 2026" in the interface language. */
export function formatDay(day: string, locale: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(dateLocale(locale), opts);
}

/** "14 нояб." — with the year only when it isn't this one ("31 окт. 2027"). */
export function shortDay(day: string, locale: string) {
  const sameYear = day.slice(0, 4) === String(new Date().getFullYear());
  return formatDay(day, locale, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }).replace(
    /\s*г\.$/,
    "",
  );
}

export function ExamCalendar({ value, onChange }: { value: string | null; onChange: (day: string | null) => void }) {
  const { t, locale } = useI18n();
  const today = localDay();
  const start = value && value >= today ? value : today;
  const [month, setMonth] = useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 }));

  // Monday first where the calendar is printed that way (ru, zh), Sunday for en.
  const mondayFirst = locale !== "en";
  const first = new Date(month.y, month.m, 1);
  const lead = (first.getDay() + (mondayFirst ? 6 : 0)) % 7;
  const days = new Date(month.y, month.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    // 2024-01-01 was a Monday, 2023-12-31 a Sunday.
    new Date(2024, 0, (mondayFirst ? 1 : 0) + i).toLocaleDateString(dateLocale(locale), { weekday: "short" }),
  );
  // "сентябрь 2026 г." → "Сентябрь 2026": a capital for the month, no "г." after the year.
  const long = first.toLocaleDateString(dateLocale(locale), { month: "long", year: "numeric" }).replace(/\s*г\.$/, "");
  const title = long.charAt(0).toUpperCase() + long.slice(1);
  const atStart = month.y === Number(today.slice(0, 4)) && month.m === Number(today.slice(5, 7)) - 1;
  const shift = (by: number) =>
    setMonth(({ y, m }) => {
      const d = new Date(y, m + by, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <div className="rounded-[16px] border border-black/[0.08] bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          disabled={atStart}
          aria-label={t("plan.prevMonth")}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-black/[0.05] disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[14px] font-semibold text-ink">{title}</span>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label={t("plan.nextMonth")}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-black/[0.05]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdays.map((w, i) => (
          <span key={i} className="pb-1 text-[11px] font-semibold uppercase text-ink-faint">
            {w.replace(".", "")}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />;
          const day = iso(month.y, month.m, d);
          const past = day < today;
          const on = day === value;
          return (
            <button
              key={i}
              type="button"
              disabled={past}
              onClick={() => onChange(day)}
              aria-pressed={on}
              className={cn(
                "flex h-9 items-center justify-center rounded-full text-[14px] tabular-nums transition-colors",
                on
                  ? "bg-sage font-semibold text-white"
                  : past
                    ? "text-ink-faint/40"
                    : "text-ink hover:bg-sage-tint/70",
                day === today && !on && "font-semibold text-sage-deep ring-1 ring-sage/40",
              )}
            >
              {d}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-black/[0.06] pt-2">
        <span className="text-[13px] text-ink-soft">
          {value ? formatDay(value, locale) : t("onb.exam.none")}
        </span>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="text-[13px] font-semibold text-ink-muted hover:text-ink">
            {t("plan.noDate")}
          </button>
        )}
      </div>
    </div>
  );
}
