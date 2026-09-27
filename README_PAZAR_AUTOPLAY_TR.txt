PAZAR VE AUTO PLAY TOPLU DÜĞMELERİ

Bu ZIP içindeki dosyaları mevcut en güncel DreamTeam Manager projesine aynı
klasör yapısıyla kopyalayın. Kayıtlı hesapları, node_modules klasörünü ve
önceki görev dosyalarını silmeyin. EXE veya kurulum dosyası bu pakette yoktur.

Auto Play:
- Seçilileri Başlat/Durdur düğmeleri korunur.
- Ayrıca Tümünü Başlat ve Tümünü Durdur düğmeleri eklenir.

Sol menüde yeni Pazar sayfası:
- Hesap bazında Tara, Tekrar Tara, Kapat, Seçilileri Aç/Kapat ve
  Tümünü Aç/Kapat kontrolleri vardır.
- My Listings içindeki bütün sayfalar taranır. Son sayfa dışında sekiz kart
  yüklenmeden ve önceki sayfanın kartları değişmeden tarama sürmez.
- SOLD, LISTED, EXPIRED ayrı tablolarda hesap, oyuncu, salary ve ilan fiyatıyla
  gösterilir. Bilet fiyatları APK yerine TIX olarak işaretlenir.
- SOLD ilanı bulunmayan hesabın Pazar oturumu otomatik kapatılır.
- Satışları Topla yalnızca SOLD ilanı bulunan hesaplarda görünür. Oyunda
  Claim → Confirm Claim → CLAIM SUCCESSFUL → Continue adımları doğrulanır.
- Sayfa 1 dışındaki CLAIM işlemlerinden sonra oyun yanlış sayfa kartlarını
  gösterdiğinde bir sayfa geri ve ileri gidilip tarama yenilenir.
- Bütün satışlar toplandıktan sonra Back ile City'ye, Stadium simgesiyle
  anasayfaya dönülür; gerçek Auto PK/APK değeri (0 dahil) okunup kaydedilir.
  Ancak bundan sonra Pazar oturumu kapatılır.
- APK geç yüklenip doğrulanamazsa tarayıcı açık kalır. Tekrar Tara, kalan
  SOLD ilanı olmasa bile APK doğrulamasını yeniden dener. Bu doğrulama bitene
  kadar hesabın Kapat düğmesi devre dışı kalır.
- Sonuç doğrulanmazsa yeniden Claim tıklaması yapılmaz; hesap hata durumunda
  kalır, tekrar tarandığında oyundaki mevcut ilanlar baştan okunur.

Pazardaki tablolar uygulama oturumunda tutulur; uygulama yeniden açıldığında
yeniden taramak gerekir. Diğer hesapların verilerine ve Trading Hall taramasına
bu işlem dokunmaz.

Değişen dosyalar:
  src/main/services/market-service.cjs
  src/main/main.cjs
  src/main/preload.cjs
  src/renderer/App.jsx
  src/renderer/styles.css
  tests/market-service.test.cjs

Doğrulama: Ekli sayfa kodlarında 2/5 sayfasındaki 7 LISTED + 1 SOLD ve
5/5 sayfasındaki 6 EXPIRED doğrulandı. Otomatik testler çalıştırıldı.
Canlı oyun hesabında test yapılamadı. Bu çalışma ortamında Vite/React kurulu
olmadığı için arayüz derlemesi çalıştırılamadı.
