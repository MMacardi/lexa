"use client";

import { useEffect, useState } from "react";
import { api, type ReaderTextSummary } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { getLevel, CEFR_LEVELS, LEVEL_HINT, type CefrLevel } from "@/lib/learnPrefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Library, Sparkles, Clock, TriangleAlert, X } from "lucide-react";
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

// Reader companion: save the current text, browse/search saved ones, or have the
// AI write a fresh reading text on a topic. Rendered as a compact chip cluster.
export function ReaderTextTools({
  text,
  sourceLang,
  targetLang,
  onLoad,
  onStartGen,
}: {
  text: string;
  sourceLang: string;
  targetLang: string;
  onLoad: (content: string) => void;
  onStartGen: (id: string) => void;
}) {
  const { t } = useI18n();
  const [panel, setPanel] = useState<null | "save" | "library" | "generate">(null);

  return (
    <>
      <Chip disabled={!text.trim()} onClick={() => setPanel("save")}>
        <Save className="h-3.5 w-3.5" /> {t("reader.save")}
      </Chip>
      <Chip onClick={() => setPanel("library")}>
        <Library className="h-3.5 w-3.5" /> {t("reader.myTexts")}
      </Chip>
      <Chip onClick={() => setPanel("generate")}>
        <Sparkles className="h-3.5 w-3.5" /> {t("reader.generate")}
      </Chip>

      {panel === "save" && (
        <SaveModal text={text} sourceLang={sourceLang} targetLang={targetLang} onClose={() => setPanel(null)} onSaved={() => setPanel(null)} />
      )}
      {panel === "library" && (
        <LibraryModal
          onClose={() => setPanel(null)}
          onOpen={(content) => {
            onLoad(content);
            setPanel(null);
          }}
        />
      )}
      {panel === "generate" && (
        <GenerateModal
          sourceLang={sourceLang}
          targetLang={targetLang}
          onClose={() => setPanel(null)}
          onStarted={(id) => {
            onStartGen(id);
            setPanel(null);
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
  sourceLang,
  targetLang,
  onClose,
  onSaved,
}: {
  text: string;
  sourceLang: string;
  targetLang: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const [title, setTitle] = useState(text.trim().slice(0, 50));
  const [aiName, setAiName] = useState(false);
  const [collection, setCollection] = useState("");
  const [known, setKnown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.readerCollections(accountId).then(setKnown).catch(() => {});
  }, [accountId]);

  async function save() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await api.saveReaderText({
        telegramId: accountId,
        title: aiName ? "" : title.trim(),
        content: body,
        collection: collection.trim() || undefined,
        autoName: aiName,
        sourceLang,
        targetLang,
      });
      show({ icon: "💾", title: t("reader.saved") });
      onSaved();
    } catch (e) {
      show({ icon: "⚠️", title: (e as Error).message });
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
          <Save className="h-[18px] w-[18px] text-sage-deep" /> {t("reader.saveTitle")}
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

        <Button type="submit" disabled={busy || !text.trim() || (!aiName && !title.trim())} className="mt-4 w-full">
          {busy ? "…" : t("reader.save")}
        </Button>
      </form>
    </Overlay>
  );
}

function LibraryModal({ onClose, onOpen }: { onClose: () => void; onOpen: (content: string) => void }) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [collection, setCollection] = useState<string | null>(null); // null = all
  const [collections, setCollections] = useState<string[]>([]);
  const [items, setItems] = useState<ReaderTextSummary[] | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    api.readerCollections(accountId).then(setCollections).catch(() => {});
  }, [accountId]);

  useEffect(() => {
    let cancel = false;
    const id = setTimeout(() => {
      api
        .readerTexts(accountId, q.trim() || undefined, collection ?? undefined)
        .then((r) => !cancel && setItems(r))
        .catch(() => !cancel && setItems([]));
    }, 200);
    return () => {
      cancel = true;
      clearTimeout(id);
    };
  }, [q, collection, accountId]);

  async function open(id: string) {
    setLoadingId(id);
    try {
      const full = await api.readerText(id, accountId);
      onOpen(full.content);
    } finally {
      setLoadingId(null);
    }
  }

  async function remove(id: string) {
    await api.deleteReaderText(id, accountId).catch(() => {});
    setItems((list) => (list ?? []).filter((x) => x.id !== id));
  }

  return (
    <Overlay onClose={onClose}>
      <div className="border-b border-black/[0.06] p-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("reader.searchTexts")} autoFocus className="h-10" />
        {collections.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <FilterChip active={collection === null} onClick={() => setCollection(null)}>
              {t("reader.allTexts")}
            </FilterChip>
            {collections.map((c) => (
              <FilterChip key={c} active={collection === c} onClick={() => setCollection(c)}>
                {c}
              </FilterChip>
            ))}
          </div>
        )}
      </div>
      <div className="max-h-[56vh] overflow-y-auto p-2">
        {items === null ? (
          <p className="p-4 text-center text-sm text-ink-faint">…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-faint">{t("reader.noTexts")}</p>
        ) : (
          items.map((it) => (
            <div key={it.id} className="group flex items-start gap-2 rounded-[12px] p-2 hover:bg-black/[0.03]">
              <button
                type="button"
                onClick={() => it.status === "ready" && open(it.id)}
                disabled={loadingId === it.id || it.status !== "ready"}
                className="min-w-0 flex-1 text-left disabled:cursor-default"
              >
                <div className="flex items-center gap-1.5">
                  {it.status === "generating" && <Clock className="h-3.5 w-3.5 shrink-0 text-ink-faint" />}
                  {it.status === "failed" && <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warn-text" />}
                  <span className="truncate text-[14px] font-semibold text-ink">{it.title}</span>
                  {it.collection && (
                    <span className="shrink-0 rounded-full bg-sage-tint px-1.5 py-0.5 text-[10px] font-semibold text-sage-deep">{it.collection}</span>
                  )}
                </div>
                <div className="truncate text-[12px] text-ink-soft">
                  {it.status === "generating" ? t("reader.generating") : it.status === "failed" ? "—" : it.snippet}
                </div>
              </button>
              <button
                type="button"
                onClick={() => remove(it.id)}
                aria-label="Delete"
                className="shrink-0 rounded-md p-1 text-ink-faint opacity-0 transition-opacity hover:text-warn-text group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </Overlay>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors " +
        (active ? "border-sage bg-sage/15 text-ink" : "border-black/[0.08] text-ink-muted hover:bg-black/[0.03]")
      }
    >
      {children}
    </button>
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
      show({ icon: "⚠️", title: (e as Error).message });
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
