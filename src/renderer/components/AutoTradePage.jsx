import { useEffect, useMemo, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;

const TEXT = {
  tr: {
    title: 'Auto Trade', subtitle: 'Scout · karta çevirme · Main ↔ Side takasları',
    start: 'Başlat', pause: 'Duraklat', resume: 'Devam ettir', stop: 'Durdur', cont: 'Kaldığı yerden devam et', reset: 'İlerlemeyi sıfırla',
    resetConfirm: 'Kayıtlı ilerleme silinecek ve Auto Trade sıfırdan başlayacak. Emin misin?', yes: 'Evet, sıfırla', cancel: 'Vazgeç', close: 'Kapat',
    status: { idle: 'Hazır', waitingGame: 'Oyun bekleniyor · gelince devam edecek', running: 'Çalışıyor', paused: 'Duraklatıldı', stopping: 'Durduruluyor', stopped: 'Durduruldu', error: 'Hata · senin müdahalen gerekiyor', done: 'Tamamlandı', awaitingListing: 'Pazar listesi bekleniyor' },
    accounts: 'Hesaplar', selectAll: 'Tümünü seç', mainBadge: 'Main', actingMain: 'Bu çalıştırmada Main gibi davranacak hesap', actingMainHint: 'Asıl Main seçili değil. Seçim sadece bu çalıştırma için; asıl Main değişmez.',
    routing: 'Roller', sideToMain: 'Side → Main', mainToSide: 'Main → Side', sideToMainNote: 'Side → Main yönündeki roller Main\'e geçer ve Main\'de karta çevrilir.', mainToSideNote: 'Main → Side yönündeki roller Side hesaplarda kalır; sonunda pazara listeleyebilirsin.',
    maxPrice: 'Maksimum fiyat (Scout Price)', maxPriceHint: 'Bu fiyat ve altındaki oyuncular rolüne bakılmadan Main\'e gider ve karta çevrilir. 0–2500; 50\'nin altı = sadece roller.',
    room: 'Trade odası', roomDesc: 'Oda adı', roomPass: 'Oda şifresi', roomPassSaved: 'kayıtlı', showPass: 'Şifreyi göster', hidePass: 'Şifreyi gizle',
    loop: 'Döngü', loopOff: 'Tek tur', loopCount: 'Belirli sayıda', loopInfinite: 'Sonsuz', loopTimes: 'tur', loopHint: 'Döngüde her hesaba Scout\'u yenilendiğinde (30 dk) tekrar girilir.',
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
    actList: 'Pazarda listele', actTrade: 'Trade\'e dahil et', actNone: 'Hiçbir şey yapma', blocked: { equipped: 'Ekipmanlı · taşınamaz', x: 'X oyuncu · taşınamaz', temporary: 'Süreli · taşınamaz', starter: 'Başlangıç beşi' },
    fitsMain: 'Main\'e gider', fitsSide: 'Side\'da kalır', fitsNone: 'Rol/fiyat uymuyor',
    noBench: 'Hiçbir hesabın bench\'inde oyuncu yok.', startNow: 'Başlat',
    live: 'Canlı durum', openTime: 'açık', visits: 'giriş', tk: 'TK', noPlayers: 'Henüz oyuncu yok',
    player: 'Oyuncu', salary: 'Maaş', value: 'Değer', base: 'Base', listPrice: 'Satış fiyatı',
    baseProjected: 'Ertesi günün Base değerini kullan (Base × 0,95)', baseProjectedHint: 'Base her gün yeniden hesaplanır ve indirimli alımlar onu ~%5 düşürür. Açıkken maaş yarınki Base ile karşılaştırılır: Base 50 iken 50 maaşlı oyuncu Base sayılmaz, 48 maaşlı sayılır.',
    price: 'Fiyat', role: 'Rol', stateCol: 'Durum', from: 'Nereden',
    pstatus: { bought: 'Alındı', existing: 'Önceden vardı', toTrade: 'Takas edilecek', trading: 'Takas ediliyor', keep: 'Side\'da kalıyor', toConvert: 'Karta çevrilecek', converting: 'Çevriliyor', converted: 'Karta çevrildi', listed: 'Pazarda', none: 'Dokunulmuyor' },
    accStatus: { waiting: 'Sırada', active: 'Açık', done: 'Bitti', skipped: 'Atlandı (TK)', error: 'Hata' },
    summary: 'Özet', bought: 'Alınan', spent: 'Harcanan TK', converted: 'Karta çevrilen', tradedIn: 'Takasla gelen', tradedOut: 'Takasla giden', tkPaid: 'Takasta ödenen', tkReceived: 'Takasta alınan', listed: 'Pazara konan', tkNow: 'TK (başlangıç → şimdi)',
    cards: 'Karta çevrilen oyuncular', thisRun: 'Bu çalıştırma', total: 'Toplam', resetCards: 'Tabloyu sıfırla', resetCardsConfirm: 'Karta çevrilen oyuncuların sayıları (bu çalıştırma ve toplam) silinecek. Emin misin?',
    listTitle: 'Pazara listele', listHint: 'Side\'larda kalan oyuncular. Fiyat ve para birimi seçip istediklerini listele.', listSelected: 'Seçilileri listele', nothingToList: 'Listelenecek oyuncu yok.',
    listingModal: '{name} kadrosu doldu', listingModalHint: 'Kalacak oyuncularla dolu. Hangi oyuncular pazara konsun? Listelenince Auto Trade devam eder.', listAndGo: 'Listele ve devam et', skipList: 'Listeleme, bu hesabı bitir',
    errorTitle: 'Auto Trade durdu', errorHint: 'Sorunu oyunda düzeltip "Kaldığı yerden devam et"e bas. Hesaplara yeniden girilir ve kaldığı yerden sürer.',
    cycle: 'Tur {n}', waitScout: '{name} Scout yenilenmesini bekliyor · {time}',
    steps: { starting: 'Başlıyor', opening: '{name} açılıyor', scouting: '{name} Scout · {candidates} uygun · {attempts} hak', signing: '{name}: {player} alınıyor ({price} TK)', callback: '{name}: Call back', converting: 'Main: {count} oyuncu karta çevriliyor', trading: '{side} ile takas · Main {give} verir, {take} alır · {tk} TK', waitingScout: '{name} Scout yenilenmesini bekliyor', cardScan: 'Main hesabında kart taraması yapılıyor', listing: '{name}: {count} oyuncu pazara konuyor', done: 'Bitti', stopped: 'Durduruldu' }
  },
  en: {
    title: 'Auto Trade', subtitle: 'Scout · star cards · main ↔ side trades',
    start: 'Start', pause: 'Pause', resume: 'Resume', stop: 'Stop', cont: 'Continue from where it stopped', reset: 'Reset progress',
    resetConfirm: 'Saved progress is deleted and Auto Trade starts from scratch. Are you sure?', yes: 'Yes, reset', cancel: 'Cancel', close: 'Close',
    status: { idle: 'Ready', waitingGame: 'Waiting for the game · continues when it is back', running: 'Running', paused: 'Paused', stopping: 'Stopping', stopped: 'Stopped', error: 'Error · needs you', done: 'Finished', awaitingListing: 'Waiting for a market listing' },
    accounts: 'Accounts', selectAll: 'Select all', mainBadge: 'Main', actingMain: 'Account acting as main for this run', actingMainHint: 'The real main is not selected. This choice is for this run only; the real main stays main.',
    routing: 'Roles', sideToMain: 'Side → Main', mainToSide: 'Main → Side', sideToMainNote: 'Roles routed side → main move to main and are turned into star cards there.', mainToSideNote: 'Roles routed main → side stay on the sides; you can list them on the market at the end.',
    maxPrice: 'Maximum price (Scout Price)', maxPriceHint: 'Players at or below this price go to main and become cards whatever their role. 0–2500; under 50 = roles only.',
    room: 'Trade room', roomDesc: 'Room name', roomPass: 'Room password', roomPassSaved: 'saved', showPass: 'Show password', hidePass: 'Hide password',
    loop: 'Loop', loopOff: 'Single run', loopCount: 'Number of cycles', loopInfinite: 'Endless', loopTimes: 'cycles', loopHint: 'In a loop every account is entered again when its Scout refreshes (30 min).',
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
    actList: 'List on market', actTrade: 'Include in trade', actNone: 'Do nothing', blocked: { equipped: 'Equipped · cannot move', x: 'X player · cannot move', temporary: 'Temporary · cannot move', starter: 'Starter' },
    fitsMain: 'goes to main', fitsSide: 'stays on side', fitsNone: 'role/price does not fit',
    noBench: 'No account has players on the bench.', startNow: 'Start',
    live: 'Live', openTime: 'open', visits: 'visits', tk: 'TK', noPlayers: 'No players yet',
    player: 'Player', salary: 'Salary', value: 'Value', base: 'Base', listPrice: 'List price',
    baseProjected: "Use tomorrow's Base (Base × 0.95)", baseProjectedHint: "Base is recomputed daily and discounted signings pull it ~5% down. When on, the salary is compared with tomorrow's Base: at Base 50 a 50 salary is not Base, a 48 salary is.",
    price: 'Price', role: 'Role', stateCol: 'Status', from: 'From',
    pstatus: { bought: 'Bought', existing: 'Was there', toTrade: 'To be traded', trading: 'Trading', keep: 'Stays on side', toConvert: 'To be converted', converting: 'Converting', converted: 'Converted', listed: 'Listed', none: 'Untouched' },
    accStatus: { waiting: 'Waiting', active: 'Open', done: 'Done', skipped: 'Skipped (TK)', error: 'Error' },
    summary: 'Summary', bought: 'Bought', spent: 'TK spent', converted: 'Converted', tradedIn: 'Traded in', tradedOut: 'Traded out', tkPaid: 'TK paid in trades', tkReceived: 'TK received in trades', listed: 'Listed', tkNow: 'TK (start → now)',
    cards: 'Players turned into cards', thisRun: 'This run', total: 'Total', resetCards: 'Reset table', resetCardsConfirm: 'The card counts (this run and totals) will be deleted. Are you sure?',
    listTitle: 'List on market', listHint: 'Players left on the sides. Pick price and currency and list the ones you want.', listSelected: 'List selected', nothingToList: 'Nothing to list.',
    listingModal: '{name} roster is full', listingModalHint: 'It is full of players it keeps. Which should go on the market? Auto Trade continues after listing.', listAndGo: 'List and continue', skipList: 'Do not list, finish this account',
    errorTitle: 'Auto Trade stopped', errorHint: 'Fix it in the game and press "Continue". The accounts are opened again and the run goes on from there.',
    cycle: 'Cycle {n}', waitScout: '{name} waits for its Scout · {time}',
    steps: { starting: 'Starting', opening: 'Opening {name}', scouting: '{name} Scout · {candidates} eligible · {attempts} callbacks', signing: '{name}: signing {player} ({price} TK)', callback: '{name}: Call back', converting: 'Main: converting {count} player(s)', trading: 'Trade with {side} · main gives {give}, gets {take} · {tk} TK', waitingScout: '{name} waits for its Scout refresh', cardScan: 'Scanning the cards of the main account', listing: '{name}: listing {count} player(s)', done: 'Done', stopped: 'Stopped' }
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const num = v => v == null || v === '' ? '—' : Number(v).toLocaleString();
const dur = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}sa ${m}dk` : m ? `${m}dk ${x}sn` : `${x}sn`; };
const STATUS_TONE = { bought: 'muted', existing: 'muted', toTrade: 'warn', trading: 'warn', keep: 'ok', toConvert: 'warn', converting: 'warn', converted: 'ok', listed: 'ok', none: 'muted' };

function useTick(active) {
  const [, set] = useState(0);
  useEffect(() => { if (!active) return; const t = setInterval(() => set(x => x + 1), 1000); return () => clearInterval(t); }, [active]);
}

export default function AutoTradePage({ state, t, toast, msgText, Modal, refresh }) {
  const x = TEXT[t.lang] || TEXT.en;
  const at = state.autoTrade2 || {};
  const run = at.run;
  const last = at.lastConfig || {};
  const defaults = at.defaults || {};
  const roles = state.cards?.roles || [];
  const playerIndex = useMemo(() => new Map((state.players?.players || []).map(p => [p.id, p])), [state.players]);
  const accounts = state.accounts || [];
  const realMain = state.accountProfile?.mainAccountId || null;
  const running = run && ['running', 'paused', 'stopping', 'awaitingListing'].includes(run.status);
  useTick(running);

  const roleIdByName = n => roles.find(r => String(r.name).toLocaleLowerCase('tr-TR') === n)?.id;
  const [form, setForm] = useState(() => ({
    accountIds: accounts.map(a => a.id),
    actingMainId: '',
    sideToMainRoleIds: last.sideToMainRoleIds || [roleIdByName('kart') || 'card'],
    mainToSideRoleIds: last.mainToSideRoleIds || [roleIdByName('satılabilir') || 'sellable', roleIdByName('stok')].filter(Boolean),
    maxPrice: String(last.maxPrice ?? defaults.maxPrice ?? 100),
    roomDescription: last.roomDescription || defaults.roomDescription || '923589325',
    roomPassword: last.roomPassword || '32958209',
    loopMode: last.loopMode || 'off', loopCount: String(last.loopCount || 2),
    baseAsSellable: Boolean(last.baseAsSellable),
    baseProjected: last.baseProjected !== false
  }));
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const [pre, setPre] = useState(null);       // preflight result
  const [decisions, setDecisions] = useState({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const run_ = async fn => { try { return await fn(); } catch (e) { toast(e.message, 'error'); } };

  const selected = form.accountIds.filter(id => accounts.some(a => a.id === id));
  const mainSelected = selected.includes(realMain);
  const priceNum = Number(form.maxPrice);
  const priceValid = /^\d+$/.test(String(form.maxPrice).trim()) && priceNum >= 0 && priceNum <= 2500;
  const canStart = selected.length >= 2 && priceValid && (mainSelected || (form.actingMainId && selected.includes(form.actingMainId)));
  const toggleAcc = id => set({ accountIds: form.accountIds.includes(id) ? form.accountIds.filter(v => v !== id) : [...form.accountIds, id] });
  const toggleRole = (key, id) => set({ [key]: form[key].includes(id) ? form[key].filter(v => v !== id) : [...form[key], id] });

  const openPreflight = () => run_(async () => {
    setPre({ loading: true });
    const res = await api.autoTrade.preflight({ accountIds: selected, config: { ...form, maxPrice: priceNum } });
    const d = {};
    for (const a of res.accounts) for (const p of a.bench) {
      d[a.id] = d[a.id] || {};
      d[a.id][p.id] = { action: 'none', price: (p.roleIds || []).some(r => r !== 'sellable' && form.mainToSideRoleIds.includes(r)) ? 99999 : 20, currency: (p.roleIds || []).some(r => r !== 'sellable' && form.mainToSideRoleIds.includes(r)) ? 'TIX' : 'APK' };
    }
    setDecisions(d);
    setPre(res);
    if (res.conflicts.length || res.accounts.some(a => a.bench.length)) Promise.resolve(api.autoTrade.attention?.('conflict')).catch(() => {});
  });
  const startNow = stopConflicts => run_(async () => {
    await api.autoTrade.start({ ...form, maxPrice: priceNum, loopCount: Number(form.loopCount) || 1, accountIds: selected, actingMainId: mainSelected ? undefined : form.actingMainId, roomPassword: form.roomPassword || undefined, benchDecisions: decisions, stopConflicts });
    setPre(null);
    await refresh();
  });

  const statusKey = run?.status || 'idle';
  const stepText = run ? fill(x.steps[run.step] || '', run.stepParams || {}) : '';
  const accRows = run ? run.config.accountIds.map(id => run.accounts[id]).filter(Boolean) : [];
  const mainAcc = run ? run.accounts[run.config.mainId] : null;
  const activeSide = run ? run.accounts[run.currentSideId || (run.activeId !== run.config.mainId ? run.activeId : '')] : null;
  const others = accRows.filter(a => a !== mainAcc && a !== activeSide);

  return <div className="page autotrade2">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar">
        {!running && <button className="btn primary" disabled={!canStart} onClick={openPreflight}>{x.start}</button>}
        {run?.status === 'running' && <button className="btn ghost" onClick={() => run_(() => api.autoTrade.pause())}>{x.pause}</button>}
        {run?.status === 'paused' && <button className="btn success" onClick={() => run_(() => api.autoTrade.resume())}>{x.resume}</button>}
        {running && <button className="btn danger-soft" onClick={() => run_(() => api.autoTrade.stop())}>{x.stop}</button>}
        {!running && run && ['stopped', 'error', 'waitingGame'].includes(run.status) && <button className="btn success" onClick={() => run_(() => api.autoTrade.continue())}>{x.cont}</button>}
        {!running && run && <button className="btn ghost" onClick={() => setConfirmReset(true)}>{x.reset}</button>}
      </div>
    </div>

    {run && <div className="at2-status panel">
      <span className={`pill ${statusKey === 'error' ? 'bad' : running ? (statusKey === 'paused' ? 'warn' : 'ok') : 'muted'}`}><i />{x.status[statusKey] || statusKey}</span>
      {run.config.loopMode !== 'off' && <span className="pill muted"><i />{fill(x.cycle, { n: run.cycle })}{run.config.loopMode === 'count' ? ` / ${run.config.loopCount}` : ' / ∞'}</span>}
      <span className="at2-step">{stepText}</span>
      {run.nextAt && <span className="muted-text">{new Date(run.nextAt).toLocaleTimeString()}</span>}
    </div>}

    {run?.status === 'error' && <div className="panel at2-error"><b>{x.errorTitle}</b><span>{msgText(t, run.error?.code || 'at2.failed', { ...(run.error?.params || {}), error: run.error?.message }, run.error?.message)}</span><small>{x.errorHint}</small></div>}

    {!running && <ConfigPanel x={x} form={form} set={set} accounts={accounts} realMain={realMain} selected={selected} mainSelected={mainSelected} toggleAcc={toggleAcc} roles={roles} toggleRole={toggleRole} priceValid={priceValid} last={last} />}
    <div className="panel at2-how"><button className="link-btn" onClick={() => setShowHow(v => !v)}>{showHow ? '▾' : '▸'} {x.howTitle}</button>{showHow && <ol>{x.how.map((h, i) => <li key={i}>{h}</li>)}</ol>}</div>

    {run && <>
      <h3 className="section-title">{x.live}</h3>
      <div className="at2-top">
        {mainAcc && <AccountBoard acc={mainAcc} x={x} highlight playerIndex={playerIndex} />}
        {activeSide ? <AccountBoard acc={activeSide} x={x} highlight playerIndex={playerIndex} /> : <div className="panel at2-board at2-empty">{x.accStatus.waiting}</div>}
      </div>
      {others.length > 0 && <div className="at2-grid">{others.map(a => <AccountBoard key={a.id} acc={a} x={x} playerIndex={playerIndex} />)}</div>}
      <Summary run={run} x={x} />
      <CardCounts run={run} totals={at.cardTotals || {}} x={x} Modal={Modal} toast={toast} />
      <ListingPanel run={run} x={x} defaults={at.listDefaults} toast={toast} playerIndex={playerIndex} />
    </>}

    {pre && <Modal title={x.preTitle} onClose={() => setPre(null)} width={1040}>
      {pre.loading ? <p>{x.checking}</p> : <Preflight pre={pre} x={x} decisions={decisions} setDecisions={setDecisions} onCancel={() => setPre(null)} onStart={startNow} playerIndex={playerIndex} />}
    </Modal>}
    {run?.status === 'awaitingListing' && run.listingRequest && <ListingModal req={run.listingRequest} x={x} Modal={Modal} playerIndex={playerIndex} />}
    {confirmReset && <Modal title={x.reset} onClose={() => setConfirmReset(false)}><p>{x.resetConfirm}</p><div className="modal-actions"><button className="btn ghost" onClick={() => setConfirmReset(false)}>{x.cancel}</button><button className="btn danger-soft" onClick={() => run_(async () => { await api.autoTrade.reset(); setConfirmReset(false); await refresh(); })}>{x.yes}</button></div></Modal>}
  </div>;
}

function ConfigPanel({ x, form, set, accounts, realMain, selected, mainSelected, toggleAcc, roles, toggleRole, priceValid, last }) {
  const [showPass, setShowPass] = useState(false);
  const all = accounts.length > 0 && accounts.every(a => form.accountIds.includes(a.id));
  return <div className="panel at2-config">
    <section><h4>{x.accounts}</h4>
      <div className="at2-chips">
        <label className="at2-chip"><input type="checkbox" checked={all} onChange={() => set({ accountIds: all ? [] : accounts.map(a => a.id) })} />{x.selectAll}</label>
        {accounts.map(a => <label key={a.id} className={`at2-chip ${form.accountIds.includes(a.id) ? 'on' : ''}`}><input type="checkbox" checked={form.accountIds.includes(a.id)} onChange={() => toggleAcc(a.id)} />{a.name}{a.id === realMain && <span className="main-dot">{x.mainBadge}</span>}</label>)}
      </div>
      {!mainSelected && selected.length > 0 && <div className="at2-acting"><label><span>{x.actingMain}</span><select value={form.actingMainId} onChange={e => set({ actingMainId: e.target.value })}><option value="">—</option>{selected.map(id => <option key={id} value={id}>{accounts.find(a => a.id === id)?.name}</option>)}</select></label><small>{x.actingMainHint}</small></div>}
    </section>
    <section><h4>{x.routing}</h4>
      <div className="at2-route"><b>{x.sideToMain}</b><div className="at2-chips">{roles.map(r => <label key={r.id} className={`at2-chip ${form.sideToMainRoleIds.includes(r.id) ? 'on' : ''}`}><input type="checkbox" checked={form.sideToMainRoleIds.includes(r.id)} onChange={() => toggleRole('sideToMainRoleIds', r.id)} /><i className="role-dot" style={{ background: r.color }} />{r.name}</label>)}</div><small>{x.sideToMainNote}</small></div>
      <div className="at2-route"><b>{x.mainToSide}</b><div className="at2-chips">{roles.map(r => <label key={r.id} className={`at2-chip ${form.mainToSideRoleIds.includes(r.id) ? 'on' : ''}`}><input type="checkbox" checked={form.mainToSideRoleIds.includes(r.id)} onChange={() => toggleRole('mainToSideRoleIds', r.id)} /><i className="role-dot" style={{ background: r.color }} />{r.name}</label>)}</div><small>{x.mainToSideNote}</small></div>
    </section>
    <section className="at2-row">
      <label><span>{x.maxPrice}</span><input type="number" min="0" max="2500" step="1" value={form.maxPrice} className={priceValid ? '' : 'invalid'} onChange={e => set({ maxPrice: e.target.value.replace(/[^\d]/g, '') })} /><small>{x.maxPriceHint}</small></label>
      <label><span>{x.roomDesc}</span><input maxLength="50" value={form.roomDescription} onChange={e => set({ roomDescription: e.target.value })} /></label>
      <label><span>{x.roomPass}{last.hasPassword && <em className="at2-saved"> · {x.roomPassSaved}</em>}</span><span className="at2-pass"><input type={showPass ? 'text' : 'password'} autoComplete="off" value={form.roomPassword} onChange={e => set({ roomPassword: e.target.value })} /><button type="button" className="btn ghost small" title={showPass ? x.hidePass : x.showPass} onClick={() => setShowPass(v => !v)}>{showPass ? '🙈' : '👁'}</button></span></label>
    </section>
    <section className="at2-row">
      <label><span>{x.loop}</span><select value={form.loopMode} onChange={e => set({ loopMode: e.target.value })}><option value="off">{x.loopOff}</option><option value="count">{x.loopCount}</option><option value="infinite">{x.loopInfinite}</option></select></label>
      {form.loopMode === 'count' && <label><span>{x.loopTimes}</span><input type="number" min="1" max="999" value={form.loopCount} onChange={e => set({ loopCount: e.target.value.replace(/[^\d]/g, '') })} /></label>}
      <small className="at2-loop-hint">{x.loopHint}</small>
    </section>
    <section className="at2-options">
      <label className="at2-check"><input type="checkbox" checked={form.baseAsSellable} onChange={e => set({ baseAsSellable: e.target.checked })} /><span>{x.baseAsSellable}</span><small>{x.baseAsSellableHint}</small></label>
      <label className={`at2-check at2-sub ${form.baseAsSellable ? '' : 'off'}`}><input type="checkbox" disabled={!form.baseAsSellable} checked={form.baseProjected} onChange={e => set({ baseProjected: e.target.checked })} /><span>{x.baseProjected}</span><small>{x.baseProjectedHint}</small></label>
    </section>
  </div>;
}

function Preflight({ pre, x, decisions, setDecisions, onCancel, onStart, playerIndex }) {
  const withBench = pre.accounts.filter(a => a.bench.length);
  const setD = (aid, pid, patch) => setDecisions(d => ({ ...d, [aid]: { ...d[aid], [pid]: { ...d[aid][pid], ...patch } } }));
  return <div className="at2-pre">
    {pre.conflicts.length > 0 && <div className="at2-conflicts"><b>{x.conflictsTitle}</b><ul>{pre.conflicts.map((c, i) => <li key={i}>{x.conflict[c.kind] || c.kind}{c.name ? ` · ${c.name}` : ''}{c.accounts ? ` · ${c.accounts.join(', ')}` : ''}{c.startAt ? ` · ${new Date(c.startAt).toLocaleString()}` : ''}</li>)}</ul></div>}
    {withBench.length ? <><b>{x.benchTitle}</b><small className="muted-text">{x.benchHint}</small>
      {withBench.map(a => <div key={a.id} className="at2-bench"><h5>{a.name} · {num(a.funds)} TK</h5>
        <SortTable className="at2-bench-table"><colgroup><col className="c-name" /><col className="c-num" /><col className="c-num" /><col className="c-num" /><col className="c-role" /><col className="c-dir" /><col className="c-act" /></colgroup><tbody>{a.bench.map(p => {
          const d = decisions[a.id]?.[p.id] || { action: 'none' };
          return <tr key={p.id}><td><b>{p.name}</b> <span className="muted-text">{p.position} · {p.rating}</span>{isAtBase(moneyOf(p, playerIndex)) && <span className="base-badge">BASE</span>}</td><Money r={p} playerIndex={playerIndex} x={x} /><td>{p.roles.join(', ') || '—'}</td>
            <td>{p.block ? <span className="pill muted"><i />{x.blocked[p.block]}</span> : <span className={`muted-text ${p.dir ? '' : 'bad-text'}`}>{p.dir === 'main' ? x.fitsMain : p.dir === 'side' ? x.fitsSide : x.fitsNone}</span>}</td>
            <td>{p.block ? null : <div className="at2-actions">
              {[['list', x.actList], ['trade', x.actTrade], ['none', x.actNone]].map(([k, label]) => <label key={k}><input type="radio" name={`${a.id}-${p.id}`} checked={d.action === k} disabled={k === 'trade' && !p.dir} onChange={() => setD(a.id, p.id, { action: k })} />{label}</label>)}
              {d.action === 'list' && <span className="at2-price"><input type="number" min="1" value={d.price} onChange={e => setD(a.id, p.id, { price: e.target.value })} /><select value={d.currency} onChange={e => setD(a.id, p.id, { currency: e.target.value })}><option>APK</option><option>TIX</option></select></span>}
            </div>}</td></tr>;
        })}</tbody></SortTable></div>)}</> : <p className="muted-text">{x.noBench}</p>}
    <div className="modal-actions">
      <button className="btn ghost" onClick={onCancel}>{x.cancel}</button>
      {pre.conflicts.length ? <button className="btn danger-soft" onClick={() => onStart(true)}>{x.stopAndStart}</button> : <button className="btn primary" onClick={() => onStart(false)}>{x.startNow}</button>}
    </div>
  </div>;
}

function AccountBoard({ acc, x, highlight, playerIndex }) {
  const rows = Object.values(acc.players || {});
  return <div className={`panel at2-board ${highlight ? 'hl' : ''} st-${acc.status}`}>
    <div className="at2-board-head">
      <div><b>{acc.name}</b> <span className={`at2-role ${acc.role}`}>{acc.role === 'main' ? 'MAIN' : 'SIDE'}</span></div>
      <span className={`pill ${acc.status === 'active' ? 'ok' : acc.status === 'skipped' ? 'bad' : 'muted'}`}><i />{x.accStatus[acc.status] || acc.status}</span>
    </div>
    <div className="at2-board-meta"><span>{x.tk}: <b>{num(acc.funds)}</b></span><span>{x.openTime}: <b>{dur(acc.openSeconds)}</b></span><span>{x.visits}: <b>{acc.visits}</b></span>{acc.scout?.attemptsLeft != null && <span>Call back: <b>{acc.scout.attemptsLeft}</b></span>}</div>
    {rows.length ? <div className="at2-table"><SortTable><thead><tr><th>{x.player}</th><th>{x.price}</th><th>{x.salary}</th><th>{x.base}</th><th>{x.role}</th><th>{x.stateCol}</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td><b>{r.name}</b>{isAtBase(moneyOf(r, playerIndex)) && <span className="base-badge">BASE</span>}{r.from && <span className="muted-text"> · {x.from}: {r.from}</span>}</td><Money r={r} playerIndex={playerIndex} x={x} /><td>{r.roles?.join(', ') || (r.dir === 'main' ? '≤ ' + x.price : '—')}</td><td><span className={`pill ${STATUS_TONE[r.status] || 'muted'}`}><i />{x.pstatus[r.status] || r.status}</span></td></tr>)}</tbody></SortTable></div>
      : <p className="muted-text at2-noplayers">{x.noPlayers}</p>}
  </div>;
}

function Summary({ run, x }) {
  const rows = run.config.accountIds.map(id => run.accounts[id]).filter(Boolean);
  return <><h3 className="section-title">{x.summary}</h3>
    <div className="panel table-panel"><SortTable><thead><tr><th></th><th>{x.bought}</th><th>{x.spent}</th><th>{x.converted}</th><th>{x.tradedOut}</th><th>{x.tradedIn}</th><th>{x.tkPaid}</th><th>{x.tkReceived}</th><th>{x.listed}</th><th>{x.tkNow}</th><th>{x.openTime}</th></tr></thead>
      <tbody>{rows.map(a => <tr key={a.id}><td><b>{a.name}</b> <span className={`at2-role ${a.role}`}>{a.role === 'main' ? 'MAIN' : 'SIDE'}</span></td><td>{a.bought}</td><td>{num(a.spent)}</td><td>{a.converted}</td><td>{a.tradesOut}</td><td>{a.tradesIn}</td><td>{num(a.tkPaid)}</td><td>{num(a.tkReceived)}</td><td>{a.listed}</td><td>{num(a.fundsStart)} → <b>{num(a.funds)}</b></td><td>{dur(a.openSeconds)}</td></tr>)}</tbody></SortTable></div></>;
}

function CardCounts({ run, totals, x, Modal, toast }) {
  const [confirm, setConfirm] = useState(false);
  const ids = [...new Set([...Object.keys(run.cardCounts || {}), ...Object.keys(totals)])];
  if (!ids.length) return null;
  const reset = async () => { try { await api.autoTrade.resetCards(); } catch (e) { toast(e.message, 'error'); } setConfirm(false); };
  const rows = ids.map(id => ({ id, name: run.cardCounts?.[id]?.name || totals[id]?.name, now: run.cardCounts?.[id]?.count || 0, total: totals[id]?.count || 0 })).sort((a, b) => b.now - a.now || b.total - a.total);
  return <><div className="at2-section-head"><h3 className="section-title">{x.cards}</h3><button className="btn ghost small" onClick={() => setConfirm(true)}>{x.resetCards}</button></div>
    {/* Spreadsheet-like cells as wide as the longest name: "name" on top, "this run/total" small at the bottom left. */}
    <div className="panel at2-cells" style={{ '--cell': `${Math.max(10, ...rows.map(r => String(r.name || '').length)) + 3}ch` }}>
      <div className="at2-cells-legend"><b>3/8</b> = {x.thisRun} / {x.total}</div>
      <div className="at2-cells-grid">{rows.map(r => <div key={r.id} className={`at2-cell ${r.now ? 'now' : ''}`} title={`${r.name} · ${x.thisRun} ${r.now} · ${x.total} ${r.total}`}><span>{r.name}</span><b>{r.now}/{r.total}</b></div>)}</div>
    </div>
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
  return { salary: r.salary ?? null, value: r.value ?? r.price ?? p?.value ?? null, base: r.base ?? p?.base ?? null };
}
// Price · salary · Base cells (price = Scout price, salary = what was actually signed).
function Money({ r, playerIndex }) {
  const m = moneyOf(r, playerIndex);
  return <><td>{num(m.value)}</td><td><b>{num(m.salary)}</b></td><td>{num(m.base)}</td></>;
}
// Same rule as Trading Hall's BASE badge: salary at or below Base.
const isAtBase = m => m.salary != null && m.base > 0 && Number(m.salary) <= Number(m.base);

function ListingPanel({ run, x, defaults, toast, playerIndex }) {
  const sides = run.config.accountIds.map(id => run.accounts[id]).filter(a => a && a.role === 'side' && a.status !== 'active');
  const items = sides.map(a => ({ acc: a, rows: Object.values(a.players || {}).filter(r => r.status === 'keep') })).filter(s => s.rows.length);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(null);
  if (!items.length) return null;
  const get = (r) => ({ checked: true, ...defaultListing(r, run, defaults), ...edits[r.id] });
  const edit = (id, patch) => setEdits(e => ({ ...e, [id]: { ...e[id], ...patch } }));
  const list = async (acc, rows) => {
    const chosen = rows.filter(r => get(r).checked).map(r => ({ id: r.id, price: Number(get(r).price), currency: get(r).currency }));
    if (!chosen.length) return;
    setBusy(acc.id);
    try { await api.autoTrade.listPlayers(acc.id, chosen); } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };
  return <><h3 className="section-title">{x.listTitle} <small>{x.listHint}</small></h3>
    {items.map(({ acc, rows }) => <div key={acc.id} className="panel table-panel at2-list"><div className="at2-list-head"><b>{acc.name}</b><button className="btn primary" disabled={busy === acc.id} onClick={() => list(acc, rows)}>{x.listSelected}</button></div>
      <SortTable><thead><tr><th></th><th>{x.player}</th><th>{x.salary}</th><th>{x.value}</th><th>{x.base}</th><th>{x.role}</th><th>{x.listPrice}</th><th></th></tr></thead><tbody>{rows.map(r => { const v = get(r); const m = moneyOf(r, playerIndex); return <tr key={r.id}><td><input type="checkbox" checked={v.checked} onChange={e => edit(r.id, { checked: e.target.checked })} /></td><td><b>{r.name}</b>{isAtBase(m) && <span className="base-badge">BASE</span>}</td><td>{num(m.salary)}</td><td>{num(m.value)}</td><td>{num(m.base)}</td><td>{r.roles?.join(', ')}</td><td><input className="eq-small" type="number" min="1" value={v.price} onChange={e => edit(r.id, { price: e.target.value })} /></td><td><select value={v.currency} onChange={e => edit(r.id, { currency: e.target.value })}><option>APK</option><option>TIX</option></select></td></tr>; })}</tbody></SortTable></div>)}</>;
}

function ListingModal({ req, x, Modal, playerIndex }) {
  const [rows, setRows] = useState(() => req.players.map(p => ({ ...p, checked: true })));
  const edit = (i, patch) => setRows(r => r.map((x, j) => j === i ? { ...x, ...patch } : x));
  const send = items => api.autoTrade.respondListing(items);
  return <Modal title={fill(x.listingModal, { name: req.name })} onClose={() => {}} width={720}>
    <p className="muted-text">{x.listingModalHint}</p>
    <SortTable className="at2-modal-table"><thead><tr><th></th><th>{x.player}</th><th>{x.salary}</th><th>{x.value}</th><th>{x.base}</th><th>{x.role}</th><th>{x.listPrice}</th><th></th></tr></thead><tbody>{rows.map((r, i) => { const m = moneyOf(r, playerIndex); return <tr key={r.id}><td><input type="checkbox" checked={r.checked} onChange={e => edit(i, { checked: e.target.checked })} /></td><td><b>{r.name}</b>{isAtBase(m) && <span className="base-badge">BASE</span>}</td><td>{num(m.salary)}</td><td>{num(m.value)}</td><td>{num(m.base)}</td><td>{(r.roles || []).join(', ')}</td><td><input className="eq-small" type="number" min="1" value={r.price} onChange={e => edit(i, { price: e.target.value })} /></td><td><select value={r.currency} onChange={e => edit(i, { currency: e.target.value })}><option>APK</option><option>TIX</option></select></td></tr>; })}</tbody></SortTable>
    <div className="modal-actions"><button className="btn ghost" onClick={() => send(null)}>{x.skipList}</button><button className="btn primary" onClick={() => send(rows.filter(r => r.checked).map(r => ({ id: r.id, price: Number(r.price), currency: r.currency })))}>{x.listAndGo}</button></div>
  </Modal>;
}
