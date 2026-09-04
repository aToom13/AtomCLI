# Shared libraries

The workspace libraries are:

| Directory    | Package responsibility                               |
| ------------ | ---------------------------------------------------- |
| `companion/` | pairing authentication, mobile bridge, and discovery |
| `function/`  | serverless function support                          |
| `plugin/`    | plugin API and tooling                               |
| `script/`    | shared build and automation support                  |
| `sdk/js/`    | generated JavaScript/TypeScript SDK                  |
| `util/`      | shared utilities                                     |

Each package exposes its own scripts through its `package.json`. Run root-wide checks with `bun turbo typecheck` and `bun turbo test`.

The TypeScript `companion/` package owns pairing, discovery, and bridge primitives used by AtomBase. The Flutter client lives outside `libs/` at [`../companion/`](../companion/README.md); its README is the canonical device workflow and multi-process endpoint guide.

Its Zod wire contract is the source for `companion/protocol/companion.schema.json` and the Flutter handshake models. Run `bun run protocol:generate` from `libs/companion/` after every contract change; `bun run protocol:check` fails when generated artifacts are stale.
