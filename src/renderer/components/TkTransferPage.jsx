import { useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;
const TEXT = {
  tr: {
    title: 'TK Aktarımı', subtitle: 'Yan hesaplardaki TK\'yı pazar + trade ile ana hesaba taşır · TK harcanmaz, APK harcanır',
    setup: 'Ayarlar', main: 'Ana hesap', sides: 'Yan hesaplar', selectAll: 'Tümünü seç', clear: 'Seçimi temizle',
    minSalary: 'Minimum oyuncu salary', maxApk: 'Maksimum APK (oyuncu başı)', target: 'Aktarılacak TK',
    minSalaryHint: '0–2500', maxApkHint: 'en az 20', targetHint: 'bu değer geçilince durur',
    start: 'Başlat', stop: 'Durdur', save: 'Kaydet',
    errMain: 'Ana hesabı seç.', errSides: 'En az bir yan hesap seç.', errSalary: 'Salary 0 ile 2500 arasında tam sayı olmalı.', errApk: 'APK en az 20 olmalı (tam sayı).', errTarget: 'Aktarılacak TK\'yı gir.',
    live: 'Canlı durum', last: 'Son çalıştırma', none: 'Henüz TK aktarımı yapılmadı.',
    transferred: 'Aktarılan TK', apkSpent: 'Harcanan APK', rounds: 'Tur',
    account: 'Hesap', role: 'Rol', roleMain: 'Ana', roleSide: 'Yan', tk: 'TK', apk: 'APK', bought: 'Alınan', relisted: 'Tekrar listelenen', tkMoved: 'Aktardığı TK', status: 'Durum',
    st: { queued: 'Sırada', login: 'Bağlanıyor', ready: 'Hazır', buying: 'Satın alınıyor', trading: 'Trade', listing: 'Pazara koyuluyor', idle: 'Uygun ilan yok', error: 'Hata' },
    note: { noListings: 'uygun ilan yok', noTk: 'TK yetmiyor', roomFull: 'kadroda yer yok' },
    step: { starting: 'Başlıyor', order: 'Hesaplar TK\'ya göre sıralanıyor', reading: '{side} ilanları okunuyor', buying: '{side} · {name} alınıyor ({n}/{of})', trading: '{side} ile trade · {n} oyuncu', listing: '{side} · {name} pazara koyuluyor' },
    reason: { target: 'Hedef aşıldı', apk: 'APK bitti', noListings: 'Uygun ilan kalmadı', stopped: 'Durduruldu', limit: 'Durduruldu', error: 'Hata' },
    players: 'Oyuncular', noPlayers: 'Henüz uygun oyuncu bulunmadı.', round: 'Tur', player: 'Oyuncu', side: 'Yan hesap', salary: 'Salary', price: 'Fiyat',
    item: { toBuy: 'Satın alınacak', buying: 'Satın alınıyor', bought: 'Satın alındı', trading: 'Takasa veriliyor', traded: 'Takasla verildi', listing: 'Listeleniyor', relisted: 'Tekrar listelendi', buyFailed: 'Alınamadı', tradeFailed: 'Takas başarısız', relistFailed: 'Listelenemedi', skipped: 'APK yetmedi' },
    how: 'Nasıl çalışır?',
    howLines: [
      'Ana hesap, seçili yan hesapların pazarda APK ile listelediği oyuncuları alır: fiyatı en fazla "Maksimum APK", salary\'si en az "Minimum oyuncu salary" olanlar. Ana hesapta zaten olan oyuncu ve aynı oyuncudan ikinci kopya alınmaz. İlk ilanları sen açarsın; sistem ilan açmaz.',
      'Bir yan hesaptan bir seferde en fazla 5 oyuncu alınır (yer, APK ve yan hesabın TK\'sı yettiği kadar). Sonra yan hesap trade odası açar, ana hesap oyuncuları geri verir; yan hesap oyuncuların salary toplamı kadar TK öder.',
      'Trade\'den sonra yan hesap aynı oyuncuları aynı APK fiyatıyla tekrar pazara koyar, satışın APK\'sı toplanır. Böylece ana hesap aynı oyuncuları tekrar alabilir.',
      'Yan hesaplar en yüksek TK\'lıdan başlar; her turdan sonra sıra yeniden hesaplanır. Aktarılan TK hedefi geçince, ana hesabın APK\'sı bitince ya da uygun ilan kalmayınca durur.',
      'Hesaplara giriş yapılır (oyunda açıksa oradan çıkış yapılır). Bu hesaplardaki Auto Play durdurulur, bitince yeniden başlatılır.'
    ]
  },
  en: {
    title: 'TK Transfer', subtitle: 'Moves TK from side accounts to the main account with market + trade · no TK spent, APK is spent',
    setup: 'Settings', main: 'Main account', sides: 'Side accounts', selectAll: 'Select all', clear: 'Clear selection',
    minSalary: 'Minimum player salary', maxApk: 'Maximum APK (per player)', target: 'TK to transfer',
    minSalaryHint: '0–2500', maxApkHint: 'at least 20', targetHint: 'stops once this is passed',
    start: 'Start', stop: 'Stop', save: 'Save',
    errMain: 'Choose the main account.', errSides: 'Choose at least one side account.', errSalary: 'Salary must be a whole number from 0 to 2500.', errApk: 'APK must be at least 20 (whole number).', errTarget: 'Enter the TK to transfer.',
    live: 'Live status', last: 'Last run', none: 'No TK transfer yet.',
    transferred: 'TK transferred', apkSpent: 'APK spent', rounds: 'Rounds',
    account: 'Account', role: 'Role', roleMain: 'Main', roleSide: 'Side', tk: 'TK', apk: 'APK', bought: 'Bought', relisted: 'Listed again', tkMoved: 'TK moved', status: 'Status',
    st: { queued: 'Queued', login: 'Connecting', ready: 'Ready', buying: 'Buying', trading: 'Trading', listing: 'Listing', idle: 'No usable listing', error: 'Error' },
    note: { noListings: 'no usable listing', noTk: 'not enough TK', roomFull: 'no roster room' },
    step: { starting: 'Starting', order: 'Sorting the accounts by TK', reading: 'Reading the listings of {side}', buying: '{side} · buying {name} ({n}/{of})', trading: 'Trade with {side} · {n} player(s)', listing: '{side} · listing {name}' },
    reason: { target: 'Target passed', apk: 'APK ran out', noListings: 'No usable listing left', stopped: 'Stopped', limit: 'Stopped', error: 'Error' },
    players: 'Players', noPlayers: 'No usable player found yet.', round: 'Round', player: 'Player', side: 'Side account', salary: 'Salary', price: 'Price',
    item: { toBuy: 'To buy', buying: 'Buying', bought: 'Bought', trading: 'Being traded', traded: 'Traded back', listing: 'Listing', relisted: 'Listed again', buyFailed: 'Not bought', tradeFailed: 'Trade failed', relistFailed: 'Not listed', skipped: 'Not enough APK' },
    how: 'How does it work?',
    howLines: [
      'The main account buys the players the selected side accounts list on the market for APK: price at most "Maximum APK", salary at least "Minimum player salary". A player main already owns and a second copy of one player are never bought. You open the first listings; the system does not.',
      'At most 5 players are bought from one side at a time (as far as roster room, APK and the side\'s TK allow). Then the side opens a trade room and main gives the players back; the side pays their salary sum in TK.',
      'After the trade the side lists the same players again at the same APK price and the APK of the sale is claimed, so main can buy them again.',
      'Sides go from the highest TK down; the order is recomputed after every round. It stops when the transferred TK passes the target, when main runs out of APK or when no usable listing is left.',
      'The accounts are signed in (an open game tab of them is signed out). Auto Play on these accounts is stopped and started again afterwards.'
    ]
  },
  get fil() { return filOf(this.en); }
};
const ITEM_TONE = { toBuy: 'muted', buying: 'info', bought: 'info', trading: 'warn', traded: 'ok', listing: 'warn', relisted: 'ok', buyFailed: 'bad', tradeFailed: 'bad', relistFailed: 'bad', skipped: 'muted' };
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v).toLocaleString('tr-TR') : '—');
const isInt = v => String(v).trim() !== '' && Number.isInteger(Number(v));

export default function TkTransferPage({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const tk = state.tkTransfer || {};
  const accounts = state.accounts || [];
  const prof = state.accountProfile || {};
  const saved = tk.config || {};
  const [mainId, setMainId] = useState(saved.mainId || prof.mainAccountId || '');
  const [sideIds, setSideIds] = useState(() => (saved.sideIds || []).filter(id => accounts.some(a => a.id === id)));
  const [minSalary, setMinSalary] = useState(String(saved.minSalary ?? 0));
  const [maxApk, setMaxApk] = useState(String(saved.maxApk ?? 20));
  const [targetTk, setTargetTk] = useState(String(saved.targetTk ?? 50000));
  const running = Boolean(tk.running);
  const stat = id => prof.accounts?.[id] || {};
  const sides = accounts.filter(a => a.id !== mainId).sort((a, b) => (Number(stat(b.id).tk) || 0) - (Number(stat(a.id).tk) || 0));
  const chosen = sideIds.filter(id => id !== mainId && accounts.some(a => a.id === id));
  const allOn = sides.length > 0 && sides.every(a => chosen.includes(a.id));
  const errors = [
    !mainId && x.errMain,
    !chosen.length && x.errSides,
    !(isInt(minSalary) && Number(minSalary) >= 0 && Number(minSalary) <= 2500) && x.errSalary,
    !(isInt(maxApk) && Number(maxApk) >= 20) && x.errApk,
    !(isInt(targetTk) && Number(targetTk) >= 1) && x.errTarget
  ].filter(Boolean);
  const config = () => ({ mainId, sideIds: chosen, minSalary: Number(minSalary), maxApk: Number(maxApk), targetTk: Number(targetTk) });
  const start = async () => { try { await api.tk.start(config()); } catch (e) { toast(e.message, 'error'); } };
  const run = tk.run;
  const report = !running && tk.lastReport;
  const shown = running ? run : report;
  const rows = shown ? Object.values(shown.accounts || {}) : [];
  const pct = shown ? Math.min(100, Math.round(((shown.transferred || 0) / Math.max(1, shown.config?.targetTk || 1)) * 100)) : 0;

  return <div className="page tk-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar">{running
        ? <button className="btn danger-soft" onClick={() => api.tk.stop().catch(e => toast(e.message, 'error'))}>{x.stop}</button>
        : <button className="btn primary" disabled={errors.length > 0} onClick={start}>{x.start}</button>}</div>
    </div>

    <div className="panel tk-setup">
      <div className="tk-fields">
        <label><span>{x.main}</span><select disabled={running} value={mainId} onChange={e => { setMainId(e.target.value); setSideIds(sideIds.filter(id => id !== e.target.value)); }}><option value="">—</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label><span>{x.minSalary}</span><input type="number" min="0" max="2500" step="1" disabled={running} value={minSalary} onChange={e => setMinSalary(e.target.value)} /><small>{x.minSalaryHint}</small></label>
        <label><span>{x.maxApk}</span><input type="number" min="20" step="1" disabled={running} value={maxApk} onChange={e => setMaxApk(e.target.value)} /><small>{x.maxApkHint}</small></label>
        <label><span>{x.target}</span><input type="number" min="1" step="1" disabled={running} value={targetTk} onChange={e => setTargetTk(e.target.value)} /><small>{x.targetHint}</small></label>
      </div>
      <div className="tk-sides-head"><b>{x.sides}</b><span className="muted">{chosen.length}/{sides.length}</span><span className="sp" /><button className="btn ghost small" disabled={running} onClick={() => setSideIds(allOn ? [] : sides.map(a => a.id))}>{allOn ? x.clear : x.selectAll}</button></div>
      <div className="tk-sides">{sides.map(a => <label key={a.id} className={chosen.includes(a.id) ? 'on' : ''}>
        <input type="checkbox" disabled={running} checked={chosen.includes(a.id)} onChange={() => setSideIds(chosen.includes(a.id) ? chosen.filter(v => v !== a.id) : [...chosen, a.id])} />
        <b>{a.name}</b><span className="num">{x.tk} {num(stat(a.id).tk)}</span><span className="num muted">{x.apk} {num(stat(a.id).apk)}</span>
      </label>)}</div>
      {errors.length > 0 && !running && <div className="tk-errors">{errors.map(e => <span key={e}>{e}</span>)}</div>}
    </div>

    <div className="panel tk-live">
      <div className="tk-live-head"><b>{running ? x.live : x.last}</b>
        {shown && <span className="muted">{running ? fill(x.step[run.step] || '', run.stepParams || {}) : `${x.reason[report.reason] || report.reason}${report.error ? `: ${report.error}` : ''} · ${new Date(report.finishedAt).toLocaleString()}`}</span>}
      </div>
      {!shown ? <div className="empty">{x.none}</div> : <>
        <div className="tk-stats">
          <div><span>{x.transferred}</span><b className="num">{num(shown.transferred)} / {num(shown.config?.targetTk)}</b><i className="tk-bar"><em style={{ width: `${pct}%` }} /></i></div>
          <div><span>{x.apkSpent}</span><b className="num">{num(shown.apkSpent)}</b></div>
          <div><span>{x.rounds}</span><b className="num">{num(shown.rounds)}</b></div>
        </div>
        <SortTable><thead><tr><th>{x.account}</th><th>{x.role}</th><th>{x.tk}</th><th>{x.apk}</th><th>{x.bought}</th><th>{x.apkSpent}</th><th>{x.tkMoved}</th><th>{x.relisted}</th><th>{x.status}</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.accountId} className={['buying', 'trading', 'listing'].includes(r.status) ? 'dp-live' : ''}>
            <td><b>{r.name}</b></td><td>{r.main ? x.roleMain : x.roleSide}</td>
            <td className="num">{num(r.funds)}</td><td className="num">{num(r.apk)}</td>
            <td className="num">{r.bought || '—'}</td><td className="num">{r.apkSpent || '—'}</td>
            <td className="num good-text">{r.main ? '' : (r.tk ? `+${num(r.tk)}` : '—')}</td><td className="num">{r.main ? '' : (r.relisted || '—')}</td>
            <td className={r.status === 'error' ? 'bad-text' : ''}>{x.st[r.status] || r.status}{r.note && x.note[r.note] ? ` · ${x.note[r.note]}` : r.note && r.status === 'error' ? `: ${r.note}` : ''}</td>
          </tr>)}</tbody></SortTable>
        <div className="tk-sub">{x.players}</div>
        {!(shown.items || []).length ? <div className="empty">{x.noPlayers}</div> :
          <SortTable><thead><tr><th>{x.round}</th><th>{x.side}</th><th>{x.player}</th><th>{x.salary}</th><th>{x.price}</th><th>{x.status}</th></tr></thead>
            <tbody>{shown.items.map((p, i) => <tr key={i} className={['buying', 'trading', 'listing'].includes(p.status) ? 'dp-live' : ''}>
              <td className="num">{p.round}</td><td>{p.side}</td><td><b>{p.name}</b></td><td className="num">{num(p.salary)}</td><td className="num">{p.price} APK</td>
              <td><span className={`tk-badge ${ITEM_TONE[p.status] || ''}`} title={p.error || ''}>{x.item[p.status] || p.status}</span>{p.error && <small className="cell-sub bad-text">{p.error}</small>}</td>
            </tr>)}</tbody></SortTable>}
      </>}
    </div>
    <details className="panel pvp-how"><summary>{x.how}</summary><ul>{x.howLines.map(l => <li key={l}>{l}</li>)}</ul></details>
  </div>;
}
