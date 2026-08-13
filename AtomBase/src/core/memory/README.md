# Memory system

This directory implements AtomCLI's persistent memory and learning services. It contains profile and preference services, semantic-learning integration, retrieval components, storage adapters, and prompt-context construction.

The command interface is:

```sh
atomcli memory show
atomcli memory profile
atomcli memory preferences
atomcli memory set-name <name>
atomcli memory export
atomcli memory clear
```

Persistent user-facing memory is managed beneath `~/.atomcli/`; exact files are implementation details and may be migrated. Do not document unverified semantic extraction or storage behavior as a guarantee. Changes here should be validated with the relevant memory tests and the standard AtomBase test command.
