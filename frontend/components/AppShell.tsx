"use client";

import { useAccount } from "@/lib/account";
import { Sidebar } from "@/components/Sidebar";
import { LoginScreen } from "@/components/LoginScreen";
import { CommandPalette } from "@/components/CommandPalette";
import { AchievementWatcher } from "@/components/AchievementWatcher";

// Gates the app behind login. Until the session check finishes we show a light
// loading state; signed-out users get the login screen; signed-in users get the
// full sidebar + content shell.
export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, authed } = useAccount();

  if (!ready)
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper">
        <span className="text-sm text-ink-soft">Loading…</span>
      </main>
    );

  if (!authed) return <LoginScreen />;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 bg-paper">
        <div className="mx-auto max-w-[1040px] px-5 py-8 sm:px-10 sm:py-10">{children}</div>
      </main>
      <CommandPalette />
      <AchievementWatcher />
    </div>
  );
}
