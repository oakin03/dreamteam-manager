DAILY REWARD GUNLUK SIFIRLAMA DUZELTMESI

Bu ZIP dosyasindaki klasorleri mevcut en guncel DreamTeam Manager projesinin
uzerine ayni konumlari koruyarak kopyalayin. Kayitli hesap dosyalarini silmeyin.

- Alti odulun tamamlandigi oyundan okunursa ayni gun tekrar tiklanmaz.
- Altinci odulu kullanici elle almissa ve oyun tamamlandigini gostermiyorsa,
  sonuc vermeyen ilk tiklamadan sonra tekrar denenmez.
- Tiklama sonucu okunamazsa yalnizca o hesap Turkiye saatiyle sonraki 19.00
  sifirlamasina kadar bekler. Oyunun yeni gunu gostermesi icin 10 saniye sonra
  kontrol baslar. Diger hesaplar ve Quick Play calismaya devam eder.
- Bekleme 'daily-rewards.json' dosyasina kaydedilir; uygulama kapatilip
  acilsa veya Stadium ekranina tekrar donulse bile korunur.
- Altinci odul henuz alinmamisken gorunen 'CLAIM TIER 6 REWARD!' yazisi
  tamamlanma olarak sayilmaz. Oduller arasindaki farkli sureler oyundaki
  sayactan okunmaya devam eder.
- Auto Play tablosunda bekleme nedeni ve sonraki sifirlamaya kalan sure gorunur.

Degisen dosyalar:
  src/main/services/daily-reward-service.cjs
  src/main/services/store.cjs
  src/renderer/App.jsx
  tests/daily-reward-reset.test.cjs

Dogrulama: 105 otomatik test gecti. Oyun hesabina erisim olmadigindan canli
oyun dogrulamasi yapilmadi. Bu ortamda Vite/React bagimliliklari bulunmadigi
icin npm run build calistirilamadi.
