"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { useToast } from "@/lib/toast";
import { getLevel, getShowTextLevel, CEFR_LEVELS, LEVEL_HINT, type CefrLevel } from "@/lib/learnPrefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Sparkles } from "lucide-react";
import { CollectionCombo } from "@/components/CollectionCombo";

// Small pill button — the compact toolbar style shared with the reading view.
function Chip({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-black/[0.03] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

// Reader companion on the input page: just the "AI text" generator. Saving lives
// in the reading view (SaveModal), and browsing is the inline SavedTexts list.
export function ReaderTextTools({
  sourceLang,
  targetLang,
  onStartGen,
}: {
  sourceLang: string;
  targetLang: string;
  onStartGen: (id: string) => void;
}) {
  const { t } = useI18n();
  const [gen, setGen] = useState(false);

  return (
    <>
      <Chip onClick={() => setGen(true)}>
        <Sparkles className="h-3.5 w-3.5" /> {t("reader.generate")}
      </Chip>
      {gen && (
        <GenerateModal
          sourceLang={sourceLang}
          targetLang={targetLang}
          onClose={() => setGen(false)}
          onStarted={(id) => {
            onStartGen(id);
            setGen(false);
          }}
        />
      )}
    </>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="anim-pop max-h-[80vh] w-full max-w-[440px] overflow-hidden rounded-[20px] border border-black/[0.08] bg-surface shadow-[0_24px_60px_rgba(46,42,38,0.34)]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// Save the current reader text: choose a title (or let AI name it) and, optionally,
// drop it into a named collection ("read later"). Reused from input & reading views.
export function SaveModal({
  text,
  translation,
  clickedWords,
  sourceLang,
  targetLang,
  editId,
  initialTitle,
  initialCollection,
  initialLevel,
  onClose,
  onSaved,
}: {
  text: string;
  translation?: string;
  clickedWords?: string[];
  sourceLang: string;
  targetLang: string;
  // When set, saving UPDATES this existing text instead of creating a new one.
  editId?: string;
  initialTitle?: string;
  initialCollection?: string;
  initialLevel?: string | null;
  onClose: () => void;
  onSaved: (saved?: { id: string; title: string; level?: string | null; collection: string | null }) => void;
}) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState((initialTitle ?? text).trim().slice(0, 50));
  const [aiName, setAiName] = useState(false);
  const [collection, setCollection] = useState(initialCollection ?? "");
  const [known, setKnown] = useState<string[]>([]);
  const [level, setLevel] = useState<CefrLevel | "">((initialLevel as CefrLevel) || getLevel(sourceLang) || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.readerCollections(accountId).then(setKnown).catch(() => {});
  }, [accountId]);

  async function save() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const collVal = collection.trim() || null;
      const saved = editId
        ? await api.updateReaderText(editId, {
            telegramId: accountId,
            title: aiName ? undefined : title.trim(),
            content: body,
            collection: collVal,
            level: level || null,
            translation: translation?.trim() || null,
            clickedWords: clickedWords && clickedWords.length ? clickedWords : undefined,
          })
        : await api.saveReaderText({
            telegramId: accountId,
            title: aiName ? "" : title.trim(),
            content: body,
            collection: collVal || undefined,
            autoName: aiName,
            translation: translation?.trim() || undefined,
            clickedWords: clickedWords && clickedWords.length ? clickedWords : undefined,
            // A level the user picked here is used directly (no AI). Only fall back to
            // an AI estimate when they left it blank and the badge setting is on.
            level: level || undefined,
            estimateLevel: !level && getShowTextLevel(),
            sourceLang,
            targetLang,
          });
      qc.invalidateQueries({ queryKey: ["reader-texts"] });
      show({ icon: "💾", title: t(editId ? "reader.updated" : "reader.saved") });
      onSaved({ id: saved.id, title: saved.title, level: saved.level ?? (level || null), collection: collVal });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h3 className="mb-3 flex items-center gap-2 font-serif text-[18px] font-semibold text-ink">
          <Save className="h-[18px] w-[18px] text-sage-deep" /> {t(editId ? "reader.editTitle" : "reader.saveTitle")}
        </h3>

        <label className="mb-1 block text-[12px] font-medium text-ink-soft">{t("reader.titleLabel")}</label>
        <Input
          value={aiName ? "" : title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={aiName ? t("reader.aiName") : t("reader.titlePh")}
          disabled={aiName}
          autoFocus
          className="h-11"
        />
        <label className="mt-2 flex cursor-pointer select-none items-center gap-2 text-[13px] text-ink-soft">
          <input type="checkbox" checked={aiName} onChange={(e) => setAiName(e.target.checked)} className="h-4 w-4 accent-sage" />
          {t("reader.aiName")}
        </label>

        <label className="mb-1 mt-4 block text-[12px] font-medium text-ink-soft">{t("reader.collectionLabel")}</label>
        <CollectionCombo value={collection} onChange={setCollection} options={known} placeholder={t("reader.collectionPh")} />

        <label className="mb-1.5 mt-4 block text-[12px] font-medium text-ink-soft">{t("reader.levelLabel")}</label>
        <div className="flex gap-1">
          {CEFR_LEVELS.map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => setLevel((cur) => (cur === lv ? "" : lv))}
              title={LEVEL_HINT[lv]}
              className={
                "flex-1 rounded-[10px] border px-0 py-1.5 text-[13px] font-semibold transition-colors " +
                (level === lv ? "border-sage bg-sage/15 text-ink" : "border-black/[0.08] text-ink-soft hover:bg-black/[0.03]")
              }
            >
              {lv}
            </button>
          ))}
        </div>

        <Button type="submit" disabled={busy || !text.trim() || (!aiName && !title.trim())} className="mt-4 w-full">
          {busy ? "…" : t(editId ? "reader.update" : "reader.save")}
        </Button>
      </form>
    </Overlay>
  );
}

function GenerateModal({
  sourceLang,
  targetLang,
  onClose,
  onStarted,
}: {
  sourceLang: string;
  targetLang: string;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<CefrLevel>(getLevel(sourceLang) ?? "B1");
  const [busy, setBusy] = useState(false);

  async function go() {
    const tp = topic.trim();
    if (!tp || busy) return;
    setBusy(true);
    try {
      const r = await api.generateReaderText({ telegramId: accountId, topic: tp, sourceLang, targetLang, level });
      onStarted(r.id);
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <h3 className="mb-3 flex items-center gap-2 font-serif text-[18px] font-semibold text-ink">
          <Sparkles className="h-[18px] w-[18px] text-sage-deep" /> {t("reader.generate")}
        </h3>
        <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("reader.genTopic")} autoFocus className="h-11" />
        <div className="mt-3">
          <div className="mb-1.5 text-[12px] font-medium text-ink-soft">{t("reader.genLevel")}</div>
          <div className="flex gap-1">
            {CEFR_LEVELS.map((lv) => (
              <button
                key={lv}
                type="button"
                onClick={() => setLevel(lv)}
                title={LEVEL_HINT[lv]}
                className={
                  "flex-1 rounded-[10px] border px-0 py-1.5 text-[13px] font-semibold transition-colors " +
                  (level === lv
                    ? "border-sage bg-sage/15 text-ink"
                    : "border-black/[0.08] text-ink-soft hover:bg-black/[0.03]")
                }
              >
                {lv}
              </button>
            ))}
          </div>
        </div>
        <Button type="submit" disabled={busy || !topic.trim()} className="mt-4 w-full">
          {busy ? t("reader.generating") : t("reader.genCreate")}
        </Button>
      </form>
    </Overlay>
  );
}
