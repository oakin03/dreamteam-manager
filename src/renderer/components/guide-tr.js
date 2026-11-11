// Rehber (Türkçe). Her bölüm: ne işe yarar, adım adım kullanım, düğmeler, kurallar,
// ipuçları ve sorun olursa ne yapılacağı. Sade dil, teknik ayrıntı yok.
export const GUIDE_TR = {
  title: "Rehber",
  subtitle: "Uygulamanın kullanım kılavuzu: her sayfa ne işe yarar, nasıl kullanılır, nasıl çalışır",
  search: "Rehberde ara…",
  empty: "Aramaya uyan konu yok.",
  head: { what: "Ne işe yarar?", steps: "Adım adım", buttons: "Düğmeler ve alanlar", rules: "Nasıl çalışır?", tips: "İpuçları", problems: "Sorun olursa" },
  intro: "DreamTeam Manager, oyundaki tekrar eden işleri senin yerine yapar: maç oynatır, günlük görevleri bitirir, Scout'tan oyuncu alıp hesaplar arasında takas eder, pazardaki satışları toplar, PVP / Kule / Go-up gibi modları oynar. İşlerin çoğu tarayıcı açmadan, arka planda yapılır ve yapılan her şey Aktivite sayfasına yazılır. Yeni başlıyorsan önce “İlk adımlar” ve “Temel kavramlar” bölümlerini oku.",
  sections: [
    {
      id: "start", icon: "🚀", name: "İlk adımlar",
      what: "Uygulamayı ilk kez kuran biri için en kısa yol: hesapları ekle, ana hesabı seç, rolleri ver, sonra otomasyonları başlat.",
      steps: [
        "Hesaplar sayfasında “Hesap Ekle” ile oyun hesaplarını kullanıcı adı ve şifreyle ekle (çok sayıda yeni hesap gerekiyorsa “Hesap oluştur” ile toplu açabilirsin).",
        "Ana hesabını (kartları topladığın hesap) “Ana Yap” ile Main yap. Diğer hesaplar Side olur.",
        "Gerekirse Rol sütunundan hesaplara rol ver: Harcayıcı, Turnuva, 2. Main… (ayrıntısı “Temel kavramlar”da).",
        "Kartlar sayfasında “Yenile” ile ana hesabın kartlarını tara, sonra Oyuncu Listesi'nden oyunculara Kart / Satılabilir / Stok rollerini ver. Auto Trade neyi alacağına bu rollere bakarak karar verir.",
        "Auto Play sayfasında hesapları seçip “Seçilileri Başlat”a bas: hesaplar maç oynamaya ve günlük rutini yapmaya başlar.",
        "Günlük plan anahtarlarını (Auto Play'in günlük durması, turnuva kaydı, PVP) açarsan bunlar her gün kendiliğinden yapılır.",
        "Bir şey ters giderse ilk bakılacak yer Aktivite sayfasıdır."
      ],
      buttons: [], rules: [],
      tips: [
        "Uygulamayı masaüstündeki ya da Başlat menüsündeki DreamTeam Manager kısayoluyla aç. Uygulama zaten açıksa kısayol yeni pencere açmaz, açık olanı öne getirir.",
        "Pencereyi kapatınca uygulamanın tepside çalışmaya devam etmesini Ayarlar → Uygulama davranışı'ndan seçebilirsin."
      ],
      problems: []
    },
    {
      id: "concepts", icon: "📘", name: "Temel kavramlar",
      what: "Rehberin ve uygulamanın her yerinde geçen kelimelerin anlamı.",
      steps: [],
      buttons: [
        ["Main (ana hesap)", "Kartları topladığın hesap. Auto Trade kart rollü oyuncuları buraya taşır ve karta çevirir; Kartlar, Sentez ve Aktive et bu hesapla çalışır."],
        ["2. Main", "Main hesap seçili değilken main gibi çalışan yedek ana hesap."],
        ["Side (yan hesap)", "Main dışındaki hesaplar. Main dışındaki bütün roller (Turnuva, Harcayıcı, senin eklediklerin) diğer otomasyonlarda Side sayılır."],
        ["Harcayıcı", "Auto Trade'de Satılabilir / Stok oyuncuları alıp pazara koyan yan hesaplar. TK'sını bu işe harcar; Main'in ve diğer Side'ların TK'sı korunur."],
        ["Kart rolü", "Main'e gidip yıldız karta çevrilecek oyuncu."],
        ["Satılabilir rolü", "Yan hesapta kalıp pazarda satılacak oyuncu."],
        ["Stok rolü", "Yan hesapta bekletilecek oyuncu. Yalnızca 30. seviye ve üstü hesaplar imzalar (o hesaplar maaşta %5 indirim alabilir)."],
        ["Ucuz oyuncu", "Fiyatı Auto Trade'deki “Maksimum fiyat”ın altında kalan oyuncu: rolüne bakılmadan Main'e gider ve karta çevrilir."],
        ["Değer ve Base", "Değer, oyuncunun bugünkü fiyat değeridir; Base, oyuncunun inebileceği taban değerdir. Maaşı Base'inde ya da altındaki oyuncu BASE rozeti alır. Değeri Base'in altına düşen oyuncunun yarınki Base'i, değerinin %5 aşağısı olur."],
        ["TK, APK, TIX", "Oyunun üç para birimi. Scout alımları ve takaslar TK ile, pazar ilanları APK ya da TIX ile yapılır."],
        ["Bench (yedek)", "Kadronun ilk 5 dışındaki 6 kişisi. Kadro en fazla 5 + 6 = 11 oyuncudur; ilk 5'e otomasyonlar asla dokunmaz."]
      ],
      rules: [
        "Oyun günü 19:00'da (TR) döner; günlük haklar (PVP, Daily Boss, Cheer, görevler) 19:10'da yenilenir.",
        "Oyuncu değerleri her gün 11:00'de (TR) değişir; uygulama yeni listeyi 11:05 civarında alır.",
        "Turnuvalar her gün 15:00'te (TR) başlar.",
        "Oyunun bazı işleri hesaba giriş ister. Bir hesaba giriş yapılınca o hesap başka bir yerde (ör. tarayıcıdaki oyun sekmesi) açıksa oradan çıkar. Okuma işleri (Scout listesi, posta, arkadaşlar) girişsiz yapılır."
      ],
      tips: [], problems: []
    },
    {
      id: "general", icon: "💡", name: "Genel kullanım",
      what: "Uygulamanın her yerinde geçerli kolaylıklar.",
      steps: [],
      buttons: [
        ["Tablo başlıkları", "Bir sütun başlığına tıklayınca o sütuna göre sıralanır; tekrar tıklayınca yön değişir, üçüncü tıklamada ilk sıraya döner. Sayılar, tarihler ve Grade'ler (D- … S+) doğru sırayla sıralanır."],
        ["Tüm otomasyonları durdur", "Sol alttaki düğme: çalışan her şeyi durdurur. “Devam ettir” aynı işleri yeniden başlatır."],
        ["Sarı şerit", "Oyuna bağlanılamadığında görünür. Bütün işler bekler, oyun gelince kendiliğinden devam eder."],
        ["Hesap grupları", "Aynı adla başlayıp sonu numaralı en az 3 hesap (Pipelne1–50, Trophy–Trophy10) tek grup olarak görünür. Grubun kutusu hepsini seçer, adına basınca grup açılır; açık bıraktığın gruplar hatırlanır."]
      ],
      rules: [
        "Maç oynayan her otomasyon (PVP, Kule, Go-up, Quiz, Daily Boss…) başlarken o hesaplardaki Auto Play'i durdurur ve bitince yeniden başlatır.",
        "Bir hesapta elle iş yaptığında (pazarda listeleme, kovma) o hesabı kullanan otomasyon yalnızca o hesap için bekler; diğer hesaplarda devam eder.",
        "Kule, PVP, Go-up, Daily Quiz, Sentez, tekrar listeleme, Chat ve Auto Trade bitince Windows bildirimi gelir."
      ],
      tips: [
        "Sol menüdeki sayılar: Auto Play'de çalışan hesap sayısı (mavi), toplanmayı bekleyen pazar satışı (yeşil), son bakışından beri gelen hata (kırmızı), Sosyal'de istek + okunmamış mesaj (kırmızı; yalnızca ödüllü posta varsa turuncu !).",
        "Sol menünün düzenini (liste adları, sıralar) Ayarlar → Menü düzeni'nden değiştirebilirsin."
      ],
      problems: []
    },
    {
      id: "home", icon: "🏠", name: "Komuta Merkezi",
      what: "Uygulamanın ana ekranı. Bütün hesapların durumunu tek bakışta gösterir: oyun açık mı, kaç hesapta Auto Play çalışıyor, hangi hesaplarda sorun var, gün dönümüne ne kadar kaldı.",
      steps: [
        "Üst satırda oyunun durumuna, çalışan hesap sayısına ve sorunlu hesap sayısına bak.",
        "Özet kutularından (Daily Reward, PVP hakkı, Sosyal bildirimleri, bekleyen görev ödülleri) birine tıklayınca ilgili sayfaya gidersin.",
        "Hesaplar tablosunda sorunlu hesaplar en üsttedir; bir satıra tıklayınca o hesabın Auto Play satırı açılır."
      ],
      buttons: [
        ["Bugünün akışı", "Günlük durdurma, turnuva kaydı, PVP, maaş güncellemesi, gün dönümü ve zamanlanmış görevler bir saat çizgisinde; turuncu çizgi şu anki saat."],
        ["Hesaplar tablosu", "Daily Reward 6 kutu (turuncu: toplandı, yeşil: şimdi alınabilir), PVP hakkı, maaş / maaş sınırı çubuğu ve TK."],
        ["Hesap sağlığı ⚙", "Uyarı sınırlarını değiştirir: TK alt sınırı, maaş sınırının yüzde kaçında uyarılacağı, kadro sayısı."],
        ["Şimdi kontrol et", "Bütün hesapların maaş, kadro ve TK durumunu hemen okur (normalde 10 dakikada bir okunur)."],
        ["Günlük özet", "Seçtiğin günde oynanan maçları, toplanan satışları, alımları, sentezleri ve hataları özetler."],
        ["Base'e düşenler", "Değerinden %5 düşünce Base'ine eşit ya da altında kalan oyuncular (değeri 75 TK altındakiler gösterilmez); en yeni düşenler üstte."]
      ],
      rules: [
        "Maaş sınırını aşan hesaplar kırmızı görünür; bu hesaplarda Auto Play ve Kule maç başlatamaz.",
        "Oyunda pazar kilidi açık olan hesap “Pazar kilitli” uyarısı alır; o hesapta pazar işleri yapılamaz.",
        "Hesapların yanında oyundaki takım logoları görünür."
      ],
      tips: ["Kırmızı bir uyarı görürsen ayrıntısı Aktivite sayfasındadır."],
      problems: []
    },
    {
      id: "accounts", icon: "👥", name: "Hesaplar",
      what: "Oyun hesaplarını eklediğin, düzenlediğin, sildiğin ve rollerini verdiğin yer. Ana hesap (Main) burada seçilir.",
      steps: [
        "“Hesap Ekle”ye bas, kullanıcı adı ve şifreyi gir, kaydet.",
        "Ana hesabın satırında “Ana Yap”a bas.",
        "Rol sütunundan her hesaba rol ver; yeni rol eklemek ya da renk seçmek için “Roller” düğmesini kullan.",
        "Satırları sürükleyerek sırayı değiştir; diğer sayfalar da bu sırayı kullanır."
      ],
      buttons: [
        ["Hesap Ekle", "Kullanıcı adı ve şifreyle yeni hesap ekler."],
        ["Düzenle / Sil", "Hesap bilgisini değiştirir ya da hesabı kaldırır."],
        ["Ana Yap", "Bu hesabı ana hesap yapar."],
        ["Yenile", "Seviye, TK, APK ve TIX'i oyundan yeniden okur."],
        ["Roller", "Rol ekler, siler ve rengini seçer. Main, 2. Main ve Side sabittir; silinmez, adı değişmez."],
        ["Hesap oluştur", "Ön ek, hesap sayısı, ortak şifre ve logo sorar; hesapları toplu açar (aşağıda)."]
      ],
      rules: [
        "Şifreler bu bilgisayarda şifrelenmiş olarak saklanır.",
        "Kullanılabilir APK / TIX: hepsi ana hesaba aktarılsaydı kalacak miktar, x/y olarak gösterilir. y bütün hesapları sayar; x, 20'den az APK (TIX) olan yan hesapları saymaz, çünkü onlar ana hesaba aktarılamaz. Yan hesaplarda %5 kesinti yukarı yuvarlanır (en az 3); ana hesapta kesinti yoktur.",
        "Hesap oluştur: her hesap için geçici bir mail adresi alınır, oyunda hesap açılır, takım adı ön ek + numara olur, takım kurulur, logo seçilir; hesap günlük rutine eklenir ve Auto Play'i başlatılır.",
        "Hesaplar 1, 5 ya da 10'ar 10'ar aynı anda açılır. Numara, o ön ekle kullanılan en yüksek numaradan devam eder; oyunda alınmış adlar atlanır.",
        "Oyun ya da mail sitesi reddederse ya da üst üste 5 hesap başarısız olursa işlem durur, zorlanmaz. Uygulama yarıda kapanırsa bir sonraki açılışta kaldığı yerden devam eder."
      ],
      tips: [
        "Hesaplar tarayıcı açmadan, oyunun kendi giriş isteğiyle oyuna girer; tarayıcı yalnızca bu olmazsa açılır. Bu, çok hesap aynı anda çalışırken bilgisayarı rahatlatır.",
        "Seviye, TK, TIX ve APK Auto Play çalışmasa da 3 dakikada bir okunur; seviye atlayan hesap Aktivite'ye yazılır."
      ],
      problems: [
        ["Bir hesap sürekli tarayıcıyla açılıyor", "Üst üste 3 hatadan sonra hesap kendiliğinden yeniden tarayıcısız girişi dener. Şifrenin doğru olduğunu Düzenle'den kontrol et."]
      ]
    },
    {
      id: "social", icon: "💬", name: "Sosyal",
      what: "Her hesabın gelen kutusu, arkadaşları, özel sohbetleri, arkadaşlık istekleri ve engellediği oyuncular tek sayfada.",
      steps: [
        "Üstteki hesap şeridinden bir hesap seç. Kırmızı sayı istek + okunmamış mesajı, ✉ ödüllü postayı gösterir.",
        "Sekmelerden ne yapacağını seç: Gelen Kutusu, Arkadaşlar, Sohbet, İstekler, Engellenenler."
      ],
      buttons: [
        ["Gelen Kutusu · Topla / Hepsini topla", "Postadaki ödülleri toplar; postaya tıklayınca içeriği açılır."],
        ["Arkadaşlar · Sohbet / Çıkar", "Sohbeti açar ya da arkadaşı listeden çıkarır (önce onay ister)."],
        ["Arkadaşlar · Scout", "O arkadaşın serbest oyuncu panosunu (6 oyuncu, 30 dakikada bir yenilenir) açar; oradan oyuncu imzalanabilir."],
        ["Sohbet", "Soldan arkadaş seç, mesajları oku ve yaz."],
        ["İstekler", "Gelen istekleri kabul et ya da reddet; gönderdiğin bekleyen istekleri iptal et. Arama, kendi hesapların arasında arar."],
        ["Engellenenler · Engeli kaldır", "Engellediğin oyuncunun engelini kaldırır."]
      ],
      rules: [
        "Okumalar giriş yapmadan yapılır; mesaj gönderme ve istek kabul etme hesabın kendi oturumuyla yapılır, hesap oyundan atılmaz.",
        "Uygulama her dakika bütün hesaplarda yeni istek, okunmamış mesaj ve ödüllü posta arar; varsa sol menüde sayı çıkar, Aktivite'ye yazılır ve Windows bildirimi gelir.",
        "Oyun sohbet geçmişini her gün 19:00 civarında siler; uygulama gördüğü mesajları saklar, böylece önceki günün sohbeti de okunabilir.",
        "Auto Play çalışırken posta ödülleri 30 dakikada bir kendiliğinden toplanır."
      ],
      tips: [], problems: []
    },
    {
      id: "autoplay", icon: "▶️", name: "Auto Play",
      what: "Seçtiğin hesaplarda maçları otomatik oynatır ve her gün günlük rutini yapar: Daily Signin, 600 Günlük giriş, günlük görevler, ittifaktaki hesaplarda 100 TK bağış, 1 Dostluk Maçı, 1 Group Match (3v3 parti) ve görev ödüllerinin toplanması.",
      steps: [
        "Tablodan hesapları işaretle (ya da üstteki gruptan/rol menüsünden seç).",
        "“Seçilileri Başlat”a bas. Tek hesap için satırdaki ▶ düğmesini kullan.",
        "Durum sütununda hesabın o an ne yaptığını ve son rakibini gör.",
        "Her gün aynı saatte durmasını istiyorsan Günlük plan'daki “Günlük durdurma”yı aç ve saatini seç."
      ],
      buttons: [
        ["▶ / ■", "Tek hesabı başlatır ya da durdurur."],
        ["Seçilileri Başlat / Durdur", "İşaretli bütün hesaplarda aynı anda."],
        ["Seçili rolleri başlat", "Rol menüsünden seçtiğin rollerdeki hesapları başlatır; seçimin hatırlanır."],
        ["Filtre sekmeleri ve arama", "Tümü / Çalışan / Duran / Sorunlu; arama kutusu hesap adına göre süzer."],
        ["Ödülleri topla", "Biten günlük görevlerin ve postanın ödüllerini hemen toplar."],
        ["Görevleri yenile", "Görevler sütununu oyundan yeniden okur."],
        ["Zamanla", "Bir görevi ileri bir saate kurar (bkz. Zamanlanmış görevler)."],
        ["Günlük plan · Günlük durdurma", "Her gün seçtiğin saatte (varsayılan 14:55, turnuvadan önce) bütün Auto Play'leri durdurur; istersen başka bir saatte aynı hesaplarda yeniden başlatır."],
        ["Günlük plan · Turnuva", "Her gün seçtiğin saatte (varsayılan 15:48) turnuva kaydını yapar."],
        ["Günlük plan · PVP", "Her gün seçtiğin saatte (varsayılan 05:01) PVP Arena görevini başlatır."],
        ["Daily Reward anahtarı", "Açıkken Stadyumdaki Daily Reward hediyesi Auto Play çalışmayan hesaplarda da süresi dolunca toplanır."]
      ],
      rules: [
        "Group Match: yalnızca lideri bizim hesap olan partilere girilir (Find match'e biz basarız); öyle bir parti yoksa yeni parti kurulur. Başkalarının partisine girilmez, ama başkaları bizim partimize katılabilir. Parti dolu olduğu halde 1 dakika Ready basmayan üye partiden çıkarılır. Maç bitince partiden çıkılır (partideki hesap Quick Play oynayamaz). Maaş sınırını aşan hesap Group Match oynayamaz.",
        "Günlük rutin 19:10'dan sonraki ilk başlatmada ya da çalışırken 19:12'de yapılır.",
        "Hesaplar Hızlı Oyun'u sırayla arar; böylece kendi hesapların birbirine denk gelmez. Rakip kendi hesabınsa turuncu görünür.",
        "Takım maaş sınırını aşarsa Auto Play o hesapta kendini durdurur ve uyarır.",
        "Günlük PK sınırı dolunca Hızlı Oyun o hesapta 19:00'daki sıfırlamaya kadar bekler.",
        "Daily Reward günde 6 kademedir; tabloda “4/6 01:23:45” gibi (sıradaki kademe ve kalan süre) görünür, 6/6 olunca 19:00 beklenir.",
        "İttifak bağışı günde bir kez yapılır; TK yetmezse ya da hesap ittifaka yeni katıldıysa o gün atlanır.",
        "Üç günlük plan satırı birbirinden bağımsızdır; Turnuva ve PVP satırları ilgili sayfada en son seçtiğin hesapları kullanır."
      ],
      tips: [
        "“Günlük” sütunu rutinin bugün bitip bitmediğini, “Görevler” kalan / toplam görevi gösterir.",
        "Yeni bir hesapta Daily Signin serisi (“Start my streak”) kendiliğinden başlatılır."
      ],
      problems: [
        ["Hesap “Maaş sınırı” diye durdu", "Takımın toplam maaşı oyunun sınırını aşıyor. Bench'ten oyuncu sat ya da kov, sonra yeniden başlat."],
        ["Hesap sürekli “maçta” görünüyor", "Hesap zaten bir maçtaysa o maçın bitmesi beklenir; maç bitince devam eder."]
      ]
    },
    {
      id: "schedule", icon: "⏰", name: "Zamanlanmış görevler",
      what: "Bir işi ileri bir saate kurmanı sağlar: turnuva kaydı, pazar satışlarını toplama, dünkü ilanları tekrar listeleme ya da PVP Arena.",
      steps: [
        "Auto Play sayfasında “Zamanla”ya bas.",
        "Görevi, saati, hesapları ve “Aynı anda / Sırayla” seçeneğini seç, kaydet.",
        "Bekleyen görevler listede görünür; istersen silebilirsin."
      ],
      buttons: [
        ["Görev", "Turnuva kaydı, Pazar: satışları topla, Pazar: dünkü ilanları tekrar listele, PVP Arena."],
        ["Aynı anda / Sırayla", "Hesaplar birlikte mi, yoksa aralarında bekleyerek tek tek mi çalışsın."]
      ],
      rules: [
        "Saat gelince seçili hesaplarda çalışan işler durdurulur, hazırlık süresi kadar beklenir, görev yapılır; bitince durdurulan işler kendiliğinden yeniden başlar.",
        "Uygulama görev sırasında kapanırsa, açılınca durdurulmuş işler yeniden başlatılır.",
        "Günlük plandaki turnuva ve PVP satırları her gün buraya tek seferlik görev ekler."
      ],
      tips: [], problems: []
    },
    {
      id: "autotrade", icon: "🔁", name: "Auto Trade",
      what: "Scout'tan uygun oyuncuları alır ve hesaplar arasında takasla doğru yere taşır: Kart rollü ve ucuz oyuncular Main'e gidip karta çevrilir; Satılabilir / Stok oyuncular yan hesaplarda ya da Harcayıcılarda kalıp pazara konur. Kadronun ilk 5'ine asla dokunulmaz.",
      steps: [
        "Önce Kartlar sayfasında oyunculara rollerini ver (Kart, Satılabilir, Stok). Auto Trade yalnızca rolü ya da fiyatı uyan oyuncuları alır.",
        "Hesaplar bölümünden çalışacak hesapları seç. Main işaretli değilse bu çalıştırmada main gibi davranacak hesabı seç.",
        "Roller bölümünde hangi rolün hangi yöne gideceğini seç: Side → Main (karta çevrilecekler), Main → Side (yan hesapta kalacaklar).",
        "Maksimum fiyatı gir: bu fiyat ve altındaki oyuncular rolüne bakılmadan Main'e gider ve karta çevrilir (50'nin altı = yalnızca roller).",
        "Trade odası adını ve şifresini gir; Döngü'yü seç (Tek tur, Belirli sayıda, Sonsuz) ve aynı anda kaç hesabın çalışacağını yaz (1–6, önerilen 3).",
        "Harcayıcı kullanacaksan “Arkadaş Scout'larını kullan”ı aç ve TK tabanını ayarla. Satış fiyatlarını “Otomatik Fiyatlandırma” sekmesinde gir.",
        "“Başlat”a bas. Başka bir sistem bu hesapları kullanıyorsa uyarılırsın; “Durdur ve başlat” ile devam edebilirsin.",
        "Bench'inde önceden oyuncu olan hesaplar için her oyuncuya karar ver: Pazarda listele, Trade'e dahil et, Karta çevir, Kov ya da Hiçbir şey yapma. Maaşı 1 olan takas edilemez oyuncular için yalnız Kov ve Hiçbir şey yapma vardır. Bu kararlar Scout taramasından önce, bütün hesaplarda toplu olarak uygulanır; sonradan bench'e gelen oyuncuya dokunulmaz.",
        "Hazırlık: Başlat'ın yanındaki Hazırlık düğmesiyle (ya da başlatma penceresindeki Sadece hazırlık yap ile) bench kararlarını Auto Trade'i başlatmadan yaptırırsın: pazara koyulacaklar listelenir, kovulacaklar kovulur, Trade'e dahil et / Karta çevir oyuncuları hemen main'e verilir ve main karta çevirir, Satılabilir'ler harcayıcıya gider. Scout taranmaz. 1 saat içinde Auto Trade başlatırsan bu hesaplar tekrar kontrol edilmez.",
        "Çalışırken Canlı durum'dan hangi hesapta ne yapıldığını izle. Bitince yan hesaplarda kalanları “Pazara listele”den sat."
      ],
      buttons: [
        ["Başlat / Duraklat / Devam ettir", "Duraklat işi güvenli bir noktada bekletir; beklerken harcayıcılar ellerindeki oyuncuları pazara koyar (ucuz oyunculara dokunulmaz). Devam ettir kaldığı yerden sürdürür."],
        ["Durdur / Kaldığı yerden devam et", "Durdurur; durmadan önce yan hesaplarda main'i bekleyen ucuz oyuncular main'e verilir (main'in TK'sı yetmezse kovulur) ve harcayıcılar oyuncularını pazara koyar. Ekranda kalan işlem sayısı ve geri sayan tahmini süre görünür. Sonra kaldığı yerden sürdürebilirsin."],
        ["İlerlemeyi sıfırla", "Kayıtlı ilerlemeyi siler, her şeye baştan başlanır."],
        ["Hesap rollerine göre kurallar", "Main dışındaki her hesap rolü için Scout'tan neyin imzalanacağını sınırlar (Satılabilir / Kart / Ucuz) ve role kendi fiyat sınırını verir. Harcayıcı satırı da geçerlidir."],
        ["Sadece Satılabilir ve Stok oyuncuları al", "Varsayılan olarak kapalı. Açıkken Kart ve fiyat sınırının altındaki ucuz oyuncular alınmaz; yalnızca Satılabilir ve Stok alınır. Bu modda main kendi sırasında Scout'unu ve arkadaş listelerini tarar, aldıklarını harcayıcılara verir ve kapanır; sonra 10 yan hesap main'i hiç açmadan aynı anda çalışır, her biri oyuncularını o an boşta olan ayrı bir harcayıcıya verir ve harcayıcı onları hemen pazara koyar (boşta harcayıcı yoksa yan hesap kendisi listeler)."],
        ["Base oyuncuları satılabilir olarak değerlendir", "Alımda ödenen gerçek maaşı Base'inde ya da altında olan, bir takımdaki oyuncular Satılabilir sayılır ve karta çevrilmez."],
        ["Ertesi günün Base değerini kullan", "Maaş, yarınki Base ile (Base × 0,95) karşılaştırılır: Base 50 iken 50 maaşlı oyuncu Base sayılmaz, 48 maaşlı sayılır."],
        ["Arkadaş Scout'larını kullan (Harcayıcı ağı)", "Hesaplar kendi Scout'larından sonra arkadaşlarının Scout'larına da bakar. Arkadaşlıkları Auto Trade kurar; Main'in arkadaş listesine dokunulmaz. Bu çalıştırmada sırası henüz gelmemiş bir Harcayıcının Scout'undaki Satılabilir / Stok oyuncuya başka hesap dokunmaz; onu Harcayıcı kendi sırasında kendisi alır (takasla geri vermeye gerek kalmaz). Harcayıcıların aldığı Satılabilir / Stok oyuncular her yan hesabın sırası biter bitmez pazara konur (tur sonunu beklemez). Auto Trade başka bir iş (ör. elle listeleme) yüzünden durursa harcayıcılar yine önce listeler; bunu sadece senin ikinci kez Durdur'a basman keser."],
        ["Otomatik Fiyatlandırma sekmesi", "Harcayıcıların Satılabilir ve Stok oyuncuları hangi fiyatla pazara koyacağı. Üstte iki varsayılan fiyat var: Satılabilir (başlangıçta 20 APK) ve Stok. Altta Satılabilir ya da Stok rolü verilmiş her oyuncu için: kendi fiyatı, %5 indirimli alınırsa kullanılacak fiyat ve “Sadece Lv30+” kutusu. Fiyatı girilmemiş oyuncular turuncu işaretlidir ve varsayılan fiyatla listelenir. Değişiklikler hemen kaydedilir, Auto Trade çalışırken de geçerlidir."],
        ["%5 indirimli fiyat", "Oyuncu Lv30+ bir hesapla %5 indirimle alındıysa (Base olsun olmasın) bu fiyat kullanılır. Örnek: değeri 2470 olan bir oyuncu indirimle 2347'ye alınırsa, onun için girdiğin indirimli fiyatla listelenir. Boş bırakırsan normal fiyatı kullanılır."],
        ["Sadece Lv30+", "İşaretlediğin Satılabilir oyuncuyu Stok gibi yalnız Lv30+ hesaplar alır: önce Lv30+ bir Harcayıcı, yoksa geçici arkadaşlıkla Lv30+ başka bir hesap. Stok oyuncular için bu her zaman açıktır."],
        ["İndirimsizse kov", "İşaretlediğin oyuncu %5 indirimle alınmadıysa harcayıcı onu pazara koymaz, kovar; indirimle alındıysa normal şekilde listelenir. Çöp kopyalardan kurtulmak içindir. Kovma geri alınamaz; kutuyu işaretlerken onay sorulur ve her kovma Etkinlik'e yazılır."],
        ["Hesap başına Harcayıcı arkadaş", "Her hesabın kaç Harcayıcıyla arkadaş olacağı; biri TK bitirince sıradaki alır."],
        ["Harcayıcı TK tabanı", "Alımdan sonra bu TK'nın altına düşecek Harcayıcı kullanılmaz."],
        ["Arkadaş ağını şimdi kur", "Arkadaşlıkları turu beklemeden hemen kurar."],
        ["Harcayıcı pazar listesi", "Harcayıcıların pazara koyduğu oyuncular: Değer, Maaş, Base ve satış fiyatı. Satırları seçip “Seçilileri tekrar listele” ya da “Seçilileri pazardan çıkar ve kov” diyebilirsin; her satırın kendi düğmeleri de var."],
        ["Pazara listele", "Bitişte yan hesaplarda kalan oyuncular: fiyat ve para birimi seç, listele. Satırdaki Kov / Tümünü kov oyuncuları kovar (önce sorar)."],
        ["Karta çevrilen oyuncular", "Bu çalıştırmada ve toplamda karta çevrilen oyuncuların sayısı; “Tabloyu sıfırla” sayıları siler."]
      ],
      rules: [
        "Başlamadan önce seçili hesapların kadrosu ve TK'sı giriş yapmadan okunur. Seviyesi 10'un altındaki hesaplar kullanılmaz (takas oyunda 10. seviyede açılır).",
        "Kadro 5 + 6 = 11'dir; yalnızca bench kullanılır. Ekipmanlı, X ve süreli oyuncular hiç taşınmaz.",
        "Main Scout'a girer, uygun bütün oyuncuları alır; bench dolunca karta çevrilecekleri çevirir, yan hesaba gidecekleri en yüksek TK'lı yan hesaba verir.",
        "Sonra yan hesaplar en yüksek TK'dan en düşüğe açılır. Odayı yan hesap kurar, Main şifreyle katılır; tek takasta iki yön birden gider, her taraf en fazla 5 oyuncu verir. TK farkı oyuncu maaşları arasındaki farktır.",
        "Bir yan hesabın TK'sı yetmezse o hesap atlanır. Çözülemeyen bir sorun olursa iş durur; düzeltip “Kaldığı yerden devam et”e basarsın.",
        "Main'in TK'sı bitmeye yakınsa iş durmaz: yan hesaplar main için ancak main'in takasta ödeyebileceği kadar oyuncu alır, gerisini almaz. Main'in kendi Scout'unda parası yetmeyen oyuncu atlanır, daha ucuzları alınmaya devam eder. Takasta main'in TK'sı yine de yetmezse ödeyebildiği kadarı geçer, kalanlar yan hesapta bekler ve Etkinlik'e yazılır.",
        "Auto Trade durdurulursa (elle, Tüm otomasyonları durdur ile ya da PVP gibi zamanlanmış bir görev yüzünden) ya da hata verip durursa, durmadan önce yan hesaplardaki ucuz oyuncular main'e verilir ya da kovulur, harcayıcılar da oyuncularını pazara koyar. Böylece maaş sınırları dolu kalmaz, turnuva gibi işleri kaçırmazlar. Acil durdurmak için Durdur'a ikinci kez bas.",
        "Main'in TK'sı bütün yan hesaplar için birlikte hesaplanır: yan hesaplar (kendi Scout'larında da, arkadaş Scout'larında da) main'in ödeyebileceğinden fazla oyuncu almaz. Main'in TK'sı ucuz oyunculara yetmeyecek kadar azalınca Auto Trade bildirim verip durur; main'e TK aktarıp Devam et'e bas.",
        "5'erli çalışır: bir yan hesap main'e gidecek 5 oyuncu tuttuğu anda, 6.'yı almadan main ile takas eder; 5 Satılabilir / Stok biriktiğinde de onları harcayıcıya verir ve harcayıcı pazara koyar. Turun sonunda kalanlar da takas edilir.",
        "Başka bir iş (Trading Hall'dan alım, zamanlanmış görev vb.) Auto Trade'in kullandığı bir hesaba girince Auto Trade kısa süre durur ve iş bitince kaldığı gibi döner: duraklatılmışsa duraklatılmış kalır, sen bu arada Durdur'a bastıysan tekrar başlamaz. Bu kısa durmada ucuz oyuncular takas edilmez, sadece harcayıcılar listeler.",
        "Yan hesaplar birkaç tane aynı anda çalışır (ayardaki sayı kadar); main ile takaslar yine sırayla yapılır. Canlı durum'da bu turun kaç hesabının bittiği ve tahmini tur sonu, ayrıca Auto Trade'in durmadan ve duraklamadan geçen aktif çalışma süresi görünür. Bir arkadaş Scout'u bir kez okunduktan sonra kendi yenilenmesine (30 dakika) kadar tekrar okunmaz.",
        "Base kuralı: değeri Base'inin altına düşmüş bir oyuncuda, maaşı değer × 0,95'e eşit ya da altındaysa Base sayılır. Maaşı değerine eşit olan oyuncu Base sayılmaz.",
        "Rolleri iki yönü gösteren bir oyuncu (ör. Satılabilir + Kart) gelirse Auto Trade durur ve sorar: karta çevir, satılabilir kalsın ya da dokunma.",
        "Harcayıcı: TK'sı yeten bir Harcayıcı Satılabilir / Stok oyuncuyu doğrudan alır. Kadrosu dolunca ya da aynı oyuncu gelince bench'indeki bütün Satılabilir / Stok oyuncuları bir seferde pazara koyar.",
        "Harcayıcı alamazsa (günlük sınır, TK yok) Main ya da yan hesap alır ve takasla Harcayıcıya verir; o da olmazsa yan hesap tutar.",
        "Her tur bitince ve çalıştırmanın başında bütün Harcayıcıların bench'i kontrol edilir; pazara konmamış Satılabilir / Stok oyuncu kalmaz.",
        "Stok oyuncuları yalnızca 30. seviye ve üstü hesaplar alır. Öncelik: önce 30+ bir Harcayıcı, yoksa 30+ başka bir hesap. Arkadaş değillerse geçici arkadaşlık kurulur, alım bitince silinir. 30+ hesap yoksa oyuncu atlanır ve Aktivite'ye yazılır.",
        "Hız için Harcayıcı bağlantıları birkaç dakika açık tutulur (en fazla 4); böylece her listeleme ve takasta yeniden giriş beklenmez.",
        "Döngüde her hesaba Scout'u yenilendiğinde (30 dakika) tekrar girilir. Her turun sonunda Main'de kart taraması yapılır.",
        "Formdaki seçimler değiştikçe kaydedilir; sayfayı kapatıp açınca ya da uygulama yeniden başlayınca son seçimlerinle gelir."
      ],
      tips: [
        "Harcayıcı pazar listesinde fiyatını değiştirdiğin satır kendiliğinden seçilir; başarıyla yeniden listelenen satır tablodan düşer. Başka sayfaya gidip dönünce seçimlerin kaybolmaz.",
        "Pazarda elle listeleme ya da kovma yaptığın hesap için Auto Trade yalnızca o hesapta bekler; çalıştırmanın tamamı durmaz.",
        "Bitince “Auto Trade tamamlandı” kaydı alınan, karta çevrilen ve takas edilen oyuncu sayılarıyla Aktivite'ye yazılır.",
        "Hiç tanımadığın bir oyuncu sürekli alınıyorsa Kartlar → Oyuncu Listesi'nin altındaki “Listede olmayan ama rolü olan oyuncular” tablosuna bak; orada eski bir rol kalmış olabilir."
      ],
      problems: [
        ["“Auto Trade durdu · senin müdahalen gerekiyor”", "Hata kutusunda nedeni yazar (TK yetmedi, oyuncu karşı hesapta var…). Sorunu oyunda düzelt, “Kaldığı yerden devam et”e bas."],
        ["“Pazar listesi bekleniyor”", "Bir yan hesabın kadrosu kalacak oyuncularla doldu. Açılan pencerede her oyuncu için seç: Listele (fiyatı Otomatik Fiyatlandırma'dan dolu gelir, değiştirebilirsin), Kov (geri alınamaz) ya da Beklet (kadroda kalır, sayfanın altındaki “Pazara listele” tablosunda görünür, bir daha sorulmaz). “Hepsini:” düğmeleri bütün oyunculara aynı seçimi yapar. Herkes için seçim yapınca Tamam açılır; işlemler yapılır ve Auto Trade devam eder."],
        ["Stok oyuncu alınmadı", "Stok için 30. seviye ve üstü bir hesap gerekir. Aktivite'de “Stok atlandı” kaydı varsa uygun seviyede hesap yoktur."],
        ["Harcayıcının yedeğinde oyuncu kaldı", "Bir sonraki turun sonunda ya da bir sonraki başlatmada kendiliğinden pazara konur."]
      ]
    },
    {
      id: "pvp", icon: "⚔️", name: "PVP Arena",
      what: "Seçtiğin hesaplar PVP Arena'da günlük 10 hakkı bitene kadar maç yapar. Her hesabın kalan hakkı, PVP puanı, bugün kazandığı puan ve ligi görünür.",
      steps: [
        "“Durumu yenile” ile arenanın açık olup olmadığını ve kalan hakları oku.",
        "Hesapları seç (grup kutusuyla toplu seçebilirsin).",
        "“PVP Başlat”a bas. O hesaplardaki Auto Play durur, PVP bitince yeniden başlar.",
        "Çalışırken ve bitince sayfanın altında hesap hesap sonuç tablosu görünür."
      ],
      buttons: [
        ["Durumu yenile", "Arena durumunu, kalan hakları ve PVP puanlarını oyundan okur."],
        ["PVP Başlat", "Seçili hesaplarda PVP'yi başlatır."],
        ["Durdur", "PVP'yi durdurur."]
      ],
      rules: [
        "Her hesap “maç bul → maç bitsin → tekrar bul” döngüsüyle oynar. Hesaplar aynı anda çalışır; biri durursa diğerleri devam eder.",
        "Arena her gün 05:00 ve 17:00'de (TR) açılır. Arena kapalıysa ya da kapanırsa o hesap “PVP şu an aktif değil” diye durur.",
        "Haklar her gün 19:10'da yenilenir. “Bugün” sütunu 19:10'dan beri kazanılan puanı gösterir.",
        "Günlük plandaki PVP başladığında arena kapalıysa Auto Play durdurulmaz; arena açıldığı an PVP başlar. 3 saat içinde açılmazsa o günkü PVP atlanır.",
        "Hesap zaten bir maçtaysa önce o maçın bitmesi beklenir."
      ],
      tips: ["Lig adları (Rookie III … GOAT) oyunun puan aralıklarına göredir."],
      problems: [
        ["Çok hesapla PVP sırasında ekran beyaza döndü", "Bu sorun düzeltildi: pencere artık bu kadar sık güncellenmiyor. Pencere yine çökerse kendiliğinden yeniden yüklenir, PVP devam eder ve Aktivite'ye “Uygulama penceresi çöktü” kaydı düşer."]
      ]
    },
    {
      id: "tower", icon: "🗼", name: "Kule",
      what: "Challenger, Threat ve Rival kulelerini seçili hesaplarda kat kat oynar. Kuleler her pazar 19:10'da (TR) 1. kata döner.",
      steps: [
        "Hesapları seç.",
        "Üstteki “Üst üste kayıp sınırı”nı ayarla (varsayılan 2).",
        "“Kuleyi Başlat”a bas. Auto Play durur, kule bitince yeniden başlar."
      ],
      buttons: [
        ["Kuleyi Başlat", "Seçili hesaplarda başlatır."],
        ["Seçilileri durdur / Tümünü durdur", "Yalnızca işaretli hesapları ya da hepsini durdurur."],
        ["Üst üste kayıp sınırı", "Aynı katta kaç yenilgiden sonra o kulenin bırakılacağı (en az 1); son girdiğin sayı hatırlanır."]
      ],
      rules: [
        "Önce her kulenin en alt katı oynanır, sonra bir üst katlar.",
        "Aynı katta üst üste kayıp sınırına ulaşılırsa o kule bırakılır; üç kule de bitince ya da bırakılınca hesap durur.",
        "Takım maaş sınırını aşarsa o hesap durur ve uyarı çıkar."
      ],
      tips: ["Son çalıştırma tablosu her hesabın her kuledeki galibiyet / mağlubiyetini ve vardığı katı gösterir."],
      problems: []
    },
    {
      id: "daily", icon: "📅", name: "Günlük İşler",
      what: "Günlük modların hepsi bir sayfada, sekmeler halinde: Go-up, Professional, Daily Boss, Elite Ascent, Big 3 (Magic Team), Prop, Daily Quiz, Cheer, Chat ve Daily Slot. Hepsi tarayıcı açmadan çalışır.",
      steps: [
        "Üstten sekmeyi seç.",
        "Hesapları seç ve sekmenin Başlat düğmesine bas.",
        "Her sekmenin altındaki “Nasıl çalışır?” kutusu o modun kurallarını anlatır."
      ],
      buttons: [
        ["Daily Slot", "Daily Sign-in penceresindeki günlük slot (günde 1 çevirme, 3 ödül). “Durumu tara” hiçbir hesaba giriş yapmadan bugün çevrilip çevrilmediğini ve çevrilmişse kazanılan 3 ödülü gösterir (oyunda kendin çevirdiğin hesaplar dahil). “Hepsini çevir” çevrilmemiş seçili hesaplarda slotu çevirir: hesabın uygulamada açık bağlantısı varsa onu kullanır, Auto Play maçtaysa maç bitince çevirir, yoksa giriş yapar. Üstte bugünün ödüllerinin toplamı, en altta ödül havuzu ve şansları görünür."],
        ["Go-up", "Seçili hesaplar günlük 2 hakkı bitene kadar kuyruğa girip puan maçı yapar; “Tümü aynı anda” ya da “Sırayla” (hesaplar arası bekleme) seçilir. Lig, sezon ve toplam puan tabloda."],
        ["Professional", "Sezon ve playoff maçlarını günlük hak bitene kadar oynar; hak bitince maç kartıyla Props yenilemesi yapılır (günde en fazla 2). Hall of Fame'de rakibi sen seçersin; playoff şampiyonu hesapta “Hall of Fame'i başlat” ile yeni sezon açılır."],
        ["Daily Boss", "Her hesap seçtiğin boss ile günlük 2 hakkını oynar; seviyesi yetmeyen boss seçilemez. “Hepsine uygula” her hesaba en güçlü uygun boss'u seçer."],
        ["Elite Ascent", "Her hesap bulunduğu kattaki botla oynar, kazanırsa üst kata çıkar; günlük 2 bedava hak."],
        ["Big 3 (Magic Team)", "Lv 15 ve Ofis'te aktif üçlü MIAMI ve PHILADELPHIA botlarını yener, ödül kendiliğinden alınır."],
        ["Prop", "Maçtaki takımın ilk 5'ine devre arasında su şişesiyle stamina basar: staminası 75 ve altındaysa +30, 76–94 arasındaysa +10; 95'e gelince durur. Örnek: 15 staminalı oyuncuya 3 × +30, 55 staminalıya +30 sonra +10."],
        ["Prop · toplu seçim", "Soldaki kutularla hesapları seç (ya da “Tümünü seç”), “Seçilenlere bas” hepsinde aynı anda prop basmayı başlatır; “Seçilenleri durdur” çalışanları durdurur."],
        ["Daily Quiz", "Bütün hesapların quizi aynı anda kartlarda görünür; bilinen sorular otomatik cevaplanır, yeni soruyu sen cevaplarsın (8–9 sn içinde seçmezsen rastgele)."],
        ["Cheer", "Bir ya da birden çok hedef hesap ve Cheer atacak hesapları seçersin. Atan hesaplar hedeflere sırayla dağılır (biri ona, biri ona); her hedefe 2. yarı (3. periyot) başlayınca atılır, morali 200 olunca o hedef için durur. Bir hesap bir maçta bir kez, günde yaklaşık 3 kez Cheer atabilir."],
        ["Chat", "Mesaj listesini sırayla, her mesajı kendi hesabından, en az 11 sn arayla genel sohbete yazar; döngü sayısı ya da sonsuz."]
      ],
      rules: [
        "Bu modlar başlarken o hesaplardaki Auto Play durdurulur ve bitince yeniden başlatılır.",
        "Ücretli haklar, biletler, Go-up mağazası, çantadaki Cheer eşyası ve megafon asla kullanılmaz.",
        "Big 3 ve Daily Boss maçları günlük PK sınırından düşer.",
        "Quiz'de cevapladığın her yeni soru kalıcı olarak öğrenilir; fabrika ayarlarında bile silinmez.",
        "Chat mesajı en fazla 50 karakterdir; mesajlar arasında en az 11 saniye olmalıdır (oyunun sınırı).",
        "Prop, maç 3. ya da 4. periyottaysa basmaz (devre arası geçmiştir); 1. ya da 2. periyottaysa devre arasını bekler.",
        "Elite Ascent ve Prop hesaba giriş ister; o hesap oyunda açıksa oradan çıkış yapılır."
      ],
      tips: [
        "Chat sekmesindeki “Oyun sohbeti” genel sohbeti gösterir; kendi hesaplarının mesajları turuncu.",
        "Go-up kuyruğunda ve maçta geçen süre canlı gösterilir."
      ],
      problems: []
    },
    {
      id: "office", icon: "🏢", name: "Ofis",
      what: "Oyunun Ofis binasındaki iki sistem: Koç (strateji antrenmanı) ve Big Three (NBA takımlarının üçlüleri, Super Big 3). Bilet hiçbir zaman harcanmaz.",
      steps: [
        "“Durumu oku” ile bütün hesapların koçunu, Master kartlarını, günlük haklarını ve üçlülerini oku.",
        "İstediğin hesapta “Şimdi çalıştır” ile antrenmanı başlat ya da “Oto”yu işaretle; uygulama 10 dakikada bir aynı işi kendisi yapar."
      ],
      buttons: [
        ["Koçları incele", "8 koçun açıklaması, stratejileri, seviyeleri ve taktiklerin hangi taktiği yendiği. Koç yalnızca “Bu koçu seç” ve onayla seçilir; ilk koç ücretsiz, değiştirmek 1 Change Coach Card harcar."],
        ["Şimdi çalıştır (Koç)", "Biten antrenmanı alır; ücretsiz hak, Master kart ve eğitilecek strateji varsa 3 saatlik yeni antrenman başlatır."],
        ["Şimdi çalıştır (Big Three)", "Biten antrenmanı alır, hak varsa 3 saatlik yeni antrenman başlatır."],
        ["+Hücum / +Savunma", "Seviye atlayınca gelen bonus puanını harcar."],
        ["Aktifleştir / Kapat", "Big3 bonusunu maçlarda açar; Magic Team maçları için üçlü aktif olmalı."],
        ["Super Big 3", "Kadrondan 3 oyuncu seçip kendi üçlünü kurarsın. Üçlüyü değiştirmek bütün ilerlemesini sıfırlar (sorulur)."]
        ["Big 3 otomatik · Takımları tara / Aktifleştir", "Lig üçlüsü (Magic Team için uygun Big 3) olan hesapta onu, yoksa var olan Super Big 3'ü (bozmadan), o da yoksa ilk 5'in en iyi 3 oyuncusuyla yeni Super Big 3 kurup aktifleştirir. Yalnızca seçili ve hazır olmayan hesaplara uygulanır."],
        ["Big 3 otomatik · Antrenmanları otomatik yap", "Varsayılan açık. Uygulama açıkken, aktif Big 3'ü olan her hesapta süre bitince antrenmanı alır, bonus puanını verir ve günün 3 ücretsiz hakkından biri varsa yenisini başlatır; 10. seviyede durur, haklar bitince 19:10'u bekler. Başka işi durdurmaz."],
        ["Big 3 otomatik · Bonus", "Hesap başına Atak ya da Defans (varsayılan Atak). Değiştirince verilmiş puanlar ücretsiz sıfırlanıp yeni seçime aktarılır."],
      ],
      rules: [
        "Koçta günde 2 ücretsiz antrenman var; sonrakiler, yoğun antrenman ve erken bitirme bilet ister, uygulama bunları kullanmaz.",
        "Eğitilecek strateji yoksa Master kart harcanmaz.",
        "Big3 üçlüsü 15. seviyeden sonra Günlük İşler → Big 3 ödülüyle 20'ye kadar çalışabilir."
      ],
      tips: [], problems: []
    },
    {
      id: "autobuy", icon: "🛒", name: "Auto Buy",
      what: "İzleme listesindeki oyuncuları Trading Hall'da sürekli arar; koşulların hepsini sağlayan ilanı öncelik sırasındaki ilk uygun hesapla alır. Alınan oyuncu hemen 9.999.999 TIX ile pazara konur, gerçek fiyatı sonra sen verirsin.",
      steps: [
        "“Oyuncu ekle” ile (ya da Oyuncular sayfasından toplu) izlenecek oyuncuları ekle.",
        "Her oyuncu için Maaş ≤, Fiyat ≤ ve para birimini (APK / TIX) gir; kaç adet alınacağını seç (varsayılan sınırsız).",
        "Hesap önceliğini ayarla (1, 2, 3…).",
        "“Auto Buy Başlat”a bas.",
        "Alınan oyuncuları “Satın alınanlar” tablosundan istediğin fiyatla tekrar listele."
      ],
      buttons: [
        ["Maaş aralığı / Fiyat ≤ / APK-TIX", "Bir ilan ancak hepsini sağlarsa alınır (Fiyat ≤ 20 APK ise 21 APK alınmaz). Maaş aralığının alt sınırı boşsa 0 sayılır."],
        ["+ Maaş aralığı", "Aynı oyuncu için kendi fiyatı ve adedi olan yeni bir maaş aralığı ekler. Örnek: Jokic 0–2318 maaşla 40 APK'ya kadar, 2319–2347 maaşla 25 APK'ya kadar. Yeni aralık bir öncekinin bir üstünden başlar; istediğin kadar aralık eklenir. Çakışan aralık kırmızı uyarı verir. Oyuncu bir taramada bir kez aranır, ilan maaşının düştüğü aralığın fiyatıyla karşılaştırılır."],
        ["Adet", "Her oyuncudan kaç tane alınacağı; ↺ sayacı sıfırlar."],
        ["Hesap önceliği", "Bir hesabın parası bitince ya da oyuncu zaten o hesaptaysa sıradakine geçilir."],
        ["Fiyatı güncelle", "Alınan oyuncuyu pazardan çekip senin fiyatınla tekrar koyar."]
      ],
      rules: [
        "Auto Buy oyuna giriş yapmadan tarar, diğer otomasyonlarla aynı anda çalışabilir. Yalnızca oyuncu alırken ya da fiyat değiştirirken o hesaba girer.",
        "O sırada aynı hesabı kullanan Auto Play, Kule duraklatılır ve iş bitince yeniden başlatılır. Auto Trade o hesapta değilse yalnızca o hesap için bekler, çalışmaya devam eder.",
        "Listedeki en düşük fiyatı karşılayacak hesap kalmayınca Auto Buy kendini durdurur ve “bakiye yetersiz” der.",
        "Her aktif oyuncu için Maaş ≤ ve Fiyat ≤ girilmeden Auto Buy başlamaz."
      ],
      tips: ["Alınan oyuncu kadroda zaten varsa “Kadroda var çözümü” kendiliğinden kullanılır."],
      problems: []
    },
    {
      id: "tournament", icon: "🏆", name: "Turnuva",
      what: "Seçili hesapları seviyelerine uygun günün turnuvasına kaydeder. Bugünün kaydı kapandıysa yeni kaydın açılmasını bekler.",
      steps: ["Hesapları seç.", "“Turnuvalara Katıl”a bas.", "Son çalıştırma raporunda kimin kaydolduğuna ve olmayanların nedenine bak."],
      buttons: [["Turnuvalara Katıl", "Kaydı başlatır."], ["Listeyi Yenile", "Turnuva listesini yeniden okur."],
        ["Seviye kontrolü sekmesi", "Kayıtlı olduğu turnuvanın seviyesini geçen hesapları uyarıyla gösterir (turnuva başlayınca maçı 25-0 kaybederler). O turnuvaya uygun ve kayıtlı olmayan hesabımız varsa uygun olmayan çıkar, uygun olan hemen kaydolur; uygun hesap yetmezse fazlası kayıtlı kalır. “Kontrol et” yalnızca gösterir, “Kontrol et ve değiştir” ve otomatik kontrol (30 dakikada bir, varsayılan açık) değişimi de yapar."],
        ["Son çalıştırma raporu", "Tek satırlık bir tablo: Toplam hesap · Zaten hepsine kayıtlıydı · Kaydoldu · Turnuva dolu · Level yetersiz (hata ya da durdurma olduysa bir de Diğer). Sıfır olmayan bir sayıya tıklayınca o hesapların adları küçük bir pencerede açılır; boş bir yere tıklayınca ya da Kapat'a basınca kapanır."],
        ["Kaydolunan turnuvalar", "Raporun altında her turnuvanın adı ve kaç hesabın kaydolduğu yazar; sayıya tıklayınca hesaplar görünür."]],
      rules: [
        "Turnuva günleri: Pazartesi APK · Salı Materials · Çarşamba Stone · Perşembe Star · Cuma Exclusive · Cumartesi TK · Pazar Ticket; hepsi 15:00 (TR).",
        "Auto Play'deki günlük turnuva satırı açıksa kayıt her gün kendiliğinden yapılır."
      ],
      tips: ["Tablolarda turnuvanın adı yazar; seviye aralığı Lv sütunundadır."],
      problems: []
    },
    {
      id: "tktransfer", icon: "💸", name: "TK Aktarımı",
      what: "Yan hesaplardaki TK'yı ana hesaba taşır: Main, yan hesapların pazardaki APK ilanlarını alır, oyuncuları takasla geri verir (yan hesap maaş toplamı kadar TK öder), yan hesap da oyuncuları aynı fiyatla tekrar pazara koyar.",
      steps: [
        "Önce yan hesaplarda pazara APK ilanları aç (ilk ilanları sen açarsın).",
        "Ana hesabı ve yan hesapları seç.",
        "Minimum maaş (0–2500), maksimum APK (en az 20) ve aktarılacak TK'yı gir.",
        "“Başlat”a bas; rapordan aktarılan TK'yı izle."
      ],
      buttons: [["Başlat", "Hedef geçilince, APK bitince ya da uygun ilan kalmayınca kendisi durur."], ["Durdur", "Yarıda keser; o ana kadar aktarılan TK raporda görünür."]],
      rules: [
        "Yan hesaplar en yüksek TK'lıdan başlar; bir seferde bir yan hesaptan en fazla 5 oyuncu alınır.",
        "Sistem yalnızca kendi aldığı oyuncuları aynı fiyatla tekrar listeler.",
        "Ana hesapta zaten olan oyuncu ve aynı oyuncudan ikinci kopya alınmaz."
      ],
      tips: [], problems: []
    },
    {
      id: "apktransfer", icon: "🎟️", name: "APK / TIX Aktarımı",
      what: "Seçili hesapların APK'sını, TIX'ini ya da ikisini pazar üzerinden tek bir hesapta (main) toplar. TK Aktarımı sayfasının ikinci sekmesidir.",
      steps: [
        "TK / APK Aktarımı sayfasında “APK / TIX Aktarımı” sekmesini aç.",
        "Kullanılacak hesapları seç. Main seçili değilse “Aktarılacak hesap”tan APK'nın toplanacağı hesabı seç.",
        "Ne aktarılacağını seç (APK, TIX ya da ikisi), en az APK / TIX değerini ve main'in alacağı oyuncuların en yüksek maaşını (varsayılan 50 TK) gir.",
        "“Aktarımı başlat”a bas; canlı durumdan ve sonra rapordan takip et."
      ],
      buttons: [["Aktarımı başlat", "Seçili hesaplardaki Auto Play'i durdurur, aktarımı yapar, bitince yeniden başlatır."], ["Durdur", "Yarıda durdurur; o ana kadarki aktarımlar ve bakiyeler raporda görünür."], ["Scout yetmezse Harcayıcılardan takasla al", "Açıksa main'in Scout'u ve arkadaşlarının Scout'ları yetmediğinde Harcayıcılar sırayla açılır ve ucuz oyuncu verir."]],
      rules: [
        "Önce seçili bütün hesapların satışları toplanır (toplanan oyuncular raporun altındaki tabloda görünür), sonra bakiyeler okunur.",
        "En az değerin altında kalan ya da kadrosu dolu olan hesap uygun sayılmaz ve atlanır; seçim yaparken “şu anki bakiyelere göre uygun” sayısı görünür.",
        "Her uygun hesap için main'in bir ucuz oyuncusu, o hesabın bütün bakiyesi kadar fiyata pazara konur. Hangi hesabın hangi ilanı alacağı baştan bellidir; aynı bakiyeli hesaplar karışmaz.",
        "Ucuz oyuncular sırasıyla: main'in kendi Scout'u (Callback hiç kullanılmaz), main'in arkadaşlarının Scout'ları, sonra Harcayıcılar (kendi ve arkadaşlarının Scout'larından alıp main'e takasla verir).",
        "Main her oyuncuyu hemen listelediği için kadrosu hiç dolmaz; 20 hesaptan aktarım da yapılabilir. Main'de en az 1 boş yer olmalı.",
        "Bütün hesaplar kendi ilanlarını aynı anda alır; almadan önce ilanın main'e ait, doğru oyuncu ve doğru fiyat olduğu kontrol edilir. Sonra main satışları toplar.",
        "Oyun her satıştan max(3, %5) keser. Rapordaki “Main'e geçen” ve “Kesinti” oyunun bildirdiği gerçek rakamlardır; gönderilenlerin toplamı main'e geçenle aynı değildir.",
        "Kartlar sayfasında rolü olan oyuncular (Kart, Satılabilir, Stok…) bu iş için kullanılmaz.",
        "Alınan ucuz oyuncular alan hesapların kadrosunda kalır. Kimsenin almadığı ilan pazardan geri çekilir.",
        "Seçtiğin değerler bir dahaki sefere hatırlanır."
      ],
      tips: ["Rapor: üstte para birimi başına main'e geçen net miktar, gönderilen ve toplam kesinti; altında hesap başına önce → sonra bakiyeler, her aktarımın oyuncusu ve kaynağı, en altta baştaki satışlar."],
      problems: [["“Oyuncu bulunamadı”", "Scout'larda ve Harcayıcılarda maaş sınırının altında oyuncu kalmadı. Sınırı biraz yükselt ya da Scout'lar yenilenince tekrar dene."], ["“Main kadrosu dolu”", "Main'de en az 1 boş yer aç ve tekrar başlat."]]
    },
    {
      id: "scout", icon: "🔍", name: "Scout",
      what: "Hesapların Scout listesini gösterir: fiyat, rol ve kart durumu. İstediğin oyuncuyu buradan alabilirsin.",
      steps: ["Hesabı seç ve “Scout Aç”a bas.", "Listeyi incele; istediğin oyuncuda “Satın Al”a bas."],
      buttons: [["Scout Aç / Kapat", "Listeyi getirir ya da kapatır."], ["Call Back", "Listeyi yeniler (günde sınırlı hak)."], ["Satın Al", "Oyuncuyu hesaba alır."]],
      rules: [
        "Secret oyuncu: oyun yalnızca fiyatını gösterir. Fiyat, o günkü değeriyle tek bir oyuncuya denk gelir (1000 TK üstündeki değerlerin hepsi farklı); uygulama Secret'ı o oyuncu olarak tanır, rolüne göre alır ve kartta “Secret · fiyatından” yazar. Fiyat hiçbir oyuncuya denk gelmezse Auto Trade onu yine alır, oyun adını açıklayınca işe yaramıyorsa kovar. Secret'ta %5 maaş indirimi seviyeden bağımsız, şansa bağlı gelir (Lv16 bir hesapta görüldü); bu yüzden Secret'ı gören hesap, Stok olsa bile, seviyesi ne olursa olsun kendisi alır.",
        "Liste giriş yapmadan okunur. Satın Al ve Call Back için hesaba bağlanılır; hesap başka yerde açıksa oradan çıkar.",
        "Kartlar ve roller oyuncunun oyundaki kimliğiyle eşleşir, isim benzerliğinden etkilenmez.",
        "Sağ üstteki sayaç Scout'un kendiliğinden yenilenmesine kalan süreyi gösterir."
      ],
      tips: ["Auto Trade'in aldığı oyuncular burada “Alındı” görünür."],
      problems: []
    },
    {
      id: "players", icon: "📈", name: "Oyuncular",
      what: "Oyundaki bütün oyuncuların listesi: takım, rating, mevki, değer, Base ve günlük değer değişimi (yeşil artış, kırmızı düşüş).",
      steps: ["Filtrelerle aradığın oyuncuları süz.", "Gerekirse “Rol düzenle” ile rol ver (Kartlar ile ortaktır)."],
      buttons: [
        ["Filtreler", "İsim, takım, mevki, rol, rating ve Base'e yakınlık."],
        ["Rol düzenle", "Kart / Satılabilir / Stok gibi roller verir."],
        ["Yenile", "Listeyi hemen yeniden okur."]
        ,["Kadrolarım sekmesi", "Bütün hesapların ilk 5 ve bench oyuncularını tek listede gösterir. “Kadroları oku” oturum açmadan okur (oyun sekmelerine dokunmaz). Hesap, hesap rolü, İlk 5 / Bench, takım, mevki, rating, değer, Base, rol, sağlık ve tür (normal / X / geçici) ile süzülür."]
      ],
      rules: [
        "Değerler her gün 11:00'de değişir; liste 11:05'te (ya da oyun güncellemeyi bitirdiğini haber verince hemen) yenilenir. Gün içinde elle tarama o günün artış / düşüşlerini bozmaz.",
        "Turuncu BASE rozeti, değerin Base seviyesinde olduğunu gösterir. “Base'de / altında” bölümü Komuta Merkezi ile aynı kuralı kullanır."
      ],
      tips: ["Oyuncu adının yanındaki kırmızı + sakat, turuncu + kısa süreli sakat demektir; üzerine gelince dönüş tarihi görünür."],
      problems: []
    },
    {
      id: "valuepredict", icon: "🔮", name: "Değer Tahmini",
      what: "Oyuncuların bir sonraki değer değişimini NBA maçlarına göre tahmin eder. Oyun oyuncuları ofans + defans toplamına göre sıralar, değer de bu sıraya göre belirlenir.",
      steps: ["Sayfayı aç; tahmin kendiliğinden her 30 dakikada bir yenilenir.", "Hemen yenilemek için “Şimdi güncelle”ye bas.", "Değer değişince “Tahmin ve gerçek” ile tahminin ne kadar tuttuğuna bak."],
      buttons: [
        ["Şimdi güncelle", "Yeni biten NBA maçlarını okur ve tahmini yeniler."],
        ["Rol sütunu", "Kartlar'daki rolleri buradan da verirsin."],
        ["Tahmin ve gerçek", "Önceki tahmin ile gerçek değişim yan yana; ortalama sapma ve yön isabeti."]
      ],
      rules: [
        "Oyun bir oyuncunun değerini, oyuncu bu sezon 5 maç oynayınca değiştirmeye başlar; Maç sütunu oyuncunun kendi maç sayısıdır.",
        "Bir güncellemede yalnızca 11:00'dan önce biten maçlarda oynayan ve en az 5 maç oynamış oyuncular yeniden hesaplanır; diğerleri sıra kaymasıyla değişir.",
        "ESPN sakatlık listesinde “Out” olan oyuncunun henüz oynanmamış maçı oynamayacağı varsayılır.",
        "Bir güncellemede ofans / defans en fazla şu kadar değişir: S+ değerin %3'ü, S %4'ü, S- %5'i (en az 5); A+ 12, A 14, A- 16, B+ 18, B 20, B- 22, C+ 15, C 16, C- 18, D+ 20, D 22, D- 24.",
        "Formül her güncellemeden sonra yeniden öğrenilir, tahminler zamanla iyileşir. NBA verileri ESPN'in herkese açık verisinden alınır."
      ],
      tips: [], problems: []
    },
    {
      id: "draft", icon: "🎯", name: "Draft",
      what: "Canlı draft odalarını izler ve hangi hesabın hangi odaya girebileceğini gösterir; seçimi sen yaparsın. Havuzdaki her oyuncunun fiyatı, maaşı, Base'i, rolü ve kart durumu görünür.",
      steps: ["Uygun odada hesabın yanındaki “Katıl”a bas.", "Sıra sana gelince uygulama öne gelir; oyuncunu “… seçsin” ile seç (30 saniye içinde).", "Draft bitince alınan oyuncuları “Seçilileri listele” ile pazara koy."],
      buttons: [["Katıl", "Hesabı o odaya sokar."], ["… seçsin", "Sıra o hesaptayken oyuncuyu seçer."], ["Fiyat / Roller başlığı", "Havuzu fiyata ya da role göre sıralar."], ["Seçilileri listele", "Drafttan alınanları pazara koyar."], ["Kov / Tümünü kov", "Oyuncuyu (ya da o hesabın listedeki hepsini) oyunda kovar; önce sorulur."], ["Karta çevir / Seçilileri karta çevir", "Oyuncuları bir takas odasında ana hesaba verir (ana hesap karşılığında bir şey vermez), sonra ana hesapta yıldız kartına çevirir. Ana hesabın kendi draftı ise yalnızca karta çevrilir."]],
      rules: ["Odaya girince draft bitene kadar çıkılmaz; haklar draft bitince yeniden okunur.", "Pazara konan oyuncu listeden düşer.", "Kovulan ya da karta çevrilen oyuncu da listeden düşer. Auto Trade o an hesabı ya da ana hesabı kullanıyorsa Kov / Karta çevir beklemeden reddedilir; bitince tekrar dene."],
      tips: [], problems: []
    },
    {
      id: "cards", icon: "🃏", name: "Kartlar",
      what: "Ana hesabın Star Card'larını gösterir (takımlar, yıldızlar, kart sayıları) ve oyunculara rol verdiğin yerdir. Sentez ve Aktive et sekmeleri de buradadır.",
      steps: [
        "“Yenile” ile ana hesabın kartlarını tara.",
        "Oyuncu Listesi sekmesinde oyuncuları seç, “Toplu Rol” ya da satırdaki rol düğmesiyle Kart / Satılabilir / Stok ver.",
        "Listenin altındaki “Listede olmayan ama rolü olan oyuncular” tablosu varsa kontrol et; gereksiz rolleri kaldır.",
        "Sentez ya da Aktive et sekmesinde seviyeleri seçip başlat."
      ],
      buttons: [
        ["Yenile", "Kartları yeniden tarar; takımı değişen oyuncu yeni takımına taşınır."],
        ["Rol Ekle / Toplu Rol", "Rol oluşturur, seçili oyunculara toplu rol verir."],
        ["Kart Verisini Sıfırla", "Taranan kart verisini siler (roller kalır)."],
        ["Listede olmayan ama rolü olan oyuncular", "Son taramada görünmeyen (kartı kalmamış ya da eski kayıt) ama hâlâ rolü olan oyuncular. Auto Trade bu oyunculara rollerine göre davranır. Rolün yanındaki × o rolü, “Rolleri kaldır” hepsini siler. Böyle oyuncu yoksa tablo görünmez."],
        ["Sentez · Takımlı", "Aynı oyuncudan aynı seviyede 4 kartı bir üst seviyeye birleştirir."],
        ["Sentez · Takımsız (No Team)", "En çok kartı olan 4 farklı No Team oyuncudan birer kart kullanır; başarılıysa rastgele bir üst seviye kart gelir."],
        ["5★ oyuncuların kartlarını takımsız say", "Açıkken (varsayılan kapalı) 5★ aktifleştirilmiş oyuncuların 1–4★ kartları da Takımsız birleştirmede kullanılır; bu kartların o oyuncuya artık faydası yoktur. Yıldızlar son Kartlar taramasından okunur."],
        ["ⓘ (5★ ayarı)", "Üzerine gelince ya da tıklayınca bu ayarla dahil edilen oyuncuları gösterir: isim, takım ve aktif yıldız seviyesi."],
        ["Sentez · Seviyeler", "1★→2★ … 4★→5★; işaretlenmeyen seviyeler denenmez."],
        ["Aktive et", "Kartları oyuncu oyuncu, seçtiğin yıldızlarda en yüksekten başlayarak aktif eder (oyunun “hepsini aktif et” düğmesi kullanılmaz)."]
      ],
      rules: [
        "Auto Trade rolleri ve takımları buradan okur.",
        "Oyuncu takımları yalnızca oyundan gelir; elle takım verilmez.",
        "Sentez X oyunculara asla dokunmaz. Başarısız sentezde kartlardan biri aynı seviyede geri verilir; sonuç kart envanterine bakılarak belirlenir.",
        "Aktive et: oyun bir oyuncuyu her zaman elindeki en yüksek kartla aktif eder; en yüksek kartı seçmediğin bir yıldızdaysa o oyuncu atlanır."
      ],
      tips: ["Sentez özetinde yeşil sayı başarılı, kırmızı sayı başarısız denemelerdir."],
      problems: [["Auto Trade listede olmayan bir oyuncuyu alıyor", "“Listede olmayan ama rolü olan oyuncular” tablosunda o oyuncunun rolünü kaldır."]]
    },
    {
      id: "bag", icon: "🎒", name: "Çanta",
      what: "Eşya kullanma sayfası; şimdilik X2 EXP. Her hesabın X2 EXP eşyalarının adedini, aktif olanın kalan süresini gösterir ve eşyayı tek tek ya da toplu kullanır.",
      steps: ["“Çantaları oku” ile bütün hesapların X2 EXP adetlerini oku (giriş yapılmaz).","Satırdaki “Kullan” ya da soldan hesapları seçip “Seçilenlere kullan”."],
      buttons: [
        ["Kullan","O hesapta bir X2 EXP eşyası kullanır (birden çok çeşit varsa en kısa süreli olan)."],
        ["Seçilenlere kullan","Seçili hesapların hepsinde aynı anda birer tane kullanır. Zaten aktif olan varsa önce sorulur."],
        ["Süreyi oku","Oyunda elle kullanılmış bir eşyanın kalan süresini okur; hesaba kısa bir giriş yapılır."]
      ],
      rules: ["Uygulamanın kullandığı eşyaların bitiş saati saklanır, kalan süre giriş yapmadan görünür.","Okuma ve kullanma bütün hesaplarda aynı anda yapılır (141 hesabın çantası ~2–3 saniyede okunur). Tarayıcı açılmadığı için RAM harcamaz; PVP, Go-up, Boss, Ofis, Kadrolar, Pazar, Cheer ve Slot da artık böyle çalışır."],
      tips: [], problems: []
    },
    {
      id: "equipment", icon: "🧤", name: "Ekipman",
      what: "Seçtiğin hesabın çantasındaki ekipman ve malzemeleri gösterir; Convert, Craft, Enchant, Enhance, Refine, Koleksiyon ve Yetenekler işlerini oyunu açmadan yapar.",
      steps: ["Hesabı seç ve “Tara”ya bas.", "Sekmeden işlemi seç, parçayı ve adedi seç, uygula.", "İş bitince “Kapat” ile hesabın oturumunu kapat."],
      buttons: [
        ["Convert / Craft / Enchant / Enhance / Refine", "Oyundaki aynı işlemler. Convert ve Craft bir seferde en fazla 100 adet yapar."],
        ["Hazırla (koleksiyon)", "Setin eksik parçalarını üretir, gereken + seviyesine yükseltir ve sete teslim eder. Birden çok set ve hesap aynı anda yapılabilir."],
        ["Bir parçaya tıklamak (koleksiyon)", "Yalnızca o parçayı hazırlar ve teslim eder."],
        ["Yetenekler", "11 konteynerin yeteneklerini gösterir; konteyner oyuncuya atanır, yetenek kilitlenir, günde 2 ücretsiz shuffle yapılır."]
      ],
      rules: [
        "Koleksiyon parçayı yalnızca tam istenen + seviyesinde kabul eder.",
        "Basma sırasında Refine Stone biterse işlem durur ve “Son basma raporu” çıkar.",
        "Bilet isteyen shuffle ve slot açma hiç kullanılmaz.",
        "Ekipman işleri hesaba giriş ister; o hesap oyunda açıksa oradan çıkar."
      ],
      tips: ["Güçlendirmenin başarısız olması oyunun normal şansıdır, hata değildir."],
      problems: []
    },
    {
      id: "market", icon: "🏪", name: "Pazar",
      what: "Hesapların pazardaki ilanlarını tarar, satılanların parasını toplar ve süresi dolan oyuncuları yeniden listeler.",
      steps: ["Hesapları seçip “Seçilileri Tara”ya bas.", "“Sadece satışı olanları topla” ile parası olan hesaplara girip satışları topla.", "Süresi dolanları “Expired oyuncuları getir”, ardından fiyat verip “Seçilileri listele” ile tekrar koy."],
      buttons: [
        ["Seçilileri Tara", "İlanları okur."],
        ["Seçililerin Satışlarını Topla / Sadece satışı olanları topla", "Satışların parasını toplar."],
        ["Expired oyuncuları getir / Seçilileri listele", "Süresi dolanları yeni fiyatla tekrar pazara koyar; “Öner” en ucuz rakip ilana göre fiyat önerir."],
        ["Aynı anda hesap", "Tarama ve toplamada aynı anda kaç hesabın çalışacağı; zamanlanmış toplama da bunu kullanır."],
        ["Pazardan çıkar / Çıkar ve kov", "Seçili ilanları kadroya geri alır; “Çıkar ve kov” önce sorar, sonra pazardan çıkarıp takımdan kovar (geri alınamaz)."],
        ["Grup satırı", "Gruplanmış hesapların satırında grubun toplamları görünür: İlanda, Satıldı, Süresi doldu, en son tarama saati. Hatalı hesap varsa “1/10 Hata” yazar (10 hesaptan 1'inde hata; üzerine gelince nedeni görünür). Tara grubun bütün hesaplarını tarar, Topla satışı olanların satışlarını toplar."]
      ],
      rules: [
        "Her satış, iptal ve toplamadan önce oyunun pazar bekleme süresi sorulur ve tam o kadar beklenir.",
        "“Kadroda var” ilanları da listelenebilir; uygulama Kadroda var çözümünü dener.",
        "Pazardan çıkıp tekrar listelenemeyen oyuncu işaretlenir ve kadroda kalır."
      ],
      tips: ["Tablolarda Değer, Maaş ve Base birlikte; maaş Base'in altındaysa BASE rozeti çıkar."],
      problems: []
    },
    {
      id: "trade", icon: "🏛️", name: "Trading Hall",
      what: "Oyunun Trading Hall ilanlarını tarar ve fiyat, maaş, Base, değer ve değer değişimine göre süzmeni sağlar. Buradan oyuncu alabilir ve karta çevirebilirsin.",
      steps: ["“Refresh Trading Hall” ile tara.", "Filtrelerle ya da hazır filtrelerle süz.", "İstediğin ilanda “Satın Al ▾”dan hesabı seç ya da soldaki kutularla birden çok ilan seçip “Hepsini al” / “Hepsini al ve karta çevir” de.", "Alınanları “Satın alınanlar”dan fiyat verip pazara koy ya da (Main ile alındıysa) karta çevir."],
      buttons: [
        ["Refresh Trading Hall / Stop at price", "Baştan tarar; belirtilen fiyata gelince durur."],
        ["Hazır filtreler ve filtre grupları", "Oyuncu, Maaş, Fiyat, Base ve Auto Buy başlıkları; Sıfırla hepsini temizler."],
        ["Satın Al ▾", "Hesaplar ilanın para birimine göre çoktan aza sıralanır; parası yetmeyen soluk görünür."],
        ["Satın alınanlar", "Fiyat ve para birimi verip listele; pazardaysa fiyatı güncellenir. Hepsini temizle, listedeki kayıtları siler (oyunculara dokunmaz)."],
        ["Hepsini al / Hepsini al ve karta çevir", "Yalnızca seçili ilanlar için çalışır (seçim yokken görünmez). Basınca alacak hesabı seçersin; her hesabın kaç ilana yettiği yazar. İlanlar sırayla tek tek alınır; hesabın APK / TIX'i bir ilana yetmeyince orada durur. Karta çevir seçeneğinde her oyuncu alındıktan 1 saniye sonra yıldız karta çevrilir, sonra sıradaki alınır; oyun \"bekle\" derse söylediği süre kadar bekleyip yeniden dener. Durdur ile yarıda kesebilirsin."],
        ["Karta çevir", "Yalnızca Main ile alınanlarda; maaşı değerinin çok altındaysa ya da Base oyuncuysa önce uyarır."],
        ["Auto Buy etiketleri", "Şartı karşılayanlar, İzleniyor · maaş eşleşti, İzleniyor, İzlenmeyenler."]
      ],
      rules: ["İki alım arasında birkaç saniye beklenir; oyun çok hızlı alımı yasak sayar.", "Base only, oyundaki “Base only” ile aynı ilanları gösterir."],
      tips: [], problems: []
    },
    {
      id: "owned", icon: "♻️", name: "Kadroda var çözümü",
      what: "Oyun, kadroda zaten olan bir oyuncuyu satın aldırmaz, Scout'tan aldırmaz ve pazardan geri çektirmez. Uygulama bu durumda kadrodaki kopyayı geçici olarak pazara park eder, işi yapar, sonra asıl oyuncuyu her şeyiyle geri getirir. Auto Buy, tekrar listeleme ve Auto Trade bunu kendiliğinden kullanır.",
      steps: [],
      buttons: [
        ["1 · Hazırlık", "Kopyanın ekipmanı, skill'i ve ilk 5 dizilişi not edilir; ekipman ve skill çıkarılır, oyuncu 9.999.999 TIX ile pazara park edilir."],
        ["5 kişilik kadro", "Kadro 4'e düşemediği için önce hesabın pazarından bir ilan geri çekilir."],
        ["2 · Asıl iş", "Oyuncu alınır, Scout'tan imzalanır ya da yeni fiyatla listelenir."],
        ["3 · Geri yükleme", "Asıl oyuncu pazardan geri alınır, aynı ekipman ve skill takılır, ilk 5 eski yerine dizilir; geri çekilen ilan eski fiyatıyla tekrar listelenir."]
      ],
      rules: ["Hesabın pazarında hiç ilan yoksa ve kadro 5 kişiyse: Scout oyuncuyu atlar, Auto Buy diğer hesapları dener.", "Her adım Aktivite'ye yazılır; bir parça takılamazsa hangisi olduğu belirtilir."],
      tips: [], problems: []
    },
    {
      id: "activity", icon: "📜", name: "Aktivite (Loglar)",
      what: "Uygulamanın yaptığı her şeyin kaydı: başarılı işler, uyarılar ve hatalar. Bir şey ters gittiğinde ilk bakılacak yer.",
      steps: ["Hesap, Servis ve Tür filtreleriyle istediğin kayıtları süz.", "Eski günler için gün seçimini ya da bütün günlerde aramayı kullan."],
      buttons: [
        ["Hesap / Servis / Tür filtreleri", "Yalnızca istediğin kayıtları gösterir."],
        ["Gün seçimi ve arama", "Eski günleri açar ve bütün günlerde arar."],
        ["Hata raporu kaydet", "Son günlerin uyarı ve hatalarını bir dosyaya kaydeder (şifre içermez)."],
        ["Kayıt klasörü", "Günlük kayıt dosyalarının klasörünü açar."]
      ],
      rules: [
        "Her gün ayrı bir dosyada 30 gün saklanır.",
        "Bir servisin bağlantısı, hesap başka yerde açıldığı için düşerse hangi servisin düştüğü ve hesabı kimin aldığı yazar.",
        "İki servis aynı hesabı birbirinden alıp durursa bekleme giderek uzar; 10 dakikada 5 kezden sonra servis yeniden bağlanmayı bırakır."
      ],
      tips: ["PVP çalıştıysa en üstte hesap hesap sonuç tablosu görünür."],
      problems: []
    },
    {
      id: "settings", icon: "⚙️", name: "Ayarlar",
      what: "Dil, görünüm, menü düzeni, uygulama davranışı ve fabrika ayarları.",
      steps: [],
      buttons: [
        ["Dil", "Türkçe, İngilizce, Filipince ya da sistem diline göre otomatik."],
        ["Görünüm", "Koyu ya da Açık mod; hemen uygulanır ve hatırlanır."],
        ["Menü düzeni", "Sol menüdeki listelerin adını, sırasını ve sayfaların yerini değiştirir; “Varsayılana dön” eski haline getirir."],
        ["Uygulama davranışı", "Pencere kapatılınca tepside çalışmaya devam etme ve Windows açılınca başlama."],
        ["Fabrika ayarları", "Uygulamayı ilk haline döndürür; “Kayıtlı şifreleri koru” işaretliyse hesaplar silinmez. Quiz'in öğrendiği cevaplar her zaman korunur."]
      ],
      rules: [], tips: [], problems: []
    },
    {
      id: "troubleshoot", icon: "🛟", name: "Sorun giderme",
      what: "Sık karşılaşılan durumlar ve ne yapman gerektiği.",
      steps: [],
      buttons: [],
      rules: [],
      tips: ["Çözemediğin bir sorunda Aktivite → “Hata raporu kaydet” ile dosya oluştur; sorunun ne zaman olduğunu da not et."],
      problems: [
        ["Ekran beyaza döndü ama işler sürüyor", "Pencere (arayüz) çökmüştür, otomasyonlar arka planda çalışmaya devam eder. Uygulama artık pencereyi kendiliğinden yeniden yükler. Yüklemezse uygulamayı kapatıp aç."],
        ["Üstte sarı şerit var", "Oyuna bağlanılamıyor. Hiçbir şey yapma; oyun gelince her şey kendiliğinden devam eder."],
        ["Hesap oyundan atılıyor", "Aynı hesapta giriş isteyen bir iş çalışıyordur (Scout'tan alım, Ekipman, Elite Ascent…). Okuma işleri hesabı atmaz; giriş isteyen işler biter bitmez hesabı kullanabilirsin."],
        ["Bir otomasyon “başka bir sistem bu hesabı kullanıyor” diyor", "Önce o hesapta çalışan işi durdur ya da “Durdur ve başlat”ı seç; işi bitince durdurulan sistem kendiliğinden yeniden başlar."],
        ["Bir şey yanlış rolle alınıyor", "Kartlar → Oyuncu Listesi'nden oyuncunun rolünü kontrol et; listede yoksa altındaki “Listede olmayan ama rolü olan oyuncular” tablosuna bak."],
        ["Bir değişiklik görünmüyor", "Uygulamayı tamamen kapatıp yeniden aç."]
      ]
    }
  ]
};
