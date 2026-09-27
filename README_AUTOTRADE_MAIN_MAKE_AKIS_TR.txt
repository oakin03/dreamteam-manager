AUTO TRADE: MAIN MAKE EKRANINDA KALMA DÜZELTMESİ

Bu ZIP içindeki dosyaları mevcut en güncel DreamTeam Task Manager proje
klasörüne, klasör yapısını koruyarak kopyalayın. Paket yalnızca Main
Scout / Make akışının düzeltmesini ve ilgili testleri içerir.

Neler düzeldi:
- Scout'un gördüğü son 1–2 yedek Stadium'da görünmese de Make adaylarına
  eklenir; uygun oyuncular için Make ve Convert adımları izlenir.
- Stadium'da yalnızca sahadaki beş oyuncu görünüyorsa, dönüşüm Scout'un
  gerçek kadro sayısındaki azalmayla doğrulanır.
- Make'de uygun oyuncu kalmamışsa Back ile Stadium'a gerçekten dönülür;
  arka planda görünen Agent simgesi dönüş kanıtı sayılmaz.
- Geçmiş taramalardaki eski oyuncular Make'de sonsuza kadar beklenmez;
  mevcut Scout dalgasının oyuncuları ve bekleyen Trade teslimleri beklenir.

Değişen dosyalar:
  src/main/services/auto-trade-service.cjs
  tests/auto-trade-part1.test.cjs
  tests/auto-trade-main-make-recovery.test.cjs

136 otomatik testin tamamı geçti. Gerçek oyun hesabında canlı Make işlemi
bu ortamdan denenemedi. EXE veya setup üretilmedi.
