"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Styled replacements for the browser's native confirm()/prompt() so blocking
// dialogs match the rest of the app, plus a choose() picker. Each returns a
// Promise that resolves when the user acts, presses Esc, or clicks the backdrop.

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  // When set, renders a checkbox (e.g. "don't ask again"); its final state is
  // reported via onResult. The promise still resolves to the yes/no boolean.
  checkboxLabel?: string;
  onResult?: (checked: boolean) => void;
}

interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ChooseOption {
  value: string;
  label: string;
  hint?: string;
}

interface ChooseOptions {
  title: string;
  message?: string;
  options: ChooseOption[];
  cancelLabel?: string;
}

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: "choose"; opts: ChooseOptions; resolve: (v: string | null) => void };

const DialogCtx = createContext<{
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  choose: (opts: ChooseOptions) => Promise<string | null>;
}>({
  confirm: async () => false,
  prompt: async () => null,
  choose: async () => null,
});

export const useDialog = () => useContext(DialogCtx);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setChecked(false);
        setPending({ kind: "confirm", opts, resolve });
      }),
    [],
  );

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.defaultValue ?? "");
        setPending({ kind: "prompt", opts, resolve });
      }),
    [],
  );

  const choose = useCallback(
    (opts: ChooseOptions) =>
      new Promise<string | null>((resolve) => setPending({ kind: "choose", opts, resolve })),
    [],
  );

  const settle = useCallback(
    (result: boolean | string | null) => {
      if (!pending) return;
      if (pending.kind === "confirm") {
        pending.opts.onResult?.(checked);
        pending.resolve(result === true);
      } else {
        pending.resolve(typeof result === "string" ? result : null);
      }
      setPending(null);
      setValue("");
      setChecked(false);
    },
    [pending, checked],
  );

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(pending.kind === "confirm" ? false : null);
    };
    document.addEventListener("keydown", onKey);
    if (pending.kind === "prompt") setTimeout(() => inputRef.current?.focus(), 20);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, settle]);

  const danger = pending?.kind === "confirm" && pending.opts.tone === "danger";
  const cancel = () => settle(pending?.kind === "confirm" ? false : null);
  const accept = () => settle(pending?.kind === "prompt" ? value.trim() : true);

  return (
    <DialogCtx.Provider value={{ confirm, prompt, choose }}>
      {children}
      {pending &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="anim-fade-in fixed inset-0 z-[90] flex items-center justify-center bg-onyx/40 p-4 backdrop-blur-sm"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) cancel();
            }}
          >
            <div className="anim-scale-in w-full max-w-[400px] overflow-hidden rounded-[20px] border border-black/[0.08] bg-surface shadow-[0_24px_60px_rgba(46,42,38,0.28)]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (pending.kind !== "choose") accept();
                }}
                className="p-5"
              >
                <h2 className="font-serif text-[20px] font-semibold leading-tight text-ink">
                  {pending.opts.title}
                </h2>
                {pending.opts.message && (
                  <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">{pending.opts.message}</p>
                )}

                {pending.kind === "prompt" && (
                  <input
                    ref={inputRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={pending.opts.placeholder}
                    className="mt-3.5 h-11 w-full rounded-[14px] border border-black/[0.08] bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
                  />
                )}

                {pending.kind === "choose" && (
                  <div className={cn("mt-4 grid gap-2", pending.opts.options.length <= 2 ? "grid-cols-2" : "grid-cols-3")}>
                    {pending.opts.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => settle(o.value)}
                        className="flex flex-col items-center rounded-[14px] border border-black/[0.08] bg-surface px-2 py-3 text-center transition-colors hover:border-sage hover:bg-sage-tint"
                      >
                        <span className="font-serif text-[18px] font-semibold text-ink">{o.label}</span>
                        {o.hint && <span className="mt-0.5 text-[11px] text-ink-faint">{o.hint}</span>}
                      </button>
                    ))}
                  </div>
                )}

                {pending.kind === "confirm" && pending.opts.checkboxLabel && (
                  <label className="mt-4 flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink-muted">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                      className="h-4 w-4 accent-[#7c9885]"
                    />
                    {pending.opts.checkboxLabel}
                  </label>
                )}

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancel}
                    className="rounded-full px-4 py-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-black/[0.04]"
                  >
                    {pending.opts.cancelLabel ?? t("common.cancel")}
                  </button>
                  {pending.kind !== "choose" && (
                    <button
                      type="submit"
                      disabled={pending.kind === "prompt" && value.trim().length === 0}
                      className={cn(
                        "rounded-full px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50",
                        danger ? "bg-warn-text hover:bg-warn-text/90" : "bg-sage hover:bg-sage-deep",
                      )}
                    >
                      {pending.opts.confirmLabel ?? t("common.confirm")}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </DialogCtx.Provider>
  );
}
