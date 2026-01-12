<div align="center">

# AtomCLI

```
     █████╗ ████████╗ ██████╗ ███╗   ███╗   ██████╗██╗     ██╗
    ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║  ██╔════╝██║     ██║
    ███████║   ██║   ██║   ██║██╔████╔██║  ██║     ██║     ██║
    ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║  ██║     ██║     ██║
    ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║  ╚██████╗███████╗██║
    ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝   ╚═════╝╚══════╝╚═╝
```

**Terminal AI Coding Assistant**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/aToom13/AtomCLI)](https://github.com/aToom13/AtomCLI/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/aToom13/AtomCLI)](https://github.com/aToom13/AtomCLI/issues)

[English](#english) • [Türkçe](#türkçe)

</div>

---

<a name="english"></a>

## 🚀 Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash
```

That's it! Run `atomcli` to start.

## ✨ Features

- **🖥️ Beautiful TUI** - Interactive terminal interface with mouse support
- **🤖 Free Models** - Use without API keys via built-in free providers (MiniMax, GLM, etc.)
- **🔧 MCP Support** - Extend capabilities with Model Context Protocol servers
- **📚 Skills System** - Add specialized behaviors from GitHub or locally
- **🔒 Privacy First** - All data stored locally, no telemetry

## 📦 Installation

### One-Line Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash
```

### Manual Install

```bash
git clone https://github.com/aToom13/AtomCLI.git
cd AtomCLI && bun install
cd AtomBase && bun run build
cp dist/atomcli-linux-x64/bin/atomcli ~/.local/bin/
```

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash -s -- --uninstall
```

## 🛠️ Usage

```bash
atomcli                 # Start interactive session
atomcli mcp list        # List MCP servers
atomcli skill list      # List available skills
```

### Adding MCP Servers

Add capabilities via chat:

```
> Add memory-bank MCP
> Add filesystem MCP for /home/user/projects
```

### Adding Skills

Skills provide specialized instructions:

```
> Add this skill: https://github.com/davila7/claude-code-templates/blob/main/.../code-reviewer.md
```

## 🔧 Configuration

Config file: `~/.atomcli/atomcli.json`

```json
{
  "mcp": {
    "memory-bank": {
      "type": "local",
      "command": ["npx", "-y", "github:alioshr/memory-bank-mcp"],
      "enabled": true
    }
  }
}
```

## 🌍 Supported Platforms

| Platform            | Status |
| ------------------- | ------ |
| Linux x64           | ✅      |
| Linux ARM64         | ✅      |
| macOS x64           | ✅      |
| macOS ARM64 (M1/M2) | ✅      |
| Windows (WSL)       | ✅      |

---

<a name="türkçe"></a>

## 🇹🇷 Türkçe

### Hızlı Kurulum

```bash
curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash
```

### Özellikler

- **TUI Arayüzü** - Fare destekli etkileşimli terminal
- **Ücretsiz Modeller** - API anahtarı olmadan kullanın (MiniMax, GLM vb.)
- **MCP Desteği** - Model Context Protocol ile yetenekleri genişletin
- **Skill Sistemi** - GitHub'dan veya yerel olarak özel davranışlar ekleyin
- **Gizlilik** - Tüm veriler yerel olarak saklanır

### Kaldırma

```bash
curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash -s -- --uninstall
```

### MCP Ekleme

```
> Memory-bank MCP'sini ekle
> Filesystem MCP'sini ekle
```

### Skill Ekleme

```
> Bu skill'i ekle: https://github.com/.../code-reviewer.md
```


<div align="center">

Developed by **[Atom13](https://github.com/aToom13)**

</div>
