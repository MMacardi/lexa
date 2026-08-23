-- Persistent free-tier usage counters (daily AI pool + monthly feature caps), so
-- quotas survive restarts and multiple instances.
CREATE TABLE "UsageCounter" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("key")
);
