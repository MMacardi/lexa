"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTutorChat, type TutorChat } from "@/lib/useTutorChat";

// One Mika conversation for the whole app. The floating panel and the /mika page
// used to run a copy each, synced through sessionStorage when one opened: expanding
// the panel unmounted it, which aborted the answer on its way, and the card a chat
// was about (Explain from a word page) stayed behind in the panel's copy. Now both
// read this one, so an answer keeps coming in across the expand and the card goes
// with it.
type Ctx = {
  chat: TutorChat;
  setPanelOpen: (open: boolean) => void;
  // The last page outside /mika, for the full page's way back.
  lastPath: string | null;
};
const TutorChatCtx = createContext<Ctx | null>(null);

export function TutorChatProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onPage = !!pathname?.startsWith("/mika");
  const [panelOpen, setPanelOpen] = useState(false);
  const chat = useTutorChat({ active: panelOpen || onPage });
  const last = useRef<string | null>(null);
  if (pathname && !onPage) last.current = pathname;
  return (
    <TutorChatCtx.Provider value={{ chat, setPanelOpen, lastPath: last.current }}>{children}</TutorChatCtx.Provider>
  );
}

function useCtx(): Ctx {
  const ctx = useContext(TutorChatCtx);
  if (!ctx) throw new Error("Mika is used outside TutorChatProvider");
  return ctx;
}

export function useSharedTutorChat(): TutorChat {
  return useCtx().chat;
}

export function useTutorLastPath(): string | null {
  return useCtx().lastPath;
}

/** The floating panel reports whether it is open, so the shared chat knows it's in view. */
export function useReportPanelOpen(open: boolean) {
  const { setPanelOpen } = useCtx();
  useEffect(() => {
    setPanelOpen(open);
    return () => setPanelOpen(false);
  }, [open, setPanelOpen]);
}
