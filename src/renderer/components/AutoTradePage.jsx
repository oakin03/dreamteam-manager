import { useEffect, useMemo, useRef, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import RatingBadge from './RatingBadge';
import InjuryMark from './InjuryMark';
import { roleDefs, roleOf, RolePill } from './AccountRoles';
import { GroupedPicks, useGroupedRows, groupRowOf } from './AccountGroups';
import { BoughtList } from './BuyParts';

const api = window.dreamteam;

const TEXT = {
  tr: {
    title: 'Auto Trade', subtitle: 'Scout · karta çevirme · Main ↔ Side takasları',
    tabs: { run: 'Auto Trade', pricing: 'Otomatik Fiyatlandırma' },
    pr: {
      intro: 'Harcayıcılar Satılabilir ve Stok oyuncuları buradaki fiyatlarla pazara koyar. Fiyat girmediğin oyuncu, türünün varsayılan fiyatıyla listelenir. Değişiklikler hemen kaydedilir; Auto Trade çalışırken de geçerlidir.',
      defaults: 'Varsayılan fiyatlar', sellable: 'Satılabilir', stok: 'Stok',
      price: 'Fiyat', discPrice: '%5 indirimli alınırsa', fireNoDisc: 'İndirimsizse kov', fireYes: 'Evet, kov', fireNoDiscHint: '%5 indirimle alınmadıysa harcayıcı bu oyuncuyu pazara koymaz, kovar (geri alınamaz)', fireNoDiscAsk: '{name} %5 indirimle alınmadığında pazara konmayacak, kovulacak (oyundaki FIRE, geri alınamaz). Emin misin?', lv30: 'Sadece Lv30+', always: 'her zaman',
      value: 'Değer', valueDisc: '%5 düşük', base: 'Base', role: 'Rol', player: 'Oyuncu',
      search: 'Oyuncu ara…', fAll: 'Tümü', fMissing: 'Fiyatı girilmemiş', fSellable: 'Satılabilir', fStok: 'Stok', fLv30: 'Lv30+ işaretli',
      missing: '{n} oyuncunun fiyatı girilmemiş · varsayılan fiyatla listelenir', allSet: 'Bütün oyuncuların fiyatı girilmiş',
      noPrice: 'fiyat yok', noDiscPrice: 'indirimli fiyat yok', addPlayer: 'Listeye oyuncu ekle…', chooseRole: 'Rol seç', chooseRoleText: '{name} hangi rolle bu listeye girsin? Rolsüz oyuncular bu listede olamaz.', select: 'Seç', removeRole: 'Bu rolü kaldır (oyuncu listeden çıkar)', addRole: '+ rol', firedShort: 'indirimsizse kovulur', firedNoPrice: 'İndirimsizse kov seçili: indirimsiz alınırsa kovulacağı için normal fiyat kullanılmaz', useDefault: 'varsayılan: {p}', sameAsPrice: 'boş: normal fiyat',
      none: 'Satılabilir ya da Stok rolü verilmiş oyuncu yok. Rolleri Kartlar → Oyuncu Listesi\'nden verebilirsin.',
      saved: 'Kaydedildi', clear: 'Temizle',
      hint: '%5 indirimli fiyat: oyuncu Lv30+ bir hesapla %5 indirimle alındıysa (Base olsun olmasın) bu fiyat kullanılır; boş bırakırsan normal fiyat. Sadece Lv30+: bu Satılabilir oyuncuyu Stok gibi yalnız Lv30+ hesaplar alır (gerekirse geçici arkadaşlıkla).',
      banner: '{n} Satılabilir / Stok oyuncunun fiyatı girilmemiş; varsayılan fiyatla listelenecek.', bannerBtn: 'Fiyatları gir'
    },
    spenderPricesMoved: 'Harcayıcı satış fiyatları artık “Otomatik Fiyatlandırma” sekmesinde (oyuncu başına).',
    start: 'Başlat', pause: 'Duraklat', resume: 'Devam ettir', stop: 'Durdur', cont: 'Kaldığı yerden devam et', reset: 'İlerlemeyi sıfırla',
    resetConfirm: 'Kayıtlı ilerleme silinecek ve Auto Trade sıfırdan başlayacak. Emin misin?', yes: 'Evet, sıfırla', cancel: 'Vazgeç', close: 'Kapat',
    status: { awaitingRole: 'Seçimini bekliyor', idle: 'Hazır', waitingGame: 'Oyun bekleniyor · gelince devam edecek', running: 'Çalışıyor', paused: 'Duraklatıldı', stopping: 'Durduruluyor', stopped: 'Durduruldu', error: 'Hata · senin müdahalen gerekiyor', done: 'Tamamlandı', awaitingListing: 'Pazar listesi bekleniyor' },
    accounts: 'Hesaplar', selectAll: 'Tümünü seç', extraTargets: 'Ek hedefler', extraTargetsHint: 'Seçilen ek hedeflerin her biri kendi ana hesabıyla ayrı bir Auto Trade çalıştırır: seçili hesaplar ve Harcayıcılar rollerine göre hedeflere eşit bölünür; biri biterse ya da hata verirse diğerleri devam eder. Hazırlık yalnızca ilk hedefte yapılır.', extraRuns: 'Diğer hedefler', extraTotals: '{accounts} hesap · {bought} alınan · {converted} kart · {trades} takas', mainBadge: 'Main', actingMain: 'Bu çalıştırmada Main gibi davranacak hesap', actingMainHint: 'Asıl Main seçili değil. Seçim sadece bu çalıştırma için; asıl Main değişmez.',
    routing: 'Roller', sideToMain: 'Side → Main', mainToSide: 'Main → Side', sideToMainNote: 'Side → Main yönündeki roller Main\'e geçer ve Main\'de karta çevrilir.', mainToSideNote: 'Main → Side yönündeki roller Side hesaplarda kalır; sonunda pazara listeleyebilirsin.',
    roleRules: 'Hesap rollerine göre kurallar', roleRulesHint: 'Main hariç her hesap rolünün Scout\'tan ne imzalayacağı. Satılabilir: Satılabilir rollü oyuncular; Kart: Kart rollü oyuncular; Ucuz: fiyat sınırının altındakiler. Fiyat boşsa genel sınır geçerli. Sayı, o roldeki seçili hesap sayısı. Harcayıcı satırı da geçerlidir: orada kapalı olan oyuncuyu Harcayıcılar ne Scout\'tan alır ne takasla kabul eder.', rrRole: 'Rol', rrCheap: 'Ucuz', rrPrice: 'Fiyat sınırı', rrUnused: 'Bu rol yukarıdaki yön seçimlerinde yok, oyuncu yönlendirmiyor',
    maxPrice: 'Maksimum fiyat (Scout Price)', maxPriceHint: 'Bu fiyat ve altındaki oyuncular rolüne bakılmadan Main\'e gider ve karta çevrilir. 0–2500; 50\'nin altı = sadece roller.',
    room: 'Trade odası', roomDesc: 'Oda adı', roomPass: 'Oda şifresi', roomPassSaved: 'kayıtlı', showPass: 'Şifreyi göster', hidePass: 'Şifreyi gizle',
    loop: 'Döngü', loopOff: 'Tek tur', loopCount: 'Belirli sayıda', loopInfinite: 'Sonsuz', loopTimes: 'tur', loopHint: 'Döngüde her hesaba Scout\'u yenilendiğinde (30 dk) tekrar girilir.',
    synthAfter: 'Bitince kart sentezini başlat', synthAfterHint: 'Auto Trade hangi sebeple biterse bitsin (tur sonu, Durdur, TK bitmesi, hata) Kartlar → Sentez bölümündeki "İkisini de yap" çalışır: önce takımsız, sonra takımlı, Sentez sayfasında seçili seviyelerle.',
    useCallbackItems: 'Callback eşyalarını kullan', useCallbackItemsHint: 'Scout’un günlük ücretsiz yenileme hakkı bitince hesap çantasındaki Callback eşyasıyla Scout yenilenir (hesap başına bir turda en çok 5 eşya). Eşyası olmayan hesap normal şekilde devam eder.',
    keepAutoPlay: "Auto Play'i durdurma", keepAutoPlayHint: "Auto Play bu hesaplarda çalışmaya devam eder (soket modunda Auto Trade ile çakışmaz; yalnızca tarayıcı moduna düşmüş hesaplar kısa süre durdurulur). Maaş sınırı aşılırsa Auto Play durmaz: Auto Trade o hesapta oyuncu listeleyince, takas edince, kovunca ya da karta çevirince hemen, olmazsa 2 dakikada bir tekrar dener; 10 denemede (yaklaşık 20 dakika) açılmazsa eskisi gibi durur ve uyarır.",
    sideOnly: 'Sadece Satılabilir ve Stok oyuncuları al', sideOnlyHint: 'Kart ve fiyat sınırının altındaki ucuz oyuncular alınmaz; yalnızca Satılabilir ve Stok alınır. Main kendi sırasında tarar, harcayıcılara verip kapanır; sonra 10 hesap main olmadan aynı anda çalışır, her biri ayrı bir harcayıcıya verir, harcayıcı hemen pazara koyar.',
    baseAsSellable: 'Base oyuncuları satılabilir olarak değerlendir', baseAsSellableHint: 'Alımda gelen gerçek maaşı (Lv30+ hesaplarda %5 indirim olabilir) Base değerinde ya da altında olan, Kartlar sisteminde bir takımdaki oyuncular Satılabilir sayılır ve karta çevrilmez. No Team ve Kartlar\'da olmayan oyuncular etkilenmez.',
    howTitle: 'Nasıl çalışır?',
    how: [
      'Başlamadan önce seçili hesapların kadrosu ve TK\'sı giriş yapmadan okunur. Başka bir sistem (Auto Play, Scout, Ekipman, Pazar, Turnuva, Zamanlayıcı) bu hesapları kullanıyorsa uyarılırsın.',
      'Başlangıç beşine asla dokunulmaz; sadece bench oyuncuları kullanılır. Kadro 5 + 6 = 11; bir takasta her taraf en fazla 5 oyuncu verir.',
      'Bench\'inde önceden oyuncu olan hesaplar için her oyuncuya ayrı karar verirsin: pazarda listele, trade\'e dahil et ya da hiçbir şey yapma. Ekipmanlı, X ve süreli oyuncular hiç taşınmaz.',
      'Önce Main Scout\'a girer, uygun tüm oyuncuları alır (Side → Main rolleri, Main → Side rolleri ve fiyatı sınırın altındakiler). Bench dolunca karta çevrilecekleri Make ile çevirir; çevrilecek yoksa Side\'a gidecekleri en yüksek TK\'lı Side\'a verir. Call back hakkı ve alınacak oyuncu bitene kadar devam eder.',
      'Sonra Side hesaplar en yüksek TK\'dan en düşüğe açılır. Odayı her zaman Side kurar, Main şifreyle katılır. Tek takasta iki yön birden gider: Main Side\'a gidecekleri verir, Side Main\'e gidecekleri verir. TK farkı oyuncu maaşları arasındaki farktır.',
      'Side de Scout\'tan alır; Main\'e gidecekleri 5\'er 5\'er verir, Main bunları hemen karta çevirir. Side\'ın kadrosu kalacak oyuncularla dolarsa hangi oyuncuların pazara konacağı sorulur.',
      'Bir Side\'ın TK\'sı yetmezse o hesap atlanır. Main\'in TK\'sı yetmezse ya da bir oyuncu karşı hesapta zaten varsa ve çözülemiyorsa sistem durur; düzeltip "Kaldığı yerden devam et" ile sürdürürsün.',
      'Tüm Side\'lar bitince (döngüde her turun sonunda) Main hesabında Kartlar sayfasındaki kart taraması otomatik yapılır.',
      'Bitince her Side\'da kalan oyuncuları fiyat ve para birimi seçip pazara koyabilirsin (Satılabilir 20 APK, Stok 99999 TIX varsayılan).'
    ],
    preTitle: 'Başlamadan önce', checking: 'Hesaplar kontrol ediliyor…', conflictsTitle: 'Bu hesaplar başka bir sistemde kullanılıyor',
    conflict: { autoplay: 'Auto Play çalışıyor', scout: 'Scout açık', equipment: 'Ekipman açık', market: 'Pazar işlemi sürüyor', tournament: 'Turnuva kaydı sürüyor', schedule: 'Zamanlayıcıda bekleyen görev' },
    stopAndStart: 'Durdur ve başlat', benchTitle: 'Bench\'te önceden oyuncu olan hesaplar', benchHint: 'Her oyuncu için seç: sadece "Trade\'e dahil et" seçilenler (ve rolü/fiyatı uyanlar) kullanılır.',
    starting: 'Başlatılıyor · önce seçili hesaplardaki Auto Play durduruluyor…', actList: 'Pazarda listele', actTrade: 'Trade\'e dahil et', actCard: 'Karta çevir', actFire: 'Kov', actNone: 'Hiçbir şey yapma', bulkAll: 'Tümüne:', bulkAcc: 'Bu hesaptakilere:', bulkHint: 'Yalnızca seçimleri işaretler; hiçbir şey yapılmaz. Listeyi kontrol edip alttaki düğmeyle onaylarsın. Bir oyuncuya uymayan seçim (ör. sadece kovulabilen oyuncuya karta çevir) o oyuncuyu değiştirmez.', bulkList: 'Tümünü pazara koy', bulkTrade: "Tümünü trade'e dahil et", bulkCard: 'Tümünü karta çevir', bulkFire: 'Tümünü kov', bulkNone: 'Tümünü sıfırla', fireTitle: 'Oyuncular kovulacak', fireAsk: 'Bu oyuncular takımdan kovulacak (oyundaki FIRE). Bu işlem geri alınamaz. Emin misin?', fireYes: 'Evet, kov ve başlat', fireYesPrep: 'Evet, kov ve hazırla', cardHint: 'Rolüne bakılmadan Main\'e aktarılır ve karta çevrilir', blocked: { equipped: 'Ekipmanlı · taşınamaz', x: 'X oyuncu · taşınamaz', temporary: 'Süreli · taşınamaz', starter: 'Başlangıç beşi' },
    fitsMain: 'Main\'e gider', fitsSide: 'Side\'da kalır', fitsNone: 'Rol/fiyat uymuyor',
    noBench: 'Hiçbir hesabın bench\'inde oyuncu yok.', startNow: 'Başlat',
    live: 'Canlı durum', liveHidden: 'gizli · açmak için tıkla', openTime: 'açık', visits: 'giriş', tk: 'TK', noPlayers: 'Henüz oyuncu yok',
    player: 'Oyuncu', salary: 'Maaş', value: 'Değer', base: 'Base', listPrice: 'Satış fiyatı',
    spenderListTitle: 'Harcayıcı pazar listesi', spenderListHint: 'Harcayıcıların yer açmak için pazara koyduğu oyuncular. Fiyatı ve para birimini seç, Fiyatı güncelle de: oyuncu çekilip yeni fiyatla tekrar konur.',
    friendBoards: 'Arkadaş Scout\'larını kullan (Harcayıcı ağı)', friendBoardsHint: 'Main ve side\'lar kendi Scout\'larından sonra arkadaşlarının Scout\'larına da bakar: Kart / ucuz oyuncuları Main alır (arkadaşıysa), Satılabilir / Stok oyuncuları TK\'sı yeten bir Harcayıcı alır (Stok\'u önce Lv30+ hesaplar, %5 maaş indirimi şansı). Harcayıcı alamazsa (günlük sınır, TK yok) Main ya da side alır ve takasla Harcayıcıya verir; o da olmazsa side tutar. Arkadaşlıkları Auto Trade kurar; Main\'in listesine dokunulmaz.', spenderSellPrice: 'Harcayıcı · Satılabilir varsayılan fiyatı', spenderStockPrice: 'Harcayıcı · Stok varsayılan fiyatı', spenderPriceHint: 'Harcayıcının kadrosu dolunca ya da aynı oyuncu gelince yedeklerinden biri pazara konur: Stok oyuncu Stok fiyatıyla, diğerleri Satılabilir fiyatıyla. Sonra Harcayıcı pazar listesinden değiştirebilirsin.', spendersPerSide: 'Hesap başına Harcayıcı arkadaş', spendersPerSideHint: 'Her hesabın kaç Harcayıcıyla arkadaş olacağı. Biri TK bitirince diğeri alır. Değiştirince ağ bir sonraki turda (ya da Arkadaş ağını şimdi kur ile) yeniden kurulur.', spenderMinTk: 'Harcayıcı TK tabanı', spenderMinTkHint: 'Alımdan sonra bu TK\'nın altına düşecek Harcayıcı kullanılmaz, sıradakine geçilir.', friendSync: 'Arkadaş ağını şimdi kur', friendSyncing: 'Kuruluyor…', friendSyncDone: 'Arkadaş ağı: {done}/{total} yeni arkadaşlık · {removed} eski kaldırıldı', friendSyncSkipped: 'Arkadaş ağı güncel (ya da Harcayıcı yok)',
    baseProjected: 'Ertesi günün Base değerini kullan (Base × 0,95)', baseProjectedHint: 'Base her gün yeniden hesaplanır ve indirimli alımlar onu ~%5 düşürür. Açıkken maaş yarınki Base ile karşılaştırılır: Base 50 iken 50 maaşlı oyuncu Base sayılmaz, 48 maaşlı sayılır.',
    price: 'Fiyat', role: 'Rol', stateCol: 'Durum', from: 'Nereden',
    pstatus: { bought: 'Alındı', existing: 'Önceden vardı', toTrade: 'Takas edilecek', trading: 'Takas ediliyor', keep: 'Side\'da kalıyor', toConvert: 'Karta çevrilecek', converting: 'Çevriliyor', converted: 'Karta çevrildi', listed: 'Pazarda', none: 'Dokunulmuyor', fired: 'Kovuldu' },
    lowLevel: 'Seviye {lv} · takas 10. seviyede açılır, Auto Trade bu hesabı kullanmaz', fireOne: 'Kov', fireOneTitle: '{name} kovulsun mu?', fireOneAsk: '{name} ({account}) takımdan kovulacak (oyundaki FIRE). Bu işlem geri alınamaz.', fireOneYes: 'Evet, kov', listOne: 'Listele', fireAll: 'Tümünü kov', fireAllTitle: '{account} · hepsi kovulsun mu?', fireAllAsk: '{account} hesabındaki bu listedeki {n} oyuncunun hepsi takımdan kovulacak (oyundaki FIRE). Bu işlem geri alınamaz.', fireOneNo: 'Vazgeç', firing: 'Kovuluyor…',
    accStatus: { waiting: 'Sırada', active: 'Açık', done: 'Bitti', skipped: 'Atlandı (TK)', error: 'Hata' },
    summary: 'Özet', bought: 'Alınan', spent: 'Harcanan TK', converted: 'Karta çevrilen', tradedIn: 'Takasla gelen', tradedOut: 'Takasla giden', tkPaid: 'Takasta ödenen', tkReceived: 'Takasta alınan', listed: 'Pazara konan', tkNow: 'TK (başlangıç → şimdi)',
    cards: 'Karta çevrilen oyuncular', thisRun: 'Bu çalıştırma', total: 'Toplam', resetCards: 'Tabloyu sıfırla', resetCardsConfirm: 'Karta çevrilen oyuncuların sayıları (bu çalıştırma ve toplam) silinecek. Emin misin?',
    listTitle: 'Pazara listele', listHint: 'Side\'larda kalan oyuncular. Fiyat ve para birimi seçip istediklerini listele.', listSelected: 'Seçilileri listele', nothingToList: 'Listelenecek oyuncu yok.',
    roleModal: '{name} · rolü iki yönlü bir oyuncu', roleModalHint: 'Bu oyuncunun rolleri ({roles}) hem karta çevirme hem satılabilir yönünü gösteriyor. Ne yapılsın? Seçimin bu çalıştırma boyunca aynı oyuncu için geçerli.', roleMain: 'Karta çevir', roleSide: 'Satılabilir (yan hesapta kalsın)', roleLeave: 'Dokunma', fireOnly: 'Takas edilemez (1 maaş)', fireOnlyHint: 'Maaşı 1 olan bu oyuncu takas edilemez; yalnız kovulabilir ya da olduğu gibi bırakılır.', listingModal: '{name} kadrosu doldu', listingModalHint: 'Kalacak oyuncularla dolu. Her oyuncu için seç: Listele (girdiğin fiyattan pazara konur), Kov (takımdan atılır, geri alınamaz) ya da Beklet (kadroda kalır, sayfanın altındaki “Pazara listele” tablosunda görünür). Hepsini seçip Tamam deyince işlemler yapılır ve Auto Trade devam eder.', actList2: 'Listele', actFire2: 'Kov', actHold: 'Beklet', allAs: 'Hepsini:', chooseAll: '{n} oyuncu için seçim yapılmadı', fireWarn: '{n} oyuncu kovulacak · geri alınamaz', okGo: 'Tamam', priceShort: 'Fiyat', listAndGo: 'Listele ve devam et', skipList: 'Listeleme, bu hesabı bitir',
    errorTitle: 'Auto Trade durdu', errorHint: 'Sorunu oyunda düzeltip "Kaldığı yerden devam et"e bas. Hesaplara yeniden girilir ve kaldığı yerden sürer.',
    cycle: 'Tur {n}',
    parallel: 'Aynı anda çalışan hesap', parallelHint: 'Yan hesaplar Scout\'larını aynı anda tarar; main ile takaslar yine sırayla yapılır. 1–6 (önerilen 3).',
    activeTime: 'Aktif çalışma', cycleProgress: 'Bu tur: {done}/{total} hesap · {active} aynı anda', cycleEta: 'tahmini tur sonu ~{t}',
    wrapStop: 'Durduruluyor: {cheap} ucuz oyuncu main\'e veriliyor (TK yetmezse kovuluyor), harcayıcılar oyuncularını pazara koyuyor',
    wrapPause: 'Duraklatıldı: harcayıcılar oyuncularını pazara koyuyor (ucuz oyunculara dokunulmuyor)',
    wrapLeft: '{done}/{total} işlem · kalan ~{t}',
    prepBtn: 'Sadece hazırlık yap', prepTop: 'Hazırlık', prepTopHint: 'Bench\'teki oyunculara karar verip sadece bunları yaptırır (Auto Trade başlamaz)', prepRun: 'Hazırlık', prepNoDecision: 'Önce en az bir oyuncu için karar seç.', prepAllNone: 'Hepsi “hiçbir şey yapma”: bu hesaplar yalnızca incelendi olarak işaretlenir (1 saat tekrar sorulmaz).', prepHint: 'Bench kararlarını şimdi uygular: pazara koyulacaklar listelenir, kovulacaklar kovulur, Trade\'e dahil et / Karta çevir oyuncuları main\'e verilir (main karta çevirir), Satılabilir\'ler harcayıcıya gider. Auto Trade\'i başlatmaz. 1 saat içinde Auto Trade başlatırsan bu hesaplar tekrar kontrol edilmez.',
    prepRunning: 'Hazırlık sürüyor · {done}/{total} hesap', prepStop: 'Hazırlığı durdur', prepDone: 'Hazırlık yapıldı ({time}) · {n} hesap tekrar kontrol edilmeyecek', prepClear: 'Hazırlığı unut',
    prepared: 'Hazırlık yapıldı ({time}) · tekrar kontrol edilmedi', prepFailed: 'Hazırlık yarıda kaldı: {error}',
    waitScout: '{name} Scout yenilenmesini bekliyor · {time}',
    steps: { prep: 'Hazırlık: bench kararları · {done}/{total} hesap', starting: 'Başlıyor', opening: '{name} açılıyor', scouting: '{name} Scout · {candidates} uygun · {attempts} hak', signing: '{name}: {player} alınıyor ({price} TK)', callback: '{name}: Call back', converting: 'Main: {count} oyuncu karta çevriliyor', trading: '{side} ile takas · Main {give} verir, {take} alır · {tk} TK', waitingScout: '{name} Scout yenilenmesini bekliyor', cardScan: 'Main hesabında kart taraması yapılıyor', leftovers: 'Durmadan önce: {cheap} ucuz oyuncu, {count} harcayıcı', prepDone: 'Hazırlık bitti · bench kararları uygulandı', friendSync: 'Arkadaş ağı kontrol ediliyor', waitingCards: 'Main: Sentez / Aktive et bitince karta çevrilecek', friendBoard: "{name}: {owner} adlı arkadaşın Scout listesine bakılıyor", spenderSearch: '{name}: {player} ({owner}) için uygun harcayıcı aranıyor', listing: '{name}: {count} oyuncu pazara konuyor', done: 'Bitti', stopped: 'Durduruldu' }
  },
  en: {
    title: 'Auto Trade', subtitle: 'Scout · star cards · main ↔ side trades',
    start: 'Start', pause: 'Pause', resume: 'Resume', stop: 'Stop', cont: 'Continue from where it stopped', reset: 'Reset progress',
    resetConfirm: 'Saved progress is deleted and Auto Trade starts from scratch. Are you sure?', yes: 'Yes, reset', cancel: 'Cancel', close: 'Close',
    status: { awaitingRole: 'Waiting for your choice', idle: 'Ready', waitingGame: 'Waiting for the game · continues when it is back', running: 'Running', paused: 'Paused', stopping: 'Stopping', stopped: 'Stopped', error: 'Error · needs you', done: 'Finished', awaitingListing: 'Waiting for a market listing' },
    accounts: 'Accounts', selectAll: 'Select all', extraTargets: 'Extra targets', extraTargetsHint: 'Every extra target runs an Auto Trade of its own with itself as main: the chosen accounts and the Harcayıcı accounts are split evenly by role among the targets; one that ends or fails does not stop the others. Hazırlık is done on the first target only.', extraRuns: 'Other targets', extraTotals: '{accounts} accounts · {bought} bought · {converted} cards · {trades} trades', mainBadge: 'Main', actingMain: 'Account acting as main for this run', actingMainHint: 'The real main is not selected. This choice is for this run only; the real main stays main.',
    routing: 'Roles', sideToMain: 'Side → Main', mainToSide: 'Main → Side', sideToMainNote: 'Roles routed side → main move to main and are turned into star cards there.', mainToSideNote: 'Roles routed main → side stay on the sides; you can list them on the market at the end.',
    roleRules: 'Rules by account role', roleRulesHint: 'What every account role but Main signs from Scout. Every column is a player role of the Cards page (Sellable, Card, Stock…); Cheap: players at or under the price limit whatever their role. An empty price uses the general limit. The number is how many selected accounts have the role. The Harcayıcı row counts too: a player switched off there is neither signed nor taken by trade by the Harcayıcı accounts.', rrRole: 'Role', rrCheap: 'Cheap', rrPrice: 'Price limit', rrUnused: 'This role is in neither direction above, so it routes no players',
    maxPrice: 'Maximum price (Scout Price)', maxPriceHint: 'Players at or below this price go to main and become cards whatever their role. 0–2500; under 50 = roles only.',
    room: 'Trade room', roomDesc: 'Room name', roomPass: 'Room password', roomPassSaved: 'saved', showPass: 'Show password', hidePass: 'Hide password',
    loop: 'Loop', loopOff: 'Single run', loopCount: 'Number of cycles', loopInfinite: 'Endless', loopTimes: 'cycles', loopHint: 'In a loop every account is entered again when its Scout refreshes (30 min).',
    synthAfter: 'Start card synthesis when it ends', synthAfterHint: 'Whatever ends Auto Trade (the last cycle, Stop, TK running out, an error), Cards → Synthesis "Do both" runs: No Team first, then Team, with the levels chosen on the Synthesis page.',
    useCallbackItems: 'Use Callback items', useCallbackItemsHint: 'When the free daily Scout refreshes are used up, a Callback item from the bag of the account renews the Scout (at most 5 items per account per turn). An account without items goes on as before.',
    keepAutoPlay: "Keep Auto Play running", keepAutoPlayHint: "Auto Play keeps running on these accounts (in socket mode it does not clash with Auto Trade; only accounts that fell back to browser mode are stopped for a moment). Over the salary cap Auto Play does not stop: it tries again as soon as Auto Trade lists, trades, fires or makes cards on that account, otherwise every 2 minutes; when 10 tries (about 20 minutes) do not get it under the cap it stops and alerts as before.",
    sideOnly: 'Only sign Satılabilir and Stok players', sideOnlyHint: 'No Kart players and no cheap players under the price limit are signed; only Satılabilir and Stok. Main scouts in its own turn, hands to the spenders and closes; then 10 accounts work at once without main, each hands to its own spender, which lists right away.',
    baseAsSellable: 'Treat base players as sellable', baseAsSellableHint: 'Team players (in the Cards system) whose actual signed salary (Lv30+ accounts may get a 5% discount) is at or below Base count as Satılabilir and are not turned into cards. No Team players and players not in Cards are not affected.',
    howTitle: 'How it works',
    how: [
      'Before starting, the rosters and TK of the selected accounts are read without logging in. If another system (Auto Play, Scout, Equipment, Market, Tournament, a schedule) uses them, you are warned.',
      'Starting fives are never touched; only bench players are used. Roster = 5 + 6 = 11; each side gives at most 5 players per trade.',
      'For accounts with players already on the bench you decide per player: list on the market, include in the trade, or do nothing. Equipped, X and temporary players never move.',
      'Main scouts first and buys every eligible player (side → main roles, main → side roles, and players at or under the price limit). With a full bench it turns card players into star cards at Make; if there are none it hands side-bound players to the highest-TK side. It goes on until callbacks and eligible players run out.',
      'Then sides open from highest to lowest TK. The side always hosts the room, main joins with the password. One trade carries both directions; the TK moved is the salary difference.',
      'Sides scout too and give main-bound players to main 5 at a time; main turns them into cards right away. If a side fills up with players it keeps, you are asked which to list on the market.',
      'A side without enough TK is skipped. If main lacks TK, or a player already exists on the other account and cannot be resolved, the run stops; fix it and press "Continue".',
      'When all sides are done (in a loop: after every cycle) the Cards page scan of the main account runs automatically.',
      'At the end you can list each side\'s kept players with a price and currency (defaults: Satılabilir 20 APK, Stok 99999 TIX).'
    ],
    preTitle: 'Before starting', checking: 'Checking accounts…', conflictsTitle: 'These accounts are used by another system',
    conflict: { autoplay: 'Auto Play running', scout: 'Scout open', equipment: 'Equipment open', market: 'Market job running', tournament: 'Tournament registration running', schedule: 'Scheduled task waiting' },
    stopAndStart: 'Stop and start', benchTitle: 'Accounts with players already on the bench', benchHint: 'Choose per player: only "Include in trade" players (that fit a role/price) are used.',
    starting: 'Starting · Auto Play on the selected accounts is being stopped first…', actList: 'List on market', actTrade: 'Include in trade', actCard: 'Turn into a card', actFire: 'Fire', actNone: 'Do nothing', bulkAll: 'All:', bulkAcc: 'This account:', bulkHint: 'Only marks the choices; nothing is done. You check the list and confirm with the button at the bottom. A choice that does not fit a player (e.g. card for a fire-only player) leaves that player as it was.', bulkList: 'List all on market', bulkTrade: 'Include all in trade', bulkCard: 'Turn all into cards', bulkFire: 'Fire all', bulkNone: 'Reset all', fireTitle: 'Players will be fired', fireAsk: 'These players will be fired from the team (the game\'s FIRE). This cannot be undone. Are you sure?', fireYes: 'Yes, fire and start', fireYesPrep: 'Yes, fire and prepare', cardHint: 'Moved to Main and turned into a card whatever its roles', blocked: { equipped: 'Equipped · cannot move', x: 'X player · cannot move', temporary: 'Temporary · cannot move', starter: 'Starter' },
    fitsMain: 'goes to main', fitsSide: 'stays on side', fitsNone: 'role/price does not fit',
    noBench: 'No account has players on the bench.', startNow: 'Start',
    live: 'Live', liveHidden: 'hidden · click to open', openTime: 'open', visits: 'visits', tk: 'TK', noPlayers: 'No players yet',
    player: 'Player', salary: 'Salary', value: 'Value', base: 'Base', listPrice: 'List price',
    spenderListTitle: 'Harcayıcı market list', spenderListHint: 'Players the Harcayıcı accounts listed to make room. Pick a price and currency and press Update price: the player is taken off and listed again at the new price.',
    friendBoards: "Use friends' Scouts (Harcayıcı network)", friendBoardsHint: "After their own Scout, main and the sides look at their friends' Scouts too: main takes Kart / cheap players (when it is a friend), a Harcayıcı with enough TK takes Satılabilir / Stok (Stok by Lv30+ accounts first, 5% salary cut chance). When no Harcayıcı can (daily limit, no TK) main or the side signs it and trades it to a Harcayıcı; if that fails too, the side keeps it. Auto Trade makes the friendships itself; main's list is never touched.", spenderSellPrice: 'Harcayıcı · Satılabilir default price', spenderStockPrice: 'Harcayıcı · Stok default price', spenderPriceHint: 'When a Harcayıcı is full or gets a player it already has, one of its bench players is listed: a Stok player at the Stok price, the others at the Satılabilir price. You can change it later in the Harcayıcı market list.', spendersPerSide: 'Harcayıcı friends per account', spendersPerSideHint: 'How many Harcayıcı accounts every account is friends with. When one runs out of TK another one signs. After a change the network is built again at the next cycle (or with Build the friend network now).', spenderMinTk: 'Harcayıcı TK floor', spenderMinTkHint: 'A Harcayıcı that would drop below this TK after the signing is skipped for the next one.', friendSync: 'Build the friend network now', friendSyncing: 'Building…', friendSyncDone: 'Friend network: {done}/{total} new friendship(s) · {removed} old removed', friendSyncSkipped: 'Friend network is up to date (or no Harcayıcı)',
    baseProjected: "Use tomorrow's Base (Base × 0.95)", baseProjectedHint: "Base is recomputed daily and discounted signings pull it ~5% down. When on, the salary is compared with tomorrow's Base: at Base 50 a 50 salary is not Base, a 48 salary is.",
    price: 'Price', role: 'Role', stateCol: 'Status', from: 'From',
    pstatus: { bought: 'Bought', existing: 'Was there', toTrade: 'To be traded', trading: 'Trading', keep: 'Stays on side', toConvert: 'To be converted', converting: 'Converting', converted: 'Converted', listed: 'Listed', none: 'Untouched', fired: 'Fired' },
    lowLevel: 'Level {lv} · trading opens at level 10, Auto Trade does not use this account', fireOne: 'Fire', fireOneTitle: 'Fire {name}?', fireOneAsk: '{name} ({account}) will be fired from the team (the game\'s FIRE). This cannot be undone.', fireOneYes: 'Yes, fire', listOne: 'List', fireAll: 'Fire all', fireAllTitle: '{account} · fire them all?', fireAllAsk: 'All {n} players of this list on {account} will be fired from the team (the game\'s FIRE). This cannot be undone.', fireOneNo: 'Cancel', firing: 'Firing…',
    accStatus: { waiting: 'Waiting', active: 'Open', done: 'Done', skipped: 'Skipped (TK)', error: 'Error' },
    summary: 'Summary', bought: 'Bought', spent: 'TK spent', converted: 'Converted', tradedIn: 'Traded in', tradedOut: 'Traded out', tkPaid: 'TK paid in trades', tkReceived: 'TK received in trades', listed: 'Listed', tkNow: 'TK (start → now)',
    cards: 'Players turned into cards', thisRun: 'This run', total: 'Total', resetCards: 'Reset table', resetCardsConfirm: 'The card counts (this run and totals) will be deleted. Are you sure?',
    listTitle: 'List on market', listHint: 'Players left on the sides. Pick price and currency and list the ones you want.', listSelected: 'List selected', nothingToList: 'Nothing to list.',
    tabs: { run: 'Auto Trade', pricing: 'Auto Pricing' },
    pr: {
      intro: 'The spenders list Sellable and Stock players at these prices. A player without its own price is listed at the default price of its kind. Changes are saved at once and count while Auto Trade runs too.',
      defaults: 'Default prices', sellable: 'Sellable', stok: 'Stock',
      price: 'Price', discPrice: 'If signed 5% off', fireNoDisc: 'Fire if not 5% off', fireYes: 'Yes, fire', fireNoDiscHint: 'When it was not signed 5% off the spender does not list this player, it fires it (cannot be undone)', fireNoDiscAsk: '{name} will not be listed but fired when it was not signed 5% off (the game’s FIRE, cannot be undone). Are you sure?', lv30: 'Lv30+ only', always: 'always',
      value: 'Value', valueDisc: '5% lower', base: 'Base', role: 'Role', player: 'Player',
      search: 'Search player…', fAll: 'All', fMissing: 'No price yet', fSellable: 'Sellable', fStok: 'Stock', fLv30: 'Marked Lv30+',
      missing: '{n} player(s) have no price · listed at the default price', allSet: 'Every player has a price',
      noPrice: 'no price', noDiscPrice: 'no 5%-off price', addPlayer: 'Add a player to the list…', chooseRole: 'Choose a role', chooseRoleText: 'With which role should {name} join this list? Players without a role cannot be on it.', select: 'Select', removeRole: 'Remove this role (the player leaves the list)', addRole: '+ role', firedShort: 'fired if not 5% off', firedNoPrice: 'Fire if not 5% off is on: a full-price copy is fired, so the normal price is never used', useDefault: 'default: {p}', sameAsPrice: 'empty: normal price',
      none: 'No player has the Sellable or Stock role. Give roles in Cards → Player List.',
      saved: 'Saved', clear: 'Clear',
      hint: '5% off price: used when the player was signed 5% off by a Lv30+ account (at Base or not); empty means the normal price. Lv30+ only: this Sellable player is signed only by Lv30+ accounts, like Stock (through a friend for the moment when needed).',
      banner: '{n} Sellable / Stock player(s) have no price; they will be listed at the default price.', bannerBtn: 'Enter prices'
    },
    spenderPricesMoved: 'Spender sale prices are now in the “Auto Pricing” tab (per player).',
    roleModal: '{name} · a player with roles both ways', roleModalHint: 'This player\'s roles ({roles}) point both to cards and to Satılabilir. What should happen? Your choice counts for this player for the rest of the run.', roleMain: 'Turn into a card', roleSide: 'Satılabilir (keep on the side)', roleLeave: 'Leave it', fireOnly: 'Cannot be traded (salary 1)', fireOnlyHint: 'This 1-salary player cannot be traded; it can only be fired or left as it is.', listingModal: '{name} roster is full', listingModalHint: 'It is full of players it keeps. Choose for every player: List (put on the market at the price you enter), Fire (removed from the team, cannot be undone) or Hold (stays in the roster and shows in “List on market” under the page). When every player has a choice, OK does the work and Auto Trade goes on.', actList2: 'List', actFire2: 'Fire', actHold: 'Hold', allAs: 'All:', chooseAll: '{n} player(s) have no choice yet', fireWarn: '{n} player(s) will be fired · cannot be undone', okGo: 'OK', priceShort: 'Price', listAndGo: 'List and continue', skipList: 'Do not list, finish this account',
    errorTitle: 'Auto Trade stopped', errorHint: 'Fix it in the game and press "Continue". The accounts are opened again and the run goes on from there.',
    cycle: 'Cycle {n}',
    parallel: 'Accounts at the same time', parallelHint: 'Sides scan their Scouts at the same time; trades with main still go one by one. 1–6 (3 recommended).',
    activeTime: 'Active time', cycleProgress: 'This cycle: {done}/{total} accounts · {active} at once', cycleEta: 'cycle ends in ~{t}',
    wrapStop: 'Stopping: {cheap} cheap player(s) go to main (fired if its TK is not enough), the spenders list their players',
    wrapPause: 'Paused: the spenders list their players (cheap players are left alone)',
    wrapLeft: '{done}/{total} steps · ~{t} left',
    prepBtn: 'Only prepare', prepTop: 'Prepare', prepTopHint: 'Decide on the bench players and only carry that out (Auto Trade does not start)', prepRun: 'Preparation', prepNoDecision: 'Choose a decision for at least one player first.', prepAllNone: 'All “do nothing”: these accounts are just marked as reviewed (not asked again for an hour).', prepHint: 'Carries out the bench decisions now: players to list are listed, players to fire are fired, Include in trade / Turn into card players go to main (main turns them into cards), Satılabilir go to a spender. Auto Trade does not start. Started within an hour, these accounts are not checked again.',
    prepRunning: 'Preparing · {done}/{total} accounts', prepStop: 'Stop preparing', prepDone: 'Prepared ({time}) · {n} accounts are not checked again', prepClear: 'Forget the preparation',
    prepared: 'Prepared ({time}) · not checked again', prepFailed: 'Preparation stopped: {error}',
    waitScout: '{name} waits for its Scout · {time}',
    steps: { prep: 'Preparing: bench decisions · {done}/{total} accounts', starting: 'Starting', opening: 'Opening {name}', scouting: '{name} Scout · {candidates} eligible · {attempts} callbacks', signing: '{name}: signing {player} ({price} TK)', callback: '{name}: Call back', converting: 'Main: converting {count} player(s)', trading: 'Trade with {side} · main gives {give}, gets {take} · {tk} TK', waitingScout: '{name} waits for its Scout refresh', cardScan: 'Scanning the cards of the main account', leftovers: 'Before stopping: {cheap} cheap player(s), {count} spender(s)', prepDone: 'Preparation done · bench decisions carried out', friendSync: 'Checking the friend network', waitingCards: 'Main: turning into cards after Synthesis / Activate', friendBoard: "{name}: going through {owner}'s Scout board", spenderSearch: '{name}: looking for a spender for {player} ({owner})', listing: '{name}: listing {count} player(s)', done: 'Done', stopped: 'Stopped' }
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const num = v => v == null || v === '' ? '—' : Number(v).toLocaleString();
// the time Auto Trade really worked: stops and pauses are not counted
const activeSec = run => ((run.activeMs || 0) + (run.runningSince ? Date.now() - Date.parse(run.runningSince) : 0)) / 1000;
// a countdown: mm:ss
const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const dur = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}sa ${m}dk` : m ? `${m}dk ${x}sn` : `${x}sn`; };
const STATUS_TONE = { bought: 'muted', existing: 'muted', toTrade: 'warn', trading: 'warn', keep: 'ok', toConvert: 'warn', converting: 'warn', converted: 'ok', listed: 'ok', none: 'muted', fired: 'bad' };

function useTick(active) {
  const [, set] = useState(0);
  useEffect(() => { if (!active) return; const t = setInterval(() => set(x => x + 1), 1000); return () => clearInterval(t); }, [active]);
}

export default function AutoTradePage({ state, t, toast, msgText, Modal, refresh }) {
  const [showLive, setShowLive] = useState(() => { try { return localStorage.getItem('at2.showLive') !== '0'; } catch { return true; } });
  const toggleLive = () => setShowLive(v => { try { localStorage.setItem('at2.showLive', v ? '0' : '1'); } catch {} return !v; });
  const x = TEXT[t.lang] || TEXT.en;
  const at = state.autoTrade2 || {};
  const run = at.run;
  const last = at.lastConfig || {};
  const defaults = at.defaults || {};
  const roles = state.cards?.roles || [];
  const playerIndex = useMemo(() => new Map((state.players?.players || []).map(p => [p.id, p])), [state.players]);
  const accounts = state.accounts || [];
  const realMain = state.accountProfile?.mainAccountId || null;
  const running = run && ['running', 'paused', 'stopping', 'awaitingListing', 'awaitingRole'].includes(run.status);
  useTick(running || Boolean(run?.wrapUp));

  const roleIdByName = n => roles.find(r => String(r.name).toLocaleLowerCase('tr-TR') === n)?.id;
  const [form, setForm] = useState(() => ({
    accountIds: Array.isArray(last.accountIds) && last.accountIds.some(id => accounts.some(a => a.id === id)) ? last.accountIds : accounts.map(a => a.id),
    actingMainId: '',
    sideToMainRoleIds: last.sideToMainRoleIds || [roleIdByName('kart') || 'card'],
    mainToSideRoleIds: last.mainToSideRoleIds || [roleIdByName('satılabilir') || 'sellable', roleIdByName('stok')].filter(Boolean),
    maxPrice: String(last.maxPrice ?? defaults.maxPrice ?? 100),
    roomDescription: last.roomDescription || defaults.roomDescription || '923589325',
    roomPassword: last.roomPassword || '32958209',
    loopMode: last.loopMode || 'off', loopCount: String(last.loopCount || 2),
    baseAsSellable: Boolean(last.baseAsSellable),
    sideOnly: Boolean(last.sideOnly),
    keepAutoPlay: Boolean(last.keepAutoPlay),
    synthAfter: last.synthAfter !== false,
    useCallbackItems: Boolean(last.useCallbackItems),
    baseProjected: last.baseProjected !== false,
    friendBoards: last.friendBoards !== false,
    spenderSellPrice: String(last.spenderSellPrice || last.spenderPrice || 999999),
    spenderSellCurrency: last.spenderSellCurrency || 'TIX',
    spenderStockPrice: String(last.spenderStockPrice || last.spenderPrice || 999999),
    spenderStockCurrency: last.spenderStockCurrency || 'TIX',
    spenderMinTk: String(last.spenderMinTk || 0),
    spendersPerSide: String(last.spendersPerSide || 5),
    parallelSides: String(last.parallelSides || 3),
    roleRules: last.roleRules || {}
  }));
  const set = patch => setForm(f => ({ ...f, ...patch }));
  // every change is remembered for next time, started or not
  useEffect(() => {
    if (running) return;
    const h = setTimeout(() => { Promise.resolve(api.autoTrade.saveDraft?.(form)).catch(() => {}); }, 600);
    return () => clearTimeout(h);
  }, [form, running]);
  const [pre, setPre] = useState(null);       // preflight result
  const [starting, setStarting] = useState(false); // stopping Auto Play on the accounts, then the run starts
  const [decisions, setDecisions] = useState({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('at2.tab') || 'run'; } catch { return 'run'; } });
  const chooseTab = id => { setTab(id); try { localStorage.setItem('at2.tab', id); } catch {} };
  const pricingRows = usePricingRows(state, roles);
  const missingPrices = pricingRows.filter(p => priceMissing(at.pricing?.players?.[p.id] || {})).length;
  const run_ = async fn => { try { return await fn(); } catch (e) { toast(e.message, 'error'); } };

  // trading opens at level 10: lower accounts cannot be picked
  const levelOf = id => Number(state.accountProfile?.accounts?.[id]?.level);
  const locked = id => { const lv = levelOf(id); return Number.isFinite(lv) && lv > 0 && lv < 10; };
  const selected = form.accountIds.filter(id => accounts.some(a => a.id === id) && !locked(id));
  const mainSelected = selected.includes(realMain);
  const priceNum = Number(form.maxPrice);
  const priceValid = /^\d+$/.test(String(form.maxPrice).trim()) && priceNum >= 0 && priceNum <= 2500;
  const canStart = selected.length >= 2 && priceValid && (mainSelected || (form.actingMainId && selected.includes(form.actingMainId)));
  // several targets (user 2026-11-28): the main of the run plus extra targets, each a main of its own run
  const firstTarget = mainSelected ? realMain : form.actingMainId;
  const [extraTargets, setExtraTargets] = useState(() => { try { return JSON.parse(localStorage.getItem('at.extraTargets') || '[]'); } catch { return []; } });
  const extras = extraTargets.filter(id => selected.includes(id) && id !== firstTarget);
  const setExtras = ids => { setExtraTargets(ids); try { localStorage.setItem('at.extraTargets', JSON.stringify(ids)); } catch {} };
  const targetIds = extras.length ? [firstTarget, ...extras] : undefined;
  const extraRuns = state.autoTradeExtra || [];
  const toggleAcc = id => set({ accountIds: form.accountIds.includes(id) ? form.accountIds.filter(v => v !== id) : [...form.accountIds, id] });
  const toggleRole = (key, id) => set({ [key]: form[key].includes(id) ? form[key].filter(v => v !== id) : [...form[key], id] });

  const openPreflight = (mode = 'start') => run_(async () => {
    setPre({ loading: true, mode });
    const res = await api.autoTrade.preflight({ accountIds: selected, config: { ...form, maxPrice: priceNum } });
    const d = {};
    for (const a of res.accounts) for (const p of a.bench) {
      d[a.id] = d[a.id] || {};
      // price from the Auto Trade pricing (Otomatik Fiyatlandırma) when the engine sent it
      const stock = (p.roleIds || []).some(r => r !== 'sellable' && form.mainToSideRoleIds.includes(r));
      d[a.id][p.id] = { action: 'none', price: p.listPrice?.price ?? (stock ? 99999 : 20), currency: p.listPrice?.currency ?? (stock ? 'TIX' : 'APK') };
    }
    setDecisions(d);
    setPre({ ...res, mode });
    if (res.conflicts.length || res.accounts.some(a => a.bench.length)) Promise.resolve(api.autoTrade.attention?.('conflict')).catch(() => {});
  });
  const [fireAsk, setFireAsk] = useState(null);
  // players marked "Fire" are listed once more before the start (FIRE cannot be undone)
  const firing = () => (pre?.accounts || []).flatMap(a => a.bench.filter(p => decisions[a.id]?.[p.id]?.action === 'fire').map(p => ({ ...p, account: a.name })));
  const startChecked = stopConflicts => { const list = firing(); if (list.length) setFireAsk({ list, stopConflicts }); else startNow(stopConflicts); };
  const prepChecked = stopConflicts => { const list = firing(); if (list.length) setFireAsk({ list, stopConflicts, prep: true }); else prepareNow(stopConflicts); };
  const prep = at.prep;
  const prepRunning = prep?.status === 'running';
  useTick(prepRunning);
  const prepareNow = stopConflicts => run_(async () => {
    await api.autoTrade.prepare({ ...form, maxPrice: priceNum, parallelSides: Number(form.parallelSides) || 3, accountIds: selected, actingMainId: mainSelected ? undefined : form.actingMainId, roomPassword: form.roomPassword || undefined, benchDecisions: decisions, stopConflicts });
    setPre(null);
    await refresh();
  });
  const startNow = stopConflicts => run_(async () => {
    setStarting(true);
    try {
    await api.autoTrade.start({ ...form, maxPrice: priceNum, loopCount: Number(form.loopCount) || 1, parallelSides: Number(form.parallelSides) || 3, accountIds: selected, targetIds, actingMainId: mainSelected ? undefined : form.actingMainId, roomPassword: form.roomPassword || undefined, benchDecisions: decisions, stopConflicts });
    setPre(null);
    await refresh();
    } finally { setStarting(false); }
  });

  const statusKey = run?.status || 'idle';
  const stepText = run ? fill(x.steps[run.step] || '', run.stepParams || {}) : '';
  // Harcayıcılar used by the run are shown after the run's own accounts
  const accRows = run ? [...run.config.accountIds.map(id => run.accounts[id]), ...Object.values(run.accounts).filter(a => a?.role === 'spender' && !run.config.accountIds.includes(a.id))].filter(Boolean) : [];
  const mainAcc = run ? run.accounts[run.config.mainId] : null;
  const activeSides = run ? (run.activeSides?.length ? run.activeSides : [run.currentSideId || (run.activeId !== run.config.mainId ? run.activeId : '')]).map(id => run.accounts[id]).filter(Boolean) : [];
  const others = accRows.filter(a => a !== mainAcc && !activeSides.includes(a));

  return <div className="page autotrade2">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar">
        {!running && <button className="btn ghost" disabled={!canStart} title={x.prepTopHint} onClick={() => openPreflight('prep')}>{x.prepTop}</button>}
        {!running && <button className="btn primary" disabled={!canStart} onClick={() => openPreflight('start')}>{x.start}</button>}
        {run?.status === 'running' && <button className="btn ghost" onClick={() => run_(() => api.autoTrade.pause())}>{x.pause}</button>}
        {run?.status === 'paused' && <button className="btn success" onClick={() => run_(() => api.autoTrade.resume())}>{x.resume}</button>}
        {running && <button className="btn danger-soft" onClick={() => run_(() => api.autoTrade.stop())}>{x.stop}</button>}
        {!running && run && ['stopped', 'error', 'waitingGame'].includes(run.status) && <button className="btn success" onClick={() => run_(() => api.autoTrade.continue())}>{x.cont}</button>}
        {!running && run && <button className="btn ghost" onClick={() => setConfirmReset(true)}>{x.reset}</button>}
      </div>
    </div>

    <div className="dp-tabs">{Object.keys(x.tabs).map(id => <button key={id} className={tab === id ? 'active' : ''} onClick={() => chooseTab(id)}>{x.tabs[id]}{id === 'pricing' && missingPrices > 0 && <i className="so-count">{missingPrices}</i>}</button>)}</div>

    {prep && !running && (prepRunning || prep.fresh || ['error', 'stopped'].includes(prep.status)) && <div className="panel at2-prep">
      {prepRunning ? <><span className="pill warn"><i />{fill(x.prepRunning, { done: prep.done, total: prep.total })}</span><button className="btn ghost small" onClick={() => run_(() => api.autoTrade.stopPrepare())}>{x.prepStop}</button></>
        : prep.fresh ? <><span className="pill ok"><i />{fill(x.prepDone, { time: new Date(prep.at).toLocaleTimeString(), n: prep.accountIds.length })}</span><button className="btn ghost small" onClick={() => run_(() => api.autoTrade.clearPrepare())}>{x.prepClear}</button></>
        : <span className="pill bad"><i />{fill(x.prepFailed, { error: prep.error || x.status.stopped })}</span>}
    </div>}

    {run && <div className="at2-status panel">
      <span className={`pill ${statusKey === 'error' ? 'bad' : running ? (statusKey === 'paused' ? 'warn' : 'ok') : 'muted'}`}><i />{x.status[statusKey] || statusKey}</span>
      {run.config.loopMode !== 'off' && <span className="pill muted"><i />{fill(x.cycle, { n: run.cycle })}{run.config.loopMode === 'count' ? ` / ${run.config.loopCount}` : ' / ∞'}</span>}
      {run.config.prepOnly && <span className="pill muted"><i />{x.prepRun}</span>}
      <span className="at2-step">{stepText}</span>
      {run.nextAt && <span className="muted-text">{new Date(run.nextAt).toLocaleTimeString()}</span>}
      <span className="pill muted" title={x.activeTime}><i />{x.activeTime}: {dur(activeSec(run))}</span>
      {run.stage === 'sides' && run.cycleInfo && <span className="muted-text at2-cycle">{fill(x.cycleProgress, { done: run.cycleInfo.finished, total: run.cycleInfo.total, active: run.cycleInfo.active })}{run.cycleInfo.etaSeconds != null && running && run.status === 'running' ? ' · ' + fill(x.cycleEta, { t: dur(run.cycleInfo.etaSeconds) }) : ''}</span>}
    </div>}
    {extraRuns.length > 0 && <div className="panel at2-extra"><b>{x.extraRuns}</b>{extraRuns.map(e => { const st = e.run?.status; const on = ['running', 'paused', 'stopping', 'awaitingListing', 'awaitingRole'].includes(st); const accs = Object.values(e.run?.accounts || {}); return <div key={e.targetId} className="at2-extra-row">
      <span className={`pill ${st === 'error' ? 'bad' : on ? 'ok' : 'muted'}`}><i />{accounts.find(a => a.id === e.targetId)?.name || e.targetId} · {x.status[st] || st}</span>
      <span className="at2-step">{fill(x.steps[e.run?.step] || '', e.run?.stepParams || {})}</span>
      <span className="muted-text">{fill(x.extraTotals, { accounts: accs.length, bought: accs.reduce((n, a) => n + (a.bought || 0), 0), converted: accs.reduce((n, a) => n + (a.converted || 0), 0), trades: accs.reduce((n, a) => n + (a.tradesIn || 0) + (a.tradesOut || 0), 0) })}</span>
      {st === 'error' && <span className="bad-text">{e.run?.error?.message}</span>}
    </div>; })}</div>}
    {run?.wrapUp && <div className="panel at2-wrap">
      <span className="pill warn"><i />{run.wrapUp.kind === 'pause' ? x.status.paused : x.status.stopping}</span>
      <span>{fill(run.wrapUp.kind === 'pause' ? x.wrapPause : x.wrapStop, { cheap: run.wrapUp.cheap })}</span>
      <b>{fill(x.wrapLeft, { done: run.wrapUp.done, total: run.wrapUp.total, t: clock(Date.parse(run.wrapUp.endsAt) - Date.now()) })}</b>
    </div>}

    {run?.status === 'error' && <div className="panel at2-error"><b>{x.errorTitle}</b><span>{msgText(t, run.error?.code || 'at2.failed', { ...(run.error?.params || {}), error: run.error?.message }, run.error?.message)}</span><small>{x.errorHint}</small></div>}

    {tab === 'pricing' && <PricingTab x={x} pricing={at.pricing} rows={pricingRows} toast={toast} roles={roles} players={state.players?.players || []} />}
    {tab === 'run' && missingPrices > 0 && <div className="panel at2-price-banner"><span>{fill(x.pr.banner, { n: missingPrices })}</span><button className="btn ghost small" onClick={() => chooseTab('pricing')}>{x.pr.bannerBtn}</button></div>}
    {tab === 'run' && <>
    {!running && <ConfigPanel state={state} x={x} form={form} set={set} accounts={accounts} realMain={realMain} selected={selected} mainSelected={mainSelected} toggleAcc={toggleAcc} locked={locked} levelOf={levelOf} roles={roles} toggleRole={toggleRole} priceValid={priceValid} last={last} firstTarget={firstTarget} extras={extras} setExtras={setExtras} running={running} />}
    <div className="panel at2-how"><button className="link-btn" onClick={() => setShowHow(v => !v)}>{showHow ? '▾' : '▸'} {x.howTitle}</button>{showHow && <ol>{x.how.map((h, i) => <li key={i}>{h}</li>)}</ol>}</div>

    {run && <>
      {/* Live boards fold away and open again while the run goes on (user 2026-11-13); remembered */}
      <h3 className="section-title"><button type="button" className="link-btn" aria-expanded={showLive} onClick={() => toggleLive()}>{showLive ? '▾' : '▸'} {x.live}</button>{!showLive && <small className="muted-text"> · {x.liveHidden}</small>}</h3>
      {showLive && <>
      <div className="at2-top">
        {mainAcc && <AccountBoard acc={mainAcc} x={x} highlight playerIndex={playerIndex} />}
        {activeSides.length ? activeSides.map(a => <AccountBoard key={a.id} acc={a} x={x} highlight playerIndex={playerIndex} />) : <div className="panel at2-board at2-empty">{x.accStatus.waiting}</div>}
      </div>
      {others.length > 0 && <div className="at2-grid">{others.map(a => <AccountBoard key={a.id} acc={a} x={x} playerIndex={playerIndex} />)}</div>}
      </>}
      <Summary run={run} x={x} />
      <CardCounts run={run} totals={at.cardTotals || {}} x={x} Modal={Modal} toast={toast} />
      <ListingPanel run={run} x={x} defaults={at.listDefaults} toast={toast} playerIndex={playerIndex} Modal={Modal} />
    </>}
    {(state.buy?.bought || []).some(e => e.source === 'trade') && <BoughtList state={state} lang={t.lang} toast={toast} source="trade" title={x.spenderListTitle} hint={x.spenderListHint} />}
    </>}

    {pre && <Modal title={x.preTitle} onClose={() => setPre(null)} width={1040}>
      {pre.loading ? <p>{x.checking}</p> : <Preflight pre={pre} x={x} decisions={decisions} setDecisions={setDecisions} onCancel={() => setPre(null)} onStart={startChecked} onPrepare={prepChecked} playerIndex={playerIndex} starting={starting} />}
      {fireAsk && <Modal title={x.fireTitle} onClose={() => setFireAsk(null)} width={520}>
        <p className="bad-text">{x.fireAsk}</p>
        <ul className="fire-list">{fireAsk.list.map(p => <li key={p.account + p.id}><b>{p.name}</b><InjuryMark name={p.name} /> <span className="muted-text">{p.position} · {p.account}</span></li>)}</ul>
        <div className="modal-actions"><button className="btn ghost" onClick={() => setFireAsk(null)}>{x.cancel}</button><button className="btn danger" onClick={() => { const a = fireAsk; setFireAsk(null); (a.prep ? prepareNow : startNow)(a.stopConflicts); }}>{fireAsk.prep ? x.fireYesPrep : x.fireYes}</button></div>
      </Modal>}
    </Modal>}
    {run?.status === 'awaitingListing' && run.listingRequest && <ListingModal req={run.listingRequest} x={x} Modal={Modal} playerIndex={playerIndex} />}
    {run?.status === 'awaitingRole' && run.roleRequest && <RoleModal req={run.roleRequest} x={x} Modal={Modal} />}
    {confirmReset && <Modal title={x.reset} onClose={() => setConfirmReset(false)}><p>{x.resetConfirm}</p><div className="modal-actions"><button className="btn ghost" onClick={() => setConfirmReset(false)}>{x.cancel}</button><button className="btn danger-soft" onClick={() => run_(async () => { await api.autoTrade.reset(); setConfirmReset(false); await refresh(); })}>{x.yes}</button></div></Modal>}
  </div>;
}

function ConfigPanel({ state, x, form, set, accounts, realMain, selected, mainSelected, toggleAcc, locked, levelOf, roles, toggleRole, priceValid, last, firstTarget, extras = [], setExtras = () => {}, running = false }) {
  const [showPass, setShowPass] = useState(false);
  const open = accounts.filter(a => !locked(a.id));
  const all = open.length > 0 && open.every(a => form.accountIds.includes(a.id));
  return <div className="panel at2-config">
    <section><h4>{x.accounts}</h4>
      <div className="at2-chips">
        <label className="at2-chip"><input type="checkbox" checked={all} onChange={() => set({ accountIds: all ? [] : open.map(a => a.id) })} />{x.selectAll}</label>
        <GroupedPicks storeKey="autotrade" accounts={accounts} selected={form.accountIds} isPickable={a => !locked(a.id)} onSet={ids => set({ accountIds: ids })} render={a => locked(a.id) ? <label key={a.id} className="at2-chip off" title={fill(x.lowLevel, { lv: levelOf(a.id) })}><input type="checkbox" checked={false} disabled />{a.name}<small>LV {levelOf(a.id)}</small></label> : <label key={a.id} className={`at2-chip ${form.accountIds.includes(a.id) ? 'on' : ''}`}><input type="checkbox" checked={form.accountIds.includes(a.id)} onChange={() => toggleAcc(a.id)} />{a.name}{a.id === realMain && <span className="main-dot">{x.mainBadge}</span>}</label>} />
      </div>
      {!mainSelected && selected.length > 0 && <div className="at2-acting"><label><span>{x.actingMain}</span><select value={form.actingMainId} onChange={e => set({ actingMainId: e.target.value })}><option value="">—</option>{selected.map(id => <option key={id} value={id}>{accounts.find(a => a.id === id)?.name}</option>)}</select></label><small>{x.actingMainHint}</small></div>}
      {selected.length > 2 && firstTarget && <div className="at2-acting at2-targets"><span>{x.extraTargets}</span><div className="at2-target-picks">{extras.map(id => <span key={id} className="chip on">{accounts.find(a => a.id === id)?.name}<button type="button" disabled={running} onClick={() => setExtras(extras.filter(v => v !== id))} aria-label="×">×</button></span>)}<select value="" disabled={running} onChange={e => { if (e.target.value) setExtras([...extras, e.target.value]); }}><option value="">+ {x.extraTargets}</option>{accounts.filter(a => selected.includes(a.id) && a.id !== firstTarget && !extras.includes(a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div><small>{x.extraTargetsHint}</small></div>}
    </section>
    <section><h4>{x.routing}</h4>
      <div className="at2-route"><b>{x.sideToMain}</b><div className="at2-chips">{roles.map(r => <label key={r.id} className={`at2-chip ${form.sideToMainRoleIds.includes(r.id) ? 'on' : ''}`}><input type="checkbox" checked={form.sideToMainRoleIds.includes(r.id)} onChange={() => toggleRole('sideToMainRoleIds', r.id)} /><i className="role-dot" style={{ background: r.color }} />{r.name}</label>)}</div><small>{x.sideToMainNote}</small></div>
      <div className="at2-route"><b>{x.mainToSide}</b><div className="at2-chips">{roles.map(r => <label key={r.id} className={`at2-chip ${form.mainToSideRoleIds.includes(r.id) ? 'on' : ''}`}><input type="checkbox" checked={form.mainToSideRoleIds.includes(r.id)} onChange={() => toggleRole('mainToSideRoleIds', r.id)} /><i className="role-dot" style={{ background: r.color }} />{r.name}</label>)}</div><small>{x.mainToSideNote}</small></div>
    </section>
    <RoleRules state={state} x={x} form={form} set={set} selected={selected} roles={roles} />
    <section className="at2-row">
      <label><span>{x.maxPrice}</span><input type="number" min="0" max="2500" step="1" value={form.maxPrice} className={priceValid ? '' : 'invalid'} onChange={e => set({ maxPrice: e.target.value.replace(/[^\d]/g, '') })} /><small>{x.maxPriceHint}</small></label>
      <label><span>{x.roomDesc}</span><input maxLength="50" value={form.roomDescription} onChange={e => set({ roomDescription: e.target.value })} /></label>
      <label><span>{x.roomPass}{last.hasPassword && <em className="at2-saved"> · {x.roomPassSaved}</em>}</span><span className="at2-pass"><input type={showPass ? 'text' : 'password'} autoComplete="off" value={form.roomPassword} onChange={e => set({ roomPassword: e.target.value })} /><button type="button" className="btn ghost small" title={showPass ? x.hidePass : x.showPass} onClick={() => setShowPass(v => !v)}>{showPass ? '🙈' : '👁'}</button></span></label>
    </section>
    <section className="at2-row">
      <label><span>{x.loop}</span><select value={form.loopMode} onChange={e => set({ loopMode: e.target.value })}><option value="off">{x.loopOff}</option><option value="count">{x.loopCount}</option><option value="infinite">{x.loopInfinite}</option></select></label>
      {form.loopMode === 'count' && <label><span>{x.loopTimes}</span><input type="number" min="1" max="999" value={form.loopCount} onChange={e => set({ loopCount: e.target.value.replace(/[^\d]/g, '') })} /></label>}
      <label title={x.parallelHint}><span>{x.parallel}</span><input type="number" min="1" max="6" value={form.parallelSides} onChange={e => set({ parallelSides: e.target.value.replace(/[^\d]/g, '').slice(0, 1) })} onBlur={() => set({ parallelSides: String(Math.max(1, Math.min(6, Number(form.parallelSides) || 3))) })} /></label>
      <small className="at2-loop-hint">{x.loopHint}</small>
    </section>
    <section className="at2-options">
      <label className="at2-check"><input type="checkbox" checked={form.sideOnly} onChange={e => set({ sideOnly: e.target.checked })} /><span>{x.sideOnly}</span><small>{x.sideOnlyHint}</small></label>
      <label className="at2-check"><input type="checkbox" checked={form.synthAfter !== false} onChange={e => set({ synthAfter: e.target.checked })} /><span>{x.synthAfter}</span><small>{x.synthAfterHint}</small></label>
      <label className="at2-check"><input type="checkbox" checked={Boolean(form.useCallbackItems)} onChange={e => set({ useCallbackItems: e.target.checked })} /><span>{x.useCallbackItems}</span><small>{x.useCallbackItemsHint}</small></label>
      <label className="at2-check"><input type="checkbox" checked={Boolean(form.keepAutoPlay)} onChange={e => set({ keepAutoPlay: e.target.checked })} /><span>{x.keepAutoPlay}</span><small>{x.keepAutoPlayHint}</small></label>
      <label className="at2-check"><input type="checkbox" checked={form.baseAsSellable} onChange={e => set({ baseAsSellable: e.target.checked })} /><span>{x.baseAsSellable}</span><small>{x.baseAsSellableHint}</small></label>
      <label className={`at2-check at2-sub ${form.baseAsSellable ? '' : 'off'}`}><input type="checkbox" disabled={!form.baseAsSellable} checked={form.baseProjected} onChange={e => set({ baseProjected: e.target.checked })} /><span>{x.baseProjected}</span><small>{x.baseProjectedHint}</small></label>
      <label className="at2-check"><input type="checkbox" checked={form.friendBoards} onChange={e => set({ friendBoards: e.target.checked })} /><span>{x.friendBoards}</span><small>{x.friendBoardsHint}</small></label>
    </section>
    {form.friendBoards && <FriendNetRow x={x} form={form} set={set} />}
  </div>;
}

// Players with the Satılabilir or Stok role (Kartlar → Oyuncu Listesi), for the pricing tab.
// A row has no price while any of its price fields is empty (user 2026-11-18); a "fire if not 5% off"
// row has only the 5%-off price.
const priceMissing = own => (own?.fireNoDisc ? !own.discPrice : !own?.price || !own?.discPrice);
function usePricingRows(state, roles) {
  return useMemo(() => {
    const byName = n => roles.filter(r => String(r.name).trim().toLocaleLowerCase('tr-TR').startsWith(n)).map(r => r.id);
    const sell = new Set(byName('satılabilir').concat(byName('sellable')));
    const stok = new Set(byName('stok').concat(byName('stock')));
    return (state.players?.players || []).filter(p => (p.roleIds || []).some(r => sell.has(r) || stok.has(r))).map(p => ({
      id: p.id, name: p.name, team: p.team, position: p.position, rating: p.rating, value: p.value, base: p.base, atBase: p.atBase,
      kind: (p.roleIds || []).some(r => stok.has(r)) ? 'stok' : 'sellable'
    })).sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  }, [state.players, roles]);
}

// "Otomatik Fiyatlandırma": a default per kind, and per player a price, a price for when it
// was signed 5% off, and "Lv30+ only". Saved as it changes (also while Auto Trade runs).
// A price box that keeps what is typed itself: the page's frequent refreshes never touch it while it
// has focus (user 2026-11-07: typing into the prices did not work). Text box with a number keypad,
// digits only; every change goes up at once, an empty box means "no price".
function PriceBox({ value, onChange, placeholder, disabled, className }) {
  const [text, setText] = useState(value ? String(value) : '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value ? String(value) : ''); }, [value]);
  return <input type="text" inputMode="numeric" className={className} placeholder={placeholder} disabled={disabled} value={disabled ? '' : text}
    onFocus={() => { focused.current = true; }}
    onBlur={() => { focused.current = false; setText(value ? String(value) : ''); }}
    onChange={e => { const v = e.target.value.replace(/[^\d]/g, ''); setText(v); onChange(v); }} />;
}
const CurToggle = ({ value, onChange, disabled }) => <span className="currency-toggle">{['APK', 'TIX'].map(c => <button type="button" key={c} disabled={disabled} className={value === c ? 'on' : ''} onClick={() => onChange(c)}>{c}</button>)}</span>;

function PricingTab({ x, pricing, rows, toast, roles = [], players = [] }) {
  const p = x.pr;
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(pricing || { defaults: { sellable: { price: 20, currency: 'APK' }, stok: { price: 99999, currency: 'TIX' } }, players: {} })));
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilterRaw] = useState('all');
  // rows shown when "No price yet" was chosen stay while their prices are typed (user 2026-11-18: a
  // row vanished at the first digit); choosing the filter again refreshes the list
  const [sticky, setSticky] = useState(() => new Set());
  const setFilter = k => { setFilterRaw(k); setSticky(k === 'missing' ? new Set(rows.filter(r => priceMissing(draft.players[r.id] || {})).map(r => r.id)) : new Set()); };
  // the roles of this list (Satılabilir / Stok) and role editing per row
  const norm = n => String(n || '').trim().toLocaleLowerCase('tr-TR');
  const listRoles = roles.filter(r => /^(satılabilir|sellable|stok|stock)/.test(norm(r.name)));
  const roleName = id => roles.find(r => r.id === id)?.name || id;
  const byId = useMemo(() => new Map(players.map(pl => [pl.id, pl])), [players]);
  const setRoles = async (id, next) => { try { await api.players.setRoles(id, next); } catch (e) { toast(e.message, 'error'); } };
  const [addQ, setAddQ] = useState('');
  const [pick, setPick] = useState(null); // { player, roleId }
  const inList = new Set(rows.map(r => r.id));
  const addSugg = addQ.trim().length < 2 ? [] : players.filter(pl => !inList.has(pl.id) && norm(pl.name).includes(norm(addQ))).slice(0, 8);
  useEffect(() => {
    if (!dirty) return;
    const h = setTimeout(async () => {
      try { await api.autoTrade.savePricing(draft); setDirty(false); }
      catch (e) { toast(e.message, 'error'); }
    }, 600);
    return () => clearTimeout(h);
  }, [draft, dirty]);
  const setDef = (kind, patch) => { setDraft(d => ({ ...d, defaults: { ...d.defaults, [kind]: { ...d.defaults[kind], ...patch } } })); setDirty(true); };
  const setPl = (id, patch) => { setDraft(d => ({ ...d, players: { ...d.players, [id]: { ...(d.players[id] || {}), ...patch } } })); setDirty(true); };
  // In-page question for "fire if not 5% off" (a native confirm left the price boxes deaf to
  // typing for a minute or two, user 2026-11-13)
  const [askFire, setAskFire] = useState(null);
  const clean = v => String(v).replace(/[^\d]/g, '');
  const def = draft.defaults;
  const fmt = d => `${Number(d.price).toLocaleString()} ${d.currency}`;
  const s = q.trim().toLocaleLowerCase('tr-TR');
  const list = rows.filter(r => {
    const own = draft.players[r.id] || {};
    if (s && !String(r.name).toLocaleLowerCase('tr-TR').includes(s)) return false;
    if (filter === 'missing') return priceMissing(own) || sticky.has(r.id);
    if (filter === 'sellable' || filter === 'stok') return r.kind === filter;
    if (filter === 'lv30') return own.lv30 || r.kind === 'stok';
    return true;
  });
  const missing = rows.filter(r => priceMissing(draft.players[r.id] || {})).length;
  return <div className="at2-pricing">
    <div className="panel at2-pricing-defaults"><p className="muted-text">{p.intro}</p>
      <h4>{p.defaults}</h4>
      <div className="at2-row">{['sellable', 'stok'].map(k => <label key={k}><span>{p[k]}</span><span className="bought-price"><PriceBox value={def[k].price} onChange={v => setDef(k, { price: v })} /><CurToggle value={def[k].currency} onChange={c => setDef(k, { currency: c })} /></span></label>)}</div>
      <small className="muted-text">{p.hint}</small>
    </div>
    {askFire && <div className="modal-backdrop" onClick={() => setAskFire(null)}><div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
      <p>{fill(p.fireNoDiscAsk, { name: askFire.name })}</p>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setAskFire(null)}>{x.cancel}</button><button className="btn danger" autoFocus onClick={() => { setPl(askFire.id, { fireNoDisc: true }); setAskFire(null); }}>{p.fireYes}</button></div>
    </div></div>}
    {pick && <div className="modal-backdrop" onClick={() => setPick(null)}><div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
      <div className="modal-head"><b>{p.chooseRole}</b></div>
      <p>{fill(p.chooseRoleText, { name: pick.player.name })}</p>
      <div className="role-pick">{listRoles.map(r => <label key={r.id} className="check-row"><input type="radio" name="at2-role" checked={pick.roleId === r.id} onChange={() => setPick(v => ({ ...v, roleId: r.id }))} /> {r.name}</label>)}</div>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setPick(null)}>{x.cancel}</button><button className="btn primary" disabled={!pick.roleId} onClick={async () => { const pl = pick.player; const rid = pick.roleId; setPick(null); setAddQ(''); await setRoles(pl.id, [...new Set([...(pl.roleIds || []), rid])]); }}>{p.select}</button></div>
    </div></div>}
    <div className="panel table-panel">
      <div className="ab-add"><input placeholder={p.addPlayer} value={addQ} onChange={e => setAddQ(e.target.value)} />
        {addSugg.length > 0 && <div className="ab-sugg">{addSugg.map(pl => <button key={pl.id} onClick={() => setPick({ player: pl, roleId: null })}><b>{pl.name}</b><small>{pl.team} · {pl.position} · {pl.rating} · {num(pl.value)}</small></button>)}</div>}
      </div>
      <div className="at2-pricing-bar">
        <input className="guide-search" placeholder={p.search} value={q} onChange={e => setQ(e.target.value)} />
        <div className="at2-chips">{[['all', p.fAll], ['missing', p.fMissing], ['sellable', p.fSellable], ['stok', p.fStok], ['lv30', p.fLv30]].map(([k, l]) => <button key={k} type="button" className={`at2-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}{k === 'missing' && missing > 0 ? ` (${missing})` : ''}</button>)}</div>
        <span className={missing ? 'warn-text' : 'muted-text'}>{missing ? fill(p.missing, { n: missing }) : p.allSet}</span>
      </div>
      {!rows.length ? <p className="muted-text">{p.none}</p> :
      <SortTable className="at2-pricing-table"><thead><tr><th>{p.player}</th><th>{p.role}</th><th>{p.value}</th><th>{p.valueDisc}</th><th>{p.base}</th><th>{p.price}</th><th>{p.discPrice}</th><th title={p.fireNoDiscHint}>{p.fireNoDisc}</th><th>{p.lv30}</th></tr></thead>
        <tbody>{list.map(r => { const own = draft.players[r.id] || {}; const d = def[r.kind]; return <tr key={r.id} className={priceMissing(own) ? 'at2-noprice' : ''}>
          <td><b>{r.name}</b><InjuryMark name={r.name} /> <span className="muted-text">{r.position}{r.team ? ` · ${r.team}` : ''}</span> <RatingBadge grade={r.rating} mini />{r.atBase && <span className="base-badge">BASE</span>}</td>
          <td className="at2-role-cell">{(byId.get(r.id)?.roleIds || []).filter(id => listRoles.some(l => l.id === id)).map(id => <span key={id} className="role-chip">{roleName(id)}<button type="button" className="link-btn" title={p.removeRole} onClick={() => setRoles(r.id, (byId.get(r.id)?.roleIds || []).filter(o => o !== id))}>×</button></span>)}
            {listRoles.some(l => !(byId.get(r.id)?.roleIds || []).includes(l.id)) && <select className="role-add" value="" onChange={e => e.target.value && setRoles(r.id, [...new Set([...(byId.get(r.id)?.roleIds || []), e.target.value])])}><option value="">{p.addRole}</option>{listRoles.filter(l => !(byId.get(r.id)?.roleIds || []).includes(l.id)).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}</td>
          <td>{num(r.value)}</td>
          <td>{r.value ? num(Math.round(Number(r.value) * 0.95)) : '—'}</td>
          <td>{num(r.base)}</td>
          <td title={own.fireNoDisc ? p.firedNoPrice : ''}><span className="bought-price"><PriceBox disabled={own.fireNoDisc} placeholder={own.fireNoDisc ? p.firedShort : fill(p.useDefault, { p: fmt(d) })} value={own.price} onChange={v => setPl(r.id, { price: v, currency: own.currency || d.currency })} /><CurToggle disabled={own.fireNoDisc} value={own.currency || d.currency} onChange={c => setPl(r.id, { currency: c })} /></span>{!own.price && !own.fireNoDisc && <small className="warn-text"> {p.noPrice}</small>}</td>
          <td><span className="bought-price"><PriceBox placeholder={p.sameAsPrice} value={own.discPrice} onChange={v => setPl(r.id, { discPrice: v, discCurrency: own.discCurrency || own.currency || d.currency })} /><CurToggle value={own.discCurrency || own.currency || d.currency} onChange={c => setPl(r.id, { discCurrency: c })} /></span>{!own.discPrice && <small className="warn-text"> {p.noDiscPrice}</small>}</td>
          <td title={p.fireNoDiscHint}><input type="checkbox" checked={Boolean(own.fireNoDisc)} onChange={e => { if (e.target.checked) setAskFire(r); else setPl(r.id, { fireNoDisc: false }); }} /></td>
          <td>{r.kind === 'stok' ? <span className="muted-text">{p.always}</span> : <input type="checkbox" checked={Boolean(own.lv30)} onChange={e => setPl(r.id, { lv30: e.target.checked })} />}</td>
        </tr>; })}</tbody></SortTable>}
    </div>
  </div>;
}

// Harcayıcı settings and a button that builds the friend network now (Auto Trade also does
// it by itself at the start of a cycle when accounts or roles changed).
function FriendNetRow({ x, form, set }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const sync = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await api.autoTrade.friendSync();
      setMsg(r?.skipped ? x.friendSyncSkipped : fill(x.friendSyncDone, { done: r?.done || 0, total: r?.total || 0, removed: r?.removed || 0 }));
    } catch (e) { setMsg(String(e?.message || e)); } finally { setBusy(false); }
  };
  return <section className="at2-row">
    <small className="at2-moved-note">{x.spenderPricesMoved}</small>
    <label><span>{x.spendersPerSide}</span><input type="number" min="1" max="20" step="1" value={form.spendersPerSide} onChange={e => set({ spendersPerSide: e.target.value.replace(/[^\d]/g, '') })} /><small>{x.spendersPerSideHint}</small></label>
    <label><span>{x.spenderMinTk}</span><input type="number" min="0" step="1" value={form.spenderMinTk} onChange={e => set({ spenderMinTk: e.target.value.replace(/[^\d]/g, '') })} /><small>{x.spenderMinTkHint}</small></label>
    <label><span>&nbsp;</span><button type="button" className="btn ghost small" disabled={busy} onClick={sync}>{busy ? x.friendSyncing : x.friendSync}</button>{msg && <small>{msg}</small>}</label>
  </section>;
}

// What the sides of each account role may sign (user 2026-10-31). Main has no limits; a
// role left as it is signs everything, like before.
function RoleRules({ state, x, form, set, selected, roles }) {
  const defs = roleDefs(state.settings).filter(d => d.id !== 'main');
  const profile = state.accountProfile || {};
  const count = id => (state.accounts || []).filter(a => selected.includes(a.id) && roleOf(a, profile, defs.concat([{ id: 'main' }])) === id).length;
  // a player role takes part when it routes players (one of the two role lists above)
  const routing = new Set([...(form.sideToMainRoleIds || []), ...(form.mainToSideRoleIds || [])]);
  const rule = id => ({ cheap: true, maxPrice: '', ...(form.roleRules?.[id] || {}), roles: { ...(form.roleRules?.[id]?.roles || {}) } });
  // a role column without its own value follows the old Satılabilir / Kart switches
  const roleOn = (r, pr) => (pr.id in r.roles ? r.roles[pr.id] !== false : !((form.sideToMainRoleIds || []).includes(pr.id) && r.card === false) && !((form.mainToSideRoleIds || []).includes(pr.id) && r.sellable === false));
  const patch = (id, p) => set({ roleRules: { ...(form.roleRules || {}), [id]: { ...rule(id), ...p } } });
  const cols = { gridTemplateColumns: `minmax(150px,1.6fr) repeat(${roles.length + 1}, 84px) 110px` };
  return <section className="at2-rolerules"><h4>{x.roleRules}</h4><small className="muted-text">{x.roleRulesHint}</small>
    <div className="at2-rr-table">
      <div className="at2-rr-head" style={cols}><span>{x.rrRole}</span>{roles.map(pr => <span key={pr.id} className={routing.has(pr.id) ? '' : 'off'} title={routing.has(pr.id) ? '' : x.rrUnused}><i className="role-dot" style={{ background: pr.color }} />{pr.name}</span>)}<span>{x.rrCheap}</span><span>{x.rrPrice}</span></div>
      {defs.map(d => { const r = rule(d.id); const n = count(d.id); return <div key={d.id} className={`at2-rr-row ${n ? '' : 'idle'}`} style={cols}>
        <span><RolePill def={d} /> <small className="muted-text">{n}</small></span>
        {roles.map(pr => <label key={pr.id} className={routing.has(pr.id) ? '' : 'off'}><input type="checkbox" disabled={!routing.has(pr.id)} checked={roleOn(r, pr)} onChange={e => patch(d.id, { roles: { ...r.roles, [pr.id]: e.target.checked } })} /></label>)}
        <label><input type="checkbox" checked={r.cheap !== false} onChange={e => patch(d.id, { cheap: e.target.checked })} /></label>
        <input type="number" min="0" max="2500" placeholder={form.maxPrice} value={r.maxPrice ?? ''} onChange={e => patch(d.id, { maxPrice: e.target.value.replace(/[^\d]/g, '') })} />
      </div>; })}
    </div>
  </section>;
}

function Preflight({ pre, x, decisions, setDecisions, onCancel, onStart, onPrepare, playerIndex, starting = false }) {
  const withBench = pre.accounts.filter(a => a.bench.length);
  const prepared = pre.accounts.filter(a => a.prepared);
  const anyDecision = Object.values(decisions || {}).some(d => Object.values(d || {}).some(v => v?.action && v.action !== 'none'));
  const setD = (aid, pid, patch) => setDecisions(d => ({ ...d, [aid]: { ...d[aid], [pid]: { ...d[aid][pid], ...patch } } }));
  // bulk choice (user 2026-11-18): only marks the radios, the bottom button still confirms
  const fits = (p, k) => k === 'none' || (p.fireOnly ? k === 'fire' : !p.block && (k !== 'trade' || Boolean(p.dir)));
  const bulk = (accs, k) => setDecisions(d => {
    const n = { ...d };
    for (const a of accs) { n[a.id] = { ...n[a.id] }; for (const p of a.bench) if (fits(p, k)) n[a.id][p.id] = { ...n[a.id][p.id], action: k }; }
    return n;
  });
  const BULK = [['list', x.bulkList], ['trade', x.bulkTrade], ['card', x.bulkCard], ['fire', x.bulkFire], ['none', x.bulkNone]];
  const bulkBar = (accs, label) => <div className="at2-bulk" title={x.bulkHint}><span className="muted-text">{label}</span>{BULK.map(([k, t]) => <button key={k} type="button" className={`btn ghost small ${k === 'fire' ? 'at2-fire' : ''}`} disabled={!accs.some(a => a.bench.some(p => k !== 'none' && fits(p, k)))} onClick={() => bulk(accs, k)}>{t}</button>)}</div>;
  return <div className="at2-pre">
    {pre.conflicts.length > 0 && <div className="at2-conflicts"><b>{x.conflictsTitle}</b><ul>{pre.conflicts.map((c, i) => <li key={i}>{x.conflict[c.kind] || c.kind}{c.name ? ` · ${c.name}` : ''}{c.accounts ? ` · ${c.accounts.join(', ')}` : ''}{c.startAt ? ` · ${new Date(c.startAt).toLocaleString()}` : ''}</li>)}</ul></div>}
    {prepared.length > 0 && <p className="muted-text at2-prepared">{fill(x.prepared, { time: new Date(prepared[0].prepared).toLocaleTimeString() })} · {prepared.map(a => a.name).join(', ')}</p>}
    {withBench.length ? <><b>{x.benchTitle}</b><small className="muted-text">{x.benchHint}</small>
      {bulkBar(withBench, x.bulkAll)}<small className="muted-text">{x.bulkHint}</small>
      {withBench.map(a => <div key={a.id} className="at2-bench"><h5>{a.name} · {num(a.funds)} TK</h5>{withBench.length > 1 && bulkBar([a], x.bulkAcc)}
        <SortTable className="at2-bench-table"><colgroup><col className="c-name" /><col className="c-num" /><col className="c-num" /><col className="c-num" /><col className="c-role" /><col className="c-dir" /><col className="c-act" /></colgroup><tbody>{a.bench.map(p => {
          const d = decisions[a.id]?.[p.id] || { action: 'none' };
          return <tr key={p.id}><td><b>{p.name}</b><InjuryMark name={p.name} /> <span className="muted-text">{p.position}</span> <RatingBadge grade={p.rating} mini />{isAtBase(moneyOf(p, playerIndex)) && <span className="base-badge">BASE</span>}</td><Money r={p} playerIndex={playerIndex} x={x} /><td>{p.roles.join(', ') || '—'}</td>
            <td>{p.fireOnly ? <span className="pill muted" title={x.fireOnlyHint}><i />{x.fireOnly}</span> : p.block ? <span className="pill muted"><i />{x.blocked[p.block]}</span> : <span className={`muted-text ${p.dir ? '' : 'bad-text'}`}>{p.dir === 'main' ? x.fitsMain : p.dir === 'side' ? x.fitsSide : x.fitsNone}</span>}</td>
            <td>{p.fireOnly ? <div className="at2-actions" title={x.fireOnlyHint}>{[['fire', x.actFire], ['none', x.actNone]].map(([k, label]) => <label key={k} className={k === 'fire' ? 'at2-fire' : ''}><input type="radio" name={`${a.id}-${p.id}`} checked={d.action === k} onChange={() => setD(a.id, p.id, { action: k })} />{label}</label>)}</div> : p.block ? null : <div className="at2-actions">
              {[['list', x.actList], ['trade', x.actTrade], ['card', x.actCard], ['fire', x.actFire], ['none', x.actNone]].map(([k, label]) => <label key={k} className={k === 'fire' ? 'at2-fire' : ''} title={k === 'card' ? x.cardHint : undefined}><input type="radio" name={`${a.id}-${p.id}`} checked={d.action === k} disabled={k === 'trade' && !p.dir} onChange={() => setD(a.id, p.id, { action: k })} />{label}</label>)}
              {d.action === 'list' && <span className="at2-price"><input type="number" min="1" value={d.price} onChange={e => setD(a.id, p.id, { price: e.target.value })} /><select value={d.currency} onChange={e => setD(a.id, p.id, { currency: e.target.value })}><option>APK</option><option>TIX</option></select></span>}
            </div>}</td></tr>;
        })}</tbody></SortTable></div>)}</> : <p className="muted-text">{x.noBench}</p>}
    <div className="modal-actions">
      {pre.mode === 'prep' && !anyDecision && <span className="muted-text actions-note">{x.prepAllNone}</span>}
      <button className="btn ghost" onClick={onCancel}>{x.cancel}</button>
      {pre.mode === 'prep' ? <>
        <button className={`btn ${pre.conflicts.length ? 'danger-soft' : 'primary'}`} title={x.prepHint} onClick={() => onPrepare(pre.conflicts.length > 0)}>{x.prepTop}</button>
      </> : <>
      {!starting && anyDecision && <button className="btn ghost" title={x.prepHint} onClick={() => onPrepare(pre.conflicts.length > 0)}>{x.prepBtn}</button>}
      {starting ? <span className="pill warn"><i />{x.starting}</span> : pre.conflicts.length ? <button className="btn danger-soft" onClick={() => onStart(true)}>{x.stopAndStart}</button> : <button className="btn primary" onClick={() => onStart(false)}>{x.startNow}</button>}
      </>}
    </div>
  </div>;
}

function AccountBoard({ acc, x, highlight, playerIndex }) {
  const rows = Object.values(acc.players || {});
  return <div className={`panel at2-board ${highlight ? 'hl' : ''} st-${acc.status}`}>
    <div className="at2-board-head">
      <div><b>{acc.name}</b> <span className={`at2-role ${acc.role}`}>{acc.role === 'main' ? 'MAIN' : acc.role === 'spender' ? 'HARCAYICI' : 'SIDE'}</span></div>
      <span className={`pill ${acc.status === 'active' ? 'ok' : acc.status === 'skipped' ? 'bad' : 'muted'}`}><i />{x.accStatus[acc.status] || acc.status}</span>
    </div>
    <div className="at2-board-meta"><span>{x.tk}: <b>{num(acc.funds)}</b></span><span>{x.openTime}: <b>{dur(acc.openSeconds)}</b></span><span>{x.visits}: <b>{acc.visits}</b></span>{acc.scout?.attemptsLeft != null && <span>Call back: <b>{acc.scout.attemptsLeft}</b></span>}</div>
    {rows.length ? <div className="at2-table"><SortTable><thead><tr><th>{x.player}</th><th>{x.value}</th><th>{x.salary}</th><th>{x.base}</th><th>{x.role}</th><th>{x.stateCol}</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td><b>{r.name}</b><InjuryMark name={r.name} />{isAtBase(moneyOf(r, playerIndex)) && <span className="base-badge">BASE</span>}{r.from && <span className="muted-text"> · {x.from}: {r.from}</span>}</td><Money r={r} playerIndex={playerIndex} x={x} /><td>{r.roles?.join(', ') || (r.dir === 'main' ? '≤ ' + x.price : '—')}</td><td><span className={`pill ${STATUS_TONE[r.status] || 'muted'}`}><i />{x.pstatus[r.status] || r.status}</span></td></tr>)}</tbody></SortTable></div>
      : <p className="muted-text at2-noplayers">{x.noPlayers}</p>}
  </div>;
}

// Accounts with the same name prefix in one row that opens (user 2026-11-13); the group row
// shows the totals of its accounts.
function Summary({ run, x }) {
  const grp = useGroupedRows('at-summary');
  const sum = (list, k) => list.reduce((n, a) => n + (Number(a?.[k]) || 0), 0);
  const rows = [...run.config.accountIds.map(id => run.accounts[id]), ...Object.values(run.accounts).filter(a => a?.role === 'spender' && !run.config.accountIds.includes(a.id))].filter(Boolean);
  return <><h3 className="section-title">{x.summary}</h3>
    <div className="panel table-panel"><SortTable><thead><tr><th></th><th>{x.bought}</th><th>{x.spent}</th><th>{x.converted}</th><th>{x.tradedOut}</th><th>{x.tradedIn}</th><th>{x.tkPaid}</th><th>{x.tkReceived}</th><th>{x.listed}</th><th>{x.tkNow}</th><th>{x.openTime}</th></tr></thead>
      <tbody>{grp(rows, a => <tr key={a.id}><td><b>{a.name}</b> <span className={`at2-role ${a.role}`}>{a.role === 'main' ? 'MAIN' : a.role === 'spender' ? 'HARCAYICI' : 'SIDE'}</span></td><td>{a.bought}</td><td>{num(a.spent)}</td><td>{a.converted}</td><td>{a.tradesOut}</td><td>{a.tradesIn}</td><td>{num(a.tkPaid)}</td><td>{num(a.tkReceived)}</td><td>{a.listed}</td><td>{num(a.fundsStart)} → <b>{num(a.funds)}</b></td><td>{dur(a.openSeconds)}</td></tr>,
        groupRowOf(11, g => <><td><b>{sum(g, 'bought')}</b></td><td><b>{num(sum(g, 'spent'))}</b></td><td><b>{sum(g, 'converted')}</b></td><td><b>{sum(g, 'tradesOut')}</b></td><td><b>{sum(g, 'tradesIn')}</b></td><td><b>{num(sum(g, 'tkPaid'))}</b></td><td><b>{num(sum(g, 'tkReceived'))}</b></td><td><b>{sum(g, 'listed')}</b></td><td>{num(sum(g, 'fundsStart'))} → <b>{num(sum(g, 'funds'))}</b></td><td>{dur(sum(g, 'openSeconds'))}</td></>))}</tbody></SortTable></div></>;
}

function CardCounts({ run, totals, x, Modal, toast }) {
  const [confirm, setConfirm] = useState(false);
  // folds away like the live boards (user 2026-11-13); remembered
  const [show, setShow] = useState(() => { try { return localStorage.getItem('at2.showCards') !== '0'; } catch { return true; } });
  const toggleShow = () => setShow(v => { try { localStorage.setItem('at2.showCards', v ? '0' : '1'); } catch {} return !v; });
  const ids = [...new Set([...Object.keys(run.cardCounts || {}), ...Object.keys(totals)])];
  if (!ids.length) return null;
  const reset = async () => { try { await api.autoTrade.resetCards(); } catch (e) { toast(e.message, 'error'); } setConfirm(false); };
  const rows = ids.map(id => ({ id, name: run.cardCounts?.[id]?.name || totals[id]?.name, now: run.cardCounts?.[id]?.count || 0, total: totals[id]?.count || 0 })).sort((a, b) => b.now - a.now || b.total - a.total);
  return <><div className="at2-section-head"><h3 className="section-title"><button type="button" className="link-btn" aria-expanded={show} onClick={toggleShow}>{show ? '▾' : '▸'} {x.cards}</button>{!show && <small className="muted-text"> · {x.liveHidden}</small>}</h3><button className="btn ghost small" onClick={() => setConfirm(true)}>{x.resetCards}</button></div>
    {/* Spreadsheet-like cells as wide as the longest name: "name" on top, "this run/total" small at the bottom left. */}
    {show && <div className="panel at2-cells" style={{ '--cell': `${Math.max(10, ...rows.map(r => String(r.name || '').length)) + 3}ch` }}>
      <div className="at2-cells-legend"><b>3/8</b> = {x.thisRun} / {x.total}</div>
      <div className="at2-cells-grid">{rows.map(r => <div key={r.id} className={`at2-cell ${r.now ? 'now' : ''}`} title={`${r.name} · ${x.thisRun} ${r.now} · ${x.total} ${r.total}`}><span>{r.name}<InjuryMark name={r.name} /></span><b>{r.now}/{r.total}</b></div>)}</div>
    </div>}
    {confirm && <Modal title={x.resetCards} onClose={() => setConfirm(false)}><p>{x.resetCardsConfirm}</p><div className="modal-actions"><button className="btn ghost" onClick={() => setConfirm(false)}>{x.cancel}</button><button className="btn danger-soft" onClick={reset}>{x.yes}</button></div></Modal>}</>;
}

const defaultListing = (row, run, defaults) => {
  const stock = (row.roleIds || []).some(r => r !== 'sellable' && (run.config.mainToSideRoleIds || []).includes(r));
  return { ...(stock ? defaults?.stock : defaults?.sellable) || { price: 20, currency: 'APK' } };
};

// Salary, value (price) and Base of a kept player; the Oyuncular list fills in what
// an older run row does not carry.
function moneyOf(r, playerIndex) {
  const p = playerIndex?.get(r.id);
  // value = the player's value from the Oyuncular list (never the Scout price paid)
  return { salary: r.salary ?? null, value: p?.value ?? r.value ?? null, base: r.base ?? p?.base ?? null };
}
// Value · salary · Base cells (salary = what was actually signed).
function Money({ r, playerIndex }) {
  const m = moneyOf(r, playerIndex);
  return <><td>{num(m.value)}</td><td><b>{num(m.salary)}</b></td><td>{num(m.base)}</td></>;
}
// Same rule as Trading Hall's BASE badge: salary at or below Base.
const isAtBase = m => m.salary != null && m.base > 0 && Number(m.salary) <= Number(m.base);

function ListingPanel({ run, x, defaults, toast, playerIndex, Modal }) {
  const sides = run.config.accountIds.map(id => run.accounts[id]).filter(a => a && a.role === 'side' && a.status !== 'active');
  const items = sides.map(a => ({ acc: a, rows: Object.values(a.players || {}).filter(r => r.status === 'keep') })).filter(s => s.rows.length);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(null);
  const [fireAsk, setFireAsk] = useState(null); // { acc, r }
  const [firing, setFiring] = useState(null);
  const fire = async ({ acc, r, rows }) => {
    setFireAsk(null);
    setFiring(rows ? 'all:' + acc.id : r.id);
    try { if (rows) await api.autoTrade.firePlayers(acc.id, rows.map(p => p.id)); else await api.autoTrade.firePlayer(acc.id, r.id); } catch (e) { toast(e.message, 'error'); } finally { setFiring(null); }
  };
  if (!items.length) return null;
  const get = (r) => ({ checked: true, ...defaultListing(r, run, defaults), ...edits[r.id] });
  const edit = (id, patch) => setEdits(e => ({ ...e, [id]: { ...e[id], ...patch } }));
  // one row's own button lists it whether it is ticked or not
  const list = async (acc, rows, all = false) => {
    const chosen = rows.filter(r => all || get(r).checked).map(r => ({ id: r.id, price: Number(get(r).price), currency: get(r).currency }));
    if (!chosen.length) return;
    setBusy(acc.id);
    try { await api.autoTrade.listPlayers(acc.id, chosen); } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };
  return <><h3 className="section-title">{x.listTitle} <small>{x.listHint}</small></h3>
    {items.map(({ acc, rows }) => <div key={acc.id} className="panel table-panel at2-list"><div className="at2-list-head"><b>{acc.name}</b><span className="at2-list-btns"><button className="btn danger-soft" disabled={busy === acc.id || !!firing} onClick={() => setFireAsk({ acc, rows })}>{firing === 'all:' + acc.id ? x.firing : x.fireAll}</button><button className="btn primary" disabled={busy === acc.id || !!firing} onClick={() => list(acc, rows)}>{x.listSelected}</button></span></div>
      <SortTable className="at2-list-table"><colgroup><col style={{ width: 40 }} /><col style={{ width: 260 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 170 }} /><col style={{ width: 120 }} /><col style={{ width: 90 }} /><col style={{ width: 170 }} /></colgroup><thead><tr><th></th><th>{x.player}</th><th>{x.salary}</th><th>{x.value}</th><th>{x.base}</th><th>{x.role}</th><th>{x.listPrice}</th><th></th><th></th></tr></thead><tbody>{rows.map(r => { const v = get(r); const m = moneyOf(r, playerIndex); return <tr key={r.id}><td><input type="checkbox" checked={v.checked} onChange={e => edit(r.id, { checked: e.target.checked })} /></td><td><b>{r.name}</b><InjuryMark name={r.name} />{isAtBase(m) && <span className="base-badge">BASE</span>}</td><td>{num(m.salary)}</td><td>{num(m.value)}</td><td>{num(m.base)}</td><td>{r.roles?.join(', ')}</td><td><input className="eq-small" type="number" min="1" value={v.price} onChange={e => edit(r.id, { price: e.target.value })} /></td><td><select value={v.currency} onChange={e => edit(r.id, { currency: e.target.value })}><option>APK</option><option>TIX</option></select></td><td className="actions"><button className="btn primary small" disabled={busy === acc.id || !!firing || !(Number(v.price) > 0)} onClick={() => list(acc, [r], true)}>{x.listOne}</button><button className="btn danger-soft small" disabled={!!firing || busy === acc.id} onClick={() => setFireAsk({ acc, r })}>{firing === r.id ? x.firing : x.fireOne}</button></td></tr>; })}</tbody></SortTable></div>)}
    {fireAsk && <Modal title={fireAsk.rows ? fill(x.fireAllTitle, { account: fireAsk.acc.name }) : fill(x.fireOneTitle, { name: fireAsk.r.name })} onClose={() => setFireAsk(null)} width={460}>
      {fireAsk.rows ? <><p className="bad-text">{fill(x.fireAllAsk, { n: fireAsk.rows.length, account: fireAsk.acc.name })}</p><ul className="fire-list">{fireAsk.rows.map(p => <li key={p.id}><b>{p.name}</b><InjuryMark name={p.name} /> <span className="muted-text">{p.position}</span></li>)}</ul></> : <p>{fill(x.fireOneAsk, { name: fireAsk.r.name, account: fireAsk.acc.name })}</p>}
      <div className="modal-actions"><button className="btn ghost" onClick={() => setFireAsk(null)}>{x.fireOneNo}</button><button className="btn danger-soft" onClick={() => fire(fireAsk)}>{x.fireOneYes}</button></div>
    </Modal>}</>;
}

// A signed player with roles both ways (e.g. Satılabilir + Kart): the user picks the way.
function RoleModal({ req, x, Modal }) {
  const p = req.player;
  return <Modal title={fill(x.roleModal, { name: req.name })} onClose={() => {}} width={520}>
    <p><b>{p.name}</b><InjuryMark name={p.name} /> · {x.salary} {num(p.salary)} · {x.base} {num(p.base)}</p>
    <p className="muted-text">{fill(x.roleModalHint, { roles: (p.roles || []).join(', ') })}</p>
    <div className="modal-actions"><button className="btn ghost" onClick={() => api.autoTrade.respondRole(null)}>{x.roleLeave}</button><button className="btn ghost" onClick={() => api.autoTrade.respondRole('side')}>{x.roleSide}</button><button className="btn primary" onClick={() => api.autoTrade.respondRole('main')}>{x.roleMain}</button></div>
  </Modal>;
}

function ListingModal({ req, x, Modal, playerIndex }) {
  // every player needs one of: list (with a price) · fire · hold
  const [rows, setRows] = useState(() => req.players.map(p => ({ ...p, action: null })));
  const [sending, setSending] = useState(false);
  const edit = (i, patch) => setRows(r => r.map((v, j) => j === i ? { ...v, ...patch } : v));
  const all = action => setRows(r => r.map(v => ({ ...v, action })));
  const open = rows.filter(r => !r.action).length;
  const badPrice = rows.some(r => r.action === 'list' && !(Number(r.price) >= 1));
  const fires = rows.filter(r => r.action === 'fire').length;
  const send = async () => {
    setSending(true);
    try { await api.autoTrade.respondListing(rows.map(r => ({ id: r.id, action: r.action, price: Number(r.price), currency: r.currency }))); } finally { setSending(false); }
  };
  const ACTS = [['list', x.actList2, 'ok'], ['fire', x.actFire2, 'bad'], ['hold', x.actHold, 'muted']];
  return <Modal title={fill(x.listingModal, { name: req.name })} onClose={() => {}} width={860}>
    <p className="muted-text">{x.listingModalHint}</p>
    <div className="at2-lm-all"><span>{x.allAs}</span>{ACTS.map(([a, label]) => <button key={a} type="button" className="btn ghost small" onClick={() => all(a)}>{label}</button>)}</div>
    <SortTable className="at2-modal-table at2-lm-table"><thead><tr><th>{x.player}</th><th>{x.salary}</th><th>{x.value}</th><th>{x.base}</th><th>{x.role}</th><th data-nosort>{x.stateCol}</th><th data-nosort>{x.priceShort}</th></tr></thead><tbody>{rows.map((r, i) => { const m = moneyOf(r, playerIndex); return <tr key={r.id} className={r.action ? `at2-lm-${r.action}` : 'at2-lm-open'}>
      <td><b>{r.name}</b><InjuryMark name={r.name} />{isAtBase(m) && <span className="base-badge">BASE</span>}</td><td>{num(m.salary)}</td><td>{num(m.value)}</td><td>{num(m.base)}</td><td>{(r.roles || []).join(', ')}</td>
      <td><span className="at2-lm-acts">{ACTS.map(([a, label, tone]) => <button key={a} type="button" className={`at2-lm-act ${tone} ${r.action === a ? 'on' : ''}`} onClick={() => edit(i, { action: a })}>{label}</button>)}</span></td>
      <td>{r.action === 'list' ? <span className="bought-price"><input type="number" min="1" step="1" value={r.price} onChange={e => edit(i, { price: e.target.value.replace(/[^\d]/g, '') })} /><span className="currency-toggle">{['APK', 'TIX'].map(c => <button type="button" key={c} className={r.currency === c ? 'on' : ''} onClick={() => edit(i, { currency: c })}>{c}</button>)}</span></span> : <span className="muted-text">—</span>}</td>
    </tr>; })}</tbody></SortTable>
    <div className="modal-actions">
      {open > 0 && <span className="warn-text">{fill(x.chooseAll, { n: open })}</span>}
      {fires > 0 && <span className="bad-text">{fill(x.fireWarn, { n: fires })}</span>}
      <button className="btn primary" disabled={open > 0 || badPrice || sending} onClick={send}>{x.okGo}</button>
    </div>
  </Modal>;
}
