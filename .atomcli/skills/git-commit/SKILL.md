---
name: Git Commit
description: Structured workflow for staging, committing, and verifying git changes safely
location: .atomcli/skills/git-commit/SKILL.md
---

# Git Commit Workflow

When the user asks you to create a git commit, follow this protocol. Only create commits when explicitly requested. If unclear, ask first.

## Git Safety Rules

- NEVER update the git config
- NEVER run destructive/irreversible git commands (push --force, hard reset) unless explicitly requested
- NEVER skip hooks (--no-verify, --no-gpg-sign) unless explicitly requested
- NEVER force push to main/master — warn the user if they request it
- NEVER commit unless the user explicitly asks
- NEVER use interactive flags (-i) — they require input which is not supported
- Do not commit files that likely contain secrets (.env, credentials.json, etc.)

## Amend Rules

Avoid `git commit --amend`. ONLY use when ALL conditions are met:
1. User explicitly requested amend, OR commit SUCCEEDED but pre-commit hook auto-modified files
2. HEAD commit was created by you in this conversation (verify: `git log -1 --format='%an %ae'`)
3. Commit has NOT been pushed to remote (verify: `git status` shows "Your branch is ahead")

CRITICAL: If commit FAILED or was REJECTED by hook → NEVER amend. Fix the issue and create a NEW commit.
CRITICAL: If already pushed to remote → NEVER amend unless user explicitly requests it.

## Workflow Steps

### Step 1 — Assess (parallel)
Run these in parallel:
- `git status` — see untracked and modified files
- `git diff --staged && git diff` — see staged and unstaged changes
- `git log --oneline -5` — see recent commit style

### Step 2 — Draft Message
- Summarize the nature of changes (new feature, enhancement, bug fix, refactoring, test, docs)
- Focus on the "why" rather than the "what"
- Match the repository's commit message style
- Keep it concise (1-2 sentences)

### Step 3 — Commit (sequential)
- Stage relevant files: `git add <files>`
- Create the commit: `git commit -m "<message>"`
- Verify: `git status`

Note: `git status` depends on the commit completing — run it after the commit.

### Step 4 — Handle Failure
If the commit fails due to pre-commit hook:
- Fix the issue
- Create a NEW commit (do NOT amend — see amend rules above)

## Important
- NEVER run additional commands to read or explore code during commit workflow
- NEVER use the TodoWrite or Task tools during commit
- Do NOT push to remote unless the user explicitly asks
- If there are no changes to commit, do not create an empty commit
