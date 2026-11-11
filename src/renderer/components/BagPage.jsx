import { useEffect, useMemo, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import { useGroupedRows } from './AccountGroups';

// Çanta (user 2026-11-11): item use, starting with X2 EXP. Counts per account, the time left of a
// running boost, Use per account and for the ticked accounts.
const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

const TEXT = {
  tr: {
    title: 'Çanta', subtitle: 'Eşya kullanma · şimdilik X2 EXP', read: 'Çantaları oku', reading: 'Okunuyor…',
    account: 'Hesap', active: 'X2 EXP durumu', none: '—', use: 'Kullan', using: 'Kullanılıyor…', status: 'Süreyi oku',
    useSel: 'Seçilenlere kullan ({n})', selectAll: 'Tümünü seç', clear: 'Seçimi kaldır', notRead: 'Okunmadı',
    left: '{t} kaldı', unknownLeft: 'Kullanılmamış ya da süre bilinmiyor', activeTag: 'Aktif',
    confirmActive: '{n} hesapta X2 EXP zaten aktif. Onlarda da yeni bir eşya kullanılsın mı? (Oyun süreyi uzatabilir ya da reddedebilir.)',
    usedOk: '{n} hesapta kullanıldı', usedFail: '{n} hesapta kullanılamadı',
    how: [
      'Çantalar oturum açmadan okunur; her X2 EXP çeşidinin adedi ayrı sütunda görünür.',
      '"Kullan" o hesapta bir X2 EXP eşyası kullanır (birden çok çeşit varsa en kısa süreli olan). Toplu kullanmak için soldan hesapları seçip "Seçilenlere kullan"a bas.',
      'Uygulamanın kullandığı eşyaların bitiş saati saklanır ve kalan süre burada görünür. Oyunda elle kullanılan bir eşyanın süresini görmek için "Süreyi oku" (hesaba kısa bir giriş yapılır; o an oyunda açık olan sekmesi kapanabilir).'
    ]
  },
  en: {
    title: 'Bag', subtitle: 'Using items · X2 EXP for now', read: 'Read bags', reading: 'Reading…',
    account: 'Account', active: 'X2 EXP status', none: '—', use: 'Use', using: 'Using…', status: 'Read time left',
    useSel: 'Use on selected ({n})', selectAll: 'Select all', clear: 'Clear selection', notRead: 'Not read',
    left: '{t} left', unknownLeft: 'Not used or time unknown', activeTag: 'Active',
    confirmActive: 'X2 EXP is already running on {n} account(s). Use another item there too? (The game may extend it or refuse.)',
    usedOk: 'Used on {n} account(s)', usedFail: 'Could not be used on {n} account(s)',
    how: [
      'The bags are read without signing in; each X2 EXP kind has its own column with its count.',
      '"Use" uses one X2 EXP item on that account (the shortest kind when there are several). To use them in bulk, tick accounts on the left and press "Use on selected".',
      'The end of every item the app uses is kept and the time left shows here. For an item used by hand in the game press "Read time left" (the account signs in for a moment; a game tab open on it may close).'
    ]
  },
  get fil() { return filOf(this.en); }
};

function leftText(endsAt, x) {
  const ms = Date.parse(endsAt || '') - Date.now();
  if (!(ms > 0)) return null;
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return fill(x.left, { t: d ? `${d}g ${h}s` : h ? `${h}s ${m}dk` : `${m}dk` });
}

export default function BagPage({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const b = state.bag || { bags: {}, boosts: {}, busy: [] };
  const accounts = state.accounts || [];
  const busy = new Set(b.busy || []);
  const grp = useGroupedRows('bag');
  const [sel, setSel] = useState(() => new Set());
  const [, tick] = useState(0);
  useEffect(() => { const iv = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(iv); }, []);
  useEffect(() => { if (api.bag && !Object.keys(b.bags || {}).length) api.bag.read().catch(() => {}); }, []);
  // every X2 EXP kind seen in any bag → a column each
  const kinds = useMemo(() => {
    const m = new Map();
    for (const bag of Object.values(b.bags || {})) for (const it of bag.items || []) if (!m.has(it.itemId)) m.set(it.itemId, { id: it.itemId, name: it.name, days: it.days });
    return [...m.values()].sort((p, q) => p.days - q.days);
  }, [b.bags]);
  const count = (id, kind) => (b.bags?.[id]?.items || []).filter(i => i.itemId === kind).reduce((n, i) => n + i.quantity, 0);
  const total = id => (b.bags?.[id]?.items || []).reduce((n, i) => n + i.quantity, 0);
  const allOn = accounts.length > 0 && accounts.every(a => sel.has(a.id));
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const run = async ids => {
    const active = ids.filter(id => leftText(b.boosts?.[id]?.endsAt, x));
    if (active.length && !confirm(fill(x.confirmActive, { n: active.length }))) return;
    try {
      const r = await api.bag.use(ids);
      const res = Object.values(r?.results || {});
      const ok = res.filter(v => v.ok).length, bad = res.length - ok;
      if (ok) toast(fill(x.usedOk, { n: ok }), 'success');
      if (bad) toast(fill(x.usedFail, { n: bad }) + (res.find(v => !v.ok)?.error ? ` · ${res.find(v => !v.ok).error}` : ''), 'error');
    } catch (e) { toast(e.message, 'error'); }
  };
  const picked = accounts.filter(a => sel.has(a.id) && total(a.id) > 0).map(a => a.id);

  return <div className="page bag-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar"><button className="btn ghost" disabled={b.reading} onClick={() => api.bag.read().catch(e => toast(e.message, 'error'))}>{b.reading ? x.reading : x.read}</button></div></div>
    <div className="panel pg-bar">
      <button className="chip" onClick={() => setSel(allOn ? new Set() : new Set(accounts.map(a => a.id)))}>{allOn ? x.clear : x.selectAll}</button>
      <span className="sp" />
      <button className="btn primary" disabled={!picked.length} onClick={() => run(picked)}>{fill(x.useSel, { n: picked.length })}</button>
    </div>
    <div className="panel table-panel dp-table"><SortTable>
      <thead><tr><th className="select-col"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(accounts.map(a => a.id)))} aria-label={x.selectAll} /></th><th>{x.account}</th>{kinds.map(k => <th key={k.id}>{k.name}</th>)}<th>{x.active}</th><th /></tr></thead>
      <tbody>{grp(accounts, a => {
        const bag = b.bags?.[a.id];
        const boost = b.boosts?.[a.id];
        const left = leftText(boost?.endsAt, x);
        return <tr key={a.id} className={sel.has(a.id) ? 'selected-row-soft' : ''}>
          <td className="select-col"><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} aria-label={a.name} /></td>
          <td><b>{a.name}</b></td>
          {kinds.map(k => <td key={k.id} className="num">{bag ? count(a.id, k.id) : '—'}</td>)}
          <td>{left ? <span className="pill ok"><i />{x.activeTag} · x{boost.multiplier || 2} · {left}</span> : <span className="muted-text">{bag ? x.unknownLeft : x.notRead}</span>}</td>
          <td className="actions">
            <button className="btn ghost small" disabled={busy.has(a.id)} onClick={() => api.bag.status(a.id).catch(e => toast(e.message, 'error'))}>{x.status}</button>{' '}
            <button className="btn primary small" disabled={busy.has(a.id) || !total(a.id)} onClick={() => run([a.id])}>{busy.has(a.id) ? x.using : x.use}</button>
          </td>
        </tr>;
      }, (g, { open, toggle }) => {
        const gi = g.accounts.map(a => a.id);
        const on = gi.filter(id => sel.has(id)).length;
        const left = gi.filter(id => leftText(b.boosts?.[id]?.endsAt, x)).length;
        return <tr key={g.key} className="grp-row">
          <td className="select-col"><input type="checkbox" checked={on === gi.length} ref={el => { if (el) el.indeterminate = on > 0 && on < gi.length; }} onChange={() => setSel(s => { const n = new Set(s); for (const id of gi) on === gi.length ? n.delete(id) : n.add(id); return n; })} aria-label={g.label} /></td>
          <td className="grp-name" onClick={toggle}><i className="grp-arrow">{open ? '▾' : '▸'}</i><b>{g.label}</b> <small className="muted-text">{on}/{gi.length}</small></td>
          {kinds.map(k => <td key={k.id} className="num">{gi.reduce((n, id) => n + count(id, k.id), 0)}</td>)}
          <td className="muted-text">{left ? x.activeTag + ' · ' + left + '/' + gi.length : ''}</td><td />
        </tr>;
      })}</tbody>
    </SortTable></div>
    <details className="panel pvp-how"><summary>{t.lang === 'tr' ? 'Nasıl çalışır?' : 'How does it work?'}</summary><ul>{x.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </div>;
}
