import { useEffect, useMemo, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import { useGroupedRows } from './AccountGroups';
import { Drafted, DRAFT_TEXT } from './DraftPage';
import LaborTab from './BagLabor';
import InjuryTab from './BagInjury';

// Çanta (user 2026-11-11): item use, starting with X2 EXP. Counts per account, the time left of a
// running boost, Use per account and for the ticked accounts.
// 2026-11-18: Random Card tab (open every kind of Random A / S card on many accounts at once, the
// players that come out get Fire / To cards / List) and the Laborer Contract tab.
const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

const TEXT = {
  tr: {
    title: 'Çanta', subtitle: 'Eşya kullanma · X2 EXP, Random kartlar, Laborer Contract, Anestezi', read: 'Çantaları oku', reading: 'Okunuyor…',
    tabXp: 'X2 EXP', tabCards: 'Random Card', tabLabor: 'Laborer Contract', tabInjury: 'Anestezi',
    account: 'Hesap', active: 'X2 EXP durumu', none: '—', use: 'Kullan', using: 'Kullanılıyor…', status: 'Süreyi oku',
    useSel: 'Seçilenlere kullan ({n})', selectAll: 'Tümünü seç', clear: 'Seçimi kaldır', notRead: 'Okunmadı',
    left: '{t} kaldı', unknownLeft: 'Kullanılmamış ya da süre bilinmiyor', activeTag: 'Aktif',
    confirmActive: '{n} hesapta X2 EXP zaten aktif. Onlarda da yeni bir eşya kullanılsın mı? (Oyun süreyi uzatabilir ya da reddedebilir.)',
    usedOk: '{n} hesapta kullanıldı', usedFail: '{n} hesapta kullanılamadı',
    how: [
      'Çantalar oturum açmadan okunur; her X2 EXP çeşidinin adedi ayrı sütunda görünür.',
      '"Kullan" o hesapta bir X2 EXP eşyası kullanır (birden çok çeşit varsa en kısa süreli olan). Toplu kullanmak için soldan hesapları seçip "Seçilenlere kullan"a bas.',
      'Uygulamanın kullandığı eşyaların bitiş saati saklanır ve kalan süre burada görünür. Oyunda elle kullanılan bir eşyanın süresini görmek için "Süreyi oku" (hesaba kısa bir giriş yapılır; o an oyunda açık olan sekmesi kapanabilir).'
    ],
    kinds: 'Açılacak çeşitler', perAcc: 'Hesap başına en fazla', perAccHint: 'Boş bırakılırsa seçili çeşitlerin hepsi açılır', all: 'hepsi',
    openSel: 'Seçilenlerde aç ({n} hesap · {c} kart)', open: 'Aç', opening: 'Açılıyor {done}/{total}', total: 'Toplam',
    openAsk: '{n} hesapta {c} Random kart açılacak. Gelen oyuncular aşağıdaki listeye düşer; kovma, karta çevirme ve satışı orada sen seçersin. Devam edilsin mi?', yes: 'Evet, aç', cancel: 'Vazgeç',
    openedOk: '{n} kart açıldı · {p} oyuncu geldi', openFail: '{n} hesapta açılamadı', stoppedAt: 'Durdu: {error}',
    noCards: 'Okunan çantalarda Random kart yok.',
    cardList: 'Kartlardan gelen oyuncular', cardHint: 'Fiyatlar Auto Trade fiyatlandırmasından gelir; seç, listele, karta çevir (main\'e aktarılır) ya da kov.', cardEmpty: 'Henüz kart açılmadı.',
    howCards: [
      'Random A / S kartlarının ve Base A / S Salary kartlarının bütün çeşitleri ayrı sütunlarda görünür; üstteki kutularla hangi çeşitlerin açılacağını seçersin.',
      'Soldan hesapları seç (grup satırı ya da Tümünü seç ile toplu), "Seçilenlerde aç" seçili hesapların hepsinde aynı anda açar. "Hesap başına en fazla" boşsa seçili çeşitlerin hepsi açılır.',
      'Takım dolduğu için ya da başka bir sebeple oyun reddederse o hesap durur, diğerleri devam eder.',
      'Gelen oyuncular değer, maaş ve Base ile alttaki listeye düşer. Satış fiyatı Auto Trade fiyatlandırmasından gelir (yoksa varsayılan). Karta çevir oyuncuyu main\'e aktarıp karta çevirir; Kov oyunun FIRE\'ı, geri alınamaz.'
    ]
  },
  en: {
    title: 'Bag', subtitle: 'Using items · X2 EXP, Random cards, Laborer Contract, Anesthesia', read: 'Read bags', reading: 'Reading…',
    tabXp: 'X2 EXP', tabCards: 'Random Card', tabLabor: 'Laborer Contract', tabInjury: 'Anesthesia',
    account: 'Account', active: 'X2 EXP status', none: '—', use: 'Use', using: 'Using…', status: 'Read time left',
    useSel: 'Use on selected ({n})', selectAll: 'Select all', clear: 'Clear selection', notRead: 'Not read',
    left: '{t} left', unknownLeft: 'Not used or time unknown', activeTag: 'Active',
    confirmActive: 'X2 EXP is already running on {n} account(s). Use another item there too? (The game may extend it or refuse.)',
    usedOk: 'Used on {n} account(s)', usedFail: 'Could not be used on {n} account(s)',
    how: [
      'The bags are read without signing in; each X2 EXP kind has its own column with its count.',
      '"Use" uses one X2 EXP item on that account (the shortest kind when there are several). To use them in bulk, tick accounts on the left and press "Use on selected".',
      'The end of every item the app uses is kept and the time left shows here. For an item used by hand in the game press "Read time left" (the account signs in for a moment; a game tab open on it may close).'
    ],
    kinds: 'Kinds to open', perAcc: 'At most per account', perAccHint: 'Empty opens every card of the chosen kinds', all: 'all',
    openSel: 'Open on selected ({n} accounts · {c} cards)', open: 'Open', opening: 'Opening {done}/{total}', total: 'Total',
    openAsk: '{c} Random card(s) will be opened on {n} account(s). The players that come out go to the list below; you choose Fire, To cards or List there. Go on?', yes: 'Yes, open', cancel: 'Cancel',
    openedOk: '{n} card(s) opened · {p} player(s) came', openFail: 'Could not open on {n} account(s)', stoppedAt: 'Stopped: {error}',
    noCards: 'No Random card in the bags read.',
    cardList: 'Players from the cards', cardHint: 'Prices come from Auto Trade pricing; tick, list, turn into cards (moved to main) or fire.', cardEmpty: 'No card opened yet.',
    howCards: [
      'Every kind of Random A / S card and Base A / S Salary card has its own column; the boxes on top choose which kinds are opened.',
      'Tick accounts on the left (in bulk with a group row or Select all); "Open on selected" opens on all of them at the same time. With "At most per account" empty, every card of the chosen kinds is opened.',
      'When the game refuses (a full roster or anything else) that account stops, the others go on.',
      'The players that come out go to the list below with value, salary and Base. The list price comes from Auto Trade pricing (else the default). To cards moves the player to main and makes cards; Fire is the game\'s FIRE and cannot be undone.'
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

export default function BagPage({ state, t, toast, tab: openTab = null }) {
  const x = TEXT[t.lang] || TEXT.en;
  const b = state.bag || { bags: {}, boosts: {}, busy: [] };
  const [tab, setTab] = useState(() => { if (openTab) return openTab; try { return localStorage.getItem('bag.tab') || 'xp'; } catch { return 'xp'; } });
  const pickTab = id => { setTab(id); try { localStorage.setItem('bag.tab', id); } catch {} };
  useEffect(() => { if (api.bag && !Object.keys(b.bags || {}).length) api.bag.read().catch(() => {}); }, []);
  const tabs = [['xp', x.tabXp], ['cards', x.tabCards], ['labor', x.tabLabor], ['injury', x.tabInjury]];
  return <div className="page bag-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar"><button className="btn ghost" disabled={b.reading} onClick={() => api.bag.read().catch(e => toast(e.message, 'error'))}>{b.reading ? x.reading : x.read}</button></div></div>
    <div className="market-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => pickTab(id)}>{label}</button>)}</div>
    {tab === 'xp' && <XpTab state={state} t={t} toast={toast} x={x} b={b} />}
    {tab === 'cards' && <CardsTab state={state} t={t} toast={toast} x={x} b={b} />}
    {tab === 'labor' && <LaborTab state={state} t={t} toast={toast} />}
    {tab === 'injury' && <InjuryTab state={state} t={t} toast={toast} />}
  </div>;
}

function XpTab({ state, t, toast, x, b }) {
  const accounts = state.accounts || [];
  const busy = new Set(b.busy || []);
  const grp = useGroupedRows('bag');
  const [sel, setSel] = useState(() => new Set());
  const [, tick] = useState(0);
  useEffect(() => { const iv = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(iv); }, []);
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

  return <>
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
  </>;
}

function CardsTab({ state, t, toast, x, b }) {
  const accounts = state.accounts || [];
  const busy = new Set(b.busy || []);
  const opening = b.opening || {};
  const grp = useGroupedRows('bag-cards');
  const [sel, setSel] = useState(() => new Set());
  const [off, setOff] = useState(() => new Set()); // kinds NOT to open
  const [max, setMax] = useState('');
  const [ask, setAsk] = useState(null);
  const kinds = useMemo(() => {
    const m = new Map();
    for (const bag of Object.values(b.bags || {})) for (const it of bag.cards || []) if (!m.has(it.itemId)) m.set(it.itemId, { id: it.itemId, name: it.name });
    return [...m.values()].sort((p, q) => p.name.localeCompare(q.name));
  }, [b.bags]);
  const on = kinds.filter(k => !off.has(k.id)).map(k => k.id);
  const count = (id, kind) => (b.bags?.[id]?.cards || []).filter(i => i.itemId === kind).reduce((n, i) => n + i.quantity, 0);
  const willOpen = id => { const n = on.reduce((s, k) => s + count(id, k), 0); return Number(max) > 0 ? Math.min(n, Number(max)) : n; };
  const allOn = accounts.length > 0 && accounts.every(a => sel.has(a.id));
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const picked = accounts.filter(a => sel.has(a.id) && willOpen(a.id) > 0 && !busy.has(a.id)).map(a => a.id);
  const cardsN = ids => ids.reduce((s, id) => s + willOpen(id), 0);
  const go = async ids => {
    setAsk(null);
    try {
      const r = await api.bag.openCards(ids, on, Number(max) > 0 ? Number(max) : null);
      const res = Object.values(r?.results || {});
      const opened = res.reduce((s, v) => s + (v.opened || 0), 0), players = res.reduce((s, v) => s + (v.players?.length || 0), 0);
      const bad = res.filter(v => !v.ok);
      if (opened) toast(fill(x.openedOk, { n: opened, p: players }), 'success');
      if (bad.length) toast(fill(x.openFail, { n: bad.length }) + (bad[0]?.error ? ` · ${bad[0].error}` : ''), 'error');
    } catch (e) { toast(e.message, 'error'); }
  };
  const roles = state.cards?.roles || [];
  const players = useMemo(() => new Map((state.players?.players || []).map(p => [p.id, p])), [state.players]);
  const dx = DRAFT_TEXT[t.lang] || DRAFT_TEXT.en;
  const mainName = accounts.find(a => a.id === state.accountProfile?.mainAccountId)?.name || null;

  return <>
    {ask && <div className="modal-backdrop" onClick={() => setAsk(null)}><div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
      <p>{fill(x.openAsk, { n: ask.length, c: cardsN(ask) })}</p>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setAsk(null)}>{x.cancel}</button><button className="btn primary" autoFocus onClick={() => go(ask)}>{x.yes}</button></div>
    </div></div>}
    <div className="panel pg-bar bag-cards-bar">
      <button className="chip" onClick={() => setSel(allOn ? new Set() : new Set(accounts.map(a => a.id)))}>{allOn ? x.clear : x.selectAll}</button>
      <span className="muted-text">{x.kinds}:</span>
      {kinds.length ? kinds.map(k => <label key={k.id} className="check-row"><input type="checkbox" checked={!off.has(k.id)} onChange={() => setOff(s => { const n = new Set(s); n.has(k.id) ? n.delete(k.id) : n.add(k.id); return n; })} />{k.name}</label>) : <span className="muted-text">{x.noCards}</span>}
      <label className="check-row" title={x.perAccHint}>{x.perAcc} <input className="eq-small" type="number" min="1" placeholder={x.all} value={max} onChange={e => setMax(e.target.value)} /></label>
      <span className="sp" />
      <button className="btn primary" disabled={!picked.length || !on.length} onClick={() => setAsk(picked)}>{fill(x.openSel, { n: picked.length, c: cardsN(picked) })}</button>
    </div>
    <div className="panel table-panel dp-table"><SortTable>
      <thead><tr><th className="select-col"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(accounts.map(a => a.id)))} aria-label={x.selectAll} /></th><th>{x.account}</th>{kinds.map(k => <th key={k.id}>{k.name}</th>)}<th>{x.total}</th><th /></tr></thead>
      <tbody>{grp(accounts, a => {
        const bag = b.bags?.[a.id];
        const o = opening[a.id];
        return <tr key={a.id} className={sel.has(a.id) ? 'selected-row-soft' : ''}>
          <td className="select-col"><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} aria-label={a.name} /></td>
          <td><b>{a.name}</b>{o?.error && !o.running && <small className="bad-text"> · {fill(x.stoppedAt, { error: o.error })}</small>}</td>
          {kinds.map(k => <td key={k.id} className="num">{bag ? count(a.id, k.id) : '—'}</td>)}
          <td className="num">{bag ? (bag.cards || []).reduce((n, i) => n + i.quantity, 0) : '—'}</td>
          <td className="actions">{o?.running ? <span className="pill warn"><i />{fill(x.opening, { done: o.done, total: o.total })}</span>
            : <button className="btn primary small" disabled={busy.has(a.id) || !willOpen(a.id) || !on.length} onClick={() => setAsk([a.id])}>{x.open}</button>}</td>
        </tr>;
      }, (g, { open, toggle: tg }) => {
        const gi = g.accounts.map(a => a.id);
        const n = gi.filter(id => sel.has(id)).length;
        return <tr key={g.key} className="grp-row">
          <td className="select-col"><input type="checkbox" checked={n === gi.length} ref={el => { if (el) el.indeterminate = n > 0 && n < gi.length; }} onChange={() => setSel(s => { const m = new Set(s); for (const id of gi) n === gi.length ? m.delete(id) : m.add(id); return m; })} aria-label={g.label} /></td>
          <td className="grp-name" onClick={tg}><i className="grp-arrow">{open ? '▾' : '▸'}</i><b>{g.label}</b> <small className="muted-text">{n}/{gi.length}</small></td>
          {kinds.map(k => <td key={k.id} className="num">{gi.reduce((s, id) => s + count(id, k.id), 0)}</td>)}
          <td className="num">{gi.reduce((s, id) => s + (b.bags?.[id]?.cards || []).reduce((m, i) => m + i.quantity, 0), 0)}</td><td />
        </tr>;
      })}</tbody>
    </SortTable></div>
    <Drafted d={state.draft || {}} x={dx} players={players} roles={roles} toast={toast} mainName={mainName} source="card" title={x.cardList} hint={x.cardHint} empty={x.cardEmpty} />
    <details className="panel pvp-how"><summary>{t.lang === 'tr' ? 'Nasıl çalışır?' : 'How does it work?'}</summary><ul>{x.howCards.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}
