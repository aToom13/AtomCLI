# AtomCLI Geliştirme Adımları

> Proje incelemesi sonucunda belirlenen iyileştirme ve yeni özellik önerileri.
> Her madde öncelik sırasına göre sıralanmıştır (🔴 Kritik, 🟡 Orta, 🟢 Düşük).

---

## 1. 🔴 Arayüz (TUI) İyileştirmeleri

ÖNEMLİ: Aşşağı ve yukarı kaydırma özelliği yok arayüzde. Bunun için bir kılavye kısa yolu olur, Bir arayüz buton olur vs bir şey bulmamız lazım. Yukarı, Aşşağı ve Canlı takip gibi bir seçenek olmalı.  
### 1.1 Mesaj Alanı Geliştirmeleri
- **Syntax Highlighting**: `code-panel.tsx` var ama mesaj içindeki kod bloklarında syntax renklendirmesi eksik. Inline code bloklarına dil bazlı renklendirme eklenebilir.
- **Markdown Render Kalitesi**: Mesajlardaki tablo, liste ve heading renderı iyileştirilebilir — şu an düz metin gibi görünüyor olabilir.
- **Dosya Linkleri**: Mesajlarda bahsi geçen dosya yollarının tıklanabilir olması — tıklayınca `read` tool çıktısı ile gösterilmesi.
- **Resim/Görsel Önizleme**: Agent'in oluşturduğu görsellerin TUI içinde ASCII sanat veya sixel protocol ile gösterilmesi.

### 1.2 Sidebar Geliştirmeleri
- **Dosya Ağacı Filtreleme**: `file-tree.tsx` var ama arama/filtreleme özelliği yok. Fuzzy search eklenebilir.
- **Son Değiştirilen Dosyalar**: Sidebar'da son deişiklik yapılan dosyalar farklı renkte görünebilir
- 
### 1.3 Yeni TUI Bileşenleri
- **Diff Görüntüleyici**: Agent dosya düzenlediğinde, değişikliklerin diff formatında gösterilmesi (yeşil/kırmızı satırlar).
- **İlerleme Çubuğu**: Uzun işlemler (web fetch, dosya okuma, program kurma, derleme yapma) için inline ilerleme çubuğu.
- **Bildirim Sistemi**: Arka planda tamamlanan işlemler için toast-benzeri bildirimler.
- **Split View**: Bir tarafta sohbet, diğer tarafta dosya görüntüleme — tmux tarzı bölünmüş ekran. (Sağ tarafta düzenlenen dosyalar vs gözükebilir. Zaten sağ tarafta bir dosya içeriği gösteren panel özelliği var hem o da geliştirilsin. enter tuşu vs çalışmıyor du onda)

### 1.4 Session Yönetimi
- **Session Arama**: Session listesinde arama/filtreleme. `dialog-session-list.tsx` var ama arama yok.
- **Session Tagging**: Session'lara etiket ekleme ("bug-fix", "feature", "research") — `dialog-tag.tsx` zaten var ama genişletilebilir.
- **Session Pinleme**: Önemli session'ları üste sabitleme.
- **Session Export Formatları**: Markdown, HTML, PDF olarak export — `export.ts` var ama sadece JSON.

---

## 2. 🔴 Model Verimliliği ve Yanıt Kalitesi

### 2.1 Akıllı Context Yönetimi
- **Dinamik Context Window**: `compaction.ts` var ama agresif pruning yapıyor. Daha akıllı token bütçesi yönetimi — önemli bilgileri koruyarak gereksiz kısımları kaldırma.
- **Otomatik Özetleme Tetikleyici**: Context %70'e ulaştığında otomatik özetleme başlatma. Şu an `isOverflow` fonksiyonu context dolduğunda devreye giriyor ama bu çok geç. (Bu otomatik özetleme arka planda çalışmalı. Bu sayede çalışmadan çıkılıp kullanıcı etkilenmeden özetleme yapılmalı. Kullanıcı sohbete devam edebilmeli aralıksız bir şekilde)
- **Tool Çıktısı Sıkıştırma**: Büyük dosya okumaları (`read` tool) ve `bash` çıktılarının otomatik olarak özetlenmesi — tüm token'ı yemeden.

### 2.2 Prompt Mühendisliği
- **Thinking/Reasoning Talimatları**: Modelin "düşünme" sürecini yönlendiren talimatlar. Özellikle hata ayıklama senaryolarında "önce oku, sonra analiz et, sonra düzelt" akışı.
- **Few-Shot Örnekler**: `agent.txt`'de bir örnek var (Flappy Bird). Farklı senaryolar için daha fazla örnek: bug fix, refactoring, research, web app.
- **Dil Adaptasyonu**: Agent prompt'u İngilizce ve Türkçe karışık. Kullanıcının diline göre otomatik prompt adaptasyonu.

### 2.3 Akıllı Model Seçimi
- **Görev Bazlı Model Önerisi**: Basit sorular için küçük/ucuz model, karmaşık kod yazma için güçlü model. "Bu görev için X modeli daha uygun" önerisi ve otomatik(Kullanıcıya sormadan modeller arası otomatik geçiş ayarı(Kullanıcının seççtiği modeller arasında otomatik geçiş)).
- **Otomatik Fallback İyileştirmesi**: `fallback.ts` var ama `getRecommendedFallbacks` fonksiyonu hardcoded model isimleri kullanıyor. Gerçek zamanlı model performans verisine dayalı fallback zinciri.
- **Maliyet Tahmini Göstergesi**: Her mesajdan önce tahmini maliyet gösterimi — "$0.02 ~ tahmini" gibi.
- **Token Kullanım Dashboard'u**: Session bazlı token kullanımını görselleştiren bir panel (`stats.ts` var ama TUI'da değil).

### 2.4 Caching ve Performans
- **Semantic Cache**: Benzer sorulara benzer cevaplar vermek için embedding tabanlı önbellek. `memory` modülünde embedding altyapısı zaten var.
- **Tool Çıktısı Cache**: Aynı dosyayı birden fazla okumaktan kaçınmak için tool çıktılarını cache'leme.
- **Streaming Optimizasyonu**: İlk token süresini (TTFT) optimize etme — kullanıcıya daha hızlı yanıt başlangıcı.
- **Paralel Tool Çalıştırma**: Bağımsız tool çağrıları için paralel çalıştırma.

### 2.5 Öğrenme ve Hafıza
- **Hata Günlüğü**: `error-analyzer.ts` var ama kullanıcıya görünmüyor. "Bu hatayı daha önce 3 kez gördük, çözüm şu" gibi proaktif öneriler.
- **Proje Bilgisi Otomatik Güncelleme**: `brain.ts` tool'u var ama proje knowledge base'ini otomatik olarak güncelleyen arka plan görevi yok.
- **Kullanıcı Tercihleri Öğrenme**: `memory/services/user-profile.ts` ve `personality.ts` var ama aktif olarak kullanılmıyor gibi görünüyor. Kullanıcının coding stilini, tercih ettiği dili, sık kullandığı kütüphaneleri öğrenme.


---

## 3. 🟡 Yeni Özellikler

### 3.1 Proje Yönetimi
- **Git Entegrasyonu**: `github/` dizini var ama TUI içinden commit, push, branch oluşturma. Agent'in yaptığı değişiklikleri otomatik commit'leme seçeneği.
- **Todo Yönetimi**: `todo.ts` tool'u var ama proje genelinde todo takibi. Dosyalardaki `TODO:` ve `FIXME:` yorumlarını toplayan bir dashboard.
- **Worktree Desteği**: `worktree/` modülü var ama daha iyi çoklu branch desteği.

### 3.2 İşbirliği ve Paylaşım
- **Session Paylaşma**: Session'ı link ile paylaşma (read-only). `share/` modülü var ama genişletilebilir.
- **Takım Bilgi Tabanı**: Paylaşılan brain/knowledge base — takımdaki herkes aynı proje bilgisine erişebilir.
- **Prompt Kütüphanesi**: Sık kullanılan prompt'ları kaydetme ve tekrar kullanma. "Favoriler" konsepti.

### 3.3 Güvenlik ve Doğrulama
- **Sandbox Modu**: Tehlikeli komutları gerçek dosya sisteminden izole edilmiş bir ortamda çalıştırma.
- **Değişiklik Onay Ekranı**: Agent dosya değiştirmeden önce diff preview gösterme — `permission.tsx` var ama daha detaylı olabilir.
- **Rollback Sistemi**: `revert.ts` var ama "son 5 değişikliği geri al" gibi toplu rollback. Git stash benzeri snapshot sistemi.

---

## 4. 🟡 Mevcut Özelliklerin İyileştirilmesi

### 4.1 Skill Sistemi
- **Skill Marketplace**: Topluluk tarafından yapılmış skill'leri indirme/yükleme. `skilladd.ts` var ama sadece dosya bazlı.
- **Skill Versiyonlama**: Skill güncellemelerini yönetme.
- **Skill Test Framework**: Skill'lerin otomatik test edilmesi.

### 4.2 MCP (Model Context Protocol)
- **MCP Discovery**: Mevcut MCP sunucularını otomatik keşfetme ve önerme.
- **MCP Health Check**: Bağlı MCP'lerin durumunu kontrol etme (çalışıyor mu, yanıt süresi).
- **Popüler MCP Paketleri**: Tek tıkla GitHub, Jira, Slack MCP'lerini ekleme.

### 4.3 Flow Sistemi
- **Görsel Flow Editörü**: `flow/runner.ts` var ama flow'ları TUI içinden görsel olarak oluşturma/düzenleme.
- **Flow Template'leri**: "Yeni proje başlat", "Bug düzelt", "Feature ekle" gibi hazır flow şablonları.
- **Flow Paylaşımı**: Flow tanımlarını `.atomcli/flow/` altında paylaşma.

---

## 5. 🟢 UX İncelikleri

### 5.1 Onboarding
- **İlk Kullanım Sihirbazı**: Yeni kullanıcılar için adım adım kurulum. Provider seçimi, API key girişi, tema seçimi.
- **Interactive Tutorial**: TUI içinde "AtomCLI'ı tanıyalım" interaktif eğitim modu.
- **Tooltip/İpuçları**: `tips.ts` var ama sadece i18n'den çekiyor. Bağlamsal ipuçları — kullanıcının yaptığı şeye göre yardım gösterme.

### 5.2 Kişiselleştirme
- **Tema Editörü**: 33 tema var ama kullanıcının kendi temasını TUI içinden oluşturabilmesi.
- **Keybind Özelleştirme**: `keybind.tsx` var ama config dosyası üzerinden keybind değiştirme desteği.
- **Layout Profilleri**: "Coding", "Review", "Debug" gibi farklı ekran düzenleri kaydetme.

### 5.3 Erişilebilirlik
- **Ekran Okuyucu Desteği**: TUI'da ARIA benzeri yapılar — görme engelli kullanıcılar için.
- **Daha Fazla Dil Desteği**: Şu an EN/TR var. DE, FR, ES, JP, ZH eklenebilir.
- **Yazı Boyutu Ayarı**: TUI içinden yazı boyutunu değiştirme.

---

## 6. 🟢 Teknik Borç ve Mimari

### 6.1 Test ve Kalite
- **E2E Test Suite**: `test-gen.ts` var ama projenin kendisi için E2E testler eksik.
- **Performance Benchmarks**: `perf.ts` komutu var — düzenli performans testleri.
- **Memory Leak Detection**: Uzun session'larda bellek sızıntısı kontrolü.

### 6.2 Kod Organizasyonu
- **Config Bölünmesi**: `config.ts` 53KB — çok büyük. Provider config, TUI config, agent config olarak bölünebilir.
- **Prompt Yönetimi**: Agent prompt'ları `.txt` dosyalarında. Jinja2/Handlebars benzeri template engine ile dinamik prompt oluşturma.
- **Modül Sınırları**: Bazı modüller (session, provider) çok büyük. Daha küçük, bağımsız parçalara ayrılabilir.

---

## Öncelik Sıralaması

| #   | Özellik                  | Etki     | Zorluk |
| --- | ------------------------ | -------- | ------ |
| 1   | Diff Görüntüleyici       | 🔴 Yüksek | Orta   |
| 2   | Model-Spesifik Promptlar | 🔴 Yüksek | Düşük  |
| 3   | Akıllı Context Yönetimi  | 🔴 Yüksek | Yüksek |
| 4   | Git TUI Entegrasyonu     | 🟡 Orta   | Orta   |
| 5   | Token Dashboard          | 🟡 Orta   | Düşük  |
| 6   | Semantic Cache           | 🟡 Orta   | Yüksek |
| 7   | Maliyet Tahmini          | 🟡 Orta   | Düşük  |
| 8   | Hata Öğrenme Sistemi     | 🟡 Orta   | Orta   |
| 9   | Session Export (MD/HTML) | 🟢 Düşük  | Düşük  |
| 10  | Tema Editörü             | 🟢 Düşük  | Orta   |

---

*Son güncelleme: 2026-02-11*
