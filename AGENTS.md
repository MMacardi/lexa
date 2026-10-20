# Onomika — shared Codex and Claude instructions

## Workspace and security
- Only this project directory is authorized. Read/create/change/move/delete freely here;
  ask explicitly before accessing anything outside it, including through symlinks.
  Never explore personal files, browser profiles, SSH keys, credentials, unrelated
  repositories, processes, applications, or services.
- Internet, development CLIs, package managers, Docker, downloads, public APIs, dependency
  installation, tests, and debugging are allowed. Never upload private files/secrets.
  Inspect remote installation scripts before execution. Prefer project-local dependencies;
  avoid global installs. Never modify system settings, global configuration, environment
  variables outside the project, or home-directory files, or run destructive commands outside it.
- Work autonomously inside these boundaries. Explain conflicts and request permission for
  outside access. Full Access never overrides these rules; they apply throughout the session
  and take priority over conflicting project guidance.

## Sessions and context
- This file is the shared source of rules; `CLAUDE.md` only imports it. If already supplied
  in context, do not reread either file. Start with `SESSION.md` and `git status --short`.
- The user's explicit task takes priority; otherwise resume the active handoff task first.
  For new backlog work, take the first incomplete item in `BACKLOG.md` **Open**, in order
  (some lack checkboxes). Locate its heading with `rg -n`; read only that item/plan section.
  If time/data/a decision blocks it, leave it open and ask before skipping it.
- One focused task per session by default; related fixes can stay together. Do not start
  another item automatically. Read `.claude/commands/task.md` when implementing, not at startup.
- Keep `SESSION.md` under 30 lines: task, relevant files/plan section, decisions, checks run,
  remaining steps/blockers. Update before stopping; replace completed notes, never grow a
  history. Check notes against Git rather than assuming they are current.
- Search before reading; bound output. Skip dependencies, build output, lockfiles, large
  datasets, full browser snapshots, and unrelated docs. Search `IDEAS.md`/`STRATEGY.md` by
  heading; never read them or the backlog whole. Keep replies concise; do not repeat checks
  without changes/failures. Do not delegate unless explicitly requested.

## Product and code
- Onomika: Russian speakers learning Chinese; web + Telegram `@onomikabot`. CEDICT first,
  AI only for dictionary gaps.
  Instant cards, FSRS, daily HSK words, Reader, Mika. Test before progress claims; choose
  frequent words built from known characters, one situation at a time, with level-fit examples.
  No mock HSK exams; IELTS later. Hide out-of-focus features, do not delete them.
  Coach/scenes/readiness expansion waits for the backlog's two-week self-test.
  Sole-author university project; no defence materials needed.
- Backend: Express, Prisma/Postgres, TypeScript ESM; `backend/src/index.ts` entry,
  `routes/` HTTP, `services/` logic, `agents/` prompts, `lib/` helpers; `bot/index.ts`
  runs Telegraf in-process with `ENABLE_TELEGRAM_BOT=true`.
- Frontend: Next.js 15 App Router, Tailwind 4, TanStack Query. `frontend/lib/api.ts` is
  the typed API client, `lib/i18n.tsx` ru/en/zh, `app/` pages, `components/` UI.
- Qwen via Bailian only (`backend/src/services/llm.ts`, OpenAI SDK). Every `/api` route
  needs session + invite (`lib/gate.ts`); identity only from session cookie, never
  body/query `telegramId`. Match existing style/comment density; use Lucide, not system emoji.
- Russian copy/learner flows first; adapt every new UI string to English and Chinese.
  Landing copy/layout/screenshots, including a final pass, require explicit request.
  Mention deferred landing work when asked what is next; never start it automatically.

## Verify and finish
- Local: `docker compose up -d` → frontend :3001, API :3000, Postgres host **5433**.
  Never test with production data. Browser tools/profiles/artifacts stay inside this project.
- Code: backend `npx tsc --noEmit -p .`; frontend `npx next build`, from each directory.
  Verify the changed behavior locally with a focused check; builds alone do not prove
  behavior. For learner UI changes, use one relevant phone/browser spot-check by default.
  Regression, phone, chat and migration commands: `.claude/commands/task.md`.
- Keep testing proportional unless the user asks for a broader pass. Run required checks
  once after the final code changes; do not default to screenshot sweeps, full browser/device
  matrices, unrelated regression suites, or redundant tests at several layers. Screenshots
  are for visual changes or diagnosing a visual bug, not routine proof of completion.
- Expand verification only for a concrete risk or observed failure (such as auth, data
  safety, offline behavior, or a browser-specific bug), using the smallest check that
  resolves it. Fix test-harness problems and rerun only the affected check. Once relevant
  checks pass, stop testing; repeat only for new changes or an unresolved failure.
- Docs-only: check diffs, references, consistency; no app builds needed.
- Preserve unrelated work; stage explicit files. Update relevant backlog/idea status and
  `SESSION.md`. Plain commits named by task title, no Co-Authored-By. Until beta testers arrive, push
  finished, verified work to `main` without asking (prod auto-deploys), within workspace rules.

## On-demand references
`BACKLOG.md`: ordered work · `IDEAS.md`: details/history · `STRATEGY.md`: rationale/triage ·
`DEPLOY.md`: Railway/Vercel · `BETA_CHECKLIST.md`: launch · `UNIT_ECONOMICS.md`: costs.
`onomika_old` holds the full build; do not access it if outside this workspace.
