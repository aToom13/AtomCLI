# AtomBase ⚛️

**AtomBase**, modüler ve genişletilebilir bir yapay zeka ajan (AI Agent) iskeletidir. CLI (Komut Satırı Arayüzü) tabanlı bu yapı, güçlü bir ajan sisteminin temellerini oluşturmak için tasarlanmıştır.

## 🎯 Özellikler

*   **Modüler Provider Sistemi:** Google (Gemini), OpenAI, Ollama, Anthropic vb. servisler arasında kolayca geçiş yapılabilir.
*   **Akıllı Hafıza:** Konuşma geçmişini ve kritik bilgileri yönetebilen sade bir hafıza yapısı.
*   **Temel Araçlar:** Dosya işlemleri, terminal komutları ve sistem bilgisi araçları entegre edilmiştir.
*   **Temiz Kod Yapısı:** Geliştiricilerin ve yapay zekanın rahatça okuyup geliştirebileceği bir yapı sunar.

## 📂 Proje Yapısı

```
AtomBase/
├── config.py           # Tekil yapılandırma dosyası
├── main.py             # CLI giriş noktası
├── requirements.txt    # Bağımlılıklar
├── .env                # API anahtarları (siz oluşturmalısınız)
├── .atom_settings.json # Model tercihleri
├── .atom_fallback.json # Yedek model ayarları
├── core/
│   ├── agent.py        # Ana ajan mantığı (LangGraph)
│   └── providers/      # LLM sağlayıcı modülleri
├── tools/              # Agent araçları (File, Terminal, Memory)
│   ├── basic.py
│   ├── execution.py
│   ├── files.py
│   └── memory.py
└── utils/              # Yardımcı araçlar (Logger)
```

## 🚀 Kurulum ve Çalıştırma

1.  **Gereksinimleri Yükleyin:**
    ```bash
    pip install -r requirements.txt
    ```

2.  **API Anahtarlarını Ayarlayın:**
    `.env` dosyası oluşturun ve gerekli anahtarları girin:
    ```env
    GOOGLE_API_KEY=...
    OPENAI_API_KEY=...
    # Kullandığınız servise göre diğerleri...
    ```

3.  **Başlatın:**
    ```bash
    python main.py
    ```

## ⚙️ Yapılandırma

Hangi modeli kullanacağınızı `.atom_settings.json` dosyasından değiştirebilirsiniz:

```json
{
  "models": {
    "supervisor": {
      "provider": "google",
      "model": "gemini-3-flash-preview",
      "temperature": 0.1
    }
  }
}
```
