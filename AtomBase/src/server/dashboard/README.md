# AtomCLI Dashboard

Modern, modüler ve responsive web dashboard for AtomCLI.

## Yapılan İyileştirmeler

### 1. Modüler Yapı
- X CSS ve JavaScript dosyaları ayrıldı
- X Her bileşen kendi dosyasında
- X Kolay bakım ve güncelleme

### 2. Responsive Tasarım
- X PC'de ferah ve geniş arayüz
- X Tablet için optimize edilmiş görünüm
- X Mobil cihazlar için dokunmatik dostu
- X Tüm ekran boyutlarında mükemmel görünüm

### 3. Model Filtreleme Sistemi
- X Model arama özelliği
- X Ücretsiz modeller filtresi
- X Bağlı sağlayıcılar filtresi
- X Dinamik filtreleme

### 4. Gelişmiş Özellikler
- X Server-Sent Events ile gerçek zamanlı güncellemeler
- X Toast bildirimleri
- X Modal pencereler
- X Oturum yönetimi
- X Dosya tarayıcı

## Yapı

```
dashboard/
├── index.html              # Ana HTML dosyası
├── css/                    # CSS dosyaları
│   ├── main.css           # Temel stiller ve değişkenler
│   ├── sidebar.css        # Sidebar stilleri
│   ├── topbar.css         # Üst menü stilleri
│   ├── content.css        # İçerik alanı stilleri
│   ├── chat.css           # Chat arayüzü stilleri
│   └── responsive.css     # Responsive tasarım stilleri
├── js/                    # JavaScript modülleri
│   ├── utilities.js       # Yardımcı fonksiyonlar
│   ├── navigation.js      # Navigasyon yönetimi
│   ├── chat.js           # Chat işlevselliği
│   ├── pageLoaders.js    # Sayfa yükleyicileri
│   ├── sse.js            # Server-Sent Events
│   ├── modal.js          # Modal yönetimi
│   └── main.js           # Ana başlatıcı
└── README.md             # Bu dosya
```

## Tasarım İyileştirmeleri

### PC (Desktop)
- Daha geniş padding ve spacing
- Büyük fontlar ve ikonlar
- Ferah kart düzeni
- Geniş chat mesajları

### Tablet
- Orta boy padding
- Kompakt sidebar
- Optimize edilmiş düzen

### Mobil
- Genişletilebilir sidebar
- Dikey düzen
- Dokunmatik dostu butonlar
- Tam genişlik elementler

## Kullanım

Dashboard `/dashboard` endpoint'inde çalışır.

### Model Filtreleme
1. **Arama**: Model adına göre filtreleme
2. **Free Only**: Sadece ücretsiz modelleri göster
3. **Connected**: Sadece bağlı sağlayıcıları göster
4. **Clear**: Tüm filtreleri kaldır

## Teknik Detaylar

### API Endpoints
- `/dashboard` - Ana sayfa
- `/dashboard/css/:filename` - CSS dosyaları
- `/dashboard/js/:filename` - JavaScript dosyaları
- `/dashboard/assets/*` - Statik dosyalar

### Responsive Breakpoints
- **Mobil**: < 768px
- **Tablet**: 768px - 1024px
- **Desktop**: > 1024px

## Notlar

- Sunucu yeniden başlatıldığında değişiklikler yüklenir
- CSS ve JS dosyaları cache edilir (1 saat)
- Tüm dosyalar modüler yapıda
