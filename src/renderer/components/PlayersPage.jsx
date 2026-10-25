import { useMemo, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;
const GRADES = ['D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S-', 'S', 'S+'];
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const PAGE = 100;
const gradeRank = g => GRADES.indexOf(g);
const num = v => v == null ? '—' : Number(v).toLocaleString();
const gapPct = p => p.base > 0 ? Math.round(((p.value - p.base) / p.base) * 1000) / 10 : null;

const TEXT = {
  tr: {
    title: 'Oyuncular', subtitle: '{count} oyuncu · son güncelleme {at} · sonraki {next}', never: 'henüz yok', refresh: 'Yenile', refreshing: 'Yenileniyor…',
    up: 'Artan', down: 'Düşen', atBase: 'Base\'de / altında', same: 'Değişmeyen',
    search: 'Oyuncu ara', team: 'Takım', position: 'Mevki', rating: 'Rating', min: 'en az', max: 'en çok', value: 'Değer', base: 'Base', change: 'Değişim', gap: 'Base farkı', roles: 'Roller', card: 'Kart',
    all: 'Hepsi', changeUp: 'Artanlar', changeDown: 'Düşenler', changeNone: 'Değişmeyenler', baseOnly: 'Base\'de / altında', baseNear: 'Base\'e %10 yakın', baseNot: 'Base üstünde',
    roleAny: 'Rolü olanlar', roleNone: 'Rolü olmayanlar', cardHas: 'Kartı olanlar', cardNo: 'Kartı olmayanlar', cardNoTeam: 'No Team', injured: 'Sakat', healthy: 'Sağlıklı', health: 'Sağlık',
    reset: 'Filtreleri temizle', player: 'Oyuncu', shown: '{shown} / {total} gösteriliyor', page: 'Sayfa {p} / {n}', noData: 'Liste henüz alınmadı. "Yenile" ile şimdi alabilirsin; her gün 11:05\'ten sonra otomatik alınır.',
    baseBadge: 'Base', baseHint: 'Değeri Base değerinde ya da altında', ratingWas: 'önceki gün {g}', editRoles: 'Rolleri düzenle', addBuy: 'Auto Buy listesine ekle', addBuySel: 'Seçilileri Auto Buy listesine ekle ({n})', inBuy: 'Auto Buy listesinde', addedBuy: '{n} oyuncu Auto Buy listesine eklendi', clearSel: 'Seçimi temizle', noTeam: 'No Team', stars: '★{s}', cards: '{n} kart', modified: 'Değiştirilmiş'
  },
  en: {
    title: 'Players', subtitle: '{count} players · updated {at} · next {next}', never: 'not yet', refresh: 'Refresh', refreshing: 'Refreshing…',
    up: 'Up', down: 'Down', atBase: 'At / below base', same: 'Unchanged',
    search: 'Search player', team: 'Team', position: 'Position', rating: 'Rating', min: 'min', max: 'max', value: 'Value', base: 'Base', change: 'Change', gap: 'Over base', roles: 'Roles', card: 'Card',
    all: 'All', changeUp: 'Going up', changeDown: 'Going down', changeNone: 'Unchanged', baseOnly: 'At / below base', baseNear: 'Within 10% of base', baseNot: 'Above base',
    roleAny: 'With a role', roleNone: 'Without a role', cardHas: 'With cards', cardNo: 'Without cards', cardNoTeam: 'No Team', injured: 'Injured', healthy: 'Healthy', health: 'Health',
    reset: 'Clear filters', player: 'Player', shown: '{shown} / {total} shown', page: 'Page {p} / {n}', noData: 'No list yet. Press "Refresh" to get it now; it is fetched automatically every day after 11:05.',
    baseBadge: 'Base', baseHint: 'Value at or below its base', ratingWas: 'was {g} yesterday', editRoles: 'Edit roles', addBuy: 'Add to Auto Buy', addBuySel: 'Add selected to Auto Buy ({n})', inBuy: 'On the Auto Buy list', addedBuy: '{n} player(s) added to Auto Buy', clearSel: 'Clear selection', noTeam: 'No Team', stars: '★{s}', cards: '{n} cards', modified: 'Modified'
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const EMPTY = { q: '', team: '', position: '', ratingMin: '', ratingMax: '', valueMin: '', valueMax: '', change: '', base: '', role: '', card: '', health: '' };

export default function PlayersPage({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const data = state.players || {};
  const list = data.players || [];
  const roles = state.cards?.roles || [];
  const [f, setF] = useState(EMPTY);
  const [sort, setSort] = useState({ key: 'value', dir: 'desc' });
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const inBuy = useMemo(() => new Set((state.buy?.watch || []).map(w => w.playerId)), [state.buy]);
  const togglePick = id => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const addToBuy = async list => { try { const r = await api.buy.addWatch(list.map(p => ({ id: p.id, name: p.name, team: p.team, position: p.position, rating: p.rating, value: p.value, base: p.base }))); toast(fill(x.addedBuy, { n: r?.added ?? list.length }), 'success'); setPicked(new Set()); } catch (e) { toast(e.message, 'error'); } };
  const set = patch => { setF(v => ({ ...v, ...patch })); setPage(0); };
  const teams = useMemo(() => [...new Set(list.map(p => p.team).filter(Boolean))].sort(), [list]);
  const counts = useMemo(() => ({ up: list.filter(p => p.change > 0).length, down: list.filter(p => p.change < 0).length, base: list.filter(p => p.isBase).length, same: list.filter(p => !p.change).length }), [list]);

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const out = list.filter(p => {
      if (q && !String(p.name).toLowerCase().includes(q)) return false;
      if (f.team && p.team !== f.team) return false;
      if (f.position && !String(p.position || '').split('/').includes(f.position)) return false;
      if (f.ratingMin && gradeRank(p.rating) < gradeRank(f.ratingMin)) return false;
      if (f.ratingMax && gradeRank(p.rating) > gradeRank(f.ratingMax)) return false;
      if (f.valueMin !== '' && p.value < Number(f.valueMin)) return false;
      if (f.valueMax !== '' && p.value > Number(f.valueMax)) return false;
      if (f.change === 'up' && !(p.change > 0)) return false;
      if (f.change === 'down' && !(p.change < 0)) return false;
      if (f.change === 'none' && p.change) return false;
      if (f.base === 'at' && !p.isBase) return false;
      if (f.base === 'near' && !(gapPct(p) != null && gapPct(p) <= 10)) return false;
      if (f.base === 'not' && p.isBase) return false;
      if (f.role === 'any' && !p.roleIds.length) return false;
      if (f.role === 'none' && p.roleIds.length) return false;
      if (f.role === 'base' && !p.isBase) return false;
      if (f.role && !['any', 'none', 'base'].includes(f.role) && !p.roleIds.includes(f.role)) return false;
      if (f.card === 'has' && !(p.card && p.card.cardCount > 0)) return false;
      if (f.card === 'no' && p.card && p.card.cardCount > 0) return false;
      if (f.card === 'noTeam' && !p.card?.noTeam) return false;
      if (f.health === 'injured' && !p.injured) return false;
      if (f.health === 'healthy' && p.injured) return false;
      return true;
    });
    const val = p => ({ name: String(p.name).toLowerCase(), team: p.team || '', position: p.position || '', rating: gradeRank(p.rating), value: p.value, base: p.base, change: p.change, gap: gapPct(p) ?? 1e9, card: p.card?.stars ?? -1, roles: p.roleIds.length + (p.isBase ? 1 : 0) })[sort.key];
    out.sort((a, b) => { const av = val(a), bv = val(b); const c = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv)); return sort.dir === 'asc' ? c : -c; });
    return out;
  }, [list, f, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const visible = rows.slice(Math.min(page, pages - 1) * PAGE, Math.min(page, pages - 1) * PAGE + PAGE);
  const sortBy = key => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const th = (key, label) => <th className="sortable" onClick={() => sortBy(key)}>{label}{sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>;
  const refresh = async () => { try { await api.players.refresh(); } catch (e) { toast(e.message, 'error'); } };
  const toggleRole = async (p, roleId) => { const next = p.roleIds.includes(roleId) ? p.roleIds.filter(r => r !== roleId) : [...p.roleIds, roleId]; try { await api.players.setRoles(p.id, next); } catch (e) { toast(e.message, 'error'); } };
  const at = data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : x.never;
  const next = data.nextAt ? new Date(data.nextAt).toLocaleString() : '—';

  return <div className="page players-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{fill(x.subtitle, { count: list.length, at, next })}</span></div>
      <div className="toolbar"><button className="btn primary" disabled={data.busy} onClick={refresh}>{data.busy ? x.refreshing : x.refresh}</button></div></div>
    {data.error && <div className="panel pl-error">{data.error}</div>}
    {!list.length ? <div className="panel empty-state">{x.noData}</div> : <>
      <div className="pl-summary">
        <button className={`pl-stat up ${f.change === 'up' ? 'on' : ''}`} onClick={() => set({ change: f.change === 'up' ? '' : 'up' })}><span>{x.up}</span><b>▲ {counts.up}</b></button>
        <button className={`pl-stat down ${f.change === 'down' ? 'on' : ''}`} onClick={() => set({ change: f.change === 'down' ? '' : 'down' })}><span>{x.down}</span><b>▼ {counts.down}</b></button>
        <button className={`pl-stat base ${f.base === 'at' ? 'on' : ''}`} onClick={() => set({ base: f.base === 'at' ? '' : 'at' })}><span>{x.atBase}</span><b>{counts.base}</b></button>
        <button className={`pl-stat ${f.change === 'none' ? 'on' : ''}`} onClick={() => set({ change: f.change === 'none' ? '' : 'none' })}><span>{x.same}</span><b>{counts.same}</b></button>
      </div>
      <div className="pl-filters panel">
        <input placeholder={x.search} value={f.q} onChange={e => set({ q: e.target.value })} />
        <select value={f.team} onChange={e => set({ team: e.target.value })}><option value="">{x.team}: {x.all}</option>{teams.map(v => <option key={v}>{v}</option>)}</select>
        <select value={f.position} onChange={e => set({ position: e.target.value })}><option value="">{x.position}: {x.all}</option>{POSITIONS.map(v => <option key={v}>{v}</option>)}</select>
        <select value={f.ratingMin} onChange={e => set({ ratingMin: e.target.value })}><option value="">{x.rating} {x.min}</option>{GRADES.map(v => <option key={v}>{v}</option>)}</select>
        <select value={f.ratingMax} onChange={e => set({ ratingMax: e.target.value })}><option value="">{x.rating} {x.max}</option>{GRADES.map(v => <option key={v}>{v}</option>)}</select>
        <input type="number" min="0" placeholder={`${x.value} ${x.min}`} value={f.valueMin} onChange={e => set({ valueMin: e.target.value })} />
        <input type="number" min="0" placeholder={`${x.value} ${x.max}`} value={f.valueMax} onChange={e => set({ valueMax: e.target.value })} />
        <select value={f.change} onChange={e => set({ change: e.target.value })}><option value="">{x.change}: {x.all}</option><option value="up">{x.changeUp}</option><option value="down">{x.changeDown}</option><option value="none">{x.changeNone}</option></select>
        <select value={f.base} onChange={e => set({ base: e.target.value })}><option value="">{x.base}: {x.all}</option><option value="at">{x.baseOnly}</option><option value="near">{x.baseNear}</option><option value="not">{x.baseNot}</option></select>
        <select value={f.role} onChange={e => set({ role: e.target.value })}><option value="">{x.roles}: {x.all}</option><option value="base">{x.baseBadge}</option><option value="any">{x.roleAny}</option><option value="none">{x.roleNone}</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select value={f.card} onChange={e => set({ card: e.target.value })}><option value="">{x.card}: {x.all}</option><option value="has">{x.cardHas}</option><option value="no">{x.cardNo}</option><option value="noTeam">{x.cardNoTeam}</option></select>
        <select value={f.health} onChange={e => set({ health: e.target.value })}><option value="">{x.health}: {x.all}</option><option value="healthy">{x.healthy}</option><option value="injured">{x.injured}</option></select>
        <button className="btn ghost small" onClick={() => { setF(EMPTY); setPage(0); }}>{x.reset}</button>
        {picked.size > 0 && <><button className="btn success small" onClick={() => addToBuy(list.filter(p => picked.has(p.id)))}>{fill(x.addBuySel, { n: picked.size })}</button><button className="btn ghost small" onClick={() => setPicked(new Set())}>{x.clearSel}</button></>}
        <span className="pl-count">{fill(x.shown, { shown: rows.length, total: list.length })}</span>
      </div>
      <div className="panel table-panel pl-table"><SortTable>
        <thead><tr><th><input type="checkbox" checked={visible.length > 0 && visible.every(p => picked.has(p.id))} onChange={e => setPicked(prev => { const n = new Set(prev); for (const p of visible) e.target.checked ? n.add(p.id) : n.delete(p.id); return n; })} /></th>{th('name', x.player)}{th('team', x.team)}{th('position', x.position)}{th('rating', x.rating)}{th('value', x.value)}{th('base', x.base)}{th('change', x.change)}{th('gap', x.gap)}{th('roles', x.roles)}{th('card', x.card)}<th></th></tr></thead>
        <tbody>{visible.map(p => <tr key={p.id} className={p.isBase ? 'pl-base-row' : ''}>
          <td><input type="checkbox" checked={picked.has(p.id)} onChange={() => togglePick(p.id)} /></td>
          <td><b>{p.name}</b>{p.injured && <span className="pl-injured" title={x.injured}>+</span>}</td>
          <td>{p.team || '—'}</td>
          <td>{p.position}</td>
          <td><span className="grade-badge">{p.rating}</span>{p.ratingBefore && <small className="pl-was">{fill(x.ratingWas, { g: p.ratingBefore })}</small>}</td>
          <td><b>{num(p.value)}</b></td>
          <td>{num(p.base)}</td>
          <td>{p.change ? <span className={p.change > 0 ? 'pl-up' : 'pl-down'}>{p.change > 0 ? '▲' : '▼'} {Math.abs(p.change)}</span> : <span className="muted-text">—</span>}</td>
          <td>{gapPct(p) == null ? '—' : <span className={p.isBase ? 'pl-down' : ''}>{gapPct(p) > 0 ? '+' : ''}{gapPct(p)}%</span>}</td>
          <td><div className="pl-roles" onClick={() => setEditing(editing === p.id ? null : p.id)} title={x.editRoles}>
            {p.isBase && <span className="role-badge pl-base-badge" title={x.baseHint}>{x.baseBadge}</span>}
            {p.roleIds.map(id => roles.find(r => r.id === id)).filter(Boolean).map(r => <span key={r.id} className="role-badge" style={{ backgroundColor: r.color || '#64748b', borderColor: r.color || '#64748b' }}>{r.name}</span>)}
            {!p.isBase && !p.roleIds.length && <span className="muted-text">+</span>}
          </div>
            {editing === p.id && <div className="role-chips pl-role-edit">{roles.map(r => { const on = p.roleIds.includes(r.id); return <button key={r.id} className={on ? 'on' : ''} style={on ? { background: r.color, borderColor: r.color, color: '#fff' } : undefined} onClick={() => toggleRole(p, r.id)}>{r.name}</button>; })}</div>}
          </td>
          <td>{p.card ? <span className="pl-card">{p.card.customTeam ? <em className="modified-badge">{x.modified}</em> : null}{p.card.noTeam && !p.card.customTeam ? x.noTeam : fill(x.stars, { s: p.card.stars ?? 0 })} · {fill(x.cards, { n: p.card.cardCount })}</span> : <span className="muted-text">—</span>}</td>
          <td className="actions">{inBuy.has(p.id) ? <span className="pill ok" title={x.inBuy}><i />Auto Buy</span> : <button className="btn ghost small" title={x.addBuy} onClick={() => addToBuy([p])}>+ Auto Buy</button>}</td>
        </tr>)}</tbody>
      </SortTable></div>
      {pages > 1 && <div className="pl-pager"><button className="btn ghost small" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button><span>{fill(x.page, { p: Math.min(page, pages - 1) + 1, n: pages })}</span><button className="btn ghost small" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>›</button></div>}
    </>}
  </div>;
}
