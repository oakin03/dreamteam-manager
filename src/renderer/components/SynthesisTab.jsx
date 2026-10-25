import { useState } from 'react';
import SortTable from './SortTable';

const api = window.dreamteam;
const LEVELS = [1, 2, 3, 4];
const TEXT = {
  tr: {
    intro: 'Sentez, Kartlar sayfasında seçili ana hesabın My Player Cards kartlarıyla yapılır. X oyunculara dokunulmaz. Seviyeler sırayla (1★→2★, sonra 2★→3★…) denenir; yol üzerinde gelen ya da geri verilen kartlar da kullanılır. Bitince kartlar yeniden taranır.',
    levels: 'Denenecek seviyeler', team: 'Takımlı oyuncuları sentezle', teamHint: 'Aynı oyuncudan aynı seviyede en az 4 kart varsa 4\'erli birleştirir (9 kart → 2 sentez). 1★→2★ her zaman başarılı, 2★ ve üstü %75.',
    noTeam: 'Takımsız oyuncuları birleştir', noTeamHint: 'Her sentezde en çok kartı olan 4 farklı No Team oyuncudan birer kart kullanır (oyunun sırası: adet, sonra isim). Başarılıysa rastgele bir üst seviye kart gelir; 4 farklı oyuncu kalmayınca biter.',
    waiting: 'Oyun bekletiyor · {s} sn', stop: 'Durdur', running: 'Çalışıyor · {lv}★→{next}★', done: 'Tamamlandı', stopped: 'Durduruldu', error: 'Hata', live: 'Şu an', lastResult: 'Son işlem', used: 'Kullanılan 4 kart', got: 'Gelen kart', fail: 'Başarısız', returned: 'geri verildi', none: '—',
    history: 'Sentez geçmişi (bu çalıştırma)', obtained: 'Elde edilen kartlar', obtainedHint: 'Bu çalıştırmada gelen ve hâlâ sende olan kartlar; sonradan başka sentezde kullanılanlar listeden düşer.', noObtained: 'Henüz kart elde edilmedi.',
    summary: 'Özet (son çalıştırma)', account: 'Hesap', mode: 'Tür', modeTeam: 'Takımlı', modeNoTeam: 'Takımsız', summaryHint: 'yeşil = başarılı, kırmızı = başarısız', random: 'rastgele'
  },
  en: {
    intro: 'Synthesis uses the My Player Cards of the main account selected on the Cards page. X players are never touched. Levels run in order (1★→2★, then 2★→3★…); cards made or given back on the way are used too. The cards are scanned again at the end.',
    levels: 'Levels to try', team: 'Synthesize team players', teamHint: 'Combines 4 cards of the same player at the same level (9 cards → 2 syntheses). 1★→2★ always works, 2★ and up 75%.',
    noTeam: 'Combine No Team players', noTeamHint: 'Each synthesis uses one card each of the 4 different No Team players with the most cards (the game\'s order: quantity, then name). Success gives a random next-level card; it ends when fewer than 4 different players are left.',
    waiting: 'The game asks to wait · {s} s', stop: 'Stop', running: 'Running · {lv}★→{next}★', done: 'Completed', stopped: 'Stopped', error: 'Error', live: 'Now', lastResult: 'Last synthesis', used: 'The 4 cards used', got: 'Card received', fail: 'Failed', returned: 'given back', none: '—',
    history: 'Synthesis history (this run)', obtained: 'Cards obtained', obtainedHint: 'Cards this run gave you that you still own; cards used again later drop off the list.', noObtained: 'No cards obtained yet.',
    summary: 'Summary (last run)', account: 'Account', mode: 'Type', modeTeam: 'Team', modeNoTeam: 'No Team', summaryHint: 'green = success, red = fail', random: 'random'
  }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const stars = n => `${n}★`;

export default function SynthesisTab({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const sy = state.synthesis || {};
  const run = sy.run;
  const running = Boolean(sy.running);
  const [levels, setLevels] = useState(() => new Set(LEVELS));
  const toggle = l => setLevels(s => { const n = new Set(s); n.has(l) ? n.delete(l) : n.add(l); return n; });
  const start = async mode => { try { await api.synthesis.start({ mode, levels: [...levels].sort() }); } catch (e) { toast(e.message, 'error'); } };
  const cur = run?.current;
  const statusText = !run ? null : run.status === 'running' ? fill(x.running, { lv: run.level ?? 1, next: (run.level ?? 1) + 1 }) : x[run.status] || run.status;
  const tone = !run ? 'muted' : run.status === 'running' ? 'info' : run.status === 'done' ? 'ok' : run.status === 'error' ? 'bad' : 'muted';
  const summary = Object.entries(sy.summary || {});

  return <div className="synth">
    <div className="panel synth-intro">{x.intro}</div>
    <div className="synth-controls">
      <div className="panel synth-levels"><b>{x.levels}</b><div className="synth-level-list">{LEVELS.map(l => <label key={l} className={levels.has(l) ? 'on' : ''}><input type="checkbox" disabled={running} checked={levels.has(l)} onChange={() => toggle(l)} /><span>{stars(l)} → {stars(l + 1)}</span></label>)}</div></div>
      <div className="panel synth-action"><button className="btn primary" disabled={running || !levels.size} onClick={() => start('team')}>{x.team}</button><small>{x.teamHint}</small></div>
      <div className="panel synth-action"><button className="btn accent" disabled={running || !levels.size} onClick={() => start('noTeam')}>{x.noTeam}</button><small>{x.noTeamHint}</small></div>
    </div>

    {run && <div className={`panel synth-live ${tone}`}>
      <div className="synth-live-head"><span className={`pill ${tone}`}><i />{statusText}</span><b>{run.mode === 'team' ? x.modeTeam : x.modeNoTeam}</b><span className="muted-text">{run.accountName}</span>
        <span className="synth-counts">{LEVELS.map(l => <em key={l}>{stars(l)}→{stars(l + 1)} <b className="green-text">{run.counts[l].ok}</b>/<b className="bad-text">{run.counts[l].fail}</b></em>)}</span>
        {run.waitUntil && <span className="pill warn"><i />{fill(x.waiting, { s: Math.max(0, Math.ceil((Date.parse(run.waitUntil) - Date.now()) / 1000)) })}</span>}{running && <button className="btn danger-soft small" onClick={() => api.synthesis.stop()}>{x.stop}</button>}</div>
      {cur && <div className="synth-flow">
        <div className="synth-used"><small>{running && !cur.result ? x.live : x.lastResult} · {x.used}</small><div>{cur.used.map((n, i) => <span key={i} className="synth-card">{n}<i>{stars(cur.level)}</i></span>)}</div></div>
        <div className={`synth-arrow ${cur.result ? (cur.ok ? 'ok' : 'bad') : 'wait'}`}>{cur.result ? (cur.ok ? '➜' : '✕') : '…'}</div>
        <div className="synth-got"><small>{cur.ok === false ? x.fail : x.got}</small>{cur.result ? <span className={`synth-card big ${cur.ok ? 'ok' : 'bad'}`}>{cur.result.name}<i>{stars(cur.result.level)}</i>{cur.result.returned && <u>{x.returned}</u>}</span> : <span className="synth-card wait">…</span>}</div>
      </div>}
    </div>}

    {run && <div className="synth-grid">
      <section><h3 className="section-title">{x.obtained} <small>{x.obtainedHint}</small></h3>
        <div className="panel synth-obtained">{run.obtained.length ? run.obtained.map(o => <span key={o.playerId + o.level} className="synth-card ok">{o.name}<i>{stars(o.level)}</i>{o.count > 1 && <b>×{o.count}</b>}</span>) : <p className="muted-text">{x.noObtained}</p>}</div></section>
      <section><h3 className="section-title">{x.history}</h3>
        <div className="panel table-panel synth-history"><SortTable><tbody>{run.history.map((h, i) => <tr key={i} className={h.ok ? '' : 'synth-fail-row'}>
          <td className="muted-text">{new Date(h.at).toLocaleTimeString()}</td><td><b>{stars(h.level)}→{stars(h.level + 1)}</b></td><td className="synth-used-cell">{h.used.join(', ')}</td>
          <td>{h.ok ? <span className="green-text">➜ <b>{h.result?.name}</b> {stars(h.result?.level)}{h.result?.random ? <small className="muted-text"> · {x.random}</small> : null}</span> : <span className="bad-text">✕ {x.fail}{h.result ? ` · ${h.result.name} ${x.returned}` : ''}</span>}</td>
        </tr>)}</tbody></SortTable></div></section>
    </div>}

    <h3 className="section-title">{x.summary} <small>{x.summaryHint}</small></h3>
    <div className="panel table-panel"><SortTable><thead><tr><th>{x.account}</th><th>{x.mode}</th>{LEVELS.map(l => <th key={l}>{stars(l)} → {stars(l + 1)}</th>)}</tr></thead>
      <tbody>{summary.flatMap(([id, s]) => ['team', 'noTeam'].filter(m => s[m]).map(m => <tr key={id + m}><td><b>{s.name}</b></td><td>{m === 'team' ? x.modeTeam : x.modeNoTeam} <small className="muted-text">{new Date(s[m].at).toLocaleString()}</small></td>
        {LEVELS.map(l => <td key={l} className="synth-sum"><b className="green-text">{s[m].counts[l].ok}</b>/<b className="bad-text">{s[m].counts[l].fail}</b></td>)}</tr>))}
        {!summary.length && <tr><td colSpan={6} className="muted-text">{x.none}</td></tr>}</tbody></SortTable></div>
  </div>;
}
