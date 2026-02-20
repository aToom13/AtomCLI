# Prompt System Architecture

AtomCLI'nin en kritik bileşenlerinden biri olan **Prompt Sistemi**, AI modellerine gönderilen tüm sistem talimatlarını oluşturur, düzenler ve yönetir.

## 📋 İçindekiler

- [Genel Bakış](#genel-bakış)
- [Dizin Yapısı](#dizin-yapısı)
- [manager.ts — Birleşik Orkestratör](#managerts--birleşik-orkestratör)
- [Modül Katmanları](#modül-katmanları)
  - [1. Core (Temel Promptlar)](#1-core-temel-promptlar)
  - [2. Provider (Sağlayıcıya Özel)](#2-provider-sağlayıcıya-özel)
  - [3. Agent (Ajan Modu)](#3-agent-ajan-modu)
  - [4. Runtime (Çalışma Zamanı)](#4-runtime-çalışma-zamanı)
  - [5. Inline Emphasis (Satır İçi Vurgular)](#5-inline-emphasis-satır-içi-vurgular)
- [Prompt Nasıl Oluşturulur?](#prompt-nasıl-oluşturulur)
- [Özelleştirme](#özelleştirme)
  - [Yeni .txt Dosyası Ekleme](#yeni-txt-dosyası-ekleme)
  - [Custom Section Ekleme (Dinamik)](#custom-section-ekleme-dinamik)
  - [Proje Kuralları (AGENTS.md)](#proje-kuralları-agentsmd)
- [Token İstatistikleri](#token-i̇statistikleri)
- [İlgili Dökümanlar](#i̇lgili-dökümanlar)

---

## Genel Bakış

```
Kullanıcı İsteği
     │
     ▼
┌──────────────┐
│  system.ts   │ ← Giriş noktası
│  provider()  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  manager.ts  │ ← Birleşik orkestratör
│              │
│  ┌────────┐  │
│  │ Core   │──┼── 8 temel .txt dosyası (her zaman dahil)
│  ├────────┤  │
│  │Provider│──┼── Model'e göre otomatik seçilen .txt
│  ├────────┤  │
│  │ Agent  │──┼── Ajan moduna göre seçilen .txt
│  ├────────┤  │
│  │Emphasis│──┼── Read-before-edit, orchestrate, todowrite
│  ├────────┤  │
│  │Dynamic │──┼── User profile, learning memory
│  ├────────┤  │
│  │Custom  │──┼── Kullanıcının eklediği ekstra bölümler
│  └────────┘  │
└──────┬───────┘
       │
       ▼
  LLM'e gönderilen
  tek bir string
```

---

## Dizin Yapısı

```
AtomBase/src/session/prompt/
├── manager.ts              # 🎯 Birleşik orkestratör (tek giriş noktası)
│
├── core/                   # 📦 Temel promptlar (HER ZAMAN dahil)
│   ├── identity.txt        #   AI kimliği, kişilik, uzmanlık alanları
│   ├── self-learning.txt   #   Öğrenme sistemi talimatları
│   ├── tools.txt           #   Araç kullanım rehberi (Read, Edit, Bash, vb.)
│   ├── workflow.txt        #   5 aşamalı iş akışı
│   ├── communication.txt   #   İletişim stili kuralları
│   ├── code-editing.txt    #   Kod düzenleme kuralları ve en iyi pratikler
│   ├── git-safety.txt      #   Git güvenlik protokolü
│   └── extensions.txt      #   Skill sistemi ve MCP rehberi
│
├── provider/               # 🏢 Sağlayıcıya özel optimizasyonlar
│   ├── anthropic.txt       #   Claude modelleri için
│   ├── gemini.txt          #   Gemini modelleri için
│   ├── openai.txt          #   GPT/O-serisi modelleri için
│   └── generic.txt         #   Diğer tüm modeller için
│
├── agent/                  # 🤖 Ajan modu davranışları
│   ├── agent.txt           #   Varsayılan otonom mod
│   ├── explore.txt         #   Salt okunur keşif modu
│   ├── plan.txt            #   Planlama modu (düzenleme yasağı)
│   └── build.txt           #   Uygulama modu
│
└── runtime/                # ⚡ Çalışma zamanı enjeksiyonları
    ├── max-steps.txt       #   Adım limiti uyarısı
    ├── plan-mode.txt       #   Plan modu sistem hatırlatıcısı
    ├── build-switch.txt    #   Plan→Build geçiş bildirimi
    ├── anthropic-spoof.txt #   Claude Code spoof başlığı
    ├── plan-reminder-anthropic.txt  # Anthropic plan iş akışı
    └── legacy-instructions.txt      # Eski codex talimatları (geriye dönük uyum)
```

---

## manager.ts — Birleşik Orkestratör

`manager.ts`, tüm prompt üretim mantığını tek dosyada barındıran ana orkestratördür.

### API

```typescript
import { PromptManager } from "./prompt/manager"

// Senkron build (hızlı, user profile/memory yok)
const prompt = PromptManager.build({
  modelId: "claude-3-5-sonnet",
  agent: "agent",
  customSections: ["Ekstra kural: Her zaman Türkçe yanıt ver."]
})

// Asenkron build (user profile + learning memory dahil)
const prompt = await PromptManager.buildAsync({
  modelId: "gemini-2.0-flash",
  agent: "explore",
  includeLearningMemory: true,
  includeUserProfile: true
})

// İstatistik
const stats = PromptManager.getStats({ modelId: "claude-3-5-sonnet" })
console.log(stats.totalTokens)    // ~25000
console.log(stats.sections)       // Her bölümün token sayısı
```

### BuildOptions

| Parametre               | Tip         | Varsayılan  | Açıklama                   |
| ----------------------- | ----------- | ----------- | -------------------------- |
| `modelId`               | `string`    | **zorunlu** | Model API ID'si            |
| `agent`                 | `AgentType` | `"agent"`   | Ajan modu                  |
| `customSections`        | `string[]`  | `[]`        | Ekstra prompt bölümleri    |
| `includeLearningMemory` | `boolean`   | `true`      | Öğrenme hafızası dahil mi  |
| `includeUserProfile`    | `boolean`   | `true`      | Kullanıcı profili dahil mi |

### Geriye Dönük Uyumluluk

```typescript
// Eski PromptBuilder hâlâ çalışır (alias)
import { PromptBuilder } from "./prompt/manager"
PromptBuilder.build({ ... })  // PromptManager.build ile aynı
```

---

## Modül Katmanları

### 1. Core (Temel Promptlar)

Bu 8 dosya **her istekte** dahil edilir, sırası önemlidir:

| Sıra | Dosya               | İçerik                                                | ~Token |
| ---- | ------------------- | ----------------------------------------------------- | ------ |
| 1    | `identity.txt`      | AI kimliği, uzmanlık, kişilik, ajan döngüsü           | ~4700  |
| 2    | `self-learning.txt` | Hafıza sistemi talimatları                            | ~1200  |
| 3    | `tools.txt`         | 17 araç detaylı kullanım rehberi                      | ~4800  |
| 4    | `workflow.txt`      | 5 aşamalı iş akışı (Anla→Planla→Uygula→Doğrula→Bitir) | ~3200  |
| 5    | `communication.txt` | İletişim kuralları (direkt, özlü, teknik)             | ~2900  |
| 6    | `code-editing.txt`  | Kod düzenleme en iyi pratikleri                       | ~3700  |
| 7    | `git-safety.txt`    | Git güvenlik protokolü                                | ~2400  |
| 8    | `extensions.txt`    | Skill ve MCP kullanım rehberi                         | ~3100  |

### 2. Provider (Sağlayıcıya Özel)

Model ID'sine göre **otomatik algılanır**:

```typescript
"claude-3-5-sonnet"  → anthropic.txt
"gemini-2.0-flash"   → gemini.txt
"gpt-4o"             → openai.txt
"llama-3.1"          → generic.txt
```

Algılama kuralları:
- `claude` içeriyorsa → `anthropic`
- `gemini` içeriyorsa → `gemini`
- `gpt`, `o1`, `o3`, `o4` içeriyorsa → `openai`
- Diğer her şey → `generic`

### 3. Agent (Ajan Modu)

| Mod       | Dosya         | Davranış                              |
| --------- | ------------- | ------------------------------------- |
| `agent`   | `agent.txt`   | Tam otonom, tüm araçlar açık          |
| `explore` | `explore.txt` | Salt okunur, sadece Read/Grep/Glob/Ls |
| `plan`    | `plan.txt`    | Sadece planla, düzenleme yasak        |
| `build`   | `build.txt`   | Planı uygula, tam yetki               |

### 4. Runtime (Çalışma Zamanı)

Bu dosyalar **sürekli dahil edilmez**, sadece belirli anlarda enjekte edilir:

| Dosya                     | Ne Zaman                        | Nereden     |
| ------------------------- | ------------------------------- | ----------- |
| `max-steps.txt`           | Adım limiti aşıldığında         | `prompt.ts` |
| `plan-mode.txt`           | Plan moduna geçildiğinde        | `prompt.ts` |
| `build-switch.txt`        | Plan→Build geçişinde            | `prompt.ts` |
| `anthropic-spoof.txt`     | Anthropic modelleri için başlık | `system.ts` |
| `legacy-instructions.txt` | Eski codex talimatları          | `system.ts` |

### 5. Inline Emphasis (Satır İçi Vurgular)

`manager.ts` içinde doğrudan tanımlı, **her zaman dahil** edilen kritik bölümler:

| Bölüm                       | Amaç                                                |
| --------------------------- | --------------------------------------------------- |
| `READ_BEFORE_EDIT_EMPHASIS` | ⛔ "Düzenlemeden ÖNCE MUTLAKA oku" kuralının vurgusu |
| `ORCHESTRATE_DETAILS`       | 🎯 Orchestrate aracı kullanım rehberi                |
| `TODOWRITE_DETAILS`         | 📋 TodoWrite görev yönetimi rehberi                  |

Bunlar `.txt` dosyalarındaki temel talimatlara **ek olarak** dahil edilir, kritik kuralları pekiştirmek için.

---

## Prompt Nasıl Oluşturulur?

`PromptManager.build()` çağrıldığında oluşan birleştirme sırası:

```
1.  core/identity.txt              ← Kim olduğu
2.  core/self-learning.txt         ← Öğrenme sistemi
3.  core/tools.txt                 ← Araç kullanımı
4.  core/workflow.txt              ← İş akışı
5.  core/communication.txt         ← İletişim
6.  core/code-editing.txt          ← Kod düzenleme
7.  core/git-safety.txt            ← Git güvenliği
8.  core/extensions.txt            ← Skills + MCP
9.  [user_context]                 ← Kullanıcı profili (async)
10. [learning_memory]              ← Öğrenme hafızası (async)
11. READ_BEFORE_EDIT_EMPHASIS      ← Kritik kural vurgusu
12. ORCHESTRATE_DETAILS            ← Orchestrate rehberi
13. TODOWRITE_DETAILS              ← TodoWrite rehberi
14. provider/{detected}.txt         ← Sağlayıcıya özel
15. agent/{selected}.txt            ← Ajan moduna özel
16. customSections[]                ← Kullanıcı ekstraları
```

Her bölüm `\n\n---\n\n` ile ayrılır.

---

## Özelleştirme

### Yeni .txt Dosyası Ekleme

1. Dosyayı uygun dizine koyun:
   - Temel (her zaman dahil) → `core/`
   - Sağlayıcıya özel → `provider/`
   - Ajan moduna özel → `agent/`
   - Çalışma zamanı enjeksiyonu → `runtime/`

2. `manager.ts` içinde import edin:
   ```typescript
   import MY_NEW_PROMPT from "./core/my-new-rules.txt"
   ```

3. Uygun diziye ekleyin:
   ```typescript
   const CORE_PROMPTS = [
     ...mevcut_promptlar,
     MY_NEW_PROMPT,  // ← yeni eklenen
   ]
   ```

### Custom Section Ekleme (Dinamik)

Kod tarafından çalışma zamanında ekstra bölümler ekleyin:

```typescript
const prompt = PromptManager.build({
  modelId: "claude-3-5-sonnet",
  customSections: [
    "Bu projede TailwindCSS v4 kullanılıyor. Her zaman Tailwind classlarını tercih et.",
    await fs.readFile("./my-extra-rules.txt", "utf-8"),  // Dosyadan oku
  ]
})
```

### Proje Kuralları (AGENTS.md)

`system.ts → custom()` fonksiyonu, proje kökündeki kural dosyalarını otomatik okur:

```
Arama sırası:
1. ./AGENTS.md (proje kökü)
2. ./CLAUDE.md
3. ./CONTEXT.md (deprecated)
4. ~/.atomcli/AGENTS.md (global)
5. ~/.claude/CLAUDE.md (global)
```

Bu dosyalar `customSections` olarak PromptManager'a eklenir.

---

## Token İstatistikleri

Tipik bir prompt'un bölüm başına yaklaşık token dağılımı:

```
identity         ████████████████████░░░░  ~4,700  (19%)
tools            ████████████████████░░░░  ~4,800  (19%)
workflow         █████████████░░░░░░░░░░░  ~3,200  (13%)
code-editing     ███████████████░░░░░░░░░  ~3,700  (15%)
communication    ████████████░░░░░░░░░░░░  ~2,900  (12%)
extensions       ████████████░░░░░░░░░░░░  ~3,100  (12%)
git-safety       █████████░░░░░░░░░░░░░░░  ~2,400  (10%)
self-learning    █████░░░░░░░░░░░░░░░░░░░  ~1,200  ( 5%)
emphasis/extras  ██████░░░░░░░░░░░░░░░░░░  ~1,500  ( 6%)
provider+agent   ███░░░░░░░░░░░░░░░░░░░░░  ~  500  ( 2%)
─────────────────────────────────────────────────────
TOPLAM           ████████████████████████  ~28,000
```

`PromptManager.getStats()` ile gerçek zamanlı istatistik alabilirsiniz.

---

## İlgili Dökümanlar

- [Development Guide](./DEVELOPMENT.md) — Proje geliştirme rehberi
- [Providers](./PROVIDERS.md) — AI sağlayıcı yapılandırması
- [MCP Guide](./MCP-GUIDE.md) — MCP sunucu entegrasyonu
- [Skills Guide](./SKILLS-GUIDE.md) — Beceri sistemi rehberi
- [Memory Integration](./MEMORY-INTEGRATION.md) — Hafıza sistemi entegrasyonu
