# PATCH 11 — Trading Hall Speed Fix

Bu patch PATCH 10 üzerine uygulanır. Eski dosya silmek gerekmez.

Değişiklikler:
- Trading Hall artık her sayfada büyüyen `trading-hall.json` dosyasını baştan yazmaz.
- Tarama sonuçları RAM'de toplanır; tamamlanma/durdurma/hata anında diske tek sefer yazılır.
- Her sayfa geçişinde tüm sonuç listesinin renderer'a tekrar tekrar gönderilmesi kaldırıldı.
- UI ilerleme güncellemesi 250 ms ile sınırlandı; sayfa sayacı yine canlı kalır.
- Sayfa bekleme kodu `body.innerText + kart parse` döngüsü yerine tek hafif DOM state okuması kullanır.
- Kartlar yalnızca sayfa gerçekten yüklendikten sonra bir kez parse edilir.
- Refresh, varsa Trading Hall sayfalamasını önce 1. sayfaya döndürür.
- Durdur/hata durumunda o ana kadar taranan sonuçlar korunur ve browser kapanır.
