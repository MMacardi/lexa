"use client";

import { useState } from "react";
import { useAccount } from "@/lib/account";
import { TelegramLoginButton } from "@/components/TelegramLoginButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginScreen() {
  const { loginDev } = useAccount();
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function dev() {
    if (!id.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await loginDev(id.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="anim-pop w-full max-w-[420px] rounded-[24px] border border-black/[0.06] bg-surface p-8 text-center shadow-sm">
        <div className="flex items-center justify-center gap-2">
          <span className="font-serif text-[30px] font-semibold text-ink">Lexa</span>
          <span className="h-2 w-2 rounded-full bg-sage" />
        </div>
        <p className="mt-2 text-ink-soft">Learn English through the news. Sign in to start.</p>

        <div className="mt-7">
          <TelegramLoginButton />
        </div>

        <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          <span className="h-px flex-1 bg-black/[0.08]" />
          dev sign-in
          <span className="h-px flex-1 bg-black/[0.08]" />
        </div>

        <div className="flex gap-2">
          <Input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="Telegram ID (e.g. 865277762)"
            onKeyDown={(e) => e.key === "Enter" && dev()}
          />
          <Button onClick={dev} disabled={busy || !id.trim()} className="shrink-0">
            {busy ? "…" : "Enter"}
          </Button>
        </div>
        {err && <p className="mt-2 text-sm text-warn-text">{err}</p>}
        <p className="mt-4 text-xs text-ink-faint">
          The dev sign-in is for local testing; production uses Telegram login.
        </p>
      </div>
    </main>
  );
}
