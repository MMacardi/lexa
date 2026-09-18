-- AlterTable
ALTER TABLE "User" ADD COLUMN     "decksVisibility" TEXT NOT NULL DEFAULT 'friends',
ADD COLUMN     "profileVisibility" TEXT NOT NULL DEFAULT 'friends';

