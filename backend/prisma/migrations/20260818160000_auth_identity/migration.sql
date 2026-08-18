-- Linked sign-in methods (multi-provider accounts).
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthIdentity_provider_subject_key" ON "AuthIdentity"("provider", "subject");
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one identity per existing user, derived from how they signed up.
INSERT INTO "AuthIdentity" ("id", "userId", "provider", "subject", "createdAt")
SELECT
    gen_random_uuid()::text,
    "id",
    CASE
        WHEN "telegramId" LIKE 'email:%' THEN CASE WHEN "authVia" IN ('google','email') THEN "authVia" ELSE 'email' END
        WHEN "authVia" = 'dev' THEN 'dev'
        ELSE 'telegram'
    END,
    CASE WHEN "telegramId" LIKE 'email:%' THEN substring("telegramId" FROM 7) ELSE "telegramId" END,
    "createdAt"
FROM "User";
