PAZAR 1/1 SAYFA TARAMA DÜZELTMESİ

Bu ZIP içindeki dosyaları en güncel DreamTeam Manager projesinin üzerine,
klasör yapısını koruyarak kopyalayın. Diğer ZIP'leri yeniden uygulamanız
gerekmez. Bu paket EXE veya kurulum dosyası içermez.

- My Listings sayacı, kartları ve sayfa değiştirme düğmeleri yalnızca Pazar
  listesinin kendi bölümünden okunur. Arkadaki Trading Hall sayacı Pazar
  taramasını etkilemez.
- İlk ve son sayfa aynıysa (1/1), 1 ila 8 oyuncu kabul edilir. Önce sayfa
  sayısı doğrulanır; 1/1 sayfasında gezinme düğmeleri gösterilmese bile
  sayaç okunur. Sayfadaki Listed/Sold/Expired adetleri görünürse kartların
  tamamı yüklenene kadar beklenir.
- Birden fazla sayfa varsa son sayfa dışındaki her sayfada sekiz kart
  yüklenmesi beklenir.

Değişen dosyalar:
  src/main/services/market-service.cjs
  tests/market-service.test.cjs

Doğrulama: 118 otomatik test geçti. Canlı oyun hesabında test yapılamadı.
