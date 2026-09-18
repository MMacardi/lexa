-- AlterTable
ALTER TABLE "TokenUsage" ADD COLUMN     "telegramId" TEXT;

-- CreateIndex
CREATE INDEX "TokenUsage_telegramId_idx" ON "TokenUsage"("telegramId");
