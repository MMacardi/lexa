"use client";

import { createContext, useCallback, useContext, useState } from "react";

export interface Toast {
  id: number;
  icon: string;
  title: string;
  subtitle?: string;
  tone?: "achievement" | "goal";
}

type ShowInput = Omit<Toast, "id">;

const ToastCtx = createContext<{ show: (t: ShowInput) => void }>({ show: () => {} });
export const useToast = () => useContext(ToastCtx);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<(Toast & { leaving?: boolean })[]>([]);

  const remove = useCallback((id: number) => {
    // play the exit animation, then unmount
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 280);
  }, []);

  const show = useCallback(
    (t: ShowInput) => {
      const id = ++counter;
      setToasts((list) => [...list, { ...t, id }]);
      setTimeout(() => remove(id), 4600);
    },
    [remove],
  );

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[330px] max-w-[calc(100vw-2rem)] flex-col gap-2.5">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({
  toast,
  onClose,
}: {
  toast: Toast & { leaving?: boolean };
  onClose: () => void;
}) {
  const goal = toast.tone === "goal";
  return (
    <div
      onClick={onClose}
      className={`pointer-events-auto cursor-pointer overflow-hidden rounded-[18px] border border-black/[0.07] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.22)] ${
        toast.leaving ? "anim-toast-out" : "anim-toast-in"
      }`}
    >
      {/* top shimmer accent bar */}
      <div
        className="h-1 w-full"
        style={{
          background: goal
            ? "linear-gradient(90deg,#c09180,#e0b58f,#c09180)"
            : "linear-gradient(90deg,#7c9885,#a9c6b0,#7c9885)",
          backgroundSize: "220% 100%",
          animation: "lexaShine 1.8s linear infinite",
        }}
      />
      <div className="flex items-center gap-3.5 p-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[24px] ${
            goal ? "bg-warn-bg" : "bg-sage-tint"
          }`}
        >
          {toast.icon}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-faint">
            {goal ? "Daily goal" : "Achievement unlocked"}
          </div>
          <div className="truncate font-serif text-[18px] font-semibold leading-tight text-ink">
            {toast.title}
          </div>
          {toast.subtitle && (
            <div className="truncate text-[13px] text-ink-soft">{toast.subtitle}</div>
          )}
        </div>
      </div>
    </div>
  );
}
