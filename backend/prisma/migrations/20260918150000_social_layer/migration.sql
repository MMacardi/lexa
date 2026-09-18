-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "copiedFromId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "folderId" TEXT,
ADD COLUMN     "mikaPick" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "seedVersion" INTEGER,
ADD COLUMN     "shareCode" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'private';

-- AlterTable
ALTER TABLE "Word" ADD COLUMN     "sharedDeck" TEXT,
ADD COLUMN     "sharedDeckId" TEXT,
ADD COLUMN     "sharedFrom" TEXT;

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionAdd" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionAdd_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Folder_userId_idx" ON "Folder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_userId_name_key" ON "Folder"("userId", "name");

-- CreateIndex
CREATE INDEX "CollectionAdd_lastAt_idx" ON "CollectionAdd"("lastAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionAdd_collectionId_userId_key" ON "CollectionAdd"("collectionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_shareCode_key" ON "Collection"("shareCode");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");

-- CreateIndex
CREATE INDEX "Collection_visibility_idx" ON "Collection"("visibility");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAdd" ADD CONSTRAINT "CollectionAdd_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAdd" ADD CONSTRAINT "CollectionAdd_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

