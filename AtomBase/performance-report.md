# Performance Analysis Report

Generated: 2026-01-30T18:04:29.589Z
Files Analyzed: 439

## Summary

- **Total Issues:** 40
- **Critical:** 9
- **High:** 29
- **Medium:** 2
- **Low:** 0
- **Average Complexity:** 4.16

## Recommendations

- Consider refactoring functions with high cyclomatic complexity (>10)
- Check for memory leaks - ensure event listeners and intervals are cleaned up
- Review async operations - use Promise.all() for concurrent operations

## Issues by Severity

### CRITICAL (9)

**High cyclomatic complexity (27)**
- File: src/cli/cmd/auth.ts:21
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function handlePluginAuth has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (25)**
- File: src/cli/cmd/tui/app.tsx:190
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function App has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (22)**
- File: src/cli/cmd/tui/routes/session/index.tsx:33
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function Session has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (37)**
- File: src/cli/cmd/tui/routes/session/question.tsx:13
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function QuestionPrompt has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (25)**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:28
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function getSessionCommands has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (50)**
- File: src/cli/cmd/tui/component/prompt/autocomplete.tsx:66
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function Autocomplete has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (93)**
- File: src/cli/cmd/tui/component/prompt/index.tsx:57
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function Prompt has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (39)**
- File: src/provider/sdk/openai-compatible/src/responses/convert-to-openai-responses-input.ts:21
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function convertToOpenAIResponsesInput has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (34)**
- File: src/tool/read.ts:143
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function isBinaryFile has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

### HIGH (29)

**High cyclomatic complexity (15)**
- File: src/cli/cmd/stats.ts:107
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function aggregateSessionStats has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (14)**
- File: src/cli/cmd/uninstall.ts:141
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function executeUninstall has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**Synchronous file operations in loop**
- File: src/cli/cmd/perf.ts:106
- Type: async
- Description: Line 106 may have performance issues: Synchronous File Operations in Loop
- Suggestion: Use async file operations or process files in parallel with Promise.all()

**High cyclomatic complexity (12)**
- File: src/cli/cmd/tui/routes/session/dialog-message.tsx:9
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function DialogMessage has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (16)**
- File: src/cli/cmd/tui/context/file-tree.tsx:90
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function FileTreeProvider has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (11)**
- File: src/cli/cmd/tui/context/chain.tsx:31
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function ChainProvider has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (15)**
- File: src/cli/cmd/tui/context/theme.tsx:175
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function resolveTheme has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (15)**
- File: src/cli/cmd/tui/component/dialog-model.tsx:18
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function DialogModel has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**Potential memory leak - setInterval without clearInterval**
- File: src/cli/cmd/tui/component/file-tree.tsx:167
- Type: memory
- Description: Line 167 may have performance issues: Memory Leak - setInterval
- Suggestion: Always clear intervals when component unmounts or use clearInterval

**High cyclomatic complexity (17)**
- File: src/cli/cmd/tui/component/code-panel.tsx:83
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function CodePanel has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**Potential memory leak - setInterval without clearInterval**
- File: src/cli/cmd/tui/component/code-panel.tsx:124
- Type: memory
- Description: Line 124 may have performance issues: Memory Leak - setInterval
- Suggestion: Always clear intervals when component unmounts or use clearInterval

**Potential memory leak - setInterval without clearInterval**
- File: src/cli/cmd/tui/component/prompt/autocomplete.tsx:96
- Type: memory
- Description: Line 96 may have performance issues: Memory Leak - setInterval
- Suggestion: Always clear intervals when component unmounts or use clearInterval

**Potential memory leak - setInterval without clearInterval**
- File: src/cli/cmd/tui/component/prompt/index.tsx:1024
- Type: memory
- Description: Line 1024 may have performance issues: Memory Leak - setInterval
- Suggestion: Always clear intervals when component unmounts or use clearInterval

**Potential memory leak - setInterval without clearInterval**
- File: src/server/routes/system.ts:101
- Type: memory
- Description: Line 101 may have performance issues: Memory Leak - setInterval
- Suggestion: Always clear intervals when component unmounts or use clearInterval

**Potential memory leak - setInterval without clearInterval**
- File: src/server/routes/global.ts:69
- Type: memory
- Description: Line 69 may have performance issues: Memory Leak - setInterval
- Suggestion: Always clear intervals when component unmounts or use clearInterval

**Promises created in loop without proper handling**
- File: src/share/share.ts:10
- Type: async
- Description: Line 10 may have performance issues: Promise in Loop without await
- Suggestion: Use Promise.all() to handle promises concurrently or await properly

**Promises created in loop without proper handling**
- File: src/file/time.ts:36
- Type: async
- Description: Line 36 may have performance issues: Promise in Loop without await
- Suggestion: Use Promise.all() to handle promises concurrently or await properly

**Potential memory leak - setInterval without clearInterval**
- File: src/provider/models.ts:107
- Type: memory
- Description: Line 107 may have performance issues: Memory Leak - setInterval
- Suggestion: Always clear intervals when component unmounts or use clearInterval

**High cyclomatic complexity (20)**
- File: src/provider/ollama.ts:168
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function estimateContextLength has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (17)**
- File: src/provider/sdk/openai-compatible/src/responses/openai-responses-prepare-tools.ts:13
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function prepareResponsesTools has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**Synchronous file operations in loop**
- File: src/provider/antigravity/storage.ts:52
- Type: async
- Description: Line 52 may have performance issues: Synchronous File Operations in Loop
- Suggestion: Use async file operations or process files in parallel with Promise.all()

**High cyclomatic complexity (14)**
- File: src/tool/finance/symbols.ts:311
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function detectAssetType has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**High cyclomatic complexity (11)**
- File: src/tool/finance/logic.ts:278
- Type: complexity
- Complexity: O(O(1))
- Description: Function applySeniorLogic has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**Promises created in loop without proper handling**
- File: src/tool/finance/providers/crypto.ts:390
- Type: async
- Description: Line 390 may have performance issues: Promise in Loop without await
- Suggestion: Use Promise.all() to handle promises concurrently or await properly

**Promises created in loop without proper handling**
- File: src/tool/finance/providers/crypto.ts:393
- Type: async
- Description: Line 393 may have performance issues: Promise in Loop without await
- Suggestion: Use Promise.all() to handle promises concurrently or await properly

**Promises created in loop without proper handling**
- File: src/project/state.ts:52
- Type: async
- Description: Line 52 may have performance issues: Promise in Loop without await
- Suggestion: Use Promise.all() to handle promises concurrently or await properly

**Promises created in loop without proper handling**
- File: src/lsp/index.ts:282
- Type: async
- Description: Line 282 may have performance issues: Promise in Loop without await
- Suggestion: Use Promise.all() to handle promises concurrently or await properly

**High cyclomatic complexity (18)**
- File: src/plugin/codex.ts:348
- Type: complexity
- Complexity: O(O(n) or worse)
- Description: Function CodexAuthPlugin has high complexity
- Suggestion: Refactor into smaller functions or reduce branching logic

**Promises created in loop without proper handling**
- File: src/util/defer.ts:9
- Type: async
- Description: Line 9 may have performance issues: Promise in Loop without await
- Suggestion: Use Promise.all() to handle promises concurrently or await properly

### MEDIUM (2)

**DOM queries inside loop - expensive operations**
- File: src/cli/cmd/perf.ts:138
- Type: render
- Description: Line 138 may have performance issues: Inefficient DOM Query in Loop
- Suggestion: Query DOM once outside the loop and cache the reference

**DOM queries inside loop - expensive operations**
- File: src/cli/cmd/tui/routes/session/logic/scroll.ts:15
- Type: render
- Description: Line 15 may have performance issues: Inefficient DOM Query in Loop
- Suggestion: Query DOM once outside the loop and cache the reference

## Function Complexity Analysis

| Function | Line | Big-O | Cyclomatic | Nested Loops | Recursion |
|----------|------|-------|------------|--------------|-----------|
| Prompt | 57 | O(n) or worse | 93 | 0 | Yes |
| Autocomplete | 66 | O(n) or worse | 50 | 0 | Yes |
| convertToOpenAIResponsesInput | 21 | O(n) or worse | 39 | 0 | Yes |
| QuestionPrompt | 13 | O(n) or worse | 37 | 0 | Yes |
| isBinaryFile | 143 | O(n) or worse | 34 | 0 | Yes |
| handlePluginAuth | 21 | O(n) or worse | 27 | 0 | Yes |
| App | 190 | O(n) or worse | 25 | 0 | Yes |
| getSessionCommands | 28 | O(n) or worse | 25 | 0 | Yes |
| Session | 33 | O(n) or worse | 22 | 0 | Yes |
| estimateContextLength | 168 | O(n) or worse | 20 | 0 | Yes |
| CodexAuthPlugin | 348 | O(n) or worse | 18 | 0 | Yes |
| CodePanel | 83 | O(n) or worse | 17 | 0 | Yes |
| prepareResponsesTools | 13 | O(n) or worse | 17 | 0 | Yes |
| FileTreeProvider | 90 | O(n) or worse | 16 | 0 | Yes |
| aggregateSessionStats | 107 | O(n) or worse | 15 | 0 | Yes |
| resolveTheme | 175 | O(n) or worse | 15 | 0 | Yes |
| DialogModel | 18 | O(n) or worse | 15 | 0 | Yes |
| executeUninstall | 141 | O(n) or worse | 14 | 0 | Yes |
| detectAssetType | 311 | O(n) or worse | 14 | 0 | Yes |
| DialogMessage | 9 | O(n) or worse | 12 | 0 | Yes |
