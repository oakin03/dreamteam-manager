import { useMemo, useState } from 'react';
import SortTable from './SortTable';
import { roleColors } from './roleColors';
import { filOf } from '../i18n-fil';
import RatingBadge from './RatingBadge';
import InjuryMark from './InjuryMark';

const api = window.dreamteam;
const TEXT = {
  tr: {
    title: 'Değer Tahmini', subtitle: 'NBA maçlarına göre oyuncuların sıra ve değer değişimi tahmini · oyunun kendi formülüyle',
    tabs: { pred: 'Tahminler', compare: 'Tahmin ve gerçek' },
    refresh: 'Şimdi güncelle', refreshing: 'Güncelleniyor…',
    lastGame: 'Son NBA maçı', games: 'Okunan maç', model: 'Güncelleme sınırı', predictedAt: 'Tahmin', accuracy: 'İsabet',
    modelText: 'S+ ±{s} · A ±{a} · B ±{b} · D- ±{d}', learned: 'formül oyundan öğrenildi', base: 'başlangıç formülü', none: '—', atFive: '5. maçta: {o} / {d}',
    note: 'Değerler her gün 11:00\'da (TR) değişir. O güncellemeye, önceki günden 11:00\'a kadar biten maçlar (başlangıç + 3 saat) girer: sadece o maçları oynayan takımların oyuncuları kendi istatistiğiyle değişir, diğerleri yalnızca sıra kayınca etkilenir. Takımı bu sezon 5 maça ulaşmadıysa oyuncunun kendi değeri değişmez ("5. maçta" beklenen değer soluk yazılır); oyuncunun kendi maç sayısı önemli değil. Ortalamalar takımın maç sayısına bölünür: oynamadığı maçlar 0 sayılır. Ofans ve defans her güncellemede yeni seviyeye doğru, rating grubunun sınırı kadar (S+ ±7 … D- ±24) kayar. Maç bitince tahmin o maçın istatistiğiyle yenilenir.',
    nextUpdate: 'Sonraki güncelleme {t} · {n} takım', ruleTeam: '5 maç kuralı: takımın', rulePlayer: '5 maç kuralı: oyuncunun', game: { final: 'maçı bitti', pre: 'maçı {t}', in: 'şu an maçta' },
    search: 'Oyuncu ara…', allTeams: 'Tüm takımlar', change: 'Tahmin', chAll: 'Hepsi', chUp: 'Yükselecek', chDown: 'Düşecek', chNone: 'Değişmeyecek',
    played: 'Sadece maç oynayanlar', roleAll: 'Tüm roller', roleNone: 'Rolsüz',
    player: 'Oyuncu', team: 'Takım', gp: 'Maç', avg: 'Bu sezon (S/R/A/TÇ/B)', offense: 'Ofans', defense: 'Defans', rank: 'Sıra', value: 'Değer', predicted: 'Tahmini değişim', rating: 'Rating', roles: 'Rol',
    gpHint: 'oyuncu {p} maç oynadı (güncellemede {u}) · takım {t} maç · 5 maçı olan ve pencerede oynayan oyuncu güncellenir', minutes: '{min} dk · {games} maç', noStats: 'bu sezon maç yok', missing: 'ESPN kadrolarında yok · 0 sayıldı', page: 'Sayfa', of: '/',
    sumUp: '{n} yükselecek', sumDown: '{n} düşecek',
    cmpEmpty: 'Henüz karşılaştırma yok. Oyun bir sonraki değer güncellemesini yapınca tahmin ile gerçek burada yan yana görünecek. (29 Ekim güncellemesi yeni kuralla geriye dönük denendi: sapma ±10 TK, yön %92.)',
    cmpN: 'Karşılaştırma', cmpMae: 'Ortalama sapma', cmpDir: 'Yön doğru', cmpExact: 'Tam isabet',
    updates: 'Oyunun güncellemeleri', updAt: 'Zaman', updChanged: 'Değişen oyuncu', updMae: 'Sapma', updDir: 'Yön doğru', updWindow: 'Ortalama türü',
    win: { season: 'sezon ortalaması', last5: 'son 5 maç' },
    when: 'Tarih', before: 'Önceki değer', pred: 'Tahmin', actual: 'Gerçekleşen', diff: 'Fark', tk: '{v} TK'
  },
  en: {
    title: 'Value Prediction', subtitle: 'Predicted rank and value changes of the players from the NBA games · with the game\'s own formula',
    tabs: { pred: 'Predictions', compare: 'Prediction vs actual' },
    refresh: 'Update now', refreshing: 'Updating…',
    lastGame: 'Last NBA game', games: 'Games read', model: 'Update limit', predictedAt: 'Prediction', accuracy: 'Accuracy',
    modelText: 'S+ ±{s} · A ±{a} · B ±{b} · D- ±{d}', learned: 'formula learned from the game', base: 'starting formula', none: '—', atFive: 'at game 5: {o} / {d}',
    note: 'Values change every day at 11:00 (TR). That update takes the games finished between the previous day and 11:00 (start + 3 h): only the players of the teams that played them change by their own stats, the others only when the rank shifts. If his team is under 5 games this season, a player keeps his own value (the value expected at game 5 is shown faded); the player\'s own game count does not matter. Averages are divided by the team\'s games: games he did not play count as 0. At every update offense and defense move toward the new level by at most the cap of the rating tier (S+ ±7 … D- ±24). When a game ends, the prediction is renewed with its stats.',
    nextUpdate: 'Next update {t} · {n} team(s)', ruleTeam: '5-game rule: the team\'s', rulePlayer: '5-game rule: the player\'s', game: { final: 'game finished', pre: 'game {t}', in: 'playing now' },
    search: 'Search player…', allTeams: 'All teams', change: 'Prediction', chAll: 'All', chUp: 'Will rise', chDown: 'Will fall', chNone: 'No change',
    played: 'Only players who played', roleAll: 'All roles', roleNone: 'No role',
    player: 'Player', team: 'Team', gp: 'Games', avg: 'This season (P/R/A/S/B)', offense: 'Offense', defense: 'Defense', rank: 'Rank', value: 'Value', predicted: 'Predicted change', rating: 'Rating', roles: 'Role',
    gpHint: 'player played {p} games ({u} at the update) · team {t} games · a player with 5 games who plays in the window is updated', minutes: '{min} min · {games} games', noStats: 'no game this season', missing: 'not on ESPN box scores · counted as 0', page: 'Page', of: '/',
    sumUp: '{n} will rise', sumDown: '{n} will fall',
    cmpEmpty: 'No comparison yet. When the game makes its next value update, the prediction and the actual change are shown here side by side. (The 2026-10-29 update replayed with the new rule: error ±10 TK, direction 92%.)',
    cmpN: 'Comparisons', cmpMae: 'Average error', cmpDir: 'Direction right', cmpExact: 'Exact',
    updates: 'Game updates', updAt: 'Time', updChanged: 'Players changed', updMae: 'Error', updDir: 'Direction right', updWindow: 'Average type',
    win: { season: 'season average', last5: 'last 5 games' },
    when: 'Date', before: 'Value before', pred: 'Predicted', actual: 'Actual', diff: 'Difference', tk: '{v} TK'
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const signed = v => (v > 0 ? `+${v}` : `${v}`);
const tone = v => (v > 0 ? 'good-text' : v < 0 ? 'bad-text' : 'muted-text');
const fmtDate = s => (s ? new Date(s).toLocaleString() : '—');

function Arrow({ from, to, higherIsBetter = true }) {
  if (from == null) return '—';
  if (to == null || to === from) return <span>{from}</span>;
  const good = higherIsBetter ? to > from : to < from;
  return <span>{from} <span className={good ? 'good-text' : 'bad-text'}>→ {to}</span></span>;
}

export default function ValuePredictPage({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const vp = state.valuePredict || {};
  const roles = state.cards?.roles || [];
  const base = useMemo(() => new Map((state.players?.players || []).map(p => [p.id, p])), [state.players]);
  const [tab, setTab] = useState('pred');
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [ch, setCh] = useState('');
  const [role, setRole] = useState('');
  const [played, setPlayed] = useState(false);

  const [editing, setEditing] = useState(null);
  const rows = useMemo(() => (vp.rows || []).map(r => ({ ...r, roleIds: base.get(r.id)?.roleIds || [] })), [vp.rows, base]);
  const teams = useMemo(() => [...new Set(rows.map(r => r.team).filter(Boolean))].sort(), [rows]);
  const shown = useMemo(() => rows.filter(r => {
    if (q.trim() && !r.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (team && r.team !== team) return false;
    if (ch === 'up' && !(r.change > 0)) return false;
    if (ch === 'down' && !(r.change < 0)) return false;
    if (ch === 'none' && r.change) return false;
    if (played && !(r.gp > 0)) return false;
    if (role === 'none' && r.roleIds.length) return false;
    if (role && role !== 'none' && !r.roleIds.includes(role)) return false;
    return true;
  }).sort((a, b) => (a.ranking || 9999) - (b.ranking || 9999)), [rows, q, team, ch, role, played]);
  // one page: the table sorts all players (user 2026-10-30)
  const visible = shown;
  const refresh = async () => { try { await api.valuePredict.refresh(); } catch (e) { toast(e.message, 'error'); } };
  const toggleRole = async (r, roleId) => { const next = r.roleIds.includes(roleId) ? r.roleIds.filter(v => v !== roleId) : [...r.roleIds, roleId]; try { await api.players.setRoles(r.id, next); } catch (e) { toast(e.message, 'error'); } };
  const acc = vp.accuracy;
  const up = rows.filter(r => r.change > 0).length;
  const down = rows.filter(r => r.change < 0).length;
  const set = fn => v => fn(v);

  return <div className="page vp-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar"><button className="btn primary" disabled={vp.busy} onClick={refresh}>{vp.busy ? x.refreshing : x.refresh}</button></div></div>
    {vp.error && <div className="panel pl-error">{vp.error}</div>}
    <div className="vp-stats">
      <div className="panel"><span>{x.lastGame}</span><b>{vp.lastGame ? `${(vp.lastGame.teams || []).join(' – ')}` : x.none}</b><small>{vp.lastGame ? fmtDate(vp.lastGame.date) : ''}</small></div>
      <div className="panel"><span>{x.games}</span><b className="num">{vp.games ?? 0}</b><small>{fmtDate(vp.checkedAt)}</small></div>
      <div className="panel"><span>{x.model}</span><b>{vp.model?.caps ? fill(x.modelText, { s: vp.model.caps['S+'], a: vp.model.caps.A, b: vp.model.caps.B, d: vp.model.caps['D-'] }) : x.none}</b><small>{vp.model ? (vp.model.learnedFormula ? x.learned : x.base) : ''}</small></div>
      <div className="panel"><span>{x.predictedAt}</span><b><span className="good-text">{fill(x.sumUp, { n: up })}</span> · <span className="bad-text">{fill(x.sumDown, { n: down })}</span></b><small>{vp.nextUpdateAt ? fill(x.nextUpdate, { t: fmtDate(vp.nextUpdateAt), n: Object.keys(vp.window?.teams || {}).length }) : fmtDate(vp.predictedAt)} · {vp.rule === 'team' ? x.ruleTeam : x.rulePlayer}</small></div>
      <div className="panel"><span>{x.accuracy}</span><b>{acc ? `${fill(x.tk, { v: `±${acc.mae}` })} · ${acc.direction ?? '—'}%` : x.none}</b><small>{acc ? `${acc.n} ${x.cmpN.toLowerCase()}` : ''}</small></div>
    </div>
    <div className="dp-tabs">{Object.keys(x.tabs).map(id => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{x.tabs[id]}</button>)}</div>

    {tab === 'pred' && <>
      <div className="panel vp-note">{x.note}</div>
      <div className="panel pg-bar vp-filters">
        <input placeholder={x.search} value={q} onChange={e => set(setQ)(e.target.value)} />
        <select value={team} onChange={e => set(setTeam)(e.target.value)}><option value="">{x.allTeams}</option>{teams.map(tm => <option key={tm} value={tm}>{tm}</option>)}</select>
        <select value={ch} onChange={e => set(setCh)(e.target.value)}><option value="">{x.change}: {x.chAll}</option><option value="up">{x.chUp}</option><option value="down">{x.chDown}</option><option value="none">{x.chNone}</option></select>
        <select value={role} onChange={e => set(setRole)(e.target.value)}><option value="">{x.roleAll}</option><option value="none">{x.roleNone}</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <label className="vp-check"><input type="checkbox" checked={played} onChange={e => set(setPlayed)(e.target.checked)} />{x.played}</label>
        <span className="sp" /><span className="muted">{shown.length}</span>
      </div>
      <div className="panel table-panel vp-table"><SortTable><thead><tr><th>{x.rank}</th><th>{x.player}</th><th>{x.team}</th><th>{x.gp}</th><th>{x.avg}</th><th>{x.offense}</th><th>{x.defense}</th><th>{x.value}</th><th>{x.predicted}</th><th>{x.rating}</th><th>{x.roles}</th></tr></thead>
        <tbody>{visible.map(r => <tr key={r.id}>
          <td className="num"><Arrow from={r.ranking} to={r.predRank} higherIsBetter={false} /></td>
          <td><b>{r.name}</b><InjuryMark name={r.name} /><small className="cell-sub">{r.position}</small></td>
          <td>{r.team || '—'}</td>
          <td className="num" title={fill(x.gpHint, { t: r.teamGames, p: r.gp ?? 0, u: r.gpAtUpdate ?? r.gp ?? 0 })}><span className={r.eligible ? 'good-text' : ''}>{Math.min(r.gpAtUpdate ?? r.gp ?? 0, 5)}/5</span><small className="cell-sub">{r.season ? fill(x.minutes, { min: r.season.min, games: r.season.gp }) : x.noStats}</small>{r.upcoming && <small className={`vp-game ${r.upcoming.state}`}>{fill(x.game[r.upcoming.state] || x.game.pre, { t: new Date(r.upcoming.date).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}</small>}</td>
          <td className="num">{r.season ? `${r.season.pts} / ${r.season.reb} / ${r.season.ast} / ${r.season.stl} / ${r.season.blk}` : '—'}</td>
          <td className="num"><Arrow from={r.offense} to={r.predOffense} />{r.atFive && <small className="cell-sub vp-five">{fill(x.atFive, { o: r.atFive.offense, d: r.atFive.defense })}</small>}</td>
          <td className="num"><Arrow from={r.defense} to={r.predDefense} /></td>
          <td className="num">{r.value}</td>
          <td className={`num ${tone(r.change)}`}><b>{r.change ? signed(r.change) : '0'}</b>{r.change ? <small className="cell-sub">→ {r.predValue}</small> : null}</td>
          <td><span className="vp-rating"><RatingBadge grade={r.rating} mini />{r.predRating && r.predRating !== r.rating && <><span className={tone(r.change)}>→</span><RatingBadge grade={r.predRating} mini /></>}</span></td>
          <td className="pl-roles" onClick={() => setEditing(editing === r.id ? null : r.id)}>
            {r.roleIds.map(id => roles.find(rl => rl.id === id)).filter(Boolean).map(rl => <span key={rl.id} className="role-badge" style={roleColors(rl.color)}>{rl.name}</span>)}
            {!r.roleIds.length && <span className="muted-text">+</span>}
            {editing === r.id && <div className="role-chips pl-role-edit" onClick={e => e.stopPropagation()}>{roles.map(rl => { const on = r.roleIds.includes(rl.id); return <button key={rl.id} className={on ? 'on' : ''} style={on ? { background: rl.color, borderColor: rl.color, color: '#fff' } : undefined} onClick={() => toggleRole(r, rl.id)}>{rl.name}</button>; })}</div>}
          </td>
        </tr>)}</tbody></SortTable>
      </div>
    </>}

    {tab === 'compare' && <>
      {!(vp.comparisons || []).length ? <div className="panel empty">{x.cmpEmpty}</div> : <>
        <div className="vp-stats">
          <div className="panel"><span>{x.cmpN}</span><b className="num">{acc?.n ?? 0}</b></div>
          <div className="panel"><span>{x.cmpMae}</span><b className="num">{acc ? fill(x.tk, { v: `±${acc.mae}` }) : '—'}</b></div>
          <div className="panel"><span>{x.cmpDir}</span><b className="num">{acc?.direction ?? '—'}%</b></div>
          <div className="panel"><span>{x.cmpExact}</span><b className="num">{acc?.exact ?? '—'}%</b></div>
        </div>
        {(vp.updates || []).length > 0 && <div className="panel table-panel"><div className="tk-sub vp-sub">{x.updates}</div><SortTable><thead><tr><th>{x.updAt}</th><th>{x.updChanged}</th><th>{x.updMae}</th><th>{x.updDir}</th><th>{x.updWindow}</th></tr></thead>
          <tbody>{vp.updates.map(u => <tr key={u.at}><td>{fmtDate(u.at)}</td><td className="num">{u.changed}</td><td className="num">{u.mae == null ? '—' : fill(x.tk, { v: `±${u.mae}` })}</td><td className="num">{u.direction == null ? '—' : `${u.direction}%`}</td><td>{x.win[u.window] || u.window}</td></tr>)}</tbody></SortTable></div>}
        <div className="panel table-panel"><SortTable><thead><tr><th>{x.when}</th><th>{x.player}</th><th>{x.team}</th><th>{x.before}</th><th>{x.pred}</th><th>{x.actual}</th><th>{x.diff}</th></tr></thead>
          <tbody>{vp.comparisons.map((c, i) => { const diff = c.predicted == null ? null : c.actual - c.predicted; return <tr key={`${c.id}-${c.at}-${i}`}>
            <td>{fmtDate(c.at)}</td><td><b>{c.name}</b><InjuryMark name={c.name} /></td><td>{c.team || '—'}</td><td className="num">{c.before}</td>
            <td className={`num ${tone(c.predicted ?? 0)}`}>{c.predicted == null ? '—' : signed(c.predicted)}</td>
            <td className={`num ${tone(c.actual)}`}><b>{signed(c.actual)}</b><small className="cell-sub">→ {c.after}</small></td>
            <td className={`num ${diff === 0 ? 'good-text' : diff == null ? '' : 'bad-text'}`}>{diff == null ? '—' : diff === 0 ? '✓' : signed(diff)}</td>
          </tr>; })}</tbody></SortTable></div>
      </>}
    </>}
  </div>;
}
