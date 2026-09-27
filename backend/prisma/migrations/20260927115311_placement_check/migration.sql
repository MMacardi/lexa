-- AlterTable
ALTER TABLE "PlacementAnswer" ADD COLUMN     "fake" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "took" BOOLEAN NOT NULL DEFAULT false;
