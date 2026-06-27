"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";

function Tile({ value, label, accent }: { value: React.ReactNode; label: string; accent?: string }) {
  return (
    <div className="rounded-[16px] border border-black/[0.06] bg-paper p-4">
      <div className={`font-serif text-[26px] font-bold leading-none ${accent ?? "text-ink"}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[12px] font-medium text-ink-soft">{label}</div>
    </div>
  );
}

export function StatsPanel() {
  const { accountId } = useAccount();
  const { data } = useQuery({
    queryKey: ["stats", accountId],
    queryFn: () => api.stats(accountId),
  });

  if (!data) return null;

  const max = Math.max(1, ...data.days.map((d) => Math.max(d.reviews, d.added)));

  return (
    <section className="anim-fade-up rounded-[24px] border border-black/[0.06] bg-surface p-6">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-[20px] font-medium italic text-ink">Your progress</h3>
        <span className="text-[13px] font-medium text-ink-faint">last 14 days</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile value={data.total} label="words collected" />
        <Tile value={data.mastered} label="mastered" accent="text-sage" />
        <Tile value={data.trainedToday} label="trained today" />
        <Tile value={<>🔥 {data.streak}</>} label="day streak" accent="text-orange-500" />
      </div>

      {/* 14-day chart: reviews (sage) + added (taupe) per day */}
      <div className="mt-6">
        <div className="flex h-32 items-end gap-1 border-b border-black/[0.08] pb-px">
          {data.days.map((d, i) => {
            const last = i === data.days.length - 1;
            const active = d.reviews > 0 || d.added > 0;
            const barH = (v: number) => (v > 0 ? `${Math.max(8, (v / max) * 100)}%` : "0%");
            return (
              <div
                key={d.date}
                className="flex h-full flex-1 flex-col justify-end rounded-t-md transition-colors hover:bg-black/[0.025]"
                title={`${d.date} · ${d.reviews} reviewed · ${d.added} added`}
              >
                {/* track keeps empty days visible as a faint column */}
                <div className="relative flex h-full items-end justify-center gap-[3px] px-[3px]">
                  <span className="absolute inset-x-1 bottom-0 top-3 rounded-t-[5px] bg-black/[0.03]" />
                  <div
                    className="relative w-1/2 rounded-t-[4px] bg-sage transition-[height] duration-500"
                    style={{ height: barH(d.reviews) }}
                  />
                  <div
                    className="relative w-1/2 rounded-t-[4px] bg-taupe transition-[height] duration-500"
                    style={{ height: barH(d.added) }}
                  />
                </div>
                <div className={`mt-1.5 text-center text-[9px] ${last ? "font-bold text-ink" : active ? "text-ink-soft" : "text-ink-faint/60"}`}>
                  {last ? "today" : d.date.slice(8)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-4 text-[12px] font-medium text-ink-soft">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sage" /> reviewed</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-taupe" /> added</span>
        </div>
      </div>
    </section>
  );
}
