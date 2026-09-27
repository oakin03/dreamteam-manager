DREAMTEAM MANAGER — TRADING HALL TABLO DUZELTMESI

Bu ZIP, onceki DreamTeam Manager kaynaklarinin ayni klasor yapisinin uzerine cikarilir.
Yalnizca Trading Hall tablosuyla ilgili degisen dosyalari icerir.

DEGISIKLIKLER
- B- ile A+ gibi rating araliklari filtrelenmeden siralama uygulanmaz; S ve D- bu araliga sizmaz.
- Maas ve fiyat filtreleri bicimlendirilmis sayilari (ornegin 1,200 TK) dogru okur; degeri eksik ilani sayisal araliga almaz.
- Birbiriyle ayni ad, satici ve fiyata sahip ilanlarin ekranda cakismamasi icin tabloda tekil satir anahtarlari kullanilir.
- Sutun sirasi: Isim, Rating, Salary, Price, Currency, Position, Seller, Base, Value, Delta.
- Trading Hall tarama servisine degisiklik yapilmadi.

DOGRULAMA
node --test tests/*.test.cjs : 95 / 95 test basarili.
Gercek hesaptaki liste ile uygulama ekrani bu ortamda karsilastirilamadi.
EXE ve kurulum paketi canli Trade testleri bitene kadar hazirlanmadi.
