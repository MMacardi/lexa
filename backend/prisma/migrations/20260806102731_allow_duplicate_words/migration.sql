-- DropIndex
DROP INDEX "Word_userId_word_key";

-- CreateIndex
CREATE INDEX "Word_userId_idx" ON "Word"("userId");
