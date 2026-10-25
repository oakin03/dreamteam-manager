import { useEffect, useMemo, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const LEVELS = [5, 4, 3, 2, 1];
const TEXT = {
  tr: {
    intro: 'Kartlar oyuncu oyuncu aktif edilir (oyunun "hepsini aktif et" düğmesi kullanılmaz). Sadece seçtiğin yıldız seviyeleri, en yüksekten başlayarak: önce 5★, sonra 4★, 3★…',
    levels: 'Aktif edilecek yıldızlar', start: 'Aktive et ({n})', stop: 'Durdur', rescan: 'Kartları tara',
    player: 'Oyuncu', team: 'Takım', now: 'Şu an', target: 'Olacak', cards: 'Eldeki kartlar', status: 'Durum',
    will: 'Aktif edilecek', notChosen: 'Seçili değil · en yüksek kartı {n}★', done: 'Aktif edildi', current: 'Şimdi bu', none: 'Aktif edilecek kart yok. Önce Takımlar sekmesinden kartları tara.',
    summary: '{n}★: {c}', progress: '{d}/{t} aktif edildi', skipped: '{n} oyuncu atlandı (en yüksek kartı seçili değil)', scanning: 'Kartlar taranıyor…',
    last: 'Son çalıştırma', how: ['Oyun bir oyuncuyu her zaman elindeki en yüksek kartla aktif eder. Bu yüzden en yüksek kartı seçili olmayan bir yıldızdaysa o oyuncu hiç aktif edilmez.', 'Başlamadan önce kartlar yeniden taranır; bitince Takımlar sekmesi güncellenir.', 'Her aktivasyondan sonra oyunun verdiği yeni yıldız kontrol edilir; beklenenden farklıysa iş durur ve Aktivite\'ye yazılır.'],
    howTitle: 'Nasıl çalışır?'
  },
  en: {
    intro: 'Cards are activated player by player (the game\'s "activate all" is never used). Only the star levels you choose, the highest first: 5★, then 4★, 3★…',
    levels: 'Star levels to activate', start: 'Activate ({n})', stop: 'Stop', rescan: 'Scan cards',
    player: 'Player', team: 'Team', now: 'Now', target: 'Becomes', cards: 'Cards owned', status: 'Status',
    will: 'Will be activated', notChosen: 'Not chosen · highest card {n}★', done: 'Activated', current: 'Now', none: 'Nothing to activate. Scan the cards on the Teams tab first.',
    summary: '{n}★: {c}', progress: '{d}/{t} activated', skipped: '{n} player(s) skipped (their highest card is not chosen)', scanning: 'Scanning the cards…',
    last: 'Last run', how: ['The game always activates a player with its highest card, so a player whose highest card is an unchosen level is not activated at all.', 'The cards are scanned again before starting; the Teams tab is updated at the end.', 'After every activation the new star from the game is checked; if it is not the expected one the job stops and says so in Activity.'],
    howTitle: 'How does it work?'
  },
  get fil() { return filOf(this.en); }
};

function rowsOf(players, levels) {
  const chosen = new Set(levels);
  const out = [];
  for (const p of players || []) {
    if (p.noTeam || p.x || p.active === false) continue;
    const stars = Number(p.stars) || 0;
    if (stars >= 5) continue;
    const cards = p.cards || p.inventoryLevels || {};
    const above = Object.entries(cards).filter(([lv, q]) => Number(lv) > stars && Number(q) > 0).map(([lv]) => Number(lv));
    if (!above.length) continue;
    const target = Math.max(...above);
    out.push({ playerId: p.playerId, name: p.name, team: p.team, x: p.x, stars, target, chosen: chosen.has(target), cards });
  }
  return out.sort((a, b) => b.target - a.target || String(a.team).localeCompare(String(b.team)) || String(a.name).localeCompare(String(b.name)));
}

export default function ActivateTab({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const ac = state.activate || {};
  const running = Boolean(ac.running);
  const [levels, setLevelsRaw] = useState(() => ac.levels || [5, 4, 3, 2]);
  useEffect(() => { if (!running && ac.levels) setLevelsRaw(ac.levels); }, [JSON.stringify(ac.levels)]);
  const setLevels = next => { setLevelsRaw(next); api.activate?.levels(next).catch(() => {}); };
  const rows = useMemo(() => rowsOf(state.cards?.players, levels), [state.cards?.players, levels]);
  const todo = rows.filter(r => r.chosen);
  const doneIds = new Set((ac.run?.done || []).map(d => d.playerId));
  const counts = LEVELS.map(l => [l, todo.filter(r => r.target === l).length]).filter(([, c]) => c);
  const run = ac.run;
  const start = async () => { try { await api.activate.start({ levels }); } catch (e) { toast(e.message, 'error'); } };
  return <div className="ac-tab">
    <div className="panel ac-head">
      <p>{x.intro}</p>
      <div className="ac-levels"><span>{x.levels}</span>{LEVELS.map(l => <label key={l} className={`ac-level ${levels.includes(l) ? 'on' : ''}`}><input type="checkbox" disabled={running} checked={levels.includes(l)} onChange={() => setLevels(levels.includes(l) ? levels.filter(v => v !== l) : LEVELS.filter(v => v === l || levels.includes(v)))} />{l}★</label>)}</div>
      <div className="ac-actions">
        {counts.map(([l, c]) => <span key={l} className="ac-chip">{fill(x.summary, { n: l, c })}</span>)}
        <span className="sp" />
        <button className="btn ghost" disabled={running || state.cards?.scanRuntime?.status === 'running'} onClick={() => api.cards.refresh().catch(e => toast(e.message, 'error'))}>{x.rescan}</button>
        {running ? <button className="btn danger-soft" onClick={() => api.activate.stop().catch(e => toast(e.message, 'error'))}>{x.stop}</button>
          : <button className="btn primary" disabled={!todo.length || !levels.length} onClick={start}>{fill(x.start, { n: todo.length })}</button>}
      </div>
      {run && <div className="ac-progress">{run.step === 'scan' ? x.scanning : fill(x.progress, { d: run.done?.length || 0, t: run.total ?? todo.length })}{run.skipped ? ` · ${fill(x.skipped, { n: run.skipped })}` : ''}{run.current && run.status === 'running' ? ` · ${x.current}: ${run.current.name} ${run.current.stars}★ → ${run.current.target}★` : ''}{run.message ? ` · ${run.message}` : ''}</div>}
    </div>
    {!rows.length ? <div className="panel empty big"><b>{x.none}</b></div> : <div className="panel table-panel"><SortTable><thead><tr><th>{x.player}</th><th>{x.team}</th><th>{x.now}</th><th>{x.target}</th><th>{x.cards}</th><th>{x.status}</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.playerId} className={run?.current?.playerId === r.playerId && running ? 'dp-live' : ''}>
        <td><b>{r.name}</b></td>
        <td>{r.team}</td>
        <td className="num">{r.stars}★</td>
        <td className="num"><b>{r.target}★</b></td>
        <td className="num">{Object.entries(r.cards).filter(([, q]) => Number(q) > 0).sort(([a], [b]) => b - a).map(([lv, q]) => `${lv}★×${q}`).join('  ')}</td>
        <td className={doneIds.has(r.playerId) ? 'good-text' : r.chosen ? '' : 'muted'}>{doneIds.has(r.playerId) ? `✓ ${x.done}` : r.chosen ? x.will : fill(x.notChosen, { n: r.target })}</td>
      </tr>)}</tbody></SortTable></div>}
    <details className="panel pvp-how"><summary>{x.howTitle}</summary><ul>{x.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </div>;
}
