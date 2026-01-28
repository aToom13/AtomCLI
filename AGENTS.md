# AGENTS.md

## Project Overview for AI Agents

**AtomCLI** is a terminal-based AI coding assistant built with modern web technologies but designed for the CLI.

### Core Architecture
- **Language:** TypeScript
- **Runtime:** Bun
- **Monorepo Structure:**
    - `AtomBase/`: The core application logic.
        - `src/cli`: The command-line interface implementation.
        - `src/cli/cmd/tui`: The terminal UI components (using Ink or similar libraries).
        - `src/util`: Core utilities including i18n, logging, and filesystem ops.
    - `libs/`: Shared libraries and SDKs.

### Key Conventions
- **Internationalization (i18n):**
    - Use `I18n.t("key")` from `src/util/i18n.ts` instead of hardcoded strings.
    - Locale files are located in `src/cli/locales/*.json` (or `src/locales` depending on implementation).
- **Testing:**
    - Run tests using `bun test` from the root.
    - Ensure new features have corresponding tests.
- **Styling:**
    - The TUI uses component-based architecture.
    - Colors and themes are managed centrally.

### Deployment & CI/CD
- GitHub Actions are configured in `.github/workflows`.
- `ci.yml` handles linting, typechecking, and testing.
- `release.yml` automates binary releases on tag push.

### Guidelines for Agents
1. **Always check existing patterns:** Before implementing a new feature, look at similar existing implementations.
2. **Prioritize I18n:** Do not hardcode user-facing strings.
3. **Use the task runner:** Use the defined `package.json` scripts.
