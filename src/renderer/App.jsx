import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { filterTradingRows, hasTradingSortData, sortTradingRows } from './trading-sort.mjs';
import PlayersPage from './components/PlayersPage';
import DraftPage from './components/DraftPage';
import PvpPanel from './components/PvpPanel';
import GuidePage from './components/GuidePage';
import PvpPage from './components/PvpPage';
import AutoBuyPage from './components/AutoBuyPage';
import TowerPage from './components/TowerPage';
import { BuyMenu, BoughtList } from './components/BuyParts';
import HomePage from './components/HomePage';
import EquipmentPage from './components/EquipmentPage';
import AutoTradePage from './components/AutoTradePage';

const api = window.dreamteam;
const clockSubscribers = new Set();
let clockNow = Date.now();
let clockTimer = null;
const readClock = () => clockNow;
function subscribeClock(listener) {
  clockSubscribers.add(listener);
  if (!clockTimer) clockTimer = setInterval(() => {
    if (document.hidden) return;
    clockNow = Date.now();
    for (const notify of clockSubscribers) notify();
  }, 1000);
  const onVisible = () => { clockNow = Date.now(); for (const notify of clockSubscribers) notify(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clockSubscribers.delete(listener);
    document.removeEventListener('visibilitychange', onVisible);
    if (!clockSubscribers.size && clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  };
}
const GRADE_ORDER = ['N','D-','D','D+','C-','C','C+','B-','B','B+','A-','A','A+','S-','S','S+'];
const gradeRank = g => GRADE_ORDER.indexOf(String(g || '').toUpperCase());

const TEXT = {
  tr: {
    lang:'tr',
    market:'Pazar', startAll:'Tümünü Başlat', stopAll:'Tümünü Durdur', marketApkPending:'APK doğrulaması bekleniyor · Tekrar Tara',
    marketSubtitle:'Hesapların My Listings ilanlarını tarar', marketOpenAll:'Tümünü Aç', marketCloseAll:'Tümünü Kapat', marketOpenSelected:'Seçilileri Aç', marketCloseSelected:'Seçilileri Kapat', marketScan:'Tara', marketRescan:'Tekrar Tara', marketClaim:'Satışları Topla', marketSold:'Satılanlar', marketListed:'Satışta Olanlar', marketExpired:'Stoklananlar', marketSalePrice:'İlan fiyatı', marketNoRows:'Henüz ilan taranmadı.', marketScanning:'Taranıyor', marketClaiming:'Toplanıyor', marketOpen:'Açık', marketClosed:'Kapalı',
    autoTradeSubtitle:'Hesaplar, yönlendirme ve canlı sonuçlar', autoTradeChooseMain:'Hesaplar sayfasından seç', autoTradeSortedByTk:'Kayıtlı TK değerine göre sıralanır', autoTradePriceHint:'Rollerden bağımsız', autoTradeNoSides:'Yan hesap eklenmedi.', autoTradeRules:'Oyuncu kuralları', autoTradeRuleHint:'Scout tüm rolleri alır; aşağıdaki seçimler aktarımı belirler', autoTradePriceHelp:'Bu fiyat veya altındaki Scout oyuncuları Main hesabına gider ve karta çevrilir. Roller fiyatla sınırlanmaz.', autoTradeCardDest:'Main hesabında karta çevrilir', autoTradeOptional:'Seçim isteğe bağlı', autoTradeRoom:'Trade odası', autoTradeRoomHint:'İşlem sırasında kullanılır', autoTradeLive:'Anlık işlem takibi', autoTradePhase:'Aşama', autoTradeNoRun:'Henüz Auto Trade başlatılmadı.', autoTradeSystem:'Sistem', autoTradeVerifiedEvents:'doğrulanmış işlem', autoTradeNoRoles:'Rol bulunamadı', autoTradeConflicts:'Çakışan işlemler:', autoTradeStopConflicts:'Bu işlemler durdurulup Auto Trade başlatılsın mı?', autoTradeTkEstimate:'Doğrulanmış transfer fiyatlarından hesaplandı; sonraki girişte güncellenecek.', autoTradeRoleConflict:'Aynı rol iki transfer yönünde seçilemez.', autoTradeResumeSide:'Bu Side ile Devam Et', autoTradeDeferred:'Ertelenen hesaplar', autoTradeVerifyPending:'Yarım Kalan Trade’i Doğrula', 
    home:'Ana Sayfa', towerPage:'Kule', towerStopped:'Kule durduruldu', towerSalaryCap:'Takım maaş sınırını aştığı için kule bu hesapta durduruldu.', pvpPage:'PVP Arena', autoBuyPage:'Auto Buy', navAutomation:'Otomasyon', navPlayers:'Oyuncular & Takım', navMarket:'Pazar', navApp:'Uygulama', guide:'Rehber', guideHint:'Her sayfanın ve düğmenin ne işe yaradığını sade bir dille anlatır.', guideOpen:'Rehberi aç', accounts:'Hesaplar', autoplay:'Auto Play', autoTrade:'Auto Trade', scout:'Scout', trade:'Trading Hall', cards:'Kartlar', activity:'Aktivite', settings:'Ayarlar',
    addAccount:'Hesap Ekle', edit:'Düzenle', delete:'Sil', start:'Başlat', stop:'Durdur', status:'Durum', account:'Hesap', login:'E-posta / kullanıcı adı', password:'Şifre', name:'Ad', save:'Kaydet', cancel:'İptal', close:'Kapat', refresh:'Yenile', reset:'Sıfırla',
    stopped:'Durduruldu', running:'Çalışıyor', preparing:'Hazırlanıyor', error:'Hata', next:'Sonraki', browser:'Tarayıcı', visible:'Görünür', hidden:'Gizli', showBrowser:'Göster', dailyReward:'Daily Reward', rewardChecking:'Kontrol', rewardClaiming:'Alınıyor', rewardDeferred:'Bekliyor', rewardUnknown:'Bilinmiyor', rewardResetWait:'19.00 bekleniyor', rewardCompleted:'6/6 tamamlandı', dailyRoutine:'Günlük', equipment:'Ekipman', playersPage:'Oyuncular', draftPage:'Draft', modifiedTeam:'Değiştirilmiş', teamOriginal:'orijinal', teamNone:'Takımsız (No Team)', teamAssignHint:'Takım ata ya da takımdan çıkar. Auto Trade bu takımı kullanır; bu sayfada oyuncu Değiştirilmiş takımında görünür.', tasksColumn:'Görevler', tasksDaily:'Günlük', tasksAlliance:'İttifak', tasksNotStarted:'Başlatılmadı', tasksReadyHint:'Toplanmayı bekleyen ödül', tasksUpdated:'Güncellendi', tasksRefresh:'Görevleri yenile', tasksRefreshing:'Yenileniyor…', claimRewards:'Ödülleri topla', claimingRewards:'Toplanıyor…', claimRewardsHint:'Tamamlanmış günlük görevlerin ödüllerini toplar (seçili hesaplar; seçim yoksa Günlük sütununda işaretli olanlar). Auto Play çalışırken 30 dakikada bir kendiliğinden de yapılır.', dailyRoutineHint:'Auto Play 19:10 sonrası başlayınca ya da çalışırken saat 19:12 olunca önce Daily Signin, 600-Day Sign In, günlük görevler ve 1 Friendly Match yapılır; tamamlanan görevlerin ödülleri 30 dakikada bir toplanır', dailyDone:'Bugün tamam', dailyPending:'19:12 / Auto Play başlayınca', dailyFailed:'Eksik', dailyPhase:'Günlük rutin',
    attempts:'Yenileme', roster:'Roster', callback:'Call Back', refreshScout:'Scout Yenile', closeScout:'Scout Kapat', price:'Price', team:'Takım', position:'Mevki', grade:'Grade', card:'Kart', buy:'Satın Al', signed:'Alındı', openScout:'Scout Aç', chooseAccount:'Hesap seç', scoutClosed:'Scout kapalı',
    tradeAccount:'Trade Hesabı', configure:'Ayarla', stopAtPrice:'Stop at price', scanCurrency:'Scan Currency', refreshHall:'Refresh Trading Hall', seller:'Satıcı', salary:'Salary', base:'Base', value:'Value', currency:'Currency', presets:'Hazır filtreler', filters:'Filtreler', addPreset:'Filtre ekle', managePresets:'Düzenle', noRows:'Sonuç yok', listings:'ilan', page:'sayfa',
    language:'Dil', auto:'Otomatik', turkish:'Türkçe', english:'English', dataFolder:'Veri klasörü', debugBrowser:'Auto Play tarayıcısını görünür aç',
    cardsEmpty:'Kart verisi yok.', cardScanLater:'Ana hesabı seçip Yenile ile Star Cards verisini tara.',
    clear:'Temizle', schedule:'Zamanla', at:'Saat', prepare:'Hazırlık', minutes:'dk', seconds:'sn', all:'Tümü',
    dashboardAccounts:'Hesaplar', dashboardRunning:'Aktif Auto Play', dashboardScout:'Açık Scout', dashboardTrade:'Trading Hall', usableApk:'Kullanılabilir APK', usableTix:'Kullanılabilir TIX', marketKind:'Tür', marketKind_recent:'Satıştaydı', marketKind_stock:'Stok', marketKind_onSale:'Satışta', marketKind_owned:'Kadroda var', marketProgressRelist:'Pazara ekleniyor', marketProgressClaim:'Satışlar toplanıyor', marketProgressScan:'Taranıyor', mainBadge:'ANA', browserOpenShort:'Açık', browserClosedShort:'Kapalı', playerMarket:'Oyuncu Pazarı', scheduleTask:'Görev', scheduleNoTask:'Görev bulunamadı.', scheduleMode:'Çalışma şekli', scheduleParallel:'Aynı anda', scheduleStaggered:'Sırayla', scheduleDelay:'Bekleme', 'builtin_tournament-register':'Turnuva kaydı', 'builtin_market-claim':'Pazar: satışları topla', 'builtin_market-relist':'Pazar: dünkü ilanları tekrar listele', 'builtin_pvp-arena':'PVP Arena (haklar bitene kadar)', pmRoleSellable:'Satılabilir', pmRoleStock:'Stok', pmRoleCard:'Kart', pmSortName:'Oyuncu adı', pmSortBaseNear:'Base’e en yakın', pmSortBaseFar:'Base’den en uzak', pmSortUp:'En çok yükselen', pmSortDown:'En çok düşen', pmSortLargest:'En büyük değişim', pmList:'Oyuncu Listesi', pmAccount:'Player Market Hesabı', pmAccountName:'Hesap adı', pmLogin:'Kullanıcı adı', pmPasswordChange:'Şifreyi değiştirmek için gir', pmPassword:'Şifre', pmSaveAccount:'Hesabı Kaydet', pmStartScan:'Taramayı Başlat', pmScanning:'Oyuncular taranıyor…', pmPage:'Sayfa', pmPlayer:'Oyuncu', pmSearch:'Oyuncu ara...', pmAllRoles:'Tüm roller', pmAllPositions:'Tüm pozisyonlar', pmAllRatings:'Tüm ratingler', pmNearBase:'Base’e % kaç yakın?', pmColPlayer:'Oyuncu', pmColDiff:'Fark', pmColChange:'Değişim', pmColRole:'Rol', pmNoRole:'Rol yok', marketSubtitleNew:'Satışları tara, topla ve süresi dolan oyuncuları tekrar listele · tarayıcı açmadan', marketTabSales:'Satışlar', marketTabRelist:'Tekrar Listele', marketTabListings:'İlanlar · Tekrar Listele', marketExpiredTitle:'Expired (süresi dolan)', marketListedTitle:'Listede (satılmayı bekleyen) · fiyatını değiştirmek için yeni fiyat girip seç', marketNoRows:'Henüz tarama yok · hesap seçip Tara butonuna bas.', marketScanSelected:'Seçilileri Tara', marketClaimSelected:'Seçililerin Satışlarını Topla', marketClaimSoldOnly:'Sadece satışı olanları topla', marketClaimSoldOnlyHint:'Yalnızca son taramada satış bulunan hesaplara girer; diğer hesaplar yeniden taranmaz.', marketLastScan:'Son tarama', marketSoldTitle:'Satılanlar (toplanmayı bekleyen)', marketNoSold:'Toplanacak satış yok.', marketLoadExpired:'İlanları getir (Expired + Listede)', marketRelistSelected:'Seçilileri listele / fiyatı güncelle', marketParallel:'Aynı anda hesap', marketParallelHint:'Tekrar listelerken aynı anda kaç hesabın çalışacağı. Son girilen değer hatırlanır.', marketRelistReport:'Son listeleme', marketRelistListed:'listelendi', marketRelistOwned:'kadroda var', marketRelistFailed:'başarısız', marketRelistRemovedNotListed:'pazardan çıktı ama listelenemedi (kadroda)', marketOldPrice:'Önceki fiyat', marketNewPrice:'Yeni fiyat', marketExpiredCount:'expired oyuncu', marketRelistEmpty:'Hesap seçip "Seçilileri Tara" düğmesine bas.', marketInvalidPrice:'Geçersiz fiyat', marketRelist_ready:'Hazır', marketRelist_queued:'Sırada', marketRelist_removing:'Pazardan çıkarılıyor', marketRelist_listing:'Listeleniyor', marketRelist_listed:'Listelendi', marketRelist_owned:'Kadroda var', marketRelist_failed:'Başarısız', marketRelist_removedNotListed:'Çıktı ama listelenemedi', marketRelist_stopped:'Durduruldu', dragToReorder:'Sürükleyerek sırala (↑/↓ tuşlarıyla da taşınır)', scheduleTaskHelp:'Saat gelince seçili hesaplarda çalışan görevler durdurulur, hazırlık süresi kadar beklenir, görev çalışır; bitince durdurulan görevler tekrar başlatılır.', tournament:'Turnuva', tournamentSubtitle:'Seçili hesapları levelına uygun turnuvalara kaydeder · bugünün turnuvası bitince yeni kaydı bekler', tournamentStart:'Turnuvalara Katıl', tournamentReload:'Listeyi Yenile', tournamentDetail:'Ne yapıyor', tournamentJoined:'Bu çalıştırmada katıldı', tournamentList:'Turnuvalar', tournamentPlayers:'Oyuncu', tournamentStarts:'Başlangıç (TR)', tournamentOurAccounts:'Kayıtlı hesaplarımız', tournamentFull:'Dolu', tournament_queued:'Sırada', tournament_login:'Giriş', tournament_ready:'Hazır', tournament_registering:'Kayıt oluyor', tournament_waiting:'Bekliyor', tournament_done:'Bitti', tournament_error:'Hata', tournament_stopped:'Durduruldu', tournamentReport:'Son çalıştırma raporu', tournamentSourceManual:'Elle başlatıldı', tournamentSourceSchedule:'Zamanlamadan', tournamentReportOk:'Kaydoldu', tournamentOutcome_registered:'Kaydoldu', tournamentReportNotOk:'Kaydolmadı', tournamentOutcome_already:'Zaten kayıtlıydı', tournamentOutcome_full:'Turnuva dolu', tournamentOutcome_refused:'Sunucu reddetti', tournamentOutcome_error:'Hata', tournamentOutcome_timeout:'Süre doldu', tournamentOutcome_stopped:'Durduruldu', tournamentOutcome_nothing:'Açık turnuva yok', 'tournamentOutcome_no-tournament':'Level\'a uygun turnuva yok', tradeFailed:'Hata', tradeStopped:'Durduruldu', baseOnly:'Base only', baseOnlyHint:'Oyundaki "Base only" ile aynı ilanlar', basePctMax:'Base % ≤', basePctHint:'Salary\'nin base\'den yüzde farkı. Negatif = base\'in altında', activityAllServices:'Tüm servisler', activityServiceFilter:'Servis',
    tradeRunning:'Taranıyor', completed:'Tamamlandı', idle:'Bekliyor', signConfirm:'Bu oyuncu satın alınsın mı?', removeConfirm:'Hesap silinsin mi?', autoPlayStopped:'Auto Play durduruldu', salaryCapWarning:'Takım maaş sınırını aştığı için Quick Play otomatik olarak durduruldu.',
    mainAccount:'Ana Hesap', makeMain:'Ana Yap', level:'LV', exp:'EXP', tk:'TK', apk:'APK', tix:'TIX', apkContribution:'APK Katkı', tixContribution:'TIX Katkı', lastUpdate:'Son güncelleme',
    roles:'Roller', addRole:'Rol Ekle', trackedTeams:'Takip Edilen Takımlar', trackedOnly:'Sadece takip edilenler', teamDevelopment:'Takım Gelişimi', players:'Oyuncular', stars:'Yıldız', progress:'Sonraki Yıldız', ready:'Hazır', teamNeeded:'Takım için gerekli', raisesTeam:'Takımı yükseltir', inactive:'Pasif', scannerWaiting:'Ana hesap seç', resetCards:'Kart Verisini Sıfırla', resetCardsConfirm:'Taranan kart verileri, oyuncu rol eşleşmeleri ve takip edilen takımlar silinsin mi? Rol isimleri korunur.', scanningCards:'Taranıyor…', cardTeamsTab:'Takımlar', cardPlayersTab:'Oyuncu Listesi', filterTeams:'Takım', filterStars:'Yıldız', filterRoles:'Rol', searchName:'İsim ara', rating:'Rating', cardCount:'Kart Sayısı', chooseColor:'Renk',
    openSelectedScouts:'Seçilileri Aç', refreshSelectedScouts:'Seçilileri Yenile', closeSelectedScouts:'Seçilileri Kapat', closeAllScouts:'Tümünü Kapat', selectAll:'Tümünü seç', selected:'seçili', scoutSearch:'Oyuncu / takım ara', maxPrice:'Maks. Price', minGrade:'Min. Grade', roleFilter:'Rol', noScoutData:'Scout açılmadı', noScoutMatch:'Filtreye uyan oyuncu yok', playerDetails:'Oyuncu Detayı', scoutAccounts:'hesap', detail:'Detay', activityAccountFilter:'Hesap', activityTypeFilter:'Tür', activityAllAccounts:'Tüm hesaplar', activityAllTypes:'Tüm işlemler', activitySuccess:'Başarılı', activityErrors:'Hatalar', activityWarnings:'Uyarılar', activityNoMatch:'Filtreye uyan aktivite yok', filterRatings:'Rating', selectVisible:'Görünenleri Seç', deselectVisible:'Görünen Seçimi Kaldır', clearSelection:'Seçimi Temizle', selectedPlayers:'oyuncu seçili', visiblePlayers:'görünür', bulkRole:'Toplu Rol', addRoleSelected:'Rolü Ekle', removeRoleSelected:'Rolü Kaldır', startSelected:'Seçilileri Başlat', stopSelected:'Seçilileri Durdur', autoTradeStart:'Auto Trade Başlat', autoTradePause:'Duraklat', autoTradeContinue:'Devam Et', autoTradeStop:'Durdur', sideAccounts:'Yan Hesaplar', sideToMain:'Side → Main Rolleri', mainToSide:'Main → Side Rolleri', roomDescription:'Room Description', roomPassword:'Oda Şifresi', liveResults:'Canlı Sonuçlar', gainedPlayers:'Kazanılan Oyuncu', cardsMade:'Karta Dönüştürülen', problems:'Problemler', confirmHotkeyPause:'F8 ile Auto Trade duraklatılsın/devam ettirilsin mi?', confirmHotkeyStop:'F9 ile Auto Trade tamamen durdurulsun mu?', autoTradeReset:'İlerlemeyi Sıfırla', autoTradeResetConfirm:'Auto Trade kaydı ve ilerlemesi silinecek. Tamamlanmamış bir Scout alımı varsa önce oyun kadrosunu kontrol et. Sıfırdan başlatılsın mı?', autoTradeResumeRun:'Yarım Kalan İşlemi Sürdür' 
  },
  en: {
    lang:'en',
    market:'Market', startAll:'Start All', stopAll:'Stop All', marketApkPending:'APK verification pending · Scan Again',
    marketSubtitle:'Scan My Listings for every account', marketOpenAll:'Open All', marketCloseAll:'Close All', marketOpenSelected:'Open Selected', marketCloseSelected:'Close Selected', marketScan:'Scan', marketRescan:'Scan Again', marketClaim:'Claim Sales', marketSold:'Sold', marketListed:'Listed', marketExpired:'Expired Stock', marketSalePrice:'Listing price', marketNoRows:'No listings scanned yet.', marketScanning:'Scanning', marketClaiming:'Claiming', marketOpen:'Open', marketClosed:'Closed',
    autoTradeSubtitle:'Accounts, routing and live results', autoTradeChooseMain:'Select on Accounts page', autoTradeSortedByTk:'Ordered by saved TK balance', autoTradePriceHint:'Independent of roles', autoTradeNoSides:'No Side accounts added.', autoTradeRules:'Player rules', autoTradeRuleHint:'Scout buys all roles; selections below control transfers', autoTradePriceHelp:'Scout players at or below this price go to Main and become cards. Role selections have no price cap.', autoTradeCardDest:'Convert to cards on Main', autoTradeOptional:'Optional selection', autoTradeRoom:'Trade room', autoTradeRoomHint:'Used during transfer', autoTradeLive:'Live progress', autoTradePhase:'Phase', autoTradeNoRun:'Auto Trade has not started.', autoTradeSystem:'System', autoTradeVerifiedEvents:'verified events', autoTradeNoRoles:'No roles available', autoTradeConflicts:'Conflicting activity:', autoTradeStopConflicts:'Stop these activities and start Auto Trade?', autoTradeTkEstimate:'Calculated from verified transfer prices; updated on the next login.', autoTradeRoleConflict:'The same role cannot be selected in both transfer directions.', autoTradeResumeSide:'Continue this Side', autoTradeDeferred:'Deferred accounts', autoTradeVerifyPending:'Verify Pending Trade', 
    home:'Home', towerPage:'Tower', towerStopped:'Tower stopped', towerSalaryCap:'Tower was stopped on this account because the team is over the salary cap.', pvpPage:'PVP Arena', autoBuyPage:'Auto Buy', navAutomation:'Automation', navPlayers:'Players & Team', navMarket:'Market', navApp:'App', guide:'Guide', guideHint:'Explains in plain words what every page and button does.', guideOpen:'Open the guide', accounts:'Accounts', autoplay:'Auto Play', autoTrade:'Auto Trade', scout:'Scout', trade:'Trading Hall', cards:'Cards', activity:'Activity', settings:'Settings',
    addAccount:'Add Account', edit:'Edit', delete:'Delete', start:'Start', stop:'Stop', status:'Status', account:'Account', login:'Email / username', password:'Password', name:'Name', save:'Save', cancel:'Cancel', close:'Close', refresh:'Refresh', reset:'Reset',
    stopped:'Stopped', running:'Running', preparing:'Preparing', error:'Error', next:'Next', browser:'Browser', visible:'Visible', hidden:'Hidden', showBrowser:'Show', dailyReward:'Daily Reward', rewardChecking:'Checking', rewardClaiming:'Claiming', rewardDeferred:'Waiting', rewardUnknown:'Unknown', rewardResetWait:'Reset at 19:00 TR', rewardCompleted:'6/6 complete', dailyRoutine:'Daily', equipment:'Equipment', playersPage:'Players', draftPage:'Draft', modifiedTeam:'Modified', teamOriginal:'original', teamNone:'No team (No Team)', teamAssignHint:'Give a team or take the player out of its team. Auto Trade uses it; on this page the player is listed under Modified.', tasksColumn:'Tasks', tasksDaily:'Daily', tasksAlliance:'Alliance', tasksNotStarted:'Not started', tasksReadyHint:'Rewards waiting to be claimed', tasksUpdated:'Updated', tasksRefresh:'Refresh tasks', tasksRefreshing:'Refreshing…', claimRewards:'Collect rewards', claimingRewards:'Collecting…', claimRewardsHint:'Claims finished daily task rewards (selected accounts, or those ticked in the Daily column). While Auto Play runs this also happens every 30 minutes.', dailyRoutineHint:'When Auto Play starts after 19:10, or at 19:12 while it runs, it first does Daily Signin, 600-Day Sign In, the daily tasks and 1 Friendly Match', dailyDone:'Done today', dailyPending:'19:12 / when Auto Play starts', dailyFailed:'Incomplete', dailyPhase:'Daily routine',
    attempts:'Attempts', roster:'Roster', callback:'Call Back', refreshScout:'Refresh Scout', closeScout:'Close Scout', price:'Price', team:'Team', position:'Position', grade:'Grade', card:'Card', buy:'Sign', signed:'Signed', openScout:'Open Scout', chooseAccount:'Choose account', scoutClosed:'Scout closed',
    tradeAccount:'Trade Account', configure:'Configure', stopAtPrice:'Stop at price', scanCurrency:'Scan Currency', refreshHall:'Refresh Trading Hall', seller:'Seller', salary:'Salary', base:'Base', value:'Value', currency:'Currency', presets:'Presets', filters:'Filters', addPreset:'Add preset', managePresets:'Manage', noRows:'No results', listings:'listings', page:'page',
    language:'Language', auto:'Auto', turkish:'Türkçe', english:'English', dataFolder:'Data folder', debugBrowser:'Open Auto Play browser visibly',
    cardsEmpty:'No card data.', cardScanLater:'Choose the Main Account and press Refresh to scan Star Cards.',
    clear:'Clear', schedule:'Schedule', at:'At', prepare:'Prepare', minutes:'min', seconds:'sec', all:'All',
    dashboardAccounts:'Accounts', dashboardRunning:'Active Auto Play', dashboardScout:'Open Scouts', dashboardTrade:'Trading Hall', usableApk:'Usable APK', usableTix:'Usable TIX', marketKind:'Kind', marketKind_recent:'Was on sale', marketKind_stock:'Stock', marketKind_onSale:'On sale', marketKind_owned:'In roster', marketProgressRelist:'Listing on the market', marketProgressClaim:'Claiming sales', marketProgressScan:'Scanning', mainBadge:'MAIN', browserOpenShort:'Open', browserClosedShort:'Closed', playerMarket:'Player Market', scheduleTask:'Task', scheduleNoTask:'Task not found.', scheduleMode:'Mode', scheduleParallel:'Parallel', scheduleStaggered:'One by one', scheduleDelay:'Delay', 'builtin_tournament-register':'Tournament registration', 'builtin_market-claim':'Market: claim sales', 'builtin_market-relist':'Market: relist yesterday’s listings', 'builtin_pvp-arena':'PVP Arena (until attempts run out)', pmRoleSellable:'Sellable', pmRoleStock:'Stock', pmRoleCard:'Card', pmSortName:'Player name', pmSortBaseNear:'Closest to base', pmSortBaseFar:'Farthest from base', pmSortUp:'Biggest rise', pmSortDown:'Biggest drop', pmSortLargest:'Largest change', pmList:'Player List', pmAccount:'Player Market account', pmAccountName:'Account name', pmLogin:'Login', pmPasswordChange:'Enter to change the password', pmPassword:'Password', pmSaveAccount:'Save account', pmStartScan:'Start scan', pmScanning:'Scanning players…', pmPage:'Page', pmPlayer:'Player', pmSearch:'Search player...', pmAllRoles:'All roles', pmAllPositions:'All positions', pmAllRatings:'All ratings', pmNearBase:'Within % of base', pmColPlayer:'Player', pmColDiff:'Gap', pmColChange:'Change', pmColRole:'Role', pmNoRole:'No role', marketSubtitleNew:'Scan and claim sales, relist expired players · without a browser', marketTabSales:'Sales', marketTabRelist:'Relist', marketTabListings:'Listings · Relist', marketExpiredTitle:'Expired', marketListedTitle:'Listed (waiting to sell) · enter a new price and tick it to change the price', marketNoRows:'Nothing scanned yet · pick accounts and press Scan.', marketScanSelected:'Scan selected', marketClaimSelected:'Claim sales of selected', marketClaimSoldOnly:'Claim only accounts with sales', marketClaimSoldOnlyHint:'Enters only the accounts where the last scan found sales; the others are not scanned again.', marketLastScan:'Last scan', marketSoldTitle:'Sold (waiting to be claimed)', marketNoSold:'No sales to claim.', marketLoadExpired:'Load listings (expired + listed)', marketRelistSelected:'List selected / update price', marketParallel:'Accounts at once', marketParallelHint:'How many accounts relist at the same time. The last value is remembered.', marketRelistReport:'Last relist', marketRelistListed:'listed', marketRelistOwned:'already in roster', marketRelistFailed:'failed', marketRelistRemovedNotListed:'removed but not listed (in roster)', marketOldPrice:'Old price', marketNewPrice:'New price', marketExpiredCount:'expired player(s)', marketRelistEmpty:'Pick accounts and press "Scan selected".', marketInvalidPrice:'Invalid price', marketRelist_ready:'Ready', marketRelist_queued:'Queued', marketRelist_removing:'Removing', marketRelist_listing:'Listing', marketRelist_listed:'Listed', marketRelist_owned:'Already in roster', marketRelist_failed:'Failed', marketRelist_removedNotListed:'Removed, not listed', marketRelist_stopped:'Stopped', dragToReorder:'Drag to reorder (or use ↑/↓)', scheduleTaskHelp:'At the set time, tasks running on the selected accounts are stopped, the preparation minutes pass, the task runs, then the stopped tasks start again.', tournament:'Tournament', tournamentSubtitle:'Registers the selected accounts to tournaments for their level · waits for the next registration when today\'s tournament ends', tournamentStart:'Join Tournaments', tournamentReload:'Reload list', tournamentDetail:'Current step', tournamentJoined:'Joined this run', tournamentList:'Tournaments', tournamentPlayers:'Players', tournamentStarts:'Starts (TR)', tournamentOurAccounts:'Our accounts', tournamentFull:'Full', tournament_queued:'Queued', tournament_login:'Signing in', tournament_ready:'Ready', tournament_registering:'Registering', tournament_waiting:'Waiting', tournament_done:'Done', tournament_error:'Error', tournament_stopped:'Stopped', tournamentReport:'Last run report', tournamentSourceManual:'Started manually', tournamentSourceSchedule:'From schedule', tournamentReportOk:'Registered', tournamentOutcome_registered:'Registered', tournamentReportNotOk:'Not registered', tournamentOutcome_already:'Already registered', tournamentOutcome_full:'Tournament full', tournamentOutcome_refused:'Refused by the game', tournamentOutcome_error:'Error', tournamentOutcome_timeout:'Timed out', tournamentOutcome_stopped:'Stopped', tournamentOutcome_nothing:'No open tournament', 'tournamentOutcome_no-tournament':'No tournament for this level', tradeFailed:'Failed', tradeStopped:'Stopped', baseOnly:'Base only', baseOnlyHint:'Same listings as the game\'s "Base only" switch', basePctMax:'Base % ≤', basePctHint:'Salary vs base in percent. Negative = below base', activityAllServices:'All services', activityServiceFilter:'Service',
    tradeRunning:'Scanning', completed:'Completed', idle:'Idle', signConfirm:'Sign this player?', removeConfirm:'Remove account?', autoPlayStopped:'Auto Play stopped', salaryCapWarning:'Quick Play was stopped automatically because the team is over the salary cap.',
    mainAccount:'Main Account', makeMain:'Make Main', level:'LV', exp:'EXP', tk:'TK', apk:'APK', tix:'TIX', apkContribution:'APK Contribution', tixContribution:'TIX Contribution', lastUpdate:'Last update',
    roles:'Roles', addRole:'Add Role', trackedTeams:'Tracked Teams', trackedOnly:'Tracked only', teamDevelopment:'Team Development', players:'Players', stars:'Stars', progress:'Next Star', ready:'Ready', teamNeeded:'Needed for team', raisesTeam:'Raises team', inactive:'Inactive', scannerWaiting:'Choose Main Account', resetCards:'Reset Card Data', resetCardsConfirm:'Delete scanned card data, player-role assignments and tracked teams? Role definitions will be kept.', scanningCards:'Scanning…', cardTeamsTab:'Teams', cardPlayersTab:'Player List', filterTeams:'Team', filterStars:'Stars', filterRoles:'Role', searchName:'Search name', rating:'Rating', cardCount:'Card Count', chooseColor:'Color',
    openSelectedScouts:'Open Selected', refreshSelectedScouts:'Refresh Selected', closeSelectedScouts:'Close Selected', closeAllScouts:'Close All', selectAll:'Select all', selected:'selected', scoutSearch:'Search player / team', maxPrice:'Max Price', minGrade:'Min Grade', roleFilter:'Role', noScoutData:'Scout not opened', noScoutMatch:'No players match the filters', playerDetails:'Player Details', scoutAccounts:'accounts', detail:'Details', activityAccountFilter:'Account', activityTypeFilter:'Type', activityAllAccounts:'All accounts', activityAllTypes:'All activity', activitySuccess:'Successful', activityErrors:'Errors', activityWarnings:'Warnings', activityNoMatch:'No activity matches the filters', filterRatings:'Rating', selectVisible:'Select Visible', deselectVisible:'Deselect Visible', clearSelection:'Clear Selection', selectedPlayers:'players selected', visiblePlayers:'visible', bulkRole:'Bulk Role', addRoleSelected:'Add Role', removeRoleSelected:'Remove Role', startSelected:'Start Selected', stopSelected:'Stop Selected', autoTradeStart:'Start Auto Trade', autoTradePause:'Pause', autoTradeContinue:'Continue', autoTradeStop:'Stop', sideAccounts:'Side Accounts', sideToMain:'Side → Main Roles', mainToSide:'Main → Side Roles', roomDescription:'Room Description', roomPassword:'Room Password', liveResults:'Live Results', gainedPlayers:'Players Gained', cardsMade:'Converted to Cards', problems:'Problems', confirmHotkeyPause:'Pause/resume Auto Trade with F8?', confirmHotkeyStop:'Stop Auto Trade completely with F9?', autoTradeReset:'Reset Progress', autoTradeResetConfirm:'Auto Trade progress and history will be cleared. Check the game roster first if a Scout purchase was interrupted. Start over?', autoTradeResumeRun:'Resume Interrupted Run' 
  }
};


// Short texts for service status and Activity entries, keyed by the code the
// main process sends with its English fallback message.
const MSG = {
  tr: {
    'th.start':'Tarama başladı · {currency} · fiyat limiti {stop}',
    'th.listingsListed':'Pazarda {total} ilan var ({pages} sayfa)',
    'th.baseListed':'Base ilanlar okunuyor ({total} ilan)',
    'th.progress':'%{pct} · {count} ilan · ~{eta} sn kaldı',
    'th.retry':'Sayfa {page} alınamadı, tekrar deneniyor ({attempt}/{max})',
    'th.priceStop':'{price} fiyat limitine ulaşıldı, kalan sayfalar atlandı',
    'th.listingsDone':'İlanlar okundu · {count} ilan · {seconds} sn',
    'th.baseDone':'Base oyuncular işaretlendi · {count} ilan',
    'th.baseFailed':'Base oyuncular işaretlenemedi, bu taramada "Base only" kullanılamaz',
    'th.done':'Tarama bitti · {count} ilan · {base} base · {seconds} sn',
    'th.stopped':'Tarama durduruldu · {count} ilan saklandı',
    'th.failed':'Tarama hata verdi: {error}',
    'th.stopRequested':'Durdurma istendi',
    'th.connecting':'Pazara bağlanılıyor',
    'th.runListings':'İlanlar okunuyor · {page}/{total} sayfa · {count} ilan',
    'th.runBase':'Base oyuncular işaretleniyor · {page}/{total} sayfa',
    'th.eta':'~{eta} sn kaldı',
    'th.priceStopShort':'fiyat limitinde durdu',
    'st.updated':'Bakiye güncellendi · {changes}',
    'st.unverified':'APK/TIX okunamadı, eski değer korundu (APK {apk} · TIX {tix})',
    'mk.opening':'Satışlar kontrol ediliyor',
    'mk.collecting':'{count} satış toplanıyor',
    'mk.returning':'Bakiyeyi okumak için Stadium\'a dönülüyor',
    'mk.verified':'Bakiye doğrulandı · APK {apk} · TIX {tix}',
    'tn.login':'Giriş yapılıyor',
    'tn.registered':'Kaydoldu: {name} · {start}',
    'tn.full':'{name} doldu',
    'tn.refused':'{name} kaydı reddedildi: {message}',
    'tn.started':'Turnuva kaydı başladı · {count} hesap',
    'tn.listed':'{count} turnuva bulundu · {open} kayıt açık · {playing} oynanıyor',
    'tn.prepFailed':'Hazırlanamadı: {error}',
    'tn.noTournament':'Lv {level} için turnuva yok',
    'tn.waitLookOn':'Bekleniyor · {name} oynanıyor',
    'tn.waitBlank':'Bekleniyor · {type} bitti, yeni kayıt birazdan açılır',
    'tn.gaveUp':'3 saat beklendi, kayıt açılmadı',
    'tn.listFailed':'Turnuva listesi okunamadı, tekrar denenecek',
    'tn.finished':'Turnuva kaydı bitti · {joined} yeni kayıt',
    'tn.stopped':'Turnuva kaydı durduruldu',
    'tn.failed':'Turnuva kaydı hata verdi: {error}',
    'tstep.queued':'Sırada',
    'tstep.login':'Giriş yapılıyor',
    'tstep.ready':'Hazır · Lv {level}',
    'tstep.registering':'Kayıt olunuyor: {name}',
    'tstep.waitLookOn':'{name} oynanıyor · bitince kayıt olunacak',
    'tstep.waitBlank':'{type} bitti · yeni kayıt bekleniyor',
    'tstep.error':'{error}',
    'trun.reading':'Turnuvalar okunuyor',
    'trun.waiting':'{count} hesap bugünün turnuvasının bitmesini bekliyor',
    'trun.registering':'{count} hesap kayıt oluyor',
    'trun.done':'Bitti · {joined} yeni kayıt · {seconds} sn',
    'trun.stopped':'Durduruldu',
    'trun.error':'Hata: {error}',
    'sc.stopped':'{schedule}: {task} durduruldu, görev bitince tekrar başlayacak',
    'sc.preparing':'{schedule}: {minutes} dk hazırlık · {count} hesap',
    'sc.started':'{schedule}: başladı · {count} hesap',
    'sc.completed':'{schedule}: tamamlandı',
    'sc.cancelled':'{schedule}: iptal edildi',
    'sc.failed':'{schedule}: hata · {error}',
    'sc.restarted':'{schedule}: {task} tekrar başlatıldı',
    'sc.restartFailed':'{schedule}: {task} tekrar başlatılamadı · {error}',
    'sc.interrupted':'{schedule}: uygulama kapandığı için yarıda kaldı',
    'sc.autoplayDisabled':'{schedule}: Auto Play artık zamanlanmıyor, bu zamanlama kapatıldı',
    'sch.interrupted':'Yarıda kaldı (uygulama kapandı)',
    'sch.disabled':'Kapatıldı',
    'mk.relistRecentPicked':'Dünkü {count} ilan tekrar listelenecek · {skipped} eski expired stokta kalıyor',
    'mk.relistNothingRecent':'Son 19:10\'da süresi dolan ilan yok · listelenecek bir şey yok',
    'mkprog.current':'Ekleniyor: {name}',
    'mkprog.left':'{left} oyuncu kaldı',
    'cd.started':'Kart taraması başladı',
    'cd.done':'Kart taraması bitti · {teams} takım · {players} oyuncu · {noTeam} No Team · {cards} kart · {seconds} sn',
    'cd.migrated':'{count} oyuncunun rolü yeni oyuncu kimliğine taşındı',
    'cd.failed':'Kart taraması hata verdi: {error}',
    'cdstep.login':'Oturum alınıyor',
    'cdstep.teams':'Takımlar okunuyor',
    'cdstep.inventory':'Kart envanteri okunuyor',
    'cdstep.rosters':'Takım kadroları okunuyor · {done}/{total}',
    'cdstep.done':'{players} oyuncu · {noTeam} No Team · {cards} kart',
    'cdstep.error':'Hata: {error}',
    'sch.waiting':'Saatini bekliyor',
    'sch.stopping':'{count} görev durduruluyor',
    'sch.preparing':'Hazırlanıyor · {time} başlar',
    'sch.running':'Çalışıyor',
    'sch.restoring':'{count} görev tekrar başlatılıyor',
    'sch.completed':'Tamamlandı',
    'sch.cancelled':'İptal edildi',
    'sch.failed':'Hata ile bitti',
    'report.ok':'kaydoldu',
    'report.not':'kaydolmadı',
    'mk.failed':'Pazar hatası: {error}',
    'mk.scanned':'Pazar tarandı · {listed} listed · {sold} sold · {expired} expired',
    'mk.claimed':'Satış toplandı · {name} · +{payout} {currency} (kesinti {fee})',
    'mk.claimFailed':'Satış toplanamadı · {name} · {message}',
    'mk.claimDone':'Toplama bitti · {claimed}/{total} satış · +{apk} APK · +{tix} TIX · bakiye APK {balanceApk} · TIX {balanceTix}',
    'mk.nothingToClaim':'Toplanacak satış yok',
    'mk.expiredFound':'{count} expired oyuncu listelenmeye hazır',
    'mk.relistOwned':'{name} pazardan çıkarılamadı · kadroda zaten var',
    'mk.relistRemoveFailed':'{name} pazardan çıkarılamadı · {message}',
    'mk.relisted':'{name} tekrar listelendi · {price} {currency}',
    'mk.relistSellFailed':'{name} pazardan çıktı ama listelenemedi · {message} · oyuncu kadroda',
    'mk.relistDone':'Listeleme bitti · {listed} listelendi · {owned} kadroda var · {failed} başarısız · {removedNotListed} çıktı ama listelenemedi',
    'mkstep.login':'Oturum alınıyor',
    'mkstep.scanning':'İlanlar okunuyor · {page}/{pages}',
    'mkstep.scanned':'{listed} listed · {sold} sold · {expired} expired',
    'mkstep.claiming':'Toplanıyor · {name} ({done}/{total})',
    'mkstep.claimed':'{claimed} satış toplandı · +{apk} APK · +{tix} TIX',
    'mkstep.expiredFound':'{count} expired oyuncu',
    'mkstep.relisting':'Listeleniyor · {name} ({done}/{total})',
    'mkstep.relisted':'{done}/{total} oyuncu işlendi',
    'mkstep.error':'Hata: {error}',
    'mkstep.stopped':'Durduruldu',
    "dr.start":"Günlük rutin başladı",
    "dr.signIn":"Daily Signin alındı · gün {day}",
    "dr.signInAlready":"Daily Signin bugün zaten alınmış",
    "dr.signIn600":"600-Day Sign In yapıldı · gün {day}",
    "dr.signIn600Already":"600-Day Sign In bugün zaten yapılmış",
    "dr.tasksStarted":"Günlük görevler başlatıldı · {count} görev",
    "dr.tasksAlready":"Günlük görevler zaten başlatılmış",
    "dr.fmJoined":"Friendly Match'e katılındı · kurucu {host}",
    "dr.fmJoinFailed":"{host} maçına katılınamadı: {error}",
    "dr.fmCreated":"Katılınabilir maç yok ({locked} şifreli) · Friendly Match kuruldu",
    "dr.fmNoOpponent":"{minutes} dk kimse katılmadı · maç iptal edildi, tekrar aranıyor",
    "dr.fmDone":"Friendly Match bitti · günlük görev tamam",
    "dr.fmCreateWait":"Maç henüz kurulamadı ({error}) · 30 sn sonra tekrar denenecek",
    "dr.signInFailed":"Daily Signin alınamadı: {error}",
    "dr.signIn600Failed":"600-Day Sign In yapılamadı: {error}",
    "dr.tasksFailed":"Günlük görevler başlatılamadı: {error}",
    "dr.friendlyFailed":"Friendly Match oynanamadı: {error}",
    "dr.failed":"Günlük rutin hatası: {error}",
    "dr.partial":"Günlük rutin eksik kaldı ({failed}) · bir sonraki Auto Play başlangıcında tekrar denenecek",
    "dr.done":"Günlük rutin bitti · Auto Play devam ediyor",
    "dr.stopped":"Günlük rutin durduruldu",
    "drstep.login":"Oturum alınıyor",
    "drstep.signIn":"Daily Signin",
    "drstep.signIn600":"600-Day Sign In",
    "drstep.tasks":"Günlük görevler başlatılıyor",
    "drstep.fmBusy":"Önceki maçın bitmesi bekleniyor",
    "drstep.fmSearching":"Friendly Match aranıyor",
    "drstep.fmWaitingOpponent":"Maç kuruldu · rakip bekleniyor",
    "drstep.fmPlaying":"Friendly Match oynanıyor{opponent}",
    "df.joined":"Draft odası {slot}'a katıldı",
    "df.started":"Draft {slot} başladı · {count} katılımcı",
    "df.picked":"Draftta {player} seçildi (oda {slot})",
    "df.pickFailed":"Draft seçimi başarısız: {error}",
    "df.ended":"Draft {slot} bitti",
    "df.listed":"{name} pazara kondu · {price} {currency}",
    "df.listFailed":"{name} pazara konamadı: {error}",
    "pl.fetched":"Oyuncu listesi güncellendi · {count} oyuncu · {up} artan · {down} düşen · {base} Base'de",
    "pl.autoFetched":"11:05 oyuncu listesi alındı · {count} oyuncu · {up} artan · {down} düşen · {base} Base'de",
    "pl.failed":"Oyuncu listesi alınamadı: {error}",
    "at2.started":"Auto Trade başladı · {accounts} hesap · Main: {main}",
    "at2.continued":"Auto Trade kaldığı yerden devam ediyor",
    "at2.paused":"Auto Trade duraklatıldı",
    "at2.resumed":"Auto Trade devam ediyor",
    "at2.stopped":"Auto Trade durduruldu",
    "at2.reset":"Auto Trade ilerlemesi sıfırlandı",
    "at2.done":"Auto Trade tamamlandı · {bought} oyuncu alındı · {converted} karta çevrildi · {trades} oyuncu takaslandı",
    "at2.failed":"Auto Trade durdu: {error}",
    "at2.opened":"{name} açıldı",
    "by.bought":"{name} satın alındı · {price} {currency}",
    "by.buyFailed":"{name} alınamadı ({price} {currency}): {error}",
    "by.listed":"{name} pazara kondu · {price} {currency}",
    "by.parked":"{name} 9.999.999 TIX ile pazara kondu (fiyat bekliyor)",
    "by.parkFailed":"{name} pazara konamadı: {error}",
    "by.sellFailed":"{name} pazara konamadı: {error}",
    "by.unlistFailed":"{name} pazardan çekilemedi: {error}",
    "ab.start":"Auto Buy başladı · {rows} oyuncu · {accounts} hesap",
    "ab.pausedTask":"{task} Auto Buy için durduruldu",
    "ab.resumedTask":"{task} yeniden başlatıldı",
    "ab.resumeFailed":"{task} yeniden başlatılamadı: {error}",
    "ab.stopped":"Auto Buy durduruldu",
    "ab.failed":"Auto Buy durdu: {error}",
    "ab.noFunds":"Auto Buy durdu · hesapların {currency} miktarı yetersiz",
    "ab.cannotBuy":"{name} ({price} {currency}) hiçbir hesapla alınamadı · neden: {reasonTr} · tarama sürüyor",
    "tw.start":"Kule başladı · {count} hesap",
    "tw.waitMatch":"Hesap zaten bir maçta · maç bitince kule başlayacak",
    "tw.matchStarted":"{tower} {floor}. kat maçı başladı",
    "tw.won":"{tower} {floor}. kat kazanıldı",
    "tw.lost":"{tower} {floor}. kat kaybedildi ({n}/3)",
    "tw.towerStopped":"{tower} {floor}. katta 3 kez üst üste kaybedildi · bu kule bırakıldı",
    "tw.startFailed":"{tower} {floor}. kat başlatılamadı: {error}",
    "tw.accountDone":"Kule bu hesap için bitti",
    "tw.stopped":"Kule durduruldu",
    "tw.failed":"Kule durdu: {error}",
    "tw.salaryCap":"Kule durdu · maaş sınırı aşıldı: {error}",
    "tw.result":"Kule sonucu · {wins} galibiyet · {towers}",
    "tw.summary":"Kule bitti · {count} hesap · toplam {wins} galibiyet",
    "tw.pausedTask":"{task} Kule için durduruldu",
    "tw.resumedTask":"{task} yeniden başlatıldı",
    "tw.resumeFailed":"{task} yeniden başlatılamadı: {error}",
    "pvp.start":"PVP başladı · {count} hesap",
    "pvp.pausedTask":"{task} PVP için durduruldu",
    "pvp.resumedTask":"{task} yeniden başlatıldı",
    "pvp.resumeFailed":"{task} yeniden başlatılamadı: {error}",
    "pvp.waitMatch":"Hesap zaten bir maçta · maç bitince PVP denenecek",
    "pvp.matchStarted":"{n}. PVP maçı başladı · kalan hak {left}",
    "pvp.matchDone":"{n}. PVP maçı bitti · kalan hak {left}",
    "pvp.findFailed":"Find PVP Match reddedildi ({n}. kez): {error}",
    "pvp.inactive":"PVP görevi durduruldu çünkü PVP şu an aktif değil",
    "pvp.failed":"PVP durdu: {error}",
    "pvp.resultDone":"PVP sonucu · tamamlandı · {played} maç oynandı",
    "pvp.resultCut":"PVP sonucu · yarıda kesildi ({reason}) · {played} maç oynandı · {left} hak kaldı",
    "pvp.summary":"PVP sonucu · {done}/{total} hesap tamamladı · toplam {played} maç",
    "at2.listDone":"{name} pazar listelemesi tamamlandı · {listed}/{total}",
    "at2.mainTurn":"{name} (Main) Scout'a giriyor",
    "at2.sideTurn":"{name} (Side) açıldı · {funds} TK",
    "at2.cycle":"Tur {cycle} / {total} başlıyor",
    "at2.signed":"{player} alındı · {price} TK",
    "at2.signFailed":"{player} alınamadı: {error}",
    "at2.callback":"Scout yenilendi (Call back) · kalan {left}",
    "at2.converted":"{count} oyuncu karta çevrildi: {names}",
    "at2.makeFailed":"Karta çevirme başarısız: {error}",
    "at2.unload":"Main dolu · oyuncular {name} hesabına veriliyor",
    "at2.traded":"{side} ile takas · Main {give} verdi, {take} aldı · {tk} TK",
    "at2.tradeFailed":"{side} ile takas başarısız: {error}",
    "at2.tradeStuck":"{side} ile takas tekrar başarısız oldu: {error}",
    "at2.dupNextSide":"{names} zaten {side} hesabında · sıradaki Side'a verilecek",
    "at2.dupOnMain":"{names} zaten Main'de var · karta çevirme sonrası da çözülmedi. Düzeltip devam et.",
    "at2.mainFunds":"Main ({name}) TK yetmiyor: {funds} TK var, {need} TK gerekiyor. Düzeltip devam et.",
    "at2.mainFull":"Main ({name}) dolu ve hiçbir Side oyuncuları alamadı. Düzeltip devam et.",
    "at2.sideFunds":"{name}: TK yetmiyor ({funds} / {need}) · hesap atlandı",
    "at2.listed":"{name} pazara kondu · {price} {currency}",
    "at2.listFailed":"{name} pazara konamadı: {error}",
    "at2.cardsReset":"Karta çevrilen oyuncular tablosu sıfırlandı",
    "at2.cardScan":"Main hesabının kart taraması bitti",
    "at2.cardScanFailed":"Kart taraması yapılamadı: {error}",
    "at2.baseSellable":"{player} {salary} maaşla alındı (Base {base}) · Satılabilir sayılıyor",
    "dr.rewardsClaimed":"Görev ödülleri toplandı · {count} görev · {xp} XP · {items}",
    "dr.rewardsFailed":"Görev ödülleri toplanamadı: {error}",
    "drstep.rewards":"Görev ödülleri toplanıyor",
    "dr.rewardsManual":"{accounts} hesap kontrol edildi · {count} görev ödülü toplandı",
    "dr.rewardsBadge":"🎁 {count} · {xp} XP",
    "eq.scanned":"Ekipman tarandı · {gear} ekipman ({equipped} kuşanılı) · {ore} Refine Ore · {scroll} Scroll · {sets}/{total} set · {seconds} sn",
    "eq.failed":"Ekipman hatası: {error}",
    "eq.stopped":"Ekipman işlemi durduruldu",
    "eq.converted":"{fabric} {rarity} Fabric → {stone} Refine Stone · kalan Fabric {left} · Refine Stone {stones}",
    "eq.crafted":"Üretildi: {count} × {name}",
    "eq.enchanted":"{name} enchant edildi · %{pct} · ATK {off} · DEF {def} · kalan Scroll {scroll}",
    "eq.enhanced":"{name} +{level} oldu",
    "eq.enhanceFailed":"{name} +{level} basma başarısız",
    "eq.enhanceDone":"{name} +{from} → +{level} · {tries} deneme · {fails} başarısız",
    "eq.eventReward":"Ekipman etkinliği ödülü: {reward}",
    "eq.refined":"{name} Refine {from} → {level} · kalan Ore {ore}",
    "eq.refineFailed":"{name} Refine {from} başarısız · kalan Ore {ore}",
    "eq.refineDowngraded":"{name} Refine {from} → {level} düştü · kalan Ore {ore}",
    "eq.registered":"{name} · {count} parça teslim edildi",
    "eq.setCompleted":"{name} tamamlandı · {count} parça teslim edildi",
    "eq.setAlready":"{name} zaten tamamlanmış",
    "eq.prepareStart":"{name} hazırlanıyor · {crafts} üretim · {enhances} basma",
    "eq.prepareShort":"{name} hazırlanamıyor · eksik: {short}",
    "eqstep.login":"Oturum alınıyor",
    "eqstep.bag":"Çanta okunuyor",
    "eqstep.collections":"Koleksiyonlar okunuyor",
    "eqstep.recipes":"Tarifler okunuyor",
    "eqstep.convert":"{count} dönüşüm",
    "eqstep.craft":"{count} × {name}",
    "eqstep.enchant":"{name}",
    "eqstep.enhance":"{name} +{level} → +{target} · {tries}. deneme",
    "eqstep.refine":"{name} Refine {level}",
    "eqstep.register":"{name}",
    "eqstep.prepare":"{name} · {done}/{total} adım"
  },
  en: {
    'th.start':'Scan started · {currency} · price limit {stop}',
    'th.listingsListed':'Market has {total} listings ({pages} pages)',
    'th.baseListed':'Reading base listings ({total})',
    'th.progress':'{pct}% · {count} listings · ~{eta}s left',
    'th.retry':'Page {page} failed, retrying ({attempt}/{max})',
    'th.priceStop':'Price limit {price} reached, remaining pages skipped',
    'th.listingsDone':'Listings read · {count} · {seconds}s',
    'th.baseDone':'Base players marked · {count} listings',
    'th.baseFailed':'Base players could not be marked; "Base only" is unavailable for this scan',
    'th.done':'Scan finished · {count} listings · {base} base · {seconds}s',
    'th.stopped':'Scan stopped · {count} listings kept',
    'th.failed':'Scan failed: {error}',
    'th.stopRequested':'Stop requested',
    'th.connecting':'Connecting to the market',
    'th.runListings':'Reading listings · page {page}/{total} · {count} listings',
    'th.runBase':'Marking base players · page {page}/{total}',
    'th.eta':'~{eta}s left',
    'th.priceStopShort':'stopped at the price limit',
    'st.updated':'Balance updated · {changes}',
    'st.unverified':'APK/TIX could not be confirmed; kept APK {apk} · TIX {tix}',
    'mk.opening':'Checking sales',
    'mk.collecting':'Collecting {count} sale(s)',
    'mk.returning':'Returning to Stadium to read the balance',
    'mk.verified':'Balance verified · APK {apk} · TIX {tix}',
    'tn.login':'Signing in',
    'tn.registered':'Registered: {name} · {start}',
    'tn.full':'{name} is full',
    'tn.refused':'{name} refused: {message}',
    'tn.started':'Tournament registration started · {count} account(s)',
    'tn.listed':'{count} tournaments · {open} open · {playing} in progress',
    'tn.prepFailed':'Could not prepare: {error}',
    'tn.noTournament':'No tournament for Lv {level}',
    'tn.waitLookOn':'Waiting · {name} is being played',
    'tn.waitBlank':'Waiting · {type} ended, new registration opens soon',
    'tn.gaveUp':'Waited 3 hours, registration did not open',
    'tn.listFailed':'Could not read the tournament list, retrying',
    'tn.finished':'Tournament registration finished · {joined} new',
    'tn.stopped':'Tournament registration stopped',
    'tn.failed':'Tournament registration failed: {error}',
    'tstep.queued':'Queued',
    'tstep.login':'Signing in',
    'tstep.ready':'Ready · Lv {level}',
    'tstep.registering':'Registering: {name}',
    'tstep.waitLookOn':'{name} is being played · will register when it ends',
    'tstep.waitBlank':'{type} ended · waiting for the new registration',
    'tstep.error':'{error}',
    'trun.reading':'Reading tournaments',
    'trun.waiting':'{count} account(s) waiting for today\'s tournament to end',
    'trun.registering':'{count} account(s) registering',
    'trun.done':'Done · {joined} new registration(s) · {seconds}s',
    'trun.stopped':'Stopped',
    'trun.error':'Error: {error}',
    'sc.stopped':'{schedule}: {task} stopped, restarts after the task',
    'sc.preparing':'{schedule}: preparing {minutes} min · {count} account(s)',
    'sc.started':'{schedule}: started · {count} account(s)',
    'sc.completed':'{schedule}: completed',
    'sc.cancelled':'{schedule}: cancelled',
    'sc.failed':'{schedule}: failed · {error}',
    'sc.restarted':'{schedule}: {task} restarted',
    'sc.restartFailed':'{schedule}: {task} could not restart · {error}',
    'sc.interrupted':'{schedule}: interrupted because the app closed',
    'sc.autoplayDisabled':'{schedule}: Auto Play is no longer scheduled; this schedule was switched off',
    'sch.interrupted':'Interrupted (app closed)',
    'sch.disabled':'Switched off',
    'mk.relistRecentPicked':'{count} listing(s) from yesterday will be relisted · {skipped} older expired kept as stock',
    'mk.relistNothingRecent':'Nothing expired at the last 19:10 · nothing to relist',
    'mkprog.current':'Listing: {name}',
    'mkprog.left':'{left} player(s) left',
    'cd.started':'Card scan started',
    'cd.done':'Card scan finished · {teams} teams · {players} players · {noTeam} No Team · {cards} cards · {seconds}s',
    'cd.migrated':'{count} player role(s) moved to the new player ids',
    'cd.failed':'Card scan failed: {error}',
    'cdstep.login':'Getting the session',
    'cdstep.teams':'Reading teams',
    'cdstep.inventory':'Reading the card inventory',
    'cdstep.rosters':'Reading team rosters · {done}/{total}',
    'cdstep.done':'{players} players · {noTeam} No Team · {cards} cards',
    'cdstep.error':'Error: {error}',
    'sch.waiting':'Waiting for its time',
    'sch.stopping':'Stopping {count} task(s)',
    'sch.preparing':'Preparing · starts at {time}',
    'sch.running':'Running',
    'sch.restoring':'Restarting {count} task(s)',
    'sch.completed':'Completed',
    'sch.cancelled':'Cancelled',
    'sch.failed':'Ended with an error',
    'report.ok':'registered',
    'report.not':'not registered',
    'mk.failed':'Market error: {error}',
    'mk.scanned':'Market scanned · {listed} listed · {sold} sold · {expired} expired',
    'mk.claimed':'Sale claimed · {name} · +{payout} {currency} (fee {fee})',
    'mk.claimFailed':'Sale could not be claimed · {name} · {message}',
    'mk.claimDone':'Claim finished · {claimed}/{total} sale(s) · +{apk} APK · +{tix} TIX · balance APK {balanceApk} · TIX {balanceTix}',
    'mk.nothingToClaim':'No sales to claim',
    'mk.expiredFound':'{count} expired player(s) ready to relist',
    'mk.relistOwned':'{name} could not be removed · already in the roster',
    'mk.relistRemoveFailed':'{name} could not be removed · {message}',
    'mk.relisted':'{name} listed again · {price} {currency}',
    'mk.relistSellFailed':'{name} was removed but not listed · {message} · the player is in the roster',
    'mk.relistDone':'Relist finished · {listed} listed · {owned} in roster · {failed} failed · {removedNotListed} removed but not listed',
    'mkstep.login':'Getting the session',
    'mkstep.scanning':'Reading listings · {page}/{pages}',
    'mkstep.scanned':'{listed} listed · {sold} sold · {expired} expired',
    'mkstep.claiming':'Claiming · {name} ({done}/{total})',
    'mkstep.claimed':'{claimed} sale(s) claimed · +{apk} APK · +{tix} TIX',
    'mkstep.expiredFound':'{count} expired player(s)',
    'mkstep.relisting':'Listing · {name} ({done}/{total})',
    'mkstep.relisted':'{done}/{total} player(s) done',
    'mkstep.error':'Error: {error}',
    'mkstep.stopped':'Stopped',
    "dr.start":"Daily routine started",
    "dr.signIn":"Daily Signin claimed · day {day}",
    "dr.signInAlready":"Daily Signin was already claimed today",
    "dr.signIn600":"600-Day Sign In done · day {day}",
    "dr.signIn600Already":"600-Day Sign In was already done today",
    "dr.tasksStarted":"Daily tasks started · {count} tasks",
    "dr.tasksAlready":"Daily tasks were already started",
    "dr.fmJoined":"Joined a Friendly Match · host {host}",
    "dr.fmJoinFailed":"Could not join {host}: {error}",
    "dr.fmCreated":"No joinable match ({locked} with password) · created a Friendly Match",
    "dr.fmNoOpponent":"Nobody joined in {minutes} min · match cancelled, looking again",
    "dr.fmDone":"Friendly Match finished · daily task complete",
    "dr.fmCreateWait":"Could not create a match yet ({error}) · trying again in 30 s",
    "dr.signInFailed":"Daily Signin failed: {error}",
    "dr.signIn600Failed":"600-Day Sign In failed: {error}",
    "dr.tasksFailed":"Daily tasks could not be started: {error}",
    "dr.friendlyFailed":"Friendly Match could not be played: {error}",
    "dr.failed":"Daily routine error: {error}",
    "dr.partial":"Daily routine incomplete ({failed}) · retried at the next Auto Play start",
    "dr.done":"Daily routine finished · Auto Play continues",
    "dr.stopped":"Daily routine stopped",
    "drstep.login":"Getting the session",
    "drstep.signIn":"Daily Signin",
    "drstep.signIn600":"600-Day Sign In",
    "drstep.tasks":"Starting daily tasks",
    "drstep.fmBusy":"Waiting for the previous match to end",
    "drstep.fmSearching":"Looking for a Friendly Match",
    "drstep.fmWaitingOpponent":"Match created · waiting for an opponent",
    "drstep.fmPlaying":"Playing the Friendly Match{opponent}",
    "df.joined":"Joined draft room {slot}",
    "df.started":"Draft {slot} started · {count} participants",
    "df.picked":"Picked {player} in the draft (room {slot})",
    "df.pickFailed":"Draft pick failed: {error}",
    "df.ended":"Draft {slot} ended",
    "df.listed":"{name} listed · {price} {currency}",
    "df.listFailed":"{name} could not be listed: {error}",
    "pl.fetched":"Player list updated · {count} players · {up} up · {down} down · {base} at base",
    "pl.autoFetched":"11:05 player list fetched · {count} players · {up} up · {down} down · {base} at base",
    "pl.failed":"Player list could not be read: {error}",
    "at2.started":"Auto Trade started · {accounts} accounts · main: {main}",
    "at2.continued":"Auto Trade continues from where it stopped",
    "at2.paused":"Auto Trade paused",
    "at2.resumed":"Auto Trade resumed",
    "at2.stopped":"Auto Trade stopped",
    "at2.reset":"Auto Trade progress was reset",
    "at2.done":"Auto Trade finished · {bought} bought · {converted} converted · {trades} traded",
    "at2.failed":"Auto Trade stopped: {error}",
    "at2.opened":"{name} opened",
    "by.bought":"{name} bought · {price} {currency}",
    "by.buyFailed":"{name} could not be bought ({price} {currency}): {error}",
    "by.listed":"{name} listed · {price} {currency}",
    "by.parked":"{name} listed at 9,999,999 TIX (waiting for a price)",
    "by.parkFailed":"{name} could not be listed: {error}",
    "by.sellFailed":"{name} could not be listed: {error}",
    "by.unlistFailed":"{name} could not be taken off the market: {error}",
    "ab.start":"Auto Buy started · {rows} player(s) · {accounts} account(s)",
    "ab.pausedTask":"{task} stopped for Auto Buy",
    "ab.resumedTask":"{task} started again",
    "ab.resumeFailed":"{task} could not start again: {error}",
    "ab.stopped":"Auto Buy stopped",
    "ab.failed":"Auto Buy stopped: {error}",
    "ab.noFunds":"Auto Buy stopped · the accounts do not have enough {currency}",
    "ab.cannotBuy":"No account could buy {name} ({price} {currency}) · reason: {reasonEn} · still scanning",
    "tw.start":"Tower started · {count} account(s)",
    "tw.waitMatch":"Already in a match · Tower starts when it ends",
    "tw.matchStarted":"{tower} floor {floor} started",
    "tw.won":"{tower} floor {floor} won",
    "tw.lost":"{tower} floor {floor} lost ({n}/3)",
    "tw.towerStopped":"{tower} lost 3 times in a row at floor {floor} · tower given up",
    "tw.startFailed":"{tower} floor {floor} could not start: {error}",
    "tw.accountDone":"Tower finished for this account",
    "tw.stopped":"Tower stopped",
    "tw.failed":"Tower stopped: {error}",
    "tw.salaryCap":"Tower stopped · over the salary cap: {error}",
    "tw.result":"Tower result · {wins} win(s) · {towers}",
    "tw.summary":"Tower finished · {count} account(s) · {wins} win(s) in total",
    "tw.pausedTask":"{task} stopped for Tower",
    "tw.resumedTask":"{task} started again",
    "tw.resumeFailed":"{task} could not start again: {error}",
    "pvp.start":"PVP started · {count} account(s)",
    "pvp.pausedTask":"{task} stopped for PVP",
    "pvp.resumedTask":"{task} started again",
    "pvp.resumeFailed":"{task} could not start again: {error}",
    "pvp.waitMatch":"Already in a match · PVP will try when it ends",
    "pvp.matchStarted":"PVP match {n} started · {left} attempt(s) left",
    "pvp.matchDone":"PVP match {n} finished · {left} attempt(s) left",
    "pvp.findFailed":"Find PVP Match refused (#{n}): {error}",
    "pvp.inactive":"PVP task stopped because PVP is not active right now",
    "pvp.failed":"PVP stopped: {error}",
    "pvp.resultDone":"PVP result · completed · {played} match(es) played",
    "pvp.resultCut":"PVP result · interrupted ({reason}) · {played} match(es) played · {left} attempt(s) left",
    "pvp.summary":"PVP result · {done}/{total} account(s) completed · {played} match(es) in total",
    "at2.listDone":"{name} market listing completed · {listed}/{total}",
    "at2.mainTurn":"{name} (main) scouting",
    "at2.sideTurn":"{name} (side) opened · {funds} TK",
    "at2.cycle":"Cycle {cycle} / {total} starts",
    "at2.signed":"{player} signed · {price} TK",
    "at2.signFailed":"{player} could not be signed: {error}",
    "at2.callback":"Scout called back · {left} left",
    "at2.converted":"{count} player(s) turned into cards: {names}",
    "at2.makeFailed":"Make failed: {error}",
    "at2.unload":"Main is full · giving players to {name}",
    "at2.traded":"Trade with {side} · main gave {give}, got {take} · {tk} TK",
    "at2.tradeFailed":"Trade with {side} failed: {error}",
    "at2.tradeStuck":"Trade with {side} failed again: {error}",
    "at2.dupNextSide":"{names} already on {side} · kept for the next side",
    "at2.dupOnMain":"{names} is already on main · Make did not solve it. Fix it and continue.",
    "at2.mainFunds":"Main ({name}) lacks TK: has {funds}, needs {need}. Fix it and continue.",
    "at2.mainFull":"Main ({name}) is full and no side could take its players. Fix it and continue.",
    "at2.sideFunds":"{name}: not enough TK ({funds} / {need}) · account skipped",
    "at2.listed":"{name} listed · {price} {currency}",
    "at2.listFailed":"{name} could not be listed: {error}",
    "at2.cardsReset":"Star card counts were reset",
    "at2.cardScan":"Card scan of the main account finished",
    "at2.cardScanFailed":"Card scan failed: {error}",
    "at2.baseSellable":"{player} signed at {salary} (Base {base}) · treated as Satılabilir",
    "dr.rewardsClaimed":"Task rewards claimed · {count} task(s) · {xp} XP · {items}",
    "dr.rewardsFailed":"Task rewards could not be claimed: {error}",
    "drstep.rewards":"Claiming task rewards",
    "dr.rewardsManual":"{accounts} account(s) checked · {count} task reward(s) claimed",
    "dr.rewardsBadge":"🎁 {count} · {xp} XP",
    "eq.scanned":"Equipment scanned · {gear} items ({equipped} equipped) · {ore} Refine Ore · {scroll} Scroll · {sets}/{total} sets · {seconds}s",
    "eq.failed":"Equipment error: {error}",
    "eq.stopped":"Equipment job stopped",
    "eq.converted":"{fabric} {rarity} Fabric → {stone} Refine Stone · Fabric left {left} · Refine Stone {stones}",
    "eq.crafted":"Crafted {count} × {name}",
    "eq.enchanted":"{name} enchanted · {pct}% · ATK {off} · DEF {def} · Scroll left {scroll}",
    "eq.enhanced":"{name} is now +{level}",
    "eq.enhanceFailed":"{name} +{level} enhance failed",
    "eq.enhanceDone":"{name} +{from} → +{level} · {tries} tries · {fails} failed",
    "eq.eventReward":"Equipment event reward: {reward}",
    "eq.refined":"{name} Refine {from} → {level} · Ore left {ore}",
    "eq.refineFailed":"{name} Refine {from} failed · Ore left {ore}",
    "eq.refineDowngraded":"{name} Refine {from} → {level} downgraded · Ore left {ore}",
    "eq.registered":"{name} · {count} piece(s) registered",
    "eq.setCompleted":"{name} completed · {count} piece(s) registered",
    "eq.setAlready":"{name} is already complete",
    "eq.prepareStart":"Preparing {name} · {crafts} craft(s) · {enhances} enhance(s)",
    "eq.prepareShort":"{name} cannot be prepared · missing: {short}",
    "eqstep.login":"Getting the session",
    "eqstep.bag":"Reading the bag",
    "eqstep.collections":"Reading collections",
    "eqstep.recipes":"Reading recipes",
    "eqstep.convert":"{count} conversion(s)",
    "eqstep.craft":"{count} × {name}",
    "eqstep.enchant":"{name}",
    "eqstep.enhance":"{name} +{level} → +{target} · try {tries}",
    "eqstep.refine":"{name} Refine {level}",
    "eqstep.register":"{name}",
    "eqstep.prepare":"{name} · step {done}/{total}"
  }
};
// Shared login / navigation steps are logged by many services without a code;
// their fixed English text is shown in the page language.
const KNOWN_TEXT={
  'Refreshing sign-in screen…':{tr:'Giriş ekranı yenileniyor…'},
  'Opening DreamTeam…':{tr:'DreamTeam açılıyor…'},
  'Signing in…':{tr:'Giriş yapılıyor…'},
  'Returning to Stadium…':{tr:'Stadium\'a dönülüyor…'},
  'Opening Match…':{tr:'Match ekranı açılıyor…'},
  'Refreshing the Match screen…':{tr:'Match ekranı yenileniyor…'}
};
const LOCALE={tr:'tr-TR',en:'en-US'};
const fmtParam=(key,value,lang)=>key==='opponent'?String(value||''):value==null?'—':key==='start'?fmtTrTime(value,LOCALE[lang]):typeof value==='number'?value.toLocaleString(LOCALE[lang]):String(value);
// Text for a service code in the page language; falls back to the English message.
function msgText(t,code,params={},fallback=''){
  if(code==='tn.accountDone'||code==='tstep.outcome')return outcomeText(t,params);
  if(code==='tn.report'){
    const rows=params.rows||[];const ok=rows.filter(r=>REPORT_OK.has(r.outcome));const not=rows.filter(r=>!REPORT_OK.has(r.outcome));
    const m=MSG[t.lang]||MSG.en;
    return [ok.length?`${ok.map(r=>r.name).join(', ')} ${m['report.ok']}`:'',not.length?`${not.map(r=>`${r.name} (${outcomeText(t,r)})`).join(', ')} ${m['report.not']}`:''].filter(Boolean).join(' · ');
  }
  const tpl=(MSG[t.lang]||MSG.en)[code];
  if(!tpl)return KNOWN_TEXT[fallback]?.[t.lang]||fallback;
  return tpl.replace(/\{(\w+)\}/g,(_,k)=>fmtParam(k,params?.[k],t.lang));
}
const outcomeText=(t,{outcome,details})=>`${t[`tournamentOutcome_${outcome}`]||outcome}${details?` · ${details}`:''}`;
function tradeStatusText(t,rt){
  if(rt.status==='starting')return msgText(t,'th.connecting');
  if(rt.status==='running'){
    const main=msgText(t,rt.phase==='base'?'th.runBase':'th.runListings',{page:rt.page,total:rt.totalPages,count:rt.count});
    return rt.etaSeconds?`${main} · ${msgText(t,'th.eta',{eta:rt.etaSeconds})}`:main;
  }
  if(rt.status==='done'&&rt.durationSeconds!=null){
    const main=msgText(t,'th.done',{count:rt.count,base:rt.baseCount,seconds:rt.durationSeconds});
    return rt.stoppedByPrice?`${main} · ${msgText(t,'th.priceStopShort')}`:main;
  }
  if(rt.status==='stopped')return msgText(t,'th.stopped',{count:rt.count});
  if(rt.status==='error')return msgText(t,'th.failed',{error:rt.error||rt.message});
  return rt.message||'';
}
function scheduleText(t,s){
  if(s.scheduleType!=='task')return s.result==='disabled'?msgText(t,'sch.disabled'):(s.message||'');
  if(!s.started)return msgText(t,'sch.waiting');
  if(s.phase==='done')return msgText(t,`sch.${s.result||'completed'}`);
  if(s.phase==='preparing')return msgText(t,'sch.preparing',{time:s.runAt?new Date(s.runAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—'});
  return msgText(t,`sch.${s.phase}`,{count:(s.resume||[]).length},s.message||'');
}
function Icon({ name, size=18 }) {
  const p = {
    gear:<><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></>,
    home:<><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></>,
    accounts:<><circle cx="9" cy="8" r="4"/><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/><path d="M17 11a4 4 0 0 1 4 4v4"/></>,
    play:<path d="M8 5l11 7-11 7z"/>, stop:<rect x="6" y="6" width="12" height="12" rx="2"/>,
    scout:<><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/><path d="M8 11h6M11 8v6"/></>,
    trade:<><path d="M4 7h16M4 12h16M4 17h16"/><path d="M7 4v16M17 4v16"/></>,
    market:<><path d="M3 10h18l-2-6H5zM5 10v11h14V10M9 21v-7h6v7"/></>,
    cards:<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    activity:<path d="M3 12h4l3-7 4 14 3-7h4"/>, settings:<><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></>,
    plus:<path d="M12 5v14M5 12h14"/>, refresh:<><path d="M20 6v6h-6"/><path d="M4 18v-6h6"/><path d="M18 9a7 7 0 0 0-12-2l-2 2M6 15a7 7 0 0 0 12 2l2-2"/></>,
    tower:<><path d="M7 21V8l5-5 5 5v13"/><path d="M4 21h16M10 21v-4h4v4M10 11h4M10 14h4"/></>,
    cart:<><path d="M3 4h2l2.4 11h10.2L20 7H6.2"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></>,
    sword:<><path d="M14 4h6v6L10 20l-3-3z"/><path d="M5 14l5 5M4 20l2-2"/></>,
    swap:<><path d="M4 8h13l-3-3M20 16H7l3 3"/></>, chart:<><path d="M4 19h16"/><path d="M5 15l4-4 3 3 6-7"/><path d="M15 7h3v3"/></>, target:<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/></>, shirt:<path d="M8 3l4 2 4-2 5 4-3 3-2-1v12H8V9L6 10 3 7z"/>, hall:<><path d="M3 9l9-5 9 5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></>,
    book:<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7M8 11h7"/></>,
    trash:<><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></>, folder:<path d="M3 6h7l2 2h9v11H3z"/>, chevron:<path d="M9 18l6-6-6-6"/>, grip:<><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></>, trophy:<><path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 21h6M10 17h4"/></>, star:<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{p[name]}</svg>;
}

const fmtNumber = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined,{maximumFractionDigits:2});
const fmtTk = value => value == null || value === '' ? '—' : /TK$/i.test(String(value).trim()) ? String(value).trim() : `${fmtNumber(value)} TK`;
const moneyNumber = value => { const raw=String(value??'').replace(/TK/ig,'').trim().replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'); const n=Number(raw.replace(/[^0-9.-]/g,'')); return Number.isFinite(n)?n:null; };
const fmtExp = stats => stats?.expCurrent != null && stats?.expMax != null ? `${fmtNumber(stats.expCurrent)} / ${fmtNumber(stats.expMax)}` : '—';
const fmtTime = value => value ? new Date(value).toLocaleString() : '—';
const starText = n => `${Math.max(0,Number(n||0))}★`;
const gradeToneClass = grade => {
  const first = String(grade || '').trim().toUpperCase().charAt(0);
  return ['S','A','B','C','D'].includes(first) ? `grade-${first.toLowerCase()}` : 'grade-neutral';
};
const roleStyle = role => ({ backgroundColor: role?.color || '#64748b', borderColor: role?.color || '#64748b' });
const ROLE_COLOR_PALETTE = ['#2563eb','#7c3aed','#d97706','#0f766e','#db2777','#4f46e5','#ea580c','#475569'];

function StarValue({ value }) {
  return <span className="star-value">{starText(value)}</span>;
}

function RoleBadge({ role, compact=false }) {
  if (!role) return null;
  return <span className={`role-badge ${compact?'compact':''}`} style={roleStyle(role)}>{role.name}</span>;
}

// `selected` null means "All": every option is ticked, and so is All.
// Unticking one option unticks All; unticking All leaves nothing selected.
const filterPasses=(selected,value)=>selected==null||selected.includes(value);
function MultiSelectFilter({ label, allLabel, options, selected, onChange, renderLabel }) {
  const values = options.map(opt => typeof opt === 'object' ? opt.value : opt);
  const all = selected == null || (values.length > 0 && values.every(v => selected.includes(v)));
  const isOn = value => all || selected.includes(value);
  const toggle = value => {
    const current = all ? values : selected;
    const next = current.includes(value) ? current.filter(x=>x!==value) : [...current, value];
    onChange(values.every(v => next.includes(v)) ? null : next);
  };
  const summary = all ? `${label}: ${allLabel}` : `${label}: ${selected.length}`;
  return <details className="multi-filter">
    <summary>{summary}</summary>
    <div className="multi-filter-menu">
      <label className="multi-filter-all"><input type="checkbox" checked={all} onChange={()=>onChange(all?[]:null)}/><span>{allLabel}</span></label>
      {options.map(opt=>{
        const value = typeof opt === 'object' ? opt.value : opt;
        const lbl = renderLabel ? renderLabel(opt) : (typeof opt === 'object' ? opt.label : opt);
        return <label key={String(value)}><input type="checkbox" checked={isOn(value)} onChange={()=>toggle(value)}/><span>{lbl}</span></label>;
      })}
    </div>
  </details>;
}

function progressText(progress, t) {
  if (!progress) return '—';
  if (progress.maxed) return '5★ MAX';
  // Above 2★ a synthesis can fail (75%), so that target is marked.
  const base = `${fmtNumber(progress.current)}/${fmtNumber(progress.required)} → ${progress.targetStars}★${progress.guaranteed===false?' (%75)':''}`;
  return progress.ready ? `${base} · ${t.ready}` : base;
}

function ProgressValue({ progress, t, className='' }) {
  const text = progressText(progress, t);
  const parts = String(text).split(/(\d+★)/g);
  return <span className={className}>{parts.map((part,i)=>/\d+★/.test(part)?<span className="star-value" key={i}>{part}</span>:<React.Fragment key={i}>{part}</React.Fragment>)}</span>;
}

function Modal({ title, children, onClose, width=520 }) {
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal" style={{maxWidth:width}}><div className="modal-head"><b>{title}</b><button className="icon-btn" onClick={onClose}>×</button></div>{children}</div></div>;
}

function Status({ runtime, t }) {
  const s = runtime?.status || 'stopped';
  const cls = ['running','preparing','starting'].includes(s) ? 'ok' : s==='error' ? 'bad' : s==='stopping' ? 'warn' : 'muted';
  const label = runtime?.phase==='daily'?t.dailyPhase:s==='running'?t.running:s==='preparing'||s==='starting'?t.preparing:s==='error'?t.error:t.stopped;
  return <span className={`pill ${cls}`}><i/>{label}{runtime?.mode ? ` · ${runtime.mode}`:''}</span>;
}

// Daily (and alliance) tasks of one account: done/total, rewards waiting, what is left.
function TasksCell({ info, t }) {
  if (!info) return <span className="muted-text">—</span>;
  if (info.needsStart) return <span className="pill muted"><i/>{t.tasksNotStarted}</span>;
  const daily=info.list.filter(x=>!x.alliance); const alliance=info.list.filter(x=>x.alliance);
  const done=l=>l.filter(x=>x.completed).length;
  const ready=info.list.filter(x=>x.completed&&!x.claimed).length;
  const left=info.list.filter(x=>!x.completed);
  const tone=l=>done(l)===l.length?'ok':'warn';
  return <div className="task-cell" title={info.at?`${t.tasksUpdated} ${new Date(info.at).toLocaleTimeString()}`:''}>
    <div className="task-cell-top">
      <span className={`pill ${tone(daily)}`}><i/>{t.tasksDaily} {done(daily)}/{daily.length}</span>
      {alliance.length>0&&<span className={`pill ${tone(alliance)}`}><i/>{t.tasksAlliance} {done(alliance)}/{alliance.length}</span>}
      {ready>0&&<span className="pill gift" title={t.tasksReadyHint}>🎁 {ready}</span>}
    </div>
    {left.length>0&&<div className="task-cell-left">{left.map(x=><span key={x.taskId} className={x.alliance?'alliance':''}>{x.title} <b>{x.progress}/{x.required}</b></span>)}</div>}
  </div>;
}

function DailyRoutineStatus({ entry, t }) {
  if (!entry) return null;
  const reward=entry.rewards?.count?<span className="pill muted" title={entry.rewards.at?new Date(entry.rewards.at).toLocaleTimeString():''}><i/>{msgText(t,'dr.rewardsBadge',{count:entry.rewards.count,xp:entry.rewards.xp})}</span>:null;
  return <>{dailyRoutinePill(entry,t)}{reward}</>;
}
function dailyRoutinePill(entry, t) {
  if (entry.status==='working') return <span className="pill warn"><i/>{msgText(t,`drstep.${entry.step}`,{...entry.stepParams,opponent:entry.stepParams?.opponent?` · ${entry.stepParams.opponent}`:''})}</span>;
  if (entry.status==='done') return <span className="pill ok" title={entry.doneAt?new Date(entry.doneAt).toLocaleString():''}><i/>{t.dailyDone}</span>;
  if (entry.status==='error') return <span className="pill bad" title={entry.error||''}><i/>{t.dailyFailed}</span>;
  return <span className="pill muted"><i/>{t.dailyPending}</span>;
}

// Live Scout countdown from the end time (the old text stayed at its first value).
function ScoutTimer({ data }) {
  const now=useSyncExternalStore(subscribeClock,readClock,readClock);
  if(!data?.cooldownEnds)return <strong>{data?.timer||'—'}</strong>;
  const s=Math.max(0,Math.ceil((data.cooldownEnds-now)/1000));
  return <strong className={s===0?'scout-timer-zero':''}>{String(Math.floor(s/60)).padStart(2,'0')}:{String(s%60).padStart(2,'0')}</strong>;
}

function RewardStatus({ reward, t }) {
  const now=useSyncExternalStore(subscribeClock,readClock,readClock);
  if (!reward || reward.status==='idle') return <span>—</span>;
  const seconds = reward.nextAt ? Math.max(0,Math.ceil((new Date(reward.nextAt).getTime()-now)/1000)) : null;
  const clock = seconds==null ? null : `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor((seconds%3600)/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  const tier = reward.tier ? `T${reward.tier} · ` : '';
  if (reward.status==='waiting') return <span className="pill ok"><i/>{tier}{clock||reward.timerText||'—'}</span>;
  if (reward.status==='checking') return <span className="pill warn"><i/>{t.rewardChecking}</span>;
  if (reward.status==='claiming') return <span className="pill warn"><i/>{t.rewardClaiming}</span>;
  if (reward.status==='deferred') return <span className="pill muted"><i/>{t.rewardDeferred}</span>;
  if (reward.status==='reset-wait') return <span className="pill muted"><i/>{t.rewardResetWait} · {clock||'—'}</span>;
  if (reward.status==='completed') return <span className="pill ok"><i/>{t.rewardCompleted} · {clock||'—'}</span>;
  if (reward.status==='unknown') return <span className="pill bad"><i/>{t.rewardUnknown}</span>;
  if (reward.status==='error') return <span className="pill bad"><i/>{t.error}</span>;
  return <span className="pill muted"><i/>{clock||'—'}</span>;
}

function AddAccountModal({ t, account, onClose, refresh, toast }) {
  const [form,setForm]=useState({name:account?.name||'',login:account?.login||'',password:''});
  const submit=async e=>{e.preventDefault();try{account?await api.accounts.update(account.id,form):await api.accounts.add(form);await refresh();onClose();}catch(err){toast(err.message,'error')}};
  return <Modal title={account?t.edit:t.addAccount} onClose={onClose}><form className="form" onSubmit={submit}><label><span>{t.name}</span><input autoFocus value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label><span>{t.login}</span><input required value={form.login} onChange={e=>setForm({...form,login:e.target.value})}/></label><label><span>{t.password}</span><input type="password" required={!account} placeholder={account?'••••••••':''} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label><div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>{t.cancel}</button><button className="btn primary">{t.save}</button></div></form></Modal>;
}

function TradeAccountModal({ t, current, onClose, refresh, toast }) {
  const [form,setForm]=useState({name:current?.name||'Trade Account',login:current?.login||'',password:''});
  const submit=async e=>{e.preventDefault();try{await api.trade.saveAccount(form);await refresh();onClose();}catch(err){toast(err.message,'error')}};
  return <Modal title={t.tradeAccount} onClose={onClose}><form className="form" onSubmit={submit}><label><span>{t.name}</span><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label><span>{t.login}</span><input required value={form.login} onChange={e=>setForm({...form,login:e.target.value})}/></label><label><span>{t.password}</span><input type="password" required={!current} placeholder={current?'••••••••':''} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label><div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>{t.cancel}</button><button className="btn primary">{t.save}</button></div></form></Modal>;
}

function MainAccountStrip({ state, t }) {
  const profile=state.accountProfile||{};
  const main=state.accounts.find(a=>a.id===profile.mainAccountId);
  if(!main) return <div className="main-account-strip muted-main"><b>{t.mainAccount}</b><span>—</span></div>;
  const stats=profile.accounts?.[main.id]||{};
  return <div className="main-account-strip"><b>{t.mainAccount}: {main.name}</b><span>{t.level} {stats.level??'—'}</span><span>{t.exp} {fmtExp(stats)}</span><span>{t.tk} {fmtTk(stats.tk)}</span><span>{t.apk} {fmtNumber(stats.apk)}</span><span>{t.tix} {fmtNumber(stats.tix)}</span><span>{t.roster} {stats.roster!=null?`${stats.roster}/${stats.rosterMax??'—'}`:'—'}</span></div>;
}

function Home({ state, t, go }) {
  const active=Object.values(state.runtime||{}).filter(x=>x.status==='running').length;
  const scouts=Object.values(state.scout||{}).filter(x=>x.status==='open').length;
  const tr=state.trading?.runtime||{};
  const totalApk=state.accountProfile?.totalUsableApk;
  const totalTix=state.accountProfile?.totalUsableTix;
  return <div className="page"><div className="page-title"><h1>DreamTeam Manager</h1></div><MainAccountStrip state={state} t={t}/><div className="metrics metrics-five"><button onClick={()=>go('accounts')}><span>{t.dashboardAccounts}</span><b>{state.accounts.length}</b></button><button onClick={()=>go('autoplay')}><span>{t.dashboardRunning}</span><b>{active}</b></button><button onClick={()=>go('scout')}><span>{t.dashboardScout}</span><b>{scouts}</b></button><button onClick={()=>go('trade')}><span>{t.dashboardTrade}</span><b className={tr.status==='running'?'green':''}>{tr.status==='running'?`${tr.page}/${tr.totalPages||'?'}`:tr.count||0}</b></button><button onClick={()=>go('accounts')}><span>{t.usableApk} / {t.tix}</span><b>{fmtNumber(totalApk)} <small>/ {fmtNumber(totalTix)}</small></b></button></div><div className="quick-grid"><button onClick={()=>go('autoplay')}><Icon name="play"/><b>Auto Play</b></button><button onClick={()=>go('scout')}><Icon name="scout"/><b>Scout</b></button><button onClick={()=>go('trade')}><Icon name="trade"/><b>Trading Hall</b></button><button onClick={()=>go('cards')}><Icon name="cards"/><b>{t.cards}</b></button></div></div>;
}

// Press and hold a row's handle to drag it; the rows in between slide out of
// the way and the dropped row settles into its slot. Arrow keys on a focused
// handle move it one step. onCommit(ids) receives the new order.
const ROW_SHIFT='transform 200ms cubic-bezier(.2,.8,.2,1)';
function useRowReorder(ids,onCommit){
  const rows=useRef(new Map());
  const session=useRef(null);
  const [drag,setDrag]=useState(null);
  const [settle,setSettle]=useState(null);
  const rowRef=id=>el=>{if(el)rows.current.set(id,el);else rows.current.delete(id)};
  const commit=next=>{if(next.join()!==ids.join())onCommit(next)};
  const onPointerDown=(e,id)=>{
    if(e.button!==0)return;
    e.preventDefault();
    const rects=ids.map(x=>rows.current.get(x)?.getBoundingClientRect());
    if(rects.some(r=>!r))return;
    const from=ids.indexOf(id);
    session.current={id,from,to:from,rects,startY:e.clientY,dy:0};
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({id,from,to:from,dy:0,height:rects[from].height});
  };
  const onPointerMove=e=>{
    const d=session.current; if(!d)return;
    const {rects,from}=d;
    const top=rects[0].top-rects[from].top, bottom=rects[rects.length-1].bottom-rects[from].bottom;
    const dy=Math.max(top,Math.min(bottom,e.clientY-d.startY));
    const center=rects[from].top+rects[from].height/2+dy;
    let to=from;
    // <= / >=: a row pushed against the first/last row takes that slot.
    for(let i=0;i<from;i++)if(center<=rects[i].top+rects[i].height/2){to=i;break;}
    for(let i=rects.length-1;i>from;i--)if(center>=rects[i].top+rects[i].height/2){to=i;break;}
    d.dy=dy;d.to=to;
    setDrag({id:d.id,from,to,dy,height:rects[from].height});
  };
  const onPointerUp=()=>{
    const d=session.current; if(!d)return;
    session.current=null;
    const next=[...ids];const [moved]=next.splice(d.from,1);next.splice(d.to,0,moved);
    // Where the row is on screen right now, so it can glide into its new slot.
    setSettle({id:d.id,top:d.rects[d.from].top+d.dy});
    setDrag(null);
    commit(next);
  };
  const onKeyDown=(e,id)=>{
    const step=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
    if(!step)return;
    e.preventDefault();
    const from=ids.indexOf(id),to=from+step;
    if(to<0||to>=ids.length)return;
    const next=[...ids];next.splice(from,1);next.splice(to,0,id);
    setSettle({id,top:rows.current.get(id)?.getBoundingClientRect().top,focus:true});
    commit(next);
  };
  useLayoutEffect(()=>{
    if(!settle)return;
    const el=rows.current.get(settle.id);
    if(!el||settle.top==null){setSettle(null);return;}
    const offset=settle.top-el.getBoundingClientRect().top;
    el.style.transition='none';
    el.style.transform=`translateY(${offset}px)`;
    el.getBoundingClientRect();
    el.style.transition=ROW_SHIFT;
    el.style.transform='';
    if(settle.focus)el.querySelector('.row-handle')?.focus();
    const done=()=>{el.style.transition='';el.removeEventListener('transitionend',done)};
    el.addEventListener('transitionend',done);
    setSettle(null);
  },[settle,ids]);
  const rowProps=(id,index)=>{
    const props={ref:rowRef(id)};
    if(!drag)return props;
    if(id===drag.id)return {...props,className:'row-dragging',style:{transform:`translateY(${drag.dy}px) scale(1.01)`,transition:'none'}};
    let shift=0;
    if(drag.from<drag.to&&index>drag.from&&index<=drag.to)shift=-drag.height;
    if(drag.to<drag.from&&index>=drag.to&&index<drag.from)shift=drag.height;
    return {...props,style:{transform:shift?`translateY(${shift}px)`:'',transition:ROW_SHIFT}};
  };
  const handleProps=id=>({className:'row-handle',onPointerDown:e=>onPointerDown(e,id),onPointerMove,onPointerUp,onPointerCancel:onPointerUp,onKeyDown:e=>onKeyDown(e,id)});
  return {rowProps,handleProps,dragging:Boolean(drag)};
}

function Accounts({ state, t, refresh, toast }) {
  const [modal,setModal]=useState(null);
  const profile=state.accountProfile||{};
  const remove=async a=>{if(!confirm(t.removeConfirm))return;try{await api.accounts.remove(a.id);await refresh()}catch(e){toast(e.message,'error')}};
  const setMain=async id=>{try{await api.accounts.setMain(id);await refresh()}catch(e){toast(e.message,'error')}};
  // Show the new order at once; the saved order replaces it when it arrives.
  const serverIds=state.accounts.map(a=>a.id);
  const [pendingOrder,setPendingOrder]=useState(null);
  const ids=pendingOrder&&pendingOrder.join()!==serverIds.join()&&pendingOrder.length===serverIds.length?pendingOrder:serverIds;
  useEffect(()=>{if(pendingOrder&&pendingOrder.join()===serverIds.join())setPendingOrder(null)},[serverIds.join()]);
  const reorder=useRowReorder(ids,async next=>{setPendingOrder(next);try{await api.accounts.reorder(next);await refresh()}catch(e){setPendingOrder(null);toast(e.message,'error')}});
  const byId=new Map(state.accounts.map(a=>[a.id,a]));
  return <div className="page"><div className="page-title"><div><h1>{t.accounts}</h1><span className="subtitle">{t.usableApk}: {fmtNumber(profile.totalUsableApk)} · {t.usableTix}: {fmtNumber(profile.totalUsableTix)}</span></div><button className="btn primary" onClick={()=>setModal({})}><Icon name="plus"/> {t.addAccount}</button></div><div className={`panel table-panel reorder-table ${reorder.dragging?'is-dragging':''}`}><table><thead><tr><th className="handle-col"></th><th>{t.name}</th><th>{t.mainAccount}</th><th>{t.level}</th><th>{t.exp}</th><th>{t.apk}</th><th>{t.apkContribution}</th><th>{t.tix}</th><th>{t.tixContribution}</th><th>{t.tk}</th><th>{t.status}</th><th></th></tr></thead><tbody>{ids.map((id,index)=>{const a=byId.get(id);if(!a)return null;const stats=profile.accounts?.[a.id]||{};const isMain=profile.mainAccountId===a.id;return <tr key={a.id} {...reorder.rowProps(a.id,index)}><td className="handle-col"><button type="button" {...reorder.handleProps(a.id)} title={t.dragToReorder} aria-label={`${t.dragToReorder}: ${a.name}`}><Icon name="grip" size={16}/></button></td><td><b>{a.name}</b><small className="cell-sub">{a.login}</small></td><td><button className={`main-select ${isMain?'selected':''}`} onClick={()=>setMain(a.id)}>{isMain?t.mainAccount:t.makeMain}</button></td><td>{stats.level??'—'}</td><td>{fmtExp(stats)}</td><td><b>{fmtNumber(stats.apk)}</b></td><td>{fmtNumber(profile.effectiveApk?.[a.id]??0)}</td><td><b>{fmtNumber(stats.tix)}</b></td><td>{fmtNumber(profile.effectiveTix?.[a.id]??0)}</td><td>{fmtTk(stats.tk)}</td><td><Status runtime={state.runtime?.[a.id]} t={t}/></td><td className="actions"><button className="icon-btn" onClick={()=>setModal(a)}><Icon name="settings" size={16}/></button><button className="icon-btn danger" onClick={()=>remove(a)}><Icon name="trash" size={16}/></button></td></tr>})}</tbody></table>{!state.accounts.length&&<div className="empty">{t.addAccount}</div>}</div>{modal&&<AddAccountModal t={t} account={modal.id?modal:null} onClose={()=>setModal(null)} refresh={refresh} toast={toast}/>}</div>;
}

// Task names in the page language; built-in tasks keep both languages in their stored name.
const taskLabel=(t,id,fallback)=>t[`builtin_${id}`]||fallback||id;
function ScheduleModal({ state, t, onClose, refresh, toast }) {
  const d=new Date(Date.now()+15*60000); d.setSeconds(0,0);
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  // Auto Play is started and stopped by hand; only tasks are scheduled.
  const tasks=[...(state.tasks||[]).filter(task=>!task.loadError&&task.id!=='task1-quick-play'),...(state.builtinTasks||[])];
  const [form,setForm]=useState({taskId:tasks.find(x=>x.id==='tournament-register')?.id||tasks[0]?.id||'',accountIds:[],startAtLocal:local,preparationMinutes:state.settings.defaultPreparationMinutes??6,executionMode:'parallel',delaySeconds:30});
  const set=patch=>setForm(f=>({...f,...patch}));
  const toggle=id=>setForm(f=>({...f,accountIds:f.accountIds.includes(id)?f.accountIds.filter(x=>x!==id):[...f.accountIds,id]}));
  const isBuiltin=(state.builtinTasks||[]).some(x=>x.id===form.taskId);
  const submit=async e=>{
    e.preventDefault();
    try{
      const task=tasks.find(x=>x.id===form.taskId);
      if(!task)throw new Error(t.scheduleNoTask);
      await api.schedules.add({name:task.name,taskId:task.id,scheduleType:'task',accountIds:form.accountIds,startAt:new Date(form.startAtLocal).toISOString(),preparationMinutes:Number(form.preparationMinutes),executionMode:form.executionMode,delaySeconds:Number(form.delaySeconds),visibleBrowser:false});
      await refresh();onClose();
    }catch(err){toast(err.message,'error')}
  };
  return <Modal title={t.schedule} onClose={onClose} width={600}><form className="form" onSubmit={submit}>
    <label><span>{t.scheduleTask}</span><select required value={form.taskId} onChange={e=>set({taskId:e.target.value})}>{tasks.map(task=><option key={task.id} value={task.id}>{taskLabel(t,task.id,task.name)}</option>)}</select></label>
    <small className="schedule-help">{t.scheduleTaskHelp}</small>
    <label><span>{t.accounts}</span><div className="account-picks">{state.accounts.map(a=><button type="button" key={a.id} className={form.accountIds.includes(a.id)?'selected':''} onClick={()=>toggle(a.id)}>{a.name}</button>)}</div></label>
    <div className="form-two"><label><span>{t.at}</span><input type="datetime-local" required value={form.startAtLocal} onChange={e=>set({startAtLocal:e.target.value})}/></label><label><span>{t.prepare} ({t.minutes})</span><input type="number" min="0" value={form.preparationMinutes} onChange={e=>set({preparationMinutes:e.target.value})}/></label></div>
    {!isBuiltin&&<div className="form-two"><label><span>{t.scheduleMode}</span><select value={form.executionMode} onChange={e=>set({executionMode:e.target.value})}><option value="parallel">{t.scheduleParallel}</option><option value="staggered">{t.scheduleStaggered}</option></select></label>{form.executionMode==='staggered'&&<label><span>{t.scheduleDelay} ({t.seconds})</span><input type="number" min="0" value={form.delaySeconds} onChange={e=>set({delaySeconds:e.target.value})}/></label>}</div>}
    <div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>{t.cancel}</button><button className="btn primary" disabled={!form.accountIds.length||!form.taskId}>{t.save}</button></div>
  </form></Modal>;
}

function AutoPlay({ state, t, refresh, toast }) {
  const [scheduleOpen,setScheduleOpen]=useState(false);
  const [selectedIds,setSelectedIds]=useState([]);
  const [batchBusy,setBatchBusy]=useState(false);
  const run=async(a,fn)=>{try{await fn();await refresh()}catch(e){toast(e.message,'error')}};
  const profile=state.accountProfile||{};
  const accountKey=state.accounts.map(a=>a.id).join('|');
  useEffect(()=>{const valid=new Set(state.accounts.map(a=>a.id));setSelectedIds(ids=>ids.filter(id=>valid.has(id)))},[accountKey]);
  const toggleSelected=id=>setSelectedIds(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);
  const allSelected=state.accounts.length>0&&selectedIds.length===state.accounts.length;
  const toggleAll=()=>setSelectedIds(allSelected?[]:state.accounts.map(a=>a.id));
  const daily=state.dailyRoutine||{};
  const dailyIds=daily.selected||[];
  const allDaily=state.accounts.length>0&&state.accounts.every(a=>dailyIds.includes(a.id));
  const saveDaily=async ids=>{try{await api.settings.update({dailyRoutineAccountIds:ids});await refresh()}catch(e){toast(e.message,'error')}};
  const toggleDaily=id=>saveDaily(dailyIds.includes(id)?dailyIds.filter(x=>x!==id):[...dailyIds,id]);
  const [claiming,setClaiming]=useState(false);
  const [tasksBusy,setTasksBusy]=useState(false);
  const refreshTasks=async(quiet=false)=>{setTasksBusy(true);try{await api.daily.refreshTasks(state.accounts.map(a=>a.id));await refresh()}catch(e){if(!quiet)toast(e.message,'error')}finally{setTasksBusy(false)}};
  useEffect(()=>{const ats=state.accounts.map(a=>Date.parse(daily.tasks?.[a.id]?.at||0));if(!ats.length||Math.min(...ats)<Date.now()-5*60*1000)refreshTasks(true)},[]);
  // Selected rows, or (nothing selected) the accounts ticked in the Daily column.
  const claimRewards=async()=>{const ids=selectedIds.length?selectedIds:dailyIds;setClaiming(true);try{const res=await api.daily.claimRewards(ids);const total=Object.values(res||{}).reduce((n,r)=>n+(r?.count||0),0);toast(msgText(t,'dr.rewardsManual',{accounts:ids.length,count:total}),total?'success':'info');await refresh()}catch(e){toast(e.message,'error')}finally{setClaiming(false)}};
  const runBatch=async (mode, ids=selectedIds)=>{
    if(batchBusy||!ids.length)return;
    setBatchBusy(true);
    const failed=[];
    try{
      for(const id of ids){
        const account=state.accounts.find(a=>a.id===id); if(!account)continue;
        const status=state.runtime?.[id]?.status;
        const active=['running','preparing','starting','stopping'].includes(status);
        try{
          if(mode==='start'&&!active)await api.accounts.start(id);
          if(mode==='stop'&&active)await api.accounts.stop(id);
        }catch(e){failed.push(`${account.name}: ${e.message}`)}
      }
      await refresh();
      if(failed.length)toast(`${failed.length} hesap: ${failed[0]}`,'error');
    }finally{setBatchBusy(false)}
  };
  return <div className="page"><div className="page-title"><div><h1>Auto Play</h1><span className="subtitle">Quick Play · 270s · {selectedIds.length} {t.selected}</span></div><div className="toolbar"><button className="btn success" disabled={batchBusy||!selectedIds.length} onClick={()=>runBatch('start')}><Icon name="play"/> {t.startSelected}</button><button className="btn danger-soft" disabled={batchBusy||!selectedIds.length} onClick={()=>runBatch('stop')}><Icon name="stop"/> {t.stopSelected}</button><button className="btn success" disabled={batchBusy||!state.accounts.length} onClick={()=>runBatch('start',state.accounts.map(a=>a.id))}><Icon name="play"/> {t.startAll}</button><button className="btn danger-soft" disabled={batchBusy||!state.accounts.length} onClick={()=>runBatch('stop',state.accounts.map(a=>a.id))}><Icon name="stop"/> {t.stopAll}</button><button className="btn ghost" disabled={tasksBusy} onClick={()=>refreshTasks()}>{tasksBusy?t.tasksRefreshing:t.tasksRefresh}</button><button className="btn ghost" disabled={claiming||!(selectedIds.length?selectedIds:dailyIds).length} title={t.claimRewardsHint} onClick={claimRewards}>{claiming?t.claimingRewards:t.claimRewards}</button><button className="btn ghost" onClick={()=>setScheduleOpen(true)}>{t.schedule}</button></div></div><div className="panel table-panel"><table><thead><tr><th className="select-col"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t.selectAll}/></th><th>{t.account}</th><th>{t.level}</th><th>{t.apk}</th><th>{t.tix}</th><th>{t.status}</th><th>{t.next}</th><th title={t.dailyRoutineHint}><label className="switchline"><input type="checkbox" checked={allDaily} onChange={()=>saveDaily(allDaily?[]:state.accounts.map(a=>a.id))} aria-label={t.dailyRoutine}/><span>{t.dailyRoutine}</span></label></th><th>{t.tasksColumn}</th><th>{t.dailyReward}</th><th>{t.browser}</th><th></th></tr></thead><tbody>{state.accounts.map(a=>{const r=state.runtime?.[a.id];const stats=profile.accounts?.[a.id]||{};const active=['running','preparing','starting','stopping'].includes(r?.status);return <tr key={a.id} className={selectedIds.includes(a.id)?'selected-row-soft':''}><td className="select-col"><input type="checkbox" checked={selectedIds.includes(a.id)} onChange={()=>toggleSelected(a.id)} aria-label={a.name}/></td><td><b>{a.name}</b>{profile.mainAccountId===a.id&&<span className="main-dot">{t.mainBadge}</span>}</td><td>{stats.level??'—'}</td><td>{fmtNumber(stats.apk)}</td><td>{fmtNumber(stats.tix)}</td><td><Status runtime={r} t={t}/></td><td>{r?.nextActionAt?new Date(r.nextActionAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'}</td><td><div className="daily-cell"><input type="checkbox" checked={dailyIds.includes(a.id)} onChange={()=>toggleDaily(a.id)} aria-label={`${t.dailyRoutine} · ${a.name}`}/>{dailyIds.includes(a.id)&&<DailyRoutineStatus entry={daily.accounts?.[a.id]} t={t}/>}</div></td><td><TasksCell info={daily.tasks?.[a.id]} t={t}/></td><td><RewardStatus reward={state.rewards?.[a.id]} t={t}/></td><td><label className="switchline"><input type="checkbox" checked={!!a.visibleBrowser} onChange={async e=>{await api.accounts.update(a.id,{visibleBrowser:e.target.checked});await refresh()}}/><span>{t.showBrowser}</span></label></td><td className="actions">{active?<button className="btn danger-soft" onClick={()=>run(a,()=>api.accounts.stop(a.id))}><Icon name="stop"/> {t.stop}</button>:<button className="btn success" onClick={()=>run(a,()=>api.accounts.start(a.id))}><Icon name="play"/> {t.start}</button>}</td></tr>})}</tbody></table></div>{state.schedules?.length>0&&<div className="panel schedule-strip">{state.schedules.map(s=><div key={s.id}><b>{new Date(s.startAt).toLocaleString()}</b><span>{taskLabel(t,s.taskId,s.taskName||s.name)} · {s.accountIds.length} {t.accounts.toLowerCase()} · {s.preparationMinutes}{t.minutes}{scheduleText(t,s)?` · ${scheduleText(t,s)}`:''}</span><label><input type="checkbox" checked={!!s.enabled} disabled={s.completed} onChange={async e=>{await api.schedules.toggle(s.id,e.target.checked);await refresh()}}/></label><button className="icon-btn danger" onClick={async()=>{await api.schedules.remove(s.id);await refresh()}}><Icon name="trash" size={14}/></button></div>)}</div>}{scheduleOpen&&<ScheduleModal state={state} t={t} onClose={()=>setScheduleOpen(false)} refresh={refresh} toast={toast}/>}</div>;
}

const RELIST_TONE={ready:'muted',queued:'muted',removing:'warn',listing:'warn',listed:'ok',owned:'bad',failed:'bad',removedNotListed:'bad',stopped:'muted'};
const RELIST_RETRYABLE=new Set(['ready','failed','stopped']);
const LISTING_FILTERS={accountId:'',name:'',grade:'',currency:'',kind:''};
const listingKindOf=r=>r.state==='owned'?'owned':(r.kind||null);
const KIND_TONE={recent:'ok',stock:'muted',onSale:'warn',owned:'bad'};
// One market table (Sold / Listed / Expired) with its own filters and column sorting.
function ListingTable({ t, title, status, rows, edits, edit, busy, actionable, playerIndex }) {
  const [filters,setFilters]=useState(LISTING_FILTERS);
  const [sort,setSort]=useState({key:'price',dir:'asc'});
  const accounts=[...new Map(rows.map(r=>[r.accountId,r.accountName])).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
  const grades=[...new Set(rows.map(r=>r.grade).filter(Boolean))].sort((a,b)=>gradeRank(b)-gradeRank(a));
  const view=useMemo(()=>sortTradingRows(rows.map(r=>({...r,kind:listingKindOf(r),value:playerIndex?.get(r.playerId)?.value??null})).filter(r=>(!filters.accountId||r.accountId===filters.accountId)&&(!filters.name||String(r.name).toLowerCase().includes(filters.name.toLowerCase()))&&(!filters.grade||r.grade===filters.grade)&&(!filters.currency||r.currency===filters.currency)&&(!filters.kind||listingKindOf(r)===filters.kind)),sort),[rows,filters,sort]);
  const sortBy=key=>setSort(s=>({key,dir:s.key===key&&s.dir==='asc'?'desc':'asc'}));
  const th=(key,label)=><th className="sortable" onClick={()=>sortBy(key)}>{label}{sort.key===key?(sort.dir==='asc'?' ↑':' ↓'):''}</th>;
  const pickable=actionable?view.filter(r=>RELIST_RETRYABLE.has(r.state)):[];
  const allPicked=pickable.length>0&&pickable.every(r=>edits[r.ticketId]?.selected);
  const set=(k,v)=>setFilters(f=>({...f,[k]:v}));
  return <section className="listing-section">
    <h3 className="section-title">{title} <small>{view.length===rows.length?rows.length:`${view.length} / ${rows.length}`}</small></h3>
    <div className="listing-filters"><select value={filters.accountId} onChange={e=>set('accountId',e.target.value)}><option value="">{t.all} · {t.account}</option>{accounts.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><input placeholder={t.name} value={filters.name} onChange={e=>set('name',e.target.value)}/><select value={filters.grade} onChange={e=>set('grade',e.target.value)}><option value="">{t.all} · {t.grade}</option>{grades.map(g=><option key={g}>{g}</option>)}</select><select value={filters.currency} onChange={e=>set('currency',e.target.value)}><option value="">{t.all} · APK/TIX</option><option>APK</option><option>TIX</option></select>{actionable&&<select value={filters.kind} onChange={e=>set('kind',e.target.value)}><option value="">{t.all} · {t.marketKind}</option>{['recent','stock','onSale','owned'].filter(k=>rows.some(r=>listingKindOf(r)===k)).map(k=><option key={k} value={k}>{t[`marketKind_${k}`]}</option>)}</select>}<button className="chip reset-chip" onClick={()=>setFilters(LISTING_FILTERS)}>{t.reset}</button></div>
    <div className="panel table-panel listing-table"><table><thead><tr>
      {actionable&&<th className="select-col"><input type="checkbox" checked={allPicked} disabled={busy||!pickable.length} onChange={e=>{for(const r of pickable)edit(r,{selected:e.target.checked})}} aria-label={t.selectAll}/></th>}
      {th('accountName',t.account)}{th('name',t.players)}{th('grade',t.grade)}{th('value',t.value)}{th('salary',t.salary)}{th('base',t.base)}{th('basePct','Base %')}{actionable&&th('kind',t.marketKind)}{th('price',actionable?t.marketOldPrice:t.price)}
      {actionable&&<><th>{t.marketNewPrice}</th><th>APK / TIX</th><th>{t.status}</th></>}
    </tr></thead><tbody>{view.map(r=>{const e=edits[r.ticketId]||{selected:false,price:r.price,currency:r.currency};const locked=busy||!RELIST_RETRYABLE.has(r.state);const changed=Number(e.price)!==r.price||e.currency!==r.currency;return <tr key={r.ticketId} className={actionable&&!e.selected?'row-dim':''}>
      {actionable&&<td className="select-col"><input type="checkbox" checked={Boolean(e.selected)&&!locked} disabled={locked} onChange={ev=>edit(r,{selected:ev.target.checked})} aria-label={r.name}/></td>}
      <td>{r.accountName}</td><td><b>{r.name}</b>{r.salary!=null&&r.base>0&&r.salary<=r.base&&<span className="base-badge">BASE</span>}{r.position&&<small className="cell-sub">{r.position}</small>}</td><td><span className={`grade-badge ${gradeToneClass(r.grade)}`}>{r.grade||'—'}</span></td><td>{r.value==null?'—':fmtNumber(r.value)}</td><td><b>{fmtNumber(r.salary)}</b></td><td>{r.base==null?'—':fmtNumber(r.base)}</td><td className={`base-pct ${r.basePct==null?'':r.basePct<=0?'below':'above'}`}>{fmtPct(r.basePct)}</td>{actionable&&<td>{listingKindOf(r)?<span className={`pill ${KIND_TONE[listingKindOf(r)]}`}><i/>{t[`marketKind_${listingKindOf(r)}`]}</span>:'—'}</td>}<td><b className="price">{fmtNumber(r.price)}</b> {r.currency}</td>
      {actionable&&<><td><input className={`price-input ${changed?'changed':''}`} type="number" min="1" step="1" value={e.price??''} disabled={locked} onChange={ev=>edit(r,{price:ev.target.value,selected:true})}/></td>
        <td><div className="currency-toggle">{['APK','TIX'].map(c=><button type="button" key={c} className={e.currency===c?'on':''} disabled={locked} onClick={()=>edit(r,{currency:c,selected:true})}>{c}</button>)}</div></td>
        <td><span className={`pill ${RELIST_TONE[r.state]||'muted'}`}><i/>{t[`marketRelist_${r.state}`]||r.state}</span>{r.message&&<small className="cell-sub relist-msg" title={r.message}>{r.message}</small>}</td></>}
    </tr>})}</tbody></table>{!view.length&&<div className="empty">{rows.length?t.activityNoMatch:t.marketNoRows}</div>}</div>
  </section>;
}
// Live panel (top right) while a Market job runs: overall progress and, per
// account, the player being handled now.
const RELIST_DONE=new Set(['listed','owned','failed','removedNotListed','stopped']);
function MarketProgress({ m, t, nameOf, stepText, onStop }) {
  if(!m.busy)return null;
  const lastRun=Object.values(m.relist?.lastRun||{});
  const relisting=m.jobKind==='relist';
  const working=Object.entries(m.accounts||{}).filter(([,s])=>s.status==='working');
  const rows=relisting
    ?[...new Set(lastRun.map(r=>r.accountId))].map(id=>{const mine=lastRun.filter(r=>r.accountId===id);const done=mine.filter(r=>RELIST_DONE.has(r.state)).length;const s=m.accounts?.[id];const current=s?.step==='relisting'&&done<mine.length?s.stepParams?.name:null;return {id,done,total:mine.length,current,text:current?msgText(t,'mkprog.current',{name:current}):done>=mine.length?t.completed:t.marketRelist_queued}})
    :working.map(([id,s])=>({id,text:stepText(s)}));
  const total=lastRun.length, done=lastRun.filter(r=>RELIST_DONE.has(r.state)).length;
  const count=state=>lastRun.filter(r=>r.state===state).length;
  const title=relisting?t.marketProgressRelist:m.jobKind==='claim'?t.marketProgressClaim:t.marketProgressScan;
  return <aside className="market-progress" aria-live="polite">
    <div className="market-progress-head"><span className="pill ok"><i/>{title}</span>{relisting&&<b>{done} / {total}</b>}<button className="btn danger-soft small" onClick={onStop}><Icon name="stop" size={14}/> {t.stop}</button></div>
    {relisting&&total>0&&<><div className="market-progress-bar"><span style={{width:`${Math.round(done/total*100)}%`}}/></div><small>{msgText(t,'mkprog.left',{left:total-done})} · {count('listed')} {t.marketRelistListed}{count('owned')?` · ${count('owned')} ${t.marketRelistOwned}`:''}{count('failed')+count('removedNotListed')?` · ${count('failed')+count('removedNotListed')} ${t.marketRelistFailed}`:''}</small></>}
    <div className="market-progress-rows">{rows.map(r=><div key={r.id} className={`market-progress-row ${r.current?'active':''}`}><b>{nameOf(r.id)}</b><span title={r.text}>{r.text}</span>{r.total!=null&&<em>{r.done}/{r.total}</em>}</div>)}</div>
  </aside>;
}
function Market({ state, t, refresh, toast }) {
  const m=state.market||{}; const accStates=m.accounts||{}; const relist=m.relist||{rows:{}};
  const busy=Boolean(m.busy);
  const [tab,setTab]=useState('sales');
  const [selectedIds,setSelectedIds]=useState(()=>state.settings?.marketAccountIds||[]);
  const valid=selectedIds.filter(id=>state.accounts.some(a=>a.id===id));
  const allSelected=state.accounts.length>0&&valid.length===state.accounts.length;
  const toggle=id=>setSelectedIds(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);
  const toggleAll=()=>setSelectedIds(allSelected?[]:state.accounts.map(a=>a.id));
  const run=async fn=>{try{await fn();await refresh()}catch(e){toast(e.message,'error')}};
  const runFor=(fn,ids=valid)=>run(async()=>{await api.settings.update({marketAccountIds:valid});await fn(ids)});
  const nameOf=id=>state.accounts.find(a=>a.id===id)?.name||id;
  const playerIndex=useMemo(()=>new Map((state.players?.players||[]).map(p=>[p.id,p])),[state.players]);
  // Accounts whose last scan found sales: claim only these, no rescan of the others.
  const soldIds=state.accounts.filter(a=>accStates[a.id]?.counts?.sold>0).map(a=>a.id);
  const stepText=s=>s?.step?msgText(t,`mkstep.${s.step}`,s.stepParams,s.error||''):'—';

  // Relist edits stay here until "List selected": ticketId -> {selected, price, currency}
  const [edits,setEdits]=useState({});
  const edit=(row,patch)=>setEdits(e=>({...e,[row.ticketId]:{selected:false,price:row.price,currency:row.currency,...e[row.ticketId],...patch}}));
  const withName=r=>({...r,accountName:nameOf(r.accountId)});
  const relistRows=Object.values(relist.rows||{}).map(withName);
  const listed=relistRows.filter(r=>r.status==='LISTED');
  const expired=relistRows.filter(r=>r.status==='EXPIRED');
  const sold=state.accounts.flatMap(a=>(accStates[a.id]?.sold||[]).map(withName));
  const chosen=relistRows.filter(r=>edits[r.ticketId]?.selected&&RELIST_RETRYABLE.has(r.state));
  const badPrice=chosen.find(r=>!(Number(edits[r.ticketId]?.price)>=1));
  // How many accounts list at the same time; defaults to all accounts, the last value is kept.
  const [parallel,setParallel]=useState(()=>String(state.settings?.marketRelistParallel||state.accounts.length||1));
  const parallelN=Math.max(1,Math.min(state.accounts.length||1,Math.floor(Number(parallel))||1));
  const startRelist=()=>{if(badPrice){toast(`${t.marketInvalidPrice}: ${badPrice.name}`,'error');return}run(async()=>{await api.settings.update({marketRelistParallel:parallelN});await api.market.relist(chosen.map(r=>({ticketId:r.ticketId,price:Number(edits[r.ticketId].price),currency:edits[r.ticketId].currency})),{concurrency:parallelN});setEdits({})})};
  const report=relist.report;

  return <div className="page market-page">
    <div className="page-title"><div><h1>{t.market}</h1><span className="subtitle">{t.marketSubtitleNew}</span></div>
      </div>
    <MarketProgress m={m} t={t} nameOf={nameOf} stepText={stepText} onStop={()=>run(()=>api.market.stop())}/>
    <div className="market-tabs"><button className={tab==='sales'?'active':''} onClick={()=>setTab('sales')}>{t.marketTabSales}</button><button className={tab==='listings'?'active':''} onClick={()=>setTab('listings')}>{t.marketTabListings}{chosen.length?<span className="tab-count">{chosen.length}</span>:null}</button></div>

    <div className="panel market-accounts-bar"><span className="market-relist-label">{t.accounts}</span><div className="account-picks market-picks">{state.accounts.map(a=><button type="button" key={a.id} className={valid.includes(a.id)?'selected':''} disabled={busy} onClick={()=>toggle(a.id)}>{a.name}</button>)}<button type="button" className="chip" disabled={busy} onClick={toggleAll}>{allSelected?t.clearSelection:t.selectAll}</button></div>
      <div className="toolbar"><button className="btn ghost" disabled={busy||!valid.length} onClick={()=>runFor(ids=>api.market.scan(ids))}><Icon name="refresh"/> {t.marketScanSelected} ({valid.length})</button>{tab==='sales'&&<button className="btn accent" disabled={busy||!soldIds.length} title={t.marketClaimSoldOnlyHint} onClick={()=>run(()=>api.market.claim(soldIds))}>{t.marketClaimSoldOnly} ({soldIds.length})</button>}{tab==='sales'?<button className="btn success" disabled={busy||!valid.length} onClick={()=>runFor(ids=>api.market.claim(ids))}>{t.marketClaimSelected}</button>:<><label className="mk-parallel" title={t.marketParallelHint}><span>{t.marketParallel}</span><input type="number" min="1" max={state.accounts.length||1} value={parallel} disabled={busy} onChange={e=>setParallel(e.target.value)}/></label><button className="btn primary" disabled={busy||!chosen.length} onClick={startRelist}>{t.marketRelistSelected} ({chosen.length})</button></>}</div></div>

    {tab==='sales'&&<div className="panel table-panel"><table><thead><tr><th>{t.account}</th><th>LISTED</th><th>SOLD</th><th>EXPIRED</th><th>{t.marketLastScan}</th><th>{t.status}</th><th></th></tr></thead>
      <tbody>{state.accounts.map(a=>{const s=accStates[a.id];const c=s?.counts;return <tr key={a.id}><td><b>{a.name}</b></td><td>{c?c.listed:'—'}</td><td>{c?<b className={c.sold?'green':''}>{c.sold}</b>:'—'}</td><td>{c?c.expired:'—'}</td><td>{s?.scannedAt?new Date(s.scannedAt).toLocaleTimeString():'—'}</td><td className={`market-step ${s?.status==='error'?'bad':''}`} title={stepText(s)}>{stepText(s)}</td><td className="actions"><button className="btn ghost small" disabled={busy} onClick={()=>run(()=>api.market.scan([a.id]))}>{t.marketScan}</button>{c?.sold>0&&<button className="btn success small" disabled={busy} onClick={()=>run(()=>api.market.claim([a.id]))}>{t.marketClaim}</button>}</td></tr>})}</tbody></table></div>}
    {tab==='sales'&&<ListingTable t={t} playerIndex={playerIndex} title={t.marketSoldTitle} rows={sold} edits={edits} edit={edit} busy={busy}/>}

    {tab==='listings'&&<>
      {report&&!busy&&<div className={`panel market-report ${report.removedNotListed?'danger':''}`}><b>{t.marketRelistReport}</b><span className="pill ok"><i/>{report.listed} {t.marketRelistListed}</span>{report.owned>0&&<span className="pill bad"><i/>{report.owned} {t.marketRelistOwned}</span>}{report.failed>0&&<span className="pill bad"><i/>{report.failed} {t.marketRelistFailed}</span>}{report.removedNotListed>0&&<span className="pill bad"><i/>{report.removedNotListed} {t.marketRelistRemovedNotListed}</span>}{report.stopped>0&&<span className="pill muted"><i/>{report.stopped} {t.tradeStopped}</span>}</div>}
      <ListingTable t={t} playerIndex={playerIndex} title={t.marketExpiredTitle} rows={expired} edits={edits} edit={edit} busy={busy} actionable/>
      <ListingTable t={t} playerIndex={playerIndex} title={t.marketListedTitle} rows={listed} edits={edits} edit={edit} busy={busy} actionable/>
    </>}
  </div>;
}

function ScoutCardInfo({ card, t }) {
  if(!card) return <span className="muted-text">—</span>;
  return <div className="scout-card-info"><b>{card.team||'—'} · <StarValue value={card.stars}/></b><ProgressValue progress={card.progress} t={t}/>{card.roles?.length>0&&<span className="inline-role-list">{card.roles.map(r=><RoleBadge key={r.id} role={r} compact/>)}</span>}{card.teamCritical&&<em>{card.raisesTeamIfUpgraded?t.raisesTeam:t.teamNeeded}</em>}</div>;
}

function ScoutPlayerDetail({ selected, t, onClose }) {
  if(!selected) return null;
  const { agent, accountName }=selected;
  return <Modal title={t.playerDetails} onClose={onClose} width={520}><div className="scout-detail-head"><div><b>{agent.name||'—'}</b><span>{accountName} · {agent.position||'—'} · {agent.team||'—'}</span></div><span className={`grade-badge large ${gradeToneClass(agent.grade)}`}>{agent.grade||'—'}</span></div><div className="scout-detail-grid"><div><span>{t.price}</span><b>{fmtTk(agent.price)}</b></div><div><span>Base</span><b>{fmtTk(agent.base)}</b></div><div><span>Rank</span><b>{agent.rank||'—'}</b></div><div><span>Offense</span><b>{agent.offense||'—'}</b></div><div><span>Defense</span><b>{agent.defense||'—'}</b></div><div><span>{t.card}</span><ScoutCardInfo card={agent.card} t={t}/></div></div></Modal>;
}

function Scout({ state, t, refresh, toast }) {
  const [busy,setBusy]=useState({});
  const [globalBusy,setGlobalBusy]=useState('');
  const [selected,setSelected]=useState(null);
  const [selectedIds,setSelectedIds]=useState([]);
  const [filters,setFilters]=useState({search:'',maxPrice:'',gradeMin:'',roleId:''});
  const profile=state.accountProfile||{};
  const mainId=profile.mainAccountId;
  const accountKey=state.accounts.map(a=>a.id).join('|');

  useEffect(()=>{
    const valid=new Set(state.accounts.map(a=>a.id));
    setSelectedIds(ids=>ids.filter(id=>valid.has(id)));
  },[accountKey]);

  const runAccount=async(accountId,kind,fn)=>{
    setBusy(x=>({...x,[accountId]:kind}));
    try{await fn();await refresh()}catch(e){toast(e.message,'error')}finally{setBusy(x=>{const next={...x};delete next[accountId];return next})}
  };

  const runBatch=async(kind,mode,ids)=>{
    if(globalBusy||!ids.length)return;
    setGlobalBusy(kind);
    const failed=[];
    try{
      for(const id of ids){
        const account=state.accounts.find(a=>a.id===id);
        if(!account)continue;
        const scoutState=state.scout?.[id]||{};
        setBusy(x=>({...x,[id]:kind}));
        try{
          if(mode==='close') await api.scout.close(id);
          else if(mode==='refresh') {
            if(scoutState.browserOpen) await api.scout.refresh(id);
            else await api.scout.open(id);
          } else if(!scoutState.browserOpen) await api.scout.open(id);
        }catch(e){failed.push(`${account.name}: ${e.message}`)}
        finally{setBusy(x=>{const next={...x};delete next[id];return next})}
      }
      await refresh();
      if(failed.length)toast(`${failed.length} ${t.scoutAccounts}: ${failed[0]}`,'error');
    }finally{setGlobalBusy('')}
  };

  const toggleSelected=id=>setSelectedIds(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);
  const allSelected=state.accounts.length>0&&selectedIds.length===state.accounts.length;
  const toggleAll=()=>setSelectedIds(allSelected?[]:state.accounts.map(a=>a.id));

  const matchesAgent=(agent,account)=>{
    const q=filters.search.trim().toLowerCase();
    if(q&&!`${agent.name||''} ${agent.team||''} ${agent.position||''} ${account.name||''}`.toLowerCase().includes(q))return false;
    if(filters.maxPrice!==''){
      const price=moneyNumber(agent.price);
      if(price==null||price>Number(filters.maxPrice))return false;
    }
    if(filters.gradeMin&&gradeRank(agent.grade)<gradeRank(filters.gradeMin))return false;
    if(filters.roleId&&!agent.card?.roles?.some(r=>r.id===filters.roleId))return false;
    return true;
  };

  const visibleCount=state.accounts.reduce((sum,account)=>sum+((state.scout?.[account.id]?.data?.agents||[]).filter(a=>matchesAgent(a,account)).length),0);

  return <div className="page scout-board-page">
    <div className="page-title scout-board-title"><div><h1>Scout</h1><span className="subtitle">{state.accounts.length} {t.scoutAccounts} · {visibleCount} {t.players.toLowerCase()} · {selectedIds.length} {t.selected}</span></div><div className="toolbar"><button className="btn primary" disabled={!!globalBusy||!selectedIds.length} onClick={()=>runBatch('open-selected','open',selectedIds)}>{t.openSelectedScouts}</button><button className="btn ghost" disabled={!!globalBusy||!selectedIds.length} onClick={()=>runBatch('refresh-selected','refresh',selectedIds)}><Icon name="refresh"/> {t.refreshSelectedScouts}</button><button className="btn ghost" disabled={!!globalBusy||!selectedIds.length} onClick={()=>runBatch('close-selected','close',selectedIds)}>{t.closeSelectedScouts}</button><button className="btn danger-soft" disabled={!!globalBusy||!state.accounts.length} onClick={()=>runBatch('close-all','close',state.accounts.map(a=>a.id))}>{t.closeAllScouts}</button></div></div>
    <div className="scout-filter-bar"><label className="scout-select-all"><input type="checkbox" checked={allSelected} onChange={toggleAll}/><span>{t.selectAll}</span></label><input placeholder={t.scoutSearch} value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/><input type="number" min="0" placeholder={t.maxPrice} value={filters.maxPrice} onChange={e=>setFilters({...filters,maxPrice:e.target.value})}/><select value={filters.gradeMin} onChange={e=>setFilters({...filters,gradeMin:e.target.value})}><option value="">{t.minGrade}</option>{GRADE_ORDER.slice(1).map(g=><option key={g}>{g}</option>)}</select><select value={filters.roleId} onChange={e=>setFilters({...filters,roleId:e.target.value})}><option value="">{t.roleFilter}: {t.all}</option>{(state.cards?.roles||[]).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select><button className="chip reset-chip" onClick={()=>setFilters({search:'',maxPrice:'',gradeMin:'',roleId:''})}>{t.reset}</button></div>
    <div className="scout-board-list">{state.accounts.map(account=>{
      const s=state.scout?.[account.id]||{};
      const data=s.data;
      const stats=profile.accounts?.[account.id]||{};
      const isBusy=!!busy[account.id];
      const isOpen=Boolean(s.browserOpen);
      const agents=(data?.agents||[]).filter(a=>matchesAgent(a,account));
      return <section className={`scout-account-row ${mainId===account.id?'main-account':''} ${selectedIds.includes(account.id)?'selected-account':''}`} key={account.id}>
        <aside className="scout-account-meta"><div className="scout-account-name"><input className="scout-row-check" type="checkbox" checked={selectedIds.includes(account.id)} onChange={()=>toggleSelected(account.id)}/><b>{account.name}</b>{mainId===account.id&&<span className="main-dot">{t.mainBadge}</span>}<span className={`scout-browser-state ${isOpen?'open':'closed'}`}>{isOpen?t.browserOpenShort:t.browserClosedShort}</span></div><div className="scout-account-mini"><span>LV <b>{stats.level??'—'}</b></span><span>APK <b>{fmtNumber(stats.apk)}</b></span><span>TIX <b>{fmtNumber(stats.tix)}</b></span><span>TK <b>{fmtTk(data?.funds??stats.tk)}</b></span><span>{t.roster} <b>{data?.roster!=null?`${data.roster}/${data.rosterMax??'—'}`:(stats.roster!=null?`${stats.roster}/${stats.rosterMax??'—'}`:'—')}</b></span></div>{data&&<div className="scout-attempt-line"><span>{t.attempts} <b>{data.attempts??'—'}/{data.attemptsMax??'—'}</b></span><ScoutTimer data={data}/></div>}<div className="scout-row-actions">{!isOpen?<button className="btn primary small" disabled={isBusy||!!globalBusy} onClick={()=>runAccount(account.id,'open',()=>api.scout.open(account.id))}>{t.openScout}</button>:<><button className="btn ghost small" disabled={isBusy||!!globalBusy} onClick={()=>runAccount(account.id,'refresh',()=>api.scout.refresh(account.id))}><Icon name="refresh" size={14}/>{t.refreshScout}</button><button className="btn accent small" disabled={isBusy||!!globalBusy||data?.attempts===0} onClick={()=>runAccount(account.id,'callback',()=>api.scout.callback(account.id))}>{t.callback}</button><button className="btn ghost small" disabled={isBusy||!!globalBusy} onClick={()=>runAccount(account.id,'close',()=>api.scout.close(account.id))}>{t.close}</button></>}</div>{s.error&&<small className="scout-row-error">{s.error}</small>}</aside>
        <div className="scout-agent-area">{data?(agents.length?<div className="scout-agent-grid">{agents.map(agent=><article className={`scout-agent-card ${agent.signed?'signed':''}`} key={agent.key||agent.index} onClick={()=>setSelected({agent,accountName:account.name})}><div className="scout-agent-top"><div className="scout-agent-name"><b>{agent.name||agent.key}</b><span>{agent.team||'—'} · {agent.position||'—'}</span></div><span className={`grade-badge ${gradeToneClass(agent.grade)}`}>{agent.grade||'—'}</span></div><div className="scout-agent-price">{fmtTk(agent.price)}</div><div className="scout-agent-carddata">{agent.card?<><b><StarValue value={agent.card.stars}/> · {agent.card.team||agent.team||'—'}</b><ProgressValue progress={agent.card.progress} t={t}/>{agent.card.roles?.length>0&&<em className="inline-role-list">{agent.card.roles.map(r=><RoleBadge key={r.id} role={r} compact/>)}</em>}{agent.card.teamCritical&&<small>{agent.card.raisesTeamIfUpgraded?t.raisesTeam:t.teamNeeded}</small>}</>:<span className="muted-text">Star Card —</span>}</div><div className="scout-agent-actions"><button className="btn ghost small" onClick={e=>{e.stopPropagation();setSelected({agent,accountName:account.name})}}>{t.detail}</button><button className="btn primary small" disabled={!isOpen||!agent.canSign||isBusy||!!globalBusy||data.roster>=data.rosterMax} onClick={e=>{e.stopPropagation();if(confirm(t.signConfirm))runAccount(account.id,'sign',()=>api.scout.sign(account.id,agent.key))}}>{agent.signed?t.signed:t.buy}</button></div></article>)}</div>:<div className="scout-row-empty">{t.noScoutMatch}</div>):<div className="scout-row-empty"><span>{t.noScoutData}</span>{s.status&&s.status!=='idle'&&<small>{s.status}</small>}</div>}</div>
      </section>
    })}</div>

    {selected&&<ScoutPlayerDetail selected={selected} t={t} onClose={()=>setSelected(null)}/>} 
  </div>;
}

function PresetEditor({ presets, t, onSave, onClose }) {
  const [items,setItems]=useState(presets.map(x=>({...x})));
  const add=()=>setItems([...items,{id:`preset-${Date.now()}`,name:'New',salaryMax:'',gradeMin:'B-',gradeMax:'A+'}]);
  return <Modal title={t.presets} onClose={onClose} width={720}><div className="preset-editor">{items.map((p,i)=><div className="preset-row" key={p.id}><input value={p.name} onChange={e=>setItems(items.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/><input type="number" placeholder="Salary <" value={p.salaryMax} onChange={e=>setItems(items.map((x,j)=>j===i?{...x,salaryMax:e.target.value}:x))}/><select value={p.gradeMin} onChange={e=>setItems(items.map((x,j)=>j===i?{...x,gradeMin:e.target.value}:x))}>{GRADE_ORDER.slice(1).map(g=><option key={g}>{g}</option>)}</select><select value={p.gradeMax} onChange={e=>setItems(items.map((x,j)=>j===i?{...x,gradeMax:e.target.value}:x))}>{GRADE_ORDER.slice(1).map(g=><option key={g}>{g}</option>)}</select><button className="icon-btn danger" onClick={()=>setItems(items.filter((_,j)=>j!==i))}><Icon name="trash" size={15}/></button></div>)}<button className="btn ghost" onClick={add}><Icon name="plus"/> {t.addPreset}</button></div><div className="modal-actions"><button className="btn ghost" onClick={onClose}>{t.cancel}</button><button className="btn primary" onClick={()=>onSave(items)}>{t.save}</button></div></Modal>;
}


const TOURNAMENT_TONE={queued:'muted',login:'warn',ready:'warn',registering:'ok',waiting:'warn',done:'ok',error:'bad',stopped:'muted'};
const fmtTrTime=(iso,locale)=>iso?new Date(iso).toLocaleString(locale,{timeZone:'Europe/Istanbul',weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const REPORT_OK=new Set(['registered','already']);
function TournamentReport({ report, t }) {
  if(!report) return null;
  const ok=report.accounts.filter(r=>REPORT_OK.has(r.outcome));
  const notOk=report.accounts.filter(r=>!REPORT_OK.has(r.outcome));
  const when=new Date(report.finishedAt||report.startedAt).toLocaleString();
  return <div className="panel tournament-report">
    <div className="tournament-report-head"><b>{t.tournamentReport}</b><span>{when} · {report.source==='schedule'?t.tournamentSourceSchedule:t.tournamentSourceManual}</span><span className="pill ok"><i/>{ok.length} {t.tournamentReportOk}</span><span className={`pill ${notOk.length?'bad':'muted'}`}><i/>{notOk.length} {t.tournamentReportNotOk}</span></div>
    <div className="tournament-report-cols">
      <div><h4>{t.tournamentReportOk}</h4>{ok.length?ok.map(r=><div key={r.accountId} className="tournament-report-row ok"><b>{r.name}</b>{r.level!=null&&<small>Lv {r.level}</small>}<span>{r.outcome==='registered'?r.joined.join(', '):`${t.tournamentOutcome_already}: ${r.already.join(', ')}`}</span></div>):<div className="muted-text">—</div>}</div>
      <div><h4>{t.tournamentReportNotOk}</h4>{notOk.length?notOk.map(r=><div key={r.accountId} className="tournament-report-row bad"><b>{r.name}</b>{r.level!=null&&<small>Lv {r.level}</small>}<span><em>{t[`tournamentOutcome_${r.outcome}`]||r.outcome}</em>{r.reason?` · ${r.reason}`:''}</span></div>):<div className="muted-text">—</div>}</div>
    </div>
  </div>;
}
function Tournament({ state, t, refresh, toast }) {
  const tn=state.tournament||{}; const rt=tn.runtime||{}; const accStates=tn.accounts||{}; const events=tn.events||[];
  const profile=state.accountProfile||{};
  const running=rt.status==='running';
  const [selectedIds,setSelectedIds]=useState(()=>state.settings?.tournamentAccountIds||[]);
  const valid=selectedIds.filter(id=>state.accounts.some(a=>a.id===id));
  const allSelected=state.accounts.length>0&&valid.length===state.accounts.length;
  const toggle=id=>setSelectedIds(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);
  const toggleAll=()=>setSelectedIds(allSelected?[]:state.accounts.map(a=>a.id));
  const reload=()=>api.tournament.refresh().catch(e=>toast(e.message,'error'));
  useEffect(()=>{if(!running)reload()},[]);
  const start=async()=>{try{await api.settings.update({tournamentAccountIds:valid});await api.tournament.start(valid);await refresh()}catch(e){toast(e.message,'error')}};
  const stop=async()=>{try{await api.tournament.stop();await refresh()}catch(e){toast(e.message,'error')}};
  const accountName=id=>state.accounts.find(a=>a.id===id)?.name||id;
  const eventState=e=>e.status!=='REGISTRATION'?['Look on','warn']:e.count>=e.maxPlayers?[t.tournamentFull,'muted']:['Register','ok'];
  const statusLabel=s=>t[`tournament_${s}`]||s;
  return <div className="page"><div className="page-title"><div><h1>{t.tournament}</h1><span className="subtitle">{t.tournamentSubtitle}</span></div><div className="toolbar"><button className="btn ghost" onClick={reload}><Icon name="refresh"/> {t.tournamentReload}</button><button className="btn primary" disabled={running||!valid.length} onClick={start}><Icon name="play"/> {t.tournamentStart} ({valid.length})</button><button className="btn danger-soft" disabled={!running} onClick={stop}><Icon name="stop"/> {t.stop}</button></div></div>
    <div className="trade-status"><span className={`pill ${running?'ok':rt.status==='error'?'bad':rt.status==='stopped'?'warn':'muted'}`}><i/>{running?t.tradeRunning:rt.status==='done'?t.completed:rt.status==='error'?t.tradeFailed:rt.status==='stopped'?t.tradeStopped:t.idle}</span>{rt.message&&<span className="trade-message">{rt.step?msgText(t,`trun.${rt.step}`,rt.stepParams,rt.message):rt.message}</span>}</div>
    {!running&&<TournamentReport report={tn.lastReport} t={t}/>}
    <div className="panel table-panel"><table><thead><tr><th className="select-col"><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={running} aria-label={t.selectAll}/></th><th>{t.account}</th><th>{t.level}</th><th>{t.status}</th><th>{t.tournamentDetail}</th><th>{t.tournamentJoined}</th></tr></thead><tbody>{state.accounts.map(a=>{const s=accStates[a.id];const level=s?.level??profile.accounts?.[a.id]?.level;return <tr key={a.id}><td className="select-col"><input type="checkbox" checked={valid.includes(a.id)} disabled={running} onChange={()=>toggle(a.id)} aria-label={a.name}/></td><td><b>{a.name}</b>{profile.mainAccountId===a.id&&<span className="main-dot">{t.mainBadge}</span>}</td><td>{level??'—'}</td><td>{s?<span className={`pill ${TOURNAMENT_TONE[s.status]||'muted'}`}><i/>{statusLabel(s.status)}</span>:'—'}</td>{(()=>{const text=s?(s.step?msgText(t,`tstep.${s.step}`,s.stepParams,s.message):s.message):'—';return <td className="tournament-detail" title={text}>{text}</td>})()}<td>{(s?.joined||[]).map(j=><span key={j.id} className="chip tournament-chip">{j.name}</span>)}</td></tr>})}</tbody></table></div>
    <h3 className="section-title">{t.tournamentList} <small>{tn.eventsAt?new Date(tn.eventsAt).toLocaleTimeString():''}</small></h3>
    <div className="panel table-panel"><table><thead><tr><th>{t.name}</th><th>{t.level}</th><th>{t.status}</th><th>{t.tournamentPlayers}</th><th>{t.tournamentStarts}</th><th>{t.tournamentOurAccounts}</th></tr></thead><tbody>{events.map(e=>{const [label,tone]=eventState(e);return <tr key={e.id}><td><b>{e.name}</b></td><td>{e.minLevel}-{e.maxLevel}</td><td><span className={`pill ${tone}`}><i/>{label}</span></td><td>{e.count}/{e.maxPlayers}</td><td>{fmtTrTime(e.startsAt,LOCALE[t.lang])}</td><td>{(e.accountIds||[]).map(id=><span key={id} className="chip tournament-chip">{accountName(id)}</span>)}</td></tr>})}</tbody></table>{!events.length&&<div className="empty">—</div>}</div>
  </div>;
}
const EMPTY_TRADE_FILTERS={name:'',seller:'',position:'All',gradeMin:'',gradeMax:'',salaryMin:'',salaryMax:'',salaryMaxExclusive:false,priceMin:'',priceMax:'',currency:'All',baseOnly:false,basePctMax:''};
const fmtPct=v=>v==null?'—':`${v>0?'+':''}${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}%`;
function TradingHall({ state, t, refresh, toast }) {
  const settings=state.settings||{};
  const [accountModal,setAccountModal]=useState(false); const [presetModal,setPresetModal]=useState(false);
  const [stopPrice,setStopPrice]=useState(settings.tradeStopPrice??9999); const [scanCurrency,setScanCurrency]=useState(settings.tradeScanCurrency||'APK_TICKET');
  const [filters,setFilters]=useState(EMPTY_TRADE_FILTERS);
  const [sort,setSort]=useState({key:'price',dir:'asc'});
  const [selectedRowKey,setSelectedRowKey]=useState(null);
  const [listPage,setListPage]=useState(0);
  const tableBoxRef=useRef(null);
  useEffect(()=>{setStopPrice(settings.tradeStopPrice??9999);setScanCurrency(settings.tradeScanCurrency||'APK_TICKET')},[settings.tradeStopPrice,settings.tradeScanCurrency]);
  const rt=state.trading?.runtime||{}; const rawRows=state.trading?.rows||[];
  // Value and its daily change (11:05) come from the Oyuncular list, by player id.
  const playerIndex=useMemo(()=>new Map((state.players?.players||[]).map(p=>[p.id,p])),[state.players]);
  const rows=useMemo(()=>rawRows.map(r=>{const p=playerIndex.get(r.playerId);return p?{...r,value:p.value,valueChange:p.change}:r}),[rawRows,playerIndex]);
  const filtered=useMemo(()=>sortTradingRows(filterTradingRows(rows,filters),sort),[rows,filters,sort]);
  // Separate listings can share the same name, seller and price. Reusing a
  // React key for them leaves stale table rows after filtering or sorting.
  const rowIndex=useMemo(()=>new Map(rows.map((row,index)=>[row,index])),[rows]);
  const rowKey=r=>`${rt.startedAt||''}:${rowIndex.get(r)}`;
  const selectedIndex=useMemo(()=>filtered.findIndex(r=>rowKey(r)===selectedRowKey),[filtered,selectedRowKey]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/100));
  const visiblePage=Math.min(listPage,pageCount-1);
  const pageStart=visiblePage*100;
  const visibleRows=filtered.slice(pageStart,pageStart+100);
  useEffect(()=>{setListPage(0);setSelectedRowKey(null)},[filters,sort]);
  useEffect(()=>{if(selectedRowKey&&selectedIndex<0)setSelectedRowKey(null)},[selectedRowKey,selectedIndex]);
  useEffect(()=>{if(selectedIndex<0)return;tableBoxRef.current?.querySelector(`tr[data-row-index="${selectedIndex}"]`)?.scrollIntoView({block:'nearest'})},[selectedIndex]);
  const selectIndex=index=>{setListPage(Math.floor(index/100));setSelectedRowKey(rowKey(filtered[index]))};
  const moveSelection=dir=>{if(!filtered.length)return;let next=selectedIndex;if(next<0)next=dir>0?pageStart:Math.min(filtered.length-1,pageStart+99);else next=Math.max(0,Math.min(filtered.length-1,next+dir));selectIndex(next)};
  const onTableKeyDown=e=>{if(e.key==='ArrowDown'){e.preventDefault();moveSelection(1)}else if(e.key==='ArrowUp'){e.preventDefault();moveSelection(-1)}else if(e.key==='Home'){e.preventDefault();if(filtered.length)selectIndex(0)}else if(e.key==='End'){e.preventDefault();if(filtered.length)selectIndex(filtered.length-1)}};
  const setF=(k,v)=>setFilters({...filters,[k]:v,...(k==='salaryMax'?{salaryMaxExclusive:false}:{})}); const reset=()=>setFilters(EMPTY_TRADE_FILTERS);
  const preset=p=>setFilters({...filters,salaryMin:'',salaryMax:String(p.salaryMax??''),salaryMaxExclusive:true,gradeMin:p.gradeMin||'',gradeMax:p.gradeMax||''});
  const start=async()=>{try{await api.settings.update({tradeStopPrice:Number(stopPrice),tradeScanCurrency:scanCurrency});api.trade.start({stopPrice:Number(stopPrice),scanCurrency}).catch(e=>toast(e.message,'error'));await refresh()}catch(e){toast(e.message,'error')}};
  const savePresets=async items=>{await api.settings.update({tradePresets:items.map(x=>({...x,salaryMax:x.salaryMax===''?null:Number(x.salaryMax)}))});await refresh();setPresetModal(false)};
  const sortBy=k=>{if(hasTradingSortData(rows,k))setSort(s=>({key:k,dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))};
  return <div className="page trading-page"><div className="page-title"><h1>Trading Hall</h1><div className="toolbar"><button className="btn ghost" onClick={()=>setAccountModal(true)}>{state.tradeAccount?.name||t.tradeAccount}</button><label className="compact-input"><span>{t.stopAtPrice}</span><input type="number" value={stopPrice} onChange={e=>setStopPrice(e.target.value)}/></label><label className="compact-input"><span>{t.scanCurrency}</span><select value={scanCurrency} onChange={e=>setScanCurrency(e.target.value)}><option value="APK_TICKET">APK</option><option value="TICKET">TIX</option><option value="all">All</option></select></label><button className="btn primary" disabled={rt.status==='running'||rt.status==='starting'} onClick={start}><Icon name="refresh"/> {t.refreshHall}</button><button className="btn danger-soft" disabled={!['running','starting'].includes(rt.status)} onClick={async()=>{try{await api.trade.stop();await refresh()}catch(e){toast(e.message,'error')}}}><Icon name="stop"/> {t.stop}</button></div></div><div className="trade-status"><span className={`pill ${['running','starting'].includes(rt.status)?'ok':rt.status==='error'?'bad':rt.status==='stopped'?'warn':'muted'}`}><i/>{['running','starting'].includes(rt.status)?t.tradeRunning:rt.status==='done'?t.completed:rt.status==='error'?t.tradeFailed:rt.status==='stopped'?t.tradeStopped:t.idle}</span><b>{rt.page||0}/{rt.totalPages||0}</b><span>{rt.count||0} {t.listings}</span>{(rt.message||rt.status!=='idle')&&<span className="trade-message">{tradeStatusText(t,rt)}</span>}</div><div className="filter-panel"><div className="preset-bar"><span>{t.presets}</span>{(settings.tradePresets||[]).map(p=><button key={p.id} className="chip" onClick={()=>preset(p)}>{p.name}</button>)}<button className="chip muted-chip" onClick={()=>setPresetModal(true)}>{t.managePresets}</button><button className="chip reset-chip" onClick={reset}>{t.reset}</button></div><div className="filters-grid"><input placeholder={t.name} value={filters.name} onChange={e=>setF('name',e.target.value)}/><input placeholder={t.seller} value={filters.seller} onChange={e=>setF('seller',e.target.value)}/><select value={filters.position} onChange={e=>setF('position',e.target.value)}><option>All</option>{['PG','SG','SF','PF','C'].map(x=><option key={x}>{x}</option>)}</select><select value={filters.currency} onChange={e=>setF('currency',e.target.value)}><option>All</option><option>APK</option><option>TIX</option></select><select value={filters.gradeMin} onChange={e=>setF('gradeMin',e.target.value)}><option value="">Grade ≥</option>{GRADE_ORDER.slice(1).map(g=><option key={g}>{g}</option>)}</select><select value={filters.gradeMax} onChange={e=>setF('gradeMax',e.target.value)}><option value="">Grade ≤</option>{GRADE_ORDER.slice(1).map(g=><option key={g}>{g}</option>)}</select><input type="number" placeholder="Salary min" value={filters.salaryMin} onChange={e=>setF('salaryMin',e.target.value)}/><input type="number" placeholder="Salary max" value={filters.salaryMax} onChange={e=>setF('salaryMax',e.target.value)}/><input type="number" placeholder="Price min" value={filters.priceMin} onChange={e=>setF('priceMin',e.target.value)}/><input type="number" placeholder="Price max" value={filters.priceMax} onChange={e=>setF('priceMax',e.target.value)}/><input type="number" placeholder={t.basePctMax} title={t.basePctHint} value={filters.basePctMax} onChange={e=>setF('basePctMax',e.target.value)}/><button type="button" className={`base-only-toggle ${filters.baseOnly?'on':''}`} disabled={!rows.some(r=>r.isBase!=null)} title={t.baseOnlyHint} onClick={()=>setF('baseOnly',!filters.baseOnly)}>{t.baseOnly}</button></div></div><div ref={tableBoxRef} className="panel table-panel trading-table keyboard-table" tabIndex={0} onKeyDown={onTableKeyDown}><table><thead><tr>{[['name',t.name],['grade',t.grade],['salary',t.salary],['price',t.price],['currency',t.currency],['position',t.position],['seller',t.seller],['base',t.base],['basePct','Base %'],['value',t.value]].map(([k,l])=>{const available=hasTradingSortData(rows,k);return <th key={k} onClick={available?()=>sortBy(k):undefined} className={available?'sortable':''} aria-sort={available&&sort.key===k?(sort.dir==='asc'?'ascending':'descending'):undefined}>{l}{available&&sort.key===k?(sort.dir==='asc'?' ↑':' ↓'):''}</th>})}<th></th></tr></thead><tbody>{visibleRows.map((r,i)=>{const key=rowKey(r);return <tr key={key} data-row-index={pageStart+i} className={selectedRowKey===key?'selected-row':''} onClick={()=>{setSelectedRowKey(key);tableBoxRef.current?.focus()}}><td><b>{r.name}</b>{r.isBase&&<span className="base-badge">BASE</span>}</td><td><span className={`grade-badge ${gradeToneClass(r.grade)}`}>{r.grade||'—'}</span></td><td>{fmtTk(r.salary)}</td><td><b className="price">{fmtNumber(r.price)}</b></td><td>{r.currency}</td><td>{r.position||'—'}</td><td>{r.seller||'—'}</td><td>{r.base==null?'—':fmtTk(r.base)}</td><td className={`base-pct ${r.basePct==null?'':r.basePct<=0?'below':'above'}`}>{fmtPct(r.basePct)}</td><td>{r.value==null?'—':<span className="value-cell">{fmtTk(r.value)}{r.valueChange?<span className={r.valueChange>0?'pl-up':'pl-down'}>{r.valueChange>0?'▲':'▼'} {fmtNumber(Math.abs(r.valueChange))}</span>:null}</span>}</td><td className="actions"><BuyMenu row={r} state={state} lang={t.lang} toast={toast}/></td></tr>})}</tbody></table>{!filtered.length&&<div className="empty">{t.noRows}</div>}{pageCount>1&&<div className="trade-pagination"><button className="btn ghost" disabled={visiblePage===0} onClick={()=>{setListPage(visiblePage-1);setSelectedRowKey(null)}}>‹</button><span>{visiblePage+1} / {pageCount} {t.page} · {filtered.length} {t.listings}</span><button className="btn ghost" disabled={visiblePage>=pageCount-1} onClick={()=>{setListPage(visiblePage+1);setSelectedRowKey(null)}}>›</button></div>}</div><BoughtList state={state} lang={t.lang} toast={toast} source="hall"/>{accountModal&&<TradeAccountModal t={t} current={state.tradeAccount} onClose={()=>setAccountModal(false)} refresh={refresh} toast={toast}/>} {presetModal&&<PresetEditor presets={settings.tradePresets||[]} t={t} onClose={()=>setPresetModal(false)} onSave={savePresets}/>}</div>;
}

function RoleManager({ roles, t, onClose, refresh, toast }) {
  const [newName,setNewName]=useState('');
  const [newColor,setNewColor]=useState(ROLE_COLOR_PALETTE[0]);
  const update=async(role,patch)=>{try{await api.cards.updateRole(role.id,patch);await refresh()}catch(e){toast(e.message,'error')}};
  const add=async()=>{if(!newName.trim())return;try{await api.cards.addRole(newName.trim(),newColor);setNewName('');await refresh()}catch(e){toast(e.message,'error')}};
  const remove=async role=>{if(!confirm(`${role.name} silinsin mi?`))return;try{await api.cards.deleteRole(role.id);await refresh()}catch(e){toast(e.message,'error')}};
  return <Modal title={t.roles} onClose={onClose} width={650}><div className="role-editor">
    {roles.map(role=><div className="role-editor-row" key={role.id}><input defaultValue={role.name} onBlur={e=>e.target.value.trim()&&e.target.value.trim()!==role.name&&update(role,{name:e.target.value.trim()})}/><div className="role-color-area"><RoleBadge role={role}/>{!role.builtIn&&<div className="role-color-palette">{ROLE_COLOR_PALETTE.map(color=><button key={color} aria-label={color} className={role.color===color?'selected':''} style={{backgroundColor:color}} onClick={()=>update(role,{color})}/>)}</div>}</div><button className="icon-btn danger" onClick={()=>remove(role)}><Icon name="trash" size={14}/></button></div>)}
    <div className="role-editor-row role-add-row"><input placeholder={t.addRole} value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add()}}}/><div className="role-color-palette">{ROLE_COLOR_PALETTE.map(color=><button key={color} aria-label={color} className={newColor===color?'selected':''} style={{backgroundColor:color}} onClick={()=>setNewColor(color)}/>)}</div><button className="btn primary" onClick={add}><Icon name="plus"/> {t.addRole}</button></div>
  </div></Modal>;
}

// null = all (see MultiSelectFilter)
const CARD_FILTERS={name:'',teams:null,stars:null,grades:null,roles:null};
const cardLevelsText=cards=>Object.entries(cards||{}).filter(([,q])=>q>0).sort((a,b)=>a[0]-b[0]).map(([l,q])=>`L${l}×${q}`).join(' · ');
function Cards({ state, t, refresh, toast }) {
  const cards=state.cards||{players:[],roles:[],teams:[],trackedTeams:[],scannerReady:false,scanRuntime:{status:'idle'}};
  const profile=state.accountProfile||{};
  const [roleModal,setRoleModal]=useState(false);
  const [tab,setTab]=useState('teams');
  const [showTracked,setShowTracked]=useState(false);
  const [filters,setFilters]=useState(CARD_FILTERS);
  const [sort,setSort]=useState({key:'name',dir:'asc'});
  const [selectedPlayerKeys,setSelectedPlayerKeys]=useState([]);
  const [bulkRoleId,setBulkRoleId]=useState('');
  const [bulkBusy,setBulkBusy]=useState(false);
  const mainAccount=state.accounts.find(a=>a.id===profile.mainAccountId);
  const scanRuntime=cards.scanRuntime||{};
  const scanBusy=['starting','scanning'].includes(scanRuntime.status);
  const activePlayers=useMemo(()=>(cards.players||[]).filter(p=>p.active!==false),[cards.players]);
  const teamNames=[...(cards.teams||[]).map(x=>x.team).filter(Boolean),...(activePlayers.some(p=>p.noTeam)?['No Team']:[])];
  const scanText=msgText(t,`cdstep.${scanRuntime.step}`,scanRuntime.stepParams,scanRuntime.message||t.scanningCards);
  const teamByName=useMemo(()=>new Map((cards.teams||[]).map(x=>[x.team,x])),[cards.teams]);

  const visibleTeams=showTracked?(cards.teams||[]).filter(x=>(cards.trackedTeams||[]).includes(x.team)):(cards.teams||[]);
  const playerRows=useMemo(()=>{
    let out=activePlayers.filter(p=>{
      if(filters.name&&!String(p.name||'').toLowerCase().includes(filters.name.toLowerCase()))return false;
      if(!filterPasses(filters.teams,p.team))return false;
      if(filters.stars!=null&&(p.noTeam||!filters.stars.includes(Number(p.stars||0))))return false;
      if(!filterPasses(filters.grades,String(p.grade||'').toUpperCase()))return false;
      if(filters.roles!=null&&!filters.roles.some(id=>(p.roleIds||[]).includes(id)))return false;
      return true;
    }).map(p=>{
      const team=teamByName.get(p.team);
      const blocker=team?.blockers?.find(x=>x.key===p.key);
      return {...p,_blocker:blocker||null,_roleNames:(p.roles||[]).map(r=>r.name).join(', ')};
    });
    const valueFor=(p,key)=>{
      if(key==='name'||key==='team')return String(p[key]||'').toLowerCase();
      if(key==='grade')return gradeRank(p.grade);
      if(key==='stars'||key==='cardCount')return Number(p[key]||0);
      if(key==='progress')return Number(p.progress?.required||0)-Number(p.progress?.current||0);
      if(key==='roles')return p._roleNames.toLowerCase();
      if(key==='teamDevelopment')return p._blocker?(p._blocker.raisesTeamIfUpgraded?2:1):0;
      return p[key];
    };
    out.sort((a,b)=>{let av=valueFor(a,sort.key),bv=valueFor(b,sort.key);let c=(typeof av==='number'&&typeof bv==='number')?av-bv:String(av??'').localeCompare(String(bv??''));return sort.dir==='asc'?c:-c});
    return out;
  },[activePlayers,filters,sort,teamByName]);

  const toggleTracked=async team=>{const cur=cards.trackedTeams||[];const next=cur.includes(team)?cur.filter(x=>x!==team):[...cur,team];try{await api.cards.setTrackedTeams(next);await refresh()}catch(e){toast(e.message,'error')}};
  // Teams a player can be given (the game's teams, not X or the Modified group).
  const teamOptions=useMemo(()=>[...new Set(activePlayers.filter(p=>!p.noTeam&&!p.x&&p.team&&p.team!=='X').map(p=>p.team))].sort(),[activePlayers]);
  const setCustomTeam=async(player,team)=>{try{await api.cards.setCustomTeam(player.key,team);await refresh()}catch(e){toast(e.message,'error')}};
  const toggleRole=async(player,roleId)=>{const current=player.roleIds||[];const next=current.includes(roleId)?current.filter(x=>x!==roleId):[...current,roleId];try{await api.cards.setPlayerRoles(player.key,next);await refresh()}catch(e){toast(e.message,'error')}};
  const playerKeysSignature=activePlayers.map(p=>p.key).join('|');
  useEffect(()=>{const valid=new Set(activePlayers.map(p=>p.key));setSelectedPlayerKeys(keys=>{const next=keys.filter(k=>valid.has(k));return next.length===keys.length&&next.every((k,i)=>k===keys[i])?keys:next})},[playerKeysSignature]);
  const selectedPlayerSet=useMemo(()=>new Set(selectedPlayerKeys),[selectedPlayerKeys]);
  const visiblePlayerKeys=playerRows.map(p=>p.key);
  const allVisibleSelected=visiblePlayerKeys.length>0&&visiblePlayerKeys.every(k=>selectedPlayerSet.has(k));
  const togglePlayerSelected=key=>setSelectedPlayerKeys(keys=>keys.includes(key)?keys.filter(k=>k!==key):[...keys,key]);
  const selectVisible=()=>setSelectedPlayerKeys(keys=>[...new Set([...keys,...visiblePlayerKeys])]);
  const deselectVisible=()=>{const visible=new Set(visiblePlayerKeys);setSelectedPlayerKeys(keys=>keys.filter(k=>!visible.has(k)))};
  const applyBulkRole=async mode=>{
    if(bulkBusy||!bulkRoleId||!selectedPlayerKeys.length)return;
    setBulkBusy(true);
    const failed=[];
    try{
      for(const key of selectedPlayerKeys){
        const player=activePlayers.find(p=>p.key===key); if(!player)continue;
        const current=player.roleIds||[];
        const next=mode==='add'?(current.includes(bulkRoleId)?current:[...current,bulkRoleId]):current.filter(id=>id!==bulkRoleId);
        if(next.length===current.length&&next.every((x,i)=>x===current[i]))continue;
        try{await api.cards.setPlayerRoles(player.key,next)}catch(e){failed.push(`${player.name||player.key}: ${e.message}`)}
      }
      await refresh();
      if(failed.length)toast(`${failed.length} oyuncu: ${failed[0]}`,'error');
      else toast(`${selectedPlayerKeys.length} oyuncu güncellendi.`,'success');
    }finally{setBulkBusy(false)}
  };
  const setMain=async e=>{try{await api.accounts.setMain(e.target.value||null);await refresh()}catch(err){toast(err.message,'error')}};
  const runRefresh=async()=>{try{await api.cards.refresh();await refresh()}catch(e){toast(e.message,'error')}};
  const resetCards=async()=>{if(!confirm(t.resetCardsConfirm))return;try{await api.cards.reset();setFilters(CARD_FILTERS);setSelectedPlayerKeys([]);setShowTracked(false);await refresh()}catch(e){toast(e.message,'error')}};
  const sortBy=key=>setSort(s=>({key,dir:s.key===key&&s.dir==='asc'?'desc':'asc'}));
  const subtitle=scanBusy?scanText:(cards.updatedAt?`${t.lastUpdate}: ${fmtTime(cards.updatedAt)}`:t.scannerWaiting);

  return <div className="page"><div className="page-title"><div><h1>{t.cards}</h1><span className="subtitle">{subtitle}</span></div><div className="toolbar"><select value={profile.mainAccountId||''} onChange={setMain} disabled={scanBusy}><option value="">{t.mainAccount}</option>{state.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><button className="btn ghost" onClick={()=>setRoleModal(true)} disabled={scanBusy}>{t.roles}</button><button className="btn danger-soft" onClick={resetCards} disabled={scanBusy}>{t.resetCards}</button><button className="btn primary" disabled={!cards.scannerReady||!mainAccount||scanBusy} title={!mainAccount?t.scannerWaiting:''} onClick={runRefresh}><Icon name="refresh"/> {scanBusy?t.scanningCards:t.refresh}</button></div></div>
    <div className="cards-summary"><div className="panel main-card-box"><span>{t.mainAccount}</span><b>{mainAccount?.name||'—'}</b><small>{scanBusy?scanText:(cards.scannerReady?t.refresh:t.scannerWaiting)}</small></div><div className="panel main-card-box"><span>{t.players}</span><b>{activePlayers.length}</b><small>{(cards.teams||[]).length} {t.team.toLowerCase()}</small></div><div className="panel main-card-box"><span>{t.roles}</span><b>{(cards.roles||[]).length}</b><small className="inline-role-list">{cards.roles?.map(r=><RoleBadge key={r.id} role={r} compact/>)}</small></div></div>
    <div className="cards-tabs"><button className={tab==='teams'?'active':''} onClick={()=>setTab('teams')}>{t.cardTeamsTab}</button><button className={tab==='players'?'active':''} onClick={()=>setTab('players')}>{t.cardPlayersTab}</button></div>
    {tab==='teams'&&<>{(cards.teams||[]).length>0?<><div className="cards-section-title"><b>{t.teamDevelopment}</b><button className={`chip ${showTracked?'active-chip':''}`} onClick={()=>setShowTracked(x=>!x)}>{t.trackedOnly}</button></div><div className="team-grid">{visibleTeams.map(team=><div className={`team-card ${team.modified?'modified-team':''}`} key={team.team}><div className="team-main"><b>{team.modified?t.modifiedTeam:team.team}</b><strong><StarValue value={team.star}/></strong><span>{team.blockerCount} {t.teamNeeded.toLowerCase()}</span></div><button className={`track-star ${(cards.trackedTeams||[]).includes(team.team)?'on':''}`} onClick={()=>toggleTracked(team.team)} title={t.trackedTeams}><Icon name="star" size={15}/></button>{team.blockers?.slice(0,3).map(b=><small key={b.key}>{b.name}: <ProgressValue progress={b.progress} t={t}/>{b.raisesTeamIfUpgraded?` · ${t.raisesTeam}`:''}</small>)}</div>)}</div></>:<div className="panel"><div className="empty big"><Icon name="cards" size={30}/><b>{t.cardsEmpty}</b><span>{t.cardScanLater}</span></div></div>}</>}
    {tab==='players'&&<><div className="card-player-filters"><input placeholder={t.searchName} value={filters.name} onChange={e=>setFilters({...filters,name:e.target.value})}/><MultiSelectFilter label={t.filterTeams} allLabel={t.all} options={teamNames} selected={filters.teams} onChange={teams=>setFilters({...filters,teams})}/><MultiSelectFilter label={t.filterStars} allLabel={t.all} options={[0,1,2,3,4,5].map(v=>({value:v,label:`${v}★`}))} selected={filters.stars} onChange={stars=>setFilters({...filters,stars})} renderLabel={o=><span className="star-value">{o.label}</span>}/><MultiSelectFilter label={t.filterRatings} allLabel={t.all} options={GRADE_ORDER.slice(1).reverse().map(g=>({value:g,label:g}))} selected={filters.grades} onChange={grades=>setFilters({...filters,grades})} renderLabel={o=><span className={`grade-badge mini ${gradeToneClass(o.value)}`}>{o.label}</span>}/><MultiSelectFilter label={t.filterRoles} allLabel={t.all} options={(cards.roles||[]).map(r=>({value:r.id,label:r.name,role:r}))} selected={filters.roles} onChange={roles=>setFilters({...filters,roles})} renderLabel={o=><RoleBadge role={o.role} compact/>}/><button className="chip reset-chip" onClick={()=>setFilters(CARD_FILTERS)}>{t.reset}</button></div>
      <div className="card-selection-bar"><div className="card-selection-count"><b>{selectedPlayerKeys.length}</b> {t.selectedPlayers}<span>{playerRows.length} {t.visiblePlayers}</span></div><div className="card-selection-actions"><button className="btn ghost small" disabled={!playerRows.length} onClick={allVisibleSelected?deselectVisible:selectVisible}>{allVisibleSelected?t.deselectVisible:t.selectVisible}</button><button className="btn ghost small" disabled={!selectedPlayerKeys.length} onClick={()=>setSelectedPlayerKeys([])}>{t.clearSelection}</button><select value={bulkRoleId} onChange={e=>setBulkRoleId(e.target.value)}><option value="">{t.bulkRole}</option>{(cards.roles||[]).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select><button className="btn primary small" disabled={bulkBusy||!bulkRoleId||!selectedPlayerKeys.length} onClick={()=>applyBulkRole('add')}>{t.addRoleSelected}</button><button className="btn danger-soft small" disabled={bulkBusy||!bulkRoleId||!selectedPlayerKeys.length} onClick={()=>applyBulkRole('remove')}>{t.removeRoleSelected}</button></div></div>
      {playerRows.length?<div className="panel table-panel cards-table player-list-table"><table><thead><tr><th className="select-col"><input type="checkbox" checked={allVisibleSelected} onChange={()=>allVisibleSelected?deselectVisible():selectVisible()} aria-label={t.selectVisible}/></th>{[['name',t.name],['team',t.team],['grade',t.rating],['stars',t.stars],['cardCount',t.cardCount],['progress',t.progress],['roles',t.roles],['teamDevelopment',t.teamDevelopment]].map(([key,label])=><th key={key} className="sortable" onClick={()=>sortBy(key)}>{label}{sort.key===key?(sort.dir==='asc'?' ↑':' ↓'):''}</th>)}</tr></thead><tbody>{playerRows.map(p=><tr key={p.key} className={selectedPlayerSet.has(p.key)?'selected-row-soft':''}><td className="select-col"><input type="checkbox" checked={selectedPlayerSet.has(p.key)} onChange={()=>togglePlayerSelected(p.key)} aria-label={p.name||p.key}/></td><td><b>{p.name||p.key}</b></td><td><TeamAssign player={p} teams={teamOptions} t={t} onChange={team=>setCustomTeam(p,team)}/></td><td><span className={`grade-badge ${gradeToneClass(p.grade)}`}>{p.grade||'—'}</span></td><td>{p.noTeam?'—':<StarValue value={p.stars}/>}</td><td>{fmtNumber(p.cardCount)}{cardLevelsText(p.cards)&&<small className="cell-sub">{cardLevelsText(p.cards)}</small>}</td><td><ProgressValue progress={p.progress} t={t} className={p.progress?.ready?'ready-text':''}/></td><td><div className="role-chips">{(cards.roles||[]).map(role=>{const on=(p.roleIds||[]).includes(role.id);return <button key={role.id} className={on?'on':''} style={on?roleStyle(role):undefined} onClick={()=>toggleRole(p,role.id)}>{role.name}</button>})}</div></td><td>{p._blocker?<span className={`pill ${p._blocker.raisesTeamIfUpgraded?'ok':'warn'}`}><i/>{p._blocker.raisesTeamIfUpgraded?t.raisesTeam:t.teamNeeded}</span>:'—'}</td></tr>)}</tbody></table></div>:<div className="panel"><div className="empty">{t.noRows}</div></div>}</>}
    {roleModal&&<RoleManager roles={cards.roles||[]} t={t} onClose={()=>setRoleModal(false)} refresh={refresh} toast={toast}/>}
  </div>;
}

// The game's team, or one the user gave (Auto Trade counts it; the Cards page lists
// such players under "Değiştirilmiş"). "NONE" takes a player out of its team.
function TeamAssign({ player, teams, t, onChange }) {
  const original=player.noTeam?'No Team':(player.team||'—');
  const value=player.customTeam||'';
  return <div className="team-assign"><select value={value} onChange={e=>onChange(e.target.value||null)} title={t.teamAssignHint}>
    <option value="">{original}{value?` (${t.teamOriginal})`:''}</option>
    {!player.noTeam&&!player.x&&<option value="NONE">{t.teamNone}</option>}
    {teams.filter(team=>team!==player.team||player.noTeam).map(team=><option key={team} value={team}>{team}</option>)}
  </select>{value&&<span className="modified-badge">{t.modifiedTeam}</span>}</div>;
}

function Activity({ state, t, refresh }) {
  const [accountFilter,setAccountFilter]=useState('all');
  const [typeFilter,setTypeFilter]=useState('all');
  const [serviceFilter,setServiceFilter]=useState('all');
  const activity=state.activity||[];
  const services=useMemo(()=>[...new Set(activity.map(item=>item.taskName).filter(Boolean))].sort(),[activity]);
  const accounts=useMemo(()=>{
    const map=new Map();
    for(const item of activity){
      const key=String(item.accountId||item.accountName||item.taskName||'System');
      const label=item.accountName||item.taskName||'System';
      if(!map.has(key))map.set(key,label);
    }
    return [...map.entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
  },[activity]);
  const filtered=useMemo(()=>activity.filter(item=>{
    const key=String(item.accountId||item.accountName||item.taskName||'System');
    if(accountFilter!=='all'&&key!==accountFilter)return false;
    if(serviceFilter!=='all'&&item.taskName!==serviceFilter)return false;
    if(typeFilter==='success'&&item.level!=='success')return false;
    if(typeFilter==='error'&&item.level!=='error')return false;
    if(typeFilter==='warning'&&item.level!=='warning')return false;
    return true;
  }),[activity,accountFilter,serviceFilter,typeFilter]);
  return <div className="page"><div className="page-title"><div><h1>{t.activity}</h1><span className="subtitle">{filtered.length} / {activity.length}</span></div><div className="toolbar"><select aria-label={t.activityAccountFilter} value={accountFilter} onChange={e=>setAccountFilter(e.target.value)}><option value="all">{t.activityAllAccounts}</option>{accounts.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select aria-label={t.activityServiceFilter} value={serviceFilter} onChange={e=>setServiceFilter(e.target.value)}><option value="all">{t.activityAllServices}</option>{services.map(name=><option key={name} value={name}>{name}</option>)}</select><select aria-label={t.activityTypeFilter} value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="all">{t.activityAllTypes}</option><option value="success">{t.activitySuccess}</option><option value="error">{t.activityErrors}</option><option value="warning">{t.activityWarnings}</option></select><button className="btn ghost" onClick={async()=>{await api.activity.clear();await refresh()}}>{t.clear}</button></div></div><PvpPanel pvp={state.pvp} lang={t.lang}/><div className="panel activity-list">{filtered.length?filtered.map(x=><div className={`activity-row ${x.level}`} key={x.id}><i/><time>{new Date(x.at).toLocaleTimeString()}</time><b>{x.accountName||x.taskName||'System'}</b>{x.taskName&&x.accountName?<em className="activity-service">{x.taskName}</em>:<em/>}<span>{msgText(t,x.code,x.params,x.message)}</span></div>):<div className="empty">{activity.length?t.activityNoMatch:'—'}</div>}</div></div>;
}
function Settings({ state, t, refresh, toast, openGuide }) { const saveLang=async v=>{try{await api.settings.update({language:v});await refresh()}catch(e){toast(e.message,'error')}};return <div className="page"><div className="page-title"><h1>{t.settings}</h1></div><div className="settings-grid"><div className="panel setting-card"><label><span>{t.language}</span><select value={state.settings.language||'auto'} onChange={e=>saveLang(e.target.value)}><option value="auto">{t.auto}</option><option value="tr">{t.turkish}</option><option value="en">{t.english}</option></select></label></div><div className="panel setting-card"><button className="btn ghost" onClick={()=>api.settings.openDataFolder()}><Icon name="folder"/> {t.dataFolder}</button></div><div className="panel setting-card guide-card"><b>{t.guide}</b><span className="muted-text">{t.guideHint}</span><button className="btn primary" onClick={openGuide}><Icon name="book"/> {t.guideOpen}</button></div></div></div>; }

export default function App(){
  const [state,setState]=useState({accounts:[],accountProfile:{accounts:{},effectiveApk:{},effectiveTix:{},totalUsableApk:null,totalUsableTix:null},tradeAccount:null,tasks:[],schedules:[],settings:{},activity:[],runtime:{},scout:{},market:{},playerMarket:{ players:[], scanRuntime:null},trading:{runtime:{},rows:[]},autoTrade:{runtime:null,lastRun:null},cards:{players:[],roles:[],teams:[],trackedTeams:[],scannerReady:false},rewards:{},systemLocale:'en-US'});
  const [page,setPage]=useState('home'); const [toastState,setToast]=useState(null); const [alertState,setAlertState]=useState(null); const seenActivityIds=useRef(null); const appStartedAt=useRef(Date.now());
  const hotkeyStatus=useRef(null); const hotkeyText=useRef(TEXT.en);
  const refresh=async()=>setState(await api.bootstrap()); const toast=(message,type='info')=>{setToast({message,type});setTimeout(()=>setToast(null),3500)};
  useEffect(()=>{let received=false;let active=true;const off=api.onState(next=>{received=true;hotkeyStatus.current=next.autoTrade?.runtime?.status;setState(prev=>({...prev,...next,cards:next.cards??prev.cards,trading:{...prev.trading,...next.trading}}))});api.bootstrap().then(next=>{if(active&&!received)setState(next)}).catch(e=>toast(e.message,'error'));const offHotkey=api.onAutoTradeHotkey?.(action=>{if(action==='pause'){if(window.confirm(hotkeyText.current.confirmHotkeyPause)){api.autoTrade[hotkeyStatus.current==='paused'?'resume':'pause']().catch(e=>toast(e.message,'error'))}}else if(action==='stop'&&window.confirm(hotkeyText.current.confirmHotkeyStop)){api.autoTrade.stop().catch(e=>toast(e.message,'error'))}});return()=>{active=false;off?.();offHotkey?.()}},[]);
  useEffect(()=>{
    const closeOutside=e=>{for(const menu of document.querySelectorAll('details[open]'))if(!menu.contains(e.target))menu.open=false};
    const closeEscape=e=>{if(e.key==='Escape')for(const menu of document.querySelectorAll('details[open]'))menu.open=false};
    document.addEventListener('pointerdown',closeOutside,true);
    document.addEventListener('keydown',closeEscape);
    return()=>{document.removeEventListener('pointerdown',closeOutside,true);document.removeEventListener('keydown',closeEscape)};
  },[]);
  useEffect(()=>{
    const items=state.activity||[];
    if(seenActivityIds.current===null){seenActivityIds.current=new Set(items.map(x=>x.id));return}
    const fresh=items.filter(x=>!seenActivityIds.current.has(x.id));
    seenActivityIds.current=new Set(items.map(x=>x.id));
    // Activity history is persistent. On a cold start the first hydrated state can arrive
    // after the initial empty renderer state, which used to make an OLD salary-cap event
    // look new and reopen the modal on every launch. Only surface salary-cap alerts that
    // were actually created in this renderer session.
    const hit=fresh.find(x=>{
      if(x.alertType!=='salary-cap')return false;
      const at=Date.parse(x.at||'');
      return Number.isFinite(at)&&at>=appStartedAt.current-1000;
    });
    if(hit)setAlertState(hit);
  },[state.activity]);
  const lang=state.settings.language==='tr'||state.settings.language==='en'?state.settings.language:String(state.systemLocale||'').toLowerCase().startsWith('tr')?'tr':'en'; const t=TEXT[lang];
  hotkeyStatus.current=state.autoTrade?.runtime?.status;
  hotkeyText.current=t;
  // Sidebar groups: [heading, [page, icon, label]...]
  const nav=[[null,[['home','home',t.home],['accounts','accounts',t.accounts]]],[t.navAutomation,[['autoplay','play',t.autoplay],['autotrade','swap',t.autoTrade],['pvp','sword',t.pvpPage],['tower','tower',t.towerPage],['autobuy','cart',t.autoBuyPage],['tournament','trophy',t.tournament]]],[t.navPlayers,[['scout','scout',t.scout],['players','chart',t.playersPage],['draft','target',t.draftPage],['cards','cards',t.cards],['equipment','shirt',t.equipment]]],[t.navMarket,[['market','market',t.market],['trade','hall',t.trade]]],[t.navApp,[['activity','activity',t.activity],['guide','book',t.guide],['settings','settings',t.settings]]]];
  return <div className="shell"><aside className="sidebar"><div className="brand"><div>DT</div><b>DreamTeam<span>Manager</span></b></div><nav>{nav.map(([head,items],gi)=><React.Fragment key={gi}>{head&&<small className="nav-group">{head}</small>}{items.map(([id,icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}><Icon name={icon}/><span>{label}</span></button>)}</React.Fragment>)}</nav></aside><main>{page==='home'&&<HomePage state={state} t={t} go={setPage} msgText={msgText}/>} {page==='accounts'&&<Accounts state={state} t={t} refresh={refresh} toast={toast}/>}
  {page==='players'&&<PlayersPage state={state} t={t} toast={toast}/>} {page==='draft'&&<DraftPage state={state} t={t} toast={toast}/>}
  {page==='autoplay'&&<AutoPlay state={state} t={t} refresh={refresh} toast={toast}/>} {page==='autotrade'&&<AutoTradePage state={state} t={t} refresh={refresh} toast={toast} msgText={msgText} Modal={Modal}/>} {page==='scout'&&<Scout state={state} t={t} refresh={refresh} toast={toast}/>} {page==='market'&&<Market state={state} t={t} refresh={refresh} toast={toast}/>} {page==='tournament'&&<Tournament state={state} t={t} refresh={refresh} toast={toast}/>} {page==='trade'&&<TradingHall state={state} t={t} refresh={refresh} toast={toast}/>} {page==='cards'&&<Cards state={state} t={t} refresh={refresh} toast={toast}/>} {page==='equipment'&&<EquipmentPage state={state} t={t} toast={toast} msgText={msgText}/>} {page==='activity'&&<Activity state={state} t={t} refresh={refresh}/>} {page==='settings'&&<Settings state={state} t={t} refresh={refresh} toast={toast} openGuide={()=>setPage('guide')}/>} {page==='guide'&&<GuidePage t={t}/>} {page==='tower'&&<TowerPage state={state} t={t} toast={toast}/>} {page==='autobuy'&&<AutoBuyPage state={state} t={t} toast={toast}/>} {page==='pvp'&&<PvpPage state={state} t={t} toast={toast} refresh={refresh}/>}</main>{toastState&&<div className={`toast ${toastState.type}`}>{toastState.message}</div>}{alertState&&<Modal title={alertState.taskName==='Tower'?t.towerStopped:t.autoPlayStopped} onClose={()=>setAlertState(null)} width={520}><div style={{display:'grid',gap:10,fontSize:12,color:'#445067'}}><b style={{fontSize:14,color:'#b13b30'}}>{alertState.accountName||t.account}</b><span>{alertState.taskName==='Tower'?t.towerSalaryCap:t.salaryCapWarning}</span><div style={{padding:'10px 12px',border:'1px solid #f2d0cc',borderRadius:9,background:'#fff7f5',color:'#8f3128',fontWeight:700}}>{String(alertState.message||'').replace(/^Quick Play stopped:\s*/i,'')}</div><div className="modal-actions"><button className="btn primary" onClick={()=>setAlertState(null)}>{t.close}</button></div></div></Modal>}</div>;
}
