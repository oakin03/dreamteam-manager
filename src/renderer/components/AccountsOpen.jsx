import { useState } from 'react';
import { filOf } from '../i18n-fil';

// Hesaplar → open accounts in a visible browser (user 2026-11-19), one by one or in bulk: the same
// opener as Bag → Anesthesia (saved password, N windows at once, closing one opens the next, the
// account's other jobs wait while its window is open).
const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

const TEXT = {
  tr: {
    open: 'Hesapları aç', openOne: 'Tarayıcıda aç', title: 'Hesapları tarayıcıda aç', search: 'Hesap ara…', selectAll: 'Tümünü seç', none: 'Hiçbiri',
    atOnce: 'Aynı anda', go: 'Aç ({n})', cancel: 'Vazgeç', stop: 'Durdur',
    hint: 'Seçilen hesaplar görünür tarayıcıda, kayıtlı şifreyle açılır; “Aynı anda” kadar pencere açık kalır, birini kapatınca sıradaki açılır. Açık hesabın diğer işleri (Auto Play vb.) pencere kapanana kadar bekler.',
    status: 'Açık: {list}', queue: 'Sırada {n} hesap', opening: 'açılıyor', isOpen: 'açık', failed: 'açılamadı', started: '{n} hesap sıraya alındı'
  },
  en: {
    open: 'Open accounts', openOne: 'Open in the browser', title: 'Open accounts in the browser', search: 'Search accounts…', selectAll: 'Select all', none: 'None',
    atOnce: 'At once', go: 'Open ({n})', cancel: 'Cancel', stop: 'Stop',
    hint: 'The chosen accounts open in a visible browser with the saved password; “At once” windows stay open, closing one opens the next. The open account\'s other jobs (Auto Play etc.) wait until its window is closed.',
    status: 'Open: {list}', queue: '{n} account(s) waiting', opening: 'opening', isOpen: 'open', failed: 'could not open', started: '{n} account(s) queued'
  },
  get fil() { return filOf(this.en); }
};

export function openAccountsText(lang) { return TEXT[lang] || TEXT.en; }

export async function openAccounts(ids, max, toast, lang) {
  const x = TEXT[lang] || TEXT.en;
  try { await api.injury.viewStart(ids, max); toast?.(fill(x.started, { n: ids.length }), 'success'); }
  catch (e) { toast?.(e.message, 'error'); }
}

// toolbar button + picker + the live status line
export default function OpenAccounts({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const accounts = state.accounts || [];
  const viewer = state.injuryViewer || { open: [], queue: [] };
  const [pick, setPick] = useState(null);
  const [q, setQ] = useState('');
  const [atOnce, setAtOnce] = useState(3);
  const shown = accounts.filter(a => !q || a.name.toLowerCase().includes(q.toLowerCase()));
  const busy = viewer.open.length > 0 || viewer.queue.length > 0;
  return <>
    <button className="btn ghost" title={x.hint} onClick={() => { setQ(''); setPick(new Set()); }}>{x.open}</button>
    {busy && <span className="muted-text open-acc-status">{viewer.open.length > 0 && fill(x.status, { list: viewer.open.map(o => `${o.name} (${o.status === 'error' ? x.failed : o.status === 'open' ? x.isOpen : x.opening})`).join(', ') })}{viewer.queue.length > 0 && ` · ${fill(x.queue, { n: viewer.queue.length })}`} <button className="btn ghost small" onClick={() => api.injury.viewStop().catch(e => toast(e.message, 'error'))}>{x.stop}</button></span>}
    {pick && <div className="modal-backdrop" onClick={() => setPick(null)}><div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
      <h3>{x.title}</h3>
      <p className="muted-text">{x.hint}</p>
      <input className="ab-list-search" placeholder={x.search} value={q} onChange={e => setQ(e.target.value)} />
      <div className="toolbar"><button className="chip" onClick={() => setPick(new Set([...pick, ...shown.map(a => a.id)]))}>{x.selectAll}</button><button className="chip" onClick={() => setPick(new Set())}>{x.none}</button>
        <label className="check-row">{x.atOnce} <select value={atOnce} onChange={e => setAtOnce(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div>
      <div style={{ maxHeight: 320, overflow: 'auto', display: 'grid', gap: 4 }}>{shown.map(a => <label key={a.id} className="check-row"><input type="checkbox" checked={pick.has(a.id)} onChange={() => setPick(s => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} />{a.name}</label>)}</div>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setPick(null)}>{x.cancel}</button><button className="btn primary" disabled={!pick.size} onClick={() => { const ids = accounts.filter(a => pick.has(a.id)).map(a => a.id); setPick(null); openAccounts(ids, atOnce, toast, t.lang); }}>{fill(x.go, { n: pick.size })}</button></div>
    </div></div>}
  </>;
}
