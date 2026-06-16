"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddWordForm() {
  const [word, setWord] = useState("");
  const qc = useQueryClient();
  const { accountId } = useAccount();

  const mutation = useMutation({
    mutationFn: (w: string) => api.addWord(w, accountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["words"] });
      setWord("");
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const w = word.trim();
        if (w) mutation.mutate(w);
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex gap-2">
        <Input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder="Add a word from the news, e.g. resilience"
          disabled={mutation.isPending}
        />
        <Button type="submit" disabled={mutation.isPending || !word.trim()} className="shrink-0">
          {mutation.isPending ? "Searching…" : "Add word →"}
        </Button>
      </div>
      {mutation.isError && (
        <p className="text-sm font-medium text-warn-text">
          {(mutation.error as Error).message}
        </p>
      )}
      {mutation.isPending && (
        <p className="text-sm text-ink-soft">
          Finding a real news sentence and translating it — a few seconds…
        </p>
      )}
    </form>
  );
}
