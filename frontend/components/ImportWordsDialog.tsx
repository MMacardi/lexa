"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ImportedCard, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useClosing } from "@/lib/motion";
import { Check } from "lucide-react";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import {
  CEFR_LEVELS,
  EXAMPLE_STYLES,
  getExampleSource,
  LEVEL_HINT,
  setExampleStyle,
  setLevel,
  useExampleStyle,
  useLevel,
  getNativeLang,
  getStudyPair,
  type CefrLevel,
  type ExampleStyle,
} from "@/lib/learnPrefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/Select";
import { PairChip } from "@/components/PairChip";
import { CollectionMultiSelect } from "@/components/CollectionMultiSelect";
import { cn } from "@/lib/utils";
import { HoverPreview } from "@/components/HoverPreview";

type PreviewCard = ImportedCard & { selected: boolean };

// A little flip-card preview of what the FIRST typed line will become, so the
// learner sees the shape of a card while composing the list. Client-only, no AI.
function ImportCardPreview({ text }: { text: string }) {
  const { t } = useI18n();
  const line = text.split("\n").map((s) => s.trim()).find((s) => s && !s.startsWith("#")) ?? "";
  const parts = line.split(/\s*[—–:=|]\s*|\t| - /);
  const word = (parts[0] ?? "").trim();
  const meaning = parts.slice(1).join(", ").replace(/\s+/g, " ").trim();
  const [flipped, setFlipped] = useState(false);
  // A hand flip restarts the auto-flip interval, so a click right before a tick
  // doesn't stack two flips on the same animation.
  const [flipNonce, setFlipNonce] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFlipped((f) => !f), 2200);
    return () => clearInterval(id);
  }, [flipNonce]);
  const body = !word ? (
    <p className="py-3 text-center text-[13px] text-ink-soft">{t("import.previewTyping")}</p>
  ) : (
    <div
      className="flip-scene cursor-pointer"
      onClick={() => {
        setFlipped((f) => !f);
        setFlipNonce((n) => n + 1);
      }}
    >
      <div className={cn("flip-card", flipped && "is-flipped")}>
        <div className="flip-face flex min-h-[104px] items-center justify-center rounded-[14px] border border-black/[0.06] bg-paper p-4 text-center">
          <div className="font-serif text-[22px] font-semibold leading-tight text-ink">{word}</div>
        </div>
        <div className="flip-face flip-back flex min-h-[104px] items-center justify-center rounded-[14px] border border-sage/25 bg-sage-tint/25 p-4 text-center">
          <div className="text-[15px] font-medium leading-snug text-sage-deep">{meaning || t("import.previewAiMeaning")}</div>
        </div>
      </div>
    </div>
  );
  return (
    <HoverPreview label={t("preview.want")} title={t("preview.title")} width={230}>
      {body}
    </HoverPreview>
  );
}

export function ImportWordsDialog({
  defaultCollectionId,
  defaultSourceLang,
  defaultTargetLang,
  triggerLabel,
}: {
  defaultCollectionId?: string;
  // Onboarding opens this already pointed at the learner's pair (the textbook
  // path), so the pair is a prop rather than always the en → ru default.
  defaultSourceLang?: string;
  defaultTargetLang?: string;
  triggerLabel?: string;
}) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { trackImport, show } = useToast();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState("");
  const [extracting, setExtracting] = useState(false); // reading a PDF
  // An explicit pair (the HSK first run's textbook list) wins; otherwise the pair
  // every other surface shares, else Chinese explained in the native language.
  const [sourceLang, setSourceLang] = useState(() => defaultSourceLang ?? getStudyPair()?.sourceLang ?? "zh");
  const [targetLang, setTargetLang] = useState(() => defaultTargetLang ?? getStudyPair()?.targetLang ?? getNativeLang() ?? "ru");
  const [cards, setCards] = useState<PreviewCard[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [newCollectionName, setNewCollectionName] = useState("");
  // A bulk import starts as lean Anki-style cards. Extra content is opt-in.
  const [keepProvidedExtras, setKeepProvidedExtras] = useState(false);
  const [generateDetails, setGenerateDetails] = useState(false);
  const [generateExamples, setGenerateExamples] = useState(false);
  // example difficulty/register — shared with single-word add via localStorage
  const exampleStyle = useExampleStyle();
  const level = useLevel(sourceLang);

  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
    enabled: open,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setCollectionIds(defaultCollectionId && defaultCollectionId !== "all" ? [defaultCollectionId] : []);
      setNewCollectionName("");
    }
  }, [open, defaultCollectionId]);

  const preview = useMutation({
    mutationFn: () => api.previewImport({ text, sourceLang, targetLang }),
    onSuccess: ({ items }) => {
      setCards(items.map((item) => ({ ...item, selected: true })));
      // If the list carried synonyms/examples, keep them by default — otherwise
      // the parse would recognise them only to silently drop them on import.
      if (items.some((it) => it.example?.trim() || (it.synonyms?.length ?? 0) > 0)) {
        setKeepProvidedExtras(true);
      }
    },
  });

  const commit = useMutation({
    mutationFn: async () => {
      let ids = collectionIds;
      if (newCollectionName.trim()) {
        const created = await api.createCollection(newCollectionName.trim(), accountId);
        ids = [...ids, created.id];
      }
      return api.importWords({
        telegramId: accountId,
        sourceLang,
        targetLang,
        items: cards.filter((card) => card.selected).map((card) => ({
          word: card.word,
          meaning: card.meaning,
          example: card.example,
          exampleTranslation: card.exampleTranslation,
          synonyms: card.synonyms,
        })),
        collectionIds: ids,
        keepProvidedExtras: keepExtras,
        generateDetails,
        generateExamples,
        // only relevant when we actually search for examples
        exampleStyle: generateExamples ? exampleStyle : undefined,
        exampleSource: generateExamples ? getExampleSource() : undefined,
        level: generateExamples ? (level ?? undefined) : undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
  const jobId = commit.data?.job?.id;
  const { data: job } = useQuery({
    queryKey: ["import-job", jobId],
    queryFn: () => api.getImportJob(jobId!, accountId),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" || status === "cancelled" ? false : 1_500;
    },
  });

  const selected = cards.filter((card) => card.selected);
  // Did the pasted list actually carry examples/synonyms? Only then can "keep list
  // details" do anything — otherwise it's disabled. (We also never invent them.)
  const hasExtras = cards.some((card) => card.example?.trim() || (card.synonyms?.length ?? 0) > 0);
  const keepExtras = keepProvidedExtras && hasExtras;
  const { closing, close: animateOut } = useClosing(open, () => finishClose(), 200);
  const finishClose = () => {
    setOpen(false);
    setCards([]);
    setText("");
    setNewCollectionName("");
    preview.reset();
    commit.reset();
  };
  const close = () => {
    if (commit.isPending) return;
    animateOut();
  };
  const toggleAll = () => setCards((current) => current.map((card) => ({ ...card, selected: selected.length !== cards.length })));

  const readFile = async (file?: File) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) {
      setExtracting(true);
      try {
        const { extractPdfText } = await import("@/lib/pdfText");
        setText(await extractPdfText(file));
      } catch {
        setText("");
      } finally {
        setExtracting(false);
      }
      return;
    }
    if (name.endsWith(".txt")) {
      setText(await file.text());
      return;
    }
    // A photo (incl. a handwritten notebook page): OCR it with the vision model,
    // then let the normal parser turn the recognised text into cards.
    if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|bmp|gif)$/.test(name)) {
      setExtracting(true);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const { text: recognised } = await api.ocr({ image: dataUrl, sourceLang });
        if (recognised.trim()) setText((cur) => (cur.trim() ? cur + "\n" + recognised : recognised));
        else show({ icon: "⚠️", title: t("import.ocrEmpty") });
      } catch (e) {
        show({ icon: "⚠️", title: errText(e, t) });
      } finally {
        setExtracting(false);
      }
      return;
    }
    preview.reset();
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        ↑ {triggerLabel ?? t("import.open")}
      </Button>

      {open && mounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("import.title")}
            data-closing={closing || undefined}
            className="anim-scrim vv-overlay z-[200] flex items-end bg-black/55 p-0 backdrop-blur-[3px] sm:items-start sm:justify-center sm:p-5 sm:pt-[11vh]"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) close();
            }}
          >
            <section data-closing={closing || undefined} className="anim-dialog flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] border border-black/[0.12] bg-surface shadow-[0_34px_100px_rgba(21,18,15,0.4)] sm:max-h-[82vh] sm:rounded-[28px]">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-black/[0.07] bg-surface px-5 py-5 sm:px-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.13em] text-sage">Onomika tools</p>
                <h2 className="mt-1 font-serif text-[27px] font-semibold text-ink">{t("import.title")}</h2>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-soft">{t("import.subtitle")}</p>
              </div>
              <button type="button" onClick={close} className="rounded-full p-2 text-xl leading-none text-ink-faint hover:bg-black/[0.04] hover:text-ink" aria-label={t("common.cancel")}>
                ×
              </button>
            </header>

            {commit.isSuccess ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-14 text-center">
                <div className="anim-pop flex h-16 w-16 items-center justify-center rounded-full bg-sage-tint text-sage-deep"><Check className="h-8 w-8" /></div>
                <h3 className="mt-5 font-serif text-2xl font-semibold text-ink">
                  {t("import.done", {
                    created: commit.data.created,
                    skipped: commit.data.skipped ? t("import.skipped", { n: commit.data.skipped }) : "",
                  })}
                </h3>
                {commit.data.job && (
                  <p className={cn("mt-3 text-sm font-semibold", job?.status === "failed" ? "text-warn-text" : "text-sage-deep")}>
                    {job?.status === "completed"
                      ? t("import.backgroundDone")
                      : job?.status === "failed"
                        ? t("import.backgroundFailed")
                        : job?.status === "cancelled"
                          ? t("import.backgroundStopped", { done: job.processed, total: job.total })
                          : job?.status === "processing"
                            ? t("import.backgroundProgress", { done: job.processed, total: job.total })
                            : t("import.backgroundQueued")}
                  </p>
                )}
                {commit.data.job && job?.status !== "completed" && job?.status !== "failed" && job?.status !== "cancelled" && (
                  <button
                    type="button"
                    onClick={() => void api.cancelImportJob(commit.data.job!.id).then(() => qc.invalidateQueries({ queryKey: ["import-job", jobId] })).catch(() => {})}
                    title={t("import.stopHint")}
                    className="mt-3 rounded-full border border-black/[0.1] px-3.5 py-1.5 text-[13px] font-semibold text-ink-soft hover:bg-black/[0.04] hover:text-ink"
                  >
                    ■ {t("import.stop")}
                  </button>
                )}
                {job && (job.errors.length > 0 || job.errorMessage) && (
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-warn-text">
                    {t("import.backgroundFailed")}
                  </p>
                )}
                <Button
                  className="mt-7"
                  onClick={() => {
                    if (commit.data.job && job?.status !== "completed" && job?.status !== "failed" && job?.status !== "cancelled") {
                      trackImport({
                        jobId: commit.data.job.id,
                        telegramId: accountId,
                        words: selected.map((card) => card.word),
                        total: commit.data.job.total,
                        processed: commit.data.job.processed,
                      });
                    }
                    close();
                  }}
                >
                  {t("import.close")}
                </Button>
              </div>
            ) : cards.length === 0 ? (
              <form
                className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 py-5 sm:px-7"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (text.trim()) preview.mutate();
                }}
              >
                {/* The account's pair, stated; an "English → Russian / Russian → English"
                    switch used to open this dialog in an app about Chinese. */}
                <PairChip
                  source={sourceLang}
                  target={targetLang}
                  onSource={setSourceLang}
                  onTarget={setTargetLang}
                  onSwap={() => {
                    setSourceLang(targetLang);
                    setTargetLang(sourceLang);
                  }}
                  menuClassName="z-[140]"
                />
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={`hello — ${targetLang === "ru" ? "привет" : targetLang === "zh" ? "你好" : "meaning"}\ngoodbye — ${targetLang === "ru" ? "пока" : targetLang === "zh" ? "再见" : "meaning"}`}
                  className="min-h-56 w-full resize-y rounded-[18px] border border-black/[0.08] bg-surface p-4 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
                />
                <div className="rounded-[14px] border border-black/[0.06] bg-surface/70 px-3.5 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.11em] text-ink-faint">{t("import.fmtTitle")}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{t("import.fmtRich")}</p>
                  {/* Concrete sample of the rich format the parser understands: a
                      "word — meaning" line with indented Example/Translation/Synonyms
                      beneath it. The keywords stay English — that's literally what the
                      importer recognises and what the .txt export writes — so the block
                      is a faithful, copyable template; only the caption is localized. */}
                  <pre className="mt-2 overflow-x-auto rounded-[10px] border border-black/[0.06] bg-paper px-3 py-2.5 font-mono text-[12px] leading-[1.75]">
                    <div>
                      <span className="font-semibold text-ink">hello</span>
                      <span className="text-ink-faint"> — </span>
                      <span className="text-sage-deep">привет</span>
                    </div>
                    <div>
                      <span className="text-ink-faint">{"  "}</span>
                      <span className="font-semibold text-sage-deep">Example:</span>
                      <span className="text-ink-muted">{" Hello, how are you?"}</span>
                    </div>
                    <div>
                      <span className="text-ink-faint">{"  "}</span>
                      <span className="font-semibold text-sage-deep">Translation:</span>
                      <span className="text-ink-muted">{" Привет, как дела?"}</span>
                    </div>
                    <div>
                      <span className="text-ink-faint">{"  "}</span>
                      <span className="font-semibold text-sage-deep">Synonyms:</span>
                      <span className="text-ink-muted">{" hi, hey"}</span>
                    </div>
                  </pre>
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">{t("import.fmtFree")}</p>
                  <ImportCardPreview text={text} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-black/[0.06] bg-surface/70 p-3">
                  <input ref={inputRef} type="file" accept=".txt,.pdf,text/plain,application/pdf,image/*" className="hidden" onChange={(event) => readFile(event.target.files?.[0])} />
                  <Button type="button" variant="ghost" size="sm" disabled={extracting} onClick={() => inputRef.current?.click()}>
                    {extracting ? t("import.extracting") : `▣ ${t("import.file")}`}
                  </Button>
                  <Button type="submit" disabled={!text.trim() || preview.isPending}>
                    {preview.isPending ? t("import.parsing") : t("import.parse")}
                  </Button>
                </div>
                {preview.isError && <p className="text-sm font-medium text-warn-text">{(preview.error as Error).message}</p>}
              </form>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] px-5 py-3 sm:px-7">
                  <div>
                    <h3 className="font-serif text-xl font-semibold text-ink">{t("import.preview")}</h3>
                    <p className="text-sm text-ink-soft">{t("import.selected", { n: selected.length })}</p>
                  </div>
                  <button type="button" onClick={toggleAll} className="text-sm font-semibold text-sage hover:text-sage-deep">
                    {selected.length === cards.length ? t("import.clearAll") : t("import.selectAll")}
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7">
                  <div className="space-y-2">
                    {cards.map((card, index) => (
                      <label
                        key={`${card.word}-${index}`}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-[16px] border p-4 transition-colors",
                          card.selected ? "border-sage/40 bg-sage-tint/45" : "border-black/[0.08] bg-surface opacity-75",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={card.selected}
                          onChange={() => setCards((current) => current.map((item, i) => i === index ? { ...item, selected: !item.selected } : item))}
                          className="mt-1.5 h-5 w-5 shrink-0 accent-[#7c9885]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                            <strong className="font-serif text-[26px] font-semibold leading-tight text-ink">{card.word}</strong>
                            <span className={cn("text-[19px] font-semibold text-sage-deep", (targetLang === "zh" || targetLang === "zh-Hant") && "font-zh")}>{card.meaning || "—"}</span>
                          </span>
                          {(card.example || card.synonyms.length > 0) && (
                            <span
                              className={cn(
                                "mt-1.5 block rounded-md text-[14px] leading-relaxed transition-colors",
                                keepExtras ? "bg-sage-tint/60 px-2 py-1 font-medium text-sage-deep" : "text-ink-faint",
                              )}
                            >
                              {card.example ? `“${card.example}”` : ""}
                              {card.example && card.synonyms.length ? " · " : ""}
                              {card.synonyms.length ? `${card.synonyms.join(", ")}` : ""}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="mt-5 space-y-3.5 border-t border-black/[0.07] pt-4">
                    {/* what each card stores from the pasted list */}
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-faint">
                        {t("import.contentTitle")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Choice active={!keepExtras} onClick={() => setKeepProvidedExtras(false)} title={t("import.simple")} hint={t("import.simpleHint")} />
                        <Choice
                          active={keepExtras}
                          disabled={!hasExtras}
                          onClick={() => setKeepProvidedExtras(true)}
                          title={t("import.useDetails")}
                          hint={hasExtras ? t("import.keepExtras") : t("import.noExtras")}
                        />
                      </div>
                    </div>

                    {/* optional AI steps that run AFTER the cards are added */}
                    <div className="rounded-[14px] border border-black/[0.06] bg-paper/60 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-faint">
                        {t("import.enrichTitle")}
                      </p>
                      <p className="mt-0.5 mb-2.5 text-[12px] leading-snug text-ink-faint">{t("import.enrichHint")}</p>
                      <div className="space-y-2">
                        <Toggle checked={generateDetails} onChange={setGenerateDetails} label={t("import.details")} hint={t("import.detailsHint")} />
                        <Toggle checked={generateExamples} onChange={setGenerateExamples} label={t("import.examples")} hint={t("import.examplesHint")} />
                      </div>
                      {generateExamples && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-black/[0.06] pt-2.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("style.label")}</span>
                          <Select
                            value={exampleStyle}
                            onChange={(v) => setExampleStyle(v as ExampleStyle)}
                            ariaLabel={t("style.label")}
                            className="w-[150px]"
                            options={EXAMPLE_STYLES.map((s) => ({ value: s, label: t(`style.${s}`), hint: t(`style.hint.${s}`) }))}
                          />
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("level.pick")}</span>
                          <Select
                            value={level ?? ""}
                            onChange={(v) => setLevel(sourceLang, v as CefrLevel)}
                            ariaLabel={t("level.title")}
                            placeholder={t("level.pick")}
                            className="w-[136px]"
                            options={CEFR_LEVELS.map((l) => ({ value: l, label: l, hint: LEVEL_HINT[l] }))}
                          />
                        </div>
                      )}
                    </div>

                    {collections && collections.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("import.set")}</span>
                        <CollectionMultiSelect options={collections} value={collectionIds} onChange={setCollectionIds} menuClassName="z-[240]" />
                        <Input
                          value={newCollectionName}
                          onChange={(event) => setNewCollectionName(event.target.value)}
                          placeholder={t("import.newSet")}
                          className="h-9 max-w-[220px] rounded-[12px] px-3 text-sm"
                        />
                      </div>
                    )}
                    {collections?.length === 0 && (
                      <Input
                        value={newCollectionName}
                        onChange={(event) => setNewCollectionName(event.target.value)}
                        placeholder={t("import.newSet")}
                        className="h-9 max-w-[250px] rounded-[12px] px-3 text-sm"
                      />
                    )}
                  </div>
                  {commit.isError && <p className="mt-3 text-sm font-medium text-warn-text">{(commit.error as Error).message}</p>}
                </div>

                <footer className="shrink-0 border-t border-black/[0.07] bg-surface px-5 py-3 sm:px-7">
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setCards([])} className="text-sm font-semibold text-ink-soft hover:text-ink">{t("import.back")}</button>
                    <Button type="button" disabled={selected.length === 0 || commit.isPending} onClick={() => commit.mutate()}>
                      {commit.isPending ? t("import.adding") : t("import.add", { n: selected.length })}
                    </Button>
                  </div>
                </footer>
              </div>
            )}
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#7c9885]"
      />
      <span className="flex flex-col">
        <span className="font-medium text-ink-muted">{label}</span>
        {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
      </span>
    </label>
  );
}

function Choice({ active, onClick, title, hint, disabled }: { active: boolean; onClick: () => void; title: string; hint: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-[13px] border px-3 py-2 text-left transition-colors",
        disabled
          ? "cursor-not-allowed border-black/[0.06] bg-paper text-ink-faint opacity-60"
          : active
            ? "border-sage bg-sage-tint text-sage-deep"
            : "border-black/[0.08] bg-paper text-ink-muted hover:bg-black/[0.02]",
      )}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-0.5 block text-[11px] font-medium opacity-70">{hint}</span>
    </button>
  );
}

/** Download a portable, human-readable .txt list without touching the server. */
export function exportWords(words: Word[]) {
  const text = [
    "# Onomika vocabulary export",
    `# ${new Date().toLocaleDateString()}`,
    "",
    ...words.flatMap((word) => {
      const lines = [`${word.word} — ${word.meaningZh ?? ""}`];
      if (word.examples[0]?.sentenceEn) lines.push(`  Example: ${word.examples[0].sentenceEn}`);
      // The translation line keeps the file lossless when a friend re-imports it.
      if (word.examples[0]?.sentenceZh) lines.push(`  Translation: ${word.examples[0].sentenceZh}`);
      if (word.synonyms.length) lines.push(`  Synonyms: ${word.synonyms.join(", ")}`);
      return lines;
    }),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `onomika-words-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}
