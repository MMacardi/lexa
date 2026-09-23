-- AlterTable
ALTER TABLE "ReviewEvent" ADD COLUMN     "grade" INTEGER,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'review',
ADD COLUMN     "wordId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyGoal" INTEGER,
ADD COLUMN     "levels" JSONB,
ADD COLUMN     "nativeLang" TEXT,
ADD COLUMN     "retention" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PlacementAnswer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "sourceLang" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "level" TEXT,
    "known" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlacementAnswer_userId_createdAt_idx" ON "PlacementAnswer"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementAnswer_userId_word_sourceLang_key" ON "PlacementAnswer"("userId", "word", "sourceLang");

-- CreateIndex
CREATE INDEX "ReviewEvent_wordId_createdAt_idx" ON "ReviewEvent"("wordId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewEvent_userId_source_createdAt_idx" ON "ReviewEvent"("userId", "source", "createdAt");

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementAnswer" ADD CONSTRAINT "PlacementAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
