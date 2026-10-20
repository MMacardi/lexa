-- Existing cards stay terminal; no examples, schedules, or learner data change.
ALTER TABLE "Word" ADD COLUMN "enrichmentStatus" TEXT NOT NULL DEFAULT 'ready',
                   ADD COLUMN "exampleStatus" TEXT NOT NULL DEFAULT 'disabled';
