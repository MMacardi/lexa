"use client";

import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, Smartphone, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

// "Add to Home Screen" (BACKLOG item of that name). Installed, the app opens full
// screen with no Safari bars — which also sidesteps most of the viewport quirks —
// and it is what web push on iOS will need later.
//
// Android/Chrome hands us an install prompt (`beforeinstallprompt`); it can fire
// before Today mounts, so `captureInstallPrompt` runs from the root layout and
// keeps it. iPhone has no prompt at all, only Share → Add to Home Screen, so it
// gets the three steps instead — from the second day of use, once someone has
// come back, not on a first visit.

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallPromptEvent | null = null;
let capturing = false;
const READY = "lexa-install-ready";

/** Keep Chrome's install prompt for later (called from the root layout). */
export function captureInstallPrompt() {
  if (typeof window === "undefined" || capturing) return;
  capturing = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // no mini-infobar: the card on Today asks at a better moment
    deferred = e as InstallPromptEvent;
    window.dispatchEvent(new Event(READY));
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    window.dispatchEvent(new Event(READY));
  });
}

const DISMISSED = "lexa.installDismissed";
const FIRST_DAY = "lexa.firstSeenDay";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* blocked storage: the card just comes back next time */
  }
}

function installed(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
// Inside Telegram the page is a Mini App: there is no home screen to add it to.
function inTelegram(): boolean {
  return !!(window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData;
}
function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function InstallApp() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"android" | "ios" | null>(null);

  useEffect(() => {
    if (installed() || inTelegram() || read(DISMISSED) === "1") return;
    const today = new Date().toISOString().slice(0, 10);
    const first = read(FIRST_DAY);
    if (!first) write(FIRST_DAY, today);
    const decide = () => {
      if (deferred) setMode("android");
      else if (isIos() && first && first !== today) setMode("ios");
      else setMode(null);
    };
    decide();
    window.addEventListener(READY, decide);
    return () => window.removeEventListener(READY, decide);
  }, []);

  if (!mode) return null;

  const dismiss = () => {
    write(DISMISSED, "1");
    setMode(null);
  };

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === "accepted") dismiss();
    else setMode(null); // asked once this visit; the card comes back on another day
  }

  return (
    <section className="anim-fade-up relative rounded-[24px] border border-sage/25 bg-gradient-to-br from-sage-tint/50 via-surface to-surface p-5">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("install.notNow")}
        className="absolute right-3 top-3 rounded-full p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-2 pr-8 text-sage-deep">
        <Smartphone className="h-5 w-5 shrink-0" />
        <h3 className="font-serif text-[20px] font-medium text-ink">{t("install.title")}</h3>
      </div>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{t("install.why")}</p>

      {mode === "android" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={install}>
            <Download className="mr-2 h-4 w-4" /> {t("install.button")}
          </Button>
          <Button variant="ghost" onClick={dismiss}>
            {t("install.notNow")}
          </Button>
        </div>
      ) : (
        <>
          <ol className="mt-4 space-y-2.5">
            {[
              { Icon: Share, text: t("install.ios1") },
              { Icon: SquarePlus, text: t("install.ios2") },
              { Icon: Smartphone, text: t("install.ios3") },
            ].map(({ Icon, text }, i) => (
              <li key={i} className="flex items-center gap-3 text-[14px] text-ink">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-sage-deep shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">{text}</span>
              </li>
            ))}
          </ol>
          <Button variant="ghost" className="mt-3" onClick={dismiss}>
            {t("install.gotIt")}
          </Button>
        </>
      )}
    </section>
  );
}
