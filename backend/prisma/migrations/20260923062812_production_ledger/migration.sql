-- AlterTable
ALTER TABLE "Word" ADD COLUMN     "canUseAt" TIMESTAMP(3),
ADD COLUMN     "lastProducedAt" TIMESTAMP(3),
ADD COLUMN     "produceAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "produceCorrect" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "produceStreak" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProductionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wordId" TEXT,
    "verdict" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'drill',
    "errorKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionEvent_userId_createdAt_idx" ON "ProductionEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionEvent_wordId_createdAt_idx" ON "ProductionEvent"("wordId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductionEvent" ADD CONSTRAINT "ProductionEvent_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE SET NULL ON UPDATE CASCADE;
