-- CreateTable
CREATE TABLE "TutorChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "photo" BOOLEAN NOT NULL DEFAULT false,
    "count" INTEGER NOT NULL DEFAULT 0,
    "hay" TEXT NOT NULL DEFAULT '',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TutorChat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TutorChat_userId_updatedAt_idx" ON "TutorChat"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TutorChat_userId_chatId_key" ON "TutorChat"("userId", "chatId");

-- AddForeignKey
ALTER TABLE "TutorChat" ADD CONSTRAINT "TutorChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
