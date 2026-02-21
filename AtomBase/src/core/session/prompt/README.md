# Prompt Directory — AtomCLI

Bu dizin, AI modeline gönderilen sistem prompt'larının tüm bileşenlerini barındırır.

## Yapı

```
prompt/
├── manager.ts          # Birleşik orkestratör — TEK GİRİŞ NOKTASI
├── core/               # Temel promptlar (her zaman dahil)
├── provider/           # Sağlayıcıya özel optimizasyonlar
├── agent/              # Ajan modu davranışları
└── runtime/            # Çalışma zamanı enjeksiyonları
```

## Detaylı Döküman

📄 **[docs/prompts.md](../../../docs/prompts.md)** — Prompt sisteminin kapsamlı dökümantasyonu.
