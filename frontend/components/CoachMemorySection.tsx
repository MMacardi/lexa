"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { parseChips } from "@/lib/goalText";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { LangSelect } from "@/components/LangSelect";
import { FIXED_PAIR } from "@/lib/langs";
import { ExamPlan } from "@/components/ExamPlan";
import { GOALS, INTERESTS } from "@/components/HskFirstRun";
import { cn } from "@/lib/utils";
import { Compass, Trash2, X, type LucideIcon } from "lucide-react";

type ChipOption = { id: string; key: string; Icon: LucideIcon | React.ComponentType<{ className?: string }> };

// Also Today's field picker (TopicEditor): the interests are the topic words' fields.
export function ChipField({
  label,
  options,
  text,
  onChange,
}: {
  label?: string;
  options: ChipOption[];
  text: string;
  onChange: (text: string) => void;
}) {
  const { t } = useI18n();
  const { on, extra } = parseChips(text, options);
  const write = (ids: Set<string>, rest: string[]) =>
    onChange([...options.filter((o) => ids.has(o.id)).map((o) => t(o.key)), ...rest].join(", "));
  const toggle = (id: string) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    write(next, extra);
  };
  return (
    <div>
      {label && <label className="mb-1.5 block text-[13px] font-semibold text-ink">{label}</label>}
      <div className="flex flex-wrap gap-1.5">
        {options.map(({ id, key, Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={on.has(id)}
            onClick={() => toggle(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
              on.has(id) ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-surface text-ink hover:bg-black/[0.03]",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(key)}
          </button>
        ))}
        {extra.map((piece) => (
          <button
            key={piece}
            type="button"
            onClick={() => write(on, extra.filter((x) => x !== piece))}
            className="inline-flex items-center gap-1 rounded-full border border-sage bg-sage px-3 py-1.5 text-[13px] font-medium text-white"
          >
            {piece}
            <X className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}

const WHY: ChipOption[] = GOALS.map((g) => ({ id: g.id, key: `onb.goal.${g.id}`, Icon: g.Icon }));
export const LIKES: ChipOption[] = INTERESTS.map((i) => ({ id: i.id, key: `onb.int.${i.id}`, Icon: i.Icon }));

// "What your coach knows about you" — the learner-visible view of the coach memory
// (goal + interests they set, plus the model-maintained notes). Editable + clearable,
// so the personal-agent memory is transparent and under the learner's control.
//
// Memory is PER SOURCE LANGUAGE: an IELTS goal written while practising English must
// not follow the learner into their Chinese sessions, so the section is scoped by a
// language picker and each language has its own row.
export function CoachMemorySection() {
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const [lang, setLang] = useState(FIXED_PAIR?.sourceLang ?? "en");

  // Start on the pair the learner actually uses, so the section opens on the language
  // they care about rather than always English.
  useEffect(() => {
    try {
      if (FIXED_PAIR) return;
      const p = JSON.parse(localStorage.getItem("lexa.wordPair") ?? "null") as { sourceLang?: string } | null;
      const requested = new URLSearchParams(window.location.search).get("memoryLang");
      if (requested || p?.sourceLang) setLang(requested || p!.sourceLang!);
    } catch {
      /* ignore */
    }
  }, []);

  const { data } = useQuery({
    queryKey: ["coach-profile", accountId, lang],
    queryFn: () => api.coachProfile(accountId, lang),
    enabled: !!accountId,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  const [goal, setGoal] = useState("");
  const [interests, setInterests] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setGoal(data?.goal ?? "");
    setInterests(data?.interests ?? "");
    setNotes(data?.notes ?? "");
  }, [data]);

  const rememberSaved = (value: { goal: string; interests: string; notes: string }) =>
    qc.setQueryData(["coach-profile", accountId, lang], value);

  async function save() {
    setSaving(true);
    try {
      rememberSaved(await api.updateCoachProfile({ telegramId: accountId, lang, goal, interests, notes }));
      show({ icon: "💾", title: t("coachmem.saved") });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setSaving(false);
    }
  }

  // A chip is a choice, not a draft: it saves as it's tapped, like the plan does.
  async function saveNow(patch: { goal?: string; interests?: string }) {
    setSaving(true);
    try {
      await api.updateCoachProfile({ telegramId: accountId, lang, ...patch });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setSaving(false);
    }
  }

  async function clearNotes() {
    setSaving(true);
    try {
      rememberSaved(await api.updateCoachProfile({ telegramId: accountId, lang, notes: "" }));
      setNotes("");
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="mika-memory" className="scroll-mt-24 rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
        <Compass className="h-4 w-4 text-sage-deep" /> {t("coachmem.title")}
      </h2>
      <p className="mt-1.5 text-[13px] leading-snug text-ink-soft">{t("coachmem.hint")}</p>

      <div className="mt-4 space-y-3">
        {!FIXED_PAIR && (
          <div>
            <label className="text-[13px] font-semibold text-ink">{t("coachmem.lang")}</label>
            <LangSelect value={lang} onChange={setLang} className="mt-1" />
          </div>
        )}
        {lang === "zh" ? (
          <>
            <div id="plan" className="scroll-mt-24">
              <label className="text-[13px] font-semibold text-ink">{t("coachmem.exam")}</label>
              <div className="mt-1.5">
                <ExamPlan />
              </div>
            </div>
            <ChipField
              label={t("coachmem.why")}
              options={WHY}
              text={goal}
              onChange={(v) => {
                setGoal(v);
                void saveNow({ goal: v });
              }}
            />
            <ChipField
              label={t("coachmem.interests")}
              options={LIKES}
              text={interests}
              onChange={(v) => {
                setInterests(v);
                void saveNow({ interests: v });
              }}
            />
          </>
        ) : (
          <>
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
          </>
        )}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[13px] font-semibold text-ink">{t("coachmem.notes")}</label>
            {notes && (
              <button type="button" onClick={clearNotes} disabled={saving} className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-faint hover:text-warn-text disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" /> {t("coachmem.clear")}
              </button>
            )}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={900}
            rows={3}
            placeholder={t("coachmem.notesEmpty")}
            className="mt-1 w-full resize-y rounded-[12px] border border-black/[0.08] bg-surface px-3.5 py-2.5 text-[14px] leading-snug text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
          />
          <p className="mt-1 text-[13px] text-ink-faint">{t("coachmem.notesHint")}</p>
        </div>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={save}
          disabled={saving || !data}
          className="rounded-full bg-sage px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-50"
        >
          {t("coachmem.save")}
        </button>
      </div>
    </section>
  );
}
