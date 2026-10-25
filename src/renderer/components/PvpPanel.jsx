import SortTable from './SortTable';
const api = window.dreamteam;
const TEXT = {
  tr: {
    title: 'PVP Arena', live: 'Çalışıyor', last: 'Son PVP sonucu', stop: 'Durdur', account: 'Hesap', status: 'Durum', played: 'Oynanan maç', left: 'Kalan hak', note: 'Not',
    schedule: 'Zamanlanmış görev', manual: 'Elle başlatıldı', finished: '{done}/{total} hesap tamamladı · toplam {played} maç',
    st: { waitingGame: 'Oyun bekleniyor', queued: 'Sırada', login: 'Giriş yapılıyor', finding: 'Maç aranıyor', playing: 'Maçta', done: 'Tamamlandı', inactive: 'Yarıda kesildi · PVP aktif değil', error: 'Yarıda kesildi · hata', stopped: 'Durduruldu' },
    msg: { pvp: 'PVP maçı sürüyor', otherMatch: 'Başka bir maç bitene kadar bekliyor' }
  },
  en: {
    title: 'PVP Arena', live: 'Running', last: 'Last PVP result', stop: 'Stop', account: 'Account', status: 'Status', played: 'Matches played', left: 'Attempts left', note: 'Note',
    schedule: 'Scheduled task', manual: 'Started manually', finished: '{done}/{total} account(s) finished · {played} match(es) in total',
    st: { waitingGame: 'Waiting for the game', queued: 'Queued', login: 'Signing in', finding: 'Finding a match', playing: 'In a match', done: 'Completed', inactive: 'Interrupted · PVP not active', error: 'Interrupted · error', stopped: 'Stopped' },
    msg: { pvp: 'PVP match in progress', otherMatch: 'Waiting for another match to end' }
  }
};
const TONE = { waitingGame: 'warn', done: 'ok', playing: 'warn', finding: 'warn', login: 'muted', queued: 'muted', inactive: 'bad', error: 'bad', stopped: 'muted' };
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

// Live PVP progress while it runs, otherwise the result of the last run: which
// account played how many matches and which one was interrupted (and why).
export default function PvpPanel({ pvp, lang }) {
  const x = TEXT[lang] || TEXT.en;
  const live = pvp?.run;
  const rep = live || pvp?.lastReport;
  if (!rep) return null;
  const rows = live ? Object.values(live.accounts || {}) : rep.rows || [];
  const done = rows.filter(r => r.status === 'done').length;
  const played = rows.reduce((n, r) => n + (r.played || 0), 0);
  return <div className="panel pvp-panel">
    <div className="pvp-head">
      <b>{live ? x.title : x.last}</b>
      {live ? <span className="pill warn"><i />{x.live}</span> : <span className={`pill ${done === rows.length ? 'ok' : 'bad'}`}><i />{fill(x.finished, { done, total: rows.length, played })}</span>}
      <span className="muted-text">{new Date(rep.startedAt).toLocaleString()}{rep.finishedAt ? ` → ${new Date(rep.finishedAt).toLocaleTimeString()}` : ''} · {rep.source === 'schedule' ? x.schedule : x.manual}</span>
      {live && <button className="btn danger-soft small" onClick={() => api.pvp.stop()}>{x.stop}</button>}
    </div>
    <SortTable><thead><tr><th>{x.account}</th><th>{x.status}</th><th>{x.played}</th><th>{x.left}</th><th>{x.note}</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.accountId}>
        <td><b>{r.name}</b></td>
        <td><span className={`pill ${TONE[r.status] || 'muted'}`}><i />{x.st[r.status] || r.status}</span></td>
        <td><b>{r.played}</b>{r.attemptsStart != null && <span className="muted-text"> / {r.attemptsStart}</span>}</td>
        <td>{r.attemptsLeft ?? '—'}</td>
        <td className="muted-text">{r.status === 'error' ? r.reason : x.msg[r.message] || ''}</td>
      </tr>)}</tbody></SortTable>
  </div>;
}
