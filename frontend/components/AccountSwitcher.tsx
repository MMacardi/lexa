"use client";

import { useEffect, useState } from "react";
import { useAccount } from "@/lib/account";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// View a specific account's words by Telegram ID (no login). The bot stores
// words under each sender's real Telegram ID; type one here to view it.
export function AccountSwitcher() {
  const { accountId, setAccountId } = useAccount();
  const [draft, setDraft] = useState(accountId);

  useEffect(() => setDraft(accountId), [accountId]);

  const changed = draft.trim().length > 0 && draft.trim() !== accountId;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (changed) setAccountId(draft);
      }}
      className="flex items-center gap-2"
    >
      <label className="whitespace-nowrap text-sm font-medium text-ink-soft">Account</label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="dev-user"
        className="h-9 max-w-[200px]"
      />
      <Button type="submit" size="sm" variant="outline" disabled={!changed}>
        Switch
      </Button>
    </form>
  );
}
