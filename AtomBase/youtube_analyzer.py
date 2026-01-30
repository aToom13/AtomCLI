#!/usr/bin/env python3
"""
YouTube Video Analyzer
Analiz edilecek video: https://www.youtube.com/watch?v=h7nSFacubgA
"""

import json
from urllib.parse import urlparse, parse_qs
import requests
from datetime import datetime

VIDEO_ID = "h7nSFacubgA"

def get_video_id_from_url(url):
    """URL'den video ID'sini çıkar"""
    parsed = urlparse(url)
    return parse_qs(parsed.query).get('v', [None])[0]

def get_youtube_meta(video_id):
    """YouTube API olmadan temel meta bilgileri çek"""
    # No-embed API
    noembed_url = f"https://noembed.com/embed?url=https://www.youtube.com/watch?v={video_id}"
    response = requests.get(noembed_url)
    if response.status_code == 200:
        data = response.json()
        return {
            "title": data.get("title"),
            "author": data.get("author_name"),
            "thumbnail": data.get("thumbnail_url"),
            "author_url": data.get("author_url")
        }
    return None

def analyze_title(title):
    """Video başlığını analiz et"""
    if not title:
        return {}

    analysis = {
        "length": len(title),
        "word_count": len(title.split()),
        "has_question": "?" in title or "mi" in title.lower() or "mu" in title.lower(),
        "keywords": [],
        "emotional_tone": []
    }

    # Anahtar kelime analizi
    tech_keywords = ["ghosting", "görümce", "arkadaş", "anısı", "garip"]
    for keyword in tech_keywords:
        if keyword.lower() in title.lower():
            analysis["keywords"].append(keyword)

    # Duygusal ton analizi
    if any(word in title.lower() for word in ["garip", "sorun", "problem", "anlat", "hikaye"]):
        analysis["emotional_tone"].append("kişisel_hikaye")
    if "?" in title or "mi" in title.lower():
        analysis["emotional_tone"].append("soru_sorucu")
    if any(word in title.lower() for word in ["arkadaş", "görümce", "güven"]):
        analysis["emotional_tone"].append("ilişki_odaklı")

    return analysis

def detect_content_type(title, description):
    """İçerik türünü tahmin et"""
    if not title:
        return "bilinmiyor"

    title_lower = title.lower()

    if any(word in title_lower for word in ["oyun", "game", "minecraft", "lol", "valorant"]):
        return "oyun_icerigi"
    elif any(word in title_lower for word in ["vlog", "günlük", "hikaye", "anlat"]):
        return "vlog_kisisel"
    elif any(word in title_lower for word in ["ghosting", "red", "tanışma", "ilişki"]):
        return "ilişki_danışmanlığı"
    elif any(word in title_lower for word in ["bilal", "jester", "komik", "espiri"]):
        return "komedi_eglence"
    else:
        return "genel_konuşma"

def generate_report(video_id):
    """Tam analiz raporu oluştur"""
    print(f"🔍 YouTube Video Analizi")
    print(f"📺 Video ID: {video_id}")
    print(f"🔗 URL: https://www.youtube.com/watch?v={video_id}")
    print("=" * 60)

    # Meta bilgileri çek
    meta = get_youtube_meta(video_id)

    if meta:
        print("\n📋 TEMEL BİLGİLER:")
        print(f"   Başlık: {meta['title']}")
        print(f"   Kanal: {meta['author']}")
        print(f"   Thumbnail: {meta['thumbnail']}")

        # Başlık analizi
        title_analysis = analyze_title(meta['title'])

        print(f"\n📊 BAŞLIK ANALİZİ:")
        print(f"   Uzunluk: {title_analysis['length']} karakter")
        print(f"   Kelime sayısı: {title_analysis['word_count']}")
        print(f"   Soru içeriyor mu: {'Evet' if title_analysis['has_question'] else 'Hayır'}")
        print(f"   Anahtar kelimeler: {', '.join(title_analysis['keywords']) or 'Bulunamadı'}")
        print(f"   Duygusal ton: {', '.join(title_analysis['emotional_tone']) or 'Nötr'}")

        # İçerik türü tahmini
        content_type = detect_content_type(meta['title'], meta.get('author', ''))
        print(f"\n🎯 İÇERİK TÜRÜ TAHMİNİ: {content_type}")

        # SEO Analizi
        print(f"\n🔍 SEO ANALİZİ:")
        seo_score = 0
        if title_analysis['word_count'] >= 3:
            seo_score += 25
            print(f"   ✓ Başlık uzunluğu uygun (+25)")
        else:
            print(f"   ✗ Başlık çok kısa (0)")

        if title_analysis['has_question']:
            seo_score += 20
            print(f"   ✓ Soru formatı tıklama artırır (+20)")
        else:
            print(f"   - Soru formatı yok (0)")

        if len(title_analysis['keywords']) > 0:
            seo_score += 30
            print(f"   ✓ Anahtar kelime içeren başlık (+30)")
        else:
            print(f"   ✗ Belirgin anahtar kelime yok (0)")

        if "garip" in meta['title'].lower() or "hikaye" in meta['title'].lower():
            seo_score += 25
            print(f"   ✓ Merak uyandıran kelimeler (+25)")
        else:
            print(f"   - Merak uyandıran kelimeler zayıf (0)")

        print(f"\n   📈 TOPLAM SEO SKORU: {seo_score}/100")

        # Kategori tahmini
        print(f"\n📁 KATEGORİ TAHMİNİ:")
        categories = {
            "Vlog & Kişisel": 0.6,
            "Yaşam & İlişkiler": 0.9,
            "Komedi": 0.3,
            "Konuşma & Sohbet": 0.5
        }
        for cat, score in sorted(categories.items(), key=lambda x: x[1], reverse=True):
            bar = "█" * int(score * 10)
            print(f"   {cat}: {bar} {int(score * 100)}%")

    else:
        print("❌ Video bilgileri alınamadı")

    print("\n" + "=" * 60)
    print("⏰ Rapor tarihi:", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    return meta

if __name__ == "__main__":
    report = generate_report(VIDEO_ID)

    # JSON formatında da kaydet
    if report:
        output = {
            "video_id": VIDEO_ID,
            "url": f"https://www.youtube.com/watch?v={VIDEO_ID}",
            "analysis": {
                "title": report['title'],
                "channel": report['author'],
                "thumbnail": report['thumbnail'],
                "detected_type": detect_content_type(report['title'], report['author']),
                "title_analysis": analyze_title(report['title'])
            },
            "analyzed_at": datetime.now().isoformat()
        }

        with open(f"{VIDEO_ID}_analysis.json", "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f"\n✅ JSON raporu kaydedildi: {VIDEO_ID}_analysis.json")
