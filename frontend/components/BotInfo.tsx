"use client";

import { useI18n } from "@/lib/i18n";
import { Repeat2, MessageCircle, Bell, Smartphone, Send, type LucideIcon } from "lucide-react";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "";

// A plain-language card explaining what the Telegram bot can do, so its features
// are discoverable from the website (not just by poking at the bot in Telegram).
export function BotInfo() {
  const { t } = useI18n();
  if (!BOT_USERNAME) return null;

  const features: { Icon: LucideIcon; key: string }[] = [
    { Icon: Repeat2, key: "bot.featReview" },
    { Icon: MessageCircle, key: "bot.featChat" },
    { Icon: Bell, key: "bot.featRemind" },
    { Icon: Smartphone, key: "bot.featMiniApp" },
  ];

  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("bot.title")}</h2>
      <p className="mt-1 text-[13px] leading-snug text-ink-soft">{t("bot.intro")}</p>

      <ul className="mt-4 space-y-2.5">
        {features.map((f) => (
          <li key={f.key} className="flex items-start gap-2.5">
            <f.Icon className="mt-0.5 h-[17px] w-[17px] shrink-0 text-sage-deep" />
            <span className="text-[14px] leading-snug text-ink">{t(f.key)}</span>
          </li>
        ))}
      </ul>

      <a
        href={`https://t.me/${BOT_USERNAME}`}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#229ED9] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#1c8ac0]"
      >
        <Send className="h-4 w-4" /> {t("bot.open")} @{BOT_USERNAME}
      </a>
    </section>
  );
}
