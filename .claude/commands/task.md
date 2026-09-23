---
description: Do one BACKLOG focus-pass item end to end
argument-hint: F0 | F1 | F2 … (or the item's name)
---

Work **one** backlog item: **$ARGUMENTS**

1. Read that item in `BACKLOG.md` (and only that item). If its intent is unclear, grep
   `STRATEGY.md` for the matching row in §G — don't read either file whole.
2. Grep before reading, and read only the line ranges you need.
3. Implement it. Match the surrounding code style and comment density. Every new UI
   string goes in en/ru/zh (`frontend/lib/i18n.tsx`).
4. Verify: `cd backend && npx tsc --noEmit -p .` and `cd frontend && npx next build`.
   If the item touches the schema, say what the migration does before running it.
5. Tick the item in `BACKLOG.md`, commit with a plain message (no Co-Authored-By trailer),
   push to `main`, then stop — one item per session.

Rules for this item:
- **Don't expand scope.** If you find something else worth doing, add a line to
  `BACKLOG.md`/`IDEAS.md` instead of doing it now.
- If the item turns out to need a decision the backlog doesn't answer, stop and ask
  rather than guessing.
- Hide things behind the focus flag; don't delete. `onomika_old` holds the full build.

Effort (set the slider before starting):
| Item | Effort |
|---|---|
| F0 metadata/og/locale, F8 pickers | low–medium — mechanical |
| F1 analytics, F7 focus flag | medium |
| F4 HSK lists + readiness, F5 onboarding, F6 CC-CEDICT senses, F9 bot identity | high |
| F2 review log + server-side prefs, F3 production state | **xhigh / Ultracode** — schema, one-way door, can't be backfilled |

Run `/code-review` before pushing F2 and F3.
