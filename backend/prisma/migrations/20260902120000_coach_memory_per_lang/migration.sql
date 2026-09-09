-- Coach memory becomes per source language: a learner practising Chinese must not
-- inherit the goal/notes they once set for English. The legacy columns are dropped
-- rather than migrated on purpose — they carry no language tag, so any guess about
-- which language they belong to would be wrong.

CREATE TABLE "CoachMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "interests" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoachMemory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CoachMemory_userId_lang_key" ON "CoachMemory"("userId", "lang");
CREATE INDEX "CoachMemory_userId_idx" ON "CoachMemory"("userId");
ALTER TABLE "CoachMemory" ADD CONSTRAINT "CoachMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" DROP COLUMN IF EXISTS "coachGoal";
ALTER TABLE "User" DROP COLUMN IF EXISTS "coachInterests";
ALTER TABLE "User" DROP COLUMN IF EXISTS "coachNotes";
