DreamTeam Manager v0.2.0 - PATCH22 Auto Trade

Bu paket PATCH21 üzerine uygulanacak değişen/yeni dosyaları içerir.
Silinmesi gereken dosya yoktur. node_modules'a dokunmayın; yeni dependency eklenmedi.

Kopyalanacak dosyalar:
- src/main/main.cjs
- src/main/preload.cjs
- src/main/services/auto-trade-service.cjs   (YENI)
- src/main/services/browser-service.cjs
- src/main/services/store.cjs
- src/renderer/App.jsx
- src/renderer/styles.css

Başlıca eklenenler:
- Ayrı Auto Trade sayfası ve run configuration.
- Main Account otomatik kullanımı, Side account seçimi.
- Visible/Hidden çalışma modu.
- Visible mod F8 Pause/Continue, F9 Stop; klavye aksiyonlarında onay.
- Visible mod her zaman üstte Stop overlay'i.
- Main + aktif Side Chromium pencerelerini yan yana yerleştirme.
- Account conflict preflight ve onay sonrası çakışan işleri durdurma.
- Level >= 10 kontrolü.
- Side hesaplarını başlangıç TK değerine göre büyükten küçüğe sıralama.
- Scout satın alma rolleri + max Price, Call Back yalnız attempt > 0 iken.
- Trade room creation/join/password prompt otomasyonu.
- Offer seçimi, iki taraf agree doğrulaması, Confirm Trade state kontrolü.
- Trade sonrası kısa mesaj/animasyon ne kadar sürerse sürsün Home gelene kadar state-based wait.
- Duplicate kontrolü Home roster snapshot'ları üzerinden.
- Trade affordability Price farkı üzerinden.
- Side TK yetmezse Main->Side oyuncusunu o Side için defer edip sonraki Side'a bırakma.
- Main TK yetmezse run pause/checkpoint; 30 sn sonra browserları kapatıp Resume için bekleme.
- Make seçim -> confirmation modal -> conversion -> animasyon -> bench sonucu doğrulaması.
- Make Back ve Trade sonrası Home doğrulaması.
- Persistent checkpoint/result ledger.
- Canlı/final sonuç tablosu: TK delta, Kazanılan Oyuncu, Karta Dönüştürülen.

Sonuç tablosu kuralları:
- Side Kazanılan Oyuncu = Main'den trade ile gelen + Scout'tan alınıp run sonunda Side'da kalan.
- Main Kazanılan Oyuncu = karta dönüştürülen + Scout'tan alınıp run sonunda Main'de kalan.
- Karta Dönüştürülen yalnız doğrulanmış Make işlemleri ile artar.
- TK delta başlangıç ve son doğrulanmış Funds farkıdır.

Statik doğrulamalar:
- Tüm değişen CJS dosyaları node --check ile doğrulandı.
- App.jsx TypeScript transpile parser ile syntax doğrulandı.
- Result ledger hesaplama testi çalıştırıldı.

Not:
Bu ortamdan dreamteamph.com üzerinde gerçek hesaplarla canlı E2E trade gerçekleştirmek mümkün olmadığı için ilk gerçek koşuyu Visible modda düşük riskli oyuncularla izlemeniz gerekir. Kod, toplanan güncel DOM snapshot'larına göre state-based ve tekrar-safe olacak şekilde hazırlanmıştır.
