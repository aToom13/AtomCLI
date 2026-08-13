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
