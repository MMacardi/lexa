-- Billing plan on the user: free (daily AI cap) or pro (uncapped).
ALTER TABLE "User" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "User" ADD COLUMN "planUntil" TIMESTAMP(3);
