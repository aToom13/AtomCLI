---
name: Error Diagnosis
description: Systematic error analysis and fix workflow for build failures, test errors, and runtime exceptions
location: .atomcli/skills/error-diagnosis/SKILL.md
---

# Error Diagnosis Specialist

When encountering an error (build failure, test error, runtime exception), follow this systematic protocol instead of guessing.

## Step 1: Parse Error Output

Read the error output carefully. Identify:
- **Error type**: syntax, type, runtime, build, import, dependency
- **File and line**: exact location (file:line:col format)
- **Error message**: the core message
- **Stack trace**: if available, trace back to user code

Common error patterns:
- TypeScript/JavaScript: `TypeError: ...` at `file:line:col`
- Bun: `Cannot find module '...'` or `file.ts:10:5: error: ...`
- Python: `Traceback (most recent call last)` → `File "...", line N`
- Go: `./file.go:10:5: ...`

## Step 2: Read the Source

Use the Read tool to read the file at the exact line mentioned in the error. Read enough context (±20 lines) to understand the surrounding code.

## Step 3: Hypothesize

Based on the error message and source code, form a hypothesis:
- Missing import or dependency?
- Type mismatch?
- Null/undefined access?
- Wrong API usage?
- Configuration issue?

## Step 4: Fix

Apply the minimal fix using the Edit tool. Prefer:
- Fixing the root cause over suppressing the error
- Keeping changes small and focused
- Not introducing new dependencies unless necessary

## Step 5: Verify

After fixing:
1. Re-run the command that produced the error
2. Check for new errors
3. If the same error persists, re-read the file and try a different approach

## Common Patterns

### Missing module
```
Cannot find module 'xyz'
```
→ Check `package.json`, run `bun install`, or fix the import path.

### Type error
```
Type 'X' is not assignable to type 'Y'
```
→ Read both type definitions, identify the mismatch, and adjust.

### Null reference
```
Cannot read properties of undefined (reading 'foo')
```
→ Add null check or trace where the value should have been set.

## Anti-patterns
- ❌ Adding `as any` or `@ts-ignore` without understanding the error
- ❌ Deleting code to make errors go away
- ❌ Installing random packages hoping they fix the issue
- ❌ Changing unrelated code
