# AtomCLI Auto — Geliştirme Önerileri

> **Kapsam:** `atomcli-auto` sanal model seçicisinin akıllı, bağlam-duyarlı ve öğrenen bir yönlendirici (router) hâline getirilmesi.  
> **Araştırma Kaynakları:** LiteLLM, OpenRouter, NotDiamond, MindStudio, NeurIPS 2024 Cascade Routing

---

## 0. Sistem Bağlamı: AtomCLI'ın Model Evreni

### 0.1 AtomCLI Sadece Ücretsiz Modellerle Çalışır

AtomCLI, modelleri `opencode` sağlayıcısından devralır ve **yalnızca sıfır maliyetli olanları** filtreler.

> [!CAUTION]
> **Güvenlik Riski (Fiyat Belirsizliği):** Mevcut kodda `const inputCost = model.cost?.input ?? 0` şeklinde bir fallback var. Eğer models.dev API'sinde yeni bir ücretli modelin fiyat verisi eksik/null gelirse, sistem onu "ücretsiz" (`0`) sayar ve kullanıcı isteğini ücretli modele yönlendirebilir.
> 
> **Güvenli Çözüm (Strict Gateway):** cost veya fiyat alanı eksik olan her model varsayılan olarak **ücretli (Paid)** sayılmalıdır. Ayrıca, test ortam değişkenleri production'da yanlışlıkla set edilse bile bypass kapısı kapatılmalıdır (`process.env.NODE_ENV !== "production"`).

```typescript
// provider.ts:733-742 — Güncellenmiş Sıkı Filtre:
function isConfirmedFree(model: Provider.Model): boolean {
  if (!model.cost || model.cost.input === undefined || model.cost.output === undefined) {
    return false // Fiyatı bilinmiyorsa paralı kabul et (Güvenli Varsayım)
  }
  return model.cost.input === 0 && model.cost.output === 0
}

const isTestEnv = typeof process !== "undefined" && 
  process.env.NODE_ENV !== "production" && 
  process.env.ATOMCLI_TEST_ALL_MODELS === "1"

const filteredModels = pickBy(database["opencode"].models, (model) => {
  if (isTestEnv) {
    return true
  }
  return isConfirmedFree(model)
})
database["atomcli"] = { ...database["opencode"], models: filteredModels }
```

Bu sayede:
- `atomcli` provider = Yalnızca doğrulanmış ücretsiz modeller.
- `atomcli-auto` yalnızca bu sıkı filtreden geçen modeller arasından seçim yapar.
- Kullanıcı asla ücretli veya fiyatı belirsiz bir modele yönlendirilemez.

### 0.2 Model Havuzu Örneği (Anlık)

```
atomcli sağlayıcısındaki modeller (cost=0 filtresi sonrası):
├── moonshotai/kimi-k2.5         [reasoning✅ toolcall✅ 128k ctx]
├── qwen/qwen3-235b-a22b         [reasoning✅ toolcall✅ 32k ctx]
├── deepseek/deepseek-r1-0528    [reasoning✅ toolcall❌ 64k ctx]
├── google/gemma-3-27b-it        [reasoning❌ toolcall✅ 8k ctx]
└── meta-llama/llama-3.3-70b     [reasoning❌ toolcall✅ 128k ctx]
         ↑
    atomcli-auto buradan seçim yapar
```

---

## 0B. Temel Sorun: Modeller Sürekli Değişiyor

> [!IMPORTANT]
> **Bu, tüm öneri belgesinin çerçevesini belirleyen kritik bir kısıt.**

Ücretsiz model ekosistemi son derece akışkandır:
- Bugün mevcut olan bir model haftaya kaldırılabilir.
- Bir modelin "iyi" olduğunu söyleyen benchmark'lar 3 ay sonra geçersiz kalabilir.
- Sağlayıcılar rate limit, kota ve bölge kısıtlamalarını anlık değiştirir.

### Yanlış Yaklaşım: İsme Dayalı Routing

```typescript
// ❌ YAPILMAMALI — bu liste 3 ay sonra işe yaramaz:
const GOOD_FREE_MODELS = [
  "moonshotai/kimi-k2.5",
  "qwen/qwen3-235b-a22b",
  "deepseek/deepseek-r1-0528",
]
```

### Doğru Yaklaşım: Yetkinlik Bayraklarına (Capability Flags) Dayalı Routing

AtomCLI'ın zaten kullandığı `models.dev` API'si her model için **gerçek zamanlı metadata** sağlıyor. Bu metadata içindeki capability flag'ler, hangi modelin ne yapabileceğini her zaman güncel tutabilir:

```typescript
// Provider.Model içindeki capability flags (provider.ts:569-593)
capabilities: {
  reasoning: boolean,   // Akıl yürütme / CoT desteği
  toolcall: boolean,    // Function calling desteği
  attachment: boolean,  // Dosya/görsel eki
  interleaved: boolean, // Düşünce-cevap arası geçiş
  input:  { text, audio, image, video, pdf },
  output: { text, audio, image, video, pdf },
}
```

Bu flag'ler models.dev veritabanından her uygulama başlangıcında çekilir. **Hiçbir model ismi koda gömülmez.** Sistem her zaman mevcut ücretsiz modeller arasından en iyisini seçer.

---

## 0C. Mevcut Durum → Hedef: Karşılaştırma

### Şu An Nasıl Çalışıyor?

```
┌─────────────────────────────────────────────────────────────────┐
│  MEVCUT DURUM ("Sığ" Routing)                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Kullanıcı başlar                                               │
│       │                                                         │
│       ▼                                                         │
│  local.tsx: fallback model bul                                  │
│  → "atomcli-auto" seçilir                                       │
│       │                                                         │
│       ▼                                                         │
│  getModel("atomcli", "atomcli-auto")                            │
│  → Ücretsiz modeller listele                                    │
│  → Sadece context+output büyüklüğüne göre sırala               │
│  → En büyük context'e sahip modeli seç                         │
│       │                                                         │
│       ▼                                                         │
│  Seçilen model TÜM OTURUM için aynı kalır ────────────────────→ PROBLEM
│  (Planlama da, kodlama da, web araştırması da)                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Mevcut sistemin eksiklikleri (özet):**
- Tek kriter: boyut (context window)
- Tek model: tüm oturum boyunca aynı
- Statik seçim: görev değişse de model değişmez
- model-router.ts'deki akıllı puanlama sistemi hiç kullanılmıyor

### Hedef: Dinamik Çok-Katmanlı Routing

```
┌─────────────────────────────────────────────────────────────────┐
│  HEDEF DURUM ("Akıllı" Routing)                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Kullanıcı isteği                                               │
│       │                                                         │
│       ▼                                                         │
│  ① META-ROUTER (en yetenekli mevcut model)                     │
│     Promptu analiz et → görev kategorisini belirle             │
│       │                                                         │
│       ├─ Planlama/Koordinasyon → ② Reasoning Modeli           │
│       ├─ Kodlama              → ③ ToolCall + Reasoning Modeli │
│       ├─ Web Araştırması      → ④ Hızlı + Geniş Ctx Modeli   │
│       ├─ Doküman Yazma        → ⑤ Uzun Output Modeli          │
│       └─ Genel Sohbet         → ⑥ Dengeli Modeli              │
│                                                                 │
│  Her subtask → kendi optimum modeliyle çalışır                  │
│  Model havuzu dinamiktir → bugün/yarın farklı modeller olsa da │
│  capability-based scoring hep doğru seçimi yapar               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 0D. Ortak Temel: ModelState Kaydı (Health, Latency ve Dağıtım Birleşimi)

Dinamik sağlık izleme, gerçek zamanlı gecikme ölçümü ve modeller arası yük dağıtımı (load balancing) için in-memory bir durum yöneticisi tasarlanmalıdır.

### 0D.1 Veri Yapısı

Sağlık izleme ve performans takibi **providerID bazlı değil, modelID bazlı** yapılmalıdır. Çünkü tüm ücretsiz modeller aynı `atomcli` sağlayıcısı altındadır.

```typescript
interface ModelState {
  modelID: string               // Örn: "qwen/qwen3-235b-a22b"
  consecutiveFailures: number   // Üst üste alınan hata sayısı
  lastError: number | null      // Son hata timestamp'i
  recentLatenciesMs: number[]   // Gerçek API gecikmeleri (Son 20 çağrı ring buffer)
  usageCount: number            // Modelin kullanım sıklığı (Yük paylaştırma için)
  windowStart: number           // Zaman penceresi başlangıcı
}

const modelStates = new Map<string, ModelState>()
```

### 0D.2 Performans ve Hata Kaydı

Her API çağrısı bittiğinde bu fonksiyon tetiklenerek model istatistikleri güncellenir:

```typescript
export function recordCallResult(modelID: string, ok: boolean, latencyMs?: number) {
  const s = modelStates.get(modelID) ?? {
    modelID,
    consecutiveFailures: 0,
    lastError: null,
    recentLatenciesMs: [],
    usageCount: 0,
    windowStart: Date.now()
  }

  if (ok) {
    s.consecutiveFailures = 0
    if (latencyMs !== undefined) {
      s.recentLatenciesMs.push(latencyMs)
      if (s.recentLatenciesMs.length > 20) s.recentLatenciesMs.shift()
    }
  } else {
    s.consecutiveFailures++
    s.lastError = Date.now()
  }
  s.usageCount++
  modelStates.set(modelID, s)
}
```

---

## 1. Mevcut Durumun Analizi

### 1.1 AtomCLI Auto Nasıl Çalışıyor?

```
provider.ts  →  getModel("atomcli", "atomcli-auto")
                  ↓
              Tüm ücretsiz modelleri filtrele
                  ↓
              context_window + output_limit'e göre sırala
                  ↓
              En büyük context window'a sahip olanı seç  ← TEK KRİTER
```

### 1.2 Tespit Edilen Sorunlar

| # | Sorun | Etki |
|---|-------|------|
| 1 | **Sadece context+output sıralaması** — model kalitesi, reasoning, toolcall desteği göz ardı | Büyük context'li ama yetersiz reasoning modelini seçer |
| 2 | **model-router.ts'deki `scoreModel()` atlanıyor** — Orchestrate tool'da var, Auto'da yok | Mevcut iyi puanlama sistemi kullanılmıyor |
| 3 | **`inferCategory()` kaba keyword matching** — "class" kelimesi biri hayvanlar biyolojisi diyorsa da "coding" çıkabilir | Yanlış kategori → yanlış model |
| 4 | **Prompt büyüklüğü/karmaşıklığı dikkate alınmıyor** — kısa/uzun, basit/karmaşık ayırt edilmiyor | Over-provision ya da under-provision |
| 5 | **Kullanıcı tercihi yok** — Hız mı? Kalite mi? Akıl yürütme mi? | Herkese aynı davranış |
| 6 | **Fallback zinciri yok** — Seçilen model hata verirse ne olur? | Sessiz başarısızlık |
| 7 | **Hiç loglama yok** — Neden A değil B seçildi? | Görünmez karar süreci |
| 8 | **Model churn problemi yok sayılıyor** — Ücretsiz modeller sürekli değişiyor; statik varsayımlar hızla geçersiz kalır | Gelecekte yanlış seçimler artar, bakım maliyeti büyür |
| 9 | **Boş aday listesi riski** — Sert filtreleme sonrası sıfır model kalırsa sistem patlar | `undefined` hatasıyla çökme |
| 10 | **Sağlık izleme granülaritesi yanlış** — Provider bazlı izleme, tek bir model çöktüğünde tüm ücretsiz havuzu kapatır | Alternatif modellere geçiş engellenir |
| 11 | **Cost fallback'i güvenlik açığı barındırıyor** — cost alanı null ise ücretsiz sayılıyor | Yanlışlıkla ücretli modellere istek atılabilir |
| 12 | **Çok anlamlı kelimeler (polysemy)** — class/yaz kelimeleri yanlış kategori tespiti yapıyor | Yanlış model seçimi |
| 13 | **Hız/latency verisi models.dev'de yok** — Hız öncelikli modlar hayali bir alana bakıyor | Latency tabanlı yönlendirme çalışmıyor |
| 14 | **Context yeterliliği sadece son prompt'u ölçüyor** | Konuşma geçmişi ve sistem promptu sığmadığında API hatası |
| 15 | **Meta-router tanım karmaşası** | Karar veren kod ile planlama yapan LLM birbirine giriyor |

---

## 2. Önerilen Mimari

```
Kullanıcı Promptu
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AtomCLI Auto Router                           │
│                                                                 │
│  ① Prompt Analizi      ② Capability Scoring   ③ Seçim          │
│  ────────────────      ─────────────────────  ──────────        │
│  • Token tahmini       • Kategori skoru        • En yüksek      │
│  • Karmaşıklık         • Reasoning bonus       • Fallback       │
│  • Dil tespiti         • Context yeterliliği   • Sağlık         │
│  • Tool ihtiyacı       • Kullanıcı modu puan   • kontrol        │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
  Gerçek Model API
```

---

## 3. Kısa Vadeli İyileştirmeler (Hemen Yapılabilir)

### 3.1 Terminoloji ve Aday Listesi Güvenliği (Kademeli Gevşeme - Degradation Ladder)

> [!IMPORTANT]
> **Terminoloji Ayrımı:**
> - `scoreModel()`: Sadece yetenek bayraklarına dayalı **saf (pure)** puanlama yapar.
> - `selectModel()`: Aday listesi oluşturma, Degradation Ladder, birleşik puanlama (`finalScore`) ve yük paylaştırmayı yöneten **ana yönlendiricidir**.

Eğer models.dev'den dönen modellerde belirli kriterleri (örneğin coding için `toolcall: true`) sağlayan hiçbir aday yoksa aday listesi boş kalır ve sistem çöker. Bunu önlemek için kademeli gevşeyen bir seçim merdiveni uygulanmalıdır:

```typescript
// model-router.ts

function categoryHardOk(m: Provider.Model, category: TaskCategory): boolean {
  if (category === "coding" && !m.capabilities.toolcall) return false
  if (category === "analysis" && !m.capabilities.reasoning) return false
  return true
}

export function selectCandidates(
  freeModels: Array<[string, Provider.Model]>, 
  category: TaskCategory
): Array<[string, Provider.Model]> {
  if (freeModels.length === 0) {
    throw new Error("NoFreeModelsError: Kullanılabilir hiçbir ücretsiz model bulunamadı!")
  }
  
  const tiers = [
    // Tier 0: Görev kategorisi tam karşılanıyor VE model sağlıklı (hata yok)
    (id: string, m: Provider.Model) => categoryHardOk(m, category) && (modelStates.get(id)?.consecutiveFailures ?? 0) === 0,
    
    // Tier 1: Görev kategorisi tam karşılanıyor (sağlık durumu ne olursa olsun)
    (id: string, m: Provider.Model) => categoryHardOk(m, category),
    
    // Tier 2: Görev kategorisi "general" olarak gevşetiliyor VE model sağlıklı
    (id: string, m: Provider.Model) => categoryHardOk(m, "general") && (modelStates.get(id)?.consecutiveFailures ?? 0) === 0,
    
    // Tier 3: Elimizde kalan ne varsa (Tier 3 her zaman true döner)
    (id: string, m: Provider.Model) => true
  ]
  
  for (const check of tiers) {
    const candidates = freeModels.filter(([id, m]) => check(id, m))
    if (candidates.length > 0) return candidates
  }
  
  return freeModels // Fallback
}
```

**Kazanım:** Ücretsiz model havuzu ne kadar daralırsa daralsın, sistem `undefined` dönüp çökmek yerine yetenekleri kısarak çalışmaya devam eder ve bunu loglar.

---

### 3.2 Çok Anlamlılık (Polysemy) ve Margin Testli Kategori Tespiti

`"class"` kelimesi biyoloji dersinden bahsederken de geçebilir, nesne yönelimli programlamadan bahsederken de. Basit keyword sayımı bu ayrımı yapamaz. 

**Çözüm:** Tüm kategorileri aynı anda puanlama ve aralarındaki farkı (margin) ölçme.

```typescript
// model-router.ts

function scoreAgainstPatterns(prompt: string, patterns: WeightedKeyword[]): number {
  let score = 0
  const lower = prompt.toLowerCase()
  for (const p of patterns) {
    const isRegex = p.pattern instanceof RegExp
    const matches = isRegex 
      ? (lower.match(p.pattern) ?? []).length 
      : (lower.includes(p.pattern as string) ? 1 : 0)
    score += matches * p.weight
  }
  return score
}

export function inferCategoryMulti(prompt: string): { category: TaskCategory; confidence: number } {
  const scores = {
    coding: scoreAgainstPatterns(prompt, CODING_PATTERNS),
    documentation: scoreAgainstPatterns(prompt, DOC_PATTERNS),
    analysis: scoreAgainstPatterns(prompt, ANALYSIS_PATTERNS),
    general: 1, // Taban puan
  }
  
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [topCategory, topScore] = sorted[0]
  const runnerUpScore = sorted[1][1]
  const margin = topScore - runnerUpScore
  
  // Eğer en yüksek iki kategori birbirine çok yakınsa (margin farkı %30'dan azsa) belirsizlik vardır.
  // Bu durumda "general" kategorisine düşür.
  if (margin < topScore * 0.3) {
    return { category: "general", confidence: 0.4 }
  }
  
  return { category: topCategory as TaskCategory, confidence: margin / topScore }
}
```

**Kazanım:** Tek bir kelimenin ("class" veya "yaz") farklı bağlamlarda yanlış kategori tetiklemesini engeller, belirsiz durumlarda güvenli liman olan `general` moduna geçer.

---

### 3.3 Konuşma Geçmişini Kapsayan Context Yeterlilik Kontrolü

Sadece son atılan prompt'un boyutunu ölçmek hatalıdır. Agentic modda context window'ı tüketen asıl yük sistem promptu, tool şemaları ve konuşma geçmişidir.

**Çözüm (Toplam Oturum Bütçesi Hesaplama):**

```typescript
function estimateRequiredContext(session: SessionState, currentPrompt: string): number {
  const systemPromptTokens = session.systemPromptTokenCount ?? 1500
  const toolSchemasTokens = session.toolSchemaTokenCount ?? 3000
  const conversationHistoryTokens = session.cumulativeTokenCount ?? 0
  const currentPromptTokens = Math.ceil(currentPrompt.length / 4) // 1 token ≈ 4 karakter
  const outputReserve = 2000 // Çıktı için ayrılan pay
  
  return systemPromptTokens + toolSchemasTokens + conversationHistoryTokens + currentPromptTokens + outputReserve
}

// Filtreleme adımı:
const requiredContext = estimateRequiredContext(currentSession, prompt)
const suitableModels = freeModels.filter(([, m]) =>
  (m.limit?.context ?? 0) >= requiredContext
)
```

**Kazanım:** Uzun süren oturumlarda son adımda aniden alınan "context window exceeded" hatalarını henüz model çağrısı yapılmadan önler.

---

## 4. Orta Vadeli İyileştirmeler (1-2 Sprint)

### 4.1 Kullanıcı Modu ve Birleşik Skorlama (`finalScore`)

Ayrı ayrı scoring sistemleri yerine; `scoreModel()`, `auto_mode` çarpanları, `complexity` etkisi, dinamik gecikme (latency) ve sağlık cezaları tek bir birleşik puanlama fonksiyonunda toplanmalıdır.

```typescript
// model-router.ts

export const MODE_WEIGHTS = {
  speed:     { context: 0.1, output: 0.1, toolcall: 0.3, reasoning: 0.0, latency: 1.5 },
  balanced:  { context: 0.3, output: 0.3, toolcall: 0.5, reasoning: 0.5, latency: 1.0 },
  quality:   { context: 0.5, output: 0.5, toolcall: 0.8, reasoning: 1.5, latency: 0.5 },
  reasoning: { context: 0.3, output: 0.3, toolcall: 0.5, reasoning: 3.0, latency: 0.2 },
}

export function finalScore(
  id: string,
  m: Provider.Model, 
  category: TaskCategory, 
  mode: AutoMode, 
  complexity: number = 0
): number {
  // 1. Temel puanlama (saf yetenekler)
  const base = scoreModel(m, category)
  const w = MODE_WEIGHTS[mode]
  
  // 2. Mod ağırlıklı yetenek bonusları (toolcall çarpanı dahil edildi)
  let score = base * (1 + w.reasoning * (m.capabilities.reasoning ? 1.5 : 0))
            + w.context * Math.min(m.limit.context / 10000, 20)
            + w.output  * Math.min(m.limit.output  / 1000, 20)
            + w.toolcall * (m.capabilities.toolcall ? 20 : 0)
            
  // 3. Karmaşıklık (Complexity) etkisi: >= 7 ise reasoning modellerine ek bonus
  if (complexity >= 7 && m.capabilities.reasoning) {
    score += 40
  }
  
  // 4. Dinamik Latency Cezası (models.dev'de hız verisi yoktur, in-memory ModelState'ten ölçülür)
  const state = modelStates.get(id)
  let avgLat = state && state.recentLatenciesMs.length > 0 
    ? state.recentLatenciesMs.reduce((a, b) => a + b, 0) / state.recentLatenciesMs.length 
    : null
    
  // İlk çalıştırmada veri yoksa context limit'ini zayıf bir proxy (küçük model = hızlı) olarak kullan
  // Note: Gerçek ölçümler biriktikçe bu proxy'nin etkisi sıfırlanır ve tamamen gerçek gecikme verisi kullanılır.
  if (avgLat === null) {
    avgLat = (m.limit.context / 1000) * 10 // Örn: 128k ctx -> 1280ms varsayılan
  }
  score -= w.latency * (avgLat / 1000)
  
  // 5. Yumuşak Sağlık Cezası (Soft Penalty - ModelID bazlı)
  // Tamamen elemek yerine ceza puanı verilir. Böylece tek kalan model sağlıksız olsa bile sistem çökmez.
  const failures = state?.consecutiveFailures ?? 0
  score -= failures * 15
  
  return Math.max(score, 0)
}
```

---

### 4.2 Fallback Zinciri ve Yük Paylaştırma (Load Balancing)

Tek bir modele aşırı yük binmesini (rate limit) önlemek ve hata anında yedekleri tutmak için hem Fallback hem de Load Balancing bir arada uygulanır.

```typescript
interface FallbackChain {
  primary: { providerID: string; modelID: string }
  fallbacks: Array<{ providerID: string; modelID: string }>
  reason: string
}

// 4.2.1 Yük Paylaştırmalı Seçim (Rastgele Ağırlık Dağıtımı)
function pickWithLoadBalancing(
  ranked: Array<{ id: string; m: Provider.Model; score: number }>, 
  poolSize: number
): { id: string; m: Provider.Model; score: number } {
  // Havuz küçükse (≤ 3) hepsi arasında dönüştür, büyükse en iyi %30'luk dilimde kal
  const topN = poolSize <= 3 ? ranked.length : Math.max(2, Math.ceil(poolSize * 0.3))
  const pool = ranked.slice(0, topN)
  
  // Ağırlık = skor / (1 + kullanım_sayısı * 0.5)
  // Çok kullanılan modellerin ağırlığı düşer, böylece diğer kaliteli modeller de şans bulur.
  const weights = pool.map(c => {
    const usage = modelStates.get(c.id)?.usageCount ?? 0
    return c.score / (1 + usage * 0.5)
  })
  
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * totalWeight
  
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r <= 0) return pool[i]
  }
  return pool[0]
}

interface ModelSelectionResult {
  selected: { id: string; m: Provider.Model; score: number }
  ranked: Array<{ id: string; m: Provider.Model; score: number }>
}

export function selectModel(
  category: TaskCategory,
  allFreeModels: Array<[string, Provider.Model]>,
  mode: AutoMode = "balanced",
  complexity = 0,
  session?: SessionState,
  prompt?: string
): ModelSelectionResult {
  // 1. Konusma gecmisi ve oturum butcesini kontrol et
  let filtered = allFreeModels
  if (session && prompt) {
    const requiredContext = estimateRequiredContext(session, prompt)
    filtered = allFreeModels.filter(([, m]) => (m.limit?.context ?? 0) >= requiredContext)
  }
  
  // Eger butce filtrelemesi sonrasi hic model kalmadiysa, degradation ladder icin tum listeye geri don
  const pool = filtered.length > 0 ? filtered : allFreeModels
  
  // 2. Kademeli Gevseme (Degradation Ladder) ile adaylari filtrele
  const candidates = selectCandidates(pool, category)
  
  // 3. Birlesik Skorlama yap (id parametresi finalScore'a gecildi)
  const ranked = candidates
    .map(([id, m]) => ({ id, m, score: finalScore(id, m, category, mode, complexity) }))
    .sort((a, b) => b.score - a.score)
    
  // 4. Yuk paylastirici (Load Balancing) ile model sec
  const selected = pickWithLoadBalancing(ranked, candidates.length)
  
  return { selected, ranked }
}

export function buildFallbackChain(
  category: TaskCategory,
  allFreeModels: Array<[string, Provider.Model]>,
  mode: AutoMode = "balanced",
  complexity = 0,
  session?: SessionState,
  prompt?: string
): FallbackChain {
  // 1. Ana Yonlendirici ile birincil model ve filtrelenmis/siralanmis listeyi al
  // Boylece fallback listesi de ayni context-filtresinden gecmis olur, context bypass riski engellenir.
  const { selected, ranked } = selectModel(category, allFreeModels, mode, complexity, session, prompt)
  
  // 2. Aday listesindeki diger modelleri yedek (fallback) olarak ekle (en fazla 2 adet)
  const fallbacks = ranked
    .filter(x => x.id !== selected.id)
    .slice(0, 2)
    .map(x => ({ providerID: "atomcli", modelID: x.id }))
    
  return {
    primary: { providerID: "atomcli", modelID: selected.id },
    fallbacks,
    reason: `category=${category}, mode=${mode}, finalScore=${selected.score.toFixed(1)}`,
  }
}
```

---

### 4.3 Routing Kararlarını Loglama (Düzeltilmiş Scope ve Destructuring)

Her Auto seçimi için log yazılır. Loglama fonksiyonu `selectModel()`'in döndürdüğü kapsam içi `ranked` listesini kullanacak şekilde güncellenmiştir:

```typescript
// Her seçimde:
const { selected, ranked } = selectModel(category, allFreeModels, mode, complexity, session, prompt)
const requiredContext = session && prompt ? estimateRequiredContext(session, prompt) : undefined

const decision: RoutingDecision = {
  ts: Date.now(),
  category,
  mode: config.experimental?.auto_mode ?? "balanced",
  selected: selected.id,
  score: selected.score,
  // ranked listesi artik selectModel'den doner, scope/destructuring hatasi cozulmustur:
  candidates: ranked.slice(0, 5).map(({ id, score }) => ({ id, score })),
  estimatedRequiredContext: requiredContext,
  sessionID,
}
await appendRoutingLog(decision)
```

---

## 4B. Dinamik Agentic Routing: Görev-Bazlı Model Geçişi

> Bu bölüm, kullanıcının "agentic modda planlama başka model, web araştırması başka model yapmalı" gereksinimini karşılar.

### Konsept: Her Subtask Kendi Modeline

Şu an orchestrate tool, `smart_model_routing` etkinse görev kategorisine göre model seçebiliyor. Ancak bu:
1. Sadece orchestrate tool'da çalışıyor (tek-ajan modunda değil)
2. Ücretsiz model önceliği garantilemiyor  
3. Meta-router (seçimi yapan model) sabit

**Hedef:** Tüm agentic pipeline'da görev değiştikçe model değişsin.

### 4B.1 Meta-Router Konseptinde Seçim vs İcra Ayrımı

> [!IMPORTANT]
> Meta-router tasarımı iki aşamaya ayrılmıştır:
> 
> 1. **Deterministik Meta-Router Seçicisi (`selectMetaRouter`):** Çevrimdışı çalışan, hiçbir LLM çağrısı yapmayan ve `models.dev` verilerini puanlayarak **planlama için en yetenekli** ücretsiz modeli anında seçen TypeScript fonksiyonudur (sıfır gecikme).
> 2. **Meta-Router LLM İcrası (Planlayıcı Ajan):** Yalnızca karmaşıklık yüksekse (Complexity ≥ 5) bu seçilen birincil model çağrılarak planlama yaptırılır. Basit görevlerde bu LLM çağrısı baypas edilerek doğrudan tek bir modelle işe başlanır (Kolektif kaynak tasarrufu).

```typescript
// Meta-router = koordinasyon + planlama + karar verme
// Gereksinimler:
//   ✅ reasoning: true   (karmaşık karar mantığı)
//   ✅ toolcall: true    (alt görevleri tetiklemek için)
//   ✅ context ≥ 64k    (tüm iş akışını görmek için)

export function selectMetaRouter(freeModels: Array<[string, Provider.Model]>): { providerID: string; modelID: string } {
  const activeMr = freeModels
    .filter(([, m]) => m.capabilities.reasoning && m.capabilities.toolcall && m.status === "active")
    .map(([id, m]) => ({
      id,
      score: 100 
           + Math.min(m.limit.context / 10000, 30) 
           + Math.min(m.limit.output / 1000, 20)
    }))
    .sort((a, b) => b.score - a.score)
    
  if (activeMr.length === 0) {
    // Eşiği düşür: reasoning veya toolcall'dan en az birine sahip active modelleri kabul et
    const fallbackMr = freeModels
      .filter(([, m]) => (m.capabilities.reasoning || m.capabilities.toolcall) && m.status === "active")
      .map(([id, m]) => ({
        id,
        score: (m.capabilities.reasoning ? 50 : 0) + (m.capabilities.toolcall ? 50 : 0)
      }))
      .sort((a, b) => b.score - a.score)
      
    if (fallbackMr.length > 0) {
      return { providerID: "atomcli", modelID: fallbackMr[0].id }
    }
    // En kötü ihtimalle Degradation Ladder ile en üstteki modeli dön
    return { providerID: "atomcli", modelID: selectCandidates(freeModels, "general")[0][0] }
  }
  
  return { providerID: "atomcli", modelID: activeMr[0].id }
}
```

---

### 4B.2 Görev -> Model Eşleştirme Matrisi

| Görev | Öncelikli Capability | İkincil | Context İhtiyacı |
|-------|---------------------|---------|------------------|
| **Planlama / Koordinasyon** | `reasoning: true` | `toolcall: true` | Yüksek (≥64k) |
| **Kodlama** | `toolcall: true` | `reasoning: true` | Orta (≥32k) |
| **Web Araştırması** | Hız (küçük model tercih) | `output.text` | Orta (≥32k) |
| **Doküman Yazma** | `limit.output` büyük | `reasoning: false` ok | Yüksek (≥64k) |
| **Analiz / İnceleme** | `reasoning: true` | `limit.context` | Çok Yüksek (≥128k) |
| **Genel Sohbet** | Dengeli | herhangi | Düşük (≥8k) |

> [!NOTE]
> Web Araştırması ve Doküman Yazma gibi görevlerin `categoryHardOk()` içinde sert bir kuralı yoktur (herhangi bir model bunları üstlenebilir). Bu görevler, sert filtreler yerine `finalScore()` içindeki mod ağırlıkları ve limitler aracılığıyla en uygun modele yönlendirilir.

### 4B.3 Agentic Pipeline Akışı (Hedef)

```
Kullanıcı: "Şu repoyu analiz et, testleri yaz, dökümantasyon oluştur"
                              │
                              ▼
              ① META-ROUTER seçilir (reasoning+toolcall en iyi)
                              │
                              ▼
              ② Orchestrate: 3 görev planla
                 ├─ analyze  [category: analysis]
                 ├─ tests    [category: coding, depends: analyze]
                 └─ docs     [category: documentation, depends: analyze]
                              │
                              ▼
              ③ Her görev için ayrı model seç:
                 ├─ analyze → reasoning+büyük-context model
                 ├─ tests   → reasoning+toolcall model
                 └─ docs    → büyük-output model
                              │
                              ▼
              ④ Tüm seçimler atomcli.models havuzundan
                 (cost=0 filtresi garantili)
```

### 4B.4 Uygulama Noktaları

**Kısa vade:** `orchestrate.ts`'in model listesi kaynağını `selectModel()` kullanarak yalnızca `atomcli` provider'ına (yani cost=0 ücretsiz havuzuna) sabitle.

**Orta vade:** `getModel()` içinde context-aware kategori tespiti yap — prompt varsa `inferCategory(prompt)` çağır.

**Uzun vade:** Orchestrator agent'ı her workflow başında meta-router seçimiyle başlat; alt görevleri bu router delegasyonuyla yönetsin.

---

## 5. Uzun Vadeli İyileştirmeler (Araştırma Aşaması)

### 5.1 Prompt Complexity Scorer

**Ne:** Prompt'un "zor" olup olmadığını sayısal olarak tahmin et.

```typescript
export function estimateComplexity(prompt: string): number {
  let score = 0

  // Uzunluk: 1000 kelimeye kadar lineer artış
  score += Math.min(prompt.split(/\s+/).length / 100, 10)

  // Soru işareti sayısı (çok sorulu → daha az odaklı)
  score += Math.min((prompt.match(/\?/g) ?? []).length * 0.5, 3)

  // Teknik terim yoğunluğu (regex, API, schema, algorithm, ...)
  const techTerms = ["algorithm", "regex", "schema", "concurrent", "async", "recursive"]
  score += techTerms.filter(t => prompt.toLowerCase().includes(t)).length

  // Kod bloğu varlığı
  if (/```/.test(prompt)) score += 2

  // Çoklu görev işareti ("ve ayrıca", "ardından", "then also")
  if (/\band\b|\bayrıca\b|\bardından\b/.test(prompt.toLowerCase())) score += 1.5

  return Math.min(score, 10)  // 0-10 arası normalleştir
}
```

**Kullanım:** estimateComplexity(prompt) >= 7 ise, bu deger finalScore() fonksiyonuna arguman olarak gecirilir. finalScore() icinde complexity >= 7 sarti saglandiginda reasoning yetenegine sahip olan modellere **+40 puan eklenir**. Bu buyuk bonus, reasoning modellerini listenin en tepesine tasir ve zor gorevlerin otomatik olarak akil yuruten modellerle cozulmesini saglar.

---

### 5.2 ModelID Saglik Izleme (0D ile Birlestirildi)

Daha once onerilen providerID bazli saglik izleme mantigi, tum ucretsiz modeller ayni atomcli provider'i altinda oldugundan hatalidir.

**Guncellenen Karar:**
Saglik izleme **modelID** bazinda ModelState registry'si uzerinden yapilir (Bkz. Bolum 0D).
Secim sirasunda model elenmez; bunun yerine consecutiveFailures (ust uste hata sayisi) degeriyle orantili olarak **yumusak ceza puani (soft penalty)** uygulanır:
```typescript
score -= consecutiveFailures * 15
```
Bu sayede sagliksiz modelin onceligi duser, ancak havuzda baska alternatif yoksa sistem tamamen durmaz.

**Kazanım:** Tek bir modeldeki gecici kesintilerde tum ucretsiz havuzu kapatmak yerine, otomatik olarak diger saglikli alternatiflere gecis saglanir.

---

### 5.3 Cascade (Şelale) Routing

**Konsept:** LLM rotasyon araştırmalarından gelen "cheap-first cascade" (ucuz-önce şelale) stratejisi.

```
[1. Basit/Hızlı Model]
         │
    Çıktı yeterli mi?  ──→ EVET: Döndür
         │ HAYIR
         ▼
[2. Orta Güç Model]
         │
    Çıktı yeterli mi?  ──→ EVET: Döndür
         │ HAYIR
         ▼
[3. En Güçlü Model]
         │
         ▼
    Döndür (son çare)
```

**Uygulama Notu:** Orchestrate tool'daki QA reviewer zaten bu prensiple çalışıyor. Aynı mantığı single-agent çağrılarına da taşımak mümkün — ancak latency arttırır, dikkatli tasarım gerekir.

**Ne Zaman Kullanılmalı:** Sadece `auto_mode = "quality"` veya `auto_mode = "reasoning"` seçildiğinde devreye girmeli.

---

### 5.4 Öğrenen Routing (Deneysel)

**Konsept:** Routing kararlarını `auto-routing.jsonl` log dosyasına yaz; periyodik olarak analiz et.

```typescript
// Başarı/başarısızlık kaydı (session sonunda):
interface RoutingOutcome {
  decisionId: string
  success: boolean
  userRating?: 1 | 2 | 3 | 4 | 5  // kullanıcı geri bildirimi (gelecek feature)
  turnCount: number                  // kaç tur sürdü
  tokensUsed: number
}
```

**Analiz Yöntemi:**  
- Hangi (kategori, model) çiftleri başarılı?
- Hangi kategori tahminleri gerçekle uyumsuz?
- Hangi model turnCount'u düşürüyor?

Bu veri, `scoreModel()` ağırlıklarını zamanla kalibre etmek için kullanılabilir.

---

## 6. Öncelik Matrisi

```
             DÜŞÜK ETKİ          YÜKSEK ETKİ
             ┌──────────────────┬──────────────────────┐
KOLAY        │ 3.3 Context Yeter│ 3.1 selectModel &    │
IMPLEMENT.   │ liliği kontrolü  │     Ladder Entegr.   │
             │                  │ 3.2 inferCategory    │
             │                  │     iyileştirme      │
             │                  │ 0D  ModelState (Health)│
             ├──────────────────┼──────────────────────┤
ZOR          │ 5.4 Öğrenen      │ 4.1 finalScore Birle-│
IMPLEMENT.   │     Routing      │     şik Skorlama     │
             │                  │ 4.2 Load Balancing   │
             │                  │     ve Fallback      │
             └──────────────────┴──────────────────────┘
```

**Tavsiye Uygulama Sırası:**
1. **0D** — ModelState in-memory kaydının kurulması (health ve latency için temel altyapı)
2. **3.1** — `selectModel()` ve Degradation Ladder entegrasyonu (en yüksek kazanım)
3. **3.2** — `inferCategoryMulti` ile margin testli kategori tespiti
4. **3.3** — Oturum bütçeli context yeterlilik kontrolü
5. **4.1** — `finalScore` birleşik skorlama fonksiyonunun yazılması
6. **4.2** — `pickWithLoadBalancing` yük paylaştırma ve fallback zinciri kurulumu
7. **4.3** — Loglama mekanizması (hata giderilmiş olarak)
8. **5.1** — Complexity scorer entegrasyonu
9. **5.3** — Cascade routing (sadece quality/reasoning modlarında)
10. **5.4** — Öğrenen sistem (deneysel/uzun vade)

---

## 7. Dosya Değişiklik Haritası

| Dosya | Değişiklik |
|-------|-----------|
| `src/integrations/provider/provider.ts` | Auto resolver -> `selectModel()` çağrısı; meta-router seçimi entegrasyonu |
| `src/integrations/tool/model-router.ts` | **MİMARİ MERKEZ** -> `ModelState`, `selectModel()`, `finalScore()`, `selectCandidates()`, `pickWithLoadBalancing()`, `inferCategoryMulti()` ve `estimateComplexity()` implementasyonları |
| `src/integrations/tool/orchestrate.ts` | Subtask routing'de `selectModel()` kullanarak ücretsiz model garantisi |
| `src/core/config/config.ts` | `auto_mode` config alanı ekle |
| `src/interfaces/cli/cmd/tui/context/local.tsx` | Mevcut mod + seçilen model gösterimi TUI'ye ekle |
| `src/integrations/tool/routing-log.ts` | **YENİ** — Routing kararlarını diskte loglama |
| `src/integrations/tool/meta-router.ts` | **YENİ** — Meta-router koordinasyon mantığı ve selectMetaRouter |

---

## 8. Referanslar

- [LiteLLM Router Docs](https://docs.litellm.ai/docs/routing)
- [OpenRouter Auto-Router](https://openrouter.ai/docs#routing)
- [NeurIPS 2024: Cascade LLM Routing](https://proceedings.neurips.cc)
- [NotDiamond: Dynamic LLM Selection](https://www.notdiamond.ai)
- [models.dev API](https://models.dev/api.json)
- `AtomBase/src/integrations/tool/model-router.ts` — Mevcut scoring sistemi
- `AtomBase/src/integrations/provider/provider.ts:1252` — Mevcut Auto resolver

---

*Bu döküman AtomCLI Auto çalışma mantığının iyileştirilmesine yönelik araştırma ve geliştirme önerileri içermektedir. Tüm kod örnekleri referans niteliğindedir; gerçek implementasyon mevcut mimariyle uyumlu olacak şekilde uyarlanmalıdır.*
