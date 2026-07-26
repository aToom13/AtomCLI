---
name: create-design-system
description: Protocols for architecting complete, reusable design systems (tokens, UI primitives, guidelines, assets, and UI kits) within AtomCLI projects.
location: .atomcli/skills/create-design-system/SKILL.md
---

# Create Design System Skill — AtomCLI Design Tree

> **Scope:** Protocols for architecting complete, reusable design systems (tokens, UI primitives, guidelines, assets, and UI kits) within AtomCLI projects.

---

## 🏗️ Design System Architecture

Organize the design system repository cleanly:

```
design-system/
├── tokens/
│   ├── colors.css          # Semantic & base color tokens
│   ├── typography.css      # Font families, sizes, weights, line-heights
│   ├── spacing.css         # Spacing scale & grid layout tokens
│   └── elevation.css       # Shadows, borders, radii, z-index
├── components/             # Reusable UI primitives (Button, Card, Input, Modal, Badge...)
├── ui_kits/               # Full-screen product recreations & interactive flows
├── assets/                 # SVGs, icons, brand logos, imagery
├── styles.css              # Main bundle entry (@import rules for tokens)
└── README.md               # Design system guide, principles & manifest
```

---

## 🎨 Token Definition Protocol

Declare design tokens under `:root` in CSS:

```css
:root {
  /* Colors */
  --color-primary-500: #6366f1;
  --color-primary-600: #4f46e5;
  --color-bg-app: #0f172a;
  --color-bg-card: rgba(30, 41, 59, 0.7);
  --color-text-main: #f8fafc;
  --color-text-muted: #94a3b8;

  /* Typography */
  --font-display: 'Outfit', sans-serif;
  --font-body: 'Inter', sans-serif;

  /* Elevation & Borders */
  --radius-sm: 6px;
  --radius-lg: 16px;
  --shadow-glow: 0 0 20px rgba(99, 102, 241, 0.3);
}
```

---

## 🧱 Component Family Creation Rules

1. **Self-Contained Primitives:** Build components as clean React/JSX or modular Web Components.
2. **Prop Interfaces & Variations:** Include variants (Primary, Secondary, Ghost, Danger), sizes (SM, MD, LG), and states (Hover, Active, Disabled, Loading).
3. **No Hardcoded Values:** Always bind styling to CSS token variables.
4. **Documentation Cards:** Create specimen HTML card files showcasing component variations.
