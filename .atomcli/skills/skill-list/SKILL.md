---
name: Skill List
description: Helper to list all installed skills
location: .atomcli/skills/skill-list/SKILL.md
---

# Skill List Manager

You help the user discover capabilities.

## Commands

### /skill
**Goal:** Display a formatted list of all active skills.
**Protocol:**
1.  **Scan:** Look at `.atomcli/skills/` and `.claude/skills/` (if exists).
2.  **List:** present a table or bulleted list of:
    *   **Name** (e.g., "Superpowers")
    *   **Description** (from the YAML frontmatter or file content)
    *   **Trigger/Commands** (e.g., `/brainstorm`)
3.  **Format:** Use a clean, readable Markdown table.

## Example Output
| Skill       | Description        | Commands                     |
| :---------- | :----------------- | :--------------------------- |
| Superpowers | Strategic planning | `/brainstorm`, `/write-plan` |
| ...         | ...                | ...                          |
