-- Cache the AI "explain / when to use" text on the card, so re-opening a word
-- doesn't re-spend tokens. Cleared when meaningful fields change.
ALTER TABLE "Word" ADD COLUMN "explainCache" TEXT;
