import { useEffect, useMemo, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import RatingBadge from './RatingBadge';
import { Drafted, DRAFT_TEXT } from './DraftPage';

// Çanta → Laborer Contract (user 2026-11-18): pick a player from our teams or our own market
// listings, the account whose contract is used; the player is taken off the market / traded there,
// the contract re-rolls its salary, then Fire / To cards / List as for drafted players.
const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const num = v => (v == null ? '—' : Number(v).toLocaleString());

const TEXT = {
  tr: {
    contracts: 'Sözleşmesi olan hesaplar', noContracts: 'Okunan hesaplarda Laborer Contract yok.', account: 'Hesap',
    read: 'Oyuncuları ve sözleşmeleri oku', reading: 'Okunuyor…', readAt: 'Okundu: {time}',
    pickTitle: '1 · Oyuncu seç', search: 'Oyuncu ya da hesap ara…', all: 'Hepsi', team: 'Takımda', market: 'Pazarda',
    player: 'Oyuncu', where: 'Nerede', value: 'Değer', salary: 'Maaş', base: 'Base', choose: 'Seç', chosen: 'Seçildi',
    onMarket: 'Pazarda · {price} {cur}', more: '{n} oyuncu daha · aramayı daralt',
    applyTitle: '2 · Sözleşme', range: 'Son 30 günde {count} maç · maaş aralığı {min} ~ {max} · şimdi {now}', rangeBad: 'Kullanılamaz: {why}',
    fewMatches: 'yeterli maç yok ({count}/10)', same: 'her maçta aynı maaş, değişecek bir şey yok', rangeLoading: 'Maaş aralığı okunuyor…',
    target: 'Sözleşmesi kullanılacak hesap', kind: 'Sözleşme', apply: 'Sözleşmeyi uygula',
    steps: { check: 'Kontrol ediliyor…', unlist: 'Pazardan çekiliyor…', trade: 'Takas ediliyor…', use: 'Sözleşme kullanılıyor…' },
    askIntro: '{name} için:', askUnlist: '{acc} hesabındaki pazar ilanı geri çekilecek', askTrade: '{from} → {to} takasıyla aktarılacak', askUse: '{to} hesabında {kind} kullanılacak; maaş {min} ~ {max} arasında yeniden belirlenir (geri alınamaz)',
    yes: 'Evet, uygula', cancel: 'Vazgeç', done: '{name} · maaş {before} → {after}',
    listTitle: 'Sözleşme uygulanan oyuncular', listHint: 'Fiyatlar Auto Trade fiyatlandırmasından gelir; listele, karta çevir (main\'e aktarılır) ya da kov.', listEmpty: 'Henüz sözleşme uygulanmadı.',
    how: [
      'Önce "Oyuncuları ve sözleşmeleri oku": bütün hesapların kadroları, kendi pazar ilanların ve çantalarındaki Laborer Contract\'lar oturum açmadan aynı anda okunur.',
      'Listeden oyuncuyu seç. Oyunun kuralı: oyuncunun son 30 günde en az 10 maçı olmalı ve bu maçlardaki maaşı farklı olmalı; yeni maaş o aralıkta (en düşük ~ en yüksek) rastgele belirlenir.',
      'Sözleşmesi kullanılacak hesabı ve sözleşme çeşidini (Normal / Special) seç. Oyuncu pazardaysa ilan geri çekilir, başka hesaptaysa o hesaba takasla aktarılır, sonra sözleşme kullanılır.',
      'Oyuncu alttaki listeye eski ve yeni maaşıyla düşer: listele (fiyat Auto Trade fiyatlandırmasından), karta çevir (main\'e aktarılıp karta çevrilir) ya da kov.'
    ]
  },
  en: {
    contracts: 'Accounts with contracts', noContracts: 'No Laborer Contract on the accounts read.', account: 'Account',
    read: 'Read players and contracts', reading: 'Reading…', readAt: 'Read: {time}',
    pickTitle: '1 · Choose a player', search: 'Search player or account…', all: 'All', team: 'On a team', market: 'On the market',
    player: 'Player', where: 'Where', value: 'Value', salary: 'Salary', base: 'Base', choose: 'Choose', chosen: 'Chosen',
    onMarket: 'On the market · {price} {cur}', more: '{n} more player(s) · narrow the search',
    applyTitle: '2 · Contract', range: '{count} matches in the last 30 days · salary range {min} ~ {max} · now {now}', rangeBad: 'Cannot be used: {why}',
    fewMatches: 'not enough matches ({count}/10)', same: 'same salary in every match, nothing to re-roll', rangeLoading: 'Reading the salary range…',
    target: 'Account whose contract is used', kind: 'Contract', apply: 'Apply the contract',
    steps: { check: 'Checking…', unlist: 'Taking it off the market…', trade: 'Trading…', use: 'Using the contract…' },
    askIntro: 'For {name}:', askUnlist: 'the market listing on {acc} is taken off', askTrade: 'it is moved by a trade {from} → {to}', askUse: '{kind} is used on {to}; the salary is rolled again between {min} ~ {max} (cannot be undone)',
    yes: 'Yes, apply', cancel: 'Cancel', done: '{name} · salary {before} → {after}',
    listTitle: 'Players with a new contract', listHint: 'Prices come from Auto Trade pricing; list, turn into cards (moved to main) or fire.', listEmpty: 'No contract applied yet.',
    how: [
      'First "Read players and contracts": every account\'s roster, your own market listings and the Laborer Contracts in the bags are read at once, without signing in.',
      'Choose the player. The game\'s rule: the player needs at least 10 matches in the last 30 days with different salaries; the new salary is rolled in that range (lowest ~ highest).',
      'Choose the account whose contract is used and the kind (Normal / Special). A listed player is taken off the market, a player on another account is traded there, then the contract is used.',
      'The player goes to the list below with the old and new salary: list it (price from Auto Trade pricing), turn it into cards (moved to main) or fire it.'
    ]
  },
  get fil() { return filOf(this.en); }
};

const LIMIT = 200;

export default function LaborTab({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const lb = state.labor || { contracts: {}, busy: null };
  const accounts = state.accounts || [];
  const accName = id => accounts.find(a => a.id === id)?.name || id;
  const [cands, setCands] = useState(null);
  const [q, setQ] = useState('');
  const [where, setWhere] = useState('all');
  const [pick, setPick] = useState(null);
  const [range, setRange] = useState(null);
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState('');
  const [ask, setAsk] = useState(false);
  const read = () => api.labor.read().then(r => setCands(r.candidates || [])).catch(e => toast(e.message, 'error'));
  useEffect(() => { if (!cands && !lb.reading) read(); }, []);
  const contracts = lb.contracts || {};
  const withContract = Object.keys(contracts);
  const kinds = useMemo(() => { const m = new Map(); for (const list of Object.values(contracts)) for (const c of list) m.set(c.itemId, c.name); return [...m.entries()]; }, [contracts]);
  const rows = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tr');
    return (cands || []).filter(c => (where === 'all' || c.where === where) && (!s || String(c.name || '').toLocaleLowerCase('tr').includes(s) || accName(c.accountId).toLocaleLowerCase('tr').includes(s)));
  }, [cands, q, where, accounts]);
  const choose = c => {
    setPick(c); setRange(null);
    const tg = contracts[c.accountId] ? c.accountId : (withContract[0] || '');
    setTarget(tg); setKind(contracts[tg]?.[0]?.itemId || '');
    api.labor.range(c.playerId).then(setRange).catch(e => setRange({ error: e.message }));
  };
  const pickTarget = id => { setTarget(id); if (!contracts[id]?.some(c => c.itemId === kind)) setKind(contracts[id]?.[0]?.itemId || ''); };
  const apply = async () => {
    setAsk(false);
    try {
      const r = await api.labor.apply({ fromAccountId: pick.accountId, playerId: pick.playerId, ticketId: pick.where === 'market' ? pick.ticketId : null, toAccountId: target, itemId: kind });
      toast(fill(x.done, { name: pick.name, before: num(r.before), after: num(r.after) }), 'success');
      if (r.candidates) setCands(r.candidates);
      setPick(null); setRange(null);
    } catch (e) { toast(e.message, 'error'); }
  };
  const busy = lb.busy;
  const kindName = kinds.find(([id]) => id === kind)?.[1] || '';
  const roles = state.cards?.roles || [];
  const players = useMemo(() => new Map((state.players?.players || []).map(p => [p.id, p])), [state.players]);
  const dx = DRAFT_TEXT[t.lang] || DRAFT_TEXT.en;
  const mainName = accName(state.accountProfile?.mainAccountId) || null;

  return <>
    {ask && pick && <div className="modal-backdrop" onClick={() => setAsk(false)}><div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
      <p><b>{fill(x.askIntro, { name: pick.name })}</b></p>
      <ul className="fire-list">
        {pick.where === 'market' && <li>{fill(x.askUnlist, { acc: accName(pick.accountId) })}</li>}
        {pick.accountId !== target && <li>{fill(x.askTrade, { from: accName(pick.accountId), to: accName(target) })}</li>}
        <li>{fill(x.askUse, { to: accName(target), kind: kindName, min: num(range?.min), max: num(range?.max) })}</li>
      </ul>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setAsk(false)}>{x.cancel}</button><button className="btn primary" autoFocus onClick={apply}>{x.yes}</button></div>
    </div></div>}

    <div className="panel pg-bar">
      <button className="btn ghost" disabled={lb.reading} onClick={read}>{lb.reading ? x.reading : x.read}</button>
      {lb.readAt && <span className="muted-text">{fill(x.readAt, { time: new Date(lb.readAt).toLocaleTimeString() })}</span>}
      <span className="sp" />
      <span className="muted-text">{x.contracts}:</span>
      {withContract.length ? withContract.map(id => <span key={id} className="pill muted"><i />{accName(id)} · {contracts[id].map(c => `${c.name.replace(/laborer contract/i, '').trim() || c.name} ×${c.quantity}`).join(', ')}</span>) : <span className="muted-text">{x.noContracts}</span>}
    </div>

    {pick && <div className="panel labor-pick">
      <h3 className="section-title">{x.applyTitle}</h3>
      <p><b>{pick.name}</b> <RatingBadge grade={pick.rating} mini /> <span className="muted-text">{pick.position} · {accName(pick.accountId)} · {pick.where === 'market' ? fill(x.onMarket, { price: num(pick.price), cur: pick.currency }) : x.team}</span></p>
      <p className={range && !range.ok ? 'bad-text' : 'muted-text'}>{!range ? x.rangeLoading : range.error ? range.error : range.ok ? fill(x.range, { count: range.count, min: num(range.min), max: num(range.max), now: num(pick.salary) }) : fill(x.rangeBad, { why: range.count < 10 ? fill(x.fewMatches, { count: range.count }) : x.same })}</p>
      <div className="labor-form">
        <label>{x.target} <select value={target} onChange={e => pickTarget(e.target.value)}>{withContract.map(id => <option key={id} value={id}>{accName(id)}</option>)}</select></label>
        <label>{x.kind} <select value={kind} onChange={e => setKind(e.target.value)}>{(contracts[target] || []).map(c => <option key={c.itemId} value={c.itemId}>{c.name} ×{c.quantity}</option>)}</select></label>
        <span className="sp" />
        <button className="btn ghost" onClick={() => { setPick(null); setRange(null); }}>{x.cancel}</button>
        {busy ? <span className="pill warn"><i />{x.steps[busy.step] || busy.step}</span>
          : <button className="btn primary" disabled={!range?.ok || !target || !kind} onClick={() => setAsk(true)}>{x.apply}</button>}
      </div>
    </div>}

    <h3 className="section-title">{x.pickTitle}</h3>
    <div className="panel pg-bar">
      <input className="ab-list-search" placeholder={x.search} value={q} onChange={e => setQ(e.target.value)} />
      {[['all', x.all], ['team', x.team], ['market', x.market]].map(([k, l]) => <button key={k} className={`chip ${where === k ? 'active' : ''}`} onClick={() => setWhere(k)}>{l}</button>)}
    </div>
    <div className="panel table-panel"><SortTable>
      <thead><tr><th>{x.player}</th><th>{x.account}</th><th>{x.where}</th><th>{x.value}</th><th>{x.salary}</th><th>{x.base}</th><th /></tr></thead>
      <tbody>{rows.slice(0, LIMIT).map(c => <tr key={c.accountId + c.playerId + (c.ticketId || '')} className={pick?.playerId === c.playerId ? 'selected-row-soft' : ''}>
        <td><b>{c.name}</b> <span className="muted-text">{c.position}</span> <RatingBadge grade={c.rating} mini /></td>
        <td>{accName(c.accountId)}</td>
        <td>{c.where === 'market' ? fill(x.onMarket, { price: num(c.price), cur: c.currency }) : x.team}</td>
        <td className="num">{num(c.value)}</td><td className="num">{num(c.salary)}</td><td className="num">{num(c.base)}</td>
        <td className="actions"><button className="btn ghost small" disabled={Boolean(busy)} onClick={() => choose(c)}>{pick?.playerId === c.playerId ? x.chosen : x.choose}</button></td>
      </tr>)}</tbody>
    </SortTable>{rows.length > LIMIT && <p className="muted-text">{fill(x.more, { n: rows.length - LIMIT })}</p>}</div>

    <Drafted d={state.draft || {}} x={dx} players={players} roles={roles} toast={toast} mainName={mainName} source="labor" title={x.listTitle} hint={x.listHint} empty={x.listEmpty} />
    <details className="panel pvp-how"><summary>{t.lang === 'tr' ? 'Nasıl çalışır?' : 'How does it work?'}</summary><ul>{x.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}
