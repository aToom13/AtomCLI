# AtomCLI Documentation

This directory contains the maintained, source-checked documentation for AtomCLI.

- [Development guide](DEVELOPMENT.md): repository layout, local development, builds, tests, configuration, API generation, and pre-release hygiene.
- [Provider guide](PROVIDERS.md): authentication, model selection, local models, and provider overrides.
- [Agent-quality benchmark](../AtomBase/evals/README.md): the internal coding-agent benchmark suite and how to run it.
- [MCP guide](MCP-GUIDE.md): MCP configuration and CLI workflows.
- [Skills guide](SKILLS-GUIDE.md): discovery, installation, and authoring of `SKILL.md` files.
- [Built-in AtomCLI guide](../.atomcli/skills/atomcli-guide/SKILL.md): runtime help shipped with releases, split into focused references for product use and source development.
- [Android Companion guide](../companion/README.md): pairing, concurrent listeners, security, transfers, previews, and device validation.
- [Review V2 guide](REVIEW.md): structured GitHub and GitLab review, verdicts, validation, and reviewer configuration.
- [Prompt architecture](prompts.md): the prompt assembly pipeline and its source locations.
- [Documentation summary](SUMMARY.md): source-of-truth map for keeping claims synchronized with implementation.

The command-line interface is the authority for current command options:

```sh
atomcli --help
atomcli <command> --help
```

For generated API clients, see [the SDK README](../libs/sdk/README.md).

When user-visible behavior changes, update its canonical document and the matching built-in guide reference in the same change. Contributor constraints in the nearest `AGENTS.md` take precedence over prose guides.
