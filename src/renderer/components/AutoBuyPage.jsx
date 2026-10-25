import { useEffect, useMemo, useState } from 'react';
import { BoughtList } from './BuyParts';
import SortTable from './SortTable';

const api = window.dreamteam;
const num = v => v == null || v === '' ? '—' : Number(v).toLocaleString();
const TEXT = {
  tr: {
    title: 'Auto Buy', subtitle: 'Listedeki oyuncular koşulları sağlayınca Trading Hall\'dan otomatik alınır',
    start: 'Auto Buy Başlat', stop: 'Durdur', interval: 'Tarama aralığı (sn)',
    st: { idle: 'Hazır', running: 'Çalışıyor', stopped: 'Durduruldu', error: 'Hata', noFunds: 'Durdu · bakiye yetersiz' },
    cycle: '{n}. tarama', lastScan: 'son tarama {t}', nextScan: 'sonraki {s} sn', boughtN: '{n} oyuncu alındı', spent: 'harcanan {apk} APK · {tix} TIX', noFunds: 'Hesapların {cur} miktarı yetersiz; listedeki en düşük fiyatı karşılayan hesap kalmadı.',
    watch: 'İzleme listesi', watchHint: 'Bir oyuncu ancak Maaş ≤, Fiyat ≤ ve para birimi koşullarının hepsini sağlarsa alınır. Oyuncular sayfasından tek tek ya da toplu eklenebilir.',
    add: 'Oyuncu ekle…', player: 'Oyuncu', value: 'Değer', base: 'Base', maxSalary: 'Maaş ≤', maxPrice: 'Fiyat ≤', currency: 'Para birimi', active: 'Aktif', incomplete: 'Maaş ≤, Fiyat ≤ ve adet (ya da Sınırsız) girilmeli', qty: 'Adet', unlimited: 'Sınırsız', boughtOf: '{n}/{q} alındı', boughtAll: '{n} alındı', qtyDone: 'Tamamlandı', resetCount: 'Sayacı sıfırla', needAll: 'Listedeki her aktif oyuncu için Maaş ≤, Fiyat ≤ ve adet girilmeli:', emptyWatch: 'Liste boş. Oyuncular sayfasından ya da yukarıdaki kutudan oyuncu ekle.', clearAll: 'Listeyi temizle', confirmClear: 'İzleme listesindeki tüm oyuncular silinsin mi?',
    accounts: 'Hesap önceliği', accountsHint: 'Alım 1. hesaptan başlar; parası bitince sıradakine geçilir. Oklarla sırala, kutuyla dahil et.', include: 'Dahil', apk: 'APK', tix: 'TIX',
    cannotBuy: '{name} ({price} {cur}) hiçbir hesapla alınamadı · {why} · tarama sürüyor',
    warnRegister: 'Auto Buy oyuna giriş yapmadan tarar; diğer otomasyonlarla aynı anda çalışır. Yalnızca oyuncu alırken ya da fiyat değiştirirken o hesaba girer: o hesapta çalışan Auto Play ve oturum açan otomasyonlar (Auto Trade, Kule) geçici olarak durdurulur, iş bitip hesap kapanınca yeniden başlatılır.'
  },
  en: {
    title: 'Auto Buy', subtitle: 'Players on the list are bought from the Trading Hall when every condition holds',
    start: 'Start Auto Buy', stop: 'Stop', interval: 'Scan every (s)',
    st: { idle: 'Ready', running: 'Running', stopped: 'Stopped', error: 'Error', noFunds: 'Stopped · not enough funds' },
    cycle: 'scan {n}', lastScan: 'last scan {t}', nextScan: 'next in {s}s', boughtN: '{n} bought', spent: 'spent {apk} APK · {tix} TIX', noFunds: 'The accounts do not have enough {cur}; no account can pay the lowest price on the list.',
    watch: 'Watch list', watchHint: 'A player is bought only when Salary ≤, Price ≤ and the currency all hold. Add players one by one or in bulk from the Players page.',
    add: 'Add a player…', player: 'Player', value: 'Value', base: 'Base', maxSalary: 'Salary ≤', maxPrice: 'Price ≤', currency: 'Currency', active: 'Active', incomplete: 'Fill in Salary ≤, Price ≤ and the quantity (or Unlimited)', qty: 'Quantity', unlimited: 'Unlimited', boughtOf: '{n}/{q} bought', boughtAll: '{n} bought', qtyDone: 'Done', resetCount: 'Reset counter', needAll: 'Salary ≤, Price ≤ and the quantity are needed for every active player:', emptyWatch: 'The list is empty. Add players from the Players page or the box above.', clearAll: 'Clear list', confirmClear: 'Remove every player from the watch list?',
    accounts: 'Account priority', accountsHint: 'Buying starts with account 1; when it runs out of funds the next one is used. Sort with the arrows, include with the box.', include: 'Use', apk: 'APK', tix: 'TIX',
    cannotBuy: 'No account could buy {name} ({price} {cur}) · {why} · still scanning',
    warnRegister: 'Auto Buy scans without signing in and runs next to the other automations. It signs in on an account only to buy or reprice: Auto Play and signed-in automations (Auto Trade, Tower) on that account are paused, then started again once the work is done and the account is closed.'
  }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
// Same rule as the service: salary and price always, the quantity unless Unlimited is ticked.
const unlimitedOf = r => r.unlimited !== false;
const ready = r => r.maxPrice !== '' && r.maxPrice != null && Number(r.maxPrice) >= 1 && r.maxSalary !== '' && r.maxSalary != null && Number(r.maxSalary) >= 0
  && (unlimitedOf(r) || (r.qty !== '' && r.qty != null && Number(r.qty) >= 1 && Number.isInteger(Number(r.qty))));

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
          : <button className="btn primary" disabled={!chosen.length || !watch.some(w => w.enabled !== false) || watch.some(w => w.enabled !== false && !ready(w))} title={watch.some(w => w.enabled !== false && !ready(w)) ? `${x.needAll} ${watch.filter(w => w.enabled !== false && !ready(w)).map(w => w.name).join(', ')}` : undefined} onClick={() => run(() => api.buy.startAuto({ accountIds: chosen, intervalSec: Number(interval) }))}>{x.start}</button>}
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
        <div className="panel table-panel">{watch.length ? <SortTable><thead><tr><th>{x.active}</th><th>{x.player}</th><th>{x.value}</th><th>{x.base}</th><th>{x.maxSalary}</th><th>{x.maxPrice}</th><th>{x.currency}</th><th>{x.qty}</th><th></th></tr></thead>
          <tbody>{watch.map(w => <WatchRow key={w.id} w={w} x={x} run={run} sortValues={[w.enabled !== false ? 1 : 0, w.name, w.value, w.base, w.maxSalary, w.maxPrice, w.currency, unlimitedOf(w) ? Infinity : Number(w.qty)]} />)}</tbody></SortTable> : <div className="empty">{x.emptyWatch}</div>}</div>
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
  const [v, setV] = useState({ maxSalary: w.maxSalary, maxPrice: w.maxPrice, qty: w.qty ?? 1 });
  useEffect(() => { setV({ maxSalary: w.maxSalary, maxPrice: w.maxPrice, qty: w.qty ?? 1 }); }, [w.maxSalary, w.maxPrice, w.qty]);
  const unlimited = unlimitedOf(w);
  const bought = Number(w.boughtCount || 0);
  const done = !unlimited && Number(w.qty) >= 1 && bought >= Number(w.qty);
  const save = patch => run(() => api.buy.updateWatch(w.id, patch));
  const ok = ready({ ...w, ...v });
  return <tr className={w.enabled === false ? 'row-dim' : ''}>
    <td><input type="checkbox" checked={w.enabled !== false} onChange={e => save({ enabled: e.target.checked })} /></td>
    <td><b>{w.name}</b><small className="cell-sub">{[w.team, w.position, w.rating].filter(Boolean).join(' · ')}</small>{!ok && <small className="cell-sub bad-text">{x.incomplete}</small>}</td>
    <td>{num(w.value)}</td><td>{num(w.base)}</td>
    <td><input className="price-input" type="number" min="0" value={v.maxSalary} onChange={e => setV(s => ({ ...s, maxSalary: e.target.value }))} onBlur={() => String(v.maxSalary) !== String(w.maxSalary) && save({ maxSalary: v.maxSalary })} /></td>
    <td><input className="price-input" type="number" min="1" value={v.maxPrice} onChange={e => setV(s => ({ ...s, maxPrice: e.target.value }))} onBlur={() => String(v.maxPrice) !== String(w.maxPrice) && save({ maxPrice: v.maxPrice })} /></td>
    <td><span className="currency-toggle">{['APK', 'TIX'].map(c => <button type="button" key={c} className={w.currency === c ? 'on' : ''} onClick={() => save({ currency: c })}>{c}</button>)}</span></td>
    <td className="ab-qty"><label className="ab-unl"><input type="checkbox" checked={unlimited} onChange={e => save(e.target.checked ? { unlimited: true } : { unlimited: false, qty: Number(w.qty) >= 1 ? Number(w.qty) : 1 })} />{x.unlimited}</label><input className="price-input ab-qty-input" type="number" min="1" step="1" disabled={unlimited} value={unlimited ? '' : v.qty} placeholder={unlimited ? '∞' : '1'} onChange={e => setV(s => ({ ...s, qty: e.target.value.replace(/[^0-9]/g, '') }))} onBlur={() => { const q = Math.max(1, Math.floor(Number(v.qty) || 1)); setV(s => ({ ...s, qty: q })); if (q !== Number(w.qty)) save({ qty: q }); }} />
      <small className={`ab-qty-note ${done ? 'good-text' : ''}`}>{done ? `✓ ${x.qtyDone} · ` : ''}{unlimited ? fill(x.boughtAll, { n: bought }) : fill(x.boughtOf, { n: bought, q: w.qty || 1 })}{bought > 0 && <button type="button" className="ab-qty-reset" title={x.resetCount} onClick={() => save({ resetCount: true })}>↺</button>}</small></td>
    <td className="actions"><button className="icon-btn danger" onClick={() => run(() => api.buy.removeWatch([w.id]))}>×</button></td>
  </tr>;
}
