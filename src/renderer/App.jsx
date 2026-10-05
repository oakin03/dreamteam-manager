import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { filterTradingRows, hasTradingSortData, sortTradingRows } from './trading-sort.mjs';

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
    market:'Pazar', startAll:'Tümünü Başlat', stopAll:'Tümünü Durdur', marketApkPending:'APK doğrulaması bekleniyor · Tekrar Tara',
    marketSubtitle:'Hesapların My Listings ilanlarını tarar', marketOpenAll:'Tümünü Aç', marketCloseAll:'Tümünü Kapat', marketOpenSelected:'Seçilileri Aç', marketCloseSelected:'Seçilileri Kapat', marketScan:'Tara', marketRescan:'Tekrar Tara', marketClaim:'Satışları Topla', marketSold:'Satılanlar', marketListed:'Satışta Olanlar', marketExpired:'Stoklananlar', marketSalePrice:'İlan fiyatı', marketNoRows:'Henüz ilan taranmadı.', marketScanning:'Taranıyor', marketClaiming:'Toplanıyor', marketOpen:'Açık', marketClosed:'Kapalı',
    autoTradeSubtitle:'Hesaplar, yönlendirme ve canlı sonuçlar', autoTradeChooseMain:'Hesaplar sayfasından seç', autoTradeSortedByTk:'Kayıtlı TK değerine göre sıralanır', autoTradePriceHint:'Rollerden bağımsız', autoTradeNoSides:'Yan hesap eklenmedi.', autoTradeRules:'Oyuncu kuralları', autoTradeRuleHint:'Scout tüm rolleri alır; aşağıdaki seçimler aktarımı belirler', autoTradePriceHelp:'Bu fiyat veya altındaki Scout oyuncuları Main hesabına gider ve karta çevrilir. Roller fiyatla sınırlanmaz.', autoTradeCardDest:'Main hesabında karta çevrilir', autoTradeOptional:'Seçim isteğe bağlı', autoTradeRoom:'Trade odası', autoTradeRoomHint:'İşlem sırasında kullanılır', autoTradeLive:'Anlık işlem takibi', autoTradePhase:'Aşama', autoTradeNoRun:'Henüz Auto Trade başlatılmadı.', autoTradeSystem:'Sistem', autoTradeVerifiedEvents:'doğrulanmış işlem', autoTradeNoRoles:'Rol bulunamadı', autoTradeConflicts:'Çakışan işlemler:', autoTradeStopConflicts:'Bu işlemler durdurulup Auto Trade başlatılsın mı?', autoTradeTkEstimate:'Doğrulanmış transfer fiyatlarından hesaplandı; sonraki girişte güncellenecek.', autoTradeRoleConflict:'Aynı rol iki transfer yönünde seçilemez.', autoTradeResumeSide:'Bu Side ile Devam Et', autoTradeDeferred:'Ertelenen hesaplar', autoTradeVerifyPending:'Yarım Kalan Trade’i Doğrula', 
    home:'Ana Sayfa', accounts:'Hesaplar', autoplay:'Auto Play', autoTrade:'Auto Trade', scout:'Scout', trade:'Trading Hall', cards:'Kartlar', activity:'Aktivite', settings:'Ayarlar',
    addAccount:'Hesap Ekle', edit:'Düzenle', delete:'Sil', start:'Başlat', stop:'Durdur', status:'Durum', account:'Hesap', login:'E-posta / kullanıcı adı', password:'Şifre', name:'Ad', save:'Kaydet', cancel:'İptal', close:'Kapat', refresh:'Yenile', reset:'Sıfırla',
    stopped:'Durduruldu', running:'Çalışıyor', preparing:'Hazırlanıyor', error:'Hata', next:'Sonraki', browser:'Tarayıcı', visible:'Görünür', hidden:'Gizli', showBrowser:'Göster', dailyReward:'Daily Reward', rewardChecking:'Kontrol', rewardClaiming:'Alınıyor', rewardDeferred:'Bekliyor', rewardUnknown:'Bilinmiyor', rewardResetWait:'19.00 bekleniyor', rewardCompleted:'6/6 tamamlandı',
    attempts:'Yenileme', roster:'Roster', callback:'Call Back', refreshScout:'Scout Yenile', closeScout:'Scout Kapat', price:'Price', team:'Takım', position:'Mevki', grade:'Grade', card:'Kart', buy:'Satın Al', signed:'Alındı', openScout:'Scout Aç', chooseAccount:'Hesap seç', scoutClosed:'Scout kapalı',
    tradeAccount:'Trade Hesabı', configure:'Ayarla', stopAtPrice:'Stop at price', scanCurrency:'Scan Currency', refreshHall:'Refresh Trading Hall', seller:'Satıcı', salary:'Salary', base:'Base', value:'Value', currency:'Currency', presets:'Hazır filtreler', filters:'Filtreler', addPreset:'Filtre ekle', managePresets:'Düzenle', noRows:'Sonuç yok', listings:'ilan', page:'sayfa',
    language:'Dil', auto:'Otomatik', turkish:'Türkçe', english:'English', dataFolder:'Veri klasörü', debugBrowser:'Auto Play tarayıcısını görünür aç',
    cardsEmpty:'Kart verisi yok.', cardScanLater:'Ana hesabı seçip Yenile ile Star Cards verisini tara.',
    clear:'Temizle', schedule:'Zamanla', at:'Saat', prepare:'Hazırlık', minutes:'dk', seconds:'sn', all:'Tümü',
    dashboardAccounts:'Hesaplar', dashboardRunning:'Aktif Auto Play', dashboardScout:'Açık Scout', dashboardTrade:'Trading Hall', usableApk:'Kullanılabilir APK',
    tradeRunning:'Taranıyor', completed:'Tamamlandı', idle:'Bekliyor', signConfirm:'Bu oyuncu satın alınsın mı?', removeConfirm:'Hesap silinsin mi?', autoPlayStopped:'Auto Play durduruldu', salaryCapWarning:'Takım maaş sınırını aştığı için Quick Play otomatik olarak durduruldu.',
    mainAccount:'Ana Hesap', makeMain:'Ana Yap', level:'LV', exp:'EXP', tk:'TK', apk:'APK', apkContribution:'Toplama Katkı', lastUpdate:'Son güncelleme',
    roles:'Roller', addRole:'Rol Ekle', trackedTeams:'Takip Edilen Takımlar', trackedOnly:'Sadece takip edilenler', teamDevelopment:'Takım Gelişimi', players:'Oyuncular', stars:'Yıldız', progress:'Sonraki Yıldız', ready:'Hazır', teamNeeded:'Takım için gerekli', raisesTeam:'Takımı yükseltir', inactive:'Pasif', scannerWaiting:'Ana hesap seç', resetCards:'Kart Verisini Sıfırla', resetCardsConfirm:'Taranan kart verileri, oyuncu rol eşleşmeleri ve takip edilen takımlar silinsin mi? Rol isimleri korunur.', scanningCards:'Taranıyor…', cardTeamsTab:'Takımlar', cardPlayersTab:'Oyuncu Listesi', filterTeams:'Takım', filterStars:'Yıldız', filterRoles:'Rol', searchName:'İsim ara', rating:'Rating', cardCount:'Kart Sayısı', chooseColor:'Renk',
    openSelectedScouts:'Seçilileri Aç', refreshSelectedScouts:'Seçilileri Yenile', closeSelectedScouts:'Seçilileri Kapat', closeAllScouts:'Tümünü Kapat', selectAll:'Tümünü seç', selected:'seçili', scoutSearch:'Oyuncu / takım ara', maxPrice:'Maks. Price', minGrade:'Min. Grade', roleFilter:'Rol', noScoutData:'Scout açılmadı', noScoutMatch:'Filtreye uyan oyuncu yok', playerDetails:'Oyuncu Detayı', scoutAccounts:'hesap', detail:'Detay', activityAccountFilter:'Hesap', activityTypeFilter:'Tür', activityAllAccounts:'Tüm hesaplar', activityAllTypes:'Tüm işlemler', activitySuccess:'Başarılı', activityErrors:'Hatalar', activityWarnings:'Uyarılar', activityNoMatch:'Filtreye uyan aktivite yok', filterRatings:'Rating', selectVisible:'Görünenleri Seç', deselectVisible:'Görünen Seçimi Kaldır', clearSelection:'Seçimi Temizle', selectedPlayers:'oyuncu seçili', visiblePlayers:'görünür', bulkRole:'Toplu Rol', addRoleSelected:'Rolü Ekle', removeRoleSelected:'Rolü Kaldır', startSelected:'Seçilileri Başlat', stopSelected:'Seçilileri Durdur', autoTradeStart:'Auto Trade Başlat', autoTradePause:'Duraklat', autoTradeContinue:'Devam Et', autoTradeStop:'Durdur', sideAccounts:'Yan Hesaplar', sideToMain:'Side → Main Rolleri', mainToSide:'Main → Side Rolleri', roomDescription:'Room Description', roomPassword:'Oda Şifresi', liveResults:'Canlı Sonuçlar', gainedPlayers:'Kazanılan Oyuncu', cardsMade:'Karta Dönüştürülen', problems:'Problemler', confirmHotkeyPause:'F8 ile Auto Trade duraklatılsın/devam ettirilsin mi?', confirmHotkeyStop:'F9 ile Auto Trade tamamen durdurulsun mu?', autoTradeReset:'İlerlemeyi Sıfırla', autoTradeResetConfirm:'Auto Trade kaydı ve ilerlemesi silinecek. Tamamlanmamış bir Scout alımı varsa önce oyun kadrosunu kontrol et. Sıfırdan başlatılsın mı?', autoTradeResumeRun:'Yarım Kalan İşlemi Sürdür' 
  },
  en: {
    market:'Market', startAll:'Start All', stopAll:'Stop All', marketApkPending:'APK verification pending · Scan Again',
    marketSubtitle:'Scan My Listings for every account', marketOpenAll:'Open All', marketCloseAll:'Close All', marketOpenSelected:'Open Selected', marketCloseSelected:'Close Selected', marketScan:'Scan', marketRescan:'Scan Again', marketClaim:'Claim Sales', marketSold:'Sold', marketListed:'Listed', marketExpired:'Expired Stock', marketSalePrice:'Listing price', marketNoRows:'No listings scanned yet.', marketScanning:'Scanning', marketClaiming:'Claiming', marketOpen:'Open', marketClosed:'Closed',
    autoTradeSubtitle:'Accounts, routing and live results', autoTradeChooseMain:'Select on Accounts page', autoTradeSortedByTk:'Ordered by saved TK balance', autoTradePriceHint:'Independent of roles', autoTradeNoSides:'No Side accounts added.', autoTradeRules:'Player rules', autoTradeRuleHint:'Scout buys all roles; selections below control transfers', autoTradePriceHelp:'Scout players at or below this price go to Main and become cards. Role selections have no price cap.', autoTradeCardDest:'Convert to cards on Main', autoTradeOptional:'Optional selection', autoTradeRoom:'Trade room', autoTradeRoomHint:'Used during transfer', autoTradeLive:'Live progress', autoTradePhase:'Phase', autoTradeNoRun:'Auto Trade has not started.', autoTradeSystem:'System', autoTradeVerifiedEvents:'verified events', autoTradeNoRoles:'No roles available', autoTradeConflicts:'Conflicting activity:', autoTradeStopConflicts:'Stop these activities and start Auto Trade?', autoTradeTkEstimate:'Calculated from verified transfer prices; updated on the next login.', autoTradeRoleConflict:'The same role cannot be selected in both transfer directions.', autoTradeResumeSide:'Continue this Side', autoTradeDeferred:'Deferred accounts', autoTradeVerifyPending:'Verify Pending Trade', 
    home:'Home', accounts:'Accounts', autoplay:'Auto Play', autoTrade:'Auto Trade', scout:'Scout', trade:'Trading Hall', cards:'Cards', activity:'Activity', settings:'Settings',
    addAccount:'Add Account', edit:'Edit', delete:'Delete', start:'Start', stop:'Stop', status:'Status', account:'Account', login:'Email / username', password:'Password', name:'Name', save:'Save', cancel:'Cancel', close:'Close', refresh:'Refresh', reset:'Reset',
    stopped:'Stopped', running:'Running', preparing:'Preparing', error:'Error', next:'Next', browser:'Browser', visible:'Visible', hidden:'Hidden', showBrowser:'Show', dailyReward:'Daily Reward', rewardChecking:'Checking', rewardClaiming:'Claiming', rewardDeferred:'Waiting', rewardUnknown:'Unknown', rewardResetWait:'Reset at 19:00 TR', rewardCompleted:'6/6 complete',
    attempts:'Attempts', roster:'Roster', callback:'Call Back', refreshScout:'Refresh Scout', closeScout:'Close Scout', price:'Price', team:'Team', position:'Position', grade:'Grade', card:'Card', buy:'Sign', signed:'Signed', openScout:'Open Scout', chooseAccount:'Choose account', scoutClosed:'Scout closed',
    tradeAccount:'Trade Account', configure:'Configure', stopAtPrice:'Stop at price', scanCurrency:'Scan Currency', refreshHall:'Refresh Trading Hall', seller:'Seller', salary:'Salary', base:'Base', value:'Value', currency:'Currency', presets:'Presets', filters:'Filters', addPreset:'Add preset', managePresets:'Manage', noRows:'No results', listings:'listings', page:'page',
    language:'Language', auto:'Auto', turkish:'Türkçe', english:'English', dataFolder:'Data folder', debugBrowser:'Open Auto Play browser visibly',
    cardsEmpty:'No card data.', cardScanLater:'Choose the Main Account and press Refresh to scan Star Cards.',
    clear:'Clear', schedule:'Schedule', at:'At', prepare:'Prepare', minutes:'min', seconds:'sec', all:'All',
    dashboardAccounts:'Accounts', dashboardRunning:'Active Auto Play', dashboardScout:'Open Scouts', dashboardTrade:'Trading Hall', usableApk:'Usable APK',
    tradeRunning:'Scanning', completed:'Completed', idle:'Idle', signConfirm:'Sign this player?', removeConfirm:'Remove account?', autoPlayStopped:'Auto Play stopped', salaryCapWarning:'Quick Play was stopped automatically because the team is over the salary cap.',
    mainAccount:'Main Account', makeMain:'Make Main', level:'LV', exp:'EXP', tk:'TK', apk:'APK', apkContribution:'Total Contribution', lastUpdate:'Last update',
    roles:'Roles', addRole:'Add Role', trackedTeams:'Tracked Teams', trackedOnly:'Tracked only', teamDevelopment:'Team Development', players:'Players', stars:'Stars', progress:'Next Star', ready:'Ready', teamNeeded:'Needed for team', raisesTeam:'Raises team', inactive:'Inactive', scannerWaiting:'Choose Main Account', resetCards:'Reset Card Data', resetCardsConfirm:'Delete scanned card data, player-role assignments and tracked teams? Role definitions will be kept.', scanningCards:'Scanning…', cardTeamsTab:'Teams', cardPlayersTab:'Player List', filterTeams:'Team', filterStars:'Stars', filterRoles:'Role', searchName:'Search name', rating:'Rating', cardCount:'Card Count', chooseColor:'Color',
    openSelectedScouts:'Open Selected', refreshSelectedScouts:'Refresh Selected', closeSelectedScouts:'Close Selected', closeAllScouts:'Close All', selectAll:'Select all', selected:'selected', scoutSearch:'Search player / team', maxPrice:'Max Price', minGrade:'Min Grade', roleFilter:'Role', noScoutData:'Scout not opened', noScoutMatch:'No players match the filters', playerDetails:'Player Details', scoutAccounts:'accounts', detail:'Details', activityAccountFilter:'Account', activityTypeFilter:'Type', activityAllAccounts:'All accounts', activityAllTypes:'All activity', activitySuccess:'Successful', activityErrors:'Errors', activityWarnings:'Warnings', activityNoMatch:'No activity matches the filters', filterRatings:'Rating', selectVisible:'Select Visible', deselectVisible:'Deselect Visible', clearSelection:'Clear Selection', selectedPlayers:'players selected', visiblePlayers:'visible', bulkRole:'Bulk Role', addRoleSelected:'Add Role', removeRoleSelected:'Remove Role', startSelected:'Start Selected', stopSelected:'Stop Selected', autoTradeStart:'Start Auto Trade', autoTradePause:'Pause', autoTradeContinue:'Continue', autoTradeStop:'Stop', sideAccounts:'Side Accounts', sideToMain:'Side → Main Roles', mainToSide:'Main → Side Roles', roomDescription:'Room Description', roomPassword:'Room Password', liveResults:'Live Results', gainedPlayers:'Players Gained', cardsMade:'Converted to Cards', problems:'Problems', confirmHotkeyPause:'Pause/resume Auto Trade with F8?', confirmHotkeyStop:'Stop Auto Trade completely with F9?', autoTradeReset:'Reset Progress', autoTradeResetConfirm:'Auto Trade progress and history will be cleared. Check the game roster first if a Scout purchase was interrupted. Start over?', autoTradeResumeRun:'Resume Interrupted Run' 
  }
};

function Icon({ name, size=18 }) {
  const p = {
    home:<><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></>,
    accounts:<><circle cx="9" cy="8" r="4"/><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/><path d="M17 11a4 4 0 0 1 4 4v4"/></>,
    play:<path d="M8 5l11 7-11 7z"/>, stop:<rect x="6" y="6" width="12" height="12" rx="2"/>,
    scout:<><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/><path d="M8 11h6M11 8v6"/></>,
    trade:<><path d="M4 7h16M4 12h16M4 17h16"/><path d="M7 4v16M17 4v16"/></>,
    market:<><path d="M3 10h18l-2-6H5zM5 10v11h14V10M9 21v-7h6v7"/></>,
    cards:<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    activity:<path d="M3 12h4l3-7 4 14 3-7h4"/>, settings:<><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></>,
    plus:<path d="M12 5v14M5 12h14"/>, refresh:<><path d="M20 6v6h-6"/><path d="M4 18v-6h6"/><path d="M18 9a7 7 0 0 0-12-2l-2 2M6 15a7 7 0 0 0 12 2l2-2"/></>,
    trash:<><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></>, folder:<path d="M3 6h7l2 2h9v11H3z"/>, chevron:<path d="M9 18l6-6-6-6"/>, star:<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>
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

function MultiSelectFilter({ label, allLabel, options, selected, onChange, renderLabel }) {
  const selectedSet = new Set(selected || []);
  const toggle = value => {
    const next = selectedSet.has(value) ? (selected || []).filter(x=>x!==value) : [...(selected || []), value];
    onChange(next);
  };
  const summary = !selected?.length ? `${label}: ${allLabel}` : `${label}: ${selected.length}`;
  return <details className="multi-filter">
    <summary>{summary}</summary>
    <div className="multi-filter-menu">
      <label className="multi-filter-all"><input type="checkbox" checked={!selected?.length} onChange={()=>onChange([])}/><span>{allLabel}</span></label>
      {options.map(opt=>{
        const value = typeof opt === 'object' ? opt.value : opt;
        const lbl = renderLabel ? renderLabel(opt) : (typeof opt === 'object' ? opt.label : opt);
        return <label key={String(value)}><input type="checkbox" checked={selectedSet.has(value)} onChange={()=>toggle(value)}/><span>{lbl}</span></label>;
      })}
    </div>
  </details>;
}

function progressText(progress, t) {
  if (!progress) return '—';
  if (progress.maxed) return '5★ MAX';
  const base = `${fmtNumber(progress.current)}/${fmtNumber(progress.required)} → ${progress.targetStars}★`;
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
  const label = s==='running'?t.running:s==='preparing'||s==='starting'?t.preparing:s==='error'?t.error:t.stopped;
  return <span className={`pill ${cls}`}><i/>{label}{runtime?.mode ? ` · ${runtime.mode}`:''}</span>;
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
  return <div className="main-account-strip"><b>{t.mainAccount}: {main.name}</b><span>{t.level} {stats.level??'—'}</span><span>{t.exp} {fmtExp(stats)}</span><span>{t.tk} {fmtTk(stats.tk)}</span><span>{t.apk} {fmtNumber(stats.apk)}</span><span>{t.roster} {stats.roster!=null?`${stats.roster}/${stats.rosterMax??'—'}`:'—'}</span></div>;
}

function Home({ state, t, go }) {
  const active=Object.values(state.runtime||{}).filter(x=>x.status==='running').length;
  const scouts=Object.values(state.scout||{}).filter(x=>x.status==='open').length;
  const tr=state.trading?.runtime||{};
  const totalApk=state.accountProfile?.totalUsableApk;
  return <div className="page"><div className="page-title"><h1>DreamTeam Manager</h1></div><MainAccountStrip state={state} t={t}/><div className="metrics metrics-five"><button onClick={()=>go('accounts')}><span>{t.dashboardAccounts}</span><b>{state.accounts.length}</b></button><button onClick={()=>go('autoplay')}><span>{t.dashboardRunning}</span><b>{active}</b></button><button onClick={()=>go('scout')}><span>{t.dashboardScout}</span><b>{scouts}</b></button><button onClick={()=>go('trade')}><span>{t.dashboardTrade}</span><b className={tr.status==='running'?'green':''}>{tr.status==='running'?`${tr.page}/${tr.totalPages||'?'}`:tr.count||0}</b></button><button onClick={()=>go('accounts')}><span>{t.usableApk}</span><b>{fmtNumber(totalApk)}</b></button></div><div className="quick-grid"><button onClick={()=>go('autoplay')}><Icon name="play"/><b>Auto Play</b></button><button onClick={()=>go('scout')}><Icon name="scout"/><b>Scout</b></button><button onClick={()=>go('trade')}><Icon name="trade"/><b>Trading Hall</b></button><button onClick={()=>go('cards')}><Icon name="cards"/><b>{t.cards}</b></button></div></div>;
}

function Accounts({ state, t, refresh, toast }) {
  const [modal,setModal]=useState(null);
  const profile=state.accountProfile||{};
  const remove=async a=>{if(!confirm(t.removeConfirm))return;try{await api.accounts.remove(a.id);await refresh()}catch(e){toast(e.message,'error')}};
  const setMain=async id=>{try{await api.accounts.setMain(id);await refresh()}catch(e){toast(e.message,'error')}};
  return <div className="page"><div className="page-title"><div><h1>{t.accounts}</h1><span className="subtitle">{t.usableApk}: {fmtNumber(profile.totalUsableApk)}</span></div><button className="btn primary" onClick={()=>setModal({})}><Icon name="plus"/> {t.addAccount}</button></div><div className="panel table-panel"><table><thead><tr><th>{t.name}</th><th>{t.mainAccount}</th><th>{t.level}</th><th>{t.exp}</th><th>{t.apk}</th><th>{t.apkContribution}</th><th>{t.tk}</th><th>{t.status}</th><th></th></tr></thead><tbody>{state.accounts.map(a=>{const stats=profile.accounts?.[a.id]||{};const isMain=profile.mainAccountId===a.id;return <tr key={a.id}><td><b>{a.name}</b><small className="cell-sub">{a.login}</small></td><td><button className={`main-select ${isMain?'selected':''}`} onClick={()=>setMain(a.id)}>{isMain?t.mainAccount:t.makeMain}</button></td><td>{stats.level??'—'}</td><td>{fmtExp(stats)}</td><td><b>{fmtNumber(stats.apk)}</b></td><td>{fmtNumber(profile.effectiveApk?.[a.id]??0)}</td><td>{fmtTk(stats.tk)}</td><td><Status runtime={state.runtime?.[a.id]} t={t}/></td><td className="actions"><button className="icon-btn" onClick={()=>setModal(a)}><Icon name="settings" size={16}/></button><button className="icon-btn danger" onClick={()=>remove(a)}><Icon name="trash" size={16}/></button></td></tr>})}</tbody></table>{!state.accounts.length&&<div className="empty">{t.addAccount}</div>}</div>{modal&&<AddAccountModal t={t} account={modal.id?modal:null} onClose={()=>setModal(null)} refresh={refresh} toast={toast}/>}</div>;
}

function ScheduleModal({ state, t, onClose, refresh, toast }) {
  const d=new Date(Date.now()+15*60000);d.setSeconds(0,0);
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const [form,setForm]=useState({accountIds:[],startAtLocal:local,preparationMinutes:state.settings.defaultPreparationMinutes??6,executionMode:'parallel',delaySeconds:30});
  const toggle=id=>setForm(f=>({...f,accountIds:f.accountIds.includes(id)?f.accountIds.filter(x=>x!==id):[...f.accountIds,id]}));
  const submit=async e=>{e.preventDefault();try{const task=state.tasks.find(x=>!x.loadError);await api.schedules.add({name:'Auto Play',taskId:task?.id,accountIds:form.accountIds,startAt:new Date(form.startAtLocal).toISOString(),preparationMinutes:Number(form.preparationMinutes),executionMode:form.executionMode,delaySeconds:Number(form.delaySeconds),visibleBrowser:false});await refresh();onClose()}catch(err){toast(err.message,'error')}};
  return <Modal title={t.schedule} onClose={onClose} width={600}><form className="form" onSubmit={submit}><label><span>{t.accounts}</span><div className="account-picks">{state.accounts.map(a=><button type="button" key={a.id} className={form.accountIds.includes(a.id)?'selected':''} onClick={()=>toggle(a.id)}>{a.name}</button>)}</div></label><div className="form-two"><label><span>{t.at}</span><input type="datetime-local" required value={form.startAtLocal} onChange={e=>setForm({...form,startAtLocal:e.target.value})}/></label><label><span>{t.prepare} ({t.minutes})</span><input type="number" min="0" value={form.preparationMinutes} onChange={e=>setForm({...form,preparationMinutes:e.target.value})}/></label></div><div className="form-two"><label><span>Mode</span><select value={form.executionMode} onChange={e=>setForm({...form,executionMode:e.target.value})}><option value="parallel">Parallel</option><option value="staggered">Staggered</option></select></label>{form.executionMode==='staggered'&&<label><span>Delay ({t.seconds})</span><input type="number" min="0" value={form.delaySeconds} onChange={e=>setForm({...form,delaySeconds:e.target.value})}/></label>}</div><div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>{t.cancel}</button><button className="btn primary">{t.save}</button></div></form></Modal>;
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
  return <div className="page"><div className="page-title"><div><h1>Auto Play</h1><span className="subtitle">Quick Play · 270s · {selectedIds.length} {t.selected}</span></div><div className="toolbar"><button className="btn success" disabled={batchBusy||!selectedIds.length} onClick={()=>runBatch('start')}><Icon name="play"/> {t.startSelected}</button><button className="btn danger-soft" disabled={batchBusy||!selectedIds.length} onClick={()=>runBatch('stop')}><Icon name="stop"/> {t.stopSelected}</button><button className="btn success" disabled={batchBusy||!state.accounts.length} onClick={()=>runBatch('start',state.accounts.map(a=>a.id))}><Icon name="play"/> {t.startAll}</button><button className="btn danger-soft" disabled={batchBusy||!state.accounts.length} onClick={()=>runBatch('stop',state.accounts.map(a=>a.id))}><Icon name="stop"/> {t.stopAll}</button><button className="btn ghost" onClick={()=>setScheduleOpen(true)}>{t.schedule}</button></div></div><div className="panel table-panel"><table><thead><tr><th className="select-col"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t.selectAll}/></th><th>{t.account}</th><th>{t.level}</th><th>{t.apk}</th><th>{t.status}</th><th>{t.next}</th><th>{t.dailyReward}</th><th>{t.browser}</th><th></th></tr></thead><tbody>{state.accounts.map(a=>{const r=state.runtime?.[a.id];const stats=profile.accounts?.[a.id]||{};const active=['running','preparing','starting','stopping'].includes(r?.status);return <tr key={a.id} className={selectedIds.includes(a.id)?'selected-row-soft':''}><td className="select-col"><input type="checkbox" checked={selectedIds.includes(a.id)} onChange={()=>toggleSelected(a.id)} aria-label={a.name}/></td><td><b>{a.name}</b>{profile.mainAccountId===a.id&&<span className="main-dot">ANA</span>}</td><td>{stats.level??'—'}</td><td>{fmtNumber(stats.apk)}</td><td><Status runtime={r} t={t}/></td><td>{r?.nextActionAt?new Date(r.nextActionAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'}</td><td><RewardStatus reward={state.rewards?.[a.id]} t={t}/></td><td><label className="switchline"><input type="checkbox" checked={!!a.visibleBrowser} onChange={async e=>{await api.accounts.update(a.id,{visibleBrowser:e.target.checked});await refresh()}}/><span>{t.showBrowser}</span></label></td><td className="actions">{active?<button className="btn danger-soft" onClick={()=>run(a,()=>api.accounts.stop(a.id))}><Icon name="stop"/> {t.stop}</button>:<button className="btn success" onClick={()=>run(a,()=>api.accounts.start(a.id))}><Icon name="play"/> {t.start}</button>}</td></tr>})}</tbody></table></div>{state.schedules?.length>0&&<div className="panel schedule-strip">{state.schedules.map(s=><div key={s.id}><b>{new Date(s.startAt).toLocaleString()}</b><span>{s.accountIds.length} {t.accounts.toLowerCase()} · {s.preparationMinutes}{t.minutes}</span><label><input type="checkbox" checked={!!s.enabled} disabled={s.completed} onChange={async e=>{await api.schedules.toggle(s.id,e.target.checked);await refresh()}}/></label><button className="icon-btn danger" onClick={async()=>{await api.schedules.remove(s.id);await refresh()}}><Icon name="trash" size={14}/></button></div>)}</div>}{scheduleOpen&&<ScheduleModal state={state} t={t} onClose={()=>setScheduleOpen(false)} refresh={refresh} toast={toast}/>}</div>;
}

function Market({ state, t, refresh, toast }) {
  const [selectedIds,setSelectedIds]=useState([]);
  const [busy,setBusy]=useState({});
  const [batchBusy,setBatchBusy]=useState('');
  const [tableFilters,setTableFilters]=useState({
    SOLD:{accountId:'',name:'',rating:''},
    LISTED:{accountId:'',name:'',rating:''},
    EXPIRED:{accountId:'',name:'',rating:''}
  });

  const accountKey=state.accounts.map(a=>a.id).join('|');

  useEffect(()=>{
    const valid=new Set(state.accounts.map(a=>a.id));
    setSelectedIds(ids=>ids.filter(id=>valid.has(id)));
  },[accountKey]);

  const toggle=id=>setSelectedIds(ids=>
    ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]
  );

  const allSelected=
    state.accounts.length>0 &&
    state.accounts.every(a=>selectedIds.includes(a.id));

  const invoke=async(id,mode)=>{
    if(mode==='close')return api.market.close(id);
    if(mode==='claim')return api.market.claim(id);
    return api.market.open(id);
  };

  const runOne=async(id,mode)=>{
    if(busy[id]||batchBusy)return;

    setBusy(previous=>({...previous,[id]:mode}));

    try{
      await invoke(id,mode);
      await refresh();
    }catch(error){
      toast(error.message,'error');
    }finally{
      setBusy(previous=>{
        const next={...previous};
        delete next[id];
        return next;
      });
    }
  };

  const runBatch=async(mode,ids)=>{
    if(batchBusy||!ids.length)return;

    setBatchBusy(mode);
    const failed=[];

    try{
      for(const id of ids){
        const account=state.accounts.find(a=>a.id===id);

        if(!account||busy[id])continue;
        if(mode==='close'&&!state.market?.[id]?.browserOpen)continue;

        setBusy(previous=>({...previous,[id]:mode}));

        try{
          await invoke(id,mode);
        }catch(error){
          failed.push(`${account.name}: ${error.message}`);
        }finally{
          setBusy(previous=>{
            const next={...previous};
            delete next[id];
            return next;
          });
        }
      }

      await refresh();

      if(failed.length)
        toast(`${failed.length} ${t.accounts.toLowerCase()}: ${failed[0]}`,'error');

    }finally{
      setBatchBusy('');
    }
  };

  const rows=state.accounts.flatMap(account=>
    (state.market?.[account.id]?.rows||[])
      .map(row=>({...row,accountName:account.name}))
  );

  const updateTableFilter=(status,key,value)=>
    setTableFilters(previous=>({
      ...previous,
      [status]:{
        ...previous[status],
        [key]:value
      }
    }));

  const section=(status,title)=>{
    const filter=tableFilters[status];
    const allItems=rows.filter(row=>row.status===status);

    const ratings=[
      ...new Set(
        allItems
          .map(row=>String(row.rating||'').toUpperCase())
          .filter(Boolean)
      )
    ].sort((a,b)=>gradeRank(b)-gradeRank(a));

    const items=allItems.filter(row=>{
      if(
        filter.accountId &&
        String(row.accountId)!==filter.accountId
      ) return false;

      if(
        filter.name &&
        !String(row.fullName||row.name||'')
          .toLowerCase()
          .includes(filter.name.toLowerCase())
      ) return false;

      if(
        filter.rating &&
        String(row.rating||'').toUpperCase()!==filter.rating
      ) return false;

      return true;
    });

    return (
      <section className="panel market-table-panel" key={status}>

        <div className="market-table-heading">
          <h2>{title} <span>{status}</span></h2>
          <b>{items.length}</b>
        </div>

        <div
          className="filter-panel"
          style={{margin:'10px 12px'}}
        >
          <div
            className="filters-grid"
            style={{
              gridTemplateColumns:'1.15fr 1.4fr .8fr auto'
            }}
          >

            <select
              value={filter.accountId}
              onChange={e=>
                updateTableFilter(
                  status,
                  'accountId',
                  e.target.value
                )
              }
            >
              <option value="">
                {t.all} · {t.account}
              </option>

              {state.accounts.map(account=>
                <option
                  key={account.id}
                  value={String(account.id)}
                >
                  {account.name}
                </option>
              )}
            </select>

            <input
              value={filter.name}
              onChange={e=>
                updateTableFilter(
                  status,
                  'name',
                  e.target.value
                )
              }
              placeholder={t.name}
            />

            <select
              value={filter.rating}
              onChange={e=>
                updateTableFilter(
                  status,
                  'rating',
                  e.target.value
                )
              }
            >
              <option value="">
                {t.all} · {t.rating}
              </option>

              {ratings.map(rating=>
                <option
                  key={rating}
                  value={rating}
                >
                  {rating}
                </option>
              )}
            </select>

            <button
              className="btn ghost small"
              onClick={()=>
                setTableFilters(previous=>({
                  ...previous,
                  [status]:{
                    accountId:'',
                    name:'',
                    rating:''
                  }
                }))
              }
            >
              {t.clear}
            </button>

          </div>
        </div>

        <div className="table-panel">
          <table>

            <thead>
              <tr>
                <th>{t.account}</th>
                <th>{t.players}</th>
                <th>{t.rating}</th>
                <th>{t.salary}</th>
                <th>{t.marketSalePrice}</th>
              </tr>
            </thead>

            <tbody>

              {items.length
                ? items.map((row,index)=>
                  <tr
                    key={`${row.accountId}-${row.page}-${row.index}-${index}`}
                  >
                    <td>{row.accountName}</td>

                    <td title={row.name}>
                      <b>{row.fullName||row.name}</b>
                    </td>

                    <td>
                      <span
                        className={`grade-chip ${gradeToneClass(row.rating)}`}
                      >
                        {row.rating||'—'}
                      </span>
                    </td>

                    <td>{fmtNumber(row.salary)}</td>

                    <td>
                      {fmtNumber(row.price)} {row.currency}
                    </td>

                  </tr>
                )
                : <tr>
                    <td
                      colSpan="5"
                      className="market-empty"
                    >
                      {t.marketNoRows}
                    </td>
                  </tr>
              }

            </tbody>

          </table>
        </div>

      </section>
    );
  };

  return (
    <div className="page market-page">

      <div className="page-title">
        <div>
          <h1>{t.market}</h1>
          <span className="subtitle">
            {t.marketSubtitle} · {selectedIds.length} {t.selected}
          </span>
        </div>

        <div className="toolbar">
          <button
            className="btn primary"
            disabled={!!batchBusy||!selectedIds.length}
            onClick={()=>runBatch('open',selectedIds)}
          >
            {t.marketOpenSelected}
          </button>

          <button
            className="btn ghost"
            disabled={!!batchBusy||!selectedIds.length}
            onClick={()=>runBatch('close',selectedIds)}
          >
            {t.marketCloseSelected}
          </button>

          <button
            className="btn primary"
            disabled={!!batchBusy||!state.accounts.length}
            onClick={()=>runBatch(
              'open',
              state.accounts.map(a=>a.id)
            )}
          >
            {t.marketOpenAll}
          </button>

          <button
            className="btn danger-soft"
            disabled={!!batchBusy||!state.accounts.length}
            onClick={()=>runBatch(
              'close',
              state.accounts.map(a=>a.id)
            )}
          >
            {t.marketCloseAll}
          </button>
        </div>
      </div>

      <section className="panel market-account-panel">

        <label className="scout-select-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={()=>
              setSelectedIds(
                allSelected
                  ? []
                  : state.accounts.map(a=>a.id)
              )
            }
          />
          {' '}
          {t.selectAll}
        </label>

        <div className="market-account-grid">

          {state.accounts.map(account=>{
            const s=state.market?.[account.id]||{};

            const sold=(s.rows||[])
              .filter(row=>row.status==='SOLD').length;

            const listed=(s.rows||[])
              .filter(row=>row.status==='LISTED').length;

            const expired=(s.rows||[])
              .filter(row=>row.status==='EXPIRED').length;

            const waiting=Boolean(
              busy[account.id] ||
              batchBusy ||
              ['scanning','claiming'].includes(s.status)
            );

            const status=
              s.status==='scanning'
                ? t.marketScanning
                : s.status==='claiming'
                  ? t.marketClaiming
                  : s.status==='error'
                    ? t.error
                    : s.browserOpen
                      ? t.marketOpen
                      : t.marketClosed;

            return (
              <div className="market-account" key={account.id}>

                <div className="market-account-header">

                  <input
                    type="checkbox"
                    checked={selectedIds.includes(account.id)}
                    onChange={()=>toggle(account.id)}
                    aria-label={account.name}
                  />

                  <b>{account.name}</b>

                  <span
                    className={`scout-browser-state ${
                      s.browserOpen?'open':'closed'
                    }`}
                  >
                    {status}
                  </span>

                </div>

                <div className="market-account-counts">
                  <span>SOLD <b>{sold}</b></span>
                  <span>LISTED <b>{listed}</b></span>
                  <span>EXPIRED <b>{expired}</b></span>
                  <span>{s.page||0}/{s.totalPages||0}</span>
                </div>

                <div className="market-account-actions">

                  <button
                    className="btn ghost small"
                    disabled={waiting}
                    onClick={()=>runOne(account.id,'open')}
                  >
                    <Icon name="refresh" size={14}/>
                    {s.scannedAt
                      ? t.marketRescan
                      : t.marketScan}
                  </button>

                  {sold>0 &&
                    <button
                      className="btn success small"
                      disabled={waiting}
                      onClick={()=>runOne(
                        account.id,
                        'claim'
                      )}
                    >
                      {t.marketClaim}
                    </button>
                  }

                  {s.browserOpen &&
                    <button
                      className="btn danger-soft small"
                      disabled={
                        waiting ||
                        s.pendingApkRefresh
                      }
                      onClick={()=>runOne(
                        account.id,
                        'close'
                      )}
                    >
                      {t.close}
                    </button>
                  }

                </div>

                {s.pendingApkRefresh &&
                  <small className="market-account-pending">
                    {t.marketApkPending}
                  </small>
                }

                {s.error &&
                  <small className="market-account-error">
                    {s.error}
                  </small>
                }

              </div>
            );
          })}

        </div>
      </section>

      {section('SOLD',t.marketSold)}
      {section('LISTED',t.marketListed)}
      {section('EXPIRED',t.marketExpired)}

    </div>
  );
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
        <aside className="scout-account-meta"><div className="scout-account-name"><input className="scout-row-check" type="checkbox" checked={selectedIds.includes(account.id)} onChange={()=>toggleSelected(account.id)}/><b>{account.name}</b>{mainId===account.id&&<span className="main-dot">ANA</span>}<span className={`scout-browser-state ${isOpen?'open':'closed'}`}>{isOpen?'Açık':'Kapalı'}</span></div><div className="scout-account-mini"><span>LV <b>{stats.level??'—'}</b></span><span>APK <b>{fmtNumber(stats.apk)}</b></span><span>TK <b>{fmtTk(data?.funds??stats.tk)}</b></span><span>{t.roster} <b>{data?.roster!=null?`${data.roster}/${data.rosterMax??'—'}`:(stats.roster!=null?`${stats.roster}/${stats.rosterMax??'—'}`:'—')}</b></span></div>{data&&<div className="scout-attempt-line"><span>{t.attempts} <b>{data.attempts??'—'}/{data.attemptsMax??'—'}</b></span><strong>{data.timer||'—'}</strong></div>}<div className="scout-row-actions">{!isOpen?<button className="btn primary small" disabled={isBusy||!!globalBusy} onClick={()=>runAccount(account.id,'open',()=>api.scout.open(account.id))}>{t.openScout}</button>:<><button className="btn ghost small" disabled={isBusy||!!globalBusy} onClick={()=>runAccount(account.id,'refresh',()=>api.scout.refresh(account.id))}><Icon name="refresh" size={14}/>{t.refreshScout}</button><button className="btn accent small" disabled={isBusy||!!globalBusy||data?.attempts===0} onClick={()=>runAccount(account.id,'callback',()=>api.scout.callback(account.id))}>{t.callback}</button><button className="btn ghost small" disabled={isBusy||!!globalBusy} onClick={()=>runAccount(account.id,'close',()=>api.scout.close(account.id))}>{t.close}</button></>}</div>{s.error&&<small className="scout-row-error">{s.error}</small>}</aside>
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


function AutoTrade({ state, t, refresh, toast }) {
  const rt = state.autoTrade?.runtime || null;
  const profile = state.accountProfile || {};
  const mainId = profile.mainAccountId;
  const accounts = state.accounts || [];
  const roles = state.cards?.roles || [];
  const previous = state.autoTrade?.lastRun?.config || {};

  const roleId = name =>
    roles.find(r =>
      String(r.name || '').trim().toLocaleLowerCase('tr-TR') ===
      name.toLocaleLowerCase('tr-TR')
    )?.id;

  const defaultSideToMain = [
    roleId('Kart')
  ].filter(Boolean);

  const defaultMainToSide = [
    roleId('Satılabilir'),
    roleId('Stok')
  ].filter(Boolean);

  const [form, setForm] = useState(() => ({
    sideAccountIds: previous.sideAccountIds || [],

    purchaseMaxPrice: String(
      previous.purchaseMaxPrice ?? 100
    ),

    sideToMainRoleIds:
      Array.isArray(previous.sideToMainRoleIds)
        ? previous.sideToMainRoleIds
        : defaultSideToMain,

    mainToSideRoleIds:
      Array.isArray(previous.mainToSideRoleIds)
        ? previous.mainToSideRoleIds
        : defaultMainToSide,

    roomDescription:
      previous.roomDescription || '923589325',

    roomPassword: '32958209',

    visible: previous.visible ?? false
  }));
  const [busy, setBusy] = useState(false);
  const running = rt && ['running', 'paused', 'stopping'].includes(rt.status);
  const selectedSides = form.sideAccountIds.filter(id => accounts.some(a => a.id === id && a.id !== mainId));
  const priceValid = /^\d+$/.test(String(form.purchaseMaxPrice).trim());
  const toggle = (key, id) => setForm(f => ({ ...f, [key]: f[key].includes(id) ? f[key].filter(x => x !== id) : [...f[key], id] }));
  const sideAccounts = accounts.filter(a => a.id !== mainId);
  const allSidesSelected =
    sideAccounts.length > 0 &&
    sideAccounts.every(a => form.sideAccountIds.includes(a.id));

  const toggleAllSides = () => {
    setForm(f => ({
      ...f,
      sideAccountIds: allSidesSelected
        ? []
        : sideAccounts.map(a => a.id)
    }));
  };
  const run = async () => {
    setBusy(true);
    try {
      const pf = await api.autoTrade.preflight(form);
      let stopConflicts = false;
      if (pf.conflicts?.length) {
        const msg = pf.conflicts.map(x => `${accounts.find(a => a.id === x.accountId)?.name || x.accountId}: ${x.feature}`).join('\n');
        stopConflicts = window.confirm(`${t.autoTradeConflicts}\n${msg}\n\n${t.autoTradeStopConflicts}`);
        if (!stopConflicts) return;
      }
      await api.autoTrade.start({ ...form, sideAccountIds: selectedSides, stopConflicts });
      await refresh();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const control = async action => {
    setBusy(true);

    try {
      await api.autoTrade[action]();
      await refresh();
    } catch (e) {
      if (
        /needs .* TK|has .* TK|insufficient.*TK|TK for the pending Trade/i.test(
          String(e.message || '')
        )
      ) {
        window.alert(`Auto Trade duraklatıldı.\n\n${e.message}`);
      } else {
        toast(e.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  };
  const resetRun = async () => {
    if (!window.confirm(t.autoTradeResetConfirm)) return;
    await control('reset');
  };
  const continueSide = async sideId => {
    setBusy(true);
    try { await api.autoTrade.resumeSide(sideId); await refresh(); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const roleBox = (key, title, hint) => <section className="auto-trade-role-box" key={key}>
    <div className="auto-trade-role-head"><b>{title}</b><small>{hint}</small></div>
    <div className="auto-trade-role-options">{roles.map(r => <label key={r.id} className={form[key].includes(r.id) ? 'checked' : ''}>
      <input type="checkbox" checked={form[key].includes(r.id)} disabled={running} onChange={() => toggle(key, r.id)} />
      <RoleBadge role={r} compact />
    </label>)}{!roles.length && <span className="muted-text">{t.autoTradeNoRoles}</span>}</div>
  </section>;
  const fmtDelta = v => v == null ? '—' : `${v > 0 ? '+' : ''}${fmtNumber(v)} TK`;
  const rows = useMemo(() => {
    const source = rt?.results || state.autoTrade?.lastRun?.results || [];

    return [...source].sort((a,b) => {
      if (a.isMain && !b.isMain) return -1;
      if (!a.isMain && b.isMain) return 1;

      return String(a.accountName || '')
        .localeCompare(
          String(b.accountName || ''),
          'tr',
          { sensitivity:'base' }
        );
    });
  }, [rt?.results, state.autoTrade?.lastRun?.results]);
  const main = accounts.find(a => a.id === mainId);
  return <div className="page auto-trade-page">
    <div className="page-title auto-trade-title"><div><h1>{t.autoTrade}</h1><span className="subtitle">{t.autoTradeSubtitle}</span></div>
      <div className="toolbar">{running ? ((rt?.config?.visible ?? form.visible) ? <>
        <button className="btn ghost" disabled={busy || rt.status === 'stopping'} onClick={() => control(rt.status === 'paused' ? 'resume' : 'pause')}>{rt.status === 'paused' ? t.autoTradeContinue : t.autoTradePause}</button>
        <button className="btn danger" disabled={busy} onClick={() => control('stop')}>{t.autoTradeStop}</button>
      </> : null) : rt?.pendingTrade ? <><button className="btn primary" disabled={busy} onClick={() => control('reconcilePending')}>{t.autoTradeVerifyPending}</button><button className="btn danger-soft" disabled={busy} onClick={() => control('stop')}>{t.autoTradeStop}</button></>
      : rt?.status === 'needs-attention' || rt?.status === 'interrupted' || rt?.status === 'error' ? <>
        {['interrupted','error'].includes(rt.status) && <button className="btn primary" disabled={busy} onClick={() => control('resume')}>{t.autoTradeResumeRun}</button>}
        <button className="btn danger-soft" disabled={busy} onClick={() => control('stop')}>{t.autoTradeStop}</button>
      </> : <button className="btn primary" disabled={busy || !mainId || !selectedSides.length || !priceValid} onClick={run}><Icon name="play" size={15}/>{t.autoTradeStart}</button>}
      {rt && !running && <button className="btn ghost" disabled={busy || !!rt.pendingTrade} title={rt.pendingTrade ? t.autoTradeVerifyPending : ''} onClick={resetRun}>{t.autoTradeReset}</button>}</div>
    </div>
    <div className="auto-trade-hero panel">
      <div><span>{t.mainAccount}</span><strong>{main?.name || t.chooseAccount}</strong><small>{main ? `LV ${profile.accounts?.[mainId]?.level ?? '—'} · ${fmtTk(profile.accounts?.[mainId]?.tk)}` : t.autoTradeChooseMain}</small></div>
      <div><span>{t.sideAccounts}</span><strong>{selectedSides.length}</strong><small>{t.autoTradeSortedByTk}</small></div>
      <div><span>{t.maxPrice} (Scout)</span><strong>{priceValid ? fmtTk(form.purchaseMaxPrice) : '—'}</strong><small>{t.autoTradePriceHint}</small></div>
    </div>
    <div className="auto-trade-grid">
      <div className="auto-trade-config-stack">
        <section className="panel auto-trade-config"><div className="auto-trade-section-head"><span>01</span><div><h3>{t.sideAccounts}</h3><small>{t.autoTradeSortedByTk}</small></div></div>
          <div className="account-checks">
            {sideAccounts.length > 0 && (
              <button
                type="button"
                className="btn ghost small"
                disabled={running}
                onClick={toggleAllSides}
              >
                {allSidesSelected ? 'Seçimi kaldır' : 'Tümünü seç'}
              </button>
            )}
            {sideAccounts.map(a =>  <label key={a.id} className={selectedSides.includes(a.id) ? 'checked' : ''}>
            <input type="checkbox" checked={selectedSides.includes(a.id)} disabled={running} onChange={() => toggle('sideAccountIds', a.id)} />
            <span>{a.name}</span><small>LV {profile.accounts?.[a.id]?.level ?? '—'} · {fmtTk(profile.accounts?.[a.id]?.tk)}</small>
          </label>)}{accounts.length <= 1 && <span className="auto-trade-empty">{t.autoTradeNoSides}</span>}</div>
        </section>
        <section className="panel auto-trade-config"><div className="auto-trade-section-head"><span>02</span><div><h3>{t.autoTradeRules}</h3><small>{t.autoTradeRuleHint}</small></div></div>
          <div className="auto-trade-price"><label><span>{t.maxPrice} (Scout)</span><input type="number" min="0" step="1" value={form.purchaseMaxPrice} disabled={running} aria-invalid={!priceValid} onChange={e => setForm({ ...form, purchaseMaxPrice: e.target.value })} /></label><p>{t.autoTradePriceHelp}</p></div>
          <div className="auto-trade-roles">{roleBox('sideToMainRoleIds', t.sideToMain, t.autoTradeCardDest)}{roleBox('mainToSideRoleIds', t.mainToSide, t.autoTradeOptional)}</div>
        </section>
        <section className="panel auto-trade-config"><div className="auto-trade-section-head"><span>03</span><div><h3>{t.autoTradeRoom}</h3><small>{t.autoTradeRoomHint}</small></div></div>
          <div className="auto-trade-fields"><label><span>{t.roomDescription}</span><input maxLength="50" value={form.roomDescription} disabled={running} onChange={e => setForm({ ...form, roomDescription: e.target.value })} /></label>
            <label><span>{t.roomPassword}</span><input type="password" autoComplete="off" value={form.roomPassword} disabled={running} onChange={e => setForm({ ...form, roomPassword: e.target.value })} /></label>
            <label className="inline-check"><input type="checkbox" checked={form.visible} disabled={running} onChange={e => setForm({ ...form, visible: e.target.checked })} /><span>{t.visible} {t.browser}</span></label></div>
        </section>
      </div>
      <aside className="panel auto-trade-status"><div className="auto-trade-section-head"><span>•</span><div><h3>{t.status}</h3><small>{t.autoTradeLive}</small></div></div>
        {rt ? <><div className={`auto-trade-state ${rt.status}`}><b>{rt.status}</b><span>{rt.message}</span></div>
          <div className="kv"><span>{t.autoTradePhase}</span><b>{rt.phase || '—'}</b><span>{t.sideAccounts}</span><b>{accounts.find(a => a.id === rt.activeSideAccountId)?.name || '—'}</b><span>{t.completed}</span><b>{rt.completedSides?.length || 0} / {rt.sideOrder?.length || selectedSides.length}</b></div>
        </> : <div className="auto-trade-empty">{t.autoTradeNoRun}</div>}
        {rt?.problems?.length > 0 && <div className="auto-trade-problems"><b>{t.problems}</b>{rt.problems.map((p, i) => <div key={i}>{accounts.find(a => a.id === p.accountId)?.name || t.autoTradeSystem} · {p.message}</div>)}</div>}
        {rt?.status === 'needs-attention' && rt.deferredSides?.length > 0 && <div className="auto-trade-deferred"><b>{t.autoTradeDeferred}</b>{rt.deferredSides.map(id => <div key={id}><span>{accounts.find(a => a.id === id)?.name || id}</span><button className="btn ghost small" disabled={busy || (profile.accounts?.[id]?.level || 0) < 10} onClick={() => continueSide(id)}>{t.autoTradeResumeSide}</button></div>)}</div>}
      </aside>
    </div>
    <div className="panel table-panel auto-trade-results"><div className="panel-head"><h3>{t.liveResults}</h3><span>{rt?.ledger?.length || 0} {t.autoTradeVerifiedEvents}</span></div>
      <table><thead><tr><th>{t.account}</th><th>Mail</th><th>TK Δ</th><th>{t.gainedPlayers}</th><th>{t.cardsMade}</th><th>{t.status}</th></tr></thead>
        <tbody>
          {rows.map(r => {
            const account = accounts.find(a => a.id === r.accountId);

            return (
              <tr
                key={r.accountId}
                className={r.isMain ? 'main-result-row' : ''}
              >
                <td>
                  <b>{r.isMain ? '★ ' : ''}{r.accountName}</b>
                </td>

                <td>
                  {account?.login || '—'}
                </td>

                <td
                  title={r.tkEstimated ? t.autoTradeTkEstimate : ''}
                  className={
                    (r.tkDelta || 0) > 0
                      ? 'positive'
                      : (r.tkDelta || 0) < 0
                        ? 'negative'
                        : ''
                  }
                >
                  {r.tkEstimated ? '≈ ' : ''}
                  {fmtDelta(r.tkDelta)}
                </td>

                <td>{fmtNumber(r.gainedPlayers || 0)}</td>
                <td>{fmtNumber(r.cardsMade || 0)}</td>
                <td>{r.status || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <div className="auto-trade-empty">{t.autoTradeNoRun}</div>}
    </div>
  </div>;
}

function TradingHall({ state, t, refresh, toast }) {
  const settings=state.settings||{};
  const [accountModal,setAccountModal]=useState(false); const [presetModal,setPresetModal]=useState(false);
  const [stopPrice,setStopPrice]=useState(settings.tradeStopPrice??9999); const [scanCurrency,setScanCurrency]=useState(settings.tradeScanCurrency||'APK_TICKET');
  const [filters,setFilters]=useState({name:'',seller:'',position:'All',gradeMin:'',gradeMax:'',salaryMin:'',salaryMax:'',salaryMaxExclusive:false,priceMin:'',priceMax:'',currency:'All'});
  const [sort,setSort]=useState({key:'price',dir:'asc'});
  const [selectedRowKey,setSelectedRowKey]=useState(null);
  const [listPage,setListPage]=useState(0);
  const tableBoxRef=useRef(null);
  useEffect(()=>{setStopPrice(settings.tradeStopPrice??9999);setScanCurrency(settings.tradeScanCurrency||'APK_TICKET')},[settings.tradeStopPrice,settings.tradeScanCurrency]);
  const rt=state.trading?.runtime||{}; const rows=state.trading?.rows||[];
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
  const setF=(k,v)=>setFilters({...filters,[k]:v,...(k==='salaryMax'?{salaryMaxExclusive:false}:{})}); const reset=()=>setFilters({name:'',seller:'',position:'All',gradeMin:'',gradeMax:'',salaryMin:'',salaryMax:'',salaryMaxExclusive:false,priceMin:'',priceMax:'',currency:'All'});
  const preset=p=>setFilters({...filters,salaryMin:'',salaryMax:String(p.salaryMax??''),salaryMaxExclusive:true,gradeMin:p.gradeMin||'',gradeMax:p.gradeMax||''});
  const start=async()=>{if(!state.tradeAccount){setAccountModal(true);return}try{await api.settings.update({tradeStopPrice:Number(stopPrice),tradeScanCurrency:scanCurrency});api.trade.start({stopPrice:Number(stopPrice),scanCurrency}).catch(e=>toast(e.message,'error'));await refresh()}catch(e){toast(e.message,'error')}};
  const savePresets=async items=>{await api.settings.update({tradePresets:items.map(x=>({...x,salaryMax:x.salaryMax===''?null:Number(x.salaryMax)}))});await refresh();setPresetModal(false)};
  const sortBy=k=>{if(hasTradingSortData(rows,k))setSort(s=>({key:k,dir:s.key===k&&s.dir==='asc'?'desc':'asc'}))};
  return <div className="page trading-page"><div className="page-title"><h1>Trading Hall</h1><div className="toolbar"><button className="btn ghost" onClick={()=>setAccountModal(true)}>{state.tradeAccount?.name||t.tradeAccount}</button><label className="compact-input"><span>{t.stopAtPrice}</span><input type="number" value={stopPrice} onChange={e=>setStopPrice(e.target.value)}/></label><label className="compact-input"><span>{t.scanCurrency}</span><select value={scanCurrency} onChange={e=>setScanCurrency(e.target.value)}><option value="APK_TICKET">APK</option><option value="TICKET">TIX</option><option value="all">All</option></select></label><button className="btn primary" disabled={rt.status==='running'||rt.status==='starting'} onClick={start}><Icon name="refresh"/> {t.refreshHall}</button><button className="btn danger-soft" disabled={!['running','starting'].includes(rt.status)} onClick={async()=>{try{await api.trade.stop();await refresh()}catch(e){toast(e.message,'error')}}}><Icon name="stop"/> {t.stop}</button></div></div><div className="trade-status"><span className={`pill ${rt.status==='running'?'ok':rt.status==='error'?'bad':'muted'}`}><i/>{rt.status==='running'?t.tradeRunning:rt.status==='done'?t.completed:t.idle}</span><b>{rt.page||0}/{rt.totalPages||0}</b><span>{rt.count||0} {t.listings}</span></div><div className="filter-panel"><div className="preset-bar"><span>{t.presets}</span>{(settings.tradePresets||[]).map(p=><button key={p.id} className="chip" onClick={()=>preset(p)}>{p.name}</button>)}<button className="chip muted-chip" onClick={()=>setPresetModal(true)}>{t.managePresets}</button><button className="chip reset-chip" onClick={reset}>{t.reset}</button></div><div className="filters-grid"><input placeholder={t.name} value={filters.name} onChange={e=>setF('name',e.target.value)}/><input placeholder={t.seller} value={filters.seller} onChange={e=>setF('seller',e.target.value)}/><select value={filters.position} onChange={e=>setF('position',e.target.value)}><option>All</option>{['PG','SG','SF','PF','C'].map(x=><option key={x}>{x}</option>)}</select><select value={filters.currency} onChange={e=>setF('currency',e.target.value)}><option>All</option><option>APK</option><option>TIX</option></select><select value={filters.gradeMin} onChange={e=>setF('gradeMin',e.target.value)}><option value="">Grade ≥</option>{GRADE_ORDER.slice(1).map(g=><option key={g}>{g}</option>)}</select><select value={filters.gradeMax} onChange={e=>setF('gradeMax',e.target.value)}><option value="">Grade ≤</option>{GRADE_ORDER.slice(1).map(g=><option key={g}>{g}</option>)}</select><input type="number" placeholder="Salary min" value={filters.salaryMin} onChange={e=>setF('salaryMin',e.target.value)}/><input type="number" placeholder="Salary max" value={filters.salaryMax} onChange={e=>setF('salaryMax',e.target.value)}/><input type="number" placeholder="Price min" value={filters.priceMin} onChange={e=>setF('priceMin',e.target.value)}/><input type="number" placeholder="Price max" value={filters.priceMax} onChange={e=>setF('priceMax',e.target.value)}/></div></div><div ref={tableBoxRef} className="panel table-panel trading-table keyboard-table" tabIndex={0} onKeyDown={onTableKeyDown}><table><thead><tr>{[['name',t.name],['grade',t.grade],['salary',t.salary],['price',t.price],['currency',t.currency],['position',t.position],['seller',t.seller],['base',t.base],['value',t.value],['valueChange','Δ']].map(([k,l])=>{const available=hasTradingSortData(rows,k);return <th key={k} onClick={available?()=>sortBy(k):undefined} className={available?'sortable':''} aria-sort={available&&sort.key===k?(sort.dir==='asc'?'ascending':'descending'):undefined}>{l}{available&&sort.key===k?(sort.dir==='asc'?' ↑':' ↓'):''}</th>})}</tr></thead><tbody>{visibleRows.map((r,i)=>{const key=rowKey(r);return <tr key={key} data-row-index={pageStart+i} className={selectedRowKey===key?'selected-row':''} onClick={()=>{setSelectedRowKey(key);tableBoxRef.current?.focus()}}><td><b>{r.name}</b></td><td><span className={`grade-badge ${gradeToneClass(r.grade)}`}>{r.grade||'—'}</span></td><td>{fmtTk(r.salary)}</td><td><b className="price">{fmtNumber(r.price)}</b></td><td>{r.currency}</td><td>{r.position||'—'}</td><td>{r.seller||'—'}</td><td>{r.base==null?'—':fmtTk(r.base)}</td><td>{r.value==null?'—':fmtTk(r.value)}</td><td>{fmtNumber(r.valueChange)}</td></tr>})}</tbody></table>{!filtered.length&&<div className="empty">{t.noRows}</div>}{pageCount>1&&<div className="trade-pagination"><button className="btn ghost" disabled={visiblePage===0} onClick={()=>{setListPage(visiblePage-1);setSelectedRowKey(null)}}>‹</button><span>{visiblePage+1} / {pageCount} {t.page} · {filtered.length} {t.listings}</span><button className="btn ghost" disabled={visiblePage>=pageCount-1} onClick={()=>{setListPage(visiblePage+1);setSelectedRowKey(null)}}>›</button></div>}</div>{accountModal&&<TradeAccountModal t={t} current={state.tradeAccount} onClose={()=>setAccountModal(false)} refresh={refresh} toast={toast}/>} {presetModal&&<PresetEditor presets={settings.tradePresets||[]} t={t} onClose={()=>setPresetModal(false)} onSave={savePresets}/>}</div>;
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

function Cards({ state, t, refresh, toast }) {
  const cards=state.cards||{players:[],roles:[],teams:[],trackedTeams:[],scannerReady:false,scanRuntime:{status:'idle'}};
  const profile=state.accountProfile||{};
  const [roleModal,setRoleModal]=useState(false);
  const [tab,setTab]=useState('teams');
  const [showTracked,setShowTracked]=useState(false);
  const [filters,setFilters]=useState({name:'',teams:[],stars:[],grades:[],roles:[]});
  const [sort,setSort]=useState({key:'name',dir:'asc'});
  const [selectedPlayerKeys,setSelectedPlayerKeys]=useState([]);
  const [bulkRoleId,setBulkRoleId]=useState('');
  const [bulkBusy,setBulkBusy]=useState(false);
  const mainAccount=state.accounts.find(a=>a.id===profile.mainAccountId);
  const scanRuntime=cards.scanRuntime||{};
  const scanBusy=['starting','scanning'].includes(scanRuntime.status);
  const activePlayers=useMemo(()=>(cards.players||[]).filter(p=>p.active!==false),[cards.players]);
  const teamNames=(cards.teams||[]).map(x=>x.team).filter(Boolean);
  const teamByName=useMemo(()=>new Map((cards.teams||[]).map(x=>[x.team,x])),[cards.teams]);

  const visibleTeams=showTracked?(cards.teams||[]).filter(x=>(cards.trackedTeams||[]).includes(x.team)):(cards.teams||[]);
  const playerRows=useMemo(()=>{
    let out=activePlayers.filter(p=>{
      if(filters.name&&!String(p.name||'').toLowerCase().includes(filters.name.toLowerCase()))return false;
      if(filters.teams.length&&!filters.teams.includes(p.team))return false;
      if(filters.stars.length&&!filters.stars.includes(Number(p.stars||0)))return false;
      if(filters.grades.length&&!filters.grades.includes(String(p.grade||'').toUpperCase()))return false;
      if(filters.roles.length&&!filters.roles.some(id=>(p.roleIds||[]).includes(id)))return false;
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
  const resetCards=async()=>{if(!confirm(t.resetCardsConfirm))return;try{await api.cards.reset();setFilters({name:'',teams:[],stars:[],grades:[],roles:[]});setSelectedPlayerKeys([]);setShowTracked(false);await refresh()}catch(e){toast(e.message,'error')}};
  const sortBy=key=>setSort(s=>({key,dir:s.key===key&&s.dir==='asc'?'desc':'asc'}));
  const subtitle=scanBusy?(scanRuntime.message||t.scanningCards):(cards.updatedAt?`${t.lastUpdate}: ${fmtTime(cards.updatedAt)}`:t.scannerWaiting);

  return <div className="page"><div className="page-title"><div><h1>{t.cards}</h1><span className="subtitle">{subtitle}</span></div><div className="toolbar"><select value={profile.mainAccountId||''} onChange={setMain} disabled={scanBusy}><option value="">{t.mainAccount}</option>{state.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><button className="btn ghost" onClick={()=>setRoleModal(true)} disabled={scanBusy}>{t.roles}</button><button className="btn danger-soft" onClick={resetCards} disabled={scanBusy}>{t.resetCards}</button><button className="btn primary" disabled={!cards.scannerReady||!mainAccount||scanBusy} title={!mainAccount?t.scannerWaiting:''} onClick={runRefresh}><Icon name="refresh"/> {scanBusy?t.scanningCards:t.refresh}</button></div></div>
    <div className="cards-summary"><div className="panel main-card-box"><span>{t.mainAccount}</span><b>{mainAccount?.name||'—'}</b><small>{scanBusy?(scanRuntime.message||t.scanningCards):(cards.scannerReady?t.refresh:t.scannerWaiting)}</small></div><div className="panel main-card-box"><span>{t.players}</span><b>{activePlayers.length}</b><small>{(cards.teams||[]).length} {t.team.toLowerCase()}</small></div><div className="panel main-card-box"><span>{t.roles}</span><b>{(cards.roles||[]).length}</b><small className="inline-role-list">{cards.roles?.map(r=><RoleBadge key={r.id} role={r} compact/>)}</small></div></div>
    <div className="cards-tabs"><button className={tab==='teams'?'active':''} onClick={()=>setTab('teams')}>{t.cardTeamsTab}</button><button className={tab==='players'?'active':''} onClick={()=>setTab('players')}>{t.cardPlayersTab}</button></div>
    {tab==='teams'&&<>{(cards.teams||[]).length>0?<><div className="cards-section-title"><b>{t.teamDevelopment}</b><button className={`chip ${showTracked?'active-chip':''}`} onClick={()=>setShowTracked(x=>!x)}>{t.trackedOnly}</button></div><div className="team-grid">{visibleTeams.map(team=><div className="team-card" key={team.team}><div className="team-main"><b>{team.team}</b><strong><StarValue value={team.star}/></strong><span>{team.blockerCount} {t.teamNeeded.toLowerCase()}</span></div><button className={`track-star ${(cards.trackedTeams||[]).includes(team.team)?'on':''}`} onClick={()=>toggleTracked(team.team)} title={t.trackedTeams}><Icon name="star" size={15}/></button>{team.blockers?.slice(0,3).map(b=><small key={b.key}>{b.name}: <ProgressValue progress={b.progress} t={t}/>{b.raisesTeamIfUpgraded?` · ${t.raisesTeam}`:''}</small>)}</div>)}</div></>:<div className="panel"><div className="empty big"><Icon name="cards" size={30}/><b>{t.cardsEmpty}</b><span>{t.cardScanLater}</span></div></div>}</>}
    {tab==='players'&&<><div className="card-player-filters"><input placeholder={t.searchName} value={filters.name} onChange={e=>setFilters({...filters,name:e.target.value})}/><MultiSelectFilter label={t.filterTeams} allLabel={t.all} options={teamNames} selected={filters.teams} onChange={teams=>setFilters({...filters,teams})}/><MultiSelectFilter label={t.filterStars} allLabel={t.all} options={[0,1,2,3,4,5].map(v=>({value:v,label:`${v}★`}))} selected={filters.stars} onChange={stars=>setFilters({...filters,stars})} renderLabel={o=><span className="star-value">{o.label}</span>}/><MultiSelectFilter label={t.filterRatings} allLabel={t.all} options={GRADE_ORDER.slice(1).reverse().map(g=>({value:g,label:g}))} selected={filters.grades} onChange={grades=>setFilters({...filters,grades})} renderLabel={o=><span className={`grade-badge mini ${gradeToneClass(o.value)}`}>{o.label}</span>}/><MultiSelectFilter label={t.filterRoles} allLabel={t.all} options={(cards.roles||[]).map(r=>({value:r.id,label:r.name,role:r}))} selected={filters.roles} onChange={roles=>setFilters({...filters,roles})} renderLabel={o=><RoleBadge role={o.role} compact/>}/><button className="chip reset-chip" onClick={()=>setFilters({name:'',teams:[],stars:[],grades:[],roles:[]})}>{t.reset}</button></div>
      <div className="card-selection-bar"><div className="card-selection-count"><b>{selectedPlayerKeys.length}</b> {t.selectedPlayers}<span>{playerRows.length} {t.visiblePlayers}</span></div><div className="card-selection-actions"><button className="btn ghost small" disabled={!playerRows.length} onClick={allVisibleSelected?deselectVisible:selectVisible}>{allVisibleSelected?t.deselectVisible:t.selectVisible}</button><button className="btn ghost small" disabled={!selectedPlayerKeys.length} onClick={()=>setSelectedPlayerKeys([])}>{t.clearSelection}</button><select value={bulkRoleId} onChange={e=>setBulkRoleId(e.target.value)}><option value="">{t.bulkRole}</option>{(cards.roles||[]).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select><button className="btn primary small" disabled={bulkBusy||!bulkRoleId||!selectedPlayerKeys.length} onClick={()=>applyBulkRole('add')}>{t.addRoleSelected}</button><button className="btn danger-soft small" disabled={bulkBusy||!bulkRoleId||!selectedPlayerKeys.length} onClick={()=>applyBulkRole('remove')}>{t.removeRoleSelected}</button></div></div>
      {playerRows.length?<div className="panel table-panel cards-table player-list-table"><table><thead><tr><th className="select-col"><input type="checkbox" checked={allVisibleSelected} onChange={()=>allVisibleSelected?deselectVisible():selectVisible()} aria-label={t.selectVisible}/></th>{[['name',t.name],['team',t.team],['grade',t.rating],['stars',t.stars],['cardCount',t.cardCount],['progress',t.progress],['roles',t.roles],['teamDevelopment',t.teamDevelopment]].map(([key,label])=><th key={key} className="sortable" onClick={()=>sortBy(key)}>{label}{sort.key===key?(sort.dir==='asc'?' ↑':' ↓'):''}</th>)}</tr></thead><tbody>{playerRows.map(p=><tr key={p.key} className={selectedPlayerSet.has(p.key)?'selected-row-soft':''}><td className="select-col"><input type="checkbox" checked={selectedPlayerSet.has(p.key)} onChange={()=>togglePlayerSelected(p.key)} aria-label={p.name||p.key}/></td><td><b>{p.name||p.key}</b></td><td>{p.team||'—'}</td><td><span className={`grade-badge ${gradeToneClass(p.grade)}`}>{p.grade||'—'}</span></td><td><StarValue value={p.stars}/></td><td>{fmtNumber(p.cardCount)}</td><td><ProgressValue progress={p.progress} t={t} className={p.progress?.ready?'ready-text':''}/></td><td><div className="role-chips">{(cards.roles||[]).map(role=>{const on=(p.roleIds||[]).includes(role.id);return <button key={role.id} className={on?'on':''} style={on?roleStyle(role):undefined} onClick={()=>toggleRole(p,role.id)}>{role.name}</button>})}</div></td><td>{p._blocker?<span className={`pill ${p._blocker.raisesTeamIfUpgraded?'ok':'warn'}`}><i/>{p._blocker.raisesTeamIfUpgraded?t.raisesTeam:t.teamNeeded}</span>:'—'}</td></tr>)}</tbody></table></div>:<div className="panel"><div className="empty">{t.noRows}</div></div>}</>}
    {roleModal&&<RoleManager roles={cards.roles||[]} t={t} onClose={()=>setRoleModal(false)} refresh={refresh} toast={toast}/>}
  </div>;
}

function Activity({ state, t, refresh }) {
  const [accountFilter,setAccountFilter]=useState('all');
  const [typeFilter,setTypeFilter]=useState('all');
  const activity=state.activity||[];
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
    if(typeFilter==='success'&&item.level!=='success')return false;
    if(typeFilter==='error'&&item.level!=='error')return false;
    if(typeFilter==='warning'&&item.level!=='warning')return false;
    return true;
  }),[activity,accountFilter,typeFilter]);
  return <div className="page"><div className="page-title"><div><h1>{t.activity}</h1><span className="subtitle">{filtered.length} / {activity.length}</span></div><div className="toolbar"><select aria-label={t.activityAccountFilter} value={accountFilter} onChange={e=>setAccountFilter(e.target.value)}><option value="all">{t.activityAllAccounts}</option>{accounts.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select aria-label={t.activityTypeFilter} value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="all">{t.activityAllTypes}</option><option value="success">{t.activitySuccess}</option><option value="error">{t.activityErrors}</option><option value="warning">{t.activityWarnings}</option></select><button className="btn ghost" onClick={async()=>{await api.activity.clear();await refresh()}}>{t.clear}</button></div></div><div className="panel activity-list">{filtered.length?filtered.map(x=><div className={`activity-row ${x.level}`} key={x.id}><i/><time>{new Date(x.at).toLocaleTimeString()}</time><b>{x.accountName||x.taskName||'System'}</b><span>{x.message}</span></div>):<div className="empty">{activity.length?t.activityNoMatch:'—'}</div>}</div></div>;
}
function Settings({ state, t, refresh, toast }) { const saveLang=async v=>{try{await api.settings.update({language:v});await refresh()}catch(e){toast(e.message,'error')}};return <div className="page"><div className="page-title"><h1>{t.settings}</h1></div><div className="settings-grid"><div className="panel setting-card"><label><span>{t.language}</span><select value={state.settings.language||'auto'} onChange={e=>saveLang(e.target.value)}><option value="auto">{t.auto}</option><option value="tr">{t.turkish}</option><option value="en">{t.english}</option></select></label></div><div className="panel setting-card"><button className="btn ghost" onClick={()=>api.settings.openDataFolder()}><Icon name="folder"/> {t.dataFolder}</button></div></div></div>; }

export default function App(){
  const [state,setState]=useState({accounts:[],accountProfile:{accounts:{},effectiveApk:{},totalUsableApk:null},tradeAccount:null,tasks:[],schedules:[],settings:{},activity:[],runtime:{},scout:{},market:{},trading:{runtime:{},rows:[]},autoTrade:{runtime:null,lastRun:null},cards:{players:[],roles:[],teams:[],trackedTeams:[],scannerReady:false},rewards:{},systemLocale:'en-US'});
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
  const nav=[['home','home',t.home],['accounts','accounts',t.accounts],['autoplay','play',t.autoplay],['autotrade','trade',t.autoTrade],['scout','scout',t.scout],['market','market',t.market],['trade','trade',t.trade],['cards','cards',t.cards],['activity','activity',t.activity],['settings','settings',t.settings]];
  return <div className="shell"><aside className="sidebar"><div className="brand"><div>DT</div><b>DreamTeam<span>Manager</span></b></div><nav>{nav.map(([id,icon,label])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}><Icon name={icon}/><span>{label}</span></button>)}</nav></aside><main>{page==='home'&&<Home state={state} t={t} go={setPage}/>} {page==='accounts'&&<Accounts state={state} t={t} refresh={refresh} toast={toast}/>} {page==='autoplay'&&<AutoPlay state={state} t={t} refresh={refresh} toast={toast}/>} {page==='autotrade'&&<AutoTrade state={state} t={t} refresh={refresh} toast={toast}/>} {page==='scout'&&<Scout state={state} t={t} refresh={refresh} toast={toast}/>} {page==='market'&&<Market state={state} t={t} refresh={refresh} toast={toast}/>} {page==='trade'&&<TradingHall state={state} t={t} refresh={refresh} toast={toast}/>} {page==='cards'&&<Cards state={state} t={t} refresh={refresh} toast={toast}/>} {page==='activity'&&<Activity state={state} t={t} refresh={refresh}/>} {page==='settings'&&<Settings state={state} t={t} refresh={refresh} toast={toast}/>}</main>{toastState&&<div className={`toast ${toastState.type}`}>{toastState.message}</div>}{alertState&&<Modal title={t.autoPlayStopped} onClose={()=>setAlertState(null)} width={520}><div style={{display:'grid',gap:10,fontSize:12,color:'#445067'}}><b style={{fontSize:14,color:'#b13b30'}}>{alertState.accountName||t.account}</b><span>{t.salaryCapWarning}</span><div style={{padding:'10px 12px',border:'1px solid #f2d0cc',borderRadius:9,background:'#fff7f5',color:'#8f3128',fontWeight:700}}>{String(alertState.message||'').replace(/^Quick Play stopped:\s*/i,'')}</div><div className="modal-actions"><button className="btn primary" onClick={()=>setAlertState(null)}>{t.close}</button></div></div></Modal>}</div>;
}
