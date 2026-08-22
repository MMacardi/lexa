-- Record how an AI example was generated so the word page can show its register
-- (example style) and CEFR level next to the "Lexa AI" attribution.
ALTER TABLE "Example" ADD COLUMN "register" TEXT;
ALTER TABLE "Example" ADD COLUMN "level" TEXT;
