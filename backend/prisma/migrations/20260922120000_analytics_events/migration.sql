-- Product analytics: one append-only row per meaningful learner action, so the
-- activation funnel, retention and use-step completion are measurable (BACKLOG F1).
-- Written server-side, fire-and-forget; like TokenUsage, id is BIGSERIAL and never
-- serialized to the client, only aggregated.
CREATE TABLE "AnalyticsEvent" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "telegramId" TEXT,
    "surface" TEXT NOT NULL DEFAULT 'web',
    "props" JSONB,
    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");
CREATE INDEX "AnalyticsEvent_name_createdAt_idx" ON "AnalyticsEvent"("name", "createdAt");
CREATE INDEX "AnalyticsEvent_telegramId_createdAt_idx" ON "AnalyticsEvent"("telegramId", "createdAt");
