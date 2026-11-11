import { useMemo, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import { roleColors } from './roleColors';
import RatingBadge from './RatingBadge';
import InjuryMark from './InjuryMark';
import { roleDefs, roleOf, RolePill } from './AccountRoles';

// "Kadrolarım" (user 2026-11-09): the starters and the bench of every account, with filters.
const api = window.dreamteam;
const GRADES = ['D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S-', 'S', 'S+'];
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const PAGE = 100;
const gradeRank = g => GRADES.indexOf(g);
const num = v => v == null ? '—' : Number(v).toLocaleString();

const TEXT = {
  tr: {
    subtitle: '{rows} oyuncu · {accounts} hesap · son okuma {at}', never: 'henüz yok', refresh: 'Kadroları oku', refreshing: 'Okunuyor… {done}/{total}',
    noData: 'Kadrolar henüz okunmadı. "Kadroları oku" ile bütün hesapların ilk 5 ve bench oyuncuları okunur (oturum açmadan, oyun sekmelerine dokunmaz).',
    search: 'Oyuncu ara', account: 'Hesap', accountRole: 'Hesap rolü', group: 'Yer', starter: 'İlk 5', bench: 'Bench', team: 'Takım', position: 'Mevki',
    rating: 'Rating', min: 'en az', max: 'en çok', value: 'Değer', base: 'Base', salary: 'Maaş', change: 'Değişim', roles: 'Roller', all: 'Hepsi',
    roleAny: 'Rolü olanlar', roleNone: 'Rolü olmayanlar', health: 'Sağlık', injured: 'Sakat', healthy: 'Sağlıklı', kind: 'Tür', normal: 'Normal', xp: 'X oyuncu', temp: 'Geçici',
    reset: 'Filtreleri temizle', shown: '{shown} / {total} gösteriliyor', page: 'Sayfa {p} / {n}', player: 'Oyuncu', level: 'Lv',
    sumStarter: 'İlk 5', sumBench: 'Bench', sumAccounts: 'Hesap', failed: '{n} hesap okunamadı: {names}', atBase: 'Base\'de / altında'
  },
  en: {
    subtitle: '{rows} players · {accounts} accounts · read {at}', never: 'not yet', refresh: 'Read rosters', refreshing: 'Reading… {done}/{total}',
    noData: 'No rosters read yet. "Read rosters" reads the starters and bench of every account (without signing in, game tabs are not touched).',
    search: 'Search player', account: 'Account', accountRole: 'Account role', group: 'Place', starter: 'Starting 5', bench: 'Bench', team: 'Team', position: 'Position',
    rating: 'Rating', min: 'min', max: 'max', value: 'Value', base: 'Base', salary: 'Salary', change: 'Change', roles: 'Roles', all: 'All',
    roleAny: 'With a role', roleNone: 'Without a role', health: 'Health', injured: 'Injured', healthy: 'Healthy', kind: 'Kind', normal: 'Normal', xp: 'X player', temp: 'Temporary',
    reset: 'Clear filters', shown: '{shown} / {total} shown', page: 'Page {p} / {n}', player: 'Player', level: 'Lv',
    sumStarter: 'Starting 5', sumBench: 'Bench', sumAccounts: 'Accounts', failed: '{n} account(s) could not be read: {names}', atBase: 'At / below base'
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const EMPTY = { q: '', account: '', accountRole: '', group: '', team: '', position: '', ratingMin: '', ratingMax: '', valueMin: '', valueMax: '', role: '', health: '', kind: '', base: '' };

export default function RostersTab({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const data = state.rosters || {};
  const all = data.rows || [];
  const roles = state.cards?.roles || [];
  const defs = roleDefs(state.settings);
  const profile = state.accountProfile || {};
  const accById = useMemo(() => new Map((state.accounts || []).map(a => [a.id, a])), [state.accounts]);
  const roleIdsOf = useMemo(() => new Map((state.players?.players || []).map(p => [p.id, p.roleIds || []])), [state.players]);
  const [f, setF] = useState(EMPTY);
  const [sort, setSort] = useState({ key: '', dir: 'asc' });
  const [page, setPage] = useState(0);
  const set = patch => { setF(v => ({ ...v, ...patch })); setPage(0); };

  const list = useMemo(() => all.map(r => {
    const acc = accById.get(r.accountId);
    return { ...r, roleIds: roleIdsOf.get(r.id) || [], accRole: acc ? roleOf(acc, profile, defs) : null, atBase: r.base != null && r.value != null && r.value <= r.base };
  }), [all, accById, roleIdsOf, profile, defs]);
  const accounts = useMemo(() => [...new Map(list.map(r => [r.accountId, r.account])).entries()], [list]);
  const teams = useMemo(() => [...new Set(list.map(r => r.team).filter(Boolean))].sort(), [list]);

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const out = list.filter(r => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (f.account && r.accountId !== f.account) return false;
      if (f.accountRole && r.accRole !== f.accountRole) return false;
      if (f.group && r.group !== f.group) return false;
      if (f.team && r.team !== f.team) return false;
      if (f.position && !String(r.position).split('/').includes(f.position)) return false;
      if (f.ratingMin && gradeRank(r.rating) < gradeRank(f.ratingMin)) return false;
      if (f.ratingMax && gradeRank(r.rating) > gradeRank(f.ratingMax)) return false;
      if (f.valueMin !== '' && !(r.value >= Number(f.valueMin))) return false;
      if (f.valueMax !== '' && !(r.value <= Number(f.valueMax))) return false;
      if (f.base === 'at' && !r.atBase) return false;
      if (f.role === 'any' && !r.roleIds.length) return false;
      if (f.role === 'none' && r.roleIds.length) return false;
      if (f.role && !['any', 'none'].includes(f.role) && !r.roleIds.includes(f.role)) return false;
      if (f.health === 'injured' && !r.injured) return false;
      if (f.health === 'healthy' && r.injured) return false;
      if (f.kind === 'normal' && (r.x || r.temporary)) return false;
      if (f.kind === 'x' && !r.x) return false;
      if (f.kind === 'temp' && !r.temporary) return false;
      return true;
    });
    if (sort.key) {
      const val = r => ({ account: r.account.toLowerCase(), group: r.group === 'starter' ? 0 : 1, name: r.name.toLowerCase(), team: r.team, position: r.position, rating: gradeRank(r.rating), value: r.value ?? -1, base: r.base ?? -1, salary: r.salary ?? -1, change: r.change || 0, level: Number(r.level) || 0 })[sort.key];
      out.sort((a, b) => { const av = val(a), bv = val(b); const c = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv)); return sort.dir === 'asc' ? c : -c; });
    }
    return out;
  }, [list, f, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const visible = rows.slice(cur * PAGE, cur * PAGE + PAGE);
  const sortBy = key => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  const th = (key, label) => <th className="sortable" onClick={() => sortBy(key)}>{label}{sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>;
  const refresh = async () => { try { await api.rosters.refresh(); } catch (e) { toast(e.message, 'error'); } };
  const at = data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : x.never;
  const starters = rows.filter(r => r.group === 'starter').length;

  return <div className="rosters-tab">
    <div className="rs-head">
      <span className="subtitle">{fill(x.subtitle, { rows: all.length, accounts: accounts.length, at })}</span>
      <button className="btn primary" disabled={Boolean(data.busy)} onClick={refresh}>{data.busy ? fill(x.refreshing, data.busy) : x.refresh}</button>
    </div>
    {data.failed?.length > 0 && <div className="panel pl-error">{fill(x.failed, { n: data.failed.length, names: data.failed.map(a => a.name).join(', ') })}</div>}
    {!all.length ? <div className="panel empty-state">{x.noData}</div> : <>
      <div className="pl-summary">
        <button className={`pl-stat ${f.group === 'starter' ? 'on' : ''}`} onClick={() => set({ group: f.group === 'starter' ? '' : 'starter' })}><span>{x.sumStarter}</span><b>{starters}</b></button>
        <button className={`pl-stat ${f.group === 'bench' ? 'on' : ''}`} onClick={() => set({ group: f.group === 'bench' ? '' : 'bench' })}><span>{x.sumBench}</span><b>{rows.length - starters}</b></button>
        <div className="pl-stat"><span>{x.sumAccounts}</span><b>{new Set(rows.map(r => r.accountId)).size}</b></div>
      </div>
      <div className="pl-filters panel">
        <input placeholder={x.search} value={f.q} onChange={e => set({ q: e.target.value })} />
        <select value={f.account} onChange={e => set({ account: e.target.value })}><option value="">{x.account}: {x.all}</option>{accounts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <select value={f.accountRole} onChange={e => set({ accountRole: e.target.value })}><option value="">{x.accountRole}: {x.all}</option>{defs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select value={f.group} onChange={e => set({ group: e.target.value })}><option value="">{x.group}: {x.all}</option><option value="starter">{x.starter}</option><option value="bench">{x.bench}</option></select>
        <select value={f.team} onChange={e => set({ team: e.target.value })}><option value="">{x.team}: {x.all}</option>{teams.map(v => <option key={v}>{v}</option>)}</select>
        <select value={f.position} onChange={e => set({ position: e.target.value })}><option value="">{x.position}: {x.all}</option>{POSITIONS.map(v => <option key={v}>{v}</option>)}</select>
        <select value={f.ratingMin} onChange={e => set({ ratingMin: e.target.value })}><option value="">{x.rating} {x.min}</option>{GRADES.map(v => <option key={v}>{v}</option>)}</select>
        <select value={f.ratingMax} onChange={e => set({ ratingMax: e.target.value })}><option value="">{x.rating} {x.max}</option>{GRADES.map(v => <option key={v}>{v}</option>)}</select>
        <input type="number" min="0" placeholder={`${x.value} ${x.min}`} value={f.valueMin} onChange={e => set({ valueMin: e.target.value })} />
        <input type="number" min="0" placeholder={`${x.value} ${x.max}`} value={f.valueMax} onChange={e => set({ valueMax: e.target.value })} />
        <select value={f.base} onChange={e => set({ base: e.target.value })}><option value="">{x.base}: {x.all}</option><option value="at">{x.atBase}</option></select>
        <select value={f.role} onChange={e => set({ role: e.target.value })}><option value="">{x.roles}: {x.all}</option><option value="any">{x.roleAny}</option><option value="none">{x.roleNone}</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select value={f.health} onChange={e => set({ health: e.target.value })}><option value="">{x.health}: {x.all}</option><option value="healthy">{x.healthy}</option><option value="injured">{x.injured}</option></select>
        <select value={f.kind} onChange={e => set({ kind: e.target.value })}><option value="">{x.kind}: {x.all}</option><option value="normal">{x.normal}</option><option value="x">{x.xp}</option><option value="temp">{x.temp}</option></select>
        <button className="btn ghost small" onClick={() => { setF(EMPTY); setPage(0); }}>{x.reset}</button>
        <span className="pl-count">{fill(x.shown, { shown: rows.length, total: all.length })}</span>
      </div>
      <div className="panel table-panel pl-table"><SortTable>
        <thead><tr>{th('account', x.account)}{th('level', x.level)}{th('group', x.group)}{th('name', x.player)}{th('team', x.team)}{th('position', x.position)}{th('rating', x.rating)}{th('value', x.value)}{th('base', x.base)}{th('change', x.change)}{th('salary', x.salary)}<th>{x.roles}</th></tr></thead>
        <tbody>{visible.map(r => <tr key={r.accountId + r.id} className={r.atBase ? 'pl-base-row' : ''}>
          <td><b>{r.account}</b> {r.accRole && <RolePill small def={defs.find(d => d.id === r.accRole)} />}</td>
          <td>{r.level ?? '—'}</td>
          <td>{r.group === 'starter' ? <span className="pill ok"><i />{x.starter}{r.slot ? ` · ${r.slot}` : ''}</span> : <span className="pill muted"><i />{x.bench}</span>}</td>
          <td><b>{r.name}</b><InjuryMark name={r.name} />{r.injured && <small className="bad-text"> · {x.injured}</small>}{r.x && <small className="muted-text"> · X</small>}{r.temporary && <small className="muted-text"> · {x.temp}</small>}</td>
          <td>{r.team || '—'}</td>
          <td>{r.position}</td>
          <td><RatingBadge grade={r.rating} /></td>
          <td><b>{num(r.value)}</b></td>
          <td>{num(r.base)}</td>
          <td>{r.change ? <span className={r.change > 0 ? 'pl-up' : 'pl-down'}>{r.change > 0 ? '▲' : '▼'} {Math.abs(r.change)}</span> : <span className="muted-text">—</span>}</td>
          <td>{num(r.salary)}</td>
          <td><div className="pl-roles">{r.roleIds.map(id => roles.find(o => o.id === id)).filter(Boolean).map(o => <span key={o.id} className="role-badge" style={roleColors(o.color)}>{o.name}</span>)}</div></td>
        </tr>)}</tbody>
      </SortTable></div>
      {pages > 1 && <div className="pl-pager"><button className="btn ghost small" disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹</button><span>{fill(x.page, { p: cur + 1, n: pages })}</span><button className="btn ghost small" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>›</button></div>}
    </>}
  </div>;
}
