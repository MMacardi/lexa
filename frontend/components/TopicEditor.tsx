"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasteButton } from "@/components/PasteButton";
import { cn } from "@/lib/utils";

const PRESETS = ["ai", "business", "travel", "medicine", "games"] as const;

// Name the field whose words should come beside the exam ones (BACKLOG "Topic
// words beside the exam words"), inside Today's words rather than on a card of its
// own — Today already had two places offering new words. A text is optional: a
// talk or an article on the topic puts the words that really occur in it first.
export function TopicEditor({ current, onDone }: { current: string | null; onDone: () => void }) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [topic, setTopic] = useState(current ?? "");
  const [text, setText] = useState("");
  const [withText, setWithText] = useState(false);
  const [saving, setSaving] = useState<"save" | "remove" | null>(null);

  async function save() {
    const name = topic.trim();
    if (!name || saving) return;
    setSaving("save");
    try {
      const day = await api.setTopic(name, withText ? text : undefined);
      qc.setQueryData(["topicDaily", accountId], day);
      onDone();
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setSaving(null);
    }
  }

  async function remove() {
    if (saving) return;
    setSaving("remove");
    try {
      await api.clearTopic();
      qc.setQueryData(["topicDaily", accountId], { topic: null, words: [], left: 0 });
      onDone();
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="anim-fade-up mt-4 space-y-3 rounded-[16px] border border-black/[0.06] bg-paper/60 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] leading-snug text-ink-soft">{t("topic.editorHint")}</p>
        <button
          type="button"
          onClick={onDone}
          aria-label={t("common.cancel")}
          className="-mr-1 -mt-1 shrink-0 rounded-full p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={t("topic.placeholder")}
          maxLength={60}
          disabled={!!saving}
          className="h-10"
        />
        <Button type="submit" size="sm" className="h-10 shrink-0" disabled={!topic.trim() || !!saving}>
          {saving === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : t("topic.pick")}
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const label = t(`topic.preset.${p}`);
          return (
            <button
              key={p}
              type="button"
              disabled={!!saving}
              onClick={() => setTopic(label)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                topic === label ? "border-sage bg-sage-tint text-sage-deep" : "border-black/[0.08] bg-surface text-ink-muted hover:border-sage/60",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {withText ? (
        <div className="space-y-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("topic.textPlaceholder")}
            disabled={!!saving}
            className="font-zh min-h-[96px] w-full resize-y rounded-[12px] border border-black/[0.08] bg-surface p-3 text-[14px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
          />
          {!text.trim() && <PasteButton onPaste={setText} disabled={!!saving} />}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setWithText(true)}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-sage-deep hover:text-sage"
        >
          <FileText className="h-3.5 w-3.5" /> {t("topic.addText")}
        </button>
      )}

      {saving === "save" && <p className="text-[12px] text-ink-faint">{t("topic.picking", { topic: topic.trim() })}</p>}
      {current && !saving && (
        <button type="button" onClick={remove} className="text-[12px] font-medium text-ink-faint hover:text-warn-text">
          {t("topic.remove")}
        </button>
      )}
    </div>
  );
}
