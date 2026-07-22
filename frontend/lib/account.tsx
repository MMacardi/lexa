"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, type Profile } from "@/lib/api";

// Auth-backed account context. The "account" is now the logged-in Telegram user
// (verified via the Telegram Login Widget, or the dev shortcut locally), stored
// server-side in a session cookie — no more free-text account stub.
type AccountCtx = {
  accountId: string; // logged-in Telegram id, or "" when signed out
  profile: Profile | null;
  authed: boolean;
  ready: boolean; // initial /me check finished
  loginDev: (id: string) => Promise<void>;
  loginTelegram: (data: Record<string, unknown>) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AccountCtx>({
  accountId: "",
  profile: null,
  authed: false,
  ready: false,
  loginDev: async () => {},
  loginTelegram: async () => {},
  logout: async () => {},
});

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accountId, setAccountId] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setAccountId(me.telegramId);
      setProfile(me);
    } catch {
      setAccountId("");
      setProfile(null);
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
    setProfile({ telegramId: r.telegramId, authVia: "dev" });
  };
  const loginTelegram = async (data: Record<string, unknown>) => {
    const r = await api.loginTelegram(data);
    setAccountId(r.telegramId);
    setProfile(r);
  };
  const logout = async () => {
    await api.logout();
    setAccountId("");
    setProfile(null);
  };

  return (
    <Ctx.Provider
      value={{ accountId, profile, authed: !!accountId, ready, loginDev, loginTelegram, logout }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAccount = () => useContext(Ctx);
