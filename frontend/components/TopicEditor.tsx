"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INTERESTS } from "@/components/HskFirstRun";
import { cn } from "@/lib/utils";

// Switch the field whose words come beside the exam ones, inside Today's words.
// The first interest from onboarding is already the topic (BACKLOG "Your field
// without asking again"), so this is only the small edit behind it: the learner's
// interests as chips, one tap to switch (onboarding's list if they picked none),
// and a name of their own behind "Other". No text box — a text on the topic
// belongs in the Reader.
export function TopicEditor({ current, interests, onDone }: { current: string | null; interests: string[]; onDone: () => void }) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [own, setOwn] = useState(false);
  const [name, setName] = useState("");
  // The topic being picked, or "" while the topic is being dropped.
  const [saving, setSaving] = useState<string | null>(null);

  const listed = interests.length ? interests : INTERESTS.map((i) => t(`onb.int.${i.id}`));
  const choices = current && !listed.includes(current) ? [current, ...listed] : listed;

  async function pick(topic: string) {
    topic = topic.trim();
    if (!topic || saving !== null) return;
    if (topic === current) return onDone();
    setSaving(topic);
    try {
      qc.setQueryData(["topicDaily", accountId], await api.setTopic(topic));
      onDone();
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setSaving(null);
    }
  }

  async function remove() {
    if (saving !== null) return;
    setSaving("");
    try {
      await api.clearTopic();
      qc.setQueryData(["topicDaily", accountId], { topic: null, words: [], left: 0, interests });
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
      <div className="flex flex-wrap gap-1.5">
        {choices.map((c) => (
          <button
            key={c}
            type="button"
            disabled={saving !== null}
            onClick={() => pick(c)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-60",
              c === current ? "border-sage bg-sage-tint text-sage-deep" : "border-black/[0.08] bg-surface text-ink-muted hover:border-sage/60",
            )}
          >
            {saving === c && <Loader2 className="h-3 w-3 animate-spin" />}
            {c}
          </button>
        ))}
        {!own && (
          <button
            type="button"
            disabled={saving !== null}
            onClick={() => setOwn(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-black/[0.12] px-2.5 py-1 text-[12px] font-medium text-ink-faint transition-colors hover:border-sage/60 hover:text-ink disabled:opacity-60"
          >
            <Plus className="h-3 w-3" /> {t("topic.own")}
          </button>
        )}
      </div>

      {own && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void pick(name);
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("topic.placeholder")}
            maxLength={60}
            disabled={saving !== null}
            className="h-10"
          />
          <Button type="submit" size="sm" className="h-10 shrink-0" disabled={!name.trim() || saving !== null}>
            {saving === name.trim() ? <Loader2 className="h-4 w-4 animate-spin" /> : t("topic.pick")}
          </Button>
        </form>
      )}

      {saving && <p className="text-[12px] text-ink-faint">{t("topic.picking", { topic: saving })}</p>}
      {current && saving === null && (
        <button type="button" onClick={remove} className="text-[12px] font-medium text-ink-faint hover:text-warn-text">
          {t("topic.remove")}
        </button>
      )}
    </div>
  );
}
