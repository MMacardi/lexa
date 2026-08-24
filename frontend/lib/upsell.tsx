"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Star, Sparkles, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// A small marketing popup shown when a free user taps a locked Pro control. It
// confirms before whisking them to /pro (nicer UX than an instant redirect) and
// stashes where they came from + any word they were typing, so /pro can show a
// contextual "back to my words" link and echo that word.

export interface UpsellOptions {
  /** Word the user had typed, echoed on the /pro screen. */
  word?: string;
}

const UpsellCtx = createContext<(opts?: UpsellOptions) => void>(() => {});

/** Returns a function that opens the Pro upsell popup. */
export function useUpsell(): (opts?: UpsellOptions) => void {
  return useContext(UpsellCtx);
}

export function UpsellProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");

  const openUpsell = useCallback((opts?: UpsellOptions) => {
    setWord(opts?.word?.trim() ?? "");
    setOpen(true);
  }, []);

  const goPro = useCallback(() => {
    try {
      sessionStorage.setItem("lexa.upsell", JSON.stringify({ from: pathname, word }));
    } catch {}
    setOpen(false);
    router.push("/pro");
  }, [pathname, word, router]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <UpsellCtx.Provider value={openUpsell}>
      {children}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="anim-fade-in fixed inset-0 z-[95] flex items-center justify-center bg-onyx/40 p-4 backdrop-blur-sm"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="anim-scale-in w-full max-w-[380px] overflow-hidden rounded-[22px] border border-sage/25 bg-surface shadow-[0_24px_60px_rgba(46,42,38,0.28)]">
              {/* hero band */}
              <div className="bg-gradient-to-br from-sage-tint/70 via-surface to-surface px-6 pt-6 text-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sage px-3 py-1 text-[12px] font-semibold text-white">
                  <Star className="h-3.5 w-3.5 fill-current" /> Lexa Pro
                </span>
                <h2 className="mt-3 font-serif text-[22px] font-semibold leading-tight text-ink">
                  {t("upsell.title")}
                </h2>
                {word && (
                  <p className="mt-1.5 text-[13px] text-ink-soft">
                    <span className="text-ink-faint">{t("pro.typedWord")}: </span>
                    <span className="font-semibold text-ink">{word}</span>
                  </p>
                )}
              </div>

              <div className="px-6 pb-6 pt-4">
                <p className="flex items-start gap-2 text-[14px] leading-snug text-ink-soft">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                  {t("upsell.body")}
                </p>

                <div className="mt-5 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={goPro}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full bg-sage px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
                  >
                    <Check className="h-4 w-4" /> {t("upsell.view")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-full px-4 py-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-black/[0.04]"
                  >
                    {t("upsell.later")}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </UpsellCtx.Provider>
  );
}
