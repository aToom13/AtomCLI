# AtomBase scripts

This directory contains package maintenance scripts. `build.ts` is the production build entrypoint used by `bun run build`.

The build clears `AtomBase/dist/`, bundles supported targets, and copies repository-root `.atomcli/` and `.claude/` directories into release output. Keep local configuration, credentials, package manifests/locks, dependencies, plans, runs, and session state ignored so only tracked skills and agents enter a clean release checkout. Releases are triggered only by pushing a `v*` tag, and package publication uses Bun.

Use:

```sh
cd AtomBase
bun run build
```

See the [development guide](../../docs/DEVELOPMENT.md) for validation and SDK generation requirements.

Do not invoke publishing scripts directly for a GitHub release. From the repository root, use `./release.sh --dry-run` to validate and `./release.sh` to commit, push the exact version tag, and wait for the release workflow.
