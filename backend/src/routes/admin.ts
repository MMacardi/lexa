import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "../services/db.js";
import { requireAdmin } from "../lib/gate.js";
import { costCny } from "../lib/pricing.js";

// Owner-only operations dashboard: one aggregated snapshot of how the beta is
// being used (users, content, engagement, invites) and exactly what the AI is
// costing (real tokens + ¥ by model / feature / day). Guarded by requireAdmin,
// which is itself behind the global identity + invite gate in index.ts.
export const adminRouter = Router();
adminRouter.use(requireAdmin);

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
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
        _count: { _all: true },
      }),
      prisma.tokenUsage.groupBy({
        by: ["model"],
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
        _count: { _all: true },
      }),
      // feature × model so per-feature cost stays exact (a feature may span models).
      prisma.tokenUsage.groupBy({
        by: ["feature", "model"],
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
        _count: { _all: true },
      }),
      prisma.user.findMany({ where: { createdAt: { gte: since30d } }, select: { createdAt: true } }),
      prisma.tokenUsage.findMany({
        where: { createdAt: { gte: since30d } },
        select: { createdAt: true, model: true, promptTokens: true, completionTokens: true, totalTokens: true },
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
          costCny: money(costCny(r.model, prompt, completion)),
        };
      })
      .sort((a, b) => b.costCny - a.costCny);

    const totalCost = money(byModel.reduce((s, m) => s + m.costCny, 0));

    // --- tokens: all-time by feature (fold the model split back into exact cost) ---
    const featureMap = new Map<string, { feature: string; calls: number; total: number; costCny: number }>();
    for (const r of tokByFeatureModel) {
      const prompt = r._sum.promptTokens ?? 0;
      const completion = r._sum.completionTokens ?? 0;
      const cost = costCny(r.model, prompt, completion);
      const row = featureMap.get(r.feature) ?? { feature: r.feature, calls: 0, total: 0, costCny: 0 };
      row.calls += r._count._all;
      row.total += r._sum.totalTokens ?? 0;
      row.costCny += cost;
      featureMap.set(r.feature, row);
    }
    const byFeature = [...featureMap.values()]
      .map((r) => ({ ...r, costCny: money(r.costCny) }))
      .sort((a, b) => b.costCny - a.costCny);

    // --- tokens: last 30 days by day (per-row cost → accurate mixed-model days) ---
    const dayMap = new Map<string, { date: string; calls: number; total: number; costCny: number }>();
    for (const r of recentTokens) {
      const key = dayKey(r.createdAt);
      const row = dayMap.get(key) ?? { date: key, calls: 0, total: 0, costCny: 0 };
      row.calls += 1;
      row.total += r.totalTokens;
      row.costCny += costCny(r.model, r.promptTokens, r.completionTokens);
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
        byDay,
      },
    });
  } catch (err) {
    console.error("[admin] stats error", err);
    res.status(500).json({ error: "Couldn't load admin stats", code: "server_error" });
  }
});
