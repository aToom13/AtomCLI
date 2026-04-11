---
name: GitHub PR
description: Structured workflow for creating GitHub Pull Requests using gh CLI
location: .atomcli/skills/github-pr/SKILL.md
---

# GitHub Pull Request Workflow

Use the `gh` command via Bash for ALL GitHub-related tasks including issues, pull requests, checks, and releases. If given a GitHub URL, use `gh` to get the information needed.

## Workflow Steps

### Step 1 — Assess (parallel)
Run these in parallel to understand the branch state since it diverged from main:
- `git status` — see untracked files
- `git diff` — see staged and unstaged changes
- Check if current branch tracks a remote and is up to date
- `git log --oneline main..HEAD` and `git diff main...HEAD` — full commit history and diff

### Step 2 — Draft PR Summary
Analyze ALL commits that will be included (not just the latest) and draft:
- Title: concise, descriptive
- Body: summary of changes as bullet points

### Step 3 — Create PR (parallel where possible)
- Create new branch if needed
- Push to remote with `-u` flag if needed
- Create PR using `gh pr create`:

```bash
gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>
EOF
)"
```

### Step 4 — Report
Return the PR URL when done.

## Important
- NEVER use the TodoWrite or Task tools during PR creation
- Always use HEREDOC for multi-line PR body to ensure correct formatting

## Other Useful Commands
- View PR comments: `gh api repos/owner/repo/pulls/123/comments`
- View PR checks: `gh pr checks`
- View PR diff: `gh pr diff`
