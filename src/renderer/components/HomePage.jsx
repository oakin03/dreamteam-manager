import { useMemo } from 'react';

const num = v => v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString();
const TEXT = {
  tr: {
    main: 'Main hesap', noMain: 'Main hesap seçilmedi (Hesaplar sayfası)', level: 'Lv', tk: 'TK', apk: 'APK', tix: 'TIX',
    accounts: 'Hesaplar', autoplay: 'Auto Play çalışıyor', daily: 'Günlük rutin bugün', rewards: 'Bekleyen görev ödülü', tasks: 'Günlük görev tamam', usable: 'Kullanılabilir APK / TIX', totalTk: 'Toplam TK',
    systems: 'Sistemler', idle: 'Boşta', running: 'Çalışıyor', paused: 'Duraklatıldı', error: 'Hata', done: 'Bitti', stopped: 'Durduruldu',
    autoTrade: 'Auto Trade', autoTradeLine: '{step}', autoTradeDone: 'Son çalıştırma: {bought} alındı · {converted} karta çevrildi',
    draft: 'Draft', draftLine: '{rooms} odada · {attempts} hesapta hak var', tournament: 'Turnuva', tournamentLine: '{joined} kayıt bu çalıştırmada',
    market: 'Pazar', marketLine: '{sold} satış toplanmayı bekliyor · {listed} ilan', trade: 'Trading Hall', tradeLine: '{count} ilan', equipment: 'Ekipman', equipmentLine: '{name} açık', equipmentIdle: 'Kapalı',
    players: 'Oyuncular', playersLine: '▲ {up} · ▼ {down} · Base {base}', playersNever: 'Liste henüz alınmadı', cards: 'Kartlar', cardsLine: '{players} oyuncu · {teams} takım', schedule: 'Zamanlayıcı', scheduleLine: 'Sıradaki: {name} · {at}', scheduleNone: 'Bekleyen görev yok',
    risers: 'Bugün en çok artan', fallers: 'Bugün en çok düşen', atBase: 'Base\'e düşenler', alerts: 'Son uyarılar', noAlerts: 'Uyarı yok', more: '+{n} daha'
  },
  en: {
    main: 'Main account', noMain: 'No main account (Accounts page)', level: 'Lv', tk: 'TK', apk: 'APK', tix: 'TIX',
    accounts: 'Accounts', autoplay: 'Auto Play running', daily: 'Daily routine today', rewards: 'Task rewards waiting', tasks: 'Daily tasks done', usable: 'Usable APK / TIX', totalTk: 'Total TK',
    systems: 'Systems', idle: 'Idle', running: 'Running', paused: 'Paused', error: 'Error', done: 'Done', stopped: 'Stopped',
    autoTrade: 'Auto Trade', autoTradeLine: '{step}', autoTradeDone: 'Last run: {bought} bought · {converted} converted',
    draft: 'Draft', draftLine: 'in {rooms} room(s) · {attempts} account(s) with attempts', tournament: 'Tournament', tournamentLine: '{joined} registered this run',
    market: 'Market', marketLine: '{sold} sale(s) to claim · {listed} listed', trade: 'Trading Hall', tradeLine: '{count} listings', equipment: 'Equipment', equipmentLine: '{name} open', equipmentIdle: 'Closed',
    players: 'Players', playersLine: '▲ {up} · ▼ {down} · Base {base}', playersNever: 'No list yet', cards: 'Cards', cardsLine: '{players} players · {teams} teams', schedule: 'Scheduler', scheduleLine: 'Next: {name} · {at}', scheduleNone: 'Nothing scheduled',
    risers: 'Biggest risers today', fallers: 'Biggest drops today', atBase: 'At base', alerts: 'Recent warnings', noAlerts: 'No warnings', more: '+{n} more'
  }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

export default function HomePage({ state, t, go, msgText }) {
  const x = TEXT[t.lang] || TEXT.en;
  const profile = state.accountProfile || {};
  const accounts = state.accounts || [];
  const main = accounts.find(a => a.id === profile.mainAccountId);
  const stats = id => profile.accounts?.[id] || {};
  const running = Object.values(state.runtime || {}).filter(r => ['running', 'preparing'].includes(r.status)).length;
  const daily = state.dailyRoutine || {};
  const selected = daily.selected || [];
  const dailyDone = selected.filter(id => daily.accounts?.[id]?.status === 'done').length;
  const taskLists = Object.values(daily.tasks || {}).filter(v => v?.list);
  const readyRewards = taskLists.reduce((n, v) => n + v.list.filter(x => x.completed && !x.claimed).length, 0);
  const tasksDone = taskLists.filter(v => v.list.filter(x => !x.alliance).every(x => x.completed)).length;

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
  const next = (state.schedules || []).filter(s => s.enabled && !s.completed && Date.parse(s.startAt) > Date.now()).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
  const risers = useMemo(() => [...plist].filter(p => p.change > 0).sort((a, b) => b.change - a.change).slice(0, 6), [plist]);
  const fallers = useMemo(() => [...plist].filter(p => p.change < 0).sort((a, b) => a.change - b.change).slice(0, 6), [plist]);
  const atBase = useMemo(() => plist.filter(p => p.isBase).sort((a, b) => b.value - a.value), [plist]);
  const alerts = (state.activity || []).filter(e => ['error', 'warning'].includes(e.level)).slice(0, 6);
  const stateWord = s => x[s] || s;
  const tone = s => s === 'running' || s === 'done' ? 'ok' : s === 'error' ? 'bad' : s === 'paused' || s === 'stopped' ? 'warn' : 'muted';
  const sys = (key, page, title, status, line) => <button key={key} className="home-sys" onClick={() => go(page)}><div><b>{title}</b><span className={`pill ${tone(status)}`}><i />{stateWord(status)}</span></div><small>{line}</small></button>;

  return <div className="page home-page">
    <div className="page-title"><h1>DreamTeam Manager</h1></div>
    {main ? <div className="main-account-strip"><b>{x.main}: {main.name}</b><span>{x.level} {stats(main.id).level ?? '—'}</span><span>{x.tk} {num(stats(main.id).tk)}</span><span>{x.apk} {num(stats(main.id).apk)}</span><span>{x.tix} {num(stats(main.id).tix)}</span></div> : <div className="main-account-strip muted-main"><b>{x.noMain}</b></div>}

    <div className="home-metrics">
      <button onClick={() => go('accounts')}><span>{x.accounts}</span><b>{accounts.length}</b></button>
      <button onClick={() => go('autoplay')}><span>{x.autoplay}</span><b className={running ? 'green' : ''}>{running}<small> / {accounts.length}</small></b></button>
      <button onClick={() => go('autoplay')}><span>{x.daily}</span><b>{dailyDone}<small> / {selected.length}</small></b></button>
      <button onClick={() => go('autoplay')}><span>{x.tasks}</span><b>{tasksDone}<small> / {taskLists.length}</small></b></button>
      <button onClick={() => go('autoplay')}><span>{x.rewards}</span><b className={readyRewards ? 'gift' : ''}>🎁 {readyRewards}</b></button>
      <button onClick={() => go('accounts')}><span>{x.usable}</span><b>{num(profile.totalUsableApk)}<small> / {num(profile.totalUsableTix)}</small></b></button>
    </div>

    <h3 className="section-title">{x.systems}</h3>
    <div className="home-systems">
      {sys('at', 'autotrade', x.autoTrade, ['running', 'paused', 'error', 'stopped', 'done'].includes(atStatus) ? atStatus : 'idle', at ? (atStatus === 'done' ? fill(x.autoTradeDone, { bought: Object.values(at.accounts).reduce((n, a) => n + a.bought, 0), converted: Object.values(at.accounts).reduce((n, a) => n + a.converted, 0) }) : at.error?.message || at.step || '') : '')}
      {sys('draft', 'draft', x.draft, (draft.rooms || []).some(r => !r.ended) ? 'running' : 'idle', fill(x.draftLine, { rooms: (draft.rooms || []).filter(r => !r.ended).length, attempts: (draft.accounts || []).filter(a => a.attempts > 0).length }))}
      {sys('tn', 'tournament', x.tournament, tn.runtime?.status === 'running' ? 'running' : tn.runtime?.status === 'error' ? 'error' : 'idle', fill(x.tournamentLine, { joined: tn.runtime?.joined ?? 0 }))}
      {sys('mk', 'market', x.market, market.busy ? 'running' : 'idle', fill(x.marketLine, { sold, listed }))}
      {sys('th', 'trade', x.trade, tr.status === 'running' ? 'running' : tr.status === 'error' ? 'error' : 'idle', fill(x.tradeLine, { count: num(tr.count || 0) }))}
      {sys('eq', 'equipment', x.equipment, eq.job ? 'running' : 'idle', eq.accountId ? fill(x.equipmentLine, { name: accounts.find(a => a.id === eq.accountId)?.name || '' }) : x.equipmentIdle)}
      {sys('pl', 'players', x.players, pl.busy ? 'running' : 'idle', plist.length ? `${fill(x.playersLine, { up: plist.filter(p => p.change > 0).length, down: plist.filter(p => p.change < 0).length, base: atBase.length })} · ${pl.fetchedAt ? new Date(pl.fetchedAt).toLocaleString() : ''}` : x.playersNever)}
      {sys('cd', 'cards', x.cards, ['starting', 'running'].includes(cards.scanRuntime?.status) ? 'running' : 'idle', fill(x.cardsLine, { players: (cards.players || []).length, teams: (cards.teams || []).length }))}
      {sys('sc', 'autoplay', x.schedule, next ? 'idle' : 'idle', next ? fill(x.scheduleLine, { name: next.name || next.taskName, at: new Date(next.startAt).toLocaleString() }) : x.scheduleNone)}
    </div>

    {plist.length > 0 && <div className="home-players">
      <PlayerList title={x.risers} rows={risers} go={go} />
      <PlayerList title={x.fallers} rows={fallers} go={go} />
      <PlayerList title={x.atBase} rows={atBase.slice(0, 6)} go={go} more={atBase.length > 6 ? fill(x.more, { n: atBase.length - 6 }) : null} base />
    </div>}

    <h3 className="section-title">{x.alerts}</h3>
    <div className="panel home-alerts">{alerts.length ? alerts.map(e => <div key={e.id} className={`home-alert ${e.level}`}><span>{new Date(e.at).toLocaleTimeString()}</span><b>{e.accountName || e.taskName || ''}</b><em>{e.code ? msgText(t, e.code, e.params || {}, e.message) : e.message}</em></div>) : <span className="muted-text">{x.noAlerts}</span>}</div>
  </div>;
}

function PlayerList({ title, rows, go, more, base }) {
  return <div className="panel home-plist"><b onClick={() => go('players')}>{title}</b>
    {rows.map(p => <div key={p.id} className="home-prow"><span>{p.name}</span><small>{p.team} · {p.rating}</small><em>{Number(p.value).toLocaleString()}</em>{base ? <i className="role-badge pl-base-badge">Base</i> : <i className={p.change > 0 ? 'pl-up' : 'pl-down'}>{p.change > 0 ? '▲' : '▼'} {Math.abs(p.change)}</i>}</div>)}
    {more && <small className="muted-text">{more}</small>}
  </div>;
}
