import { useEffect, useMemo, useState } from 'react';
import SortTable from './SortTable';
import InjuryMark from './InjuryMark';
import { GroupedPicks } from './AccountGroups';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;

const TEXT = {
  tr: {
    title: 'APK / TIX Aktarımı', subtitle: 'Seçili hesapların APK ve/veya TIX\'ini pazar üzerinden tek hesaba toplar',
    start: 'Aktarımı başlat', stop: 'Durdur',
    accounts: 'Kullanılacak hesaplar', selectAll: 'Tümünü seç', clear: 'Temizle',
    receiver: 'Aktarılacak hesap (main)', receiverHint: 'APK / TIX bu hesapta toplanır. Main seçili değilse seçtiklerinden birini seç.',
    mode: 'Ne aktarılsın', modeAPK: 'APK\'ları aktar', modeTIX: 'TIX\'leri aktar', modeboth: 'İkisini aktar',
    minApk: 'En az APK', minApkHint: 'Bundan az APK\'sı olan hesap uygun sayılmaz.', minTix: 'En az TIX', minTixHint: 'Bundan az TIX\'i olan hesap uygun sayılmaz.',
    maxTk: 'Oyuncu en çok (TK)', maxTkHint: 'Main\'in pazara koymak için alacağı oyuncuların en yüksek maaşı.',
    useSpenders: 'Scout yetmezse Harcayıcılardan takasla al',
    eligibleNow: 'Şu anki bakiyelere göre uygun: {n} / {of} hesap', eligibleNote: 'Kesin sayı, başta satışlar toplandıktan sonra belli olur.',
    errReceiver: 'Aktarılacak hesabı seç', errSides: 'Main dışında en az bir hesap seç', errNum: 'Sayıları kontrol et',
    live: 'Canlı durum', last: 'Son aktarım', none: 'Henüz aktarım yapılmadı.',
    stats: { received: 'Main\'e geçen (net)', sent: 'Gönderilen', fee: 'Toplam kesinti', count: 'Aktarım' },
    preClaimed: 'Başta toplanan satışlar', preFee: 'kesinti',
    accTable: 'Hesaplar', transfers: 'Aktarımlar', sales: 'Başta toplanan satışlar',
    account: 'Hesap', role: 'Rol', roleMain: 'Main', roleSide: 'Kaynak', apkBA: 'APK önce → sonra', tixBA: 'TIX önce → sonra', claimed: 'Toplanan satış', eligible: 'Uygun', status: 'Durum',
    currency: 'Birim', amount: 'Gönderilen', player: 'Oyuncu', source: 'Oyuncu nereden', fee: 'Kesinti', got: 'Main\'e geçen',
    grade: 'Rating', value: 'Değer', salary: 'Maaş', base: 'Base', price: 'Fiyat', payout: 'Toplanan',
    noSales: 'Toplanan satış olmadı.', noTransfers: 'Aktarım yok.',
    src: { scout: 'Main Scout', friend: 'Arkadaş Scout\'u', spender: 'Harcayıcı' },
    skip: { belowMin: 'en az {min} gerekli ({have})', rosterFull: 'kadro dolu', noBalance: 'bakiye okunamadı' },
    st: { queued: 'Sırada', login: 'Giriş', ready: 'Hazır', claiming: 'Satışlar toplanıyor', notEligible: 'Uygun değil', buying: 'Satın alıyor', done: 'Bitti', error: 'Hata' },
    tr: { planned: 'Planlandı', listing: 'Listeleniyor', listed: 'Listelendi', buying: 'Alınıyor', bought: 'Alındı', claimed: 'Tamam', noPlayer: 'Oyuncu bulunamadı', listFailed: 'Listelenemedi', buyFailed: 'Alınamadı', claimFailed: 'Toplanamadı' },
    step: { starting: 'Başlıyor', claiming: 'Satışlar toplanıyor ve bakiyeler okunuyor ({n} hesap)', finding: '{side} için oyuncu bulunuyor ve listeleniyor ({currency}, {n}/{of})', trading: '{spender} → main takası ({n} oyuncu)', scanning: 'Ucuz oyuncu aranıyor · {where}', buying: 'Hesaplar ilanlarını aynı anda alıyor ({n})', mainClaim: 'Main satışları topluyor' },
    reason: { done: 'Bitti', partial: 'Eksiklerle bitti', nothingEligible: 'Uygun hesap yoktu', noPlayers: 'Oyuncu bulunamadı', stopped: 'Durduruldu', error: 'Hata' },
    calc: 'Hesaplama', calcBtn: 'Hesapla', calcBusy: 'Okunuyor…', calcLive: 'Canlı okundu: {time} · bekleyen satışlar dahil', calcApp: 'Uygulamadaki bakiyelere göre (bekleyen satışlar için “Hesapla”)',
    calcLine: '{c}: {n}/{of} hesap uygun · gönderilecek {sent} · kesinti {fee} · main\'e geçecek ≈ {net}', calcMain: 'Main\'in bekleyen satışları: +{net} {c}', calcTotal: 'Main\'de olacak ≈ {total} {c} (şu an {now})',
    calcHint: 'Her uygun hesap bütün bakiyesini (önce kendi bekleyen satışları toplanır) tek ilanla gönderir; oyun her satıştan max(3, %5) keser. Kadrosu dolu olan hesap aktarımda atlanır, burada sayılır.',
    calcDetail: 'Hesap ayrıntısı', calcBal: 'Bakiye', calcPending: 'Bekleyen satış', calcSend: 'Gönderilecek', calcNet: 'Main\'e', calcNo: 'uygun değil',
    how: 'Nasıl çalışır?',
    howLines: [
      'Önce seçili bütün hesapların pazarı taranır ve satışları toplanır; toplanan oyuncular aşağıdaki tabloda görünür. Sonra her hesabın güncel APK / TIX\'i okunur.',
      'En az değerin altında kalan, ya da kadrosunda oyuncu alacak yeri olmayan hesaplar uygun sayılmaz ve atlanır.',
      'Main, maaşı sınırın altında ucuz oyuncular bulur: önce kendi Scout\'u (Callback kullanılmaz), sonra arkadaşlarının Scout\'ları, yine yetmezse Harcayıcılar sırayla açılır ve kendi / arkadaşlarının Scout\'larından alıp main\'e takasla verir.',
      'Her oyuncu hemen, karşılığı olan hesabın bütün bakiyesi kadar fiyata pazara konur; böylece main\'in kadrosu hiç dolmaz. Hangi hesabın hangi ilanı alacağı baştan bellidir; aynı bakiyeli hesaplar karışmaz.',
      'Bütün hesaplar kendi ilanlarını aynı anda alır (alımdan önce ilanın main\'e ait, doğru oyuncu ve doğru fiyat olduğu kontrol edilir). Sonra main satışları toplar: oyun her satıştan max(3, %5) keser; rapordaki rakamlar oyunun bildirdiği gerçek kesintilerdir.',
      'Alınan ucuz oyuncular alan hesapların kadrosunda kalır. Alınmayan ilan pazardan geri çekilir.',
      'Seçtiğin değerler bir dahaki sefere hatırlanır.'
    ]
  },
  en: {
    title: 'APK / TIX Transfer', subtitle: 'Collects the APK and/or TIX of the chosen accounts on one account through the market',
    start: 'Start transfer', stop: 'Stop',
    accounts: 'Accounts to use', selectAll: 'Select all', clear: 'Clear',
    receiver: 'Account to receive (main)', receiverHint: 'APK / TIX are collected on this account. If main is not chosen, pick one of the chosen accounts.',
    mode: 'What to transfer', modeAPK: 'Transfer APK', modeTIX: 'Transfer TIX', modeboth: 'Transfer both',
    minApk: 'Minimum APK', minApkHint: 'An account with less APK is not eligible.', minTix: 'Minimum TIX', minTixHint: 'An account with less TIX is not eligible.',
    maxTk: 'Player at most (TK)', maxTkHint: 'The highest salary of the players main signs to list.',
    useSpenders: 'Get them from spenders by trade when Scouts are not enough',
    eligibleNow: 'Eligible with the current balances: {n} / {of} account(s)', eligibleNote: 'The exact number is known after the sales are claimed at the start.',
    errReceiver: 'Choose the account to receive', errSides: 'Choose at least one account besides main', errNum: 'Check the numbers',
    live: 'Live', last: 'Last transfer', none: 'No transfer yet.',
    stats: { received: 'To main (net)', sent: 'Sent', fee: 'Total fee', count: 'Transfers' },
    preClaimed: 'Sales claimed at the start', preFee: 'fee',
    accTable: 'Accounts', transfers: 'Transfers', sales: 'Sales claimed at the start',
    account: 'Account', role: 'Role', roleMain: 'Main', roleSide: 'Source', apkBA: 'APK before → after', tixBA: 'TIX before → after', claimed: 'Sales claimed', eligible: 'Eligible', status: 'Status',
    currency: 'Unit', amount: 'Sent', player: 'Player', source: 'Player from', fee: 'Fee', got: 'To main',
    grade: 'Rating', value: 'Value', salary: 'Salary', base: 'Base', price: 'Price', payout: 'Claimed',
    noSales: 'No sales were claimed.', noTransfers: 'No transfers.',
    src: { scout: 'Main Scout', friend: 'Friend\'s Scout', spender: 'Spender' },
    skip: { belowMin: 'needs at least {min} ({have})', rosterFull: 'roster full', noBalance: 'balance not read' },
    st: { queued: 'Queued', login: 'Signing in', ready: 'Ready', claiming: 'Claiming sales', notEligible: 'Not eligible', buying: 'Buying', done: 'Done', error: 'Error' },
    tr: { planned: 'Planned', listing: 'Listing', listed: 'Listed', buying: 'Buying', bought: 'Bought', claimed: 'Done', noPlayer: 'No player found', listFailed: 'Not listed', buyFailed: 'Not bought', claimFailed: 'Not claimed' },
    step: { starting: 'Starting', claiming: 'Claiming sales and reading balances ({n} accounts)', finding: 'Finding and listing a player for {side} ({currency}, {n}/{of})', trading: '{spender} → main trade ({n} players)', scanning: 'Looking for a cheap player · {where}', buying: 'The accounts buy their listings at the same time ({n})', mainClaim: 'Main claims the sales' },
    reason: { done: 'Finished', partial: 'Finished with gaps', nothingEligible: 'No eligible account', noPlayers: 'No player found', stopped: 'Stopped', error: 'Error' },
    calc: 'Calculation', calcBtn: 'Calculate', calcBusy: 'Reading…', calcLive: 'Read live: {time} · pending sales included', calcApp: 'From the balances in the app (press “Calculate” for pending sales)',
    calcLine: '{c}: {n}/{of} account(s) eligible · to send {sent} · fee {fee} · to main ≈ {net}', calcMain: 'Main\'s pending sales: +{net} {c}', calcTotal: 'Main will have ≈ {total} {c} (now {now})',
    calcHint: 'Every eligible account sends its whole balance (its own pending sales are claimed first) in one listing; the game keeps max(3, 5%) of each sale. An account with a full roster is skipped by the transfer but counted here.',
    calcDetail: 'Per account', calcBal: 'Balance', calcPending: 'Pending sales', calcSend: 'To send', calcNet: 'To main', calcNo: 'not eligible',
    how: 'How it works',
    howLines: [
      'First the market of every chosen account is read and its sales are claimed; the claimed players show in the table below. Then the current APK / TIX of every account is read.',
      'Accounts under the minimum, or without a free roster place to buy a player, are not eligible and are skipped.',
      'Main finds cheap players under the salary limit: first its own Scout (no Callback), then its friends\' Scouts, and if still short the spenders are opened one by one; they sign from their own / their friends\' Scouts and trade them to main.',
      'Every player is listed right away for the whole balance of its account, so main\'s roster never fills up. Which account buys which listing is fixed in advance; accounts with the same balance never mix up.',
      'All accounts buy their own listing at the same time (before buying, the listing is checked: main\'s, the right player, the right price). Then main claims the sales: the game keeps max(3, 5%) of each; the report shows the real fees the game gave.',
      'The cheap players stay on the buying accounts. A listing nobody bought is taken off the market again.',
      'Your values are remembered for next time.'
    ]
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v).toLocaleString('tr-TR') : '—');
const isInt = v => String(v).trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 1;
const TONE = { planned: 'muted', listing: 'warn', listed: 'info', buying: 'warn', bought: 'info', claimed: 'ok', noPlayer: 'bad', listFailed: 'bad', buyFailed: 'bad', claimFailed: 'bad' };
// the market's fee: max(3, 5 % rounded up) (every fee of the past transfers fits)
const feeOf = p => Math.max(3, Math.ceil(Number(p) * 0.05));
const fmtPct = v => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);

export default function ApkTransferTab({ state, t, toast, tabs }) {
  const x = TEXT[t.lang] || TEXT.en;
  const ap = state.apkTransfer || {};
  const accounts = state.accounts || [];
  const prof = state.accountProfile || {};
  const realMain = prof.mainAccountId || '';
  const saved = ap.config || {};
  const playerIndex = useMemo(() => new Map((state.players?.players || []).map(p => [p.id, p])), [state.players]);
  const [ids, setIds] = useState(() => [...new Set([saved.mainId, ...(saved.sideIds || [])].filter(id => id && accounts.some(a => a.id === id)))]);
  const [receiver, setReceiver] = useState(saved.mainId || realMain);
  const [mode, setMode] = useState(saved.mode || 'APK');
  const [minApk, setMinApk] = useState(String(saved.minApk ?? 100));
  const [minTix, setMinTix] = useState(String(saved.minTix ?? 100));
  const [maxTk, setMaxTk] = useState(String(saved.maxTk ?? 50));
  const [useSpenders, setUseSpenders] = useState(saved.useSpenders !== false);
  const running = Boolean(ap.running);
  const stat = id => prof.accounts?.[id] || {};
  const chosen = ids.filter(id => accounts.some(a => a.id === id));
  // main chosen → it receives; otherwise the user picks one of the chosen accounts
  const recv = chosen.includes(realMain) ? realMain : (chosen.includes(receiver) ? receiver : '');
  const sideIds = chosen.filter(id => id !== recv);
  const config = () => ({ mainId: recv, sideIds, mode, minApk: Number(minApk), minTix: Number(minTix), maxTk: Number(maxTk), useSpenders });
  // remember the values as they change
  useEffect(() => { if (running) return; const h = setTimeout(() => { api.apk?.saveConfig?.(config()).catch?.(() => {}); }, 600); return () => clearTimeout(h); }, [ids, receiver, mode, minApk, minTix, maxTk, useSpenders]);
  const curs = mode === 'both' ? ['APK', 'TIX'] : [mode];
  const eligibleNow = sideIds.filter(id => curs.some(c => Number(stat(id)[c === 'APK' ? 'apk' : 'tix']) >= Number(c === 'APK' ? minApk : minTix))).length;
  const errors = [!recv && x.errReceiver, !sideIds.length && x.errSides, !(isInt(minApk) && isInt(minTix) && isInt(maxTk)) && x.errNum].filter(Boolean);
  const start = async () => { try { await api.apk.start(config()); } catch (e) { toast(e.message, 'error'); } };
  const allOn = accounts.length > 0 && accounts.every(a => chosen.includes(a.id));
  const shown = running ? ap.run : ap.lastReport;
  const totals = shown?.totals;
  const rows = shown ? Object.values(shown.accounts || {}) : [];
  const srcLabel = s => { if (!s) return '—'; const [k, n] = String(s).split(':'); return n ? `${x.src[k] || k} · ${n}` : (x.src[k] || k); };
  const ba = (r, k) => `${num(r.before?.[k])} → ${num(r.after?.[k])}`;
  // "Hesapla" (user 2026-11-20): what this setup would move, live as the choices change; the
  // button reads every chosen account at once (balances and pending sales) for the exact numbers.
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const runScan = async () => { setScanning(true); try { setScan({ at: Date.now(), data: await api.apk.scan(chosen) }); } catch (e) { toast(e.message, 'error'); } finally { setScanning(false); } };
  const est = useMemo(() => curs.map(c => {
    const key = c === 'APK' ? 'apk' : 'tix';
    const min = Number(c === 'APK' ? minApk : minTix) || 0;
    const live = id => { const v = scan?.data?.[id]; return v && !v.error ? v : null; };
    const pendingOf = id => (live(id)?.sold?.[c] || []).reduce((q, p) => q + p - feeOf(p), 0);
    const rows = sideIds.map(id => {
      const bal = live(id) ? live(id)[key] : Number(stat(id)[key]) || 0;
      const pending = pendingOf(id);
      const total = bal + pending;
      const ok = total >= min && total > 0;
      const fee = ok ? feeOf(total) : 0;
      return { id, bal, pending, total, ok, fee, net: ok ? total - fee : 0 };
    });
    const ok = rows.filter(x => x.ok);
    const mainPending = recv ? pendingOf(recv) : 0;
    const mainNow = recv ? (live(recv) ? live(recv)[key] : Number(stat(recv)[key]) || 0) : 0;
    const net = ok.reduce((q, x) => q + x.net, 0);
    return { c, rows, n: ok.length, of: rows.length, sent: ok.reduce((q, x) => q + x.total, 0), fee: ok.reduce((q, x) => q + x.fee, 0), net, mainPending, mainNow, total: mainNow + mainPending + net };
  }), [curs.join(), sideIds.join(), recv, minApk, minTix, scan, prof]);
  const nameOf = id => accounts.find(a => a.id === id)?.name || id;

  return <div className="page tk-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar">{running
        ? <button className="btn danger-soft" onClick={() => api.apk.stop().catch(e => toast(e.message, 'error'))}>{x.stop}</button>
        : <button className="btn primary" disabled={errors.length > 0} onClick={start}>{x.start}</button>}</div>
    </div>
    {tabs}

    <div className="panel tk-setup">
      <div className="tk-fields">
        <label><span>{x.mode}</span><span className="currency-toggle apk-mode">{['APK', 'TIX', 'both'].map(m => <button type="button" key={m} disabled={running} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{x[`mode${m}`]}</button>)}</span></label>
        {curs.includes('APK') && <label><span>{x.minApk}</span><input type="number" min="1" step="1" disabled={running} value={minApk} onChange={e => setMinApk(e.target.value)} /><small>{x.minApkHint}</small></label>}
        {curs.includes('TIX') && <label><span>{x.minTix}</span><input type="number" min="1" step="1" disabled={running} value={minTix} onChange={e => setMinTix(e.target.value)} /><small>{x.minTixHint}</small></label>}
        <label><span>{x.maxTk}</span><input type="number" min="1" max="2500" step="1" disabled={running} value={maxTk} onChange={e => setMaxTk(e.target.value)} /><small>{x.maxTkHint}</small></label>
      </div>
      <label className="apk-check"><input type="checkbox" disabled={running} checked={useSpenders} onChange={e => setUseSpenders(e.target.checked)} />{x.useSpenders}</label>
      <div className="tk-sides-head"><b>{x.accounts}</b><span className="muted">{chosen.length}/{accounts.length}</span><span className="sp" /><button className="btn ghost small" disabled={running} onClick={() => setIds(allOn ? [] : accounts.map(a => a.id))}>{allOn ? x.clear : x.selectAll}</button></div>
      <div className="tk-sides"><GroupedPicks storeKey="apktransfer" accounts={accounts} selected={chosen} disabled={running} onSet={setIds} render={a => <label key={a.id} className={chosen.includes(a.id) ? 'on' : ''}>
        <input type="checkbox" disabled={running} checked={chosen.includes(a.id)} onChange={() => setIds(chosen.includes(a.id) ? chosen.filter(v => v !== a.id) : [...chosen, a.id])} />
        <b>{a.name}</b>{a.id === recv && <span className="main-dot">MAIN</span>}<span className="num">APK {num(stat(a.id).apk)}</span><span className="num muted">TIX {num(stat(a.id).tix)}</span>
      </label>} /></div>
      {!chosen.includes(realMain) && chosen.length > 0 && <div className="tk-fields"><label><span>{x.receiver}</span><select disabled={running} value={recv} onChange={e => setReceiver(e.target.value)}><option value="">—</option>{chosen.map(id => <option key={id} value={id}>{accounts.find(a => a.id === id)?.name}</option>)}</select><small>{x.receiverHint}</small></label></div>}
      {sideIds.length > 0 && <div className="apk-eligible"><b>{fill(x.eligibleNow, { n: eligibleNow, of: sideIds.length })}</b><small className="muted-text"> · {x.eligibleNote}</small></div>}
      {sideIds.length > 0 && <div className="apk-calc">
        <div className="apk-calc-head"><b>{x.calc}</b><span className="muted-text">{scan ? fill(x.calcLive, { time: new Date(scan.at).toLocaleTimeString() }) : x.calcApp}</span><span className="sp" /><button className="btn ghost small" disabled={scanning || running} onClick={runScan}>{scanning ? x.calcBusy : x.calcBtn}</button></div>
        {est.map(e => <div key={e.c} className="apk-calc-line">
          <b>{fill(x.calcLine, { c: e.c, n: e.n, of: e.of, sent: num(e.sent), fee: num(e.fee), net: num(e.net) })}</b>
          {e.mainPending > 0 && <small className="muted-text">{fill(x.calcMain, { net: num(e.mainPending), c: e.c })}</small>}
          <small className="good-text">{fill(x.calcTotal, { total: num(e.total), c: e.c, now: num(e.mainNow) })}</small>
        </div>)}
        <small className="muted-text">{x.calcHint}</small>
        <details><summary>{x.calcDetail}</summary>
          <SortTable><thead><tr><th>{x.account}</th>{est.map(e => <th key={e.c}>{e.c} · {x.calcBal} / {x.calcPending} → {x.calcSend} ({x.calcNet})</th>)}</tr></thead>
            <tbody>{sideIds.map(id => <tr key={id}><td><b>{nameOf(id)}</b></td>{est.map(e => { const row = e.rows.find(q => q.id === id); return <td key={e.c} className={row.ok ? 'num' : 'num muted-text'}>{num(row.bal)}{row.pending ? ` + ${num(row.pending)}` : ''} → {row.ok ? <>{num(row.total)} (<span className="good-text">{num(row.net)}</span>)</> : x.calcNo}</td>; })}</tr>)}</tbody></SortTable>
        </details>
      </div>}
      {errors.length > 0 && !running && <div className="tk-errors">{errors.map(e => <span key={e}>{e}</span>)}</div>}
    </div>

    <div className="panel tk-live">
      <div className="tk-live-head"><b>{running ? x.live : x.last}</b>
        {shown && <span className="muted">{running ? fill(x.step[shown.step] || '', shown.stepParams || {}) : `${x.reason[shown.reason] || shown.reason || ''}${shown.error ? `: ${shown.error}` : ''}${shown.finishedAt ? ` · ${new Date(shown.finishedAt).toLocaleString()}` : ''}`}</span>}
      </div>
      {!shown ? <div className="empty">{x.none}</div> : <>
        {totals && <div className="tk-stats apk-stats">{['APK', 'TIX'].filter(c => totals[c] && (totals[c].count || totals[c].preClaimed)).map(c => <div key={c}>
          <span>{c} · {x.stats.received}</span><b className="num good-text">+{num(totals[c].received)}</b>
          <small>{x.stats.sent} {num(totals[c].sent)} · {x.stats.fee} {num(totals[c].fee)} · {x.stats.count} {totals[c].count}</small>
          {totals[c].preClaimed > 0 && <small>{x.preClaimed}: +{num(totals[c].preClaimed)} ({x.preFee} {num(totals[c].preFee)})</small>}
        </div>)}</div>}
        <div className="tk-sub">{x.accTable}</div>
        <SortTable><thead><tr><th>{x.account}</th><th>{x.role}</th><th>{x.apkBA}</th><th>{x.tixBA}</th><th>{x.claimed}</th><th>{x.eligible}</th><th>{x.status}</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.accountId} className={['claiming', 'buying'].includes(r.status) ? 'dp-live' : ''}>
            <td><b>{r.name}</b></td><td>{r.main ? x.roleMain : x.roleSide}</td>
            <td className="num">{ba(r, 'apk')}</td><td className="num">{ba(r, 'tix')}</td>
            <td className="num">{r.claimed?.count ? `${r.claimed.count} · ${[r.claimed.APK && `${num(r.claimed.APK)} APK`, r.claimed.TIX && `${num(r.claimed.TIX)} TIX`].filter(Boolean).join(' · ') || '0'}` : '—'}</td>
            <td>{r.main ? '' : r.eligible?.length ? r.eligible.join(' + ') : (r.skipped || []).map(s => `${s.currency}: ${fill(x.skip[s.reason] || s.reason, s)}`).join(' · ') || '—'}</td>
            <td className={r.status === 'error' ? 'bad-text' : ''}>{x.st[r.status] || r.status}{r.note && r.status === 'error' ? `: ${r.note}` : ''}</td>
          </tr>)}</tbody></SortTable>
        <div className="tk-sub">{x.transfers}</div>
        {!(shown.transfers || []).length ? <div className="empty">{x.noTransfers}</div> :
          <SortTable><thead><tr><th>{x.account}</th><th>{x.currency}</th><th>{x.amount}</th><th>{x.player}</th><th>{x.source}</th><th>{x.fee}</th><th>{x.got}</th><th>{x.status}</th></tr></thead>
            <tbody>{shown.transfers.map(tr => <tr key={tr.id} className={['listing', 'buying'].includes(tr.status) ? 'dp-live' : ''}>
              <td><b>{tr.sideName}</b></td><td>{tr.currency}</td><td className="num">{num(tr.price)}</td>
              <td>{tr.player ? <><b>{tr.player}</b><InjuryMark name={tr.player} />{tr.salary ? <small className="cell-sub">{num(tr.salary)} TK</small> : null}</> : '—'}</td>
              <td>{srcLabel(tr.source)}</td><td className="num">{tr.fee == null ? '—' : num(tr.fee)}</td><td className="num good-text">{tr.payout == null ? '—' : `+${num(tr.payout)}`}</td>
              <td><span className={`tk-badge ${TONE[tr.status] || ''}`} title={tr.error || ''}>{x.tr[tr.status] || tr.status}</span>{tr.error && <small className="cell-sub bad-text">{tr.error}</small>}</td>
            </tr>)}</tbody></SortTable>}
        <div className="tk-sub">{x.sales}</div>
        {!(shown.sales || []).length ? <div className="empty">{x.noSales}</div> :
          <SortTable><thead><tr><th>{x.account}</th><th>{x.player}</th><th>{x.grade}</th><th>{x.value}</th><th>{x.salary}</th><th>{x.base}</th><th>Base %</th><th>{x.price}</th><th>{x.payout}</th><th>{x.fee}</th></tr></thead>
            <tbody>{shown.sales.map(s => <tr key={s.ticketId}>
              <td>{s.accountName}</td><td><b>{s.name}</b><InjuryMark name={s.name} />{s.salary != null && s.base > 0 && s.salary <= s.base && <span className="base-badge">BASE</span>}{s.position && <small className="cell-sub">{s.position}</small>}</td>
              <td>{s.grade || '—'}</td><td className="num">{num(playerIndex.get(s.playerId)?.value)}</td><td className="num"><b>{num(s.salary)}</b></td><td className="num">{num(s.base)}</td><td className={`base-pct ${s.basePct == null ? '' : s.basePct <= 0 ? 'below' : 'above'}`}>{fmtPct(s.basePct)}</td>
              <td className="num"><b>{num(s.price)}</b> {s.currency}</td><td className="num good-text">{s.claimed ? `+${num(s.payout)}` : <span className="bad-text" title={s.error}>✗</span>}</td><td className="num">{s.claimed ? num(s.fee) : '—'}</td>
            </tr>)}</tbody></SortTable>}
      </>}
    </div>
    <details className="panel pvp-how"><summary>{x.how}</summary><ul>{x.howLines.map(l => <li key={l}>{l}</li>)}</ul></details>
  </div>;
}
