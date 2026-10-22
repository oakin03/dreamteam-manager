import { useState } from 'react';

const api = window.dreamteam;
const TEXT = {
  tr: {
    title: 'Kule', subtitle: 'Challenger, Threat ve Rival kulelerini seçili hesaplarda kat kat oynar · her pazar 19:10\'da sıfırlanır',
    accounts: 'Hesaplar', selectAll: 'Tümünü seç', clear: 'Seçimi temizle', start: 'Kuleyi Başlat ({n})', stopAll: 'Tümünü durdur', stopSel: 'Seçilileri durdur ({n})',
    live: 'Canlı durum', last: 'Son çalıştırma', account: 'Hesap', status: 'Durum', now: 'Şu an', result: 'Sonuç', none: 'Henüz kule çalıştırılmadı.',
    st: { queued: 'Sırada', login: 'Giriş yapılıyor', waitingMatch: 'Maçın bitmesi bekleniyor', starting: 'Maç başlatılıyor', playing: 'Maç oynanıyor', done: 'Tamamlandı', finished: 'Bitti', stopped: 'Durduruldu', error: 'Hata', salaryCap: 'Maaş sınırı aşıldı' },
    playing: '{tower} · {floor}. kat', floor: '{floor}/{max}', wl: '{w} G · {l} M',
    reason: { completed: 'Tamamlandı', losses: '3 kez üst üste kaybetti', user: 'Durduruldu', salary: 'Maaş sınırı', error: 'Hata' },
    how: 'Nasıl çalışır?',
    howLines: [
      'Önce her kulenin 1. katı, sonra 2. katları… şeklinde, en düşük kattaki kule önce oynanır.',
      'Bir kulede aynı katta üst üste 3 kez kaybedilirse o kule bırakılır; diğer kuleler devam eder. Üç kule de bitince ya da bırakılınca hesap durur.',
      'Başlatınca seçili hesaplarda çalışan Auto Play durdurulur, kule bitince yeniden başlatılır. Hesap zaten maçtaysa önce o maçın bitmesi beklenir.',
      'Maaş sınırı aşılmışsa o hesap durdurulur ve uyarı gösterilir. Hesaplar aynı anda oynar.'
    ]
  },
  en: {
    title: 'Tower', subtitle: 'Plays the Challenger, Threat and Rival towers floor by floor on the selected accounts · resets every Sunday 19:10 TR',
    accounts: 'Accounts', selectAll: 'Select all', clear: 'Clear selection', start: 'Start Tower ({n})', stopAll: 'Stop all', stopSel: 'Stop selected ({n})',
    live: 'Live status', last: 'Last run', account: 'Account', status: 'Status', now: 'Now', result: 'Result', none: 'Tower has not run yet.',
    st: { queued: 'Queued', login: 'Signing in', waitingMatch: 'Waiting for a match to end', starting: 'Starting a match', playing: 'Playing', done: 'Completed', finished: 'Finished', stopped: 'Stopped', error: 'Error', salaryCap: 'Over the salary cap' },
    playing: '{tower} · floor {floor}', floor: '{floor}/{max}', wl: '{w} W · {l} L',
    reason: { completed: 'Completed', losses: 'Lost 3 times in a row', user: 'Stopped', salary: 'Salary cap', error: 'Error' },
    how: 'How does it work?',
    howLines: [
      'Floor 1 of every tower first, then the 2nd floors…: the tower on the lowest floor is played first.',
      'After 3 losses in a row on the same floor a tower is given up; the others go on. When all three are done or given up, the account stops.',
      'On start, Auto Play on the selected accounts is stopped and started again when Tower ends. An account already in a match waits for it first.',
      'Over the salary cap: that account stops with a warning. Accounts play at the same time.'
    ]
  }
};
const TONE = { queued: 'muted', login: 'muted', waitingMatch: 'warn', starting: 'warn', playing: 'info', done: 'ok', finished: 'ok', stopped: 'muted', error: 'bad', salaryCap: 'bad' };
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const TOWERS = ['Challenger', 'Threat', 'Rival'];

export default function TowerPage({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const tw = state.tower || {};
  const accounts = state.accounts || [];
  const [ids, setIds] = useState(() => (state.settings?.towerAccountIds || accounts.map(a => a.id)).filter(id => accounts.some(a => a.id === id)));
  const [stopPick, setStopPick] = useState(() => new Set());
  const running = Boolean(tw.running);
  const live = tw.run;
  const save = next => { setIds(next); api.settings.update({ towerAccountIds: next }).catch(() => {}); };
  const toggle = id => save(ids.includes(id) ? ids.filter(v => v !== id) : [...ids, id]);
  const act = async fn => { try { await fn(); } catch (e) { toast(e.message, 'error'); } };
  const rows = live ? Object.values(live.accounts || {}) : [];
  const activeIds = rows.filter(r => !['done', 'finished', 'stopped', 'error', 'salaryCap'].includes(r.status)).map(r => r.accountId);

  return <div className="page tower-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar">
        {running && <button className="btn ghost" disabled={!stopPick.size} onClick={() => act(async () => { await api.tower.stop([...stopPick]); setStopPick(new Set()); })}>{fill(x.stopSel, { n: stopPick.size })}</button>}
        {running ? <button className="btn danger-soft" onClick={() => act(() => api.tower.stop())}>{x.stopAll}</button>
          : <button className="btn primary" disabled={!ids.length} onClick={() => act(() => api.tower.start(ids))}>{fill(x.start, { n: ids.length })}</button>}
      </div></div>

    {!running && <div className="panel pvp-accounts tw-accounts">
      <div className="pvp-accounts-head"><b>{x.accounts}</b><button className="chip" onClick={() => save(ids.length === accounts.length ? [] : accounts.map(a => a.id))}>{ids.length === accounts.length ? x.clear : x.selectAll}</button></div>
      <div className="pvp-picks">{accounts.map(a => <button key={a.id} type="button" className={ids.includes(a.id) ? 'selected' : ''} onClick={() => toggle(a.id)}><span>{a.name}</span></button>)}</div>
    </div>}

    {live && <><h3 className="section-title">{running ? x.live : x.last}</h3>
      <div className="panel table-panel"><table><thead><tr>{running && <th></th>}<th>{x.account}</th><th>{x.status}</th><th>{x.now}</th>{TOWERS.map(n => <th key={n}>{n}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.accountId} className={`tw-row ${r.status}`}>
          {running && <td>{activeIds.includes(r.accountId) && <input type="checkbox" checked={stopPick.has(r.accountId)} onChange={() => setStopPick(s => { const n = new Set(s); n.has(r.accountId) ? n.delete(r.accountId) : n.add(r.accountId); return n; })} />}</td>}
          <td><b>{r.name}</b>{r.wins + r.losses > 0 && <small className="cell-sub">{fill(x.wl, { w: r.wins, l: r.losses })}</small>}</td>
          <td><span className={`pill ${TONE[r.status] || 'muted'}`}><i />{x.st[r.status] || r.status}</span></td>
          <td>{r.status === 'playing' || r.status === 'starting' ? <b className="tw-now">{fill(x.playing, { tower: r.tower, floor: r.floor })}</b> : r.status === 'error' || r.status === 'salaryCap' ? <span className="bad-text">{r.message}</span> : <span className="muted-text">—</span>}</td>
          {TOWERS.map(n => { const tt = (r.towers || []).find(v => v.label.toLowerCase() === n.toLowerCase()); return <td key={n}><TowerCell tt={tt} x={x} active={r.tower === n && (r.status === 'playing' || r.status === 'starting')} /></td>; })}
        </tr>)}</tbody></table></div></>}

    <LastRun report={!running ? tw.lastReport : null} x={x} />
    {!live && !tw.lastReport && <p className="muted-text">{x.none}</p>}

    <details className="panel pvp-how"><summary>{x.how}</summary><ul>{x.howLines.map(l => <li key={l}>{l}</li>)}</ul></details>
  </div>;
}

function TowerCell({ tt, x, active }) {
  if (!tt) return <span className="muted-text">—</span>;
  const pct = Math.min(100, Math.round(((tt.floor - (tt.state === 'done' ? 0 : 1)) / tt.maxFloor) * 100));
  return <div className={`tw-cell st-${tt.state} ${active ? "current" : ""}`}>
    <div className="tw-cell-top"><b>{fill(x.floor, { floor: tt.state === 'done' ? tt.maxFloor : tt.floor, max: tt.maxFloor })}</b><small>{fill(x.wl, { w: tt.wins, l: tt.losses })}</small></div>
    <div className="tw-bar"><i style={{ width: `${pct}%` }} /></div>
    {tt.reason && <small className={`tw-reason ${tt.reason}`}>{x.reason[tt.reason] || tt.reason}</small>}
    {!tt.reason && tt.streak > 0 && <small className="tw-reason losses">{tt.streak}/3</small>}
  </div>;
}

// Wins per account per tower in the last run.
function LastRun({ report, x }) {
  if (!report?.rows?.length) return null;
  return <><h3 className="section-title">{x.last} <small>{new Date(report.startedAt).toLocaleString()} → {new Date(report.finishedAt).toLocaleTimeString()}</small></h3>
    <div className="panel table-panel"><table><thead><tr><th>{x.account}</th><th>{x.result}</th>{TOWERS.map(n => <th key={n}>{n}</th>)}</tr></thead>
      <tbody>{report.rows.map(r => <tr key={r.accountId}><td><b>{r.name}</b></td><td><span className={`pill ${TONE[r.status] || 'muted'}`}><i />{x.st[r.status] || r.status}</span></td>
        {TOWERS.map(n => { const tt = (r.towers || []).find(v => v.label.toLowerCase() === n.toLowerCase()); return <td key={n}>{tt ? <span className="tw-sum"><b className="green-text">{tt.wins}</b> / <b className="bad-text">{tt.losses}</b> <small className="muted-text">· {tt.startFloor ?? '?'} → {tt.state === 'done' ? tt.maxFloor : tt.floor}{tt.reason ? ` · ${x.reason[tt.reason] || tt.reason}` : ''}</small></span> : '—'}</td>; })}
      </tr>)}</tbody></table></div></>;
}
