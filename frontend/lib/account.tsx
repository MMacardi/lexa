"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_TELEGRAM_ID } from "@/lib/api";

// The web app has no login, so "which account am I viewing" is a client-side
// choice persisted in localStorage. The Telegram bot keys words by the sender's
// real Telegram ID; here you can type that ID in to view that person's words.

const STORAGE_KEY = "vocab.telegramId";

type AccountCtx = {
  accountId: string;
  setAccountId: (id: string) => void;
};

const Ctx = createContext<AccountCtx>({
  accountId: DEFAULT_TELEGRAM_ID,
  setAccountId: () => {},
});

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accountId, setAccountIdState] = useState(DEFAULT_TELEGRAM_ID);

  // Load the saved account on mount (client only).
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setAccountIdState(saved);
  }, []);

  function setAccountId(id: string) {
    const next = id.trim() || DEFAULT_TELEGRAM_ID;
    localStorage.setItem(STORAGE_KEY, next);
    setAccountIdState(next);
  }

  return <Ctx.Provider value={{ accountId, setAccountId }}>{children}</Ctx.Provider>;
}

export const useAccount = () => useContext(Ctx);
