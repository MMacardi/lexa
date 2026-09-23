// The testers' chat (BACKLOG "A feedback channel the tester can find"): the bug
// button already reaches the author, but it is one-way — the tester never hears
// back. A Telegram group where the author answers makes a six-week beta a
// conversation. Its invite link is set per deploy; unset, no link shows anywhere.
export const TESTERS_CHAT_URL = /^https:\/\//.test(process.env.NEXT_PUBLIC_TESTERS_CHAT_URL ?? "")
  ? process.env.NEXT_PUBLIC_TESTERS_CHAT_URL!.trim()
  : "";
