# Skills Development Guide

Skills are specialized instruction sets that modify agent behavior for specific tasks. This guide covers how to use, create, and share skills.

---

## Table of Contents

- [What are Skills?](#what-are-skills)
- [Using Skills](#using-skills)
- [Managing Skills](#managing-skills)
- [Skill File Format](#skill-file-format)
- [Creating Skills](#creating-skills)
- [Example Skills](#example-skills)
- [Best Practices](#best-practices)
- [Sharing Skills](#sharing-skills)

---

## What are Skills?

Skills are markdown files with YAML frontmatter that provide:

- **Specialized Instructions**: Domain-specific guidance for the agent
- **Workflows**: Step-by-step procedures for common tasks
- **Personas**: Different agent personalities or expertise areas
- **Templates**: Predefined patterns and structures

Skills are stored in `~/.atomcli/skills/` and loaded automatically.

---

## Using Skills

### Via Chat

```
> Use the ralph skill for this project
> Apply the code-reviewer skill
> List all installed skills
```

### Via Command

```bash
# List skills
atomcli skill list

# Show skill details
atomcli skill show ralph
```

---

## Managing Skills

### List Installed Skills

```bash
atomcli skill list
```

### Add a Skill from GitHub

```bash
atomcli skill add https://github.com/user/repo/blob/main/skill.md
```

Or via chat:
```
> Add this skill: https://github.com/user/repo/skill.md
> Find and add ralph skill from github
```

### Remove a Skill

```bash
atomcli skill remove <skill-name>
```

### Skill Storage Location

Skills are stored in:
```
~/.atomcli/skills/
├── ralph/
│   └── SKILL.md
├── code-reviewer/
│   └── SKILL.md
└── debugging/
    └── SKILL.md
```

---

## Skill File Format

### Basic Structure

```markdown
---
name: skill-name
description: Brief description of what this skill does
---

# Skill Title

Instructions and content for the agent...
```

### Frontmatter Fields

| Field         | Required | Description                            |
| ------------- | -------- | -------------------------------------- |
| `name`        | Yes      | Unique identifier (lowercase, hyphens) |
| `description` | Yes      | Brief description shown in listings    |
| `version`     | No       | Semantic version (e.g., "1.0.0")       |
| `author`      | No       | Creator name or GitHub username        |
| `tags`        | No       | Array of tags for categorization       |

### Full Frontmatter Example

```yaml
---
name: systematic-debugging
description: Step-by-step debugging methodology with root cause analysis
version: 1.2.0
author: atom13
tags:
  - debugging
  - methodology
  - troubleshooting
---
```

---

## Creating Skills

### Step 1: Create Directory

```bash
mkdir -p ~/.atomcli/skills/my-skill
```

### Step 2: Create SKILL.md

```bash
cat > ~/.atomcli/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: Description of what this skill does
---

# My Skill

## Purpose

Explain the purpose of this skill.

## Instructions

Provide detailed instructions for the agent.

## Guidelines

- Guideline 1
- Guideline 2
- Guideline 3

## Examples

### Example 1

Show how to apply this skill...
EOF
```

### Step 3: Test the Skill

```bash
# List to verify
atomcli skill list

# Use in session
atomcli
> Apply my-skill
```

---

## Example Skills

### Code Reviewer

```markdown
---
name: code-reviewer
description: Thorough code review with security and performance analysis
---

# Code Reviewer

You are an expert code reviewer. When reviewing code:

## Review Checklist

1. **Security**
   - Check for SQL injection
   - Validate input sanitization
   - Review authentication/authorization

2. **Performance**
   - Identify N+1 queries
   - Check for memory leaks
   - Review algorithm complexity

3. **Code Quality**
   - Follow naming conventions
   - Ensure proper error handling
   - Check test coverage

## Output Format

Provide feedback as:
- **Critical**: Must fix before merge
- **Important**: Should address
- **Suggestion**: Nice to have
```

### Systematic Debugging

```markdown
---
name: systematic-debugging
description: Methodical debugging with root cause analysis
---

# Systematic Debugging

## Methodology

1. **Reproduce**: Create minimal reproduction case
2. **Isolate**: Narrow down the problem area
3. **Diagnose**: Identify root cause
4. **Fix**: Implement solution
5. **Verify**: Confirm fix works
6. **Prevent**: Add tests/guards

## Debugging Steps

When debugging an issue:

1. First, understand the expected behavior
2. Reproduce the issue consistently
3. Check error messages and logs
4. Use binary search to isolate
5. Form and test hypotheses
6. Document the root cause
```

### Ralph (Autonomous Agent)

```markdown
---
name: ralph
description: Autonomous coding loop agent for continuous development
---

# Ralph - Autonomous Developer Agent

## Core Philosophy

1. **Iterative Progress**: Small, verifiable changes
2. **Self-Correction**: Analyze errors, adjust, retry
3. **Quality First**: Write tests, verify, clean code
4. **Transparency**: Report status clearly
5. **Autonomy**: Find work proactively

## Status Block

Always end with:

    ---RALPH_STATUS---
    STATUS: [IN_PROGRESS | BLOCKED | COMPLETE]
    TASKS_COMPLETED: [Number]
    FILES_MODIFIED: [Number]
    TESTS_STATUS: [PASSING | FAILING | NOT_RUN]
    ---END_RALPH_STATUS---


## Workflow

1. Check @fix_plan.md for tasks
2. Implement changes
3. Run tests
4. Update status
5. Continue or exit
```

### Documentation Writer

```markdown
---
name: documentation-writer
description: Technical documentation with clear structure and examples
---

# Documentation Writer

## Style Guide

- Use clear, concise language
- Prefer active voice
- Include code examples
- Add table of contents for long docs

## Structure

1. **Overview**: What and why
2. **Quick Start**: Get running fast
3. **Detailed Guide**: Full explanation
4. **API Reference**: Technical details
5. **Examples**: Real-world usage
6. **Troubleshooting**: Common issues

## Formatting

- Use headers for sections
- Use code blocks for commands
- Use tables for comparisons
- Use lists for steps
```

---

## Best Practices

### Writing Effective Skills

1. **Be Specific**: Clear, actionable instructions
2. **Use Examples**: Show, don't just tell
3. **Structure Well**: Use headers and lists
4. **Keep Focused**: One purpose per skill
5. **Test Thoroughly**: Verify the skill works

### Naming Conventions

- Use lowercase with hyphens: `my-skill-name`
- Be descriptive but concise
- Avoid generic names like "helper" or "utils"

### Content Guidelines

```markdown
# Good: Specific instructions
When writing tests:
1. Test happy path first
2. Add edge cases
3. Include error scenarios

# Avoid: Vague instructions
Write good tests.
```

### Avoid Common Mistakes

- Don't make skills too broad
- Don't include sensitive information
- Don't assume specific project structure
- Don't conflict with core agent behavior

---

## Sharing Skills

### GitHub Repository

1. Create a repository
2. Add SKILL.md at root or in subdirectory
3. Share the raw file URL

```
https://github.com/username/repo/blob/main/SKILL.md
```

### Installation from GitHub

```bash
atomcli skill add https://github.com/username/repo/blob/main/SKILL.md
```

Or via chat:
```
> Add skill from https://github.com/username/repo/...
```

### Publishing Tips

- Include a README with usage instructions
- Add example outputs
- Document any dependencies
- Use semantic versioning

---

## Advanced Features

### Including Scripts

Skills can include helper scripts in their directory:

```
~/.atomcli/skills/ralph/
├── SKILL.md
└── scripts/
    └── ralph_runner.sh
```

Reference in SKILL.md:
```markdown
Run the helper script:
```bash
~/.atomcli/skills/ralph/scripts/ralph_runner.sh
```

### Multiple Files

Skills can reference additional files:

~/.atomcli/skills/my-skill/
├── SKILL.md
├── templates/
│   └── component.tsx
└── examples/
    └── usage.md


---

## Related Documentation

- [Development Guide](./DEVELOPMENT.md) - Technical documentation
- [Providers Guide](./PROVIDERS.md) - AI provider setup
- [MCP Guide](./MCP-GUIDE.md) - Extending with MCP servers