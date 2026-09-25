"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { Sidebar } from "@/components/Sidebar";
import { GuestExperience } from "@/components/GuestExperience";
import { InviteGate } from "@/components/InviteGate";
import { OnboardingGate } from "@/components/OnboardingGate";
import { AchievementWatcher } from "@/components/AchievementWatcher";
import { useViewportVars } from "@/lib/mobileNav";

// Routes that render without the auth gate (session-establishing or public legal).
const PUBLIC_ROUTES = ["/login/verify", "/privacy", "/terms"];

// These are always-mounted overlays but never on the critical path — defer their
// chunks so the first page paints without their JS.
const CommandPalette = dynamic(() => import("@/components/CommandPalette").then((m) => m.CommandPalette), { ssr: false });
const GlobalTutor = dynamic(() => import("@/components/GlobalTutor").then((m) => m.GlobalTutor), { ssr: false });
const SyncStatus = dynamic(() => import("@/components/SyncStatus").then((m) => m.SyncStatus), { ssr: false });
const BugReport = dynamic(() => import("@/components/BugReport").then((m) => m.BugReport), { ssr: false });

// Gates the app behind login. Until the session check finishes we show a light
// loading state; signed-out users get the login screen; signed-in users get the
// full sidebar + content shell.
export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, authed, profile } = useAccount();
  const { t } = useI18n();
  const pathname = usePathname();
  useViewportVars();

  // Public routes (e.g. the email-verify landing) render without the gate.
  if (PUBLIC_ROUTES.some((r) => pathname?.startsWith(r))) return <>{children}</>;

  if (!ready)
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper">
        <span className="text-sm text-ink-soft">{t("common.loading")}</span>
      </main>
    );

  if (!authed) return <GuestExperience />;

  // Closed beta: a signed-in user who hasn't redeemed an invite code is gated here
  // (the backend enforces the same rule on every /api route).
  if (!profile?.invited) return <InviteGate />;

  return (
    <OnboardingGate>
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 bg-paper">
        <div className="mx-auto max-w-[1040px] px-4 py-6 pb-24 sm:px-10 sm:py-10 md:pb-12">
          {children}
        </div>
      </main>
      <CommandPalette />
      <AchievementWatcher />
      {/* the /mika page is the full-size tutor — no floating copy on top of it */}
      {!pathname?.startsWith("/mika") && <GlobalTutor />}
      <SyncStatus />
      <BugReport />
    </div>
    </OnboardingGate>
  );
}
