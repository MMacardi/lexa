"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { LangSelect } from "@/components/LangSelect";
import { Compass, Trash2 } from "lucide-react";

// "What your coach knows about you" — the learner-visible view of the coach memory
// (goal + interests they set, plus the model-maintained notes). Editable + clearable,
// so the personal-agent memory is transparent and under the learner's control.
//
// Memory is PER SOURCE LANGUAGE: an IELTS goal written while practising English must
// not follow the learner into their Chinese sessions, so the section is scoped by a
// language picker and each language has its own row.
export function CoachMemorySection() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const [lang, setLang] = useState("en");

  // Start on the pair the learner actually uses, so the section opens on the language
  // they care about rather than always English.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("lexa.wordPair") ?? "null") as { sourceLang?: string } | null;
      if (p?.sourceLang) setLang(p.sourceLang);
    } catch {
      /* ignore */
    }
  }, []);

  const { data } = useQuery({
    queryKey: ["coach-profile", accountId, lang],
    queryFn: () => api.coachProfile(accountId, lang),
    enabled: !!accountId,
  });

  const [goal, setGoal] = useState("");
  const [interests, setInterests] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setGoal(data.goal);
      setInterests(data.interests);
      setNotes(data.notes);
    }
  }, [data]);

  async function save() {
    setSaving(true);
    try {
      await api.updateCoachProfile({ telegramId: accountId, lang, goal, interests, notes });
      show({ icon: "💾", title: t("coachmem.saved") });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setSaving(false);
    }
  }

  async function clearNotes() {
    setNotes("");
    try {
      await api.updateCoachProfile({ telegramId: accountId, lang, notes: "" });
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
        <Compass className="h-4 w-4 text-sage-deep" /> {t("coachmem.title")}
      </h2>
      <p className="mt-1.5 text-[13px] leading-snug text-ink-soft">{t("coachmem.hint")}</p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-[13px] font-semibold text-ink">{t("coachmem.lang")}</label>
          <LangSelect value={lang} onChange={setLang} className="mt-1" />
          <p className="mt-1 text-[12px] text-ink-faint">{t("coachmem.perLang")}</p>
        </div>
        <div>
          <label className="text-[13px] font-semibold text-ink">{t("coachmem.goal")}</label>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={300}
            placeholder={t("coachmem.goalPh")}
            className="mt-1 h-10 w-full rounded-[12px] border border-black/[0.08] bg-surface px-3.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[13px] font-semibold text-ink">{t("coachmem.interests")}</label>
          <input
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
            maxLength={300}
            placeholder={t("coachmem.interestsPh")}
            className="mt-1 h-10 w-full rounded-[12px] border border-black/[0.08] bg-surface px-3.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[13px] font-semibold text-ink">{t("coachmem.notes")}</label>
            {notes && (
              <button type="button" onClick={clearNotes} className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-faint hover:text-warn-text">
                <Trash2 className="h-3.5 w-3.5" /> {t("coachmem.clear")}
              </button>
            )}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder={t("coachmem.notesEmpty")}
            className="mt-1 w-full resize-y rounded-[12px] border border-black/[0.08] bg-surface px-3.5 py-2.5 text-[14px] leading-snug text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
          />
          <p className="mt-1 text-[12px] text-ink-faint">{t("coachmem.notesHint")}</p>
        </div>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full bg-sage px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-50"
        >
          {t("coachmem.save")}
        </button>
      </div>
    </section>
  );
}
