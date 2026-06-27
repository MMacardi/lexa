"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

// Auth-backed account context. The "account" is now the logged-in Telegram user
// (verified via the Telegram Login Widget, or the dev shortcut locally), stored
// server-side in a session cookie — no more free-text account stub.
type AccountCtx = {
  accountId: string; // logged-in Telegram id, or "" when signed out
  authed: boolean;
  ready: boolean; // initial /me check finished
  loginDev: (id: string) => Promise<void>;
  loginTelegram: (data: Record<string, unknown>) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AccountCtx>({
  accountId: "",
  authed: false,
  ready: false,
  loginDev: async () => {},
  loginTelegram: async () => {},
  logout: async () => {},
});

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accountId, setAccountId] = useState("");
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setAccountId(me.telegramId);
    } catch {
      setAccountId("");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loginDev = async (id: string) => {
    const r = await api.loginDev(id.trim());
    setAccountId(r.telegramId);
  };
  const loginTelegram = async (data: Record<string, unknown>) => {
    const r = await api.loginTelegram(data);
    setAccountId(r.telegramId);
  };
  const logout = async () => {
    await api.logout();
    setAccountId("");
  };

  return (
    <Ctx.Provider
      value={{ accountId, authed: !!accountId, ready, loginDev, loginTelegram, logout }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAccount = () => useContext(Ctx);
