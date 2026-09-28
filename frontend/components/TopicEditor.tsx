"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { Button } from "@/components/ui/button";
import { ChipField, LIKES } from "@/components/CoachMemorySection";

// The fields whose words come beside the exam ones, inside Today's words (BACKLOG
// "Your field without asking again"). The fields are the interests — onboarding's
// twelve, the same chips as Settings, as many as the learner likes; the day's
// words go round them. A fixed list, not a free-text topic: a field the model
// knows well gives the words a newcomer to it really hears, and a text on some
// topic belongs in the Reader.
export function TopicEditor({ topics, on, onDone }: { topics: string[]; on: boolean; onDone: () => void }) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState(topics.join(", "));
  const [saving, setSaving] = useState<"save" | "remove" | null>(null);

  const picked = text
    .split(/\s*[,，、;；]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  async function save() {
    if (saving) return;
    if (on && picked.join(", ") === topics.join(", ")) return onDone();
    setSaving("save");
    try {
      qc.setQueryData(["topicDaily", accountId], await api.setTopics(picked));
      qc.invalidateQueries({ queryKey: ["coach-profile"] });
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
      qc.setQueryData(["topicDaily", accountId], { on: false, topics, words: [], left: 0 });
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
      <ChipField options={LIKES} text={text} onChange={setText} />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={!!saving}>
          {saving === "save" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {t("topic.done")}
        </Button>
        {on && topics.length > 0 && !saving && (
          <button type="button" onClick={remove} className="text-[12px] font-medium text-ink-faint hover:text-warn-text">
            {t("topic.remove")}
          </button>
        )}
      </div>
      {saving === "save" && <p className="text-[12px] text-ink-faint">{t("topic.seeding")}</p>}
    </div>
  );
}
