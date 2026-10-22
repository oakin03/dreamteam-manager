import { useEffect, useMemo, useState } from 'react';
import { BoughtList } from './BuyParts';

const api = window.dreamteam;
const num = v => v == null || v === '' ? '—' : Number(v).toLocaleString();
const TEXT = {
  tr: {
    title: 'Auto Buy', subtitle: 'Listedeki oyuncular koşulları sağlayınca Trading Hall\'dan otomatik alınır',
    start: 'Auto Buy Başlat', stop: 'Durdur', interval: 'Tarama aralığı (sn)',
    st: { idle: 'Hazır', running: 'Çalışıyor', stopped: 'Durduruldu', error: 'Hata', noFunds: 'Durdu · bakiye yetersiz' },
    cycle: '{n}. tarama', lastScan: 'son tarama {t}', nextScan: 'sonraki {s} sn', boughtN: '{n} oyuncu alındı', spent: 'harcanan {apk} APK · {tix} TIX', noFunds: 'Hesapların {cur} miktarı yetersiz; listedeki en düşük fiyatı karşılayan hesap kalmadı.',
    watch: 'İzleme listesi', watchHint: 'Bir oyuncu ancak Maaş ≤, Fiyat ≤ ve para birimi koşullarının hepsini sağlarsa alınır. Oyuncular sayfasından tek tek ya da toplu eklenebilir.',
    add: 'Oyuncu ekle…', player: 'Oyuncu', value: 'Değer', base: 'Base', maxSalary: 'Maaş ≤', maxPrice: 'Fiyat ≤', currency: 'Para birimi', active: 'Aktif', incomplete: 'Maaş ≤ ve Fiyat ≤ girilmeli', emptyWatch: 'Liste boş. Oyuncular sayfasından ya da yukarıdaki kutudan oyuncu ekle.', clearAll: 'Listeyi temizle', confirmClear: 'İzleme listesindeki tüm oyuncular silinsin mi?',
    accounts: 'Hesap önceliği', accountsHint: 'Alım 1. hesaptan başlar; parası bitince sıradakine geçilir. Oklarla sırala, kutuyla dahil et.', include: 'Dahil', apk: 'APK', tix: 'TIX',
    cannotBuy: '{name} ({price} {cur}) hiçbir hesapla alınamadı · {why} · tarama sürüyor',
    warnRegister: 'Başlatınca seçili hesaplarda çalışan Auto Play durdurulur, Auto Buy bitince yeniden başlatılır. Hesap aynı anda tarayıcıda açıksa o oturum düşebilir.'
  },
  en: {
    title: 'Auto Buy', subtitle: 'Players on the list are bought from the Trading Hall when every condition holds',
    start: 'Start Auto Buy', stop: 'Stop', interval: 'Scan every (s)',
    st: { idle: 'Ready', running: 'Running', stopped: 'Stopped', error: 'Error', noFunds: 'Stopped · not enough funds' },
    cycle: 'scan {n}', lastScan: 'last scan {t}', nextScan: 'next in {s}s', boughtN: '{n} bought', spent: 'spent {apk} APK · {tix} TIX', noFunds: 'The accounts do not have enough {cur}; no account can pay the lowest price on the list.',
    watch: 'Watch list', watchHint: 'A player is bought only when Salary ≤, Price ≤ and the currency all hold. Add players one by one or in bulk from the Players page.',
    add: 'Add a player…', player: 'Player', value: 'Value', base: 'Base', maxSalary: 'Salary ≤', maxPrice: 'Price ≤', currency: 'Currency', active: 'Active', incomplete: 'Fill in Salary ≤ and Price ≤', emptyWatch: 'The list is empty. Add players from the Players page or the box above.', clearAll: 'Clear list', confirmClear: 'Remove every player from the watch list?',
    accounts: 'Account priority', accountsHint: 'Buying starts with account 1; when it runs out of funds the next one is used. Sort with the arrows, include with the box.', include: 'Use', apk: 'APK', tix: 'TIX',
    cannotBuy: 'No account could buy {name} ({price} {cur}) · {why} · still scanning',
    warnRegister: 'On start, Auto Play running on the selected accounts is stopped and started again when Auto Buy ends. If an account is open in a browser at the same time, that session may be signed out.'
  }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const ready = r => r.maxPrice !== '' && r.maxPrice != null && Number(r.maxPrice) >= 1 && r.maxSalary !== '' && r.maxSalary != null && Number(r.maxSalary) >= 0;

function useTick(on) { const [, set] = useState(0); useEffect(() => { if (!on) return; const t = setInterval(() => set(v => v + 1), 1000); return () => clearInterval(t); }, [on]); }

export default function AutoBuyPage({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const b = state.buy || {};
  const auto = b.auto || { status: 'idle' };
  const running = auto.status === 'running';
  useTick(running);
  const accounts = state.accounts || [];
  const stats = state.accountProfile?.accounts || {};
  const cfg = b.config || {};
  const [order, setOrder] = useState(() => {
    const saved = (cfg.accountOrder || []).filter(id => accounts.some(a => a.id === id));
    return [...saved, ...accounts.map(a => a.id).filter(id => !saved.includes(id))];
  });
  const [included, setIncluded] = useState(() => new Set(cfg.accountOrder?.length ? cfg.accountOrder : accounts.map(a => a.id)));
  const [interval, setIntervalSec] = useState(cfg.intervalSec || 10);
  const [q, setQ] = useState('');
  const run = async fn => { try { await fn(); } catch (e) { toast(e.message, 'error'); } };
  const move = (i, d) => setOrder(o => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const toggleInc = id => setIncluded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const chosen = order.filter(id => included.has(id));
  const watch = b.watch || [];
  const suggestions = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const have = new Set(watch.map(w => w.playerId));
    return (state.players?.players || []).filter(p => !have.has(p.id) && p.name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, watch, state.players]);
  const nextIn = auto.nextScanAt ? Math.max(0, Math.ceil((Date.parse(auto.nextScanAt) - Date.now()) / 1000)) : null;
  const tone = { running: 'ok', noFunds: 'bad', error: 'bad', stopped: 'muted', idle: 'muted' }[auto.status] || 'muted';

  return <div className="page autobuy-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar">
        <label className="ab-interval"><span>{x.interval}</span><input type="number" min="3" max="600" value={interval} disabled={running} onChange={e => setIntervalSec(e.target.value)} /></label>
        {running ? <button className="btn danger-soft" onClick={() => run(() => api.buy.stopAuto())}>{x.stop}</button>
          : <button className="btn primary" disabled={!chosen.length || !watch.some(w => w.enabled !== false && ready(w))} onClick={() => run(() => api.buy.startAuto({ accountIds: chosen, intervalSec: Number(interval) }))}>{x.start}</button>}
      </div></div>

    <div className={`panel ab-status ${tone}`}>
      <span className={`pill ${tone}`}><i />{x.st[auto.status] || auto.status}</span>
      {auto.cycle > 0 && <span>{fill(x.cycle, { n: auto.cycle })}</span>}
      {auto.lastScanAt && <span className="muted-text">{fill(x.lastScan, { t: new Date(auto.lastScanAt).toLocaleTimeString() })}</span>}
      {running && nextIn != null && <span className="muted-text">{fill(x.nextScan, { s: nextIn })}</span>}
      {auto.bought != null && auto.startedAt && <b>{fill(x.boughtN, { n: auto.bought })}</b>}
      {auto.spent && <span className="muted-text">{fill(x.spent, { apk: num(auto.spent.APK), tix: num(auto.spent.TIX) })}</span>}
      {auto.status === 'noFunds' && <em className="ab-warn">{fill(x.noFunds, { cur: auto.message || 'APK' })}</em>}
      {auto.status === 'error' && <em className="ab-warn">{auto.message}</em>}
      {auto.lastWarning && <em className="ab-warn" title={new Date(auto.lastWarning.at).toLocaleTimeString()}>⚠ {fill(x.cannotBuy, { name: auto.lastWarning.name, price: num(auto.lastWarning.price), cur: auto.lastWarning.currency, why: t.lang === 'tr' ? auto.lastWarning.reasonTr : auto.lastWarning.reasonEn })}</em>}
    </div>

    <div className="ab-grid">
      <section>
        <h3 className="section-title">{x.watch} <small>{x.watchHint}</small></h3>
        <div className="ab-add"><input placeholder={x.add} value={q} onChange={e => setQ(e.target.value)} />
          {suggestions.length > 0 && <div className="ab-sugg">{suggestions.map(p => <button key={p.id} onClick={() => run(async () => { await api.buy.addWatch([p]); setQ(''); })}><b>{p.name}</b><small>{p.team} · {p.position} · {p.rating} · {num(p.value)}</small></button>)}</div>}
          {watch.length > 0 && <button className="btn ghost small" onClick={() => { if (window.confirm(x.confirmClear)) run(() => api.buy.removeWatch(watch.map(w => w.id))); }}>{x.clearAll}</button>}
        </div>
        <div className="panel table-panel">{watch.length ? <table><thead><tr><th>{x.active}</th><th>{x.player}</th><th>{x.value}</th><th>{x.base}</th><th>{x.maxSalary}</th><th>{x.maxPrice}</th><th>{x.currency}</th><th></th></tr></thead>
          <tbody>{watch.map(w => <WatchRow key={w.id} w={w} x={x} run={run} />)}</tbody></table> : <div className="empty">{x.emptyWatch}</div>}</div>
      </section>

      <section>
        <h3 className="section-title">{x.accounts}</h3>
        <p className="muted-text ab-hint">{x.accountsHint}</p>
        <div className="panel ab-accounts">{order.map((id, i) => { const a = accounts.find(v => v.id === id); if (!a) return null; const inc = included.has(id); const rank = chosen.indexOf(id);
          return <div key={id} className={`ab-acc ${inc ? '' : 'off'}`}>
            <span className="ab-rank">{inc ? rank + 1 : '–'}</span>
            <input type="checkbox" checked={inc} disabled={running} onChange={() => toggleInc(id)} title={x.include} />
            <b>{a.name}</b>
            <em>{num(stats[id]?.apk)} {x.apk}</em><em>{num(stats[id]?.tix)} {x.tix}</em>
            <span className="ab-move"><button disabled={running || i === 0} onClick={() => move(i, -1)}>↑</button><button disabled={running || i === order.length - 1} onClick={() => move(i, 1)}>↓</button></span>
          </div>; })}</div>
        <p className="muted-text ab-hint">{x.warnRegister}</p>
      </section>
    </div>

    <BoughtList state={state} lang={t.lang} toast={toast} source="auto" />
  </div>;
}

// One watch row; numbers are saved when the field loses focus.
function WatchRow({ w, x, run }) {
  const [v, setV] = useState({ maxSalary: w.maxSalary, maxPrice: w.maxPrice });
  useEffect(() => { setV({ maxSalary: w.maxSalary, maxPrice: w.maxPrice }); }, [w.maxSalary, w.maxPrice]);
  const save = patch => run(() => api.buy.updateWatch(w.id, patch));
  const ok = ready({ ...w, ...v });
  return <tr className={w.enabled === false ? 'row-dim' : ''}>
    <td><input type="checkbox" checked={w.enabled !== false} onChange={e => save({ enabled: e.target.checked })} /></td>
    <td><b>{w.name}</b><small className="cell-sub">{[w.team, w.position, w.rating].filter(Boolean).join(' · ')}</small>{!ok && <small className="cell-sub bad-text">{x.incomplete}</small>}</td>
    <td>{num(w.value)}</td><td>{num(w.base)}</td>
    <td><input className="price-input" type="number" min="0" value={v.maxSalary} onChange={e => setV(s => ({ ...s, maxSalary: e.target.value }))} onBlur={() => String(v.maxSalary) !== String(w.maxSalary) && save({ maxSalary: v.maxSalary })} /></td>
    <td><input className="price-input" type="number" min="1" value={v.maxPrice} onChange={e => setV(s => ({ ...s, maxPrice: e.target.value }))} onBlur={() => String(v.maxPrice) !== String(w.maxPrice) && save({ maxPrice: v.maxPrice })} /></td>
    <td><span className="currency-toggle">{['APK', 'TIX'].map(c => <button type="button" key={c} className={w.currency === c ? 'on' : ''} onClick={() => save({ currency: c })}>{c}</button>)}</span></td>
    <td className="actions"><button className="icon-btn danger" onClick={() => run(() => api.buy.removeWatch([w.id]))}>×</button></td>
  </tr>;
}
