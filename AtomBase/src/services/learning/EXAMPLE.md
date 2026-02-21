# Self-Learning Sistemi - Örnek Kullanım Senaryosu

## Senaryo: React WebSocket Hook Oluşturma

### Adım 1: Görevi Al
```
Kullanıcı: "React'te WebSocket kullanan bir hook yaz"
```

### Adım 2: Bilgiyi Kontrol Et (Hafızada Ara)
```typescript
// Agent otomatik olarak:
LearnTool({
  action: "find_knowledge",
  query: "React WebSocket hook",
  context: "React"
})

// Sonuç: Bulunamadı (ilk kez yapılıyor)
```

### Adım 3: Araştırma Yap
```typescript
LearnTool({
  action: "research",
  query: "React WebSocket hook implementation best practices 2024",
  topic: "React WebSocket"
})

// Sonuç:
// - WebSocket'in SSR'da çalışmadığı
// - useEffect içinde kullanılması gerektiği
// - Cleanup (ws.close()) yapılması gerektiği öğrenildi
```

### Adım 4: Kod Yaz
```typescript
// useWebSocket.ts
import { useEffect, useRef, useState } from 'react'

export function useWebSocket(url: string) {
  const [message, setMessage] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const ws = new WebSocket(url)  // ← HATA! SSR'da çalışmaz
    wsRef.current = ws
    
    ws.onmessage = (e) => setMessage(e.data)
    
    return () => ws.close()
  }, [url])

  return { message }
}
```

### Adım 5: Hata Al
```
Error: WebSocket is not defined
    at useWebSocket (useWebSocket.ts:8)
```

### Adım 6: Hatayı Analiz Et ve Öğren
```typescript
// Agent hatayı çözüyor:
// "SSR'da WebSocket client-side API olduğu için tanımlı değil"

// Düzeltilmiş kod:
useEffect(() => {
  if (typeof window === 'undefined') return  // ← ÇÖZÜM
  
  const ws = new WebSocket(url)
  wsRef.current = ws
  ws.onmessage = (e) => setMessage(e.data)
  
  return () => ws.close()
}, [url])

// Öğrenmeyi kaydet:
LearnTool({
  action: "record_error",
  title: "WebSocket SSR Error - window is not defined",
  context: "React",
  errorType: "ReferenceError",
  errorMessage: "WebSocket is not defined",
  solution: "Add typeof window check before using WebSocket in useEffect",
  codeBefore: "const ws = new WebSocket(url)",
  codeAfter: "if (typeof window === 'undefined') return\nconst ws = new WebSocket(url)",
  tags: ["websocket", "ssr", "react", "useeffect"]
})
```

### Adım 7: Pattern'i Kaydet
```typescript
LearnTool({
  action: "record_pattern",
  title: "SSR-Safe WebSocket Hook Pattern",
  context: "React",
  description: "Proper way to use WebSocket in React with SSR compatibility",
  solution: "Use useEffect + window check + cleanup function",
  codeAfter: `
export function useWebSocket(url: string) {
  const [message, setMessage] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const ws = new WebSocket(url)
    wsRef.current = ws
    ws.onmessage = (e) => setMessage(e.data)
    
    return () => ws.close()
  }, [url])

  return { message }
}
  `,
  tags: ["websocket", "hook", "ssr-safe", "pattern"]
})
```

### Adım 8: Kullanıcıya Raporla
```
"React WebSocket hook'u oluşturdum. 

Öğrendiklerim:
- SSR'da WebSocket kullanmak için window check gerekli
- Cleanup fonksiyonu ile bağlantıyı kapatmak önemli
- Bu pattern'i gelecekteki React projelerinde kullanacağım"
```

---

## Gelecekte Aynı Görev

### 1 Ay Sonra - Yeni Proje
```
Kullanıcı: "React'te WebSocket kullanan bir hook yaz"
```

### Agent'ın Davranışı
```typescript
// 1. Hafızada ara
LearnTool({
  action: "find_knowledge",
  query: "React WebSocket hook",
  context: "React"
})

// Sonuç: BULUNDU!
// {
//   title: "SSR-Safe WebSocket Hook Pattern",
//   solution: "Use useEffect + window check + cleanup function",
//   codeAfter: "...",
//   tags: ["websocket", "hook", "ssr-safe", "pattern"]
// }

// 2. Direkt uygula (araştırma yapmaya gerek yok!)
// 3. Kodu yaz
// 4. Hata alma (çünkü öğrenilmiş pattern kullanıldı)
// 5. Hemen teslim et
```

---

## Öğrenme İstatistikleri

```typescript
// Agent kendi istatistiklerini görebilir:
LearnTool({ action: "get_stats" })

// Sonuç:
{
  totalLearned: 47,
  totalErrors: 23,
  totalResearches: 15,
  topTechnologies: ["React", "Node.js", "TypeScript", "Python"],
  successRate: "87.2%"
}
```

---

## Faydalar

| Özellik | Fayda |
|---------|-------|
| **Hafıza** | Aynı hatayı 2. kez yapmaz |
| **Hız** | Tekrar eden görevlerde daha hızlı |
| **Kalite** | Her deneyimle daha iyi kod yazar |
| **Bağımsızlık** | Daha az kullanıcı müdahalesi gerekir |
| **Kişiselleştirme** | Kullanıcının projelerine adapte olur |

---

## Dosya Yapısı

```
~/.atomcli/learning/
├── memory.json       # Genel bilgiler (47 items)
├── errors.json       # Hata çözümleri (23 items)  
└── research.json     # Araştırma sonuçları (15 items)
```

Her öğrenme kalıcıdır ve tüm session'larda kullanılabilir!
