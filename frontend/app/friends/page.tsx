"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Friend, type Stats } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { useDailyGoal } from "@/lib/goal";
import { langLabel } from "@/lib/langs";
import { computeBadges } from "@/lib/achievements";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HoverTip } from "@/components/ui/HoverTip";
import { Copy, Check, X, UserPlus, Flame, Trophy, BookOpen, GraduationCap } from "lucide-react";

// Build a Stats-shaped object from a friend's public numbers so we can reuse the
// same badge logic. Daily-goal isn't meaningful for a snapshot, so it stays locked.
function friendStats(f: Friend): Stats {
  return {
    total: f.total,
    mastered: f.mastered,
    learning: Math.max(0, f.total - f.mastered),
    due: 0,
    trainedToday: 0,
    streak: f.streak,
    reviews: f.reviews,
    languages: f.languages,
    days: [],
    heat: [],
  };
}

function FriendsInner() {
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [goal] = useDailyGoal();
  const params = useSearchParams();

  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const autoAdded = useRef(false);

  const referral = useQuery({ queryKey: ["referral"], queryFn: () => api.referral() });
  const friends = useQuery({ queryKey: ["friends"], queryFn: () => api.friends() });
  const requests = useQuery({ queryKey: ["friend-requests"], queryFn: () => api.friendRequests() });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["friends"] });
    qc.invalidateQueries({ queryKey: ["friend-requests"] });
  };

  // Localize backend error codes (falls back to the raw message).
  const friendErr = (e: unknown): string => {
    const code = (e as { code?: string }).code;
    const map: Record<string, string> = { own_code: "friends.errOwnCode", no_code: "friends.errNoCode", not_found: "friends.errNotFound" };
    return code && map[code] ? t(map[code]) : (e as Error).message;
  };

  const add = useMutation({
    mutationFn: (c: string) => api.addFriend(c),
    onSuccess: (r) => {
      setCode("");
      invalidate();
      show({ icon: "👥", title: r.status === "accepted" ? t("friends.nowFriends") : t("friends.requestSent") });
    },
    onError: (e) => show({ icon: "⚠️", title: friendErr(e) }),
  });
  const accept = useMutation({
    mutationFn: (id: string) => api.acceptFriend(id),
    onSuccess: () => {
      invalidate();
      show({ icon: "👥", title: t("friends.nowFriends") });
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.removeFriend(id), onSuccess: invalidate });

  // Deep link: /friends?add=CODE (from an invite link) auto-sends the request once.
  useEffect(() => {
    const c = params.get("add");
    if (c && !autoAdded.current) {
      autoAdded.current = true;
      add.mutate(c.toUpperCase());
    }
  }, [params, add]);

  async function copyLink() {
    const link = referral.data?.link;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is still visible to copy manually */
    }
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <div>
        <h1 className="font-serif text-[28px] font-medium text-ink sm:text-[32px]">{t("friends.title")}</h1>
        <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{t("friends.subtitle")}</p>
      </div>

      {/* invite / referral */}
      <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("friends.invite")}</h2>
        <p className="mt-1 text-[13px] leading-snug text-ink-soft">{t("friends.inviteHint")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="rounded-[10px] border border-black/[0.08] bg-paper px-3 py-2 text-[15px] font-semibold tracking-[0.15em] text-ink">
            {referral.data?.code ?? "····"}
          </code>
          <Button type="button" variant="outline" onClick={copyLink} className="inline-flex items-center gap-1.5">
            {copied ? <Check className="h-4 w-4 text-sage-deep" /> : <Copy className="h-4 w-4" />}
            {copied ? t("friends.copied") : t("friends.copyLink")}
          </Button>
        </div>
      </section>

      {/* add by code */}
      <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("friends.add")}</h2>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) add.mutate(code.trim().toUpperCase());
          }}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t("friends.codePlaceholder")}
            className="h-11 w-[180px] tracking-[0.15em]"
          />
          <Button type="submit" disabled={add.isPending || !code.trim()} className="inline-flex items-center gap-1.5">
            <UserPlus className="h-4 w-4" /> {t("friends.addBtn")}
          </Button>
        </form>
      </section>

      {/* incoming requests */}
      {(requests.data?.length ?? 0) > 0 && (
        <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
            {t("friends.requests", { n: requests.data!.length })}
          </h2>
          <div className="mt-3 space-y-2">
            {requests.data!.map((r) => (
              <div key={r.friendshipId} className="flex items-center justify-between gap-3 rounded-[14px] border border-black/[0.06] bg-paper/50 px-3.5 py-2.5">
                <span className="truncate text-[15px] font-semibold text-ink">{r.name}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => accept.mutate(r.friendshipId)}
                    className="inline-flex items-center gap-1 rounded-full bg-sage px-3 py-1.5 text-xs font-semibold text-white hover:bg-sage-deep"
                  >
                    <Check className="h-3.5 w-3.5" /> {t("friends.accept")}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove.mutate(r.friendshipId)}
                    aria-label={t("friends.decline")}
                    className="rounded-full border border-black/[0.08] p-1.5 text-ink-faint hover:bg-black/[0.03] hover:text-warn-text"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* friends list */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
          {t("friends.yours", { n: friends.data?.length ?? 0 })}
        </h2>
        {friends.isLoading ? (
          <p className="text-sm text-ink-faint">…</p>
        ) : (friends.data?.length ?? 0) === 0 ? (
          <p className="rounded-[16px] border border-dashed border-black/[0.1] bg-paper/40 p-6 text-center text-sm text-ink-soft">
            {t("friends.empty")}
          </p>
        ) : (
          <div className="space-y-3">
            {friends.data!.map((f) => {
              const badges = computeBadges(friendStats(f), goal).filter((b) => b.done);
              return (
                <div key={f.friendshipId} className="rounded-[18px] border border-black/[0.06] bg-surface p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-serif text-[19px] font-semibold text-ink">{f.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {f.languages.length === 0 ? (
                          <span className="text-[12px] text-ink-faint">{t("friends.noLangs")}</span>
                        ) : (
                          f.languages.map((l) => (
                            <span key={l} className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-deep">
                              {langLabel(l)}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove.mutate(f.friendshipId)}
                      aria-label={t("friends.remove")}
                      className="shrink-0 rounded-full p-1.5 text-ink-faint hover:bg-black/[0.03] hover:text-warn-text"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-4 text-[13px] text-ink-soft">
                    <span className="inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4 text-ink-faint" /> {t("friends.statWords", { n: f.total })}</span>
                    <span className="inline-flex items-center gap-1.5"><GraduationCap className="h-4 w-4 text-ink-faint" /> {t("friends.statMastered", { n: f.mastered })}</span>
                    <span className="inline-flex items-center gap-1.5"><Flame className="h-4 w-4 text-orange-500" /> {t("friends.statStreak", { n: f.streak })}</span>
                    <span className="inline-flex items-center gap-1.5"><Trophy className="h-4 w-4 text-sage-deep" /> {t("friends.statBadges", { n: badges.length })}</span>
                  </div>

                  {badges.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-black/[0.06] pt-3">
                      {badges.map((b) => (
                        <HoverTip key={b.id} title={t(b.labelKey)} subtitle={t(b.descKey)} className="flex h-8 w-8 items-center justify-center rounded-full bg-sage-tint">
                          <b.Icon className="h-4 w-4 text-sage-deep" />
                        </HoverTip>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default function FriendsPage() {
  return (
    <Suspense fallback={null}>
      <FriendsInner />
    </Suspense>
  );
}
