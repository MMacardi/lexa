"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, isAccessError, type Profile } from "@/lib/api";
import { HSK_TARGET_EVT, mirrorHsk, syncLearnerPrefs } from "@/lib/learnPrefs";
import { clearAccountSnapshot, readAccountSnapshot, saveAccountSnapshot } from "./accountSnapshot";
import { clearAccountCache, scopeLegacyOutbox } from "./idb";
import { readWordsCache } from "./sync";
import { ACCESS_REVOKED, CONNECTION_FAILED, LOGOUT_PENDING_KEY, SNAPSHOT_KEY, cacheScope, setCacheScope } from "./sessionCache";

type Connection = "checking" | "online" | "reconnecting" | "offline";
type AccountCtx = {
  accountId: string;
  profile: Profile | null;
  authed: boolean; // also true for a cached display identity; never server authorization
  verified: boolean;
  ready: boolean;
  connection: Connection;
  loginDev: (id: string) => Promise<void>;
  loginTelegram: (data: Record<string, unknown>) => Promise<void>;
  refresh: () => Promise<void>;
  patchProfile: (patch: Partial<Profile>) => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<AccountCtx>({
  accountId: "", profile: null, authed: false, verified: false, ready: false, connection: "checking",
  loginDev: async () => {}, loginTelegram: async () => {}, refresh: async () => {}, patchProfile: () => {}, logout: async () => {},
});

function logoutPending() {
  try { return localStorage.getItem(LOGOUT_PENDING_KEY) === "1"; } catch { return false; }
}
function markLogout(pending: boolean) {
  try {
    if (pending) localStorage.setItem(LOGOUT_PENDING_KEY, "1");
    else localStorage.removeItem(LOGOUT_PENDING_KEY);
  } catch { /* storage unavailable */ }
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [verified, setVerified] = useState(false);
  const [connection, setConnection] = useState<Connection>("checking");
  const current = useRef<Profile | null>(null);
  const sequence = useRef(0);
  const needsRetry = useRef(true);
  const logoutAttempt = useRef<ReturnType<typeof api.logout> | null>(null);

  const finishLogout = useCallback(async () => {
    const pending = logoutAttempt.current ?? api.logout();
    logoutAttempt.current = pending;
    try {
      await pending;
      markLogout(false);
    } finally {
      if (logoutAttempt.current === pending) logoutAttempt.current = null;
    }
  }, []);

  const clear = useCallback(async (removeSnapshot = true) => {
    sequence.current++;
    const owner = cacheScope().owner;
    setCacheScope("", false);
    current.current = null;
    if (removeSnapshot) clearAccountSnapshot();
    void qc.cancelQueries();
    qc.clear();
    setProfile(null);
    setVerified(false);
    if (owner) await clearAccountCache(owner);
  }, [qc]);

  const accept = useCallback(async (me: Profile) => {
    const owner = cacheScope().owner;
    if (owner && (owner !== me.telegramId || !me.invited)) {
      const cleanup = clear();
      const request = sequence.current;
      await cleanup;
      if (request !== sequence.current) return;
    }
    const request = sequence.current;
    await scopeLegacyOutbox(me.telegramId);
    if (request !== sequence.current) return;
    setCacheScope(me.telegramId, true);
    current.current = me;
    if (me.invited) saveAccountSnapshot(me);
    else clearAccountSnapshot();
    setProfile(me);
    setVerified(true);
    setReady(true);
    setConnection("online");
    needsRetry.current = false;
    const token = cacheScope().revision;
    void readWordsCache(me.telegramId).then((words) => {
      if (words && token === cacheScope().revision && !qc.getQueryData(["words", me.telegramId])) qc.setQueryData(["words", me.telegramId], words);
    });
    // A cached IndexedDB read may still be pending when /me wins the race.
    // Cancel it first so invalidation starts a fresh, verified network read.
    void qc.cancelQueries().then(() => qc.invalidateQueries());
  }, [clear, qc]);

  const refresh = useCallback(async () => {
    let request = ++sequence.current;
    if (current.current) {
      setCacheScope(current.current.telegramId, false);
      setVerified(false);
    }
    setConnection(navigator.onLine ? "reconnecting" : "offline");
    try {
      if (logoutPending()) {
        await finishLogout();
        if (request !== sequence.current) return;
        needsRetry.current = false;
        setConnection("online");
        setReady(true);
        return;
      }
      let me: Profile;
      try {
        me = await api.me();
      } catch (error) {
        if (request !== sequence.current) return;
        if (!isAccessError(error)) throw error;
        await clear();
        request = sequence.current;
        const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
        if (tg?.initData && (error as { status: number }).status === 401) {
          me = await api.loginTelegramWebApp(tg.initData);
        } else {
          setConnection("online");
          needsRetry.current = false;
          setReady(true);
          return;
        }
      }
      if (request !== sequence.current) return;
      await accept(me);
    } catch (error) {
      if (request !== sequence.current) return;
      if (isAccessError(error)) {
        await clear();
        setConnection("online");
        needsRetry.current = false;
      } else {
        needsRetry.current = true;
        setConnection(navigator.onLine ? "reconnecting" : "offline");
      }
      setReady(true);
    }
  }, [accept, clear, finishLogout]);

  useEffect(() => {
    const tg = (window as unknown as { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } }).Telegram?.WebApp;
    tg?.ready?.(); tg?.expand?.();
    const cached = logoutPending() ? null : readAccountSnapshot();
    if (cached) {
      setCacheScope(cached.telegramId, false);
      current.current = cached;
      setProfile(cached);
      setReady(true);
      void readWordsCache(cached.telegramId).then((words) => {
        if (words && cacheScope().owner === cached.telegramId && !qc.getQueryData(["words", cached.telegramId])) qc.setQueryData(["words", cached.telegramId], words);
      });
    }
    void refresh();
    const onOnline = () => void refresh();
    const onOffline = () => {
      if (current.current) setCacheScope(current.current.telegramId, false);
      setVerified(false);
      needsRetry.current = true;
      setConnection("offline");
    };
    const onFailure = () => { needsRetry.current = true; setConnection(navigator.onLine ? "reconnecting" : "offline"); };
    const onRevoked = () => { void clear(); setReady(true); setConnection("online"); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SNAPSHOT_KEY && readAccountSnapshot()?.telegramId !== current.current?.telegramId) {
        void clear(false).then(refresh);
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(CONNECTION_FAILED, onFailure);
    window.addEventListener(ACCESS_REVOKED, onRevoked);
    window.addEventListener("storage", onStorage);
    const timer = setInterval(() => { if (navigator.onLine && needsRetry.current) void refresh(); }, 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(CONNECTION_FAILED, onFailure);
      window.removeEventListener(ACCESS_REVOKED, onRevoked);
      window.removeEventListener("storage", onStorage);
      clearInterval(timer);
    };
  }, [clear, qc, refresh]);

  useEffect(() => {
    if (verified && profile?.telegramId) syncLearnerPrefs(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, profile?.telegramId]);
  useEffect(() => {
    if (profile) mirrorHsk(profile.hskTarget, profile.hskVersion);
  }, [profile?.hskTarget, profile?.hskVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (profile?.invited && verified) saveAccountSnapshot(profile);
  }, [profile, verified]);

  useEffect(() => {
    const onTarget = (e: Event) => {
      setProfile((p) => (p ? { ...p, hskTarget: (e as CustomEvent<number>).detail } : p));
      for (const key of ["hskPlan", "hskReadiness", "hskDaily", "topicDaily"]) void qc.invalidateQueries({ queryKey: [key] });
    };
    window.addEventListener(HSK_TARGET_EVT, onTarget);
    return () => window.removeEventListener(HSK_TARGET_EVT, onTarget);
  }, [qc]);

  const loginDev = async (id: string) => {
    await clear(false);
    const request = sequence.current;
    await api.loginDev(id.trim());
    clearAccountSnapshot();
    const me = await api.me();
    if (request === sequence.current) await accept(me);
  };
  const loginTelegram = async (data: Record<string, unknown>) => {
    await clear(false);
    const request = sequence.current;
    const me = await api.loginTelegram(data);
    if (request === sequence.current) await accept(me);
  };
  const patchProfile = useCallback((patch: Partial<Profile>) => {
    setProfile((p) => (p ? { ...p, ...patch } : p));
  }, []);
  const logout = async () => {
    markLogout(true);
    setConnection(navigator.onLine ? "reconnecting" : "offline");
    await clear();
    setReady(true);
    try {
      await finishLogout();
      needsRetry.current = false;
      setConnection("online");
    } catch {
      needsRetry.current = true;
      setConnection(navigator.onLine ? "reconnecting" : "offline");
    }
  };

  return (
    <Ctx.Provider value={{ accountId: profile?.telegramId ?? "", profile, authed: !!profile, verified, ready, connection, loginDev, loginTelegram, refresh, patchProfile, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAccount = () => useContext(Ctx);
