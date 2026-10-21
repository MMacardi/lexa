"use client";

import { useEffect, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// One tap from the clipboard (BACKLOG "A 'Paste' button in the Reader and Add
// word"), Pleco's clipboard reader: text copied in WeChat or on a site gets here
// without a long-press and a menu. Hidden where the browser can't read the
// clipboard (older Firefox); a refused permission says where the paste still works.
export function PasteButton({
  onPaste,
  onPasteImages,
  label,
  disabled,
  className,
}: {
  onPaste: (text: string) => void;
  onPasteImages?: (files: File[]) => Promise<void>;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const { show } = useToast();
  // Decided after mount: the server render can't know, and guessing would flash.
  const [can, setCan] = useState(false);
  const [pasting, setPasting] = useState(false);
  useEffect(() => setCan(!!navigator.clipboard?.readText || (!!onPasteImages && !!navigator.clipboard?.read)), [onPasteImages]);
  if (!can) return null;

  async function paste() {
    if (pasting) return;
    setPasting(true);
    try {
      let text = "";
      if (onPasteImages && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        const files: File[] = [];
        for (const item of items) {
          const type = item.types.find((type) => type.startsWith("image/"));
          if (type) {
            const blob = await item.getType(type);
            files.push(new File([blob], "clipboard-image", { type }));
          } else if (item.types.includes("text/plain")) {
            text += await (await item.getType("text/plain")).text();
          }
        }
        if (files.length) {
          await onPasteImages(files);
          return;
        }
      } else {
        text = await navigator.clipboard.readText();
      }
      text = text.trim();
      if (text) onPaste(text);
      else show({ icon: "📋", title: t("paste.empty") });
    } catch {
      show({ icon: "📋", title: t("paste.denied") });
    } finally {
      setPasting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={paste}
      disabled={disabled || pasting}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:bg-black/[0.03] disabled:opacity-50",
        className,
      )}
    >
      <ClipboardPaste className="h-3.5 w-3.5" />
      {label ?? t("paste.label")}
    </button>
  );
}
