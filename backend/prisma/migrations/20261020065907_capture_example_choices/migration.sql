-- AlterTable
ALTER TABLE "Example" ADD COLUMN     "captured" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Word" ADD COLUMN     "autoExamples" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "exampleRevision" INTEGER NOT NULL DEFAULT 0;
