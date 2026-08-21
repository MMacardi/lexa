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
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AccountCtx>({
  accountId: "",
  profile: null,
  authed: false,
  ready: false,
  loginDev: async () => {},
  loginTelegram: async () => {},
  refresh: async () => {},
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
      setReady(true);
      return;
    } catch {
      /* not signed in yet — maybe we're inside a Telegram Mini App */
    }
    // Inside Telegram, sign in automatically with the WebApp initData.
    const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
    if (tg?.initData) {
      try {
        const me = await api.loginTelegramWebApp(tg.initData);
        setAccountId(me.telegramId);
        setProfile(me);
        setReady(true);
        return;
      } catch {
        /* fall through to signed-out */
      }
    }
    setAccountId("");
    setProfile(null);
    setReady(true);
  }, []);

  useEffect(() => {
    // Tell Telegram the Mini App is ready and let it use the full height.
    const tg = (window as unknown as { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } }).Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
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
      value={{ accountId, profile, authed: !!accountId, ready, loginDev, loginTelegram, refresh, logout }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAccount = () => useContext(Ctx);
