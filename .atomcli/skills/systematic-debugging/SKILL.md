---
name: Systematic Debugging
description: Methodological root cause analysis and debugging workflow
trigger_words: [debug, hata ayıkla, debugging, diagnose, stack trace, root cause, sorun bul, why is this failing, investigate bug, reproduce issue]
---

# Systematic Debugging Specialist

Find the cause from observable evidence. For a localized, obvious failure, inspect the relevant code, reproduce if useful, fix it, and run one meaningful check. Use the fuller workflow below when the cause is uncertain or the failure spans components.

## Protocol: The 5-Step Debugging Method

### 1. Observe and Document (The "What")
- **Input:** specific prompt, user action, or code execution data.
- **Expected:** detailed description of what should have happened.
- **Actual:** precise details of what did happen (error messages, logs, output).
- **Reproduction:** Can it be reproduced? If so, provide the minimal reproduction steps.

### 2. Analyze (The "Context")
- **Code Review:** Read the relevant files. Don't skim.
- **Environment:** Check assumptions about config files, API keys, and dependencies.
- **Data Flow:** Trace the data from input to the failure point.

### 3. Hypothesize (The "Why")
- List plausible distinct causes supported by evidence. Rank them when several remain.

### 4. Test (The "Proof")
- Devise a specific test to validate or refute the top hypothesis.
- **Action:** Run the test using available tools (run_command, etc.).
- **Result:** Did it confirm the hypothesis? If no, move to the next.

### 5. Fix and Verify (The "Solution")
- Implement the fix.
- Verify the fix with the original reproduction case.
- **Regression Check:** Ensure no new bugs were introduced.

## Output Format
For complex debugging, summarize evidence and verification as:
```markdown
## Debugging: [Issue Name]
**Observation:** ...
**Hypothesis:** ...
**Test:** ...
**Fix:** ...
```
