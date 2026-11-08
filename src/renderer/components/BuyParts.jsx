import { useEffect, useRef, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import InjuryMark from './InjuryMark';

const api = window.dreamteam;
const num = v => v == null || v === '' ? '—' : Number(v).toLocaleString();
export const BUY_TEXT = {
  tr: {
    buy: 'Satın Al', buying: 'Alınıyor…', bought: 'Alındı', chooseAccount: 'Hangi hesapla alınsın?', notEnough: 'yetersiz', noAccounts: 'Hesap yok',
    boughtTitle: 'Satın alınanlar', boughtHint: 'Fiyat ve para birimi seçip pazara koy. Pazardaysa önce çekilir, yeni fiyatla tekrar konur.', none: 'Henüz satın alınan oyuncu yok.',
    account: 'Hesap', player: 'Oyuncu', paid: 'Ödenen', salary: 'Maaş', base: 'Base', status: 'Durum', newPrice: 'Yeni fiyat', from: 'Nereden',
    owned: 'Kadroda', listed: 'Pazarda · {price} {cur}', parked: 'Pazarda · 9.999.999 TIX (bekliyor)', sell: 'Satışa koy', reprice: 'Fiyatı güncelle', remove: 'Listeden kaldır', fire: 'Pazardan çıkar ve kov', fireSel: 'Seçilileri pazardan çıkar ve kov', relistSel: 'Seçilileri tekrar listele', selected: '{count} seçili', fireTitle: 'Oyuncular kovulsun mu?', fireAsk: '{names} pazardan çekilip kovulacak. Bu geri alınamaz.', fireYes: 'Kov', okFired: '{count} oyuncu kovuldu', okRelisted: '{count} oyuncu listelendi', hall: 'Trading Hall', auto: 'Auto Buy',
    filterAll: 'Tümü', filterHall: 'Trading Hall', filterAuto: 'Auto Buy', okBought: '{name} alındı', invalid: 'Geçersiz fiyat',
    convert: 'Karta çevir', converting: 'Çevriliyor…', converted: 'Karta çevrildi', convertTitle: '{name} karta çevrilsin mi?', convertAsk: 'Oyuncu yıldız karta çevrilir ve kadrodan çıkar; geri alınamaz. Pazardaysa önce pazardan çekilir.', convertYes: 'Karta çevir', cancel: 'Vazgeç',
    warnLow: 'Maaşı ({salary}) değerinin ({value}) çok altında (%{pct}). Satarsan daha çok kazanabilirsin.', warnBase: 'Bu bir Base oyuncu (maaşı Base seviyesinde).', okConverted: '{name} karta çevrildi', value: 'Değer',
    clearList: 'Hepsini temizle', clearListAsk: 'Listedeki {n} kayıt silinsin mi? Yalnızca bu listeden silinir; oyuncular oyunda olduğu gibi kalır.', clearListYes: 'Temizle',
    bulkSel: '{n} ilan seçili', bulkCost: 'toplam {sum}', bulkBuy: 'Hepsini al', bulkCard: 'Hepsini al ve karta çevir', bulkClear: 'Seçimi kaldır', bulkPick: 'Hangi hesap alsın?', bulkPickCard: 'Hangi hesap alıp karta çevirsin?',
    bulkPickHint: 'Seçili ilanlar sırayla tek tek alınır. Hesabın APK / TIX\'i bir ilana yetmeyince orada durur.', bulkCardHint: 'Her oyuncu alındıktan 1 saniye sonra yıldız karta çevrilir (geri alınamaz), sonra sıradaki alınır.',
    bulkAfford: '{k}/{n} ilana yeter', bulkRunning: 'Toplu alım · {done}/{total} · {bought} alındı', bulkRunningCard: 'Toplu alım · {done}/{total} · {bought} alındı · {converted} karta çevrildi', bulkNow: 'şimdi: {name}', bulkStop: 'Durdur',
    bulkDone: 'Toplu alım bitti · {bought}/{total} alındı', bulkDoneCard: 'Toplu alım bitti · {bought}/{total} alındı · {converted} karta çevrildi', bulkWhy: { funds: 'hesabın parası yetmedi', stopped: 'durduruldu', error: 'hata' }, bulkStarted: 'Toplu alım başladı · {n} ilan'
  },
  en: {
    buy: 'Buy', buying: 'Buying…', bought: 'Bought', chooseAccount: 'Buy with which account?', notEnough: 'not enough', noAccounts: 'No accounts',
    boughtTitle: 'Bought players', boughtHint: 'Pick a price and currency and list them. A listed player is taken off first and listed again at the new price.', none: 'No bought players yet.',
    account: 'Account', player: 'Player', paid: 'Paid', salary: 'Salary', base: 'Base', status: 'Status', newPrice: 'New price', from: 'From',
    owned: 'In roster', listed: 'On the market · {price} {cur}', parked: 'On the market · 9,999,999 TIX (waiting)', sell: 'List for sale', reprice: 'Update price', remove: 'Remove from list', fire: 'Take off market and fire', fireSel: 'Take selected off market and fire', relistSel: 'List selected again', selected: '{count} selected', fireTitle: 'Fire the players?', fireAsk: '{names} will be taken off the market and fired. This cannot be undone.', fireYes: 'Fire', okFired: '{count} player(s) fired', okRelisted: '{count} player(s) listed', hall: 'Trading Hall', auto: 'Auto Buy',
    filterAll: 'All', filterHall: 'Trading Hall', filterAuto: 'Auto Buy', okBought: '{name} bought', invalid: 'Invalid price',
    convert: 'Turn into card', converting: 'Converting…', converted: 'Turned into a card', convertTitle: 'Turn {name} into a card?', convertAsk: 'The player becomes a star card and leaves the roster; this cannot be undone. A listed player is taken off the market first.', convertYes: 'Turn into card', cancel: 'Cancel',
    warnLow: 'The salary ({salary}) is far below the value ({value}) ({pct}%). Selling could earn more.', warnBase: 'This is a Base player (salary at its Base).', okConverted: '{name} turned into a card', value: 'Value',
    clearList: 'Clear all', clearListAsk: 'Remove the {n} row(s) of this list? They are only removed from this list; the players stay as they are in the game.', clearListYes: 'Clear',
    bulkSel: '{n} listing(s) selected', bulkCost: 'total {sum}', bulkBuy: 'Buy all', bulkCard: 'Buy all and turn into cards', bulkClear: 'Clear selection', bulkPick: 'Which account buys them?', bulkPickCard: 'Which account buys them and turns them into cards?',
    bulkPickHint: 'The selected listings are bought one by one. It stops at the first listing the account\'s APK / TIX cannot pay.', bulkCardHint: 'Each player is turned into a star card 1 second after it is bought (cannot be undone), then the next one is bought.',
    bulkAfford: 'pays {k}/{n}', bulkRunning: 'Bulk buy · {done}/{total} · {bought} bought', bulkRunningCard: 'Bulk buy · {done}/{total} · {bought} bought · {converted} turned into cards', bulkNow: 'now: {name}', bulkStop: 'Stop',
    bulkDone: 'Bulk buy finished · {bought}/{total} bought', bulkDoneCard: 'Bulk buy finished · {bought}/{total} bought · {converted} turned into cards', bulkWhy: { funds: 'the account ran out of money', stopped: 'stopped', error: 'error' }, bulkStarted: 'Bulk buy started · {n} listing(s)'
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

// "Turn into card" warns when the salary is below this share of the player's value.
const LOW_SALARY_SHARE = 0.8;

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
// Selection and typed prices survive leaving the page (user 2026-11-06): kept per list here.
const BOUGHT_UI = new Map();

export function BoughtList({ state, lang, toast, source = null, title = null, hint = null }) {
  const x = BUY_TEXT[lang] || BUY_TEXT.en;
  const uiKey = source || 'all';
  const [edits, setEdits] = useState(() => BOUGHT_UI.get(uiKey)?.edits || {});
  const [filter, setFilter] = useState(source || '');
  const rows = (state.buy?.bought || []).filter(e => !filter || e.source === filter);
  const busy = state.buy?.busy || {};
  const name = id => (state.accounts || []).find(a => a.id === id)?.name || id;
  const mainId = state.accountProfile?.mainAccountId || null;
  const live = new Map((state.players?.players || []).map(p => [p.id, p]));
  const [ask, setAsk] = useState(null);
  const [sel, setSel] = useState(() => new Set(BOUGHT_UI.get(uiKey)?.sel || []));
  useEffect(() => { BOUGHT_UI.set(uiKey, { sel: [...sel], edits }); }, [uiKey, sel, edits]);
  // Harcayıcı list: a player listed again at a new price leaves the table (user 2026-11-06)
  const dropAfterSell = id => { if (source === 'trade') { api.buy.removeBought([id]).catch(() => {}); setSel(s => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; }); } };
  const [fireAsk, setFireAsk] = useState(null);
  const [bulk, setBulk] = useState(false);
  const [clearAsk, setClearAsk] = useState(false);
  const live2 = rows.filter(e => e.state !== 'converted');
  const chosen = live2.filter(e => sel.has(e.id));
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = live2.length > 0 && chosen.length === live2.length;
  const fire = async list => {
    setFireAsk(null);
    setBulk(true);
    try { const r = await api.buy.fire(list.map(e => e.id)); toast(fill(x.okFired, { count: r?.fired ?? list.length }), r?.failed ? 'warning' : 'success'); setSel(new Set()); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBulk(false); }
  };
  // every selected row at its own price box (or the price it is listed at), one after another
  const relist = async () => {
    const list = chosen.map(e => ({ e, v: get(e) })).map(({ e, v }) => ({ e, price: Number(v.price) || Number(e.listPrice), currency: v.currency || e.listCurrency || e.currency }));
    if (list.some(i => !(i.price >= 1))) { toast(x.invalid, 'error'); return; }
    setBulk(true);
    let ok = 0;
    try {
      for (const i of list) { try { await api.buy.sell(i.e.id, i.price, i.currency); ok++; dropAfterSell(i.e.id); } catch (err) { toast(`${i.e.name}: ${err.message}`, 'error'); } }
      setEdits(s => { const n = { ...s }; for (const i of list) delete n[i.e.id]; return n; });
      if (ok) toast(fill(x.okRelisted, { count: ok }), 'success');
      setSel(new Set());
    } finally { setBulk(false); }
  };
  const warnings = e => {
    const p = live.get(e.playerId);
    const value = Number(p?.value);
    const out = [];
    if (Number(e.salary) > 0 && value > 0 && e.salary < value * LOW_SALARY_SHARE) out.push(fill(x.warnLow, { salary: num(e.salary), value: num(value), pct: Math.round(e.salary / value * 100) }));
    if (p?.atBase || (e.salary != null && e.base > 0 && e.salary <= e.base)) out.push(x.warnBase);
    return out;
  };
  const convert = async e => {
    setAsk(null);
    try { await api.buy.convert(e.id); toast(fill(x.okConverted, { name: e.name }), 'success'); } catch (err) { toast(err.message, 'error'); }
  };
  const get = e => ({ price: e.listPrice && e.listPrice !== state.buy?.parkPrice ? e.listPrice : '', currency: e.listCurrency && e.listPrice !== state.buy?.parkPrice ? e.listCurrency : e.currency, ...edits[e.id] });
  // a row whose price or currency is changed is selected by itself (user 2026-11-06)
  const edit = (id, patch) => { setEdits(s => ({ ...s, [id]: { ...s[id], ...patch } })); setSel(s => s.has(id) ? s : new Set([...s, id])); };
  const sell = async e => {
    const v = get(e);
    if (!(Number(v.price) >= 1)) { toast(x.invalid, 'error'); return; }
    try { await api.buy.sell(e.id, Number(v.price), v.currency); setEdits(s => { const n = { ...s }; delete n[e.id]; return n; }); dropAfterSell(e.id); } catch (err) { toast(err.message, 'error'); }
  };
  return <section className="bought-list">
    <h3 className="section-title">{title || x.boughtTitle} <small>{hint || x.boughtHint}</small>{rows.length > 0 && <button className="btn ghost small bought-clear" onClick={() => setClearAsk(true)}>{x.clearList}</button>}</h3>
    {!source && <div className="bought-filter">{[['', x.filterAll], ['hall', x.filterHall], ['auto', x.filterAuto], ['trade', 'Auto Trade']].map(([k, l]) => <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>}
    {chosen.length > 0 && <div className="bought-bulk"><b>{fill(x.selected, { count: chosen.length })}</b><button className="btn primary small" disabled={bulk} onClick={relist}>{x.relistSel}</button><button className="btn danger-soft small" disabled={bulk} onClick={() => setFireAsk(chosen)}>{x.fireSel}</button></div>}
    <div className="panel table-panel">{rows.length ? <SortTable><thead><tr><th className="sel-col"><input type="checkbox" checked={allOn} disabled={!live2.length} onChange={() => setSel(allOn ? new Set() : new Set(live2.map(e => e.id)))} /></th><th>{x.account}</th><th>{x.player}</th><th>{source === 'trade' ? x.value : x.paid}</th><th>{x.salary}</th><th>{x.base}</th><th>{x.status}</th><th>{x.newPrice}</th><th></th></tr></thead>
      <tbody>{rows.map(e => { const v = get(e); const parked = e.state === 'listed' && e.listPrice === state.buy?.parkPrice; return <tr key={e.id} className={sel.has(e.id) ? 'selected' : ''}>
        <td className="sel-col">{e.state !== 'converted' && <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} />}</td>
        <td>{name(e.accountId)}{!source && <small className="cell-sub">{e.source === 'auto' ? x.auto : e.source === 'trade' ? 'Auto Trade' : x.hall}</small>}</td>
        <td><b>{e.name}</b><InjuryMark name={e.name} />{e.salary != null && e.base > 0 && e.salary <= e.base && <span className="base-badge">BASE</span>}{e.position && <small className="cell-sub">{e.position} · {e.grade}</small>}</td>
        {source === 'trade' ? <td><b className="price">{num(live.get(e.playerId)?.value ?? e.value)}</b></td> : <td><b className="price">{num(e.boughtPrice)}</b> {e.currency}</td>}<td>{num(e.salary)}</td><td>{num(e.base)}</td>
        <td>{e.state === 'converted' ? <span className="pill muted"><i />{x.converted}</span> : e.state === 'listed' ? <span className={`pill ${parked ? 'warn' : 'ok'}`}><i />{parked ? x.parked : fill(x.listed, { price: num(e.listPrice), cur: e.listCurrency })}</span> : <span className="pill muted"><i />{x.owned}</span>}</td>
        <td>{e.state !== 'converted' && <span className="bought-price"><input className="price-input" type="number" min="1" value={v.price} onChange={ev => edit(e.id, { price: ev.target.value })} /><span className="currency-toggle">{['APK', 'TIX'].map(c => <button type="button" key={c} className={v.currency === c ? 'on' : ''} onClick={() => edit(e.id, { currency: c })}>{c}</button>)}</span><PriceHint playerId={e.playerId} name={e.name} currency={v.currency} lang={lang} onPick={p => edit(e.id, { price: p })} /></span>}</td>
        <td className="actions">{e.state !== 'converted' && <button className="btn primary small" disabled={busy[e.id]} onClick={() => sell(e)}>{e.state === 'listed' ? x.reprice : x.sell}</button>}{mainId && e.accountId === mainId && e.state !== 'converted' && <button className="btn accent small" disabled={busy[e.id]} onClick={() => setAsk({ e, warn: warnings(e) })}>{busy[e.id] ? x.converting : x.convert}</button>}{e.state !== 'converted' && <button className="btn danger-soft small" disabled={busy[e.id] || bulk} onClick={() => setFireAsk([e])}>{x.fire}</button>}<button className="icon-btn" title={x.remove} onClick={() => api.buy.removeBought([e.id])}>×</button></td>
      </tr>; })}</tbody></SortTable> : <div className="empty">{x.none}</div>}</div>
    {clearAsk && <div className="modal-backdrop" onMouseDown={ev => ev.target === ev.currentTarget && setClearAsk(false)}><div className="modal" style={{ maxWidth: 460 }}>
      <div className="modal-head"><b>{x.clearList}</b><button className="icon-btn" onClick={() => setClearAsk(false)}>×</button></div>
      <p className="muted-text">{fill(x.clearListAsk, { n: rows.length })}</p>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setClearAsk(false)}>{x.cancel}</button><button className="btn danger-soft" onClick={async () => { setClearAsk(false); await api.buy.removeBought(rows.map(e => e.id)); setSel(new Set()); }}>{x.clearListYes}</button></div>
    </div></div>}
    {fireAsk && <div className="modal-backdrop" onMouseDown={ev => ev.target === ev.currentTarget && setFireAsk(null)}><div className="modal" style={{ maxWidth: 480 }}>
      <div className="modal-head"><b>{x.fireTitle}</b><button className="icon-btn" onClick={() => setFireAsk(null)}>×</button></div>
      <p className="muted-text">{fill(x.fireAsk, { names: fireAsk.map(e => `${e.name} (${name(e.accountId)})`).join(', ') })}</p>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setFireAsk(null)}>{x.cancel}</button><button className="btn danger-soft" onClick={() => fire(fireAsk)}>{x.fireYes}</button></div>
    </div></div>}
    {ask && <div className="modal-backdrop" onMouseDown={ev => ev.target === ev.currentTarget && setAsk(null)}><div className="modal" style={{ maxWidth: 480 }}>
      <div className="modal-head"><b>{fill(x.convertTitle, { name: ask.e.name })}</b><button className="icon-btn" onClick={() => setAsk(null)}>×</button></div>
      {ask.warn.length > 0 && <div className="convert-warn">{ask.warn.map(w => <p key={w}>⚠ {w}</p>)}</div>}
      <p className="muted-text">{x.convertAsk}</p>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setAsk(null)}>{x.cancel}</button><button className={`btn ${ask.warn.length ? 'danger-soft' : 'primary'}`} onClick={() => convert(ask.e)}>{x.convertYes}</button></div>
    </div></div>}
  </section>;
}

// Trading Hall bulk buy (user 2026-11-08): the selected listings, "Buy all" or "Buy all and turn
// into cards", then the account; the buttons only work with a selection.
export function BulkBuyBar({ state, lang, toast, selected, onClear }) {
  const x = BUY_TEXT[lang] || BUY_TEXT.en;
  const [pick, setPick] = useState(null); // { convert }
  const b = state.buy?.bulk || null;
  const running = b?.status === 'running';
  const n = selected.length;
  const sums = {};
  for (const r of selected) sums[r.currency] = (sums[r.currency] || 0) + (Number(r.price) || 0);
  const sumText = Object.entries(sums).map(([c, v]) => `${num(v)} ${c}`).join(' + ');
  const stats = state.accountProfile?.accounts || {};
  // how many of the selected (in order) an account pays before it runs out
  const affords = id => { const bal = { APK: Number(stats[id]?.apk), TIX: Number(stats[id]?.tix) }; let k = 0; for (const r of selected) { const c = r.currency === 'TIX' ? 'TIX' : 'APK'; if (!(bal[c] >= r.price)) break; bal[c] -= r.price; k++; } return k; };
  const accounts = (state.accounts || []).map(a => ({ ...a, k: affords(a.id), apk: Number(stats[a.id]?.apk), tix: Number(stats[a.id]?.tix) })).sort((a, z) => z.k - a.k || (z.apk || 0) - (a.apk || 0));
  const go = async (accountId, convert) => {
    setPick(null);
    try { await api.buy.bulkBuy(accountId, selected, convert); toast(fill(x.bulkStarted, { n }), 'success'); onClear(); }
    catch (e) { toast(e.message, 'error'); }
  };
  if (!n && !b) return null;
  return <div className="panel th-bulk">
    {b && (running
      ? <><span className="pill warn"><i />{fill(b.convert ? x.bulkRunningCard : x.bulkRunning, b)}</span>{b.current && <small className="muted-text">{fill(x.bulkNow, { name: b.current })}</small>}<button className="btn danger-soft small" onClick={() => api.buy.stopBulk()}>{x.bulkStop}</button></>
      : <><span className={`pill ${b.bought ? 'ok' : 'bad'}`}><i />{fill(b.convert ? x.bulkDoneCard : x.bulkDone, b)}{b.stopReason ? ` · ${x.bulkWhy[b.stopReason] || b.stopReason}` : ''}</span><button className="icon-btn" onClick={() => api.buy.clearBulk()}>×</button></>)}
    {n > 0 && <><b>{fill(x.bulkSel, { n })}</b><small className="muted-text">{fill(x.bulkCost, { sum: sumText })}</small><span className="sp" />
      <button className="btn success small" disabled={running} onClick={() => setPick({ convert: false })}>{x.bulkBuy}</button>
      <button className="btn accent small" disabled={running} onClick={() => setPick({ convert: true })}>{x.bulkCard}</button>
      <button className="btn ghost small" onClick={onClear}>{x.bulkClear}</button></>}
    {pick && <div className="modal-backdrop" onMouseDown={ev => ev.target === ev.currentTarget && setPick(null)}><div className="modal" style={{ maxWidth: 520 }}>
      <div className="modal-head"><b>{pick.convert ? x.bulkPickCard : x.bulkPick}</b><button className="icon-btn" onClick={() => setPick(null)}>×</button></div>
      <p className="muted-text">{fill(x.bulkSel, { n })} · {fill(x.bulkCost, { sum: sumText })}</p>
      <p className="muted-text">{x.bulkPickHint}</p>
      {pick.convert && <p className="bad-text">{x.bulkCardHint}</p>}
      <div className="th-bulk-accounts">{accounts.map(a => <button key={a.id} type="button" className={a.k ? '' : 'off'} disabled={!a.k} onClick={() => go(a.id, pick.convert)}>
        <span>{a.name}</span><em>{Number.isFinite(a.apk) ? num(a.apk) : '—'} APK · {Number.isFinite(a.tix) ? num(a.tix) : '—'} TIX · {fill(x.bulkAfford, { k: a.k, n })}</em></button>)}</div>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setPick(null)}>{x.cancel}</button></div>
    </div></div>}
  </div>;
}
