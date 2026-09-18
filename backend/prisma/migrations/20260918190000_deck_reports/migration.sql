-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "delistedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeckReport" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DeckReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeckReport_status_idx" ON "DeckReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DeckReport_collectionId_reporterId_key" ON "DeckReport"("collectionId", "reporterId");

-- AddForeignKey
ALTER TABLE "DeckReport" ADD CONSTRAINT "DeckReport_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeckReport" ADD CONSTRAINT "DeckReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
