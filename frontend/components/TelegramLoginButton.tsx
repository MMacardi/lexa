"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "@/lib/account";

// Injects the official Telegram Login Widget. Requires the bot's domain to be
// set in BotFather (/setdomain) to this site's domain — so it only works on the
// deployed public URL, not localhost (use the dev login there).
const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "";

export function TelegramLoginButton() {
  const ref = useRef<HTMLDivElement>(null);
  const { loginTelegram } = useAccount();

  useEffect(() => {
    (window as unknown as { onTelegramAuth?: (u: Record<string, unknown>) => void }).onTelegramAuth =
      (user) => {
        loginTelegram(user).catch(() => {});
      };
    if (!BOT_USERNAME || !ref.current) return;
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", BOT_USERNAME);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "12");
    s.setAttribute("data-onauth", "onTelegramAuth(user)");
    s.setAttribute("data-request-access", "write");
    const node = ref.current;
    node.appendChild(s);
    return () => {
      node.innerHTML = "";
    };
  }, [loginTelegram]);

  if (!BOT_USERNAME) {
    return (
      <p className="text-center text-sm text-ink-soft">
        Telegram login isn&apos;t configured here. Use the dev sign-in below.
      </p>
    );
  }
  return <div ref={ref} className="flex justify-center" />;
}
