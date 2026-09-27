DREAMTEAM MANAGER — MAKE VE YARIDA KALAN ISLEME DEVAM DUZELTMESI

Bu ZIP onceki Auto Trade duzeltme paketindeki ayni klasor yapisinin uzerine cikarilir.
Yalnizca bu gorevde degisen Auto Trade servis kodunu ve ilgili testleri icerir.

DUZELTMELER
- Tek oyuncuda Make 1 Star Card / Star Cards ve Convert 1 to Star Card / Star Cards etiketlerini kabul eder.
- Devam Et: kayitli ana hesap Make, ana hesap Scout, yan hesap Scout veya yan hesap Trade asamasina ve ilgili sayfaya doner.
- Secimden sonra Make dugmesinde durursa mevcut yedekleri yeniden okuyup oyuncuyu yeniden secer.
- Belirsiz Convert tiklamasinda once gecikmeli kadro sonucunu bekler; sadece kadro degismemis ve oyuncular Make yedeginde duruyorsa yeniden dener. Supheli farkta islemi durdurur.
- Yan hesap Trade hatasindan sonra Scout'u gereksiz yere tekrar baslatmaz.
- Dogrulanmis Trade sonrasi adimi kaydeder; dogrulanmis aktarimi yeniden yapmaz.
- Onceki surumde Make ekraninda hata verirken Scout olarak kalan kayitli kontrol noktasini donusturur.

DOGRULAMA
node --test tests/*.test.cjs  ->  93 / 93 test basarili.
Gercek oyun hesabinda canli Trade testi bu paketin parcasinda yapilamadi.
EXE ve kurulum dosyasi, kullanici canli testlerini tamamlayana kadar uretilmedi.
