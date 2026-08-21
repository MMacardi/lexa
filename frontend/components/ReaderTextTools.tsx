"use client";

import { useEffect, useState } from "react";
import { api, type ReaderTextSummary } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { getLevel } from "@/lib/learnPrefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Reader companion: save the current text, browse/search saved ones, or have the
// AI write a fresh reading text on a topic.
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
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<null | "library" | "generate">(null);

  async function save() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const title = window.prompt(t("reader.titlePrompt"), body.slice(0, 40)) ?? body.slice(0, 40);
      await api.saveReaderText({ telegramId: accountId, title, content: body, sourceLang, targetLang });
      show({ icon: "💾", title: t("reader.saved") });
    } catch (e) {
      show({ icon: "⚠️", title: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" type="button" disabled={!text.trim() || busy} onClick={save}>
        💾 {t("reader.save")}
      </Button>
      <Button variant="outline" type="button" onClick={() => setPanel("library")}>
        📚 {t("reader.myTexts")}
      </Button>
      <Button variant="outline" type="button" onClick={() => setPanel("generate")}>
        ✨ {t("reader.generate")}
      </Button>

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

function LibraryModal({ onClose, onOpen }: { onClose: () => void; onOpen: (content: string) => void }) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ReaderTextSummary[] | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    const id = setTimeout(() => {
      api.readerTexts(accountId, q.trim() || undefined).then((r) => !cancel && setItems(r)).catch(() => !cancel && setItems([]));
    }, 200);
    return () => {
      cancel = true;
      clearTimeout(id);
    };
  }, [q, accountId]);

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
                <div className="truncate text-[14px] font-semibold text-ink">
                  {it.status === "generating" ? "⏳ " : it.status === "failed" ? "⚠️ " : ""}
                  {it.title}
                </div>
                <div className="truncate text-[12px] text-ink-soft">
                  {it.status === "generating" ? t("reader.generating") : it.status === "failed" ? "—" : it.snippet}
                </div>
              </button>
              <button
                type="button"
                onClick={() => remove(it.id)}
                aria-label="Delete"
                className="shrink-0 rounded-md px-1.5 py-0.5 text-ink-faint opacity-0 transition-opacity hover:text-warn-text group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
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
  const [busy, setBusy] = useState(false);

  async function go() {
    const tp = topic.trim();
    if (!tp || busy) return;
    setBusy(true);
    try {
      const r = await api.generateReaderText({
        telegramId: accountId,
        topic: tp,
        sourceLang,
        targetLang,
        level: getLevel(sourceLang) ?? undefined,
      });
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
        <h3 className="mb-3 font-serif text-[18px] font-semibold text-ink">✨ {t("reader.generate")}</h3>
        <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("reader.genTopic")} autoFocus className="h-11" />
        <Button type="submit" disabled={busy || !topic.trim()} className="mt-3 w-full">
          {busy ? t("reader.generating") : t("reader.genCreate")}
        </Button>
      </form>
    </Overlay>
  );
}
