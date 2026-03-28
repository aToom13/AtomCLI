# Prompt System Architecture

The **Prompt System** is one of AtomCLI's most critical components. It generates, organizes, and manages all system instructions sent to AI models.

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [manager.ts -- Unified Orchestrator](#managerts----unified-orchestrator)
- [Module Layers](#module-layers)
  - [1. Core (Base Prompts)](#1-core-base-prompts)
  - [2. Provider (Model-Specific)](#2-provider-model-specific)
  - [3. Agent (Agent Mode)](#3-agent-agent-mode)
  - [4. Runtime (Runtime Injection)](#4-runtime-runtime-injection)
  - [5. Inline Emphasis](#5-inline-emphasis)
- [How Prompts Are Built](#how-prompts-are-built)
- [Customization](#customization)
  - [Adding a New .txt File](#adding-a-new-txt-file)
  - [Adding Custom Sections (Dynamic)](#adding-custom-sections-dynamic)
  - [Project Rules (AGENTS.md)](#project-rules-agentsmd)
- [Token Statistics](#token-statistics)
- [Related Documentation](#related-documentation)

---

## Overview

```
User Request
     |
     v
+--------------+
|  system.ts   | <- Entry point
|  provider()  |
+------+-------+
       |
       v
+--------------+
|  manager.ts  | <- Unified orchestrator
|              |
|  +--------+  |
|  | Core   |--+-- 8 base .txt files (always included)
|  +--------+  |
|  |Provider|--+-- Model-specific .txt (auto-detected)
|  +--------+  |
|  | Agent  |--+-- Agent mode .txt (selected)
|  +--------+  |
|  |Emphasis|--+-- Read-before-edit, orchestrate, todowrite
|  +--------+  |
|  |Dynamic |--+-- User profile, learning memory
|  +--------+  |
|  |Custom  |--+-- User-added extra sections
|  +--------+  |
+------+-------+
       |
       v
  Single string sent to LLM
```

---

## Directory Structure

```
AtomBase/src/core/session/prompt/
|-- manager.ts              # Unified orchestrator (single entry point)
|
|-- core/                   # Base prompts (ALWAYS included)
|   |-- identity.txt        #   AI identity, personality, expertise areas
|   |-- self-learning.txt   #   Learning system instructions
|   |-- tools.txt           #   Tool usage guide (Read, Edit, Bash, etc.)
|   |-- workflow.txt        #   5-stage workflow
|   |-- communication.txt   #   Communication style rules
|   |-- code-editing.txt    #   Code editing rules and best practices
|   |-- git-safety.txt      #   Git safety protocol
|   +-- extensions.txt      #   Skill system and MCP guide
|
|-- provider/               # Model-specific optimizations
|   |-- anthropic.txt       #   For Claude models
|   |-- gemini.txt          #   For Gemini models
|   |-- openai.txt          #   For GPT/O-series models
|   +-- generic.txt         #   For all other models
|
|-- agent/                  # Agent mode behaviors
|   |-- agent.txt           #   Default autonomous mode
|   |-- explore.txt         #   Read-only exploration mode
|   |-- plan.txt            #   Planning mode (editing prohibited)
|   +-- build.txt           #   Application mode
|
+-- runtime/                # Runtime injections
    |-- max-steps.txt       #   Step limit warning
    |-- plan-mode.txt       #   Plan mode system reminder
    |-- build-switch.txt    #   Plan->Build transition notice
    |-- anthropic-spoof.txt #   Claude Code spoof header
    |-- plan-reminder-anthropic.txt  # Anthropic plan workflow
    +-- legacy-instructions.txt      # Legacy codex instructions (backward compat)
```

---

## manager.ts -- Unified Orchestrator

`manager.ts` is the main orchestrator that contains all prompt generation logic in a single file.

### API

```typescript
import { PromptManager } from "./prompt/manager"

// Synchronous build (fast, no user profile/memory)
const prompt = PromptManager.build({
  modelId: "claude-3-5-sonnet",
  agent: "agent",
  customSections: ["Extra rule: Always respond in English."],
})

// Asynchronous build (includes user profile + learning memory)
const prompt = await PromptManager.buildAsync({
  modelId: "gemini-2.0-flash",
  agent: "explore",
  includeLearningMemory: true,
  includeUserProfile: true,
})

// Statistics
const stats = PromptManager.getStats({ modelId: "claude-3-5-sonnet" })
console.log(stats.totalTokens) // ~25000
console.log(stats.sections) // Token count per section
```

### BuildOptions

| Parameter               | Type        | Default   | Description             |
| ----------------------- | ----------- | --------- | ----------------------- |
| `modelId`               | `string`    | required  | Model API ID            |
| `agent`                 | `AgentType` | `"agent"` | Agent mode              |
| `customSections`        | `string[]`  | `[]`      | Extra prompt sections   |
| `includeLearningMemory` | `boolean`   | `true`    | Include learning memory |
| `includeUserProfile`    | `boolean`   | `true`    | Include user profile    |

### Backward Compatibility

```typescript
// Legacy PromptBuilder still works (alias)
import { PromptBuilder } from "./prompt/manager"
PromptBuilder.build({ ... })  // Same as PromptManager.build
```

---

## Module Layers

### 1. Core (Base Prompts)

These 8 files are included in **every request**, order matters:

| Order | File                | Content                                                    | ~Tokens |
| ----- | ------------------- | ---------------------------------------------------------- | ------- |
| 1     | `identity.txt`      | AI identity, expertise, personality, agent loop            | ~4700   |
| 2     | `self-learning.txt` | Memory system instructions                                 | ~1200   |
| 3     | `tools.txt`         | 17 tools detailed usage guide                              | ~4800   |
| 4     | `workflow.txt`      | 5-stage workflow (Understand->Plan->Apply->Verify->Finish) | ~3200   |
| 5     | `communication.txt` | Communication rules (direct, concise, technical)           | ~2900   |
| 6     | `code-editing.txt`  | Code editing best practices                                | ~3700   |
| 7     | `git-safety.txt`    | Git safety protocol                                        | ~2400   |
| 8     | `extensions.txt`    | Skill and MCP usage guide                                  | ~3100   |

### 2. Provider (Model-Specific)

Auto-detected based on model ID:

```
"claude-3-5-sonnet"  -> anthropic.txt
"gemini-2.0-flash"   -> gemini.txt
"gpt-4o"             -> openai.txt
"llama-3.1"          -> generic.txt
```

Detection rules:

- Contains `claude` -> `anthropic`
- Contains `gemini` -> `gemini`
- Contains `gpt`, `o1`, `o3`, `o4` -> `openai`
- Everything else -> `generic`

### 3. Agent (Agent Mode)

| Mode      | File          | Behavior                            |
| --------- | ------------- | ----------------------------------- |
| `agent`   | `agent.txt`   | Fully autonomous, all tools enabled |
| `explore` | `explore.txt` | Read-only, only Read/Grep/Glob/Ls   |
| `plan`    | `plan.txt`    | Plan only, editing prohibited       |
| `build`   | `build.txt`   | Execute plan, full permissions      |

### 4. Runtime (Runtime Injection)

These files are **not always included**, only injected at specific moments:

| File                      | When                        | Source      |
| ------------------------- | --------------------------- | ----------- |
| `max-steps.txt`           | Step limit exceeded         | `prompt.ts` |
| `plan-mode.txt`           | Plan mode activated         | `prompt.ts` |
| `build-switch.txt`        | Plan->Build transition      | `prompt.ts` |
| `anthropic-spoof.txt`     | Header for Anthropic models | `system.ts` |
| `legacy-instructions.txt` | Legacy codex instructions   | `system.ts` |

### 5. Inline Emphasis

Defined directly in `manager.ts`, **always included** alongside .txt files:

| Section                     | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `READ_BEFORE_EDIT_EMPHASIS` | Emphasizes "ALWAYS read before editing" rule |
| `ORCHESTRATE_DETAILS`       | Orchestrate tool usage guide                 |
| `TODOWRITE_DETAILS`         | TodoWrite task management guide              |

These are included **in addition to** the base .txt files to reinforce critical rules.

---

## How Prompts Are Built

When `PromptManager.build()` is called, the assembly order is:

```
1.  core/identity.txt              <- Who it is
2.  core/self-learning.txt         <- Learning system
3.  core/tools.txt                 <- Tool usage
4.  core/workflow.txt              <- Workflow
5.  core/communication.txt         <- Communication
6.  core/code-editing.txt          <- Code editing
7.  core/git-safety.txt            <- Git safety
8.  core/extensions.txt            <- Skills + MCP
9.  [user_context]                 <- User profile (async)
10. [learning_memory]              <- Learning memory (async)
11. READ_BEFORE_EDIT_EMPHASIS      <- Critical rule emphasis
12. ORCHESTRATE_DETAILS            <- Orchestrate guide
13. TODOWRITE_DETAILS              <- TodoWrite guide
14. provider/{detected}.txt        <- Provider-specific
15. agent/{selected}.txt           <- Agent mode-specific
16. customSections[]               <- User extras
```

Each section is separated by `\n\n---\n\n`.

---

## Customization

### Adding a New .txt File

1. Place the file in the appropriate directory:
   - Base (always included) -> `core/`
   - Provider-specific -> `provider/`
   - Agent mode-specific -> `agent/`
   - Runtime injection -> `runtime/`

2. Import it in `manager.ts`:

   ```typescript
   import MY_NEW_PROMPT from "./core/my-new-rules.txt"
   ```

3. Add it to the appropriate array:
   ```typescript
   const CORE_PROMPTS = [
     ...existing_prompts,
     MY_NEW_PROMPT, // <- newly added
   ]
   ```

### Adding Custom Sections (Dynamic)

Add extra sections at runtime via code:

```typescript
const prompt = PromptManager.build({
  modelId: "claude-3-5-sonnet",
  customSections: [
    "This project uses TailwindCSS v4. Always prefer Tailwind classes.",
    await fs.readFile("./my-extra-rules.txt", "utf-8"), // Read from file
  ],
})
```

### Project Rules (AGENTS.md)

The `system.ts -> custom()` function automatically reads rule files from the project root:

```
Search order:
1. ./AGENTS.md (project root)
2. ./CLAUDE.md
3. ./CONTEXT.md (deprecated)
4. ~/.atomcli/AGENTS.md (global)
5. ~/.claude/CLAUDE.md (global)
```

These files are added as `customSections` to the PromptManager.

---

## Token Statistics

Approximate token distribution per section in a typical prompt:

```
identity         [####################....]  ~4,700  (19%)
tools            [####################....]  ~4,800  (19%)
workflow         [###############.........]  ~3,200  (13%)
code-editing     [################........]  ~3,700  (15%)
communication    [############............]  ~2,900  (12%)
extensions       [############............]  ~3,100  (12%)
git-safety       [###########.............]  ~2,400  (10%)
self-learning    [######..................]  ~1,200  ( 5%)
emphasis/extras  [#######.................]  ~1,500  ( 6%)
provider+agent   [###.....................]  ~  500  ( 2%)
-------------------------------------------------------------
TOTAL            [######################..]  ~28,000
```

Use `PromptManager.getStats()` to get real-time statistics.

---

## Related Documentation

- [Development Guide](./DEVELOPMENT.md) - Project development guide
- [Providers](./PROVIDERS.md) - AI provider configuration
- [MCP Guide](./MCP-GUIDE.md) - MCP server integration
- [Skills Guide](./SKILLS-GUIDE.md) - Skill system guide
