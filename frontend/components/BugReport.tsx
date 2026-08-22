"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bug, X, Camera, Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  initBugCapture,
  collectContext,
  getCapturedErrors,
  captureScreenshot,
  type CapturedError,
} from "@/lib/bugContext";
import { cn } from "@/lib/utils";

type Kind = "bug" | "idea" | "other";
type ShotState = "idle" | "capturing" | "ready" | "failed";

// Floating beta bug/idea reporter. One tap opens a small form; on send it ships
// the message plus auto-collected context (route, environment, recent JS/network
// errors) and — by default — a screenshot of the current page to the owner.
export function BugReport() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [attachShot, setAttachShot] = useState(true);
  const [shotState, setShotState] = useState<ShotState>("idle");
  const shot = useRef<string | null>(null);
  const errorsRef = useRef<CapturedError[]>([]);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  useEffect(() => initBugCapture(), []);

  // On open, snapshot the recent errors and (if enabled) grab a screenshot. We
  // hide the modal itself during capture so it isn't in the shot.
  async function grabShot() {
    setShotState("capturing");
    shot.current = null;
    // Let the "capturing" state paint and the modal fade before we rasterize.
    await new Promise((r) => setTimeout(r, 60));
    const data = await captureScreenshot();
    shot.current = data;
    setShotState(data ? "ready" : "failed");
  }

  function openForm() {
    errorsRef.current = getCapturedErrors();
    setStatus("idle");
    setOpen(true);
    if (attachShot) void grabShot();
  }

  function toggleShot() {
    const next = !attachShot;
    setAttachShot(next);
    if (next) void grabShot();
    else {
      shot.current = null;
      setShotState("idle");
    }
  }

  async function submit() {
    if (!message.trim()) return;
    setStatus("sending");
    try {
      const ctx = collectContext();
      await api.sendFeedback({
        message: message.trim(),
        kind,
        appLang: locale,
        ...ctx,
        errors: errorsRef.current,
        screenshot: attachShot && shot.current ? shot.current : undefined,
      });
      setStatus("done");
      setMessage("");
      setTimeout(() => setOpen(false), 1400);
    } catch {
      setStatus("error");
    }
  }

  const KINDS: Kind[] = ["bug", "idea", "other"];

  return (
    <>
      <button
        type="button"
        onClick={openForm}
        aria-label={t("bug.button")}
        title={t("bug.button")}
        className="fixed right-4 bottom-[calc(132px_+_env(safe-area-inset-bottom))] z-50 flex h-12 w-12 items-center justify-center rounded-full border border-black/[0.08] bg-surface text-warn-text shadow-[0_10px_28px_rgba(46,42,38,0.24)] transition-transform hover:scale-105 active:scale-95 md:bottom-[92px]"
      >
        <Bug className="h-5 w-5" />
      </button>

      {open &&
        createPortal(
          <div
            className={cn(
              "fixed inset-0 z-[95] flex items-end justify-center bg-black/40 p-4 sm:items-center",
              shotState === "capturing" && "opacity-0", // keep the modal out of its own screenshot
            )}
            onClick={() => status !== "sending" && setOpen(false)}
          >
            <div
              className="anim-pop flex max-h-[92vh] w-full max-w-[460px] flex-col overflow-hidden rounded-[22px] border border-black/[0.08] bg-surface p-4 shadow-[0_24px_60px_rgba(46,42,38,0.34)] sm:p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bug className="h-5 w-5 text-warn-text" />
                  <h2 className="font-serif text-[19px] font-medium text-ink">{t("bug.title")}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("bug.close")}
                  className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.05] hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {status === "done" ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sage-tint text-sage-deep">
                    <Check className="h-6 w-6" />
                  </span>
                  <p className="text-[15px] font-medium text-ink">{t("bug.thanks")}</p>
                </div>
              ) : (
                <>
                  <p className="mb-3 text-[13px] leading-snug text-ink-soft">{t("bug.subtitle")}</p>

                  {/* kind */}
                  <div className="mb-3 flex gap-1 rounded-full bg-black/[0.04] p-1 text-[13px] font-semibold w-fit">
                    {KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setKind(k)}
                        className={cn(
                          "rounded-full px-3 py-1 transition-colors",
                          kind === k ? "bg-sage text-white" : "text-ink-muted",
                        )}
                      >
                        {t(`bug.kind.${k}`)}
                      </button>
                    ))}
                  </div>

                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t("bug.placeholder")}
                    rows={4}
                    autoFocus
                    className="mb-3 w-full resize-none rounded-[14px] border border-black/[0.1] bg-paper px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-sage/60"
                  />

                  {/* screenshot toggle */}
                  <button
                    type="button"
                    onClick={toggleShot}
                    className="mb-2 flex items-center gap-2 text-left text-[13px] text-ink-soft"
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                        attachShot ? "border-sage bg-sage text-white" : "border-black/20 bg-surface",
                      )}
                    >
                      {attachShot && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <Camera className="h-4 w-4 text-ink-faint" />
                    <span>{t("bug.attachShot")}</span>
                  </button>
                  {attachShot && (
                    <p className="mb-1 pl-7 text-[12px] text-ink-faint">
                      {shotState === "capturing" && t("bug.shotCapturing")}
                      {shotState === "ready" && `✓ ${t("bug.shotReady")}`}
                      {shotState === "failed" && t("bug.shotFailed")}
                    </p>
                  )}
                  {errorsRef.current.length > 0 && (
                    <p className="mb-1 pl-7 text-[12px] text-ink-faint">
                      {t("bug.errorsCaptured", { n: errorsRef.current.length })}
                    </p>
                  )}

                  {status === "error" && <p className="mb-1 text-[13px] text-warn-text">{t("bug.failed")}</p>}

                  <button
                    type="button"
                    onClick={submit}
                    disabled={!message.trim() || status === "sending" || shotState === "capturing"}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-sage px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-50"
                  >
                    {status === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}
                    {status === "sending" ? t("bug.sending") : t("bug.send")}
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
