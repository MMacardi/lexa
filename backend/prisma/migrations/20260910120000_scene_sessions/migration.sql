CREATE TABLE "SceneSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sceneKey" TEXT,
    "sourceLang" TEXT,
    "targetLang" TEXT,
    "bible" JSONB NOT NULL,
    "turns" JSONB NOT NULL DEFAULT '[]',
    "corrections" JSONB NOT NULL DEFAULT '[]',
    "used" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "addedWords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "reviewedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SceneSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SceneSession_userId_updatedAt_idx" ON "SceneSession"("userId", "updatedAt");
ALTER TABLE "SceneSession" ADD CONSTRAINT "SceneSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
