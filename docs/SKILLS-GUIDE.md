# Skills Guide

Skills are Markdown instruction packages discovered from `SKILL.md` files. A skill must declare a `name` and `description` in YAML frontmatter. It may optionally declare `trigger_words` for automatic candidate detection.

## Discover and manage skills

```sh
atomcli skill list
atomcli skill show <name>
atomcli skill add <github-url-or-repository-path>
atomcli skill remove <name>
```

Skills are discovered from these locations:

| Scope   | Location                                 | Notes                          |
| ------- | ---------------------------------------- | ------------------------------ |
| Project | `.atomcli/skills/**/SKILL.md`            | Primary project location       |
| Project | `.atomcli/skill/**/SKILL.md`             | Singular variant, also scanned |
| Project | `.claude/skills/**/SKILL.md`             | Compatibility fallback         |
| Global  | `~/.atomcli/skills/**/SKILL.md`          | Available in every project     |
| Global  | `~/.claude/skills/**/SKILL.md`           | Global compatibility fallback  |
| Bundled | Installation assets shipped with AtomCLI | Built-in skills                |

Project-local skills take part in the active project's configuration and should be committed only when they are part of the project workflow.

Skill names must be unique across all discovered locations. A duplicate name does not fail discovery, but it logs a warning and one of the definitions wins; avoid relying on scan order by keeping names distinct.

`trigger_words` enable automatic candidate detection: when user input contains any declared word or phrase (case-insensitive), that skill becomes a candidate for injection into the session.

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
