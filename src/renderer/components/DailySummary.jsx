import { useEffect, useRef, useState } from 'react';
import SortTable from './SortTable';
import { useGroupedRows, groupRowOf } from './AccountGroups';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;
const num = v => Number(v || 0).toLocaleString();
const TEXT = {
  tr: {
    title: 'Günlük Özet', hint: 'Aktivite kayıtlarından hesaplanır · bugün dakikada bir yenilenir', refresh: 'Yenile', none: 'Bu gün için kayıt yok.', loading: 'Hesaplanıyor…',
    accountsN: '{n} hesap', hideZero: 'Sıfır olanları gizle',
    sec: { matches: 'Maçlar', market: 'Pazar', trade: 'Alım / Auto Trade / Aktarım', draft: 'Draft', cards: 'Kartlar', equipment: 'Ekipman', daily: 'Günlük işler', accounts: 'Hesaplar ve uygulama' },
    quickPlay: 'Auto Play maçı', pvp: 'PVP maçı', tower: 'Kule (kazanılan / kaybedilen)', goUp: 'Go-up maçı', boss: 'Daily Boss (oynanan / kazanılan)', ascent: 'Elite Ascent (oynanan / kazanılan)', pro: 'Professional (oynanan / kazanılan)', tournamentRegistered: 'Turnuva kaydı', tournament: 'Turnuva maçı (kazanılan / kaybedilen)', rotationMatches: 'Rotasyon yapılan maç', rotationSubs: 'Rotasyon oyuncu değişikliği',
    sales: 'Toplanan satış', listed: 'Pazara eklenen oyuncu', relisted: 'Tekrar listelenen', removed: 'Pazardan kaldırılan', fired: 'Kovulan oyuncu', marketScans: 'Pazar taraması (hesap)', hallScans: 'Trading Hall taraması',
    bought: 'Satın alınan (Auto Buy / Trading Hall)', hunterBought: 'Scout Avcısı alımı', atSigned: 'Auto Trade imzalanan', atConverted: 'Karta çevrilen (Auto Trade)', boughtConverted: 'Karta çevrilen (alınanlar)', atTrades: 'Takas', tkRounds: 'TK aktarım turu', apkTransfers: 'APK aktarımı', friendsAdded: 'Eklenen arkadaş',
    draftRooms: 'Girilen draft odası', draftPicks: 'Draft seçimi', autoDraftPools: 'Oto Draft havuzundaki oyuncu', draftCarded: 'Draft oyuncusu karta çevrildi', draftToMain: 'Draft oyuncusu aktarıldı',
    synth: 'Sentez (başarılı / başarısız)', big3: 'Big 3 maçı', skillShuffles: 'Yetenek karıştırma', skillsLearned: 'Öğrenilen yetenek', cardsOpened: 'Açılan kart',
    eqCrafted: 'Üretilen ekipman', eqEnhance: 'Güçlendirme (başarılı / başarısız)', eqConverted: 'Dönüştürme', eqDismantled: 'Parçalanan ekipman', eqSets: 'Tamamlanan set',
    quiz: 'Daily Quiz biten', dailyReward: 'Daily Reward toplanan', dailyRewardDone: 'Daily Reward tamamlanan (6/6)', dailySlot: 'Daily Slot çevrilen', signIn: 'Günlük giriş ödülü', friendly: 'Friendly Match', groupMatch: 'Group Match', taskRewards: 'Görev ödülü', donated: 'İttifak bağışı', stadiumLevels: 'Stadyum seviye atlaması',
    accountsCreated: 'Oluşturulan hesap', injuries: 'Sakatlık (engellenen / çözülen)', friendRequests: 'Gelen arkadaşlık isteği', messages: 'Yeni mesaj', chatSent: 'Gönderilen sohbet mesajı', gameOutages: 'Oyun bağlantı kesintisi', problems: 'Hata / uyarı',
    perAccount: 'Hesap başına', account: 'Hesap', colQuiz: 'Quiz', colReward: 'Daily Reward', colDraft: 'Draft', colListed: 'Pazara eklenen', colBought: 'Alınan', colSales: 'Satış', colGoUp: 'Go-up', colTower: 'Kule', colPvp: 'PVP', colQp: 'Auto Play'
  },
  en: {
    title: 'Daily Summary', hint: 'calculated from the Activity logs · today refreshes once a minute', refresh: 'Refresh', none: 'No entries for this day.', loading: 'Calculating…',
    accountsN: '{n} account(s)', hideZero: 'Hide zeros',
    sec: { matches: 'Matches', market: 'Market', trade: 'Buying / Auto Trade / Transfers', draft: 'Draft', cards: 'Cards', equipment: 'Equipment', daily: 'Daily tasks', accounts: 'Accounts and app' },
    quickPlay: 'Auto Play matches', pvp: 'PVP matches', tower: 'Tower (won / lost)', goUp: 'Go-up matches', boss: 'Daily Boss (played / won)', ascent: 'Elite Ascent (played / won)', pro: 'Professional (played / won)', tournamentRegistered: 'Tournament registrations', tournament: 'Tournament matches (won / lost)', rotationMatches: 'Matches with rotation', rotationSubs: 'Rotation substitutions',
    sales: 'Sales claimed', listed: 'Players put on the market', relisted: 'Relisted', removed: 'Taken off the market', fired: 'Players fired', marketScans: 'Market scans (accounts)', hallScans: 'Trading Hall scans',
    bought: 'Bought (Auto Buy / Trading Hall)', hunterBought: 'Scout Hunter buys', atSigned: 'Auto Trade signings', atConverted: 'Made into cards (Auto Trade)', boughtConverted: 'Made into cards (bought)', atTrades: 'Trades', tkRounds: 'TK transfer rounds', apkTransfers: 'APK transfers', friendsAdded: 'Friends added',
    draftRooms: 'Draft rooms joined', draftPicks: 'Draft picks', autoDraftPools: 'Players in Auto Draft pools', draftCarded: 'Draft players made into cards', draftToMain: 'Draft players handed over',
    synth: 'Synthesis (ok / failed)', big3: 'Big 3 matches', skillShuffles: 'Skill shuffles', skillsLearned: 'Skills learned', cardsOpened: 'Cards opened',
    eqCrafted: 'Equipment crafted', eqEnhance: 'Enhancements (ok / failed)', eqConverted: 'Conversions', eqDismantled: 'Equipment dismantled', eqSets: 'Sets completed',
    quiz: 'Daily Quiz finished', dailyReward: 'Daily Reward tiers claimed', dailyRewardDone: 'Daily Reward completed (6/6)', dailySlot: 'Daily Slot spins', signIn: 'Daily sign-in rewards', friendly: 'Friendly Match', groupMatch: 'Group Match', taskRewards: 'Task rewards', donated: 'Alliance donations', stadiumLevels: 'Stadium level-ups',
    accountsCreated: 'Accounts created', injuries: 'Injuries (blocked / cleared)', friendRequests: 'Friend requests received', messages: 'New messages', chatSent: 'Chat messages sent', gameOutages: 'Game connection outages', problems: 'Errors / warnings',
    perAccount: 'Per account', account: 'Account', colQuiz: 'Quiz', colReward: 'Daily Reward', colDraft: 'Draft', colListed: 'Put on market', colBought: 'Bought', colSales: 'Sales', colGoUp: 'Go-up', colTower: 'Tower', colPvp: 'PVP', colQp: 'Auto Play'
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

// sections of tiles: [label key, stat key | [stat keys] (shown "a / b"), money?]
const SECTIONS = [
  ['matches', [['quickPlay', 'quickPlay'], ['pvp', 'pvp'], ['tower', ['towerWins', 'towerLosses']], ['goUp', 'goUp'], ['boss', ['bossPlayed', 'bossWon']], ['ascent', ['ascentPlayed', 'ascentWon']], ['pro', ['proPlayed', 'proWon']], ['tournamentRegistered', 'tournamentRegistered'], ['tournament', ['tournamentWon', 'tournamentLost']], ['rotationMatches', 'rotationMatches'], ['rotationSubs', 'rotationSubs']]],
  ['market', [['sales', 'sales', true], ['listed', 'listed'], ['relisted', 'relisted'], ['removed', 'removed'], ['fired', 'fired'], ['marketScans', 'marketScans'], ['hallScans', 'hallScans']]],
  ['trade', [['bought', 'bought', true], ['hunterBought', 'hunterBought', true], ['atSigned', 'atSigned'], ['atConverted', 'atConverted'], ['boughtConverted', 'boughtConverted'], ['atTrades', 'atTrades'], ['tkRounds', 'tkRounds'], ['apkTransfers', 'apkTransfers', true], ['friendsAdded', 'friendsAdded']]],
  ['draft', [['draftRooms', 'draftRooms'], ['draftPicks', 'draftPicks'], ['autoDraftPools', 'autoDraftPools'], ['draftCarded', 'draftCarded'], ['draftToMain', 'draftToMain']]],
  ['cards', [['synth', ['synthOk', 'synthFail']], ['big3', 'big3'], ['skillShuffles', 'skillShuffles'], ['skillsLearned', 'skillsLearned'], ['cardsOpened', 'cardsOpened']]],
  ['equipment', [['eqCrafted', 'eqCrafted'], ['eqEnhance', ['eqEnhanced', 'eqEnhanceFailed']], ['eqConverted', 'eqConverted'], ['eqDismantled', 'eqDismantled'], ['eqSets', 'eqSets']]],
  ['daily', [['quiz', 'quiz'], ['dailyReward', 'dailyReward'], ['dailyRewardDone', 'dailyRewardDone'], ['dailySlot', 'dailySlot'], ['signIn', 'signIn'], ['friendly', 'friendly'], ['groupMatch', 'groupMatch'], ['taskRewards', 'taskRewards'], ['donated', 'donated', 'amount'], ['stadiumLevels', 'stadiumLevels']]],
  ['accounts', [['accountsCreated', 'accountsCreated'], ['injuries', ['injuries', 'injuriesCleared']], ['friendRequests', 'friendRequests'], ['messages', 'messages'], ['chatSent', 'chatSent'], ['gameOutages', 'gameOutages']]]
];
const COLS = [['quickPlay', 'colQp'], ['pvp', 'colPvp'], ['towerWins', 'colTower'], ['goUp', 'colGoUp'], ['draftPicks', 'colDraft'], ['listed', 'colListed'], ['bought', 'colBought'], ['sales', 'colSales'], ['quiz', 'colQuiz'], ['dailyReward', 'colReward']];

function money(st) {
  const s = st?.sums || {};
  const parts = [];
  if (s.apk) parts.push(`${num(s.apk)} APK`);
  if (s.tix) parts.push(`${num(s.tix)} TIX`);
  return parts.join(' · ');
}

// One day of work of every system at a glance (default: today), any archived day selectable.
export default function DailySummary({ t }) {
  const x = TEXT[t.lang] || TEXT.en;
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hideZero, setHideZero] = useState(() => { try { return localStorage.getItem('ds-hide-zero') === '1'; } catch { return false; } });
  const grp = useGroupedRows('daily-summary');
  const picked = useRef(null); // an older day the user chose (today: null, refreshed every minute)
  const load = day => { picked.current = day || null; setBusy(true); return api.activityArchive?.summary(day).then(setData).catch(() => {}).finally(() => setBusy(false)); };
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden && !picked.current) load(); }, 60000);
    return () => clearInterval(id);
  }, []);
  const toggleZero = v => { setHideZero(v); try { localStorage.setItem('ds-hide-zero', v ? '1' : '0'); } catch {} };
  const s = data?.summary;
  const st = s?.stats || {};
  const tile = ([label, key, extra]) => {
    const keys = Array.isArray(key) ? key : [key];
    const vals = keys.map(k => st[k]?.n || 0);
    if (hideZero && vals.every(v => !v)) return null;
    const main = st[keys[0]];
    const sub = [];
    if (extra === true) { const m = money(main); if (m) sub.push(m); }
    else if (extra) { const v = main?.sums?.[extra]; if (v) sub.push(num(v)); }
    if (main?.accounts) sub.push(fill(x.accountsN, { n: num(main.accounts) }));
    return <div key={label} className={`ds-tile${vals.every(v => !v) ? ' zero' : ''}`}><span>{x[label]}</span><b>{vals.map(num).join(' / ')}</b>{sub.length > 0 && <small>{sub.join(' · ')}</small>}</div>;
  };
  const accounts = Object.entries(s?.perAccount || {}).map(([n, a]) => ({ ...a, id: n, name: n })); // the grouped table sorts by the account order
  return <div className="daily-summary-page">
    <div className="ds-head">
      <h1>{x.title}</h1><small className="muted-text">{x.hint}</small><span className="sp" />
      {(data?.days || []).length > 0 && <select value={data.day || ''} onChange={e => load(e.target.value === data.days[0] ? undefined : e.target.value)}>{data.days.map(d => <option key={d} value={d}>{d}</option>)}</select>}
      <label className="ds-zero"><input type="checkbox" checked={hideZero} onChange={e => toggleZero(e.target.checked)} /> {x.hideZero}</label>
      <button className="btn ghost small" disabled={busy} onClick={() => load(data?.day)}>{busy ? x.loading : x.refresh}</button>
    </div>
    {!data ? <p className="muted-text">{x.loading}</p> : !data.day || !s ? <p className="muted-text">{x.none}</p> : <>
      <div className="ds-problems"><span>{x.problems}</span><b className={s.errors ? 'bad-text' : ''}>{num(s.errors)}</b> / <b>{num(s.warnings)}</b></div>
      {SECTIONS.map(([sec, tiles]) => {
        const shown = tiles.map(tile).filter(Boolean);
        if (!shown.length) return null;
        return <section key={sec} className="panel daily-summary"><div className="ds-sec">{x.sec[sec]}</div><div className="ds-tiles">{shown}</div></section>;
      })}
      {accounts.length > 0 && <section className="panel daily-summary"><details className="ds-accounts"><summary>{x.perAccount} · {fill(x.accountsN, { n: num(accounts.length) })}</summary><SortTable><thead><tr><th>{x.account}</th>{COLS.map(([k, l]) => <th key={k}>{x[l]}</th>)}</tr></thead>
        <tbody>{grp(accounts, a => <tr key={a.id}><td><b>{a.name}</b></td>{COLS.map(([k]) => <td key={k} className="num">{a[k] ? num(a[k]) : ''}</td>)}</tr>, groupRowOf(COLS.length + 1, g => COLS.map(([k]) => <td key={k} className="num">{num(g.reduce((n, a) => n + (Number(a[k]) || 0), 0))}</td>)))}</tbody></SortTable></details></section>}
    </>}
  </div>;
}
