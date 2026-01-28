# Build Scripts

Build and maintenance scripts for AtomCLI.

## Overview

This directory contains scripts for building, publishing, and maintaining the AtomCLI project.

## Scripts

### Build Scripts

- **`build.ts`** - Main build script
  - Compiles TypeScript to JavaScript
  - Bundles for multiple platforms
  - Outputs to `dist/` directory

### Publishing Scripts

- **`publish.ts`** - Publish to npm registry
- **`publish-registries.ts`** - Publish to multiple registries
- **`schema.ts`** - Generate JSON schemas

### Installation Scripts

- **`postinstall.mjs`** - Post-installation setup
  - Runs after `npm install`
  - Sets up development environment

## Usage

```bash
# Build for all platforms
bun run build

# Publish to npm
bun run publish

# Generate schemas
bun run schema
```

## Build Output

Binaries are output to `dist/` for each platform:
- `atomcli-linux-x64/`
- `atomcli-linux-arm64/`
- `atomcli-darwin-x64/`
- `atomcli-darwin-arm64/`
- `atomcli-windows-x64/`

## Documentation

- [Development Guide](../../docs/DEVELOPMENT.md) - Build workflow
- [Main README](../../README.md) - Project overview

## Navigation

- **Parent**: [AtomBase/](../README.md)
- **Root**: [AtomCLI](../../README.md)
