"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notFound } from "next/navigation";
import { api, type ModeratedDeck } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { cn } from "@/lib/utils";

// Owner-only operations dashboard. Non-admins get a 404 (the backend independently
// rejects them with 403 on /api/admin/stats). Kept deliberately utilitarian — this
// is an internal tool, not a learner-facing surface.

const fmtInt = (n: number) => n.toLocaleString();
// ¥ costs are tiny at beta scale: show 4dp under ¥0.01 so small spend isn't "¥0.00".
const fmtCny = (n: number) => (n === 0 ? "¥0" : n < 0.01 ? `¥${n.toFixed(4)}` : `¥${n.toFixed(2)}`);

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[16px] border border-black/[0.06] bg-surface px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">{label}</p>
      <p className="mt-1 font-serif text-[26px] font-semibold leading-none text-ink">{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-ink-soft">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-black/[0.06] bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-black/[0.07] text-left text-[11px] uppercase tracking-[0.07em] text-ink-faint">
            {head.map((h, i) => (
              <th key={h} className={cn("py-2 font-semibold", i > 0 && "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="py-4 text-center text-ink-faint">—</td></tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-b border-black/[0.04] last:border-0">
                {r.map((c, j) => (
                  <td key={j} className={cn("py-1.5", j === 0 ? "font-medium text-ink" : "text-right text-ink-soft tabular-nums")}>{c}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Deck moderation queue: reported decks (keep / remove) and removed ones (restore). */
function Reports() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-reports"], queryFn: () => api.adminReports() });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "dismiss" | "delist" | "restore" }) => api.moderateDeck(id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-reports"] }),
  });
  if (!data) return null;

  const btn = "rounded-full border border-black/[0.08] bg-surface px-3 py-1 text-[12px] font-semibold text-ink-muted hover:bg-black/[0.03] disabled:opacity-50";
  const deckLine = (d: ModeratedDeck) => (
    <div className="flex flex-wrap items-baseline gap-2">
      <Link href={`/community/${d.id}`} className="font-semibold text-ink hover:underline">{d.name}</Link>
      <span className="text-[12px] text-ink-faint">{d.author.name} · {d.words} · {d.visibility}</span>
    </div>
  );

  return (
    <Section title={t("admin.reports")}>
      {data.reported.length === 0 ? (
        <p className="text-sm text-ink-faint">{t("admin.noReports")}</p>
      ) : (
        <div className="divide-y divide-black/[0.05]">
          {data.reported.map(({ deck, reports }) => (
            <div key={deck.id} className="space-y-2 py-3 first:pt-0">
              {deckLine(deck)}
              <p className="text-[12px] font-semibold text-warn-text">
                {t("admin.reportsN", { n: reports.length })}
                {reports.length >= data.hideAt && ` · ${t("admin.heldOut")}`}
              </p>
              <ul className="space-y-1 text-[13px] text-ink-soft">
                {reports.map((r, i) => (
                  <li key={i}>
                    <span className="font-semibold">{t(`report.${r.reason}`)}</span> — {r.by},{" "}
                    {new Date(r.at).toLocaleDateString(locale)}
                    {r.note && <span className="text-ink-faint"> · “{r.note}”</span>}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button className={btn} disabled={act.isPending} onClick={() => act.mutate({ id: deck.id, action: "dismiss" })}>
                  {t("admin.dismiss")}
                </button>
                <button
                  className={cn(btn, "text-warn-text")}
                  disabled={act.isPending}
                  onClick={() => act.mutate({ id: deck.id, action: "delist" })}
                >
                  {t("admin.delist")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {data.delisted.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-black/[0.05] pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("admin.delisted")}</p>
          {data.delisted.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2">
              {deckLine(d)}
              <button className={btn} disabled={act.isPending} onClick={() => act.mutate({ id: d.id, action: "restore" })}>
                {t("admin.restore")}
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Activation funnel, rolling retention and use-step quality (BACKLOG F1). */
function Funnel() {
  const { t, locale } = useI18n();
  const { data } = useQuery({ queryKey: ["admin-funnel"], queryFn: () => api.adminFunnel() });
  if (!data) return null;

  return (
    <Section title={t("admin.funnel")}>
      {data.events === 0 ? (
        <p className="text-sm text-ink-faint">{t("admin.funnelEmpty")}</p>
      ) : (
        <div className="space-y-5">
          <p className="text-[12px] text-ink-faint">
            {t("admin.funnelSince", {
              date: data.since ? new Date(data.since).toLocaleDateString(locale) : "—",
              n: fmtInt(data.events),
            })}
          </p>
          <Table
            head={[t("admin.step"), t("admin.learners"), t("admin.share")]}
            rows={data.funnel.map((f) => [t(`admin.step.${f.step}`), fmtInt(f.users), `${f.pct}%`])}
          />
          <div>
            <Table
              head={[t("admin.retention"), t("admin.returned"), t("admin.eligible"), t("admin.share")]}
              rows={data.retention.map((r) => [`D${r.day}`, fmtInt(r.returned), fmtInt(r.eligible), `${r.pct}%`])}
            />
            <p className="mt-2 text-[12px] text-ink-faint">{t("admin.retentionNote")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Table
              head={[t("admin.byKind"), t("admin.useSteps")]}
              rows={data.useSteps.byKind.map((k) => [k.kind, fmtInt(k.count)])}
            />
            <Table
              head={[t("admin.byGrade"), t("admin.useSteps")]}
              rows={data.useSteps.byGrade.map((g) => [g.grade, fmtInt(g.count)])}
            />
          </div>
          <Table
            head={[t("admin.eventsByDay"), t("admin.total")]}
            rows={[...data.byDay].reverse().slice(0, 30).map((d) => [d.date, fmtInt(d.count)])}
          />
        </div>
      )}
    </Section>
  );
}

export default function AdminPage() {
  const { ready, profile } = useAccount();
  const { t } = useI18n();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.adminStats(),
    enabled: ready && !!profile?.isAdmin,
  });

  if (!ready) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  // Not the owner → pretend the route doesn't exist.
  if (!profile?.isAdmin) notFound();

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !data) return <ErrorState message={t("common.error")} />;

  const { users, content, engagement, invites, tokens } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-[28px] font-semibold text-ink">{t("admin.title")}</h1>
        <p className="text-sm text-ink-soft">
          {t("admin.cost")}: <span className="font-semibold text-sage-deep">{fmtCny(tokens.totals.costCny)}</span>
          <span className="text-ink-faint"> · {fmtInt(tokens.totals.total)} {t("admin.tokens")}</span>
        </p>
      </div>

      <Reports />

      <Funnel />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={t("admin.users")} value={fmtInt(users.total)} sub={`${t("admin.invited")}: ${fmtInt(users.invited)}`} />
        <Tile label={t("admin.newToday")} value={fmtInt(users.newToday)} sub={`7d ${fmtInt(users.new7d)} · 30d ${fmtInt(users.new30d)}`} />
        <Tile label={t("admin.dau")} value={fmtInt(engagement.dau)} sub={`WAU ${fmtInt(engagement.wau)}`} />
        <Tile label={t("admin.reviews")} value={fmtInt(engagement.reviewsTotal)} sub={`${t("admin.newToday")}: ${fmtInt(engagement.reviewsToday)}`} />
        <Tile label={t("admin.words")} value={fmtInt(content.words)} sub={`${t("admin.examples")}: ${fmtInt(content.examples)}`} />
        <Tile label={t("admin.scenes")} value={fmtInt(content.sceneSessions)} sub={`${t("admin.readerTexts")}: ${fmtInt(content.readerTexts)}`} />
        <Tile label={t("admin.imports")} value={fmtInt(content.importJobs)} sub={`${t("admin.collections")}: ${fmtInt(content.collections)}`} />
        <Tile label={t("admin.invitesRedeemed")} value={fmtInt(invites.redeemed)} sub={`${t("admin.minted")}: ${fmtInt(invites.minted)}`} />
      </div>

      {/* Token spend */}
      <Section title={t("admin.tokensAllTime")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label={t("admin.calls")} value={fmtInt(tokens.totals.calls)} />
          <Tile label={t("admin.prompt")} value={fmtInt(tokens.totals.prompt)} />
          <Tile label={t("admin.completion")} value={fmtInt(tokens.totals.completion)} />
          <Tile label={t("admin.cost")} value={fmtCny(tokens.totals.costCny)} />
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("admin.byModel")}>
          <Table
            head={["model", t("admin.calls"), t("admin.total"), t("admin.cost")]}
            rows={tokens.byModel.map((m) => [m.model, fmtInt(m.calls), fmtInt(m.total), fmtCny(m.costCny)])}
          />
        </Section>
        <Section title={t("admin.byFeature")}>
          <Table
            head={["feature", t("admin.calls"), t("admin.total"), t("admin.cost")]}
            rows={tokens.byFeature.map((f) => [f.feature, fmtInt(f.calls), fmtInt(f.total), fmtCny(f.costCny)])}
          />
        </Section>
      </div>

      <Section title={t("admin.byUser")}>
        <Table
          head={["user", t("admin.calls"), t("admin.total"), t("admin.cost")]}
          rows={tokens.byUser.map((u) => [
            u.name ?? t("admin.unattributed"),
            fmtInt(u.calls),
            fmtInt(u.total),
            fmtCny(u.costCny),
          ])}
        />
      </Section>

      <Section title={t("admin.byDay")}>
        <Table
          head={["date", t("admin.calls"), t("admin.total"), t("admin.cost")]}
          rows={[...tokens.byDay].reverse().map((d) => [d.date, fmtInt(d.calls), fmtInt(d.total), fmtCny(d.costCny)])}
        />
      </Section>

      {data.signups.length > 0 && (
        <Section title={t("admin.signups")}>
          <Table
            head={["date", t("admin.users")]}
            rows={[...data.signups].reverse().map((s) => [s.date, fmtInt(s.count)])}
          />
        </Section>
      )}
    </div>
  );
}
