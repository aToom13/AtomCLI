# AtomBase scripts

This directory contains package maintenance scripts. `build.ts` is the production build entrypoint used by `bun run build`.

The build clears `AtomBase/dist/`, bundles supported targets, and copies repository-root `.atomcli/` and `.claude/` directories into release output. Keep local configuration, credentials, package manifests/locks, dependencies, plans, runs, and session state ignored so only tracked skills and agents enter a clean release checkout. Releases are triggered only by pushing a `v*` tag, and package publication uses Bun.

The copied assets include the built-in `atomcli-guide`. If it changes, run `test/skill/atomcli-guide.test.ts` and verify `skill list` before building so malformed frontmatter or broken reference links do not ship in every binary.

Use:

```sh
cd AtomBase
bun run build
```

See the [development guide](../../docs/DEVELOPMENT.md) for validation and SDK generation requirements.

The repository does not track a publishing helper. Run the validation commands in the [development guide](../../docs/DEVELOPMENT.md), then create and push only the exact version tag after explicit release authorization. A maintainer-specific helper must remain ignored and local.
