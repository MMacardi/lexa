-- Save a reading text's translation, the words the reader engaged with, and an
-- estimated CEFR level alongside it.
ALTER TABLE "ReaderText" ADD COLUMN "translation" TEXT;
ALTER TABLE "ReaderText" ADD COLUMN "clickedWords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ReaderText" ADD COLUMN "level" TEXT;
