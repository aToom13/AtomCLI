# Skills Guide

Skills are Markdown instruction packages discovered from `SKILL.md` files. A skill must declare a `name` and `description` in YAML frontmatter. It may optionally declare `trigger_words` for automatic candidate detection.

## Discover and manage skills

```sh
atomcli skill list
atomcli skill show <name>
atomcli skill add <github-url-or-repository-path>
atomcli skill remove <name>
```

Skills are discovered from project `.atomcli/skill/` and `.atomcli/skills/` locations, compatible `.claude/skills/` locations, global `~/.atomcli/skills/`, and bundled installation assets. Project-local skills take part in the active project's configuration and should be committed only when they are part of the project workflow.

## Write a skill

Create `.atomcli/skills/my-skill/SKILL.md`:

```md
---
name: my-skill
description: Apply this workflow when the task needs its domain guidance.
trigger_words:
  - example domain
---

# My skill

State the scope, prerequisites, decision rules, and verification steps.
```

Keep instructions specific, testable, and scoped to one workflow. Do not place credentials in a skill. Use paths relative to the skill file when it references supporting files.

## Verify discovery

Run `atomcli skill list` from the project directory. If a skill is not shown, verify the filename is exactly `SKILL.md`, frontmatter has both required fields, and the file is under a discovered directory.
