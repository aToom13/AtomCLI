# Cline live probe

Development-only live audit for the embedded integration. Reads credentials outside the repository and never prints tokens.

```sh
CLINE_TOKEN_FILE=/tmp/cline-probe/token.json bun test/provider/cline/probe.ts
```

The probe refreshes expired credentials, persists rotated tokens back to the same external file with mode `0600`, checks
`/users/me`, merges Cline's promoted free list with `:free` catalog variants, then sends a minimal streaming request to
every unique free model.

## Verified contract

- OAuth access tokens need the `workos:` prefix inside the Bearer value.
- Refresh uses `{ refreshToken, grantType: "refresh_token", clientType: "extension" }` and may rotate both tokens.
- Requests carry Cline client metadata headers, including one stable `X-Task-ID` per probe run.
- Non-stream chat responses wrap the OpenAI-compatible payload in `{ data: ... }`.
- Stream chat responses use OpenAI-compatible SSE with `data:` frames and `[DONE]`.
- `/models` exposes no price or capability fields.
- Free classification is the union of `/ai/cline/recommended-models.free` membership and the `/models` `:free` suffix.
- Track source as `promoted`, `catalog-suffix`, or `both`; promoted models may have ordinary IDs or a `cline-free/` prefix.
- `:batch` is not free.

On 2026-09-09 the promoted list has 6 models and the catalog has 18 `:free` variants. Laguna S 2.1 overlaps both,
producing 23 unique free models. Streaming message tests passed for 21. Inkling was rate-limited upstream and Laguna XS
returned an upstream provider 404; both remain free-classified because availability is separate from billing.
