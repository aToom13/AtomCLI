# Refactoring Analysis Report

Generated: 2026-01-30T08:31:31.353Z

## Summary

- **Total Issues:** 1167
- **Auto-fixable:** 901
- **Manual Review Needed:** 266

### Issues by Type

- magic-number: 638
- long-function: 125
- triple-equals: 18
- any-type: 140
- console-log: 235
- var-usage: 9
- dead-code: 1
- duplicate-code: 1

## Detected Issues

### HIGH (71)

**Function is 195 lines long**
- File: src/cli/cmd/stats.ts:107
- Type: long-function
- Auto-fixable: No

**Function is 91 lines long**
- File: src/cli/cmd/stats.ts:303
- Type: long-function
- Auto-fixable: No

**Function is 82 lines long**
- File: src/cli/cmd/uninstall.ts:141
- Type: long-function
- Auto-fixable: No

**Function is 140 lines long**
- File: src/cli/cmd/auth.ts:21
- Type: long-function
- Auto-fixable: No

**Function is 59 lines long**
- File: src/cli/cmd/tui/app.tsx:42
- Type: long-function
- Auto-fixable: No

**Function is 85 lines long**
- File: src/cli/cmd/tui/app.tsx:104
- Type: long-function
- Auto-fixable: No

**Function is 569 lines long**
- File: src/cli/cmd/tui/app.tsx:190
- Type: long-function
- Auto-fixable: No

**Function is 81 lines long**
- File: src/cli/cmd/tui/app.tsx:760
- Type: long-function
- Auto-fixable: No

**Function is 119 lines long**
- File: src/cli/cmd/tui/routes/home.tsx:20
- Type: long-function
- Auto-fixable: No

**Function is 332 lines long**
- File: src/cli/cmd/tui/routes/session/index.tsx:33
- Type: long-function
- Auto-fixable: No

**Function is 305 lines long**
- File: src/cli/cmd/tui/routes/session/sidebar.tsx:15
- Type: long-function
- Auto-fixable: No

**Function is 81 lines long**
- File: src/cli/cmd/tui/routes/session/header.tsx:32
- Type: long-function
- Auto-fixable: No

**Function is 101 lines long**
- File: src/cli/cmd/tui/routes/session/dialog-message.tsx:9
- Type: long-function
- Auto-fixable: No

**Function is 403 lines long**
- File: src/cli/cmd/tui/routes/session/question.tsx:13
- Type: long-function
- Auto-fixable: No

**Function is 155 lines long**
- File: src/cli/cmd/tui/routes/session/permission.tsx:104
- Type: long-function
- Auto-fixable: No

**Function is 64 lines long**
- File: src/cli/cmd/tui/routes/session/permission.tsx:260
- Type: long-function
- Auto-fixable: No

**Function is 92 lines long**
- File: src/cli/cmd/tui/routes/session/permission.tsx:325
- Type: long-function
- Auto-fixable: No

**Function is 54 lines long**
- File: src/cli/cmd/tui/routes/session/dialog-fork-from-timeline.tsx:11
- Type: long-function
- Auto-fixable: No

**Function is 80 lines long**
- File: src/cli/cmd/tui/routes/session/footer.tsx:9
- Type: long-function
- Auto-fixable: No

**Function is 78 lines long**
- File: src/cli/cmd/tui/routes/session/components/AssistantMessage.tsx:19
- Type: long-function
- Auto-fixable: No

**Function is 86 lines long**
- File: src/cli/cmd/tui/routes/session/components/ToolPart.tsx:23
- Type: long-function
- Auto-fixable: No

**Function is 95 lines long**
- File: src/cli/cmd/tui/routes/session/components/UserMessage.tsx:20
- Type: long-function
- Auto-fixable: No

**Function is 97 lines long**
- File: src/cli/cmd/tui/routes/session/components/tools/Edit.tsx:9
- Type: long-function
- Auto-fixable: No

**Function is 73 lines long**
- File: src/cli/cmd/tui/routes/session/components/tools/Shared.tsx:31
- Type: long-function
- Auto-fixable: No

**Function is 53 lines long**
- File: src/cli/cmd/tui/routes/session/components/tools/Task.tsx:10
- Type: long-function
- Auto-fixable: No

**Function is 62 lines long**
- File: src/cli/cmd/tui/routes/session/components/tools/Write.tsx:8
- Type: long-function
- Auto-fixable: No

**Function is 435 lines long**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:28
- Type: long-function
- Auto-fixable: No

**Function is 101 lines long**
- File: src/cli/cmd/tui/routes/session/hooks/useSessionState.ts:11
- Type: long-function
- Auto-fixable: No

**Function is 77 lines long**
- File: src/cli/cmd/tui/ui/dialog.tsx:50
- Type: long-function
- Auto-fixable: No

**Function is 52 lines long**
- File: src/cli/cmd/tui/ui/dialog-confirm.tsx:16
- Type: long-function
- Auto-fixable: No

**Function is 51 lines long**
- File: src/cli/cmd/tui/ui/dialog-prompt.tsx:16
- Type: long-function
- Auto-fixable: No

**Function is 149 lines long**
- File: src/cli/cmd/tui/ui/dialog-export-options.tsx:24
- Type: long-function
- Auto-fixable: No

**Function is 252 lines long**
- File: src/cli/cmd/tui/ui/dialog-select.tsx:49
- Type: long-function
- Auto-fixable: No

**Function is 64 lines long**
- File: src/cli/cmd/tui/ui/dialog-help.tsx:57
- Type: long-function
- Auto-fixable: No

**Function is 76 lines long**
- File: src/cli/cmd/tui/ui/spinner.ts:25
- Type: long-function
- Auto-fixable: No

**Function is 51 lines long**
- File: src/cli/cmd/tui/ui/spinner.ts:141
- Type: long-function
- Auto-fixable: No

**Function is 58 lines long**
- File: src/cli/cmd/tui/ui/spinner.ts:272
- Type: long-function
- Auto-fixable: No

**Function is 152 lines long**
- File: src/cli/cmd/tui/context/file-tree.tsx:90
- Type: long-function
- Auto-fixable: No

**Function is 87 lines long**
- File: src/cli/cmd/tui/context/chain.tsx:31
- Type: long-function
- Auto-fixable: No

**Function is 57 lines long**
- File: src/cli/cmd/tui/context/theme.tsx:175
- Type: long-function
- Auto-fixable: No

**Function is 114 lines long**
- File: src/cli/cmd/tui/context/theme.tsx:420
- Type: long-function
- Auto-fixable: No

**Function is 53 lines long**
- File: src/cli/cmd/tui/context/theme.tsx:535
- Type: long-function
- Auto-fixable: No

**Function is 503 lines long**
- File: src/cli/cmd/tui/context/theme.tsx:648
- Type: long-function
- Auto-fixable: No

**Function is 233 lines long**
- File: src/cli/cmd/tui/component/dialog-model.tsx:18
- Type: long-function
- Auto-fixable: No

**Function is 58 lines long**
- File: src/cli/cmd/tui/component/dialog-stash.tsx:29
- Type: long-function
- Auto-fixable: No

**Function is 101 lines long**
- File: src/cli/cmd/tui/component/dialog-session-list.tsx:15
- Type: long-function
- Auto-fixable: No

**Function is 59 lines long**
- File: src/cli/cmd/tui/component/file-tree.tsx:82
- Type: long-function
- Auto-fixable: No

**Function is 70 lines long**
- File: src/cli/cmd/tui/component/file-tree.tsx:142
- Type: long-function
- Auto-fixable: No

**Function is 93 lines long**
- File: src/cli/cmd/tui/component/dialog-provider.tsx:26
- Type: long-function
- Auto-fixable: No

**Function is 216 lines long**
- File: src/cli/cmd/tui/component/code-panel.tsx:83
- Type: long-function
- Auto-fixable: No

**Function is 140 lines long**
- File: src/cli/cmd/tui/component/chain-widget.tsx:15
- Type: long-function
- Auto-fixable: No

**Function is 63 lines long**
- File: src/cli/cmd/tui/component/dialog-command.tsx:24
- Type: long-function
- Auto-fixable: No

**Function is 65 lines long**
- File: src/cli/cmd/tui/component/dialog-mcp.tsx:22
- Type: long-function
- Auto-fixable: No

**Function is 181 lines long**
- File: src/cli/cmd/tui/component/dialog-status.tsx:8
- Type: long-function
- Auto-fixable: No

**Function is 720 lines long**
- File: src/cli/cmd/tui/component/prompt/autocomplete.tsx:66
- Type: long-function
- Auto-fixable: No

**Function is 1035 lines long**
- File: src/cli/cmd/tui/component/prompt/index.tsx:57
- Type: long-function
- Auto-fixable: No

**Function is 67 lines long**
- File: src/provider/kilocode.ts:231
- Type: long-function
- Auto-fixable: No

**Function is 276 lines long**
- File: src/provider/sdk/openai-compatible/src/responses/convert-to-openai-responses-input.ts:21
- Type: long-function
- Auto-fixable: No

**Function is 165 lines long**
- File: src/provider/sdk/openai-compatible/src/responses/openai-responses-prepare-tools.ts:13
- Type: long-function
- Auto-fixable: No

**Function is 54 lines long**
- File: src/provider/sdk/openai-compatible/src/responses/openai-responses-language-model.ts:1616
- Type: long-function
- Auto-fixable: No

**Function is 59 lines long**
- File: src/provider/antigravity/oauth.ts:124
- Type: long-function
- Auto-fixable: No

**Function is 56 lines long**
- File: src/tool/read.ts:143
- Type: long-function
- Auto-fixable: No

**Function is 95 lines long**
- File: src/tool/finance/symbols.ts:311
- Type: long-function
- Auto-fixable: No

**Function is 54 lines long**
- File: src/tool/finance/index.ts:187
- Type: long-function
- Auto-fixable: No

**Function is 55 lines long**
- File: src/tool/finance/technical.ts:268
- Type: long-function
- Auto-fixable: No

**Function is 62 lines long**
- File: src/tool/finance/logic.ts:278
- Type: long-function
- Auto-fixable: No

**Function is 88 lines long**
- File: src/flow/ralph.ts:3
- Type: long-function
- Auto-fixable: No

**Function is 57 lines long**
- File: src/plugin/kilocode.ts:88
- Type: long-function
- Auto-fixable: No

**Function is 80 lines long**
- File: src/plugin/kilocode.ts:146
- Type: long-function
- Auto-fixable: No

**Function is 70 lines long**
- File: src/plugin/codex.ts:242
- Type: long-function
- Auto-fixable: No

**Function is 177 lines long**
- File: src/plugin/codex.ts:348
- Type: long-function
- Auto-fixable: No

### MEDIUM (213)

**Function is 33 lines long**
- File: test/cli/github-action.test.ts:27
- Type: long-function
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: test/provider/transform.test.ts:367
- Type: triple-equals
- Auto-fixable: Yes

**Use '===' instead of '==' for strict equality**
- File: test/provider/transform.test.ts:388
- Type: triple-equals
- Auto-fixable: Yes

**Avoid using 'any' type - use specific type or unknown**
- File: test/provider/transform.test.ts:589
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: test/provider/provider.test.ts:1529
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: test/provider/provider.test.ts:1557
- Type: any-type
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: test/tool/read.test.ts:272
- Type: triple-equals
- Auto-fixable: Yes

**Avoid using 'any' type - use specific type or unknown**
- File: test/tool/patch.test.ts:56
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: test/tool/patch.test.ts:59
- Type: any-type
- Auto-fixable: No

**Function is 35 lines long**
- File: src/cli/error.ts:7
- Type: long-function
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: src/cli/cmd/refactor.ts:189
- Type: triple-equals
- Auto-fixable: Yes

**Use '===' instead of '==' for strict equality**
- File: src/cli/cmd/refactor.ts:194
- Type: triple-equals
- Auto-fixable: Yes

**Use '===' instead of '==' for strict equality**
- File: src/cli/cmd/refactor.ts:342
- Type: triple-equals
- Auto-fixable: Yes

**Function is 37 lines long**
- File: src/cli/cmd/uninstall.ts:103
- Type: long-function
- Auto-fixable: No

**Function is 43 lines long**
- File: src/cli/cmd/uninstall.ts:224
- Type: long-function
- Auto-fixable: No

**Function is 39 lines long**
- File: src/cli/cmd/uninstall.ts:268
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/run.ts:112
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/run.ts:158
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/import.ts:25
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/import.ts:26
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/import.ts:60
- Type: any-type
- Auto-fixable: No

**Function is 38 lines long**
- File: src/cli/cmd/tui/routes/session/dialog-timeline.tsx:10
- Type: long-function
- Auto-fixable: No

**Function is 48 lines long**
- File: src/cli/cmd/tui/routes/session/permission.tsx:34
- Type: long-function
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: src/cli/cmd/tui/routes/session/permission.tsx:340
- Type: triple-equals
- Auto-fixable: Yes

**Use '===' instead of '==' for strict equality**
- File: src/cli/cmd/tui/routes/session/permission.tsx:347
- Type: triple-equals
- Auto-fixable: Yes

**Function is 32 lines long**
- File: src/cli/cmd/tui/routes/session/components/ReasoningPart.tsx:7
- Type: long-function
- Auto-fixable: No

**Function is 33 lines long**
- File: src/cli/cmd/tui/routes/session/components/tools/Question.tsx:6
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/components/tools/Shared.tsx:20
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/components/tools/Shared.tsx:34
- Type: any-type
- Auto-fixable: No

**Function is 33 lines long**
- File: src/cli/cmd/tui/routes/session/components/tools/Shared.tsx:105
- Type: long-function
- Auto-fixable: No

**Function is 36 lines long**
- File: src/cli/cmd/tui/routes/session/components/tools/Bash.tsx:7
- Type: long-function
- Auto-fixable: No

**Function is 50 lines long**
- File: src/cli/cmd/tui/routes/session/logic/revert.ts:5
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:16
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:17
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:18
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:19
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:23
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:25
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:42
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:47
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:64
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:73
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:93
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:112
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:136
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:151
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:169
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:189
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:212
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:226
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:235
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:244
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:253
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:263
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:273
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:282
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:293
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:337
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:364
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:428
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:439
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:450
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/ui/dialog.tsx:100
- Type: any-type
- Auto-fixable: No

**Function is 33 lines long**
- File: src/cli/cmd/tui/ui/dialog.tsx:132
- Type: long-function
- Auto-fixable: No

**Function is 37 lines long**
- File: src/cli/cmd/tui/ui/dialog-alert.tsx:12
- Type: long-function
- Auto-fixable: No

**Function is 44 lines long**
- File: src/cli/cmd/tui/ui/dialog-select.tsx:302
- Type: long-function
- Auto-fixable: No

**Function is 33 lines long**
- File: src/cli/cmd/tui/ui/spinner.ts:199
- Type: long-function
- Auto-fixable: No

**Function is 33 lines long**
- File: src/cli/cmd/tui/ui/spinner.ts:336
- Type: long-function
- Auto-fixable: No

**Function is 37 lines long**
- File: src/cli/cmd/tui/ui/toast.tsx:12
- Type: long-function
- Auto-fixable: No

**Function is 34 lines long**
- File: src/cli/cmd/tui/ui/toast.tsx:50
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/ui/toast.tsx:67
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/context/exit.tsx:9
- Type: any-type
- Auto-fixable: No

**Function is 31 lines long**
- File: src/cli/cmd/tui/context/file-tree.tsx:58
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/context/kv.tsx:39
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/context/kv.tsx:42
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/context/sdk.tsx:24
- Type: any-type
- Auto-fixable: No

**Function is 44 lines long**
- File: src/cli/cmd/tui/context/theme.tsx:233
- Type: long-function
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: src/cli/cmd/tui/context/theme.tsx:423
- Type: triple-equals
- Auto-fixable: Yes

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/tui/component/dialog-model.tsx:27
- Type: any-type
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: src/cli/cmd/tui/component/dialog-provider.tsx:92
- Type: triple-equals
- Auto-fixable: Yes

**Function is 49 lines long**
- File: src/cli/cmd/tui/component/dialog-provider.tsx:131
- Type: long-function
- Auto-fixable: No

**Function is 37 lines long**
- File: src/cli/cmd/tui/component/dialog-provider.tsx:187
- Type: long-function
- Auto-fixable: No

**Function is 35 lines long**
- File: src/cli/cmd/tui/component/dialog-provider.tsx:229
- Type: long-function
- Auto-fixable: No

**Function is 35 lines long**
- File: src/cli/cmd/tui/component/chain-widget.tsx:156
- Type: long-function
- Auto-fixable: No

**Function is 47 lines long**
- File: src/cli/cmd/tui/component/did-you-know.tsx:39
- Type: long-function
- Auto-fixable: No

**Function is 45 lines long**
- File: src/cli/cmd/tui/component/dialog-theme-list.tsx:6
- Type: long-function
- Auto-fixable: No

**Function is 38 lines long**
- File: src/cli/cmd/tui/component/dialog-tag.tsx:7
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/cli/cmd/github/run.ts:237
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/learning/integration.ts:95
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/server/routes/global.ts:65
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/share/share.ts:13
- Type: any-type
- Auto-fixable: No

**Duplicate code detected**
- File: src/file/ripgrep.ts:165
- Type: duplicate-code
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/file/ripgrep.ts:168
- Type: any-type
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: src/acp/agent.ts:110
- Type: triple-equals
- Auto-fixable: Yes

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:51
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:81
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:154
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:163
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:175
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:187
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:201
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:262
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:379
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:396
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:419
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:452
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/provider.ts:1074
- Type: any-type
- Auto-fixable: No

**Function is 48 lines long**
- File: src/provider/kilocode.ts:86
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/transform.ts:107
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/transform.ts:108
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/transform.ts:111
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/transform.ts:518
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/transform.ts:600
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/transform.ts:609
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/transform.ts:627
- Type: any-type
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: src/provider/transform.ts:630
- Type: triple-equals
- Auto-fixable: Yes

**Function is 31 lines long**
- File: src/provider/ollama.ts:46
- Type: long-function
- Auto-fixable: No

**Function is 41 lines long**
- File: src/provider/ollama.ts:201
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/sdk/openai-compatible/src/openai-compatible-provider.ts:44
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/sdk/openai-compatible/src/openai-compatible-provider.ts:46
- Type: any-type
- Auto-fixable: No

**Function is 46 lines long**
- File: src/provider/sdk/openai-compatible/src/openai-compatible-provider.ts:52
- Type: long-function
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: src/provider/sdk/openai-compatible/src/responses/openai-responses-prepare-tools.ts:40
- Type: triple-equals
- Auto-fixable: Yes

**Use '===' instead of '==' for strict equality**
- File: src/provider/sdk/openai-compatible/src/responses/openai-responses-prepare-tools.ts:107
- Type: triple-equals
- Auto-fixable: Yes

**Use '===' instead of '==' for strict equality**
- File: src/provider/sdk/openai-compatible/src/responses/openai-responses-prepare-tools.ts:146
- Type: triple-equals
- Auto-fixable: Yes

**Avoid using 'any' type - use specific type or unknown**
- File: src/provider/sdk/openai-compatible/src/responses/openai-error.ts:19
- Type: any-type
- Auto-fixable: No

**Function is 31 lines long**
- File: src/provider/antigravity/storage.ts:55
- Type: long-function
- Auto-fixable: No

**Function is 31 lines long**
- File: src/provider/antigravity/index.ts:28
- Type: long-function
- Auto-fixable: No

**Function is 34 lines long**
- File: src/provider/antigravity/index.ts:84
- Type: long-function
- Auto-fixable: No

**Function is 43 lines long**
- File: src/provider/antigravity/oauth.ts:187
- Type: long-function
- Auto-fixable: No

**Function is 40 lines long**
- File: src/provider/antigravity/oauth.ts:234
- Type: long-function
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: src/format/formatter.ts:207
- Type: triple-equals
- Auto-fixable: Yes

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/task.ts:158
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/brain.ts:235
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/tool.ts:9
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/tool.ts:22
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/mcpadd.ts:92
- Type: any-type
- Auto-fixable: No

**Function is 31 lines long**
- File: src/tool/webfetch.ts:140
- Type: long-function
- Auto-fixable: No

**Function is 35 lines long**
- File: src/tool/edit.ts:573
- Type: long-function
- Auto-fixable: No

**Function is 38 lines long**
- File: src/tool/edit.ts:609
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/browser.ts:76
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/browser.ts:234
- Type: any-type
- Auto-fixable: No

**Function is 31 lines long**
- File: src/tool/learn.ts:68
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/learn.ts:68
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/learn.ts:100
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/learn.ts:127
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/learn.ts:155
- Type: any-type
- Auto-fixable: No

**Function is 33 lines long**
- File: src/tool/learn.ts:180
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/learn.ts:180
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/finance/index.ts:59
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/finance/index.ts:60
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/finance/index.ts:61
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/finance/index.ts:62
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/finance/index.ts:63
- Type: any-type
- Auto-fixable: No

**Function is 40 lines long**
- File: src/tool/finance/index.ts:267
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/finance/index.ts:267
- Type: any-type
- Auto-fixable: No

**Function is 36 lines long**
- File: src/tool/finance/technical.ts:52
- Type: long-function
- Auto-fixable: No

**Function is 44 lines long**
- File: src/tool/finance/logic.ts:26
- Type: long-function
- Auto-fixable: No

**Function is 35 lines long**
- File: src/tool/finance/logic.ts:82
- Type: long-function
- Auto-fixable: No

**Function is 34 lines long**
- File: src/tool/finance/logic.ts:135
- Type: long-function
- Auto-fixable: No

**Function is 41 lines long**
- File: src/tool/finance/logic.ts:189
- Type: long-function
- Auto-fixable: No

**Function is 37 lines long**
- File: src/tool/finance/providers/yahoo.ts:68
- Type: long-function
- Auto-fixable: No

**Function is 39 lines long**
- File: src/tool/finance/providers/yahoo.ts:116
- Type: long-function
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: src/tool/finance/providers/yahoo.ts:143
- Type: triple-equals
- Auto-fixable: Yes

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/finance/providers/crypto.ts:164
- Type: any-type
- Auto-fixable: No

**Function is 44 lines long**
- File: src/tool/finance/providers/crypto.ts:177
- Type: long-function
- Auto-fixable: No

**Function is 37 lines long**
- File: src/tool/finance/providers/crypto.ts:225
- Type: long-function
- Auto-fixable: No

**Function is 46 lines long**
- File: src/tool/finance/providers/crypto.ts:266
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/tool/finance/providers/crypto.ts:345
- Type: any-type
- Auto-fixable: No

**Function is 31 lines long**
- File: src/tool/finance/providers/crypto.ts:380
- Type: long-function
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/project/state.ts:5
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/project/state.ts:6
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/lsp/index.ts:365
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/lsp/index.ts:366
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/lsp/server/languages/lua.ts:76
- Type: any-type
- Auto-fixable: No

**Use '===' instead of '==' for strict equality**
- File: src/lsp/server/languages/jdtls.ts:31
- Type: triple-equals
- Auto-fixable: Yes

**Avoid using 'any' type - use specific type or unknown**
- File: src/lsp/server/languages/zls.ts:74
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/bus/index.ts:9
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/bus/index.ts:90
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/bus/index.ts:94
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/bus/global.ts:7
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/flow/context.ts:14
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/flow/context.ts:18
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/flow/runner.ts:10
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/flow/runner.ts:16
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/installation/index.ts:242
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/installation/index.ts:258
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/installation/index.ts:266
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/storage/storage.ts:134
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/storage/storage.ts:135
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/permission/next.ts:106
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/permission/index.ts:61
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/browser/index.ts:38
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/browser/index.ts:62
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/rpc.ts:3
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/rpc.ts:24
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/rpc.ts:25
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/log.ts:24
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/log.ts:25
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/log.ts:26
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/log.ts:27
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/log.ts:53
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/log.ts:69
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/log.ts:109
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/log.ts:128
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/log.ts:133
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/log.ts:138
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/log.ts:143
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/util/signal.ts:2
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/question/index.ts:89
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/session/prompt.ts:668
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/session/prompt.ts:675
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/session/prompt.ts:1399
- Type: any-type
- Auto-fixable: No

**Avoid using 'any' type - use specific type or unknown**
- File: src/session/processor.ts:390
- Type: any-type
- Auto-fixable: No

### LOW (883)

**Magic number 23 should be a named constant**
- File: parsers-config.ts:9
- Type: magic-number
- Auto-fixable: Yes

**Magic number 25 should be a named constant**
- File: parsers-config.ts:37
- Type: magic-number
- Auto-fixable: Yes

**Magic number 23 should be a named constant**
- File: parsers-config.ts:49
- Type: magic-number
- Auto-fixable: Yes

**Magic number 23 should be a named constant**
- File: parsers-config.ts:61
- Type: magic-number
- Auto-fixable: Yes

**Magic number 25 should be a named constant**
- File: parsers-config.ts:73
- Type: magic-number
- Auto-fixable: Yes

**Magic number 23 should be a named constant**
- File: parsers-config.ts:94
- Type: magic-number
- Auto-fixable: Yes

**Magic number 23 should be a named constant**
- File: parsers-config.ts:106
- Type: magic-number
- Auto-fixable: Yes

**Magic number 23 should be a named constant**
- File: parsers-config.ts:138
- Type: magic-number
- Auto-fixable: Yes

**Magic number 23 should be a named constant**
- File: parsers-config.ts:181
- Type: magic-number
- Auto-fixable: Yes

**Magic number 25 should be a named constant**
- File: parsers-config.ts:190
- Type: magic-number
- Auto-fixable: Yes

**Magic number 23 should be a named constant**
- File: parsers-config.ts:199
- Type: magic-number
- Auto-fixable: Yes

**Magic number 13 should be a named constant**
- File: parsers-config.ts:217
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: test/cli/tui/transcript.test.ts:22
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000 should be a named constant**
- File: test/cli/tui/transcript.test.ts:24
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20250514 should be a named constant**
- File: test/cli/tui/transcript.test.ts:29
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000 should be a named constant**
- File: test/cli/tui/transcript.test.ts:38
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20250514 should be a named constant**
- File: test/cli/tui/transcript.test.ts:40
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000 should be a named constant**
- File: test/cli/tui/transcript.test.ts:183
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: test/cli/tui/transcript.test.ts:202
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000 should be a named constant**
- File: test/cli/tui/transcript.test.ts:204
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20250514 should be a named constant**
- File: test/cli/tui/transcript.test.ts:208
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000000000 should be a named constant**
- File: test/cli/tui/transcript.test.ts:218
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000000000 should be a named constant**
- File: test/cli/tui/transcript.test.ts:228
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: test/cli/tui/transcript.test.ts:243
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000000100 should be a named constant**
- File: test/cli/tui/transcript.test.ts:245
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20250514 should be a named constant**
- File: test/cli/tui/transcript.test.ts:258
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000000000 should be a named constant**
- File: test/cli/tui/transcript.test.ts:267
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: test/cli/tui/transcript.test.ts:281
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000000100 should be a named constant**
- File: test/cli/tui/transcript.test.ts:283
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: test/server/session-select.test.ts:58
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: test/server/session-select.test.ts:74
- Type: magic-number
- Auto-fixable: Yes

**Magic number 36 should be a named constant**
- File: test/fixture/fixture.ts:19
- Type: magic-number
- Auto-fixable: Yes

**Magic number 36 should be a named constant**
- File: test/snapshot/snapshot.test.ts:11
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1024 should be a named constant**
- File: test/snapshot/snapshot.test.ts:160
- Type: magic-number
- Auto-fixable: Yes

**Magic number 303 should be a named constant**
- File: test/snapshot/snapshot.test.ts:281
- Type: magic-number
- Auto-fixable: Yes

**Magic number 600 should be a named constant**
- File: test/snapshot/snapshot.test.ts:361
- Type: magic-number
- Auto-fixable: Yes

**Magic number 755 should be a named constant**
- File: test/snapshot/snapshot.test.ts:362
- Type: magic-number
- Auto-fixable: Yes

**Magic number 644 should be a named constant**
- File: test/snapshot/snapshot.test.ts:363
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3 should be a named constant**
- File: test/provider/transform.test.ts:28
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: test/provider/transform.test.ts:29
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3 should be a named constant**
- File: test/provider/transform.test.ts:30
- Type: magic-number
- Auto-fixable: Yes

**Magic number 200000 should be a named constant**
- File: test/provider/transform.test.ts:33
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8192 should be a named constant**
- File: test/provider/transform.test.ts:34
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16000 should be a named constant**
- File: test/provider/transform.test.ts:86
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16000 should be a named constant**
- File: test/provider/transform.test.ts:99
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16000 should be a named constant**
- File: test/provider/transform.test.ts:113
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16000 should be a named constant**
- File: test/provider/transform.test.ts:127
- Type: magic-number
- Auto-fixable: Yes

**Magic number 10000 should be a named constant**
- File: test/provider/transform.test.ts:137
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30000 should be a named constant**
- File: test/provider/transform.test.ts:149
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20000 should be a named constant**
- File: test/provider/transform.test.ts:153
- Type: magic-number
- Auto-fixable: Yes

**Magic number 10000 should be a named constant**
- File: test/provider/transform.test.ts:161
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: test/provider/transform.test.ts:232
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2 should be a named constant**
- File: test/provider/transform.test.ts:233
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: test/provider/transform.test.ts:234
- Type: magic-number
- Auto-fixable: Yes

**Magic number 128000 should be a named constant**
- File: test/provider/transform.test.ts:237
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8192 should be a named constant**
- File: test/provider/transform.test.ts:238
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4 should be a named constant**
- File: test/provider/transform.test.ts:243
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3 should be a named constant**
- File: test/provider/transform.test.ts:288
- Type: magic-number
- Auto-fixable: Yes

**Magic number 6 should be a named constant**
- File: test/provider/transform.test.ts:289
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: test/provider/transform.test.ts:290
- Type: magic-number
- Auto-fixable: Yes

**Magic number 128000 should be a named constant**
- File: test/provider/transform.test.ts:293
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4096 should be a named constant**
- File: test/provider/transform.test.ts:294
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4 should be a named constant**
- File: test/provider/transform.test.ts:299
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3 should be a named constant**
- File: test/provider/transform.test.ts:330
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: test/provider/transform.test.ts:331
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3 should be a named constant**
- File: test/provider/transform.test.ts:332
- Type: magic-number
- Auto-fixable: Yes

**Magic number 200000 should be a named constant**
- File: test/provider/transform.test.ts:335
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8192 should be a named constant**
- File: test/provider/transform.test.ts:336
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3 should be a named constant**
- File: test/provider/transform.test.ts:433
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: test/provider/transform.test.ts:434
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3 should be a named constant**
- File: test/provider/transform.test.ts:435
- Type: magic-number
- Auto-fixable: Yes

**Magic number 200000 should be a named constant**
- File: test/provider/transform.test.ts:438
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8192 should be a named constant**
- File: test/provider/transform.test.ts:439
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: test/provider/transform.test.ts:608
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2 should be a named constant**
- File: test/provider/transform.test.ts:609
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: test/provider/transform.test.ts:610
- Type: magic-number
- Auto-fixable: Yes

**Magic number 128000 should be a named constant**
- File: test/provider/transform.test.ts:613
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8192 should be a named constant**
- File: test/provider/transform.test.ts:614
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: test/provider/transform.test.ts:619
- Type: magic-number
- Auto-fixable: Yes

**Magic number 6 should be a named constant**
- File: test/provider/transform.test.ts:928
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2025 should be a named constant**
- File: test/provider/transform.test.ts:939
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: test/provider/transform.test.ts:948
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2025 should be a named constant**
- File: test/provider/transform.test.ts:954
- Type: magic-number
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: test/provider/transform.test.ts:963
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16000 should be a named constant**
- File: test/provider/transform.test.ts:986
- Type: magic-number
- Auto-fixable: Yes

**Magic number 31999 should be a named constant**
- File: test/provider/transform.test.ts:992
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16000 should be a named constant**
- File: test/provider/transform.test.ts:1036
- Type: magic-number
- Auto-fixable: Yes

**Magic number 24576 should be a named constant**
- File: test/provider/transform.test.ts:1042
- Type: magic-number
- Auto-fixable: Yes

**Magic number 429 should be a named constant**
- File: test/provider/fallback.test.ts:11
- Type: magic-number
- Auto-fixable: Yes

**Magic number 429 should be a named constant**
- File: test/provider/fallback.test.ts:12
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/provider/fallback.test.ts:117
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/provider/fallback.test.ts:120
- Type: console-log
- Auto-fixable: Yes

**Magic number 128000 should be a named constant**
- File: test/provider/provider.test.ts:225
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4096 should be a named constant**
- File: test/provider/provider.test.ts:226
- Type: magic-number
- Auto-fixable: Yes

**Magic number 60000 should be a named constant**
- File: test/provider/provider.test.ts:260
- Type: magic-number
- Auto-fixable: Yes

**Magic number 60000 should be a named constant**
- File: test/provider/provider.test.ts:277
- Type: magic-number
- Auto-fixable: Yes

**Magic number 128000 should be a named constant**
- File: test/provider/provider.test.ts:427
- Type: magic-number
- Auto-fixable: Yes

**Magic number 128000 should be a named constant**
- File: test/provider/provider.test.ts:466
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8000 should be a named constant**
- File: test/provider/provider.test.ts:654
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8000 should be a named constant**
- File: test/provider/provider.test.ts:693
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8000 should be a named constant**
- File: test/provider/provider.test.ts:849
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8000 should be a named constant**
- File: test/provider/provider.test.ts:886
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: test/provider/provider.test.ts:889
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: test/provider/provider.test.ts:908
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30000 should be a named constant**
- File: test/provider/provider.test.ts:989
- Type: magic-number
- Auto-fixable: Yes

**Magic number 60000 should be a named constant**
- File: test/provider/provider.test.ts:992
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30000 should be a named constant**
- File: test/provider/provider.test.ts:1009
- Type: magic-number
- Auto-fixable: Yes

**Magic number 60000 should be a named constant**
- File: test/provider/provider.test.ts:1010
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8192 should be a named constant**
- File: test/provider/provider.test.ts:1031
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11434 should be a named constant**
- File: test/provider/provider.test.ts:1036
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11434 should be a named constant**
- File: test/provider/provider.test.ts:1050
- Type: magic-number
- Auto-fixable: Yes

**Use 'let' or 'const' instead of 'var'**
- File: test/provider/provider.test.ts:1090
- Type: var-usage
- Auto-fixable: Yes

**Magic number 8000 should be a named constant**
- File: test/provider/provider.test.ts:1106
- Type: magic-number
- Auto-fixable: Yes

**Use 'let' or 'const' instead of 'var'**
- File: test/provider/provider.test.ts:1132
- Type: var-usage
- Auto-fixable: Yes

**Magic number 8000 should be a named constant**
- File: test/provider/provider.test.ts:1148
- Type: magic-number
- Auto-fixable: Yes

**Magic number 999 should be a named constant**
- File: test/provider/provider.test.ts:1186
- Type: magic-number
- Auto-fixable: Yes

**Magic number 888 should be a named constant**
- File: test/provider/provider.test.ts:1187
- Type: magic-number
- Auto-fixable: Yes

**Magic number 999 should be a named constant**
- File: test/provider/provider.test.ts:1205
- Type: magic-number
- Auto-fixable: Yes

**Magic number 888 should be a named constant**
- File: test/provider/provider.test.ts:1206
- Type: magic-number
- Auto-fixable: Yes

**Magic number 32000 should be a named constant**
- File: test/provider/provider.test.ts:1231
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4000 should be a named constant**
- File: test/provider/provider.test.ts:1311
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4000 should be a named constant**
- File: test/provider/provider.test.ts:1346
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4000 should be a named constant**
- File: test/provider/provider.test.ts:1381
- Type: magic-number
- Auto-fixable: Yes

**Use 'let' or 'const' instead of 'var'**
- File: test/provider/provider.test.ts:1408
- Type: var-usage
- Auto-fixable: Yes

**Magic number 4000 should be a named constant**
- File: test/provider/provider.test.ts:1424
- Type: magic-number
- Auto-fixable: Yes

**Use 'let' or 'const' instead of 'var'**
- File: test/provider/provider.test.ts:1442
- Type: var-usage
- Auto-fixable: Yes

**Magic number 4000 should be a named constant**
- File: test/provider/provider.test.ts:1490
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30000 should be a named constant**
- File: test/provider/provider.test.ts:1707
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30000 should be a named constant**
- File: test/provider/provider.test.ts:1723
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8000 should be a named constant**
- File: test/provider/provider.test.ts:1744
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20000 should be a named constant**
- File: test/provider/provider.test.ts:1891
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20000 should be a named constant**
- File: test/provider/provider.test.ts:1912
- Type: magic-number
- Auto-fixable: Yes

**Magic number 128000 should be a named constant**
- File: test/provider/provider.test.ts:2089
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: test/provider/provider.test.ts:2094
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: test/provider/provider.test.ts:2118
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4 should be a named constant**
- File: test/provider/ollama.test.ts:13
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4000000000 should be a named constant**
- File: test/provider/ollama.test.ts:14
- Type: magic-number
- Auto-fixable: Yes

**Use 'let' or 'const' instead of 'var'**
- File: test/provider/amazon-bedrock.test.ts:72
- Type: var-usage
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: test/config/markdown.test.ts:27
- Type: magic-number
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: test/config/markdown.test.ts:28
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: test/config/markdown.test.ts:76
- Type: magic-number
- Auto-fixable: Yes

**Magic number 38 should be a named constant**
- File: test/config/agent-color.test.ts:57
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: test/tool/websearch.test.ts:168
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: test/tool/websearch.test.ts:176
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/edit.test.ts:325
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/edit.test.ts:335
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/edit.test.ts:338
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/edit.test.ts:346
- Type: console-log
- Auto-fixable: Yes

**Magic number 90 should be a named constant**
- File: test/tool/truncation.test.ts:33
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2000 should be a named constant**
- File: test/tool/truncation.test.ts:67
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: test/tool/truncation.test.ts:68
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3600000 should be a named constant**
- File: test/tool/finance.test.ts:114
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000 should be a named constant**
- File: test/tool/finance.test.ts:119
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: test/tool/finance.test.ts:144
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: test/tool/finance.test.ts:157
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: test/tool/finance.test.ts:159
- Type: magic-number
- Auto-fixable: Yes

**Magic number 102 should be a named constant**
- File: test/tool/finance.test.ts:161
- Type: magic-number
- Auto-fixable: Yes

**Magic number 99 should be a named constant**
- File: test/tool/finance.test.ts:162
- Type: magic-number
- Auto-fixable: Yes

**Magic number 101 should be a named constant**
- File: test/tool/finance.test.ts:163
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: test/tool/finance.test.ts:169
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: test/tool/finance.test.ts:181
- Type: magic-number
- Auto-fixable: Yes

**Magic number 110 should be a named constant**
- File: test/tool/finance.test.ts:188
- Type: magic-number
- Auto-fixable: Yes

**Magic number 90 should be a named constant**
- File: test/tool/finance.test.ts:190
- Type: magic-number
- Auto-fixable: Yes

**Magic number 98 should be a named constant**
- File: test/tool/finance.test.ts:193
- Type: magic-number
- Auto-fixable: Yes

**Magic number 95 should be a named constant**
- File: test/tool/finance.test.ts:194
- Type: magic-number
- Auto-fixable: Yes

**Magic number 101 should be a named constant**
- File: test/tool/finance.test.ts:195
- Type: magic-number
- Auto-fixable: Yes

**Magic number 99 should be a named constant**
- File: test/tool/finance.test.ts:196
- Type: magic-number
- Auto-fixable: Yes

**Magic number 99 should be a named constant**
- File: test/tool/finance.test.ts:197
- Type: magic-number
- Auto-fixable: Yes

**Magic number 85 should be a named constant**
- File: test/tool/finance.test.ts:215
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000 should be a named constant**
- File: test/tool/finance.test.ts:226
- Type: magic-number
- Auto-fixable: Yes

**Magic number 95000000 should be a named constant**
- File: test/tool/finance.test.ts:227
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2 should be a named constant**
- File: test/tool/finance.test.ts:229
- Type: magic-number
- Auto-fixable: Yes

**Magic number 95 should be a named constant**
- File: test/tool/finance.test.ts:230
- Type: magic-number
- Auto-fixable: Yes

**Magic number 99 should be a named constant**
- File: test/tool/finance.test.ts:246
- Type: magic-number
- Auto-fixable: Yes

**Magic number 98 should be a named constant**
- File: test/tool/finance.test.ts:247
- Type: magic-number
- Auto-fixable: Yes

**Magic number 101 should be a named constant**
- File: test/tool/finance.test.ts:250
- Type: magic-number
- Auto-fixable: Yes

**Magic number 102 should be a named constant**
- File: test/tool/finance.test.ts:251
- Type: magic-number
- Auto-fixable: Yes

**Magic number 103 should be a named constant**
- File: test/tool/finance.test.ts:252
- Type: magic-number
- Auto-fixable: Yes

**Magic number 99 should be a named constant**
- File: test/tool/finance.test.ts:263
- Type: magic-number
- Auto-fixable: Yes

**Magic number 98 should be a named constant**
- File: test/tool/finance.test.ts:264
- Type: magic-number
- Auto-fixable: Yes

**Magic number 101 should be a named constant**
- File: test/tool/finance.test.ts:267
- Type: magic-number
- Auto-fixable: Yes

**Magic number 102 should be a named constant**
- File: test/tool/finance.test.ts:268
- Type: magic-number
- Auto-fixable: Yes

**Magic number 103 should be a named constant**
- File: test/tool/finance.test.ts:269
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5 should be a named constant**
- File: test/tool/finance.test.ts:280
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2 should be a named constant**
- File: test/tool/finance.test.ts:284
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: test/tool/finance.test.ts:288
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:372
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:374
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:385
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:387
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:403
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:405
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:416
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:418
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:429
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:431
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:450
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:459
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:475
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: test/tool/finance.test.ts:487
- Type: console-log
- Auto-fixable: Yes

**Magic number 14159 should be a named constant**
- File: test/tool/write.test.ts:266
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: test/tool/read.test.ts:232
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3000 should be a named constant**
- File: test/tool/read.test.ts:252
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3000 should be a named constant**
- File: test/tool/read.test.ts:262
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: test/agent/agent.test.ts:233
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: test/agent/agent.test.ts:243
- Type: magic-number
- Auto-fixable: Yes

**Magic number 123 should be a named constant**
- File: test/agent/agent.test.ts:306
- Type: magic-number
- Auto-fixable: Yes

**Magic number 123 should be a named constant**
- File: test/agent/agent.test.ts:316
- Type: magic-number
- Auto-fixable: Yes

**Magic number 10000 should be a named constant**
- File: test/flow/flow.test.ts:45
- Type: magic-number
- Auto-fixable: Yes

**Magic number 42 should be a named constant**
- File: test/util/lazy.test.ts:26
- Type: magic-number
- Auto-fixable: Yes

**Magic number 123 should be a named constant**
- File: test/util/lazy.test.ts:39
- Type: magic-number
- Auto-fixable: Yes

**Magic number 123 should be a named constant**
- File: test/util/lazy.test.ts:45
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: test/util/timeout.test.ts:19
- Type: magic-number
- Auto-fixable: Yes

**Magic number 42 should be a named constant**
- File: test/util/iife.test.ts:13
- Type: magic-number
- Auto-fixable: Yes

**Variable 'projectRoot' appears to be unused**
- File: test/session/revert-compact.test.ts:12
- Type: dead-code
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: test/session/retry.test.ts:14
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2000 should be a named constant**
- File: test/session/retry.test.ts:17
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1500 should be a named constant**
- File: test/session/retry.test.ts:22
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30000 should be a named constant**
- File: test/session/retry.test.ts:27
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20000 should be a named constant**
- File: test/session/retry.test.ts:31
- Type: magic-number
- Auto-fixable: Yes

**Magic number 19000 should be a named constant**
- File: test/session/retry.test.ts:34
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20000 should be a named constant**
- File: test/session/retry.test.ts:35
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2000 should be a named constant**
- File: test/session/retry.test.ts:40
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2000 should be a named constant**
- File: test/session/retry.test.ts:45
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: test/session/retry.test.ts:49
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2000 should be a named constant**
- File: test/session/retry.test.ts:51
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50000 should be a named constant**
- File: test/session/retry.test.ts:56
- Type: magic-number
- Auto-fixable: Yes

**Magic number 700000 should be a named constant**
- File: test/session/retry.test.ts:59
- Type: magic-number
- Auto-fixable: Yes

**Magic number 32 should be a named constant**
- File: test/session/retry.test.ts:62
- Type: magic-number
- Auto-fixable: Yes

**Magic number 10000 should be a named constant**
- File: test/session/retry.test.ts:95
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4000 should be a named constant**
- File: test/session/compaction.test.ts:109
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: test/session/compaction.test.ts:115
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1500 should be a named constant**
- File: test/session/compaction.test.ts:131
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1500 should be a named constant**
- File: test/session/compaction.test.ts:149
- Type: magic-number
- Auto-fixable: Yes

**Magic number 800 should be a named constant**
- File: test/session/compaction.test.ts:154
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1500 should be a named constant**
- File: test/session/compaction.test.ts:165
- Type: magic-number
- Auto-fixable: Yes

**Magic number 300 should be a named constant**
- File: test/session/compaction.test.ts:169
- Type: magic-number
- Auto-fixable: Yes

**Magic number 300 should be a named constant**
- File: test/session/compaction.test.ts:174
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1500 should be a named constant**
- File: test/session/compaction.test.ts:184
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1500 should be a named constant**
- File: test/session/compaction.test.ts:203
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: test/session/compaction.test.ts:236
- Type: magic-number
- Auto-fixable: Yes

**Magic number 75 should be a named constant**
- File: test/session/compaction.test.ts:237
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: script/schema.ts:7
- Type: console-log
- Auto-fixable: Yes

**Magic number 2020 should be a named constant**
- File: script/schema.ts:16
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: script/publish-registries.ts:111
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: script/publish.ts:13
- Type: console-log
- Auto-fixable: Yes

**Magic number 755 should be a named constant**
- File: script/publish.ts:43
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/shim.ts:7
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/index.ts:184
- Type: console-log
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: src/cli/cmd/refactor.ts:77
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/cli/cmd/refactor.ts:81
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/refactor.ts:119
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:535
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:545
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:549
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:553
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:562
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:568
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:572
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:573
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:574
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:577
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:578
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/refactor.ts:582
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:382
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:383
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:390
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:398
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:402
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:404
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:405
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:406
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:407
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:414
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:418
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:422
- Type: console-log
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/workspace.ts:423
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:424
- Type: console-log
- Auto-fixable: Yes

**Magic number 80 should be a named constant**
- File: src/cli/cmd/workspace.ts:425
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:425
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:426
- Type: console-log
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/workspace.ts:429
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/workspace.ts:430
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:430
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:437
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:441
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:443
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:446
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:449
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:451
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:459
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:464
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:465
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:466
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:467
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:468
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:469
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:470
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/workspace.ts:473
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:164
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:314
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:315
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:316
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:317
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:318
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:319
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:320
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:321
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:324
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:325
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:326
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:330
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:331
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:332
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:334
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:335
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:336
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:337
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:338
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:339
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:340
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:347
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:348
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:349
- Type: console-log
- Auto-fixable: Yes

**Magic number 54 should be a named constant**
- File: src/cli/cmd/stats.ts:352
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:352
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:353
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:354
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:355
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:356
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:357
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:361
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:363
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:370
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:371
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:372
- Type: console-log
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/stats.ts:378
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/stats.ts:386
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:388
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:390
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/stats.ts:392
- Type: console-log
- Auto-fixable: Yes

**Magic number 1000000 should be a named constant**
- File: src/cli/cmd/stats.ts:396
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000 should be a named constant**
- File: src/cli/cmd/stats.ts:397
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1024 should be a named constant**
- File: src/cli/cmd/uninstall.ts:332
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1024 should be a named constant**
- File: src/cli/cmd/uninstall.ts:333
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1024 should be a named constant**
- File: src/cli/cmd/uninstall.ts:334
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1024 should be a named constant**
- File: src/cli/cmd/uninstall.ts:335
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/agent.ts:208
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/agent.ts:218
- Type: console-log
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/security.ts:124
- Type: magic-number
- Auto-fixable: Yes

**Magic number 40 should be a named constant**
- File: src/cli/cmd/security.ts:129
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/security.ts:139
- Type: magic-number
- Auto-fixable: Yes

**Magic number 36 should be a named constant**
- File: src/cli/cmd/security.ts:154
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/security.ts:169
- Type: magic-number
- Auto-fixable: Yes

**Magic number 48 should be a named constant**
- File: src/cli/cmd/security.ts:174
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/security.ts:495
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/security.ts:515
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/security.ts:524
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/security.ts:528
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/security.ts:534
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/security.ts:541
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/security.ts:549
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/security.ts:553
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/security.ts:557
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/features.ts:110
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/features.ts:111
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/docs.ts:485
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/docs.ts:491
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/docs.ts:501
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/docs.ts:512
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/docs.ts:515
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/docs.ts:519
- Type: console-log
- Auto-fixable: Yes

**Magic number 4096 should be a named constant**
- File: src/cli/cmd/run.ts:85
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/cli/cmd/run.ts:305
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/cli/cmd/run.ts:378
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/skill.ts:46
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/skill.ts:47
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/skill.ts:48
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/skill.ts:88
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/skill.ts:91
- Type: console-log
- Auto-fixable: Yes

**Magic number 99 should be a named constant**
- File: src/cli/cmd/auth.ts:288
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/session.ts:100
- Type: console-log
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/session.ts:109
- Type: magic-number
- Auto-fixable: Yes

**Magic number 25 should be a named constant**
- File: src/cli/cmd/session.ts:110
- Type: magic-number
- Auto-fixable: Yes

**Magic number 42 should be a named constant**
- File: src/cli/cmd/review.ts:182
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:485
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:495
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:496
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:497
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:498
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:499
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:500
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:501
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:502
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:505
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:513
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:515
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:527
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:532
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:534
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:539
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:543
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/review.ts:546
- Type: console-log
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/perf.ts:228
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/perf.ts:480
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/perf.ts:530
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/perf.ts:540
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/perf.ts:543
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/perf.ts:547
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/perf.ts:552
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/perf.ts:557
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/perf.ts:560
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/perf.ts:563
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/test-gen.ts:409
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/test-gen.ts:420
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/test-gen.ts:430
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/test-gen.ts:434
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/test-gen.ts:437
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/test-gen.ts:439
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/test-gen.ts:446
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/serve.ts:12
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/debug/snapshot.ts:17
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/debug/snapshot.ts:33
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/debug/snapshot.ts:49
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/debug/index.ts:45
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/debug/file.ts:81
- Type: console-log
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:57
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:69
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:70
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:71
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:73
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:74
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:75
- Type: magic-number
- Auto-fixable: Yes

**Magic number 299 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:84
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:93
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/app.tsx:181
- Type: console-log
- Auto-fixable: Yes

**Magic number 52 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:211
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/app.tsx:223
- Type: console-log
- Auto-fixable: Yes

**Magic number 40 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:242
- Type: magic-number
- Auto-fixable: Yes

**Magic number 40 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:243
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3000 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:258
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:505
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:640
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:649
- Type: magic-number
- Auto-fixable: Yes

**Magic number 10000 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:658
- Type: magic-number
- Auto-fixable: Yes

**Magic number 52 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:737
- Type: magic-number
- Auto-fixable: Yes

**Magic number 6000 should be a named constant**
- File: src/cli/cmd/tui/app.tsx:800
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/cli/cmd/tui/event.ts:37
- Type: magic-number
- Auto-fixable: Yes

**Magic number 75 should be a named constant**
- File: src/cli/cmd/tui/routes/home.tsx:97
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/routes/session/index.tsx:58
- Type: console-log
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/cli/cmd/tui/routes/session/index.tsx:125
- Type: magic-number
- Auto-fixable: Yes

**Magic number 70 should be a named constant**
- File: src/cli/cmd/tui/routes/session/index.tsx:354
- Type: magic-number
- Auto-fixable: Yes

**Magic number 42 should be a named constant**
- File: src/cli/cmd/tui/routes/session/sidebar.tsx:75
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: src/cli/cmd/tui/routes/session/sidebar.tsx:245
- Type: magic-number
- Auto-fixable: Yes

**Magic number 75 should be a named constant**
- File: src/cli/cmd/tui/routes/session/sidebar.tsx:295
- Type: magic-number
- Auto-fixable: Yes

**Magic number 120 should be a named constant**
- File: src/cli/cmd/tui/routes/session/permission.tsx:45
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/cli/cmd/tui/routes/session/footer.tsx:32
- Type: magic-number
- Auto-fixable: Yes

**Magic number 120 should be a named constant**
- File: src/cli/cmd/tui/routes/session/components/tools/Edit.tsx:18
- Type: magic-number
- Auto-fixable: Yes

**Magic number 222 should be a named constant**
- File: src/cli/cmd/tui/routes/session/logic/scroll.ts:29
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3000 should be a named constant**
- File: src/cli/cmd/tui/routes/session/logic/commands.tsx:118
- Type: magic-number
- Auto-fixable: Yes

**Magic number 120 should be a named constant**
- File: src/cli/cmd/tui/routes/session/hooks/useSessionState.ts:58
- Type: magic-number
- Auto-fixable: Yes

**Magic number 42 should be a named constant**
- File: src/cli/cmd/tui/routes/session/hooks/useSessionState.ts:68
- Type: magic-number
- Auto-fixable: Yes

**Magic number 150 should be a named constant**
- File: src/cli/cmd/tui/ui/dialog.tsx:32
- Type: magic-number
- Auto-fixable: Yes

**Magic number 80 should be a named constant**
- File: src/cli/cmd/tui/ui/dialog.tsx:39
- Type: magic-number
- Auto-fixable: Yes

**Magic number 52 should be a named constant**
- File: src/cli/cmd/tui/ui/dialog.tsx:145
- Type: magic-number
- Auto-fixable: Yes

**Magic number 61 should be a named constant**
- File: src/cli/cmd/tui/ui/dialog-select.tsx:333
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/tui/ui/dialog-help.tsx:90
- Type: magic-number
- Auto-fixable: Yes

**Magic number 65 should be a named constant**
- File: src/cli/cmd/tui/ui/spinner.ts:219
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/context/sync.tsx:314
- Type: console-log
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: src/cli/cmd/tui/context/sync.tsx:315
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/context/file-tree.tsx:209
- Type: console-log
- Auto-fixable: Yes

**Magic number 3000 should be a named constant**
- File: src/cli/cmd/tui/context/local.tsx:64
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3000 should be a named constant**
- File: src/cli/cmd/tui/context/local.tsx:238
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3000 should be a named constant**
- File: src/cli/cmd/tui/context/local.tsx:271
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3000 should be a named constant**
- File: src/cli/cmd/tui/context/local.tsx:293
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3000 should be a named constant**
- File: src/cli/cmd/tui/context/local.tsx:381
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/context/route.tsx:34
- Type: console-log
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/context/sdk.tsx:65
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/context/sdk.tsx:66
- Type: magic-number
- Auto-fixable: Yes

**Magic number 299 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:115
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:116
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:234
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:235
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:257
- Type: magic-number
- Auto-fixable: Yes

**Magic number 232 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:258
- Type: magic-number
- Auto-fixable: Yes

**Magic number 36 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:262
- Type: magic-number
- Auto-fixable: Yes

**Magic number 40 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:264
- Type: magic-number
- Auto-fixable: Yes

**Magic number 232 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:268
- Type: magic-number
- Auto-fixable: Yes

**Magic number 256 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:269
- Type: magic-number
- Auto-fixable: Yes

**Magic number 232 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:270
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/context/theme.tsx:318
- Type: console-log
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:321
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/context/theme.tsx:324
- Type: console-log
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:435
- Type: magic-number
- Auto-fixable: Yes

**Magic number 22 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:456
- Type: magic-number
- Auto-fixable: Yes

**Magic number 299 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:543
- Type: magic-number
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:545
- Type: magic-number
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:546
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:555
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:560
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:563
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:564
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:565
- Type: magic-number
- Auto-fixable: Yes

**Magic number 245 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:568
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:569
- Type: magic-number
- Auto-fixable: Yes

**Magic number 299 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:595
- Type: magic-number
- Auto-fixable: Yes

**Magic number 180 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:602
- Type: magic-number
- Auto-fixable: Yes

**Magic number 160 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:605
- Type: magic-number
- Auto-fixable: Yes

**Magic number 245 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:608
- Type: magic-number
- Auto-fixable: Yes

**Magic number 75 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:610
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:635
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:636
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:637
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/context/theme.tsx:638
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2000 should be a named constant**
- File: src/cli/cmd/tui/context/keybind.tsx:40
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/util/clipboard.ts:65
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/util/clipboard.ts:74
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/util/clipboard.ts:83
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/util/clipboard.ts:96
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/util/clipboard.ts:111
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/util/clipboard.ts:119
- Type: console-log
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:6
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:38
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:39
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:40
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:41
- Type: magic-number
- Auto-fixable: Yes

**Magic number 255 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:49
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:57
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:58
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:77
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:78
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:87
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:88
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:91
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:92
- Type: magic-number
- Auto-fixable: Yes

**Magic number 299 should be a named constant**
- File: src/cli/cmd/tui/util/terminal.ts:109
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/cli/cmd/tui/component/dialog-stash.tsx:24
- Type: magic-number
- Auto-fixable: Yes

**Magic number 150 should be a named constant**
- File: src/cli/cmd/tui/component/dialog-session-list.tsx:24
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: src/cli/cmd/tui/component/dialog-session-list.tsx:28
- Type: magic-number
- Auto-fixable: Yes

**Magic number 80 should be a named constant**
- File: src/cli/cmd/tui/component/dialog-session-list.tsx:62
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2000 should be a named constant**
- File: src/cli/cmd/tui/component/file-tree.tsx:169
- Type: magic-number
- Auto-fixable: Yes

**Magic number 28 should be a named constant**
- File: src/cli/cmd/tui/component/file-tree.tsx:176
- Type: magic-number
- Auto-fixable: Yes

**Magic number 99 should be a named constant**
- File: src/cli/cmd/tui/component/dialog-provider.tsx:33
- Type: magic-number
- Auto-fixable: Yes

**Magic number 40 should be a named constant**
- File: src/cli/cmd/tui/component/code-panel.tsx:180
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/component/dialog-mcp.tsx:64
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/component/dialog-mcp.tsx:67
- Type: console-log
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/cli/cmd/tui/component/prompt/autocomplete.tsx:102
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3000 should be a named constant**
- File: src/cli/cmd/tui/component/prompt/index.tsx:81
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/cli/cmd/tui/component/prompt/index.tsx:216
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/tui/component/prompt/index.tsx:549
- Type: console-log
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/cli/cmd/tui/component/prompt/index.tsx:609
- Type: magic-number
- Auto-fixable: Yes

**Magic number 150 should be a named constant**
- File: src/cli/cmd/tui/component/prompt/index.tsx:915
- Type: magic-number
- Auto-fixable: Yes

**Magic number 40 should be a named constant**
- File: src/cli/cmd/tui/component/prompt/index.tsx:999
- Type: magic-number
- Auto-fixable: Yes

**Magic number 80 should be a named constant**
- File: src/cli/cmd/tui/component/prompt/index.tsx:1014
- Type: magic-number
- Auto-fixable: Yes

**Magic number 86400000 should be a named constant**
- File: src/cli/cmd/tui/component/prompt/frecency.tsx:10
- Type: magic-number
- Auto-fixable: Yes

**Magic number 99 should be a named constant**
- File: src/cli/cmd/github/install.ts:94
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:157
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:161
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:178
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:180
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:239
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:377
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:393
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:448
- Type: console-log
- Auto-fixable: Yes

**Magic number 40 should be a named constant**
- File: src/cli/cmd/github/run.ts:468
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:478
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:515
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:524
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:543
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:561
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:598
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:620
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:627
- Type: console-log
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/github/run.ts:629
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:635
- Type: console-log
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/github/run.ts:638
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:659
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:674
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:685
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:697
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:711
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:720
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:722
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:729
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:755
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:807
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:817
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:830
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:834
- Type: console-log
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/cli/cmd/github/run.ts:850
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:855
- Type: console-log
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/cli/cmd/github/run.ts:867
- Type: magic-number
- Auto-fixable: Yes

**Magic number 700 should be a named constant**
- File: src/cli/cmd/github/run.ts:868
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:880
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/cli/cmd/github/run.ts:949
- Type: console-log
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: src/cli/cmd/github/run.ts:1099
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/cli/cmd/mcp/debug.ts:63
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: src/cli/cmd/mcp/debug.ts:96
- Type: magic-number
- Auto-fixable: Yes

**Magic number 401 should be a named constant**
- File: src/cli/cmd/mcp/debug.ts:112
- Type: magic-number
- Auto-fixable: Yes

**Magic number 401 should be a named constant**
- File: src/cli/cmd/mcp/debug.ts:113
- Type: magic-number
- Auto-fixable: Yes

**Use 'let' or 'const' instead of 'var'**
- File: src/learning/memory.ts:108
- Type: var-usage
- Auto-fixable: Yes

**Use 'let' or 'const' instead of 'var'**
- File: src/learning/memory.ts:143
- Type: var-usage
- Auto-fixable: Yes

**Magic number 85 should be a named constant**
- File: src/learning/index.ts:83
- Type: magic-number
- Auto-fixable: Yes

**Magic number 75 should be a named constant**
- File: src/learning/index.ts:95
- Type: magic-number
- Auto-fixable: Yes

**Use 'let' or 'const' instead of 'var'**
- File: src/learning/index.ts:216
- Type: var-usage
- Auto-fixable: Yes

**Magic number 26 should be a named constant**
- File: src/worktree/index.ts:164
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/tui.ts:93
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/tui.ts:119
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/tui.ts:182
- Type: magic-number
- Auto-fixable: Yes

**Magic number 127 should be a named constant**
- File: src/server/server.ts:102
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4096 should be a named constant**
- File: src/server/server.ts:216
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/error.ts:6
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/question.ts:46
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/question.ts:81
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/project.ts:68
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/instance.ts:50
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/pty.ts:46
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/pty.ts:97
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/tool.ts:26
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/tool.ts:61
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11434 should be a named constant**
- File: src/server/routes/provider.ts:53
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/provider.ts:120
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/provider.ts:160
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/system.ts:28
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30000 should be a named constant**
- File: src/server/routes/system.ts:108
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/auth.ts:23
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/permission.ts:24
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/permission.ts:59
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/config.ts:50
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30000 should be a named constant**
- File: src/server/routes/global.ts:73
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/mcp.ts:35
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/mcp.ts:56
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/mcp.ts:62
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/mcp.ts:75
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/mcp.ts:94
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/mcp.ts:100
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/message.ts:26
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/message.ts:70
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/message.ts:103
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/message.ts:138
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/message.ts:186
- Type: magic-number
- Auto-fixable: Yes

**Magic number 204 should be a named constant**
- File: src/server/routes/session/message.ts:215
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/message.ts:218
- Type: magic-number
- Auto-fixable: Yes

**Magic number 204 should be a named constant**
- File: src/server/routes/session/message.ts:229
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/tool.ts:69
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/tool.ts:128
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/tool.ts:162
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/tool.ts:194
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/tool.ts:226
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/tool.ts:258
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/tool.ts:288
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/core.ts:67
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/core.ts:91
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/core.ts:122
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/core.ts:152
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/core.ts:174
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/core.ts:207
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/core.ts:237
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/core.ts:287
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/core.ts:350
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/server/routes/session/core.ts:379
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/file/index.ts:434
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1024 should be a named constant**
- File: src/file/ripgrep.ts:239
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20250219 should be a named constant**
- File: src/provider/provider.ts:96
- Type: magic-number
- Auto-fixable: Yes

**Magic number 128000 should be a named constant**
- File: src/provider/provider.ts:525
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8192 should be a named constant**
- File: src/provider/provider.ts:526
- Type: magic-number
- Auto-fixable: Yes

**Magic number 10000 should be a named constant**
- File: src/provider/provider.ts:1141
- Type: magic-number
- Auto-fixable: Yes

**Magic number 10000 should be a named constant**
- File: src/provider/provider.ts:1149
- Type: magic-number
- Auto-fixable: Yes

**Magic number 429 should be a named constant**
- File: src/provider/kilocode.ts:153
- Type: magic-number
- Auto-fixable: Yes

**Magic number 202 should be a named constant**
- File: src/provider/kilocode.ts:165
- Type: magic-number
- Auto-fixable: Yes

**Magic number 403 should be a named constant**
- File: src/provider/kilocode.ts:169
- Type: magic-number
- Auto-fixable: Yes

**Magic number 410 should be a named constant**
- File: src/provider/kilocode.ts:173
- Type: magic-number
- Auto-fixable: Yes

**Magic number 401 should be a named constant**
- File: src/provider/kilocode.ts:193
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/provider/kilocode.ts:232
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/provider/kilocode.ts:239
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/provider/kilocode.ts:240
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/provider/kilocode.ts:241
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/provider/kilocode.ts:245
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/provider/kilocode.ts:248
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/provider/kilocode.ts:265
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/provider/kilocode.ts:274
- Type: console-log
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: src/provider/transform.ts:329
- Type: magic-number
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: src/provider/transform.ts:332
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16000 should be a named constant**
- File: src/provider/transform.ts:354
- Type: magic-number
- Auto-fixable: Yes

**Magic number 31999 should be a named constant**
- File: src/provider/transform.ts:360
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16000 should be a named constant**
- File: src/provider/transform.ts:388
- Type: magic-number
- Auto-fixable: Yes

**Magic number 24576 should be a named constant**
- File: src/provider/transform.ts:394
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11434 should be a named constant**
- File: src/provider/ollama.ts:33
- Type: magic-number
- Auto-fixable: Yes

**Magic number 10000 should be a named constant**
- File: src/provider/ollama.ts:51
- Type: magic-number
- Auto-fixable: Yes

**Magic number 70 should be a named constant**
- File: src/provider/ollama.ts:190
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: src/provider/ollama.ts:191
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4096 should be a named constant**
- File: src/provider/ollama.ts:195
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11434 should be a named constant**
- File: src/provider/ollama.ts:214
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4096 should be a named constant**
- File: src/provider/ollama.ts:223
- Type: magic-number
- Auto-fixable: Yes

**Magic number 429 should be a named constant**
- File: src/provider/fallback.ts:45
- Type: magic-number
- Auto-fixable: Yes

**Magic number 503 should be a named constant**
- File: src/provider/fallback.ts:46
- Type: magic-number
- Auto-fixable: Yes

**Magic number 502 should be a named constant**
- File: src/provider/fallback.ts:53
- Type: magic-number
- Auto-fixable: Yes

**Magic number 504 should be a named constant**
- File: src/provider/fallback.ts:54
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/provider/fallback.ts:202
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/provider/sdk/openai-compatible/src/responses/openai-responses-language-model.ts:111
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/provider/sdk/openai-compatible/src/responses/openai-responses-language-model.ts:504
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/provider/sdk/openai-compatible/src/responses/tool/file-search.ts:61
- Type: magic-number
- Auto-fixable: Yes

**Magic number 64 should be a named constant**
- File: src/provider/sdk/openai-compatible/src/responses/tool/file-search.ts:64
- Type: magic-number
- Auto-fixable: Yes

**Magic number 512 should be a named constant**
- File: src/provider/sdk/openai-compatible/src/responses/tool/file-search.ts:65
- Type: magic-number
- Auto-fixable: Yes

**Magic number 60000 should be a named constant**
- File: src/provider/antigravity/index.ts:30
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/provider/antigravity/index.ts:107
- Type: console-log
- Auto-fixable: Yes

**Magic number 32 should be a named constant**
- File: src/provider/antigravity/oauth.ts:46
- Type: magic-number
- Auto-fixable: Yes

**Magic number 51121 should be a named constant**
- File: src/provider/antigravity/oauth.ts:234
- Type: magic-number
- Auto-fixable: Yes

**Magic number 51121 should be a named constant**
- File: src/provider/antigravity/constants.ts:20
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: src/provider/antigravity/constants.ts:44
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: src/provider/antigravity/constants.ts:51
- Type: magic-number
- Auto-fixable: Yes

**Magic number 22 should be a named constant**
- File: src/provider/antigravity/constants.ts:52
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1024 should be a named constant**
- File: src/pty/index.ts:15
- Type: magic-number
- Auto-fixable: Yes

**Magic number 64 should be a named constant**
- File: src/pty/index.ts:16
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/config/config.ts:427
- Type: magic-number
- Auto-fixable: Yes

**Magic number 7591 should be a named constant**
- File: src/config/config.ts:440
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/config/config.ts:468
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: src/config/config.ts:787
- Type: magic-number
- Auto-fixable: Yes

**Magic number 300000 should be a named constant**
- File: src/config/config.ts:852
- Type: magic-number
- Auto-fixable: Yes

**Magic number 300000 should be a named constant**
- File: src/config/config.ts:858
- Type: magic-number
- Auto-fixable: Yes

**Magic number 10000 should be a named constant**
- File: src/tool/websearch.ts:57
- Type: magic-number
- Auto-fixable: Yes

**Magic number 25000 should be a named constant**
- File: src/tool/websearch.ts:90
- Type: magic-number
- Auto-fixable: Yes

**Use 'let' or 'const' instead of 'var'**
- File: src/tool/brain.ts:118
- Type: var-usage
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/brain.ts:145
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20000 should be a named constant**
- File: src/tool/brain.ts:156
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/brain.ts:157
- Type: magic-number
- Auto-fixable: Yes

**Magic number 300 should be a named constant**
- File: src/tool/brain.ts:237
- Type: magic-number
- Auto-fixable: Yes

**Magic number 14 should be a named constant**
- File: src/tool/sysadmin.ts:22
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/read.ts:14
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2000 should be a named constant**
- File: src/tool/read.ts:21
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/tool/read.ts:109
- Type: magic-number
- Auto-fixable: Yes

**Magic number 4096 should be a named constant**
- File: src/tool/read.ts:184
- Type: magic-number
- Auto-fixable: Yes

**Magic number 13 should be a named constant**
- File: src/tool/read.ts:192
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: src/tool/read.ts:196
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1024 should be a named constant**
- File: src/tool/webfetch.ts:6
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: src/tool/webfetch.ts:7
- Type: magic-number
- Auto-fixable: Yes

**Magic number 120 should be a named constant**
- File: src/tool/webfetch.ts:8
- Type: magic-number
- Auto-fixable: Yes

**Magic number 120 should be a named constant**
- File: src/tool/webfetch.ts:18
- Type: magic-number
- Auto-fixable: Yes

**Magic number 6 should be a named constant**
- File: src/tool/edit.ts:2
- Type: magic-number
- Auto-fixable: Yes

**Magic number 6 should be a named constant**
- File: src/tool/edit.ts:4
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/edit.ts:545
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30000 should be a named constant**
- File: src/tool/browser.ts:81
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/browser.ts:98
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/truncation.ts:11
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/learn.ts:80
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50000 should be a named constant**
- File: src/tool/codesearch.ts:46
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/tool/codesearch.ts:47
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/tool/codesearch.ts:71
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30000 should be a named constant**
- File: src/tool/codesearch.ts:77
- Type: magic-number
- Auto-fixable: Yes

**Magic number 14 should be a named constant**
- File: src/tool/finance/technical.ts:52
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/finance/technical.ts:54
- Type: magic-number
- Auto-fixable: Yes

**Magic number 70 should be a named constant**
- File: src/tool/finance/technical.ts:93
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: src/tool/finance/technical.ts:94
- Type: magic-number
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: src/tool/finance/technical.ts:106
- Type: magic-number
- Auto-fixable: Yes

**Magic number 26 should be a named constant**
- File: src/tool/finance/technical.ts:107
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/tool/finance/technical.ts:135
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2 should be a named constant**
- File: src/tool/finance/technical.ts:141
- Type: magic-number
- Auto-fixable: Yes

**Magic number 98 should be a named constant**
- File: src/tool/finance/technical.ts:143
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/tool/finance/technical.ts:200
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: src/tool/finance/technical.ts:228
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: src/tool/finance/technical.ts:229
- Type: magic-number
- Auto-fixable: Yes

**Magic number 14 should be a named constant**
- File: src/tool/finance/technical.ts:236
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: src/tool/finance/technical.ts:237
- Type: magic-number
- Auto-fixable: Yes

**Magic number 14 should be a named constant**
- File: src/tool/finance/technical.ts:241
- Type: magic-number
- Auto-fixable: Yes

**Magic number 14 should be a named constant**
- File: src/tool/finance/technical.ts:243
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: src/tool/finance/technical.ts:245
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/tool/finance/technical.ts:291
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/finance/technical.ts:292
- Type: magic-number
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: src/tool/finance/technical.ts:294
- Type: magic-number
- Auto-fixable: Yes

**Magic number 26 should be a named constant**
- File: src/tool/finance/technical.ts:295
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/finance/technical.ts:329
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: src/tool/finance/logic.ts:24
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: src/tool/finance/logic.ts:32
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: src/tool/finance/logic.ts:34
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1 should be a named constant**
- File: src/tool/finance/logic.ts:54
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5 should be a named constant**
- File: src/tool/finance/logic.ts:56
- Type: magic-number
- Auto-fixable: Yes

**Magic number 75 should be a named constant**
- File: src/tool/finance/logic.ts:102
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/finance/logic.ts:133
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/finance/logic.ts:139
- Type: magic-number
- Auto-fixable: Yes

**Magic number 67 should be a named constant**
- File: src/tool/finance/logic.ts:163
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/finance/logic.ts:169
- Type: magic-number
- Auto-fixable: Yes

**Magic number 70 should be a named constant**
- File: src/tool/finance/logic.ts:266
- Type: magic-number
- Auto-fixable: Yes

**Magic number 40 should be a named constant**
- File: src/tool/finance/logic.ts:267
- Type: magic-number
- Auto-fixable: Yes

**Magic number 70 should be a named constant**
- File: src/tool/finance/logic.ts:321
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: src/tool/finance/logic.ts:323
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5 should be a named constant**
- File: src/tool/finance/logic.ts:329
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/tool/finance/providers/yahoo.ts:49
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/tool/finance/providers/yahoo.ts:55
- Type: console-log
- Auto-fixable: Yes

**Magic number 225 should be a named constant**
- File: src/tool/finance/providers/yahoo.ts:258
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1200 should be a named constant**
- File: src/tool/finance/providers/crypto.ts:85
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/tool/finance/providers/crypto.ts:101
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/tool/finance/providers/crypto.ts:107
- Type: console-log
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/tool/finance/providers/crypto.ts:217
- Type: console-log
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: src/tool/finance/providers/crypto.ts:267
- Type: magic-number
- Auto-fixable: Yes

**Magic number 25 should be a named constant**
- File: src/tool/finance/providers/crypto.ts:276
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: src/tool/finance/providers/crypto.ts:283
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/finance/providers/crypto.ts:288
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: src/tool/finance/providers/crypto.ts:299
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/finance/providers/crypto.ts:304
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/tool/finance/providers/crypto.ts:333
- Type: magic-number
- Auto-fixable: Yes

**Magic number 10000 should be a named constant**
- File: src/project/state.ts:46
- Type: magic-number
- Auto-fixable: Yes

**Magic number 19936 should be a named constant**
- File: src/bun/index.ts:88
- Type: magic-number
- Auto-fixable: Yes

**Magic number 11 should be a named constant**
- File: src/lsp/index.ts:330
- Type: magic-number
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: src/lsp/index.ts:331
- Type: magic-number
- Auto-fixable: Yes

**Magic number 13 should be a named constant**
- File: src/lsp/index.ts:332
- Type: magic-number
- Auto-fixable: Yes

**Magic number 14 should be a named constant**
- File: src/lsp/index.ts:333
- Type: magic-number
- Auto-fixable: Yes

**Magic number 15 should be a named constant**
- File: src/lsp/index.ts:334
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/lsp/index.ts:335
- Type: magic-number
- Auto-fixable: Yes

**Magic number 17 should be a named constant**
- File: src/lsp/index.ts:336
- Type: magic-number
- Auto-fixable: Yes

**Magic number 18 should be a named constant**
- File: src/lsp/index.ts:337
- Type: magic-number
- Auto-fixable: Yes

**Magic number 19 should be a named constant**
- File: src/lsp/index.ts:338
- Type: magic-number
- Auto-fixable: Yes

**Magic number 20 should be a named constant**
- File: src/lsp/index.ts:339
- Type: magic-number
- Auto-fixable: Yes

**Magic number 21 should be a named constant**
- File: src/lsp/index.ts:340
- Type: magic-number
- Auto-fixable: Yes

**Magic number 22 should be a named constant**
- File: src/lsp/index.ts:341
- Type: magic-number
- Auto-fixable: Yes

**Magic number 23 should be a named constant**
- File: src/lsp/index.ts:342
- Type: magic-number
- Auto-fixable: Yes

**Magic number 25 should be a named constant**
- File: src/lsp/index.ts:344
- Type: magic-number
- Auto-fixable: Yes

**Magic number 26 should be a named constant**
- File: src/lsp/index.ts:345
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3000 should be a named constant**
- File: src/lsp/client.ts:231
- Type: magic-number
- Auto-fixable: Yes

**Magic number 21 should be a named constant**
- File: src/lsp/server/languages/jdtls.ts:21
- Type: magic-number
- Auto-fixable: Yes

**Magic number 21 should be a named constant**
- File: src/lsp/server/languages/jdtls.ts:31
- Type: magic-number
- Auto-fixable: Yes

**Magic number 21 should be a named constant**
- File: src/lsp/server/languages/jdtls.ts:32
- Type: magic-number
- Auto-fixable: Yes

**Magic number 152 should be a named constant**
- File: src/lsp/server/languages/vue.ts:56
- Type: magic-number
- Auto-fixable: Yes

**Magic number 164 should be a named constant**
- File: src/lsp/server/languages/vue.ts:61
- Type: magic-number
- Auto-fixable: Yes

**Magic number 116 should be a named constant**
- File: src/lsp/server/languages/vue.ts:64
- Type: magic-number
- Auto-fixable: Yes

**Magic number 300 should be a named constant**
- File: src/flow/runner.ts:131
- Type: magic-number
- Auto-fixable: Yes

**Magic number 755 should be a named constant**
- File: src/permission/arity.ts:28
- Type: magic-number
- Auto-fixable: Yes

**Magic number 62 should be a named constant**
- File: src/id/id.ts:50
- Type: magic-number
- Auto-fixable: Yes

**Magic number 40 should be a named constant**
- File: src/id/id.ts:70
- Type: magic-number
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: src/id/id.ts:73
- Type: magic-number
- Auto-fixable: Yes

**Magic number 13 should be a named constant**
- File: src/id/id.ts:79
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1280 should be a named constant**
- File: src/browser/index.ts:73
- Type: magic-number
- Auto-fixable: Yes

**Magic number 64 should be a named constant**
- File: src/browser/index.ts:90
- Type: magic-number
- Auto-fixable: Yes

**Magic number 50 should be a named constant**
- File: src/browser/index.ts:92
- Type: magic-number
- Auto-fixable: Yes

**Magic number 999999 should be a named constant**
- File: src/browser/index.ts:94
- Type: magic-number
- Auto-fixable: Yes

**Magic number 300 should be a named constant**
- File: src/browser/index.ts:106
- Type: magic-number
- Auto-fixable: Yes

**Magic number 800 should be a named constant**
- File: src/browser/index.ts:109
- Type: magic-number
- Auto-fixable: Yes

**Magic number 429 should be a named constant**
- File: src/plugin/kilocode.ts:49
- Type: magic-number
- Auto-fixable: Yes

**Magic number 202 should be a named constant**
- File: src/plugin/kilocode.ts:61
- Type: magic-number
- Auto-fixable: Yes

**Magic number 403 should be a named constant**
- File: src/plugin/kilocode.ts:65
- Type: magic-number
- Auto-fixable: Yes

**Magic number 410 should be a named constant**
- File: src/plugin/kilocode.ts:69
- Type: magic-number
- Auto-fixable: Yes

**Magic number 43 should be a named constant**
- File: src/plugin/codex.ts:19
- Type: magic-number
- Auto-fixable: Yes

**Magic number 32 should be a named constant**
- File: src/plugin/codex.ts:42
- Type: magic-number
- Auto-fixable: Yes

**Magic number 131010 should be a named constant**
- File: src/plugin/codex.ts:157
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2000 should be a named constant**
- File: src/plugin/codex.ts:179
- Type: magic-number
- Auto-fixable: Yes

**Magic number 131010 should be a named constant**
- File: src/plugin/codex.ts:199
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/plugin/codex.ts:272
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/plugin/codex.ts:282
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400000 should be a named constant**
- File: src/plugin/codex.ts:384
- Type: magic-number
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: src/plugin/codex.ts:388
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3600 should be a named constant**
- File: src/plugin/codex.ts:437
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3600 should be a named constant**
- File: src/plugin/codex.ts:510
- Type: magic-number
- Auto-fixable: Yes

**Console statement found in production code**
- File: src/util/scrap.ts:5
- Type: console-log
- Auto-fixable: Yes

**Magic number 97 should be a named constant**
- File: src/util/ai-compat.ts:5
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/util/color.ts:8
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/util/color.ts:9
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/util/color.ts:10
- Type: magic-number
- Auto-fixable: Yes

**Magic number 38 should be a named constant**
- File: src/util/color.ts:17
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000 should be a named constant**
- File: src/util/locale.ts:32
- Type: magic-number
- Auto-fixable: Yes

**Magic number 1000000 should be a named constant**
- File: src/util/locale.ts:33
- Type: magic-number
- Auto-fixable: Yes

**Magic number 60000 should be a named constant**
- File: src/util/locale.ts:44
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3600000 should be a named constant**
- File: src/util/locale.ts:47
- Type: magic-number
- Auto-fixable: Yes

**Magic number 60000 should be a named constant**
- File: src/util/locale.ts:48
- Type: magic-number
- Auto-fixable: Yes

**Magic number 60000 should be a named constant**
- File: src/util/locale.ts:49
- Type: magic-number
- Auto-fixable: Yes

**Magic number 86400000 should be a named constant**
- File: src/util/locale.ts:52
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3600000 should be a named constant**
- File: src/util/locale.ts:53
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3600000 should be a named constant**
- File: src/util/locale.ts:54
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3600000 should be a named constant**
- File: src/util/locale.ts:57
- Type: magic-number
- Auto-fixable: Yes

**Magic number 3600000 should be a named constant**
- File: src/util/locale.ts:58
- Type: magic-number
- Auto-fixable: Yes

**Magic number 35 should be a named constant**
- File: src/util/locale.ts:67
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8000 should be a named constant**
- File: src/mcp/index.ts:367
- Type: magic-number
- Auto-fixable: Yes

**Magic number 8000 should be a named constant**
- File: src/mcp/index.ts:378
- Type: magic-number
- Auto-fixable: Yes

**Magic number 32 should be a named constant**
- File: src/mcp/index.ts:705
- Type: magic-number
- Auto-fixable: Yes

**Magic number 16 should be a named constant**
- File: src/mcp/index.ts:706
- Type: magic-number
- Auto-fixable: Yes

**Magic number 127 should be a named constant**
- File: src/mcp/oauth-provider.ts:35
- Type: magic-number
- Auto-fixable: Yes

**Magic number 2000 should be a named constant**
- File: src/mcp/oauth-callback.ts:22
- Type: magic-number
- Auto-fixable: Yes

**Magic number 248 should be a named constant**
- File: src/mcp/oauth-callback.ts:35
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/mcp/oauth-callback.ts:89
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/mcp/oauth-callback.ts:109
- Type: magic-number
- Auto-fixable: Yes

**Magic number 400 should be a named constant**
- File: src/mcp/oauth-callback.ts:119
- Type: magic-number
- Auto-fixable: Yes

**Magic number 12 should be a named constant**
- File: src/question/index.ts:24
- Type: magic-number
- Auto-fixable: Yes

**Magic number 5000 should be a named constant**
- File: src/session/system.ts:213
- Type: magic-number
- Auto-fixable: Yes

**Magic number 30 should be a named constant**
- File: src/session/retry.ts:7
- Type: magic-number
- Auto-fixable: Yes

**Magic number 32 should be a named constant**
- File: src/session/retry.ts:8
- Type: magic-number
- Auto-fixable: Yes

