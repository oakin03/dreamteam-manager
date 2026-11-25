import SortTable from './SortTable';
import { roleDefs, roleOf } from './AccountRoles';
import { useGroupedRows, groupRowOf, asAccounts } from './AccountGroups';
import { filOf } from '../i18n-fil';

// Rotasyon (user 2026-11-13): on/off per game mode (all on by default) and the matches it is
// playing right now, each with a stop button for that match.
const api = window.dreamteam;
const TEXT = {
  tr: {
    title: 'Rotasyon', hint: 'Bu modların maçlarında uygulama oyuncuları senin planınla değiştirir, molaları kullanır ve taktiği rakibe göre çevirir. Auto Play\'in PK maçlarına dokunmaz.',
    modes: { tournament: 'Turnuva', professional: 'Professional', tower: 'Kule', ascent: 'Elite Ascent', goup: 'Go-up', boss: 'Daily Boss', magic: 'Magic Team', pvp: 'PVP Arena' },
    rolesHint: 'Rol düğmeleri: o modda hangi hesap rollerinin rotasyon yapacağı. Dummy rolü varsayılan olarak kapalı.', roleTitle: '{role} · bu modda {n} hesap', live: 'Şu an yönetilen maçlar', none: 'Şu an yönetilen maç yok.', account: 'Hesap', mode: 'Mod', time: 'Periyot', score: 'Skor', subs: 'Değişiklik', timeouts: 'Mola', tactics: 'Taktik', stop: 'Bu maçta durdur', aces: 'As kadro döndü', left: 'kalan'
  },
  en: {
    title: 'Rotation', hint: 'In the matches of these modes the app rotates the players by your plan, uses the timeouts and switches tactics against the opponent. Auto Play\'s PK matches are left alone.',
    modes: { tournament: 'Tournament', professional: 'Professional', tower: 'Tower', ascent: 'Elite Ascent', goup: 'Go-up', boss: 'Daily Boss', magic: 'Magic Team', pvp: 'PVP Arena' },
    rolesHint: 'Role buttons: which account roles rotate in that mode. The Dummy role is off by default.', roleTitle: '{role} · {n} account(s) in this mode', live: 'Matches handled now', none: 'No match handled right now.', account: 'Account', mode: 'Mode', time: 'Quarter', score: 'Score', subs: 'Substitutions', timeouts: 'Timeouts', tactics: 'Tactics', stop: 'Stop for this match', aces: 'Aces back', left: 'left'
  },
  get fil() { return filOf(this.en); }
};

export function RotationModes({ state, t, toast, only = null }) {
  const x = TEXT[t.lang] || TEXT.en;
  const modes = state.rotation?.modes || {};
  const list = only ? only : Object.keys(x.modes);
  // per mode the account roles that rotate (user 2026-11-25: chosen by role; Dummy off by default)
  const defs = roleDefs(state.settings);
  const accounts = state.accounts || [];
  const count = {};
  for (const a of accounts) { const r = roleOf(a, state.accountProfile, defs); count[r] = (count[r] || 0) + 1; }
  const used = defs.filter(d => count[d.id]);
  const onRoles = m => state.rotation?.roles?.[m] || [];
  const fillT = (s, p) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
  return <div className="panel rot-modes">
    <b>{x.title}</b><span className="muted-text">{x.hint}</span>
    <span className="muted-text">{x.rolesHint}</span>
    <div className="rot-mode-rows">{list.map(m => <div key={m} className="rot-mode-row">
      <label className="switchline"><input type="checkbox" checked={modes[m] !== false} onChange={e => api.rotation.setMode(m, e.target.checked).catch(err => toast(err.message, 'error'))} /><span>{x.modes[m]}</span></label>
      <span className="rot-roles">{used.map(d => { const on = onRoles(m).includes(d.id); return <button key={d.id} type="button" disabled={modes[m] === false} className={`rot-role ${on ? 'on' : ''}`} style={{ '--role': d.color }} title={fillT(x.roleTitle, { role: d.name, n: count[d.id] })} onClick={() => api.rotation.setRole(m, d.id, !on).catch(err => toast(err.message, 'error'))}><i />{d.name} <small>{count[d.id]}</small></button>; })}</span>
    </div>)}</div>
  </div>;
}

export function RotationLive({ state, t, toast, mode = null }) {
  const x = TEXT[t.lang] || TEXT.en;
  const rows = (state.rotation?.live || []).filter(r => !mode || r.mode === mode);
  const grp = useGroupedRows('rotation-live');
  return <div className="panel table-panel">
    <div className="dp-table-head"><b>{x.live}</b></div>
    {rows.length ? <SortTable><thead><tr><th>{x.account}</th><th>{x.mode}</th><th>{x.time}</th><th>{x.score}</th><th>{x.subs}</th><th>{x.timeouts}</th><th>{x.tactics}</th><th /></tr></thead>
      <tbody>{grp(asAccounts(rows), r => <tr key={r.accountId}>
        <td><b>{r.name}</b>{r.opponent && <small className="cell-sub">vs {r.opponent}</small>}</td>
        <td>{x.modes[r.mode] || r.mode}</td>
        <td>{r.halftime ? 'HT' : r.quarter ? `Q${r.quarter} ${r.timeLeft || ''}` : '—'}</td>
        <td className="num"><b>{r.score ?? '—'}</b> – {r.oppScore ?? '—'}</td>
        <td className="num">{r.subs}{r.acesBack && <small className="cell-sub good-text">{x.aces}</small>}</td>
        <td className="num">{r.timeoutsUsed}{r.timeoutsLeft != null && <small className="cell-sub">{r.timeoutsLeft} {x.left}</small>}</td>
        <td className="num">{r.strategies}</td>
        <td className="actions"><button className="btn ghost small" disabled={r.off} onClick={() => api.rotation.stop(r.accountId).catch(e => toast(e.message, 'error'))}>{x.stop}</button></td>
      </tr>, groupRowOf(8, g => <><td /><td /><td /><td className="num">{g.reduce((n, r) => n + (r.subs || 0), 0)}</td><td className="num">{g.reduce((n, r) => n + (r.timeoutsUsed || 0), 0)}</td><td className="num">{g.reduce((n, r) => n + (r.strategies || 0), 0)}</td><td /></>))}</tbody></SortTable> : <p className="muted-text dp-pad">{x.none}</p>}
  </div>;
}
