-- Per-call LLM token log, so the owner dashboard can show real tokens + ¥ cost by
-- day/feature/model. Append-only; id is BIGSERIAL and never serialized to the client
-- (a BigInt isn't JSON-safe), only aggregated.
CREATE TABLE "TokenUsage" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "ms" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TokenUsage_createdAt_idx" ON "TokenUsage"("createdAt");
CREATE INDEX "TokenUsage_model_idx" ON "TokenUsage"("model");
CREATE INDEX "TokenUsage_feature_idx" ON "TokenUsage"("feature");
