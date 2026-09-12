-- Closed-beta invite gate. A user must redeem an invite code before the data/AI
-- routes open up, so an uninvited visitor can't drain tokens. Grandfather everyone
-- already in the database (the owner + existing testers) so nobody gets locked out.
ALTER TABLE "User" ADD COLUMN "invited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "invitedAt" TIMESTAMP(3);
UPDATE "User" SET "invited" = true, "invitedAt" = now();

-- Single-use invite codes. redeemedById is ON DELETE SET NULL so removing a user
-- keeps the code's audit trail (it stays consumed).
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "redeemedById" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");
CREATE INDEX "InviteCode_redeemedById_idx" ON "InviteCode"("redeemedById");
ALTER TABLE "InviteCode" ADD CONSTRAINT "InviteCode_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
