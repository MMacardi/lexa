import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/db.js";
import { requireAdmin } from "../lib/gate.js";
import { costCny } from "../lib/pricing.js";
import { moderateDeck, moderationQueue } from "../services/moderation.js";

// Owner-only operations dashboard: one aggregated snapshot of how the beta is
// being used (users, content, engagement, invites) and exactly what the AI is
// costing (real tokens + ¥ by model / feature / user / day). Guarded by requireAdmin,
// which is itself behind the global identity + invite gate in index.ts.
export const adminRouter = Router();
// Scoped to /admin paths: this router is mounted at /api alongside the others, so
// an unscoped use() would 403 every later /api route for non-admins.
adminRouter.use("/admin", requireAdmin);

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
// ¥ amounts are tiny at beta scale; round to 4 dp to kill float noise without
// collapsing small costs to 0.00. The frontend formats for display.
const money = (n: number) => Math.round(n * 1e4) / 1e4;

adminRouter.get("/admin/stats", async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const since7d = new Date(now - 7 * DAY);
    const since30d = new Date(now - 30 * DAY);

    const [
      usersTotal,
      usersInvited,
      usersNewToday,
      usersNew7d,
      usersNew30d,
      words,
      examples,
      readerTexts,
      sceneSessions,
      importJobs,
      collections,
      reviewsTotal,
      reviewsToday,
      dauRows,
      wauRows,
      invitesMinted,
      invitesRedeemed,
      tokTotals,
      tokByModel,
      tokByFeatureModel,
      tokByUserModel,
      recentUsers,
      recentTokens,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { invited: true } }),
      prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.user.count({ where: { createdAt: { gte: since7d } } }),
      prisma.user.count({ where: { createdAt: { gte: since30d } } }),
      prisma.word.count(),
      prisma.example.count(),
      prisma.readerText.count(),
      prisma.sceneSession.count(),
      prisma.importJob.count(),
      prisma.collection.count(),
      prisma.reviewEvent.count(),
      prisma.reviewEvent.count({ where: { createdAt: { gte: startOfToday } } }),
      // Distinct reviewers today / last 7d, via groupBy (one row per user).
      prisma.reviewEvent.groupBy({ by: ["userId"], where: { createdAt: { gte: startOfToday } } }),
      prisma.reviewEvent.groupBy({ by: ["userId"], where: { createdAt: { gte: since7d } } }),
      prisma.inviteCode.count(),
      prisma.inviteCode.count({ where: { redeemedAt: { not: null } } }),
      prisma.tokenUsage.aggregate({
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true, cachedTokens: true },
        _count: { _all: true },
      }),
      prisma.tokenUsage.groupBy({
        by: ["model"],
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true, cachedTokens: true },
        _count: { _all: true },
      }),
      // feature × model so per-feature cost stays exact (a feature may span models).
      prisma.tokenUsage.groupBy({
        by: ["feature", "model"],
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true, cachedTokens: true },
        _count: { _all: true },
      }),
      // user × model: one aggregate row per (user, model), cheap even for every user.
      prisma.tokenUsage.groupBy({
        by: ["telegramId", "model"],
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true, cachedTokens: true },
        _count: { _all: true },
      }),
      prisma.user.findMany({ where: { createdAt: { gte: since30d } }, select: { createdAt: true } }),
      prisma.tokenUsage.findMany({
        where: { createdAt: { gte: since30d } },
        select: { createdAt: true, model: true, promptTokens: true, completionTokens: true, totalTokens: true, cachedTokens: true },
      }),
    ]);

    // --- tokens: all-time by model (cost is linear per model, so summing tokens
    // then applying that model's rate is exact) ---
    const byModel = tokByModel
      .map((r) => {
        const prompt = r._sum.promptTokens ?? 0;
        const completion = r._sum.completionTokens ?? 0;
        return {
          model: r.model,
          calls: r._count._all,
          prompt,
          completion,
          total: r._sum.totalTokens ?? 0,
          costCny: money(costCny(r.model, prompt, completion, r._sum.cachedTokens ?? 0)),
        };
      })
      .sort((a, b) => b.costCny - a.costCny);

    const totalCost = money(byModel.reduce((s, m) => s + m.costCny, 0));

    // --- tokens: all-time by feature (fold the model split back into exact cost) ---
    const featureMap = new Map<string, { feature: string; calls: number; total: number; costCny: number }>();
    for (const r of tokByFeatureModel) {
      const prompt = r._sum.promptTokens ?? 0;
      const completion = r._sum.completionTokens ?? 0;
      const cost = costCny(r.model, prompt, completion, r._sum.cachedTokens ?? 0);
      const row = featureMap.get(r.feature) ?? { feature: r.feature, calls: 0, total: 0, costCny: 0 };
      row.calls += r._count._all;
      row.total += r._sum.totalTokens ?? 0;
      row.costCny += cost;
      featureMap.set(r.feature, row);
    }
    const byFeature = [...featureMap.values()]
      .map((r) => ({ ...r, costCny: money(r.costCny) }))
      .sort((a, b) => b.costCny - a.costCny);

    // --- tokens: all-time by user (null telegramId = pre-attribution / no user) ---
    const userMap = new Map<string | null, { calls: number; total: number; costCny: number }>();
    for (const r of tokByUserModel) {
      const prompt = r._sum.promptTokens ?? 0;
      const completion = r._sum.completionTokens ?? 0;
      const row = userMap.get(r.telegramId) ?? { calls: 0, total: 0, costCny: 0 };
      row.calls += r._count._all;
      row.total += r._sum.totalTokens ?? 0;
      row.costCny += costCny(r.model, prompt, completion, r._sum.cachedTokens ?? 0);
      userMap.set(r.telegramId, row);
    }
    const ids = [...userMap.keys()].filter((id): id is string => id !== null);
    const names = await prisma.user.findMany({
      where: { telegramId: { in: ids } },
      select: { telegramId: true, displayName: true, firstName: true, username: true, email: true },
    });
    const nameOf = new Map(
      names.map((u) => [u.telegramId, u.displayName || u.firstName || (u.username && `@${u.username}`) || u.email || u.telegramId]),
    );
    const byUser = [...userMap.entries()]
      .map(([id, r]) => ({ telegramId: id, name: id ? nameOf.get(id) ?? id : null, ...r, costCny: money(r.costCny) }))
      .sort((a, b) => b.costCny - a.costCny);

    // --- tokens: last 30 days by day (per-row cost → accurate mixed-model days) ---
    const dayMap = new Map<string, { date: string; calls: number; total: number; costCny: number }>();
    for (const r of recentTokens) {
      const key = dayKey(r.createdAt);
      const row = dayMap.get(key) ?? { date: key, calls: 0, total: 0, costCny: 0 };
      row.calls += 1;
      row.total += r.totalTokens;
      row.costCny += costCny(r.model, r.promptTokens, r.completionTokens, r.cachedTokens);
      dayMap.set(key, row);
    }
    const byDay = [...dayMap.values()]
      .map((r) => ({ ...r, costCny: money(r.costCny) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // --- signups: last 30 days by day ---
    const signupMap = new Map<string, number>();
    for (const u of recentUsers) {
      const key = dayKey(u.createdAt);
      signupMap.set(key, (signupMap.get(key) ?? 0) + 1);
    }
    const signups = [...signupMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      users: {
        total: usersTotal,
        invited: usersInvited,
        newToday: usersNewToday,
        new7d: usersNew7d,
        new30d: usersNew30d,
      },
      signups,
      content: { words, examples, readerTexts, sceneSessions, importJobs, collections },
      engagement: {
        reviewsTotal,
        reviewsToday,
        dau: dauRows.length,
        wau: wauRows.length,
      },
      invites: { minted: invitesMinted, redeemed: invitesRedeemed },
      tokens: {
        totals: {
          calls: tokTotals._count._all,
          prompt: tokTotals._sum.promptTokens ?? 0,
          completion: tokTotals._sum.completionTokens ?? 0,
          total: tokTotals._sum.totalTokens ?? 0,
          costCny: totalCost,
        },
        byModel,
        byFeature,
        byUser,
        byDay,
      },
    });
  } catch (err) {
    console.error("[admin] stats error", err);
    res.status(500).json({ error: "Couldn't load admin stats", code: "server_error" });
  }
});

// GET /api/admin/funnel -> the numbers the strategy is steered by: the activation
// funnel, rolling retention and use-step quality (BACKLOG F1). Events only exist
// from the day AnalyticsEvent shipped, so everything here is "since instrumentation",
// not since launch. Beta-scale volumes, so the rows are aggregated in JS rather
// than in five separate SQL round-trips; the take() cap keeps that honest as we grow.
const EVENT_CAP = 200_000;
const FUNNEL: { step: string; name: string }[] = [
  { step: "signin", name: "signin" },
  { step: "firstCard", name: "word_add" },
  { step: "firstReview", name: "review" },
  { step: "firstUseStep", name: "use_step" },
];

adminRouter.get("/admin/funnel", async (_req: Request, res: Response) => {
  try {
    const events = await prisma.analyticsEvent.findMany({
      where: { telegramId: { not: null } },
      select: { name: true, telegramId: true, createdAt: true, props: true },
      orderBy: { createdAt: "asc" },
      take: EVENT_CAP,
    });

    // Per learner: which steps they reached, and which days they were active.
    const reached = new Map<string, Set<string>>();
    const days = new Map<string, Set<string>>();
    for (const e of events) {
      const id = e.telegramId as string;
      let steps = reached.get(id);
      if (!steps) reached.set(id, (steps = new Set()));
      steps.add(e.name);
      let seen = days.get(id);
      if (!seen) days.set(id, (seen = new Set()));
      seen.add(dayKey(e.createdAt));
    }
    const cohort = reached.size;
    const funnel = FUNNEL.map(({ step, name }) => {
      const users = [...reached.values()].filter((s) => s.has(name)).length;
      return { step, users, pct: cohort ? Math.round((users / cohort) * 1000) / 10 : 0 };
    });

    // Rolling retention: of the learners whose first event was at least N days ago,
    // how many came back on day N or later. Rolling (not "active on exactly day N")
    // because at beta scale a same-day-only metric is noise.
    const today = Date.now();
    const retention = [1, 7, 30].map((n) => {
      let eligible = 0;
      let returned = 0;
      for (const set of days.values()) {
        const sorted = [...set].sort();
        const first = Date.parse(`${sorted[0]}T00:00:00Z`);
        if (today - first < n * DAY) continue; // too new to have had the chance
        eligible += 1;
        if (sorted.some((d) => Date.parse(`${d}T00:00:00Z`) - first >= n * DAY)) returned += 1;
      }
      return { day: n, eligible, returned, pct: eligible ? Math.round((returned / eligible) * 1000) / 10 : 0 };
    });

    // Use-step quality: how drill answers were graded, plus the split by surface.
    const useSteps = events.filter((e) => e.name === "use_step");
    const grades = new Map<string, number>();
    const kinds = new Map<string, number>();
    for (const e of useSteps) {
      const props = (e.props ?? {}) as { kind?: string; grade?: string };
      kinds.set(props.kind ?? "other", (kinds.get(props.kind ?? "other") ?? 0) + 1);
      if (props.grade) grades.set(props.grade, (grades.get(props.grade) ?? 0) + 1);
    }

    // Daily event volume, so a dead week is visible at a glance.
    const byDayMap = new Map<string, number>();
    for (const e of events) {
      const key = dayKey(e.createdAt);
      byDayMap.set(key, (byDayMap.get(key) ?? 0) + 1);
    }

    res.json({
      since: events.length ? events[0]!.createdAt : null,
      events: events.length,
      cohort,
      funnel,
      retention,
      useSteps: {
        total: useSteps.length,
        byKind: [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
        byGrade: [...grades].map(([grade, count]) => ({ grade, count })).sort((a, b) => b.count - a.count),
      },
      byDay: [...byDayMap].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (err) {
    console.error("[admin] funnel error", err);
    res.status(500).json({ error: "Couldn't load the funnel", code: "server_error" });
  }
});

// GET /api/admin/reports -> reported decks (grouped, most reports first) + delisted decks
adminRouter.get("/admin/reports", async (_req: Request, res: Response) => {
  try {
    res.json(await moderationQueue());
  } catch (err) {
    console.error("[admin] reports error", err);
    res.status(500).json({ error: "Couldn't load reports", code: "server_error" });
  }
});

// POST /api/admin/decks/:id/moderate { action: dismiss | delist | restore }
const moderateBody = z.object({ action: z.enum(["dismiss", "delist", "restore"]) });
adminRouter.post("/admin/decks/:id/moderate", async (req: Request, res: Response) => {
  const parsed = moderateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid action" });
    return;
  }
  try {
    res.json(await moderateDeck(String(req.params.id), parsed.data.action));
  } catch (err) {
    const code = (err as { code?: string }).code;
    res.status(code === "no_deck" ? 404 : 500).json({ error: (err as Error).message, code });
  }
});
