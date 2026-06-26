# Memory System

AtomCLI'nin kalıcı hafıza sistemi. Kullanıcı tercihleri, öğrenme geçmişi ve kişiselleştirilmiş deneyim için tasarlanmıştır.

## ✨ Özellikler

- 🧠 **Kullanıcı Profili**: Adınızı, teknik seviyenizi ve çalışma tarzınızı hatırlar
- ⚙️ **Tercih Öğrenme**: Kod stilinizi, iletişim tercihlerinizi otomatik öğrenir
- 📊 **Session Takibi**: Çalıştığınız projeleri ve ilgi alanlarınızı kaydeder
- 🔄 **Otomatik Entegrasyon**: Her session başlangıcında otomatik olarak yüklenir
- 💬 **Gerçek Zamanlı Öğrenme**: Sohbet sırasında anında öğrenir ve günceller
- 🤖 **Anlam Tabanlı**: LLM kullanarak mesajlardan anlam çıkarır (regex değil!)

## 🚀 Kullanım

### Otomatik Öğrenme (Semantic)

Hafıza sistemi artık **LLM tabanlı anlam çıkarma** kullanıyor:

```
Kullanıcı: Benim adım Akif
[LLM: "hasInformation: true, name: Akif"]
AI: Merhaba Akif! 👋
[Hafıza: "Akif" adı otomatik kaydedildi]

Kullanıcı: Benim adım ne?
[LLM: "hasInformation: false" (soru, bilgi değil)]
AI: Adın Akif!
[Hafıza: Profil'den okundu]

Kullanıcı: Aslında benim adım Mehmet, Akif değil
[LLM: "corrections: [{field: 'name', oldValue: 'Akif', newValue: 'Mehmet'}]"]
AI: Tamam, düzelttim!
[Hafıza: Akif → Mehmet güncellendi]
```

### Avantajları

**Eski Yöntem (Regex):**

```typescript
❌ /(?:benim adım)\s+(\w+)/i
❌ "Benim adım ne?" → "ne" (yanlış!)
❌ Sadece belirli kalıplar
❌ Düzeltmeleri anlayamaz
```

**Yeni Yöntem (LLM):**

```typescript
✅ LLM anlam çıkarma
✅ "Benim adım ne?" → Soru (bilgi yok)
✅ Her türlü ifade
✅ Düzeltmeleri anlıyor
✅ Bağlam farkındalığı
```

### CLI Komutları

```bash
# Hafıza durumunu görüntüle
atomcli memory

# Profilinizi görüntüle
atomcli memory profile

# Öğrenilen tercihleri görüntüle
atomcli memory preferences

# Adınızı ayarlayın
atomcli memory set-name "Ahmet"

# Hafızayı temizle
atomcli memory clear --yes

# Hafızayı dışa aktar
atomcli memory export -o memory-backup.json
```

### Programatik Kullanım

```typescript
import { SessionMemoryIntegration } from "@/core/memory/integration/session"

// Initialize memory system
await SessionMemoryIntegration.initialize()

// Learn from user message
await SessionMemoryIntegration.learnFromMessage("Benim adım Ahmet")

// Get user context for prompts
const context = await SessionMemoryIntegration.getUserContext()

// Learn code style
await SessionMemoryIntegration.learnCodeStyle(code, "typescript")

// Track project work
await SessionMemoryIntegration.trackProject("MyProject")

// Add interest
await SessionMemoryIntegration.addInterest("React")
```

## 📁 Yapı

```
src/core/memory/
├── index.ts                    # Ana export dosyası
├── types.ts                    # Type tanımları
├── core/
│   └── embedding.ts            # Embedding servisleri
├── services/
│   ├── user-profile.ts         # Kullanıcı profili yönetimi
│   ├── preferences.ts          # Tercih öğrenme
│   ├── personality.ts          # AI kişilik ayarları
│   ├── communication.ts        # İletişim tercihleri
│   └── session.ts              # Session yönetimi
├── storage/
│   ├── json.ts                 # JSON dosya depolama
│   ├── vector.ts               # Vector depolama (ChromaDB)
│   └── adapter.ts              # Depolama adaptörü
└── integration/
    └── session.ts              # Session entegrasyonu
```

## 🔧 Entegrasyon

Hafıza sistemi **iki seviyede** çalışır:

### 1. Session Başlangıcı (Pasif)

System prompt'a kullanıcı bağlamı eklenir:

```typescript
// AtomBase/src/session/system.ts
export async function environment(): Promise<string[]> {
  await SessionMemoryIntegration.initialize()
  const userContext = await SessionMemoryIntegration.getUserContext()
  return [envBlock + userContextBlock, skillsMcpBlock]
}
```

### 2. Sohbet Sırasında (Aktif)

Her mesajdan otomatik öğrenir:

```typescript
// AtomBase/src/session/prompt.ts - User message
await SessionMemoryIntegration.learnFromMessage(userText)

// AtomBase/src/session/processor.ts - Assistant response
await SessionMemoryIntegration.learnFromResponse(currentText.text)
```

## 🎯 Öğrenme Akışı

```
┌─────────────────┐
│ Kullanıcı Mesajı│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ learnFromMessage│ ◄── İsim, tercihler öğrenilir
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AI İşleme      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AI Yanıtı       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│learnFromResponse│ ◄── AI'nın öğrendikleri kaydedilir
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Hafıza Güncellendi│
└─────────────────┘
```

## 💾 Veri Depolama

Hafıza verileri şu konumlarda saklanır:

- **User Profile**: `~/.atomcli/personality/user-profile.json`
- **Preferences**: `~/.atomcli/preferences/default/preferences.json`
- **Memories**: `~/.atomcli/memory/memories.json`

## 🧪 Test

```bash
# Hafıza testlerini çalıştır
cd AtomBase
bun test test/core/memory/integration.test.ts

# Tüm hafıza testlerini çalıştır
bun test test/core/memory/
```

## 📝 Öğrenme Mekanizmaları

### 1. İsim Öğrenme

Kullanıcı mesajlarından otomatik olarak isim çıkarır:

```typescript
// Türkçe
"Benim adım Ahmet" → Ahmet
"Adım Ayşe" → Ayşe

// İngilizce
"My name is John" → John
"I'm Alice" → Alice
"Call me Bob" → Bob
```

### 2. Kod Stili Öğrenme

Kod örneklerinden otomatik olarak stil tercihleri çıkarır:

- **Indent**: Space vs Tab, boyut
- **Quotes**: Single vs Double
- **Semicolons**: Var vs Yok
- **Brackets**: Same-line vs New-line

### 3. İletişim Tercihleri

Mesaj uzunluğundan iletişim stilini öğrenir:

- Kısa mesajlar (< 20 karakter) → Brief
- Uzun mesajlar (> 200 karakter) → Detailed

## 🔮 Gelecek Özellikler

- [ ] Vector search ile semantik hafıza
- [ ] Hata öğrenme ve çözüm önerileri
- [ ] Proje-spesifik hafıza
- [ ] Takım hafızası (paylaşımlı)
- [ ] Hafıza analitikleri ve insights

## 🤝 Katkıda Bulunma

Hafıza sistemine katkıda bulunmak için:

1. Yeni öğrenme mekanizmaları ekleyin
2. Test coverage'ı artırın
3. Dokümantasyonu geliştirin
4. Bug raporları ve öneriler gönderin

## 📄 Lisans

AtomCLI projesi ile aynı lisans altındadır.
