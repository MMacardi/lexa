"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { TriangleAlert } from "lucide-react";

// Landing page for the email magic-link. It consumes the token (which sets the
// session cookie), refreshes the account, and sends the user into the app.
export default function EmailVerifyPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-paper" />}>
      <EmailVerify />
    </Suspense>
  );
}

function EmailVerify() {
  const { refresh } = useAccount();
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard StrictMode double-run (token is single-use)
    ran.current = true;
    const token = params.get("token");
    if (!token) {
      setFailed(true);
      return;
    }
    (async () => {
      try {
        await api.verifyEmailLogin(token);
        await refresh();
        router.replace("/");
      } catch {
        setFailed(true);
      }
    })();
  }, [params, refresh, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="anim-pop w-full max-w-[420px] rounded-[24px] border border-black/[0.06] bg-surface p-8 text-center shadow-sm">
        {failed ? (
          <>
            <TriangleAlert className="mx-auto h-8 w-8 text-warn-text" />
            <p className="mt-3 text-ink">{t("login.verifyFailed")}</p>
            <Link href="/" className="mt-4 inline-block font-semibold text-sage hover:text-sage-deep">
              {t("login.backToLogin")}
            </Link>
          </>
        ) : (
          <div className="flex items-center justify-center gap-2 text-ink">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-sage border-t-transparent" />
            {t("login.verifying")}
          </div>
        )}
      </div>
    </main>
  );
}
