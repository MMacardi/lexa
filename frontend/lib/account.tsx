"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, type Profile } from "@/lib/api";
import { syncLearnerPrefs } from "@/lib/learnPrefs";

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
  /** Apply a change locally right away (optimistic), before the server confirms. */
  patchProfile: (patch: Partial<Profile>) => void;
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
  patchProfile: () => {},
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

  // Reconcile the locally mirrored learner settings (level, native language,
  // goal, retention) with the account, once per sign-in.
  useEffect(() => {
    if (profile?.telegramId) syncLearnerPrefs(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.telegramId]);

  const loginDev = async (id: string) => {
    await api.loginDev(id.trim());
    // The dev endpoint only returns { telegramId }; load the full profile (incl.
    // the `invited` beta-gate flag) from /auth/me so the gate sees the real value.
    await refresh();
  };
  const loginTelegram = async (data: Record<string, unknown>) => {
    const r = await api.loginTelegram(data);
    setAccountId(r.telegramId);
    setProfile(r);
  };
  const patchProfile = useCallback((patch: Partial<Profile>) => {
    setProfile((p) => (p ? { ...p, ...patch } : p));
  }, []);
  const logout = async () => {
    await api.logout();
    setAccountId("");
    setProfile(null);
  };

  return (
    <Ctx.Provider
      value={{ accountId, profile, authed: !!accountId, ready, loginDev, loginTelegram, refresh, patchProfile, logout }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAccount = () => useContext(Ctx);
