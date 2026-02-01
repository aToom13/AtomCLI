# OpenClaw Sürekli Çalışma ve Self-Healing Sistemi

> **Dosya:** `surekli.md`  
> **Amaç:** OpenClaw'ın 7/24 çalışma, kendi kendine geliştirme ve self-healing mekanizmalarının detaylı dökümantasyonu  
> **Kapsam:** Daemon yönetimi, heartbeat sistemi, model failover, compaction, bellek yönetimi ve otomatik kurtarma

---

## 1. Giriş ve Mimari Genel Bakış

OpenClaw, kullanıcının kendi cihazında çalışan **kişisel bir AI asistanıdır**. 7/24 kesintisiz çalışabilmesi için **3 katmanlı bir mimari** kullanır:

```
┌─────────────────────────────────────────────────────────────┐
│                    KULLANICI KATMANI                         │
│  • WhatsApp, Telegram, Slack, Discord, vb. kanallar         │
│  • CLI komutları (openclaw ...)                             │
│  • WebChat UI                                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    GATEWAY KATMANI                           │
│  • WebSocket kontrol plane (ws://127.0.0.1:18789)           │
│  • Session yönetimi                                         │
│  • Health monitoring                                        │
│  • Cron & Heartbeat scheduler                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    AGENT KATMANI                             │
│  • Pi Agent Runtime (pi-agent-core)                         │
│  • Model inference & tool execution                         │
│  • Context window & compaction                              │
│  • Auth profile rotation & failover                         │
└─────────────────────────────────────────────────────────────┘
```

### 1.1 Temel Dosya Yapısı

```
~/.openclaw/
├── openclaw.json              # Ana yapılandırma dosyası
├── credentials/               # Kimlik bilgileri
│   ├── whatsapp/             # WhatsApp creds (Baileys)
│   └── oauth.json            # OAuth token'ları (legacy)
├── agents/
│   └── <agentId>/
│       ├── agent/
│       │   └── auth-profiles.json   # Auth profilleri & cooldown durumu
│       └── sessions/
│           └── sessions.json        # Session store
└── workspace/                 # Agent çalışma alanı
    ├── SOUL.md               # Agent'ın kişiliği
    ├── USER.md               # Kullanıcı bilgileri
    ├── MEMORY.md             # Uzun vadeli hafıza (sadece main session)
    ├── HEARTBEAT.md          # Periyodik kontrol listesi
    ├── AGENTS.md             # Çalışma alanı kuralları
    └── memory/
        └── YYYY-MM-DD.md     # Günlük loglar
```

**Önemli Kod Dosyaları:**

| Dosya | Açıklama |
|-------|----------|
| `src/daemon/service.ts` | Platforma özgü servis yönetimi (systemd/launchd/scheduled task) |
| `src/daemon/systemd.ts` | Linux systemd entegrasyonu |
| `src/daemon/launchd.ts` | macOS launchd entegrasyonu |
| `src/daemon/systemd-unit.ts` | systemd unit file oluşturma |
| `src/infra/heartbeat-runner.ts` | Heartbeat scheduler ve runner |
| `src/auto-reply/heartbeat.ts` | Heartbeat prompt ve token yönetimi |
| `src/cron/service.ts` | Cron job servisi |
| `src/gateway/server/health-state.ts` | Health snapshot ve monitoring |
| `src/agents/pi-embedded-runner/run.ts` | Ana agent çalıştırma mantığı |
| `src/agents/context-window-guard.ts` | Context window limit kontrolü |
| `src/agents/session-transcript-repair.ts` | Session transcript onarımı |
| `src/agents/auth-profiles.ts` | Auth profili yönetimi |

---

## 2. 7/24 Çalışma Mekanizması (Daemon Layer)

OpenClaw'ın sürekli çalışabilmesi için **platform-native servis yöneticileri** kullanır. Bu, sistem yeniden başlasa bile otomatik olarak ayağa kalkmasını sağlar.

### 2.1 Platform Desteği

**`src/daemon/service.ts:66-156`**

```typescript
export function resolveGatewayService(): GatewayService {
  if (process.platform === "darwin") {
    // macOS: launchd (LaunchAgent)
    return {
      label: "LaunchAgent",
      install: installLaunchAgent,
      restart: restartLaunchAgent,
      isLoaded: isLaunchAgentLoaded,
      // ...
    };
  }

  if (process.platform === "linux") {
    // Linux: systemd user service
    return {
      label: "systemd",
      install: installSystemdService,
      restart: restartSystemdService,
      isLoaded: isSystemdServiceEnabled,
      // ...
    };
  }

  if (process.platform === "win32") {
    // Windows: Scheduled Task
    return {
      label: "Scheduled Task",
      install: installScheduledTask,
      restart: restartScheduledTask,
      // ...
    };
  }
}
```

### 2.2 Linux (systemd) Entegrasyonu

**Dosya:** `src/daemon/systemd.ts`

**Unit File Oluşturma:** `src/daemon/systemd-unit.ts:23-63`

```typescript
export function buildSystemdUnit({
  description,
  programArguments,
  workingDirectory,
  environment,
}): string {
  return [
    "[Unit]",
    `Description=${description}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    `ExecStart=${execStart}`,
    "Restart=always",        // ← ÇÖKME SONRASI OTOMATİK RESTART
    "RestartSec=5",          // ← 5 saniye bekleme
    "KillMode=process",
    workingDirLine,
    ...envLines,
    "",
    "[Install]",
    "WantedBy=default.target",
  ].join("\n");
}
```

**Servis Yönetimi:**

```bash
# Kurulum (otomatik)
openclaw onboard --install-daemon

# Manuel kontrol
systemctl --user status openclaw-gateway
systemctl --user restart openclaw-gateway
systemctl --user enable openclaw-gateway  # Login'de otomatik başlat
```

**Servis Dosyası Konumu:**
- `~/.config/systemd/user/openclaw-gateway.service`

### 2.3 macOS (launchd) Entegrasyonu

**Dosya:** `src/daemon/launchd.ts`

**LaunchAgent Özellikleri:**
- `KeepAlive`: true → Sürekli çalışma garantisi
- `RunAtLoad`: true → Login'de başlat
- `StandardOutPath`: Log yönetimi

**Servis Dosyası Konumu:**
- `~/Library/LaunchAgents/com.openclaw.gateway.plist`

### 2.4 Windows (Scheduled Task) Entegrasyonu

**Dosya:** `src/daemon/schtasks.ts`

**Özellikler:**
- Kullanıcı login olduğunda başlat
- Görev çökerse otomatik restart

---

## 3. Heartbeat Sistemi (Proaktif Sağlık Kontrolü)

Heartbeat, OpenClaw'ın **düzenli aralıklarla kendi kendini kontrol etmesini** sağlayan mekanizmadır. Varsayılan olarak **30 dakikada bir** çalışır.

### 3.1 Heartbeat Yapılandırması

**`docs/gateway/heartbeat.md`**

```json5
// ~/.openclaw/openclaw.json
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",           // Çalışma aralığı (0m = devre dışı)
        target: "last",         // "last" | "none" | "whatsapp" | "telegram" ...
        model: "anthropic/claude-opus-4-5",  // Opsiyonel model override
        includeReasoning: false, // Ayrı Reasoning mesajı gönder
        prompt: "Read HEARTBEAT.md if it exists...",
        ackMaxChars: 300,       // HEARTBEAT_OK sonrası max karakter
        activeHours: {          // Aktif saatler (opsiyonel)
          start: "08:00",
          end: "24:00",
          timezone: "user"      // "user" | "local" | "Europe/Istanbul"
        }
      },
    },
  },
}
```

### 3.2 Heartbeat Prompt ve İşleyiş

**`src/auto-reply/heartbeat.ts:5-6`**

```typescript
export const HEARTBEAT_PROMPT =
  "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. " +
  "Do not infer or repeat old tasks from prior chats. " +
  "If nothing needs attention, reply HEARTBEAT_OK.";
```

**Heartbeat Akışı:**

1. **Zamanlayıcı** (`src/infra/heartbeat-runner.ts:200+`)
   - Her agent için ayrı interval takibi
   - `nextDueMs` hesaplama

2. **İçerik Kontrolü** (`src/auto-reply/heartbeat.ts:22-52`)
   - `HEARTBEAT.md` boş mu kontrolü
   - Boşsa API çağrısı atlaması (token tasarrufu)

3. **Agent Çalıştırma** (`src/infra/heartbeat-runner.ts`)
   - Main session'da agent turn çalıştırma
   - Sistem event'leri (exec completion vb.) kontrolü

4. **Yanıt İşleme** (`src/auto-reply/heartbeat.ts:96-157`)
   - `HEARTBEAT_OK` token'ı çıkarma
   - `maxAckChars` kontrolü
   - Gereksiz mesajları susturma

### 3.3 HEARTBEAT.md - Kontrol Listesi

**Konum:** `~/.openclaw/workspace/HEARTBEAT.md`

```markdown
# Heartbeat Checklist

- Quick scan: anything urgent in inboxes?
- Calendar: upcoming events in next 24-48h?
- Weather check if human might go out
- If task blocked, write what's missing
```

**Not:** Agent bu dosyayı **kendi güncelleyebilir**:
- "Update HEARTBEAT.md to add daily calendar check"
- "Rewrite HEARTBEAT.md to be shorter"

### 3.4 Heartbeat Tipleri

| Tip | Açıklama | Dosya |
|-----|----------|-------|
| **Scheduled** | Periyodik zamanlayıcı | `src/infra/heartbeat-runner.ts` |
| **Manual Wake** | Manuel tetikleme | `openclaw system event --text "..." --mode now` |
| **Exec Event** | Async komut tamamlandığında | `src/infra/heartbeat-runner.ts:95-98` |

---

## 4. Health Monitoring ve Self-Healing

### 4.1 Health Snapshot Sistemi

**Dosya:** `src/gateway/server/health-state.ts`

```typescript
export function buildGatewaySnapshot(): Snapshot {
  return {
    presence,           // Sistem presence bilgisi
    health,             // Health summary
    stateVersion,       // Versiyon tracking
    uptimeMs,           // Process uptime
    configPath,         // Config dosya konumu
    stateDir,           // State dizini
    sessionDefaults,    // Varsayılan session ayarları
  };
}

export async function refreshGatewayHealthSnapshot(opts?: { probe?: boolean }) {
  const snap = await getHealthSnapshot({ probe: opts?.probe });
  healthCache = snap;
  healthVersion += 1;
  if (broadcastHealthUpdate) {
    broadcastHealthUpdate(snap);  // WebSocket üzerinden yayın
  }
}
```

**Health Kontrol Komutları:**

```bash
openclaw status              # Hızlı durum özet
openclaw status --deep       # Derinlemesine kontrol
openclaw health --json       # JSON formatında health snapshot
```

### 4.2 Health Check Kategorileri

**`docs/gateway/health.md`**

1. **Channel Connectivity**
   - WhatsApp Baileys socket durumu
   - Telegram bot bağlantısı
   - Discord WebSocket

2. **Authentication Durumu**
   - Creds yaşı (`creds.json` mtime)
   - OAuth token expiry
   - API key geçerliliği

3. **Session Store Durumu**
   - Session sayısı
   - Son aktivite zamanı
   - Disk kullanımı

4. **Model/Provider Durumu**
   - Rate limit durumu
   - Cooldown durumu
   - Billing durumu

### 4.3 Otomatik Kurtarma (Auto-Recovery)

**1. Channel Reconnect:**
- WhatsApp `loggedOut` (409-515) → Otomatik relink akışı
- WebSocket disconnect → Exponential backoff ile retry

**2. Config Validation:**
- Geçersiz config → Gateway başlatmayı reddet
- `openclaw doctor --fix` ile otomatik onarım

**3. Session Repair:**
- Bozuk session transcript → `session-transcript-repair.ts` ile onarım

---

## 5. Model Failover ve Auth Profile Rotation

### 5.1 Auth Profile Sistemi

**Dosya:** `src/agents/auth-profiles.ts`

**Profil Türleri:**
- `api_key`: API key bazlı auth
- `oauth`: OAuth token bazlı auth (refresh desteği)

**Profil Konumu:**
- `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`

### 5.2 Rotation ve Cooldown Mantığı

**`docs/concepts/model-failover.md`**

```
Hata Durumu → İşlem
─────────────────────────────────
Auth Hatası → 1m cooldown
Rate Limit  → 5m → 25m → 1h (exponential)
Billing     → 5h → 10h → 24h (disable)
Timeout     → Rate limit gibi
```

**Cooldown Yapısı:** `auth-profiles.json`

```json
{
  "usageStats": {
    "anthropic:default": {
      "lastUsed": 1736160000000,
      "cooldownUntil": 1736160600000,
      "errorCount": 2
    },
    "openai:billing": {
      "disabledUntil": 1736178000000,
      "disabledReason": "billing"
    }
  }
}
```

### 5.3 Failover Akışı

**`src/agents/pi-embedded-runner/run.ts:175-200`**

```typescript
const throwAuthProfileFailover = (params) => {
  const reason = resolveAuthProfileFailoverReason({
    allInCooldown: params.allInCooldown,
    message,
  });
  
  throw new FailoverError(message, { reason, provider, model });
};
```

**Failover Sebepleri:**
- `rate_limit`: Rate limit aşıldı
- `auth`: Kimlik doğrulama hatası
- `billing`: Yetersiz kredi
- `timeout`: Zaman aşımı
- `unknown`: Bilinmeyen hata

### 5.4 Model Fallback Zinciri

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-opus-4-5",
        fallbacks: [
          "openai/gpt-4o",
          "google/gemini-2.0-flash",
        ]
      }
    }
  }
}
```

---

## 6. Context Window ve Compaction Sistemi

### 6.1 Context Window Limitleri

**`src/agents/context-window-guard.ts`**

```typescript
export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000;
```

**Limit Kaynakları (öncelik sırası):**
1. Model tanımı (provider catalog)
2. `modelsConfig` (custom model tanımları)
3. `agents.defaults.contextTokens`
4. Default (16k)

### 6.2 Auto-Compaction

**`docs/concepts/compaction.md`**

Context window dolunca otomatik özetleme:

```
1. Context doluluk kontrolü
2. Eski mesajların özetlenmesi
3. Summary entry oluşturma
4. JSONL history'e yazma
5. Retry (orijinal isteği tekrar dene)
```

**Kompaksiyon Göstergeleri:**
- `🧹 Auto-compaction complete` (verbose mode)
- `/status` → `🧹 Compactions: <count>`

### 6.3 Manuel Compaction

```
/compact                    # Basit compaction
/compact Focus on decisions # Talimatlı compaction
```

### 6.4 Session Transcript Repair

**`src/agents/session-transcript-repair.ts:69-150`**

Tool call/result eşleşme hatalarını onarır:
- Eksik tool result'ları sentetik hata ile tamamlama
- Duplicate tool result'ları temizleme
- Orphan tool result'ları kaldırma

---

## 7. Bellek ve Öğrenme Sistemi

### 7.1 Bellek Katmanları

```
┌─────────────────────────────────────────┐
│  SESSİON BELLEĞİ (Anlık)                │
│  • Conversation history                 │
│  • Tool results                         │
│  • Session özel context                 │
│  Dosya: sessions.json                   │
└─────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────┐
│  GÜNLÜK BELLEK (Kısa Vadeli)            │
│  • memory/YYYY-MM-DD.md                 │
│  • Raw loglar, kararlar, olaylar        │
│  • Agent her session'da okur            │
└─────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────┐
│  UZUN VADELİ BELLEK (MEMORY.md)         │
│  • Sadece main session'da yüklenir      │
│  • Distilled wisdom, öğrenilenler       │
│  • Güvenlik: Grup chat'te yüklenmez     │
└─────────────────────────────────────────┘
```

### 7.2 Bellek Dosyaları

**`docs/reference/templates/AGENTS.md:28-52`**

| Dosya | Açıklama | Yükleme |
|-------|----------|---------|
| `SOUL.md` | Agent kişiliği | Her session |
| `USER.md` | Kullanıcı bilgileri | Her session |
| `memory/YYYY-MM-DD.md` | Günlük loglar | Bugün + dün |
| `MEMORY.md` | Uzun vadeli hafıza | Sadece main session |
| `HEARTBEAT.md` | Periyodik checklist | Heartbeat'te |

### 7.3 Bellek Bakımı (Heartbeat Sırasında)

**`docs/reference/templates/AGENTS.md:203-214`**

```
Periyodik olarak (birkaç günde bir):
1. Son memory/YYYY-MM-DD dosyalarını oku
2. Önemli olayları, dersleri belirle
3. MEMORY.md'yi güncelle (distilled learnings)
4. Eski/irrelevant bilgileri kaldır
```

### 7.4 Context Files (Runtime Injection)

**`src/agents/pi-embedded-runner/system-prompt.ts:9-74`**

System prompt oluşturulurken belirli dosyalar otomatik inject edilir:
- `SOUL.md` → Kimlik/personality
- `USER.md` → Kullanıcı context
- `HEARTBEAT.md` → Periyodik görevler
- Skills → `SKILL.md` dosyaları

---

## 8. Sandbox ve Güvenlik Yalıtımı

### 8.1 Sandbox Modları

**`src/agents/sandbox.ts`**

| Mod | Açıklama | Kullanım |
|-----|----------|----------|
| `all` | Tüm session'lar host'ta çalışır | Güvenilir ortam |
| `non-main` | Sadece non-main session sandbox | Grup güvenliği |
| `none` | Sandbox devre dışı | Hızlı geliştirme |

### 8.2 Docker Sandbox

**Sandbox Container Yönetimi:**
- `src/agents/sandbox/docker.ts`: Container oluşturma
- `src/agents/sandbox/manage.ts`: Container listeleme/silme
- `src/agents/sandbox/context.ts`: Workspace mount'ları

### 8.3 Tool Policy

**`src/agents/sandbox/tool-policy.ts`**

Her session için tool izinleri:
- **Allowlist**: İzin verilen tool'lar
- **Denylist**: Yasaklanan tool'lar
- **Elevated mode**: Host permissions (manuel toggle)

---

## 9. Cron Job Sistemi

### 9.1 Cron Servisi

**`src/cron/service.ts`**

```typescript
export class CronService {
  async start() { /* Timer'ları başlat */ }
  stop() { /* Timer'ları durdur */ }
  async add(input: CronJobCreate) { /* Yeni job ekle */ }
  async run(id: string, mode?: "due" | "force") { /* Job çalıştır */ }
  wake(opts: { mode: "now" | "next-heartbeat"; text: string }) { /* Manuel wake */ }
}
```

### 9.2 Cron vs Heartbeat

| Özellik | Cron | Heartbeat |
|---------|------|-----------|
| **Zamanlama** | Kesin ("9:00 AM") | Esnek (~30dk) |
| **Context** | İzole session | Main session |
| **Model** | Farklı model seçilebilir | Varsayılan model |
| **Delivery** | Doğrudan kanala | Main session üzerinden |
| **Kullanım** | Hatırlatıcılar, raporlar | Genel kontrol, inbox |

### 9.3 Cron Job Yapılandırması

```json5
{
  cron: {
    jobs: [
      {
        id: "daily-report",
        schedule: "0 9 * * *",  // Her gün 9:00
        prompt: "Generate daily summary",
        target: "whatsapp",
        to: "+15551234567",
        model: "anthropic/claude-sonnet-4",
      }
    ]
  }
}
```

---

## 10. Özet: Self-Healing Mekanizmaları

```
┌─────────────────────────────────────────────────────────────┐
│                    SELF-HEALING STACK                        │
├─────────────────────────────────────────────────────────────┤
│ 1. DAEMON LAYER                                             │
│    • systemd/launchd restart=always                         │
│    • Process crash → 5 saniye içinde restart                │
│    • Sistem reboot → Login'de otomatik başlat               │
├─────────────────────────────────────────────────────────────┤
│ 2. HEALTH MONITORING                                        │
│    • 30dk heartbeat ile proaktif kontrol                    │
│    • Channel connectivity probe'ları                        │
│    • Health snapshot caching ve broadcast                   │
├─────────────────────────────────────────────────────────────┤
│ 3. MODEL FAILOVER                                           │
│    • Auth profile rotation (OAuth → API key)                │
│    • Cooldown yönetimi (exponential backoff)                │
│    • Model fallback zinciri                                 │
├─────────────────────────────────────────────────────────────┤
│ 4. CONTEXT MANAGEMENT                                       │
│    • Auto-compaction (context dolunca özetle)               │
│    • Session transcript repair (tool eşleşme)               │
│    • Context window guard (limit kontrolü)                  │
├─────────────────────────────────────────────────────────────┤
│ 5. ERROR RECOVERY                                           │
│    • Tool hatası → Açıklama ve retry                        │
│    • Rate limit → Cooldown ve alternatif profile            │
│    • Context overflow → Compaction ve retry                 │
│    • Auth expiry → Token refresh veya failover              │
├─────────────────────────────────────────────────────────────┤
│ 6. MEMORY PERSISTENCE                                       │
│    • Session store (JSONL)                                  │
│    • Daily memory files                                     │
│    • Long-term MEMORY.md (main session)                     │
│    • Skills ve context files                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. CLI Komutları ve Kullanım

### 11.1 Servis Yönetimi

```bash
# Kurulum
openclaw onboard --install-daemon

# Servis kontrolü
openclaw service status
openclaw service restart
openclaw service stop

# Manuel gateway
openclaw gateway --port 18789 --verbose
openclaw gateway restart
```

### 11.2 Health ve Monitoring

```bash
openclaw status              # Durum özeti
openclaw status --all        # Tüm detaylar
openclaw status --deep       # Derin kontrol
openclaw health --json       # JSON health snapshot
openclaw doctor              # Sorun teşhis ve onarım
openclaw doctor --fix        # Otomatik onarım
```

### 11.3 Heartbeat Kontrolü

```bash
openclaw system heartbeat enable
openclaw system heartbeat disable
openclaw system heartbeat last    # Son heartbeat

# Manuel wake
openclaw system event --text "Check urgent emails" --mode now
```

### 11.4 Session Yönetimi

```bash
openclaw sessions              # Aktif session'lar
openclaw sessions --json       # JSON format
openclaw session reset         # Session sıfırla

# Chat komutları
/status                        # Session durumu
/new veya /reset               # Yeni session
/compact                       # Manuel compaction
/think <level>                 # Düşünme seviyesi
```

---

## 12. Kaynaklar ve Referanslar

### 12.1 Temel Dokümanlar

- `docs/gateway/heartbeat.md` - Heartbeat sistemi
- `docs/gateway/health.md` - Health monitoring
- `docs/gateway/background-process.md` - Background exec
- `docs/concepts/model-failover.md` - Failover mantığı
- `docs/concepts/compaction.md` - Context compaction
- `docs/concepts/agent-loop.md` - Agent lifecycle
- `docs/gateway/configuration.md` - Tüm yapılandırma

### 12.2 Kod Dosyaları

| Dosya | Satır | Açıklama |
|-------|-------|----------|
| `src/daemon/service.ts` | 66-156 | Platform servis yönetimi |
| `src/daemon/systemd.ts` | 215-269 | systemd entegrasyonu |
| `src/daemon/systemd-unit.ts` | 23-63 | Unit file oluşturma |
| `src/infra/heartbeat-runner.ts` | 200+ | Heartbeat scheduler |
| `src/auto-reply/heartbeat.ts` | 1-158 | Heartbeat prompt/token |
| `src/cron/service.ts` | 1-49 | Cron servisi |
| `src/gateway/server/health-state.ts` | 1-79 | Health snapshot |
| `src/agents/pi-embedded-runner/run.ts` | 72-200 | Agent runner |
| `src/agents/context-window-guard.ts` | 1-77 | Context limitleri |
| `src/agents/session-transcript-repair.ts` | 69-150 | Transcript onarım |
| `src/agents/auth-profiles.ts` | 1-41 | Auth yönetimi |

---

## 13. Sonuç

OpenClaw'ın 7/24 çalışma kapasitesi **çok katmanlı bir self-healing mimari** üzerine kuruludur:

1. **Altyapı Katmanı**: systemd/launchd ile process restart garantisi
2. **Gateway Katmanı**: Health monitoring ve heartbeat ile proaktif kontrol
3. **Agent Katmanı**: Model failover, compaction ve error recovery

Bu sistem, kullanıcı müdahalesi olmadan:
- Çökme sonrası kendini restart edebilir
- Rate limit/billing sorunlarında alternatif provider'a geçebilir
- Context dolduğunda otomatik özetleyebilir
- Bozuk session'ları onarabilir
- Periyodik olarak kendi kendini kontrol edebilir

**Sonuç olarak**, OpenClaw sadece bir chatbot değil, **kendi kendini yöneten, öğrenen ve gelişen** bir kişisel AI asistanıdır.

---

*Dokümantasyon versiyonu: 2026.1.30*  
*OpenClaw versiyonu: 2026.1.30*
