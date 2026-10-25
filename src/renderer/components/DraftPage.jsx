import { useEffect, useMemo, useState } from 'react';
import SortTable from './SortTable';

const api = window.dreamteam;
const num = v => v == null ? '—' : Number(v).toLocaleString();
const TEXT = {
  tr: {
    title: 'Draft', subtitle: 'Canlı draft odaları · seçimi sen yaparsın', accounts: 'Hesaplar', account: 'Hesap', level: 'Lv', attempts: 'Hak', status: 'Durum', rooms: 'Katılabileceği odalar',
    idle: 'Boşta', inRoom: 'Oda {slot}\'da', inRoomGame: 'Oda {slot}\'da (oyundan)', noRoom: 'Uygun oda yok', join: 'Oda {slot} · Lv {from}–{to} · {users}/10 · Katıl', joining: 'Katılıyor…',
    hall: 'Draft Salonu', open: 'Açık', live: 'Canlı', cooldown: 'Beklemede · {s}', room: 'Oda {slot}',
    liveRooms: 'Katıldığın odalar', startsIn: 'Başlamasına {s} sn', started: 'Başladı', round: '{r}. tur', turnOf: 'Sıra: {name} · {s} sn', yourTurn: 'Sıra sende: {name} · {s} sn', waitingTurn: 'Sıranı bekle',
    users: 'Katılımcılar', player: 'Oyuncu', pos: 'Mevki', rating: 'Rating', value: 'Fiyat', salary: 'Maaş', salaryHint: 'Seçmeden önce maaş fiyata eşittir; Lv30+ hesaplarda %5 indirim çıkabilir.', base: 'Base', change: 'Değişim', roles: 'Roller', card: 'Kart', pick: '{name} seçsin', picking: 'Gönderiliyor…', picked: 'Alındı', ended: 'Draft bitti',
    drafted: 'Drafttan alınanlar', draftedHint: 'Fiyat ve para birimi seçip istediklerini pazara koy.', list: 'Seçilileri listele', clear: 'Listeyi temizle', listed: 'Pazarda', none: 'Henüz draftta oyuncu alınmadı.',
    warning: 'Odaya girdikten sonra draft bitene kadar çıkılmaz; oyunda da "ayrılırsan hakkını kaybedersin" yazıyor. Haklar draft tamamen bitince oyundan yeniden okunur.',
    noTeam: 'No Team', stars: '★{s}', cards: '{n} kart', baseBadge: 'Base'
  },
  en: {
    title: 'Draft', subtitle: 'Live draft rooms · you make the picks', accounts: 'Accounts', account: 'Account', level: 'Lv', attempts: 'Attempts', status: 'Status', rooms: 'Rooms it can join',
    idle: 'Idle', inRoom: 'In room {slot}', inRoomGame: 'In room {slot} (from the game)', noRoom: 'No room to join', join: 'Room {slot} · Lv {from}–{to} · {users}/10 · Join', joining: 'Joining…',
    hall: 'Draft Hall', open: 'Open', live: 'Live', cooldown: 'Cooldown · {s}', room: 'Room {slot}',
    liveRooms: 'Your rooms', startsIn: 'Starts in {s}s', started: 'Started', round: 'Round {r}', turnOf: 'Turn: {name} · {s}s', yourTurn: 'Your turn: {name} · {s}s', waitingTurn: 'Wait for your turn',
    users: 'Participants', player: 'Player', pos: 'Pos', rating: 'Rating', value: 'Price', salary: 'Salary', salaryHint: 'Before the pick the salary equals the price; Lv30+ accounts may get a 5% discount.', base: 'Base', change: 'Change', roles: 'Roles', card: 'Card', pick: 'Pick for {name}', picking: 'Sending…', picked: 'Taken', ended: 'Draft ended',
    drafted: 'Drafted players', draftedHint: 'Choose price and currency and list the ones you want.', list: 'List selected', clear: 'Clear list', listed: 'Listed', none: 'No drafted players yet.',
    warning: 'Once in a room you stay until the draft ends; the game warns that leaving loses the attempt. Attempts are read again from the game after the draft fully ends.',
    noTeam: 'No Team', stars: '★{s}', cards: '{n} cards', baseBadge: 'Base'
  }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const isAtBase = (salary, base) => salary != null && base > 0 && Number(salary) <= Number(base);
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}`; };

function useTick() { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set(x => x + 1), 1000); return () => clearInterval(t); }, []); }

export default function DraftPage({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const d = state.draft || {};
  const roles = state.cards?.roles || [];
  const players = useMemo(() => new Map((state.players?.players || []).map(p => [p.id, p])), [state.players]);
  const [busy, setBusy] = useState({});
  useTick();
  useEffect(() => { api.draft.watch().catch(() => {}); return () => { api.draft.unwatch().catch(() => {}); }; }, []);
  const run = async (key, fn) => { setBusy(b => ({ ...b, [key]: true })); try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(b => { const n = { ...b }; delete n[key]; return n; }); } };
  const slotInfo = n => (d.slots || []).find(s => s.slotNumber === n);
  const now = Date.now();

  return <div className="page draft-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div></div>
    <div className="panel df-warning">{x.warning}</div>

    <h3 className="section-title">{x.accounts}</h3>
    <div className="panel table-panel"><SortTable><thead><tr><th>{x.account}</th><th>{x.level}</th><th>{x.attempts}</th><th>{x.status}</th><th>{x.rooms}</th></tr></thead>
      <tbody>{(d.accounts || []).map(a => <tr key={a.id}>
        <td><b>{a.name}</b></td><td>{a.level ?? '—'}</td><td>{a.attempts ?? '—'}</td>
        <td>{a.inSlot != null ? <span className="pill warn"><i />{fill(a.inSlotFromGame ? x.inRoomGame : x.inRoom, { slot: a.inSlot })}</span> : <span className="pill muted"><i />{x.idle}</span>}</td>
        <td><div className="df-joins">{a.joinable?.length ? a.joinable.map(n => { const s = slotInfo(n); const key = `${a.id}:${n}`; return <button key={n} className="btn primary small" disabled={busy[key]} onClick={() => run(key, () => api.draft.join(a.id, n))}>{busy[key] ? x.joining : fill(x.join, { slot: n, from: s?.range?.[0], to: s?.range?.[1], users: s?.users ?? 0 })}</button>; }) : <span className="muted-text">{x.noRoom}</span>}</div></td>
      </tr>)}</tbody></SortTable></div>

    <h3 className="section-title">{x.hall}</h3>
    <div className="df-hall">{(d.slots || []).filter(s => s.range).map(s => <div key={s.slotNumber} className={`df-slot ${s.hasStarted ? 'live' : s.cooldownRemaining > 0 ? 'cool' : 'open'}`}>
      <b>{fill(x.room, { slot: s.slotNumber })}</b><span>Lv {s.range[0]}–{s.range[1]}</span>
      <em>{s.hasStarted ? x.live : s.cooldownRemaining > 0 ? fill(x.cooldown, { s: mmss(s.cooldownRemaining) }) : x.open} · {s.users}/10</em>
    </div>)}</div>

    {(d.rooms || []).length > 0 && <><h3 className="section-title">{x.liveRooms}</h3>
      {d.rooms.map(room => <Room key={room.slot} room={room} x={x} players={players} roles={roles} busy={busy} run={run} now={now} />)}</>}

    <Drafted d={d} x={x} players={players} roles={roles} toast={toast} />
  </div>;
}

// Pool order: price high → low by default; the Role header sorts by role (Cards order), again to flip.
function usePoolSort(roles, players) {
  const [sort, setSort] = useState({ key: 'price', dir: -1 });
  const roleRank = p => { const ids = players.get(p.id)?.roleIds || []; const idx = ids.map(id => roles.findIndex(r => r.id === id)).filter(i => i >= 0); return idx.length ? Math.min(...idx) : Infinity; };
  const order = list => [...list].sort((a, b) => {
    if (sort.key === 'role') { const ra = roleRank(a), rb = roleRank(b); if (ra !== rb) return ra === Infinity ? 1 : rb === Infinity ? -1 : (ra - rb) * sort.dir; }
    return (Number(b.baseSalary) - Number(a.baseSalary)) * (sort.key === 'price' ? -sort.dir : 1);
  });
  const toggle = key => setSort(s => s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'price' ? -1 : 1 });
  const arrow = key => sort.key === key ? (sort.dir < 0 ? ' ▼' : ' ▲') : '';
  return { order, toggle, arrow };
}

function Room({ room, x, players, roles, busy, run, now }) {
  const ps = usePoolSort(roles, players);
  const nameOf = uid => room.users.find(u => u.userId === uid)?.teamName || uid?.slice(0, 6);
  const turnLeft = room.turn ? Number(room.turn.seconds) * 1000 - (now - Date.parse(room.turn.at)) : null;
  const ourTurn = room.turn && room.ours.find(o => o.userId === room.turn.userId);
  const n = room.pickOrder.length || 1;
  const startLeft = room.countdown != null && room.countdownAt ? Number(room.countdown) * 1000 - (now - Date.parse(room.countdownAt)) : null;
  return <div className={`panel df-room ${ourTurn ? 'my-turn' : ''}`}>
    <div className="df-room-head">
      <b>{fill(x.room, { slot: room.slot })} · Lv {room.range?.[0]}–{room.range?.[1]}</b>
      {room.ended ? <span className="pill muted"><i />{x.ended}</span> : !room.started ? <span className="pill warn"><i />{fill(x.startsIn, { s: Math.max(0, Math.ceil((startLeft ?? 0) / 1000)) })}</span> : <span className="pill ok"><i />{x.started} · {fill(x.round, { r: (room.pickIndex ?? 0) < n ? 1 : 2 })}</span>}
      {room.turn && !room.ended && <span className={`df-turn ${ourTurn ? 'mine' : ''}`}>{fill(ourTurn ? x.yourTurn : x.turnOf, { name: ourTurn ? ourTurn.name : nameOf(room.turn.userId), s: Math.max(0, Math.ceil((turnLeft ?? 0) / 1000)) })}</span>}
    </div>
    <div className="df-users">{room.users.map(u => <span key={u.userId} className={`df-user ${u.signed ? 'done' : ''} ${room.ours.some(o => o.userId === u.userId) ? 'ours' : ''} ${room.turn?.userId === u.userId ? 'turn' : ''}`}>{u.teamName}{u.signed ? ' ✓' : ''}</span>)}</div>
    <div className="table-panel df-pool"><SortTable><thead><tr><th>{x.player}</th><th>{x.pos}</th><th>{x.rating}</th><th className="sortable" onClick={() => ps.toggle('price')}>{x.value}{ps.arrow('price')}</th><th title={x.salaryHint}>{x.salary}</th><th>{x.base}</th><th>{x.change}</th><th className="sortable" onClick={() => ps.toggle('role')}>{x.roles}{ps.arrow('role')}</th><th>{x.card}</th><th></th></tr></thead>
      <tbody>{ps.order(room.players).map(p => { const info = players.get(p.id); const isBase = info?.isBase; const rl = (info?.roleIds || []).map(id => roles.find(r => r.id === id)).filter(Boolean);
        return <tr key={p.id} className={p.signed ? 'df-taken' : ''}>
          <td><b>{p.visualName || p.name}</b></td><td>{p.position}</td><td><span className="grade-badge">{p.rating}</span></td><td><b>{num(p.baseSalary)}</b></td><td title={x.salaryHint}>{num(p.baseSalary)}</td><td>{num(p.newBaseSalary)}{isAtBase(p.baseSalary, p.newBaseSalary) && <span className="base-badge">BASE</span>}</td>
          <td>{info?.change ? <span className={info.change > 0 ? 'pl-up' : 'pl-down'}>{info.change > 0 ? '▲' : '▼'} {Math.abs(info.change)}</span> : '—'}</td>
          <td><div className="pl-roles">{isBase && <span className="role-badge pl-base-badge">{x.baseBadge}</span>}{rl.map(r => <span key={r.id} className="role-badge" style={{ backgroundColor: r.color, borderColor: r.color }}>{r.name}</span>)}</div></td>
          <td>{info?.card ? (info.card.noTeam && !info.card.customTeam ? x.noTeam : fill(x.stars, { s: info.card.stars ?? 0 })) + ' · ' + fill(x.cards, { n: info.card.cardCount }) : '—'}</td>
          <td className="actions">{p.signed ? <span className="pill muted"><i />{x.picked}</span> : room.ours.map(o => { const key = `pick:${o.id}:${p.id}`; const mine = room.turn?.userId === o.userId && !room.ended;
            return <button key={o.id} className="btn success small" disabled={!mine || busy[key] || o.picking} title={mine ? '' : x.waitingTurn} onClick={() => run(key, () => api.draft.pick(o.id, p.id))}>{busy[key] ? x.picking : fill(x.pick, { name: o.name })}</button>; })}</td>
        </tr>; })}</tbody></SortTable></div>
  </div>;
}

function Drafted({ d, x, players, roles, toast }) {
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(null);
  const stockIds = roles.filter(r => /^stok$/i.test(r.name)).map(r => r.id);
  const entries = Object.entries(d.drafted || {}).filter(([, list]) => list.length);
  if (!entries.length) return <><h3 className="section-title">{x.drafted}</h3><p className="muted-text">{x.none}</p></>;
  const defaults = p => (players.get(p.id)?.roleIds || []).some(id => stockIds.includes(id)) ? { price: 99999, currency: 'TIX' } : { price: 20, currency: 'APK' };
  const get = p => ({ checked: !p.listed, ...defaults(p), ...edits[p.id] });
  const edit = (id, patch) => setEdits(e => ({ ...e, [id]: { ...e[id], ...patch } }));
  const accName = id => (d.accounts || []).find(a => a.id === id)?.name || id;
  const list = async (accountId, rows) => {
    const items = rows.filter(p => !p.listed && get(p).checked).map(p => ({ id: p.id, price: Number(get(p).price), currency: get(p).currency }));
    if (!items.length) return;
    setBusy(accountId);
    try { await api.draft.listPlayers(accountId, items); } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };
  return <><h3 className="section-title">{x.drafted} <small>{x.draftedHint}</small></h3>
    {entries.map(([accountId, rows]) => <div key={accountId} className="panel table-panel at2-list df-drafted">
      <div className="at2-list-head"><b>{accName(accountId)}</b><div className="toolbar"><button className="btn ghost small" onClick={() => api.draft.clearDrafted(accountId)}>{x.clear}</button><button className="btn primary" disabled={busy === accountId} onClick={() => list(accountId, rows)}>{x.list}</button></div></div>
      <SortTable><thead><tr><th></th><th>{x.player}</th><th>{x.value}</th><th>{x.salary}</th><th>{x.base}</th><th>{x.roles}</th><th></th></tr></thead><tbody>{rows.map(p => { const v = get(p); const info = players.get(p.id); const base = p.base ?? info?.base; const rl = (info?.roleIds || []).map(id => roles.find(r => r.id === id)).filter(Boolean); return <tr key={p.id + p.at}>
        <td>{p.listed ? null : <input type="checkbox" checked={v.checked} onChange={e => edit(p.id, { checked: e.target.checked })} />}</td>
        <td><b>{p.name}</b> <span className="muted-text">{p.position} · {p.rating}</span>{isAtBase(p.salary, base) && <span className="base-badge">BASE</span>}</td><td>{num(p.value)}</td><td>{num(p.salary)}</td><td>{num(base)}</td>
        <td><div className="pl-roles">{info?.isBase && <span className="role-badge pl-base-badge">{x.baseBadge}</span>}{rl.map(r => <span key={r.id} className="role-badge" style={{ backgroundColor: r.color, borderColor: r.color }}>{r.name}</span>)}{!info?.isBase && !rl.length && <span className="muted-text">—</span>}</div></td>
        <td>{p.listed ? <span className="pill ok"><i />{x.listed}</span> : <><input className="eq-small" type="number" min="1" value={v.price} onChange={e => edit(p.id, { price: e.target.value })} /> <select value={v.currency} onChange={e => edit(p.id, { currency: e.target.value })}><option>APK</option><option>TIX</option></select></>}</td>
      </tr>; })}</tbody></SortTable>
    </div>)}</>;
}
