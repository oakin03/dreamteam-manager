import { useEffect, useMemo, useState } from 'react';
import { BoughtList } from './BuyParts';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import InjuryMark from './InjuryMark';

const api = window.dreamteam;
const num = v => v == null || v === '' ? '—' : Number(v).toLocaleString();
const TEXT = {
  tr: {
    title: 'Auto Buy', subtitle: 'Listedeki oyuncular koşulları sağlayınca Trading Hall\'dan otomatik alınır',
    start: 'Auto Buy Başlat', stop: 'Durdur', interval: 'Tarama aralığı (sn)',
    st: { idle: 'Hazır', running: 'Çalışıyor', stopped: 'Durduruldu', error: 'Hata', noFunds: 'Durdu · bakiye yetersiz' },
    cycle: '{n}. tarama', cycleTook: 'tur {s} sn ({n} oyuncu)', lastScan: 'son tarama {t}', nextScan: 'sonraki {s} sn', boughtN: '{n} oyuncu alındı', spent: 'harcanan {apk} APK · {tix} TIX', noFunds: 'Hesapların {cur} miktarı yetersiz; listedeki en düşük fiyatı karşılayan hesap kalmadı.',
    listSearch: 'Listede ara…', noListMatch: 'Aramaya uyan oyuncu yok.', watch: 'İzleme listesi', watchHint: 'Bir oyuncu ancak Maaş ≤, Fiyat ≤ ve para birimi koşullarının hepsini sağlarsa alınır. Oyuncular sayfasından tek tek ya da toplu eklenebilir.',
    add: 'Oyuncu ekle…', player: 'Oyuncu', value: 'Değer', base: 'Base', maxSalary: 'Maaş aralığı', maxPrice: 'Fiyat ≤', addRange: '+ Maaş aralığı', addRangeHint: 'Bu oyuncu için başka bir maaş aralığı ve fiyat ekle (ör. 0–2318 bir fiyat, 2319–2347 başka fiyat)', rangeOverlap: 'Bu aralık başka bir aralıkla çakışıyor', rangeBad: 'Alt sınır üst sınırdan büyük', minPh: '0', currency: 'Para birimi', active: 'Aktif', incomplete: 'Maaş ≤, Fiyat ≤ ve adet (ya da Sınırsız) girilmeli', qty: 'Adet', unlimited: 'Sınırsız', boughtOf: '{n}/{q} alındı', boughtAll: '{n} alındı', qtyDone: 'Tamamlandı', resetCount: 'Sayacı sıfırla', needAll: 'Listedeki her aktif oyuncu için Maaş ≤, Fiyat ≤ ve adet girilmeli:', emptyWatch: 'Liste boş. Oyuncular sayfasından ya da yukarıdaki kutudan oyuncu ekle.', clearAll: 'Listeyi temizle', confirmClear: 'İzleme listesindeki tüm oyuncular silinsin mi?',
    accounts: 'Hesap önceliği', accountsHint: 'Alım 1. hesaptan başlar; parası bitince sıradakine geçilir. Satırı basılı tutup sürükleyerek sırala, kutuyla dahil et.', dragHint: 'Basılı tutup sürükle', hiddenLow: '20 APK ve 20 TIX altında olan {n} hesap gösterilmiyor (alım yapamaz).', include: 'Dahil', apk: 'APK', tix: 'TIX',
    cannotBuy: '{name} ({price} {cur}) hiçbir hesapla alınamadı · {why} · tarama sürüyor',
    warnRegister: 'Auto Buy oyuna giriş yapmadan tarar; diğer otomasyonlarla aynı anda çalışır. Yalnızca oyuncu alırken ya da fiyat değiştirirken o hesaba girer: o hesapta çalışan Auto Play ve oturum açan otomasyonlar (Auto Trade, Kule) geçici olarak durdurulur, iş bitip hesap kapanınca yeniden başlatılır.'
  },
  en: {
    title: 'Auto Buy', subtitle: 'Players on the list are bought from the Trading Hall when every condition holds',
    start: 'Start Auto Buy', stop: 'Stop', interval: 'Scan every (s)',
    st: { idle: 'Ready', running: 'Running', stopped: 'Stopped', error: 'Error', noFunds: 'Stopped · not enough funds' },
    cycle: 'scan {n}', cycleTook: 'scan took {s}s ({n} players)', lastScan: 'last scan {t}', nextScan: 'next in {s}s', boughtN: '{n} bought', spent: 'spent {apk} APK · {tix} TIX', noFunds: 'The accounts do not have enough {cur}; no account can pay the lowest price on the list.',
    listSearch: 'Search the list…', noListMatch: 'No player on the list matches.', watch: 'Watch list', watchHint: 'A player is bought only when Salary ≤, Price ≤ and the currency all hold. Add players one by one or in bulk from the Players page.',
    add: 'Add a player…', player: 'Player', value: 'Value', base: 'Base', maxSalary: 'Salary range', maxPrice: 'Price ≤', addRange: '+ Salary range', addRangeHint: 'Add another salary range with its own price for this player (e.g. 0–2318 one price, 2319–2347 another)', rangeOverlap: 'This range overlaps another one', rangeBad: 'The lower limit is above the upper limit', minPh: '0', currency: 'Currency', active: 'Active', incomplete: 'Fill in Salary ≤, Price ≤ and the quantity (or Unlimited)', qty: 'Quantity', unlimited: 'Unlimited', boughtOf: '{n}/{q} bought', boughtAll: '{n} bought', qtyDone: 'Done', resetCount: 'Reset counter', needAll: 'Salary ≤, Price ≤ and the quantity are needed for every active player:', emptyWatch: 'The list is empty. Add players from the Players page or the box above.', clearAll: 'Clear list', confirmClear: 'Remove every player from the watch list?',
    accounts: 'Account priority', accountsHint: 'Buying starts with account 1; when it runs out of funds the next one is used. Press and drag a row to sort, include with the box.', dragHint: 'Press and drag', hiddenLow: '{n} account(s) with less than 20 APK and 20 TIX are not shown (they cannot buy).', include: 'Use', apk: 'APK', tix: 'TIX',
    cannotBuy: 'No account could buy {name} ({price} {cur}) · {why} · still scanning',
    warnRegister: 'Auto Buy scans without signing in and runs next to the other automations. It signs in on an account only to buy or reprice: Auto Play and signed-in automations (Auto Trade, Tower) on that account are paused, then started again once the work is done and the account is closed.'
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
// Same rule as the service: salary and price always, the quantity unless Unlimited is ticked.
const unlimitedOf = r => r.unlimited !== false;
const minOf = r => (r.minSalary === '' || r.minSalary == null || !Number.isFinite(Number(r.minSalary)) ? 0 : Number(r.minSalary));
const ready = r => r.maxPrice !== '' && r.maxPrice != null && Number(r.maxPrice) >= 1 && r.maxSalary !== '' && r.maxSalary != null && Number(r.maxSalary) >= 0 && minOf(r) <= Number(r.maxSalary)
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
  // Accounts with less than 20 APK and less than 20 TIX buy nothing: not listed (user 2026-11-13).
  const MIN_BALANCE = 20;
  const canBuy = id => (Number(stats[id]?.apk) || 0) >= MIN_BALANCE || (Number(stats[id]?.tix) || 0) >= MIN_BALANCE;
  // The whole row moves: press, hold and drag it over another row (user 2026-11-13).
  const [drag, setDrag] = useState(null);   // { id, over }
  const moveTo = (from, to) => setOrder(o => { if (from === to) return o; const n = o.filter(id => id !== from); const at = n.indexOf(to); const i = o.indexOf(from) < o.indexOf(to) ? at + 1 : at; n.splice(i, 0, from); return n; });
  const toggleInc = id => setIncluded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const chosen = order.filter(id => included.has(id) && canBuy(id));
  const hiddenN = order.filter(id => accounts.some(a => a.id === id) && !canBuy(id)).length;
  // value, Base, team and rating come from the current player list (they change every day);
  // the saved copy is only the fallback
  const live = useMemo(() => new Map((state.players?.players || []).map(p => [p.id, p])), [state.players]);
  const [listQ, setListQ] = useState('');
  const watch = useMemo(() => (b.watch || []).map(w => { const p = live.get(w.playerId); return p ? { ...w, value: p.value, base: p.base, team: p.team || w.team, rating: p.rating || w.rating, position: p.position || w.position } : w; }), [b.watch, live]);
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
        <label className="ab-interval"><span>{x.interval}</span><input type="number" min="1" max="600" value={interval} disabled={running} onChange={e => setIntervalSec(e.target.value)} /></label>
        {running ? <button className="btn danger-soft" onClick={() => run(() => api.buy.stopAuto())}>{x.stop}</button>
          : <button className="btn primary" disabled={!chosen.length || !watch.some(w => w.enabled !== false) || watch.some(w => w.enabled !== false && !ready(w))} title={watch.some(w => w.enabled !== false && !ready(w)) ? `${x.needAll} ${watch.filter(w => w.enabled !== false && !ready(w)).map(w => w.name).join(', ')}` : undefined} onClick={() => run(() => api.buy.startAuto({ accountIds: chosen, intervalSec: Number(interval) }))}>{x.start}</button>}
      </div></div>

    <div className={`panel ab-status ${tone}`}>
      <span className={`pill ${tone}`}><i />{x.st[auto.status] || auto.status}</span>
      {auto.cycle > 0 && <span>{fill(x.cycle, { n: auto.cycle })}</span>}
      {auto.lastCycleMs != null && <span className="muted-text">{fill(x.cycleTook, { s: (auto.lastCycleMs / 1000).toFixed(1), n: auto.lastCycle?.players ?? 0 })}</span>}
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
          {suggestions.length > 0 && <div className="ab-sugg">{suggestions.map(p => <button key={p.id} onClick={() => run(async () => { await api.buy.addWatch([p]); setQ(''); })}><b>{p.name}</b><InjuryMark name={p.name} /><small>{p.team} · {p.position} · {p.rating} · {num(p.value)}</small></button>)}</div>}
          {watch.length > 0 && <button className="btn ghost small" onClick={() => { if (window.confirm(x.confirmClear)) run(() => api.buy.removeWatch(watch.map(w => w.id))); }}>{x.clearAll}</button>}
        </div>
        {watch.length > 0 && <input className="guide-search ab-list-search" placeholder={x.listSearch} value={listQ} onChange={e => setListQ(e.target.value)} />}
        {(() => { const ls = listQ.trim().toLocaleLowerCase('tr-TR'); const shown = ls ? watch.filter(w => `${w.name || ''} ${w.team || ''}`.toLocaleLowerCase('tr-TR').includes(ls)) : watch; return ls && !shown.length ? <div className="panel"><p className="muted-text dp-pad">{x.noListMatch}</p></div> : null; })()}
        <div className="panel table-panel">{watch.length ? <SortTable><thead><tr><th>{x.active}</th><th>{x.player}</th><th>{x.value}</th><th>{x.base}</th><th>{x.maxSalary}</th><th>{x.maxPrice}</th><th>{x.currency}</th><th>{x.qty}</th><th></th></tr></thead>
          <tbody>{watch.filter(w => { const ls = listQ.trim().toLocaleLowerCase('tr-TR'); return !ls || `${w.name || ''} ${w.team || ''}`.toLocaleLowerCase('tr-TR').includes(ls); }).map((w, i, shownList) => { const head = watch.find(o => o.playerId === w.playerId); const sib = watch.filter(o => o.playerId === w.playerId && o.currency === w.currency && o.id !== w.id); const overlap = sib.some(o => o.maxSalary !== '' && o.maxSalary != null && w.maxSalary !== '' && w.maxSalary != null && minOf(w) <= Number(o.maxSalary) && minOf(o) <= Number(w.maxSalary)); return <WatchRow key={w.id} w={w} x={x} run={run} child={head.id !== w.id} last={!shownList.slice(i + 1).some(o => o.playerId === w.playerId)} overlap={overlap} sortValues={[head.enabled !== false ? 1 : 0, head.name, head.value, head.base, head.maxSalary, head.maxPrice, head.currency, unlimitedOf(head) ? Infinity : Number(head.qty)]} />; })}</tbody></SortTable> : <div className="empty">{x.emptyWatch}</div>}</div>
      </section>

      <section>
        <h3 className="section-title">{x.accounts}</h3>
        <p className="muted-text ab-hint">{x.accountsHint}</p>
        <div className="panel ab-accounts">{order.map(id => { const a = accounts.find(v => v.id === id); if (!a || !canBuy(id)) return null; const inc = included.has(id); const rank = chosen.indexOf(id);
          return <div key={id} className={`ab-acc ${inc ? '' : 'off'} ${drag?.id === id ? 'dragging' : ''} ${drag && drag.over === id && drag.id !== id ? 'drop-here' : ''}`}
            draggable={!running} title={running ? undefined : x.dragHint}
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', id); } catch {} setDrag({ id, over: id }); }}
            onDragOver={e => { if (!drag) return; e.preventDefault(); if (drag.over !== id) setDrag(d => d && { ...d, over: id }); }}
            onDrop={e => { e.preventDefault(); if (drag) moveTo(drag.id, id); setDrag(null); }}
            onDragEnd={() => setDrag(null)}>
            <span className="ab-rank">{inc ? rank + 1 : '–'}</span>
            <input type="checkbox" checked={inc} disabled={running} onChange={() => toggleInc(id)} title={x.include} />
            <b>{a.name}</b>
            <em>{num(stats[id]?.apk)} {x.apk}</em><em>{num(stats[id]?.tix)} {x.tix}</em>
            <span className="ab-grip" aria-hidden="true">⋮⋮</span>
          </div>; })}</div>
        {hiddenN > 0 && <p className="muted-text ab-hint">{fill(x.hiddenLow, { n: hiddenN })}</p>}
        <p className="muted-text ab-hint">{x.warnRegister}</p>
      </section>
    </div>

    <BoughtList state={state} lang={t.lang} toast={toast} source="auto" />
  </div>;
}

// One watch row; numbers are saved when the field loses focus.
function WatchRow({ w, x, run, child = false, last = true, overlap = false }) {
  const [v, setV] = useState({ minSalary: w.minSalary ?? '', maxSalary: w.maxSalary, maxPrice: w.maxPrice, qty: w.qty ?? 1 });
  useEffect(() => { setV({ minSalary: w.minSalary ?? '', maxSalary: w.maxSalary, maxPrice: w.maxPrice, qty: w.qty ?? 1 }); }, [w.minSalary, w.maxSalary, w.maxPrice, w.qty]);
  const unlimited = unlimitedOf(w);
  const bought = Number(w.boughtCount || 0);
  const done = !unlimited && Number(w.qty) >= 1 && bought >= Number(w.qty);
  const save = patch => run(() => api.buy.updateWatch(w.id, patch));
  const ok = ready({ ...w, ...v });
  const bad = v.maxSalary !== '' && v.maxSalary != null && minOf(v) > Number(v.maxSalary);
  return <tr className={`${w.enabled === false ? 'row-dim' : ''} ${child ? 'ab-range-row' : ''}`}>
    <td><input type="checkbox" checked={w.enabled !== false} onChange={e => save({ enabled: e.target.checked })} /></td>
    <td>{child ? <span className="ab-range-mark">↳ <span className="muted-text">{w.name}</span></span> : <><b>{w.name}</b><InjuryMark name={w.name} /><small className="cell-sub">{[w.team, w.position, w.rating].filter(Boolean).join(' · ')}</small></>}{!ok && <small className="cell-sub bad-text">{x.incomplete}</small>}{last && <button type="button" className="link-btn ab-add-range" title={x.addRangeHint} onClick={() => run(() => api.buy.addRange(w.id))}>{x.addRange}</button>}</td>
    <td>{child ? '' : num(w.value)}</td><td>{child ? '' : num(w.base)}</td>
    <td className="ab-range"><input className="price-input ab-min" type="number" min="0" placeholder={x.minPh} value={v.minSalary} onChange={e => setV(s => ({ ...s, minSalary: e.target.value }))} onBlur={() => String(v.minSalary ?? '') !== String(w.minSalary ?? '') && save({ minSalary: v.minSalary })} /><span>–</span><input className="price-input" type="number" min="0" value={v.maxSalary} onChange={e => setV(s => ({ ...s, maxSalary: e.target.value }))} onBlur={() => String(v.maxSalary) !== String(w.maxSalary) && save({ maxSalary: v.maxSalary })} />{(bad || overlap) && <small className="cell-sub bad-text">{bad ? x.rangeBad : x.rangeOverlap}</small>}</td>
    <td><input className="price-input" type="number" min="1" value={v.maxPrice} onChange={e => setV(s => ({ ...s, maxPrice: e.target.value }))} onBlur={() => String(v.maxPrice) !== String(w.maxPrice) && save({ maxPrice: v.maxPrice })} /></td>
    <td><span className="currency-toggle">{['APK', 'TIX'].map(c => <button type="button" key={c} className={w.currency === c ? 'on' : ''} onClick={() => save({ currency: c })}>{c}</button>)}</span></td>
    <td className="ab-qty"><label className="ab-unl"><input type="checkbox" checked={unlimited} onChange={e => save(e.target.checked ? { unlimited: true } : { unlimited: false, qty: Number(w.qty) >= 1 ? Number(w.qty) : 1 })} />{x.unlimited}</label><input className="price-input ab-qty-input" type="number" min="1" step="1" disabled={unlimited} value={unlimited ? '' : v.qty} placeholder={unlimited ? '∞' : '1'} onChange={e => setV(s => ({ ...s, qty: e.target.value.replace(/[^0-9]/g, '') }))} onBlur={() => { const q = Math.max(1, Math.floor(Number(v.qty) || 1)); setV(s => ({ ...s, qty: q })); if (q !== Number(w.qty)) save({ qty: q }); }} />
      <small className={`ab-qty-note ${done ? 'good-text' : ''}`}>{done ? `✓ ${x.qtyDone} · ` : ''}{unlimited ? fill(x.boughtAll, { n: bought }) : fill(x.boughtOf, { n: bought, q: w.qty || 1 })}{bought > 0 && <button type="button" className="ab-qty-reset" title={x.resetCount} onClick={() => save({ resetCount: true })}>↺</button>}</small></td>
    <td className="actions"><button className="icon-btn danger" onClick={() => run(() => api.buy.removeWatch([w.id]))}>×</button></td>
  </tr>;
}
