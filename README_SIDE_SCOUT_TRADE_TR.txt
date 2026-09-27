DreamTeam Manager — Side Scout / Trade Create Room düzeltmesi

Bu yama, önceki DreamTeamManager_Make_Direkt_APK0_NoFace_Duzeltmesi.zip sürümünün üzerine uygulanır. ZIP içindeki src/ dosyalarını projenin aynı dizinlerine açın. Kayıtlı hesaplar ve veriler değişmez.

- Main ve Side Scout: tüm tanımlı uygulama rollerindeki oyuncuları (Stok/Satılabilir/Kart ve diğer özel roller), ayrıca Maks. Price veya altındaki oyuncuları alma hakkı vardır. Side → Main ve Main → Side seçimleri Scout satın almasını kısıtlamaz.
- Aynı rol iki yönde seçilebilir; her yön farklı hesabın vereceği oyuncuları belirler. Price veya altı oyuncular önceki kurala göre Main'e aktarılır; diğerleri yön seçimine göre aktarılır veya mevcut hesapta kalır.
- Main hesabındaki yalnızca Side → Main rolünden dolayı bir oyuncu Make'de karta çevrilmez. Kart rolü, Price kuralı ve Main'e gerçekten gelen doğrulanmış transferlerin yönlendirmesi geçerlidir.
- Side Trade Center penceresindeki Create Room düğmesine kesin olarak basılır. Açılan Create trade room penceresindeki açıklama ve varsa parola doldurulur, yalnız o penceredeki Create Room düğmesine basılır. Pencere kapanışı doğrulanır.

Doğrulama: node --test tests/*.test.cjs (88/88 başarılı). Canlı oyunda oda açma ve iki hesabın takası bu ortamda tamamlanamadı; sonraki hesabınızla test etmeniz gerekir. .exe/setup oluşturulmadı.
