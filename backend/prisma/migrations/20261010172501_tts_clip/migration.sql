-- CreateTable
CREATE TABLE "TtsClip" (
    "key" TEXT NOT NULL,
    "mp3" BYTEA NOT NULL,
    "chars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TtsClip_pkey" PRIMARY KEY ("key")
);
