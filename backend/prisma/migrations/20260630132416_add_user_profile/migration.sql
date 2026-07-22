-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authVia" TEXT NOT NULL DEFAULT 'dev',
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "username" TEXT;
