import AccountHealthPanel from './AccountHealthPanel';
import DailySummary from './DailySummary';
import { useEffect, useMemo, useState } from 'react';

const num = v => v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString();
const TR_OFFSET_MS = 3 * 3600 * 1000;
const trMinutes = ms => { const d = new Date(ms + TR_OFFSET_MS); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; };
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
const toMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const clock = sec => { const s = Math.max(0, Math.floor(sec)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

const TEXT = {
  tr: {
    title: 'Komuta Merkezi', main: 'Ana hesap', noMain: 'Ana hesap seçilmedi (Hesaplar sayfası)', level: 'Lv', tk: 'TK', apk: 'APK', tix: 'TIX',
    online: 'Oyun çevrimiçi', offline: 'Oyun kapalı · bekleniyor', autoplay: '{n} / {total} Auto Play', problems: '{n} hesapta sorun', reset: 'Gün dönümüne',
    kReward: 'Daily Reward bugün', kRewardSub: '/ {n} kademe', kPvp: 'PVP hakkı kaldı', kPvpSub: '/ {n}', kPvpNone: 'PVP sayfasında durumu yenile',
    kSocial: 'Sosyal', kSocialSub: 'istek + mesaj', kMail: '✉ {n} ödüllü posta', kTasks: 'Bekleyen görev ödülü', kTasksSub: '{done} / {total} hesapta görevler tamam',
    flow: 'Bugünün akışı (TR saati)', flowHint: 'zamanlanmış her şey ve oyunun sabit saatleri', now: 'ŞİMDİ',
    ev: { pvp: 'PVP', salary: 'Maaş güncellemesi', stop: 'Auto Play durur', resume: 'Yeniden başlar', tournament: 'Turnuva', tReg: 'Turnuva kaydı', reset: 'Gün dönümü', reset2: 'Haklar sıfırlanır' },
    accounts: 'Hesaplar', problemsFirst: 'sorunlular üstte', account: 'Hesap', status: 'Durum', reward: 'Daily Reward', pvp: 'PVP', salary: 'Maaş / tavan', live: 'Canlı aktivite', all: 'Tümü →',
    st: { idle: 'Durdu', running: 'Çalışıyor', preparing: 'Hazırlanıyor', starting: 'Başlıyor', stopping: 'Duruyor', error: 'Hata', stopped: 'Durdu' },
    issue: { overCap: 'Tavan aşıldı', nearCap: 'Tavana yakın', lowTk: 'TK düşük', rosterFull: 'Kadro dolu' },
    systems: 'Sistemler', idle: 'Boşta', running: 'Çalışıyor', paused: 'Duraklatıldı', error: 'Hata', done: 'Bitti',
    autoTrade: 'Auto Trade', autoTradeDone: 'Son çalıştırma: {bought} alındı · {converted} karta çevrildi',
    draft: 'Draft', draftLine: '{rooms} odada · {attempts} hesapta hak var', tournament: 'Turnuva', tournamentLine: '{joined} kayıt bu çalıştırmada',
    market: 'Pazar', marketLine: '{sold} satış toplanmayı bekliyor · {listed} ilan', trade: 'Trading Hall', tradeLine: '{count} ilan', equipment: 'Ekipman', equipmentLine: '{name} açık', equipmentIdle: 'Kapalı',
    players: 'Oyuncular', playersLine: '▲ {up} · ▼ {down} · Base {base}', playersNever: 'Liste henüz alınmadı', cards: 'Kartlar', cardsLine: '{players} oyuncu · {teams} takım', schedule: 'Zamanlayıcı', scheduleLine: 'Sıradaki: {name} · {at}', scheduleNone: 'Bekleyen görev yok',
    risers: 'Bugün en çok artan', fallers: 'Bugün en çok düşen', atBase: 'Base’e düşenler', more: '+{n} daha', noActivity: 'Henüz kayıt yok'
  },
  en: {
    title: 'Command Center', main: 'Main account', noMain: 'No main account (Accounts page)', level: 'Lv', tk: 'TK', apk: 'APK', tix: 'TIX',
    online: 'Game online', offline: 'Game down · waiting', autoplay: '{n} / {total} Auto Play', problems: '{n} account(s) with problems', reset: 'Day ends in',
    kReward: 'Daily Reward today', kRewardSub: '/ {n} tiers', kPvp: 'PVP attempts left', kPvpSub: '/ {n}', kPvpNone: 'Refresh the status on the PVP page',
    kSocial: 'Social', kSocialSub: 'requests + messages', kMail: '✉ {n} mail(s) with rewards', kTasks: 'Task rewards waiting', kTasksSub: 'tasks done on {done} / {total} accounts',
    flow: 'Today (TR time)', flowHint: 'everything scheduled and the game’s fixed times', now: 'NOW',
    ev: { pvp: 'PVP', salary: 'Salary update', stop: 'Auto Play stops', resume: 'Starts again', tournament: 'Tournament', tReg: 'Tournament sign-up', reset: 'Day ends', reset2: 'Attempts reset' },
    accounts: 'Accounts', problemsFirst: 'problems first', account: 'Account', status: 'Status', reward: 'Daily Reward', pvp: 'PVP', salary: 'Salary / cap', live: 'Live activity', all: 'All →',
    st: { idle: 'Stopped', running: 'Running', preparing: 'Preparing', starting: 'Starting', stopping: 'Stopping', error: 'Error', stopped: 'Stopped' },
    issue: { overCap: 'Over the cap', nearCap: 'Near the cap', lowTk: 'Low TK', rosterFull: 'Roster full' },
    systems: 'Systems', idle: 'Idle', running: 'Running', paused: 'Paused', error: 'Error', done: 'Done',
    autoTrade: 'Auto Trade', autoTradeDone: 'Last run: {bought} bought · {converted} converted',
    draft: 'Draft', draftLine: 'in {rooms} room(s) · {attempts} account(s) with attempts', tournament: 'Tournament', tournamentLine: '{joined} registered this run',
    market: 'Market', marketLine: '{sold} sale(s) to claim · {listed} listed', trade: 'Trading Hall', tradeLine: '{count} listings', equipment: 'Equipment', equipmentLine: '{name} open', equipmentIdle: 'Closed',
    players: 'Players', playersLine: '▲ {up} · ▼ {down} · Base {base}', playersNever: 'No list yet', cards: 'Cards', cardsLine: '{players} players · {teams} teams', schedule: 'Scheduler', scheduleLine: 'Next: {name} · {at}', scheduleNone: 'Nothing scheduled',
    risers: 'Biggest risers today', fallers: 'Biggest drops today', atBase: 'At base', more: '+{n} more', noActivity: 'Nothing yet'
  }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const AV = ['#e8661c', '#2b5cc0', '#187a47', '#965b05', '#6b4fbf', '#b8352a', '#0f7f86', '#4a5568'];
const avColor = name => AV[[...String(name)].reduce((n, c) => n + c.charCodeAt(0), 0) % AV.length];

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

// Tiers collected today from the Daily Reward state (6 a day).
function rewardTiers(r) {
  if (!r) return null;
  if (r.status === 'completed') return 6;
  if (r.tier) return Math.max(0, Number(r.tier) - (r.status === 'claiming' ? 0 : 1));
  return null;
}

export default function HomePage({ state, t, go, msgText, toast = () => {} }) {
  const x = TEXT[t.lang] || TEXT.en;
  const now = useNow();
  const profile = state.accountProfile || {};
  const accounts = state.accounts || [];
  const main = accounts.find(a => a.id === profile.mainAccountId);
  const stats = id => profile.accounts?.[id] || {};
  const runtime = state.runtime || {};
  const running = Object.values(runtime).filter(r => ['running', 'preparing', 'starting'].includes(r?.status)).length;
  const settings = state.settings || {};

  // health rows by account
  const health = useMemo(() => Object.fromEntries((state.accountHealth?.rows || []).map(r => [r.accountId, r])), [state.accountHealth]);
  const problemCount = Object.values(health).filter(r => r.issues?.some(i => i.level === 'bad' || i.level === 'warn')).length;

  // KPIs
  const rewards = state.rewards || {};
  const tierRows = accounts.map(a => rewardTiers(rewards[a.id])).filter(v => v != null);
  const tiers = tierRows.reduce((a, b) => a + b, 0);
  const pvpAttempts = state.pvp?.status?.attempts || null;
  const pvpLeft = pvpAttempts ? Object.values(pvpAttempts).reduce((a, b) => a + (Number(b) || 0), 0) : null;
  const pvpMax = pvpAttempts ? Object.keys(pvpAttempts).length * 10 : 0;
  const social = state.social?.totals || { requests: 0, unread: 0, mail: 0 };
  const daily = state.dailyRoutine || {};
  const taskLists = Object.values(daily.tasks || {}).filter(v => v?.list);
  const readyRewards = taskLists.reduce((n, v) => n + v.list.filter(i => i.completed && !i.claimed).length, 0);
  const tasksDone = taskLists.filter(v => v.list.filter(i => !i.alliance).every(i => i.completed)).length;

  // the day's timeline (TR)
  const nowMin = trMinutes(now);
  const resetSec = (((19 * 60 - nowMin) + 1440) % 1440) * 60;
  const events = useMemo(() => {
    const list = [];
    const add = (min, label, tone) => { if (min != null) list.push({ min, label, tone }); };
    if (settings.dailyPvp?.enabled !== false) add(toMin(settings.dailyPvp?.at || '05:01'), x.ev.pvp, 'info');
    add(11 * 60 + 5, x.ev.salary, 'muted');
    if (settings.autoPlayStop?.enabled) add(toMin(settings.autoPlayStop.stopAt), x.ev.stop, 'bad');
    add(15 * 60, x.ev.tournament, 'warn');
    if (settings.dailyTournament?.enabled !== false) add(toMin(settings.dailyTournament?.at || '15:48'), x.ev.tReg, 'warn');
    if (settings.autoPlayStop?.enabled && settings.autoPlayStop?.resumeEnabled) add(toMin(settings.autoPlayStop.resumeAt), x.ev.resume, 'good');
    add(19 * 60, x.ev.reset, 'accent');
    add(19 * 60 + 10, x.ev.reset2, 'muted');
    for (const s of state.schedules || []) {
      if (!s.enabled || s.completed) continue;
      const at = Date.parse(s.startAt);
      if (!Number.isFinite(at) || at - now > 24 * 3600 * 1000 || at < now - 3600 * 1000) continue;
      if (/günlük|daily/i.test(s.name || '')) continue; // the daily lines are already on the axis
      add(trMinutes(at), s.taskName || s.name, 'info');
    }
    list.sort((a, b) => a.min - b.min);
    // two label rows so neighbours never overlap
    // Four label slots (two above the axis, two below); each label takes the first
    // slot where it does not touch the previous one (width estimated in minutes).
    const ends = [-1e9, -1e9, -1e9, -1e9];
    for (const e of list) {
      const half = (Math.max(e.label.length, 5) * 7 + 18) / 2 / 1100 * 1440;
      const slot = [0, 2, 1, 3].find(k => e.min - half > ends[k]) ?? [0, 2, 1, 3].reduce((a, k) => (ends[k] < ends[a] ? k : a), 0);
      e.row = slot;
      ends[slot] = e.min + half;
    }
    return list;
  }, [settings, state.schedules, x, Math.floor(now / 60000)]);

  // accounts, problems first
  const rank = a => {
    const issues = health[a.id]?.issues || [];
    if (issues.some(i => i.level === 'bad')) return 0;
    if (issues.some(i => i.level === 'warn')) return 1;
    if (['running', 'preparing', 'starting'].includes(runtime[a.id]?.status)) return 2;
    return 3;
  };
  const rows = [...accounts].sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
  const feed = (state.activity || []).slice(0, 9);

  // systems (kept from the old home page)
  const at = state.autoTrade2?.run;
  const atStatus = at?.status || 'idle';
  const draft = state.draft || {};
  const tn = state.tournament || {};
  const market = state.market || {};
  const sold = Object.values(market.accounts || {}).reduce((n, s) => n + (s?.counts?.sold || 0), 0);
  const listed = Object.values(market.accounts || {}).reduce((n, s) => n + (s?.counts?.listed || 0), 0);
  const tr = state.trading?.runtime || {};
  const eq = state.equipment || {};
  const pl = state.players || {};
  const plist = pl.players || [];
  const cards = state.cards || {};
  const next = (state.schedules || []).filter(s => s.enabled && !s.completed && Date.parse(s.startAt) > now).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
  const risers = useMemo(() => [...plist].filter(p => p.change > 0).sort((a, b) => b.change - a.change).slice(0, 6), [plist]);
  const fallers = useMemo(() => [...plist].filter(p => p.change < 0).sort((a, b) => a.change - b.change).slice(0, 6), [plist]);
  const atBase = useMemo(() => plist.filter(p => p.isBase).sort((a, b) => b.value - a.value), [plist]);
  const word = s => x[s] || s;
  const tone = s => s === 'running' || s === 'done' ? 'ok' : s === 'error' ? 'bad' : s === 'paused' || s === 'stopped' ? 'warn' : 'muted';
  const sys = (key, page, title, status, line) => <button key={key} className="cc-sys" onClick={() => go(page)}><div><b>{title}</b><span className={`pill ${tone(status)}`}><i />{word(status)}</span></div><small>{line}</small></button>;

  const statusChip = a => {
    const r = runtime[a.id];
    const issue = (health[a.id]?.issues || []).find(i => i.level === 'bad') || (health[a.id]?.issues || []).find(i => i.level === 'warn');
    if (issue && !['running', 'preparing', 'starting'].includes(r?.status)) return <span className={`cc-chip ${issue.level === 'bad' ? 'bad' : 'warn'}`}>{x.issue[issue.kind] || issue.kind}</span>;
    const s = r?.status || 'stopped';
    const cls = ['running', 'preparing', 'starting'].includes(s) ? 'good' : s === 'error' ? 'bad' : s === 'stopping' ? 'warn' : 'muted';
    const what = cls === 'good' && r?.taskName ? ` · ${r.taskName}` : '';
    return <span className={`cc-chip ${cls}`} title={r?.message || ''}>{x.st[s] || s}{what}</span>;
  };

  return <div className="page cc-page">
    <div className="cc-top">
      <h1>{x.title}</h1>
      <span className={`cc-chip ${state.gameHealth?.down ? 'bad' : 'good'}`}>{state.gameHealth?.down ? x.offline : x.online}</span>
      <span className="cc-chip info">{fill(x.autoplay, { n: running, total: accounts.length })}</span>
      {problemCount > 0 && <span className="cc-chip warn">{fill(x.problems, { n: problemCount })}</span>}
      <span className="sp" />
      <span className="cc-reset">{x.reset} <b className="num">{clock(resetSec)}</b></span>
    </div>

    {main ? <div className="cc-main"><b>{x.main}: {main.name}</b><span className="num">{x.level} {stats(main.id).level ?? '—'}</span><span className="num">{x.tk} {num(stats(main.id).tk)}</span><span className="num">{x.apk} {num(stats(main.id).apk)}</span><span className="num">{x.tix} {num(stats(main.id).tix)}</span><span className="num cc-usable">{x.apk}/{x.tix}: {num(profile.totalUsableApk)} / {num(profile.totalUsableTix)}</span></div> : <div className="cc-main muted"><b>{x.noMain}</b></div>}

    <div className="cc-kpis">
      <button className="cc-kpi" onClick={() => go('autoplay')}><small>{x.kReward}</small><b className="num">{tierRows.length ? tiers : '—'}<em>{tierRows.length ? ` ${fill(x.kRewardSub, { n: tierRows.length * 6 })}` : ''}</em></b><span className="cc-bar"><span style={{ width: `${tierRows.length ? Math.round(tiers / (tierRows.length * 6) * 100) : 0}%`, background: 'var(--d-accent)' }} /></span></button>
      <button className="cc-kpi" onClick={() => go('pvp')}><small>{x.kPvp}</small><b className="num">{pvpLeft ?? '—'}<em>{pvpLeft != null ? ` ${fill(x.kPvpSub, { n: pvpMax })}` : ''}</em></b>{pvpLeft != null ? <span className="cc-bar"><span style={{ width: `${pvpMax ? Math.round(pvpLeft / pvpMax * 100) : 0}%`, background: 'var(--d-info)' }} /></span> : <span className="cc-kpi-note">{x.kPvpNone}</span>}</button>
      <button className="cc-kpi" onClick={() => go('social')}><small>{x.kSocial}</small><b className="num">{social.requests + social.unread}<em> {x.kSocialSub}</em></b><span className="cc-kpi-note">{fill(x.kMail, { n: social.mail })}</span></button>
      <button className="cc-kpi" onClick={() => go('autoplay')}><small>{x.kTasks}</small><b className="num">{readyRewards}</b><span className="cc-kpi-note">{fill(x.kTasksSub, { done: tasksDone, total: taskLists.length })}</span></button>
    </div>

    <div className="panel cc-card">
      <h5><span>{x.flow}</span><span>{x.flowHint}</span></h5>
      <div className="cc-tl">
        <div className="cc-axis" />
        {events.map((e, i) => <div key={i} className={`cc-ev s${e.row}`} style={{ left: `${e.min / 1440 * 100}%` }}><div className="cc-lbl"><b className="num">{hhmm(e.min)}</b><span>{e.label}</span></div><i className={e.tone} /></div>)}
        <div className="cc-now" style={{ left: `${nowMin / 1440 * 100}%` }}><span>{x.now} {hhmm(nowMin)}</span></div>
        <div className="cc-hours num">{['00', '04', '08', '12', '16', '20', '24'].map(h => <span key={h}>{h}</span>)}</div>
      </div>
    </div>

    <div className="cc-split">
      <div className="panel cc-card cc-accounts">
        <h5><span>{x.accounts}</span><span>{x.problemsFirst}</span></h5>
        <div className="cc-scroll"><table>
          <thead><tr><th>{x.account}</th><th>{x.status}</th><th>{x.reward}</th><th>{x.pvp}</th><th>{x.salary}</th><th>{x.tk}</th></tr></thead>
          <tbody>{rows.map(a => {
            const h = health[a.id] || {};
            const got = rewardTiers(rewards[a.id]);
            const ready = rewards[a.id]?.status === 'claiming' || (rewards[a.id]?.status === 'waiting' && !rewards[a.id]?.nextAt);
            const left = pvpAttempts?.[a.id];
            const pct = h.cap && h.used != null ? Math.min(100, Math.round(h.used / h.cap * 100)) : null;
            const lowTk = (h.issues || []).some(i => i.kind === 'lowTk');
            return <tr key={a.id} onClick={() => go('autoplay')}>
              <td><span className="cc-acc"><span className="cc-av" style={{ background: avColor(a.name) }}>{String(a.name).slice(0, 1).toUpperCase()}</span><b>{a.name}</b><small className="num">{x.level}{stats(a.id).level ?? '—'}</small></span></td>
              <td>{statusChip(a)}</td>
              <td><span className="cc-dots" aria-label={got != null ? `${got}/6` : '—'}>{[0, 1, 2, 3, 4, 5].map(i => <s key={i} className={got != null && i < got ? 'on' : ready && i === got ? 'rdy' : ''} />)}</span></td>
              <td className="num">{left != null ? `${left}/10` : '—'}</td>
              <td>{pct != null ? <><span className="cc-mini"><span style={{ width: `${pct}%`, background: h.used > h.cap ? 'var(--d-bad)' : pct >= 97 ? 'var(--d-warn)' : 'var(--d-good)' }} /></span> <span className="num">{num(h.used)}</span></> : '—'}</td>
              <td className={`num ${lowTk ? 'cc-warn' : ''}`}>{num(h.tk ?? stats(a.id).tk)}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>
      <div className="panel cc-card cc-feed">
        <h5><span>{x.live}</span><button className="cc-link" onClick={() => go('activity')}>{x.all}</button></h5>
        {feed.length ? feed.map(e => <div key={e.id} className="cc-feed-row"><span className="num">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><i className={e.level} /><span><b>{e.accountName || e.taskName || ''}</b> {msgText(t, e.code, e.params || {}, e.message)}</span></div>) : <div className="empty">{x.noActivity}</div>}
      </div>
    </div>

    <h3 className="section-title">{x.systems}</h3>
    <div className="cc-systems">
      {sys('at', 'autotrade', x.autoTrade, ['running', 'paused', 'error', 'stopped', 'done'].includes(atStatus) ? atStatus : 'idle', at ? (atStatus === 'done' ? fill(x.autoTradeDone, { bought: Object.values(at.accounts).reduce((n, a) => n + a.bought, 0), converted: Object.values(at.accounts).reduce((n, a) => n + a.converted, 0) }) : at.error?.message || at.step || '') : '')}
      {sys('draft', 'draft', x.draft, (draft.rooms || []).some(r => !r.ended) ? 'running' : 'idle', fill(x.draftLine, { rooms: (draft.rooms || []).filter(r => !r.ended).length, attempts: (draft.accounts || []).filter(a => a.attempts > 0).length }))}
      {sys('tn', 'tournament', x.tournament, tn.runtime?.status === 'running' ? 'running' : tn.runtime?.status === 'error' ? 'error' : 'idle', fill(x.tournamentLine, { joined: tn.runtime?.joined ?? 0 }))}
      {sys('mk', 'market', x.market, market.busy ? 'running' : 'idle', fill(x.marketLine, { sold, listed }))}
      {sys('th', 'trade', x.trade, tr.status === 'running' ? 'running' : tr.status === 'error' ? 'error' : 'idle', fill(x.tradeLine, { count: num(tr.count || 0) }))}
      {sys('eq', 'equipment', x.equipment, eq.job ? 'running' : 'idle', eq.accountId ? fill(x.equipmentLine, { name: accounts.find(a => a.id === eq.accountId)?.name || '' }) : x.equipmentIdle)}
      {sys('pl', 'players', x.players, pl.busy ? 'running' : 'idle', plist.length ? fill(x.playersLine, { up: plist.filter(p => p.change > 0).length, down: plist.filter(p => p.change < 0).length, base: atBase.length }) : x.playersNever)}
      {sys('cd', 'cards', x.cards, ['starting', 'running'].includes(cards.scanRuntime?.status) ? 'running' : 'idle', fill(x.cardsLine, { players: (cards.players || []).length, teams: (cards.teams || []).length }))}
      {sys('sc', 'autoplay', x.schedule, 'idle', next ? fill(x.scheduleLine, { name: next.name || next.taskName, at: new Date(next.startAt).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) }) : x.scheduleNone)}
    </div>

    {plist.length > 0 && <div className="home-players">
      <PlayerList title={x.risers} rows={risers} go={go} />
      <PlayerList title={x.fallers} rows={fallers} go={go} />
      <PlayerList title={x.atBase} rows={atBase.slice(0, 6)} go={go} more={atBase.length > 6 ? fill(x.more, { n: atBase.length - 6 }) : null} base />
    </div>}

    <AccountHealthPanel state={state} t={t} toast={toast} />
    <DailySummary t={t} />
  </div>;
}

function PlayerList({ title, rows, go, more, base }) {
  return <div className="panel home-plist"><b onClick={() => go('players')}>{title}</b>
    {rows.map(p => <div key={p.id} className="home-prow"><span>{p.name}</span><small>{p.team} · {p.rating}</small><em className="num">{Number(p.value).toLocaleString()}</em>{base ? <i className="role-badge pl-base-badge">Base</i> : <i className={p.change > 0 ? 'pl-up' : 'pl-down'}>{p.change > 0 ? '▲' : '▼'} {Math.abs(p.change)}</i>}</div>)}
    {more && <small className="muted-text">{more}</small>}
  </div>;
}
