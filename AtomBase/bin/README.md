# AtomCLI package launcher

`bin/atomcli` is a Bun launcher used as the package entrypoint declared by `AtomBase/package.json`; it is not a compiled release binary. Release builds place platform-specific executables under `AtomBase/dist/<target>/bin/`.

Build from `AtomBase/` with:

```sh
bun run build
```

`dist/` is generated output and is cleared before every build. Do not edit or store source files there. For local development, prefer `bun run dev` instead of relying on a previously built binary.

See the [development guide](../../docs/DEVELOPMENT.md) for build and release rules.
