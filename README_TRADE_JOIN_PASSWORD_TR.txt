DREAMTEAM MANAGER — TRADE ODA KATILIMI VE ONAY DUZELTMESI

Bu ZIP, onceki DreamTeam Manager duzeltmelerinin ayni klasor yapisinin uzerine cikarilir.
Yalnizca Auto Trade islemine ait degisen servis dosyasi ile ilgili testleri icerir.

DUZELTMELER
- Main, Side takim adini arar ve oda listesindeki Host adini tam eslestirir. Ayni takimin birden cok odasi varsa yanlis odaya rastgele girmez.
- Join tiklamasi surerken tarayicinin sifre penceresini yakalar, kayitli oda sifresini girip onaylar ve Trade Desk'i bekler.
- Side panelinin solda, Main panelinin sagda ve You isaretinin dogru tarafta oldugunu her iki tarayicida denetler.
- Main kendi kadrosundaki, Side kendi kadrosundaki oyunculari secer. Offering alaninda yinelenen portreler secim dogrulamasini bozmaz.
- Her hesap kendi agreements to trade butonuna basar; Side tarayicisinda iki onay ve Confirm Trade etkinlesince Side Confirm Trade'e basar.
- Islem sonrasi her iki oturumda Trade Desk kapanip Stadium gorunumu kararlilasana dek bekler; sonra Main Make ve Side Scout ayni donguye devam eder.

DOGRULAMA
node --test tests/*.test.cjs -> 101 / 101 test basarili.
Verilen oda, onay ve sifre orneklerinin HTML yapisi ile seciciler kontrol edildi.
Gercek oyun hesabiyla canli Trade bu ortamda denenemedi; son adimi uygulamada test etmelisin.
EXE ve setup canli Trade testi tamamlanana kadar uretilmedi.
