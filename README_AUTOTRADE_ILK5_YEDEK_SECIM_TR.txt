AUTO TRADE: İLK 5 KORUMASI VE YEDEK OYUNCU SEÇİMİ

ZIP içindeki dosyaları kullandığınız en güncel DreamTeam Task Manager proje
klasörüne, klasör yapısını koruyarak kopyalayın. Bu paket yalnızca bu Auto
Trade düzeltmesini ve ilgili testleri içerir; EXE veya setup içermez.

Her hesap ilk açıldığında Stadium'daki sahada duran beş oyuncunun portresi ve
adı kaydedilir. Bu oyuncular takas adayı yapılmaz. Kadrodaki başka bir oyuncu
sonradan ilk 5'e çıkarsa o da korumaya alınır. Kimlik belirsizliği varsa
oyuncu rastgele seçilmez; işlem güvenli şekilde durdurulur.

Trade ekranında hesabın kendi tarafındaki tam oyuncu listesi okunur. Scout
geçmişinde bulunmayan, elle alınmış yedekler de mevcut rol ve fiyat aktarım
kurallarına göre değerlendirilir. Scout'tan satın alma kuralları değişmedi.
Stadium yalnızca sahadaki beşi gösterse bile Side hesabın Trade ekranı
incelenir. Kadro kapasitesi her iki tarafın canlı Trade listesinden ölçülür;
yüklenmesi geciken oyuncuların görünmesi beklenir.

Oyunda bir taraf bir takasta en fazla beş oyuncu sunabildiği için daha fazla
uygun oyuncu varsa sonraki takas turunda işlenir. Her seçimde Offering sayacı
ve oyuncu kartının seçili hali doğrulanır. İstenmeyen oyuncu seçiliyse onay
verilmez. Takas tamamlandığında oyuncuların hesap değiştirdiği iki tarafın
canlı listesiyle kontrol edilir; bunun için Side kısa süreli bir doğrulama
odası açıp ardından iptal eder.

Değişen dosyalar:
  src/main/services/auto-trade-service.cjs
  tests/auto-trade-bench-selection.test.cjs
  tests/auto-trade-part1.test.cjs
  tests/auto-trade-resume-part7.test.cjs
  tests/trade-offer-part6.test.cjs

Doğrulama: 132 otomatik test geçti. Gerçek oyun hesaplarıyla Trade ekranı
bu ortamda açılamadığı için canlı işlem testi yapılmadı.
