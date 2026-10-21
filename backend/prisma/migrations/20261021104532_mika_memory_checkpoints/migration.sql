-- AlterTable
ALTER TABLE "CoachMemory" ADD COLUMN     "pinnedNotes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CoachMemoryUpdate" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "transcript" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachMemoryUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachMemoryUpdate_state_availableAt_idx" ON "CoachMemoryUpdate"("state", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoachMemoryUpdate_memoryId_fingerprint_key" ON "CoachMemoryUpdate"("memoryId", "fingerprint");

-- AddForeignKey
ALTER TABLE "CoachMemoryUpdate" ADD CONSTRAINT "CoachMemoryUpdate_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "CoachMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
