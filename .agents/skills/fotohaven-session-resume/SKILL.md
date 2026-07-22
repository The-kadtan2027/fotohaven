---
name: fotohaven-session-resume
description: >
  Resumes dev work on FotoHaven by reading CLAUDE.md & AGENTS.md, running
  type check (npx tsc --noEmit) and git status, reporting codebase health,
  and proposing the next roadmap task. Trigger when starting a new session on FotoHaven.
---

# FotoHaven Session Resume Protocol

This skill bootstraps and resumes a development session for the **FotoHaven** project. It reloads architectural context, audits roadmap task progress, verifies TypeScript compiler health, checks git working tree state, and proposes the next action before waiting for developer approval.

## Protocol Steps

### 1. Context Reload
Read [CLAUDE.md](file:///d:/antigravity/files/fotohaven/CLAUDE.md) using the `view_file` tool to load:
- Project summary and core architecture.
- Exact package versions and stack details.
- Repository structure and data model references.
- Android/Termux, WAL SQLite, and ARM hosting rules.

### 2. Roadmap & Task Audit
Read [AGENTS.md](file:///d:/antigravity/files/fotohaven/AGENTS.md) using `view_file` to audit:
- Completed tasks (`Status: Completed` / all `[x]` criteria).
- Partially completed or planned tasks (`Status: Planned` or mixed `[ ]` / `[x]` criteria).

### 3. Type Safety Verification
Run `npx tsc --noEmit` in the workspace root directory using `run_command`:
- Capture any type errors.
- If type errors exist, log them clearly in the final summary report as potential blockers.

### 4. Git Working Tree Audit
Run `git status` in the workspace root directory using `run_command`:
- Identify active branch.
- Identify modified, staged, or untracked files.

### 5. Session Report & Progression Proposal
Synthesize all collected context into a clear, structured report covering:
1. **Last Completed & Active Task:** Highlighting current task state from `AGENTS.md`.
2. **Codebase Health:** Reporting TypeScript compiler error status (`0 errors` or list of errors) and `git status` summary (branch name and changed files).
3. **Logical Next Step:** Proposing the exact next task from `AGENTS.md`.

### 6. Developer Confirmation Gate
**PAUSE execution and wait for explicit developer confirmation** before modifying code or running build/deployment scripts.

## Common Pitfalls
- **Skipping context reload:** Do not attempt to write code or make edits without checking `CLAUDE.md` and `AGENTS.md` first.
- **Auto-executing edits:** Never start working on the proposed next task without waiting for the user's explicit confirmation.
- **Ignoring type errors:** Always report any `tsc` errors upfront before moving to new feature tasks.
