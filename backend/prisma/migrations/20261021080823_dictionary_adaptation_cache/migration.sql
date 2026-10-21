-- CreateTable
CREATE TABLE "DictionaryAdaptation" (
    "key" TEXT NOT NULL,
    "entry" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DictionaryAdaptation_pkey" PRIMARY KEY ("key")
);
