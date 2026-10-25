import { useEffect, useRef, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;
const num = v => v == null || v === '' ? '—' : Number(v).toLocaleString();
export const BUY_TEXT = {
  tr: {
    buy: 'Satın Al', buying: 'Alınıyor…', bought: 'Alındı', chooseAccount: 'Hangi hesapla alınsın?', notEnough: 'yetersiz', noAccounts: 'Hesap yok',
    boughtTitle: 'Satın alınanlar', boughtHint: 'Fiyat ve para birimi seçip pazara koy. Pazardaysa önce çekilir, yeni fiyatla tekrar konur.', none: 'Henüz satın alınan oyuncu yok.',
    account: 'Hesap', player: 'Oyuncu', paid: 'Ödenen', salary: 'Maaş', base: 'Base', status: 'Durum', newPrice: 'Yeni fiyat', from: 'Nereden',
    owned: 'Kadroda', listed: 'Pazarda · {price} {cur}', parked: 'Pazarda · 9.999.999 TIX (bekliyor)', sell: 'Satışa koy', reprice: 'Fiyatı güncelle', remove: 'Listeden kaldır', hall: 'Trading Hall', auto: 'Auto Buy',
    filterAll: 'Tümü', filterHall: 'Trading Hall', filterAuto: 'Auto Buy', okBought: '{name} alındı', invalid: 'Geçersiz fiyat'
  },
  en: {
    buy: 'Buy', buying: 'Buying…', bought: 'Bought', chooseAccount: 'Buy with which account?', notEnough: 'not enough', noAccounts: 'No accounts',
    boughtTitle: 'Bought players', boughtHint: 'Pick a price and currency and list them. A listed player is taken off first and listed again at the new price.', none: 'No bought players yet.',
    account: 'Account', player: 'Player', paid: 'Paid', salary: 'Salary', base: 'Base', status: 'Status', newPrice: 'New price', from: 'From',
    owned: 'In roster', listed: 'On the market · {price} {cur}', parked: 'On the market · 9,999,999 TIX (waiting)', sell: 'List for sale', reprice: 'Update price', remove: 'Remove from list', hall: 'Trading Hall', auto: 'Auto Buy',
    filterAll: 'All', filterHall: 'Trading Hall', filterAuto: 'Auto Buy', okBought: '{name} bought', invalid: 'Invalid price'
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

const HINT = {
  tr: { ask: 'Öner', asking: '…', none: 'Pazarda başka ilan yok', cheapest: 'En ucuz rakip {p} {cur} ({n} ilan) · önerilen {s}', mine: 'senin en ucuzun {p}', fail: 'okunamadı' },
  en: { ask: 'Suggest', asking: '…', none: 'No other listing on the market', cheapest: 'Cheapest other {p} {cur} ({n} listings) · suggested {s}', mine: 'your cheapest {p}', fail: 'could not read' },
  get fil() { return filOf(this.en); }
};
// "Suggest": reads the cheapest competing listing of the player in this currency and
// fills the price one below it.
export function PriceHint({ playerId, name, currency, lang, onPick }) {
  const h = HINT[lang] || HINT.en;
  const [state, setState] = useState(null);
  const ask = async () => {
    setState('busy');
    try {
      const r = await api.buy.cheapest({ playerId, name, currency });
      setState(r);
      if (r?.suggested) onPick?.(r.suggested);
    } catch { setState('fail'); }
  };
  const text = state === 'fail' ? h.fail : state && state !== 'busy' ? (state.cheapest == null ? h.none : fill(h.cheapest, { p: num(state.cheapest), cur: currency, n: state.count, s: num(state.suggested) }) + (state.ownCheapest != null ? ' · ' + fill(h.mine, { p: num(state.ownCheapest) }) : '')) : '';
  return <span className="price-hint"><button type="button" className="btn ghost small" disabled={state === 'busy' || !playerId} onClick={ask}>{state === 'busy' ? h.asking : h.ask}</button>{text && <small title={text}>{text}</small>}</span>;
}

// "Buy" + account menu for one listing. Accounts are sorted by the listing's currency
// (most first); the ones that cannot pay are shown greyed out and cannot be picked.
// The menu closes on a pick or on a click anywhere else.
export function BuyMenu({ row, state, lang, toast }) {
  const x = BUY_TEXT[lang] || BUY_TEXT.en;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const busy = Boolean(state.buy?.busy?.[row.id]);
  const done = (state.buy?.bought || []).some(e => e.ticketId === row.id);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close, true); document.removeEventListener('keydown', esc); };
  }, [open]);
  const key = row.currency === 'TIX' ? 'tix' : 'apk';
  const stats = state.accountProfile?.accounts || {};
  const accounts = (state.accounts || []).map(a => ({ ...a, bal: Number(stats[a.id]?.[key]) })).sort((a, b) => (Number.isFinite(b.bal) ? b.bal : -1) - (Number.isFinite(a.bal) ? a.bal : -1));
  const pick = async a => {
    setOpen(false);
    try {
      const r = await api.buy.buy(a.id, row);
      if (r?.ok) toast(fill(x.okBought, { name: row.name }), 'success'); else toast(r?.message || 'Error', 'error');
    } catch (e) { toast(e.message, 'error'); }
  };
  if (done) return <span className="pill ok"><i />{x.bought}</span>;
  return <div className="buy-menu" ref={ref} onClick={e => e.stopPropagation()}>
    <button type="button" className="btn success small" disabled={busy} onClick={e => {
      // Fixed position: the table scrolls and would cut the menu off.
      const r = e.currentTarget.getBoundingClientRect();
      const below = window.innerHeight - r.bottom > 300;
      setPos({ right: Math.max(8, window.innerWidth - r.right), ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }) });
      setOpen(o => !o);
    }}>{busy ? x.buying : x.buy} ▾</button>
    {open && <div className="buy-pop" style={pos || undefined}>
      <b>{x.chooseAccount}</b><small>{num(row.price)} {row.currency}</small>
      {accounts.length ? accounts.map(a => { const can = Number.isFinite(a.bal) && a.bal >= row.price; return <button type="button" key={a.id} disabled={!can} className={can ? '' : 'off'} onClick={() => pick(a)}>
        <span>{a.name}</span><em>{Number.isFinite(a.bal) ? num(a.bal) : '—'} {row.currency}{can ? '' : ` · ${x.notEnough}`}</em></button>; }) : <p className="muted-text">{x.noAccounts}</p>}
    </div>}
  </div>;
}

// Players bought from the Trading Hall or by Auto Buy: price them and list them.
export function BoughtList({ state, lang, toast, source = null }) {
  const x = BUY_TEXT[lang] || BUY_TEXT.en;
  const [edits, setEdits] = useState({});
  const [filter, setFilter] = useState(source || '');
  const rows = (state.buy?.bought || []).filter(e => !filter || e.source === filter);
  const busy = state.buy?.busy || {};
  const name = id => (state.accounts || []).find(a => a.id === id)?.name || id;
  const get = e => ({ price: e.listPrice && e.listPrice !== state.buy?.parkPrice ? e.listPrice : '', currency: e.listCurrency && e.listPrice !== state.buy?.parkPrice ? e.listCurrency : e.currency, ...edits[e.id] });
  const edit = (id, patch) => setEdits(s => ({ ...s, [id]: { ...s[id], ...patch } }));
  const sell = async e => {
    const v = get(e);
    if (!(Number(v.price) >= 1)) { toast(x.invalid, 'error'); return; }
    try { await api.buy.sell(e.id, Number(v.price), v.currency); setEdits(s => { const n = { ...s }; delete n[e.id]; return n; }); } catch (err) { toast(err.message, 'error'); }
  };
  return <section className="bought-list">
    <h3 className="section-title">{x.boughtTitle} <small>{x.boughtHint}</small></h3>
    {!source && <div className="bought-filter">{[['', x.filterAll], ['hall', x.filterHall], ['auto', x.filterAuto]].map(([k, l]) => <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>}
    <div className="panel table-panel">{rows.length ? <SortTable><thead><tr><th>{x.account}</th><th>{x.player}</th><th>{x.paid}</th><th>{x.salary}</th><th>{x.base}</th><th>{x.status}</th><th>{x.newPrice}</th><th></th></tr></thead>
      <tbody>{rows.map(e => { const v = get(e); const parked = e.state === 'listed' && e.listPrice === state.buy?.parkPrice; return <tr key={e.id}>
        <td>{name(e.accountId)}{!source && <small className="cell-sub">{e.source === 'auto' ? x.auto : x.hall}</small>}</td>
        <td><b>{e.name}</b>{e.salary != null && e.base > 0 && e.salary <= e.base && <span className="base-badge">BASE</span>}{e.position && <small className="cell-sub">{e.position} · {e.grade}</small>}</td>
        <td><b className="price">{num(e.boughtPrice)}</b> {e.currency}</td><td>{num(e.salary)}</td><td>{num(e.base)}</td>
        <td>{e.state === 'listed' ? <span className={`pill ${parked ? 'warn' : 'ok'}`}><i />{parked ? x.parked : fill(x.listed, { price: num(e.listPrice), cur: e.listCurrency })}</span> : <span className="pill muted"><i />{x.owned}</span>}</td>
        <td><span className="bought-price"><input className="price-input" type="number" min="1" value={v.price} onChange={ev => edit(e.id, { price: ev.target.value })} /><span className="currency-toggle">{['APK', 'TIX'].map(c => <button type="button" key={c} className={v.currency === c ? 'on' : ''} onClick={() => edit(e.id, { currency: c })}>{c}</button>)}</span><PriceHint playerId={e.playerId} name={e.name} currency={v.currency} lang={lang} onPick={p => edit(e.id, { price: p })} /></span></td>
        <td className="actions"><button className="btn primary small" disabled={busy[e.id]} onClick={() => sell(e)}>{e.state === 'listed' ? x.reprice : x.sell}</button><button className="icon-btn" title={x.remove} onClick={() => api.buy.removeBought([e.id])}>×</button></td>
      </tr>; })}</tbody></SortTable> : <div className="empty">{x.none}</div>}</div>
  </section>;
}
