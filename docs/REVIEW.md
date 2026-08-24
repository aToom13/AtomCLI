# Review V2

Review V2 provides one structured validation pipeline for the blocking agent review gate, isolated workflow quality checks, and remote pull or merge request review.

## Command-line review

Review a GitHub pull request without posting the result:

```sh
atomcli review --provider github --repo owner/repository --pr 123 --diff-only
```

Review a GitLab merge request:

```sh
atomcli review --provider gitlab --repo group/project --pr 123 --diff-only
```

The command prints a JSON report. Use `--output <path>` to save the same report, `--reviewers 1..4` to bound parallel review, and omit `--diff-only` only when the supplied token is authorized to post review comments.

GitHub repository names use `owner/repository`. GitLab accepts nested project paths such as `group/subgroup/project`. Pass an access token with `--token` when the remote endpoint or posting operation requires authentication. Do not store tokens in repository files or shell history.

## Verdicts and findings

The final verdict is one of:

- `passed`: all valid reviewer output found no blocking issue.
- `rejected`: at least one validated finding requires a change.
- `inconclusive`: reviewer execution or schema validation failed, or a claimed issue could not be validated safely.

Every accepted finding contains a P0 through P3 severity, confidence score, file path, line range, exact evidence, title, recommendation, and the reviewers that reported it.

## Validation model

Reviewer output is accepted only after it passes the shared Zod schema and is checked against the supplied change:

- The file must belong to the reviewed diff.
- The line range must exist in the real source or reconstructed diff content.
- The evidence must occur in the claimed range.
- The range must overlap changed lines when changed-line information is available.
- Duplicate or strongly overlapping findings are merged while preserving the strongest severity and confidence.

Large diffs are divided into bounded chunks with continuation headers. Content is not discarded because a file exceeds a line threshold.

## Automatic review gate

The main agent review gate is enabled by default. Its configuration is backward compatible:

```jsonc
{
  "review": {
    "enabled": true,
    "policy": "adaptive",
    "reviewer_count": 2,
    "max_attempts": 3,
    "high_risk_patterns": [],
  },
}
```

`reviewer_count` accepts 1 through 4. The `adaptive` policy reviews high-risk changes, `always` reviews every edit set, and `off` disables policy-triggered independent review. The blocking gate still respects the existing review lifecycle and attempt limits.

## Posting behavior

GitHub posting creates a summary review and then attempts line comments for validated findings. GitLab posting creates a merge request note containing the structured summary. A rejected or inconclusive local result exits with a nonzero status.
