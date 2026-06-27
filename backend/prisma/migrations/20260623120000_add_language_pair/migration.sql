-- Add per-word language pair (source -> target). Existing rows default to en->zh.
ALTER TABLE "Word" ADD COLUMN "sourceLang" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Word" ADD COLUMN "targetLang" TEXT NOT NULL DEFAULT 'zh';
