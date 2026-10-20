-- Preserve existing levels and content. Their origin cannot be inferred safely.
ALTER TABLE "ReaderText" ADD COLUMN "levelSource" TEXT;
