# Workspace Access & Security Rules

You are operating in Full Access mode, but you must strictly follow these boundaries.

## 1. Workspace Isolation

- Treat the current project directory as your **only authorized workspace**.
- You may freely read, create, modify, move, and delete files **inside the project directory**.
- Never read, modify, delete, or explore files outside the project directory unless I explicitly authorize it.
- Do not access personal files, browser profiles, SSH keys, credentials, or unrelated repositories.
- Do not follow symlinks or other paths that lead outside the project workspace.

## 2. Internet & CLI Access

- You have full permission to use the internet for development purposes.
- You may execute CLI commands, install dependencies, use package managers, download documentation, access public APIs, and run development tools.
- You may use Git, npm, pnpm, pip, Docker, and other necessary development tools.
- Network access does not grant permission to upload private files, credentials, or project secrets.
- Do not execute remote installation scripts without inspecting them first.

## 3. System Protection

- Never modify system settings, environment variables outside the project, global configurations, or files in the user's home directory.
- Avoid global package installations. Prefer project-local dependencies and environments.
- Never run destructive commands targeting anything outside the project.
- Do not interact with unrelated processes, applications, or services.

## 4. Autonomous Development

- Work autonomously within these boundaries without requesting approval for routine development tasks.
- You may research solutions online, install project dependencies, run tests, debug code, and modify project files.
- If an operation requires accessing or modifying anything outside the project directory, stop and ask for explicit permission.
- Never interpret Full Access as permission to bypass these restrictions.

## 5. Priority

These restrictions apply throughout the entire session, regardless of task complexity. If a task conflicts with these rules, explain the conflict and request permission before proceeding.

## Project workflow inherited from Claude

Read and follow the project-root [CLAUDE.md](CLAUDE.md) at the start of each session. It is the shared source of project architecture, commands, coding conventions, verification requirements, and commit/push rules for both Claude and Codex. The workspace and security boundaries above take priority over any conflicting project guidance.

- Continue the current unfinished task before starting another. For new backlog work, use the ordered list in [BACKLOG.md](BACKLOG.md) and the workflow in [.claude/commands/task.md](.claude/commands/task.md).
- Match existing code style; use Qwen via Bailian only; keep new UI text in English, Russian, and Chinese. Use the existing Lucide icons instead of system emoji.
- Russian is the primary product language and audience. Write and review Russian copy first, prioritize Russian learner flows and screenshots, then adapt English and Chinese to the same meaning.
- Change landing copy, layout and screenshots only when the user explicitly asks for landing work. Do not automatically start a final landing pass after bugs are fixed. When the user asks what is next, you may remind them about the deferred landing work. This preference persists across sessions (confirmed 2026-10-19).
- Verify learner-facing work by running the complete flow on the local app. Run the relevant checks and builds; never test against production data.
- Keep changes focused, preserve unrelated work, and stage files explicitly. Update the relevant backlog and idea status when finished.
- Use plain commit messages without a Co-Authored-By trailer. Follow CLAUDE.md's standing instruction to push finished, verified work to main during the solo phase, subject to the workspace boundaries above.
- Prefer project-local tools. Do not read Claude's files outside this workspace unless explicitly authorized for that task.
