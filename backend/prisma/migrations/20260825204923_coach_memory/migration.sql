-- AlterTable
ALTER TABLE "User" ADD COLUMN     "coachGoal" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "coachInterests" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "coachNotes" TEXT NOT NULL DEFAULT '';
