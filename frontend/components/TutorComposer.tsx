"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { TutorChat } from "@/lib/useTutorChat";
import { MAX_ATTACH } from "@/lib/useTutorChat";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { useMicInput } from "@/lib/useMicInput";
import { imageFiles } from "@/lib/image";
import { cn } from "@/lib/utils";
import { ArrowUp, ImagePlus, Loader2, Mic, Square, X } from "lucide-react";

/**
 * Mika's composer, shared by the floating widget and the /mika page: text, photos
 * (the button, a paste, or a drop — see useImageDrop), voice, and Stop while an
 * answer is being written. `fileRef` lets a welcome preset open the photo picker.
 */
export function TutorComposer({
  chat,
  inputRef,
  fileRef: outerFileRef,
  large = false,
}: {
  chat: TutorChat;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  fileRef?: RefObject<HTMLInputElement | null>;
  large?: boolean;
}) {
  const { t } = useI18n();
  const { show } = useToast();
  const { input, setInput, send, stop, busy, unfinished, attachments, attaching, addImages, removeAttachment, canAttach, pair } = chat;
  const ownFileRef = useRef<HTMLInputElement>(null);
  const fileRef = outerFileRef ?? ownFileRef;

  // People ask Mika in their own language (the one it answers in), not the one studied.
  const mic = useMicInput({
    lang: pair.target,
    getBase: () => input.trim(),
    onText: (full) => setInput(full),
    onError: (message) => show({ icon: "⚠️", title: message }),
  });

  // Grow the box with its content (up to a cap).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, large ? 180 : 120)}px`;
  }, [input, inputRef, large]);

  const canSend = !busy && !attaching && !unfinished && (!!input.trim() || attachments.length > 0);
  function submit() {
    if (mic.phase !== "idle") mic.cancel();
    send();
  }

  const iconBtn = cn(
    "flex shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-black/[0.05] hover:text-sage-deep disabled:opacity-40",
    large ? "h-10 w-10" : "h-9 w-9",
  );

  return (
    <div>
      {mic.phase !== "idle" && (
        <div className="mb-2 flex items-center gap-2.5 rounded-[14px] border border-warn/30 bg-warn-bg/60 px-3.5 py-2">
          {mic.phase === "recording" && (
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn-text opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warn-text" />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
            {mic.phase === "transcribing" ? (
              <span className="text-ink-faint">{t("mic.checking")}</span>
            ) : mic.interim ? (
              mic.interim
            ) : (
              <span className="text-ink-faint">{t("coach.practiceRec")}</span>
            )}
          </span>
        </div>
      )}
      <form
        className={cn(
          "rounded-[22px] border border-black/[0.08] bg-surface p-1.5 transition-colors focus-within:border-sage/60",
          large && "p-2 shadow-[0_10px_30px_rgba(46,42,38,0.12)]",
        )}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {(attachments.length > 0 || attaching) && (
          <div className="flex flex-wrap gap-2 px-1.5 pt-1.5 pb-1">
            {attachments.map((src, i) => (
              <span key={src} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL */}
                <img src={src} alt="" className="h-16 w-16 rounded-[12px] border border-black/[0.08] object-cover" />
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  aria-label={t("tutor.removePhoto")}
                  title={t("tutor.removePhoto")}
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-surface shadow"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {attaching && (
              <span className="flex h-16 w-16 items-center justify-center rounded-[12px] border border-dashed border-black/[0.15] text-ink-faint">
                <Loader2 className="h-5 w-5 animate-spin" />
              </span>
            )}
          </div>
        )}
        <div className="flex items-end gap-1">
          {canAttach && (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy || attachments.length >= MAX_ATTACH}
                aria-label={t("tutor.attach")}
                title={t("tutor.attach")}
                className={iconBtn}
              >
                <ImagePlus className="h-[18px] w-[18px]" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void addImages(imageFiles(e.target.files));
                  e.target.value = "";
                }}
              />
            </>
          )}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            // A screenshot pasted straight from the clipboard becomes a photo.
            onPaste={(e) => {
              if (!canAttach) return;
              const files = imageFiles(e.clipboardData?.items);
              if (!files.length) return;
              e.preventDefault();
              void addImages(files);
            }}
            placeholder={t(canAttach ? "tutor.placeholderPhoto" : "tutor.placeholder")}
            disabled={busy}
            className={cn(
              "min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[16px] leading-snug text-ink placeholder:text-ink-faint focus:outline-none",
              large ? "max-h-[180px] min-h-10 sm:text-[15px]" : "max-h-[120px] min-h-9 sm:text-[14px]",
            )}
          />
          <button
            type="button"
            onClick={mic.toggle}
            disabled={busy || mic.phase === "transcribing"}
            aria-label={t("tutor.mic")}
            title={t("tutor.mic")}
            className={cn(iconBtn, mic.phase === "recording" && "bg-warn-bg text-warn-text hover:bg-warn-bg hover:text-warn-text")}
          >
            {mic.phase === "recording" ? (
              <Square className="h-3.5 w-3.5 fill-current" />
            ) : mic.phase === "transcribing" ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" />
            ) : (
              <Mic className="h-[18px] w-[18px]" />
            )}
          </button>
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label={t("tutor.stop")}
              title={t("tutor.stop")}
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full bg-ink text-surface transition-opacity hover:opacity-85",
                large ? "h-10 w-10" : "h-9 w-9",
              )}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label={t("word.send")}
              title={t("word.send")}
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full bg-sage text-white transition-colors hover:bg-sage-deep disabled:opacity-40",
                large ? "h-10 w-10" : "h-9 w-9",
              )}
            >
              <ArrowUp className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/**
 * Drop photos anywhere on a Mika surface. Spread `props` on the container and show
 * `<DropHint />` while `dragging`. Only an actual file drag lights it up, not a
 * dragged bit of text.
 */
export function useImageDrop(chat: TutorChat) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const props = {
    onDragEnter: (e: React.DragEvent) => {
      if (!chat.canAttach || !hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (chat.canAttach && hasFiles(e)) e.preventDefault();
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!chat.canAttach || !hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!chat.canAttach || !hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (!chat.busy) void chat.addImages(imageFiles(e.dataTransfer.files));
    },
  };
  return { dragging, props };
}

export function DropHint() {
  const { t } = useI18n();
  return (
    <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-[18px] border-2 border-dashed border-sage bg-sage-tint/85 text-[15px] font-semibold text-sage-deep">
      <ImagePlus className="mr-2 h-5 w-5" /> {t("tutor.dropHere")}
    </div>
  );
}
