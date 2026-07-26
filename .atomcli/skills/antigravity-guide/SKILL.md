---
name: antigravity-guide
description: "Antigravity AI Coding IDE kurulumu, skill yönetimi ve yapılandırma rehberi. Antigravity IDE (.agent/ dizini yapısı), skill/workflow/rule kurulumu, openai.yaml yapılandırması ve çoklu araç (Claude Code, Cursor, Codex, Gemini CLI) karşılaştırması."
trigger_words: ["antigravity", "antigravity ide", "antigravity kurulum", ".agent/skills", "antigravity skill"]
---

# Antigravity Setup and Usage Guide

Google's [Antigravity](https://antigravity.dev) is an AI coding IDE that uses a `.agent/` directory convention for configuration.

## Quick Start

```bash
# Install ECC with Antigravity target
./install.sh --target antigravity typescript
```

This installs ECC components into your project's `.agent/` directory, ready for Antigravity to pick up.

## Install Mapping

| ECC Source | Antigravity Destination | Description |
|------------|------------------------|-------------|
| `rules/` | `.agent/rules/` | Coding standards (flattened) |
| `commands/` | `.agent/workflows/` | Slash commands become workflows |
| `agents/` | `.agent/skills/` | Agent definitions become skills |

## Skill Yönetimi

Skills Antigravity IDE'de `.agent/skills/` dizininden yüklenir. Her skill bir `SKILL.md` dosyasından oluşur:

```
.agent/skills/<skill-name>/
├── SKILL.md           # Zorunlu: Skill tanımı ve talimatları
├── scripts/           # İsteğe bağlı yardımcı scriptler
├── references/        # İsteğe bağlı referans dokümanları
└── assets/            # İsteğe bağlı statik dosyalar
```

## openai.yaml Yapılandırması

```yaml
interface:
  display_name: "Skill Adı"
  short_description: "Kısa açıklama"
  brand_color: "#F97316"
  default_prompt: "Varsayılan prompt"
policy:
  allow_implicit_invocation: true
```

## Platform Karşılaştırması

| Özellik | Antigravity | Claude Code | Cursor | Codex |
|---------|-------------|-------------|--------|-------|
| Config root | `.agent/` | `~/.claude/` | `.cursor/` | `~/.codex/` |
| Kapsam | Proje | Kullanıcı | Proje | Kullanıcı |
| Rules format | Flat | Nested | Flat | Flat |
| Skills | `.agent/skills/` | `agents/` | N/A | N/A |
| Workflows | `.agent/workflows/` | `commands/` | N/A | N/A |

## Sorun Giderme

- Skills yüklenmiyorsa → `.agent/` dizini proje kökünde mi kontrol et
- Rules uygulanmıyorsa → `.agent/rules/` içinde düz (flat) dizinde olduğundan emin ol
- Workflows görünmüyorsa → `.agent/workflows/` dizinini kullan (`commands/` değil)
