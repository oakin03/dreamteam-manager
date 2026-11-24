import { useEffect, useMemo, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import { roleColors } from './roleColors';
import RatingBadge from './RatingBadge';
import InjuryMark from './InjuryMark';
import { GroupedPicks } from './AccountGroups';

const api = window.dreamteam;
const num = v => v == null ? '—' : Number(v).toLocaleString();
export const DRAFT_TEXT = {
  tr: {
    title: 'Draft', subtitle: 'Canlı draft odaları · seçimi sen yaparsın', accounts: 'Hesaplar', account: 'Hesap', level: 'Lv', attempts: 'Hak', status: 'Durum', rooms: 'Katılabileceği odalar',
    idle: 'Boşta', inRoom: 'Oda {slot}\'da', inRoomGame: 'Oda {slot}\'da (oyundan)', noRoom: 'Uygun oda yok', join: 'Oda {slot} · Lv {from}–{to} · {users}/10 · Katıl', joining: 'Katılıyor…',
    hall: 'Draft Salonu', open: 'Açık', live: 'Canlı', cooldown: 'Beklemede · {s}', room: 'Oda {slot}',
    liveRooms: 'Katıldığın odalar', startsIn: 'Başlamasına {s} sn', started: 'Başladı', round: '{r}. tur', turnOf: 'Sıra: {name} · {s} sn', yourTurn: 'Sıra sende: {name} · {s} sn', waitingTurn: 'Sıranı bekle',
    users: 'Katılımcılar', player: 'Oyuncu', pos: 'Mevki', rating: 'Rating', value: 'Fiyat', salary: 'Maaş', salaryHint: 'Seçmeden önce maaş fiyata eşittir; Lv30+ hesaplarda %5 indirim çıkabilir.', base: 'Base', change: 'Değişim', roles: 'Roller', card: 'Kart', pick: '{name} seçsin', picking: 'Gönderiliyor…', picked: 'Alındı', ended: 'Draft bitti',
    drafted: 'Drafttan alınanlar', draftedHint: 'Fiyat ve para birimi seçip istediklerini pazara koy.', list: 'Seçilileri listele', clear: 'Listeyi temizle', fire: 'Kov', fireAll: 'Tümünü kov', toCard: 'Karta çevir', cardsSel: 'Seçilileri karta çevir', working: 'Çalışıyor…', yes: 'Evet', no: 'Vazgeç', queuedTag: 'Auto Trade bitince', fireQueuedTag: 'Kovulacak · Auto Trade bitince', fireQueuedAT: 'Auto Trade şu an bu hesabı kullanıyor · {n} oyuncu sırada, bitince kendiliğinden kovulacak', handedAT: '{n} oyuncu Auto Trade\'e verildi · main\'e götürüp karta çevirecek', queuedAT: 'Auto Trade şu an bu hesabı ya da main\'i kullanıyor · {n} oyuncu sırada, bitince kendiliğinden karta çevrilecek',
    confirmFire: '{names} kovulsun mu? (Oyuncu takımdan çıkar, geri alınmaz.)', confirmCards: '{names} ana hesaba ({main}) verilip yıldız kartına çevrilsin mi?', fired: '{n} oyuncu kovuldu', carded: '{n} oyuncu karta çevrildi', noMain: 'Ana hesap seçili değil.', listed: 'Pazarda', none: 'Henüz draftta oyuncu alınmadı.',
    warning: 'Odaya girdikten sonra draft bitene kadar çıkılmaz; oyunda da "ayrılırsan hakkını kaybedersin" yazıyor. Haklar draft tamamen bitince oyundan yeniden okunur.',
    noTeam: 'No Team', stars: '★{s}', cards: '{n} kart', baseBadge: 'Base'
  },
  en: {
    title: 'Draft', subtitle: 'Live draft rooms · you make the picks', accounts: 'Accounts', account: 'Account', level: 'Lv', attempts: 'Attempts', status: 'Status', rooms: 'Rooms it can join',
    idle: 'Idle', inRoom: 'In room {slot}', inRoomGame: 'In room {slot} (from the game)', noRoom: 'No room to join', join: 'Room {slot} · Lv {from}–{to} · {users}/10 · Join', joining: 'Joining…',
    hall: 'Draft Hall', open: 'Open', live: 'Live', cooldown: 'Cooldown · {s}', room: 'Room {slot}',
    liveRooms: 'Your rooms', startsIn: 'Starts in {s}s', started: 'Started', round: 'Round {r}', turnOf: 'Turn: {name} · {s}s', yourTurn: 'Your turn: {name} · {s}s', waitingTurn: 'Wait for your turn',
    users: 'Participants', player: 'Player', pos: 'Pos', rating: 'Rating', value: 'Price', salary: 'Salary', salaryHint: 'Before the pick the salary equals the price; Lv30+ accounts may get a 5% discount.', base: 'Base', change: 'Change', roles: 'Roles', card: 'Card', pick: 'Pick for {name}', picking: 'Sending…', picked: 'Taken', ended: 'Draft ended',
    drafted: 'Drafted players', draftedHint: 'Choose price and currency and list the ones you want.', list: 'List selected', clear: 'Clear list', fire: 'Fire', fireAll: 'Fire all', toCard: 'To cards', cardsSel: 'Selected to cards', working: 'Working…', yes: 'Yes', no: 'Cancel', queuedTag: 'After Auto Trade', fireQueuedTag: 'To be fired · after Auto Trade', fireQueuedAT: 'Auto Trade is using this account right now · {n} player(s) wait and are fired by themselves when it is done', handedAT: '{n} player(s) handed to Auto Trade · it takes them to main and makes cards', queuedAT: 'Auto Trade is using this account or main right now · {n} player(s) wait and become cards by themselves when it is done',
    confirmFire: 'Fire {names}? (The player leaves the team; this cannot be undone.)', confirmCards: 'Give {names} to the main account ({main}) and turn them into star cards?', fired: '{n} player(s) fired', carded: '{n} player(s) turned into cards', noMain: 'No main account is set.', listed: 'Listed', none: 'No drafted players yet.',
    warning: 'Once in a room you stay until the draft ends; the game warns that leaving loses the attempt. Attempts are read again from the game after the draft fully ends.',
    noTeam: 'No Team', stars: '★{s}', cards: '{n} cards', baseBadge: 'Base'
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const isAtBase = (salary, base) => salary != null && base > 0 && Number(salary) <= Number(base);
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}`; };

function useTick() { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set(x => x + 1), 1000); return () => clearInterval(t); }, []); }

export default function DraftPage({ state, t, toast }) {
  const x = DRAFT_TEXT[t.lang] || DRAFT_TEXT.en;
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

    <AutoDraftPanel state={state} lang={t.lang} toast={toast} attemptsOf={id => (d.accounts || []).find(a => a.id === id)?.attempts} />

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

    <Drafted d={d} x={x} players={players} roles={roles} toast={toast} mainName={(state.accounts || []).find(a => a.id === state.accountProfile?.mainAccountId)?.name || null} />
  </div>;
}

// ---------- Automatic Draft (user 2026-11-24) ----------
const AD_TEXT = {
  tr: {
    title: 'Otomatik Draft', start: 'Başlat ({n})', stop: 'Durdur', running: 'Çalışıyor · {n} oyuncu alındı', done: 'Bitti · {n} oyuncu alındı', stopped: 'Durduruldu', idle: 'Kapalı',
    accounts: 'Hesaplar', selectAll: 'Hepsini seç', clear: 'Temizle', priority: 'Öncelik sırası', up: 'Yukarı', down: 'Aşağı',
    fallback: 'Rolü olan oyuncu olmayan oda', fbCard: 'En ucuz oyuncuyu al → ana hesapta karta çevir', fbFire: 'En ucuz oyuncuyu al → kov', fbNone: 'Hiç oyuncu alma',
    fallbackHint: 'Auto Trade\'deki ucuz fiyat sınırına uyan en ucuz oyuncu alınır.', sideOnly: 'Sadece Satılabilir / Stok al', sideOnlyHint: 'Kart rolündeki oyuncular ve ucuz oyuncular alınmaz.',
    how: 'Seviyesine uygun yeni bir oda açılınca önce bir hesap girip oyunculara bakar; rolü olan oyuncu sayısı kadar hesap odaya girer (4 rollü oyuncu → 3 hesap daha). Sıra gelince 3–5 sn bekleyip öncelik sırasına göre seçer; Stok önce Lv30+ hesaplara kalır. Draft bitince Kart oyuncuları ana hesaba gidip karta çevrilir, Satılabilir / Stok bir Harcayıcı\'ya verilip Auto Trade fiyatıyla pazara konur. Seçilen hesapların hakkı bitene kadar sürer. Auto Trade\'in kullandığı hesaplar beklenir.',
    account: 'Hesap', attempts: 'Hak', state: 'Durum', picks: 'Alınanlar', pending: 'Sırada bekleyen devir',
    st: { waiting: 'Oda bekliyor', joining: 'Odaya giriyor', inRoom: 'Odada · {slot}', picking: 'Seçiyor', picked: 'Seçti', noPick: 'Seçecek oyuncu yok', rosterFull: 'Kadro dolu' },
    kind: { cards: 'Karta', spender: 'Harcayıcı', fire: 'Kov' }
  },
  en: {
    title: 'Automatic Draft', start: 'Start ({n})', stop: 'Stop', running: 'Running · {n} player(s) picked', done: 'Done · {n} player(s) picked', stopped: 'Stopped', idle: 'Off',
    accounts: 'Accounts', selectAll: 'Select all', clear: 'Clear', priority: 'Priority', up: 'Up', down: 'Down',
    fallback: 'Room without role players', fbCard: 'Take the cheapest → star cards on main', fbFire: 'Take the cheapest → fire', fbNone: 'Pick nobody',
    fallbackHint: 'The cheapest player within Auto Trade\'s cheap price limit.', sideOnly: 'Only Satılabilir / Stok', sideOnlyHint: 'Card-role players and cheap players are not picked.',
    how: 'When a new room for its level opens, one account joins first and looks at the players; as many accounts join as there are players with a role (4 role players → 3 more accounts). On each turn it waits 3–5 s and picks by the priority; Stok is left for Lv30+ accounts first. After the draft, card players go to main and become cards; Satılabilir / Stok go to a Harcayıcı and are listed at Auto Trade\'s price. It runs until the chosen accounts have no attempts left. Accounts Auto Trade is using are waited for.',
    account: 'Account', attempts: 'Attempts', state: 'Status', picks: 'Picked', pending: 'Waiting to be handed on',
    st: { waiting: 'Waiting for a room', joining: 'Joining', inRoom: 'In room {slot}', picking: 'Picking', picked: 'Picked', noPick: 'Nothing to pick', rosterFull: 'Roster full' },
    kind: { cards: 'Cards', spender: 'Harcayıcı', fire: 'Fire' }
  },
  get fil() { return filOf(this.en); }
};

function AutoDraftPanel({ state, lang, toast, attemptsOf }) {
  const x = AD_TEXT[lang] || AD_TEXT.en;
  const ad = state.autoDraft || {};
  const cfg = ad.config || { accountIds: [], priority: [], fallback: 'card', sideOnly: false };
  const running = Boolean(ad.running);
  const runInfo = ad.run;
  const accounts = state.accounts || [];
  const save = patch => api.autoDraft.config(patch).catch(e => toast(e.message, 'error'));
  const ids = cfg.accountIds.filter(id => accounts.some(a => a.id === id));
  const toggle = id => save({ accountIds: ids.includes(id) ? ids.filter(v => v !== id) : [...ids, id] });
  const move = (i, d) => { const p = [...cfg.priority]; const j = i + d; if (j < 0 || j >= p.length) return; [p[i], p[j]] = [p[j], p[i]]; save({ priority: p }); };
  const roleName = id => (ad.roles || []).find(r => r.id === id);
  const status = !runInfo ? x.idle : runInfo.status === 'running' ? fill(x.running, { n: runInfo.picked }) : runInfo.status === 'done' ? fill(x.done, { n: runInfo.picked }) : x.stopped;
  const act = fn => fn().catch(e => toast(e.message, 'error'));
  return <div className="panel ad-panel">
    <div className="ad-head"><b>{x.title}</b><span className={`pill ${running ? 'ok' : 'muted'}`}><i />{status}</span><span className="sp" style={{ flex: 1 }} />
      {running ? <button className="btn danger-soft" onClick={() => act(() => api.autoDraft.stop())}>{x.stop}</button>
        : <button className="btn primary" disabled={!ids.length} onClick={() => act(() => api.autoDraft.start({ accountIds: ids }))}>{fill(x.start, { n: ids.length })}</button>}</div>
    <small className="muted-text">{x.how}</small>
    <div className="ad-grid">
      <div><div className="ad-sub"><b>{x.accounts}</b><button className="chip" disabled={running} onClick={() => save({ accountIds: ids.length === accounts.length ? [] : accounts.map(a => a.id) })}>{ids.length === accounts.length ? x.clear : x.selectAll}</button></div>
        <div className="pvp-picks"><GroupedPicks storeKey="autodraft" accounts={accounts} selected={ids} disabled={running} onSet={next => save({ accountIds: next })} render={a => { const n = attemptsOf(a.id); return <button key={a.id} type="button" disabled={running} className={ids.includes(a.id) ? 'selected' : ''} onClick={() => toggle(a.id)}><span>{a.name}</span><em className={n === 0 ? 'zero' : ''}>{n ?? '—'}</em></button>; }} /></div></div>
      <div><div className="ad-sub"><b>{x.priority}</b></div>
        <ol className="ad-priority">{cfg.priority.map((id, i) => { const r = roleName(id); return <li key={id}><span className="role-pill" style={{ borderColor: r?.color, color: r?.color }}>{r?.name || id}</span>
          <button className="btn ghost small" disabled={running || i === 0} title={x.up} onClick={() => move(i, -1)}>▲</button><button className="btn ghost small" disabled={running || i === cfg.priority.length - 1} title={x.down} onClick={() => move(i, 1)}>▼</button></li>; })}</ol>
        <label className="ad-opt"><span>{x.fallback}</span><select value={cfg.fallback} disabled={running} onChange={e => save({ fallback: e.target.value })}><option value="card">{x.fbCard}</option><option value="fire">{x.fbFire}</option><option value="none">{x.fbNone}</option></select><small className="muted-text">{x.fallbackHint}</small></label>
        <label className="at2-check"><input type="checkbox" disabled={running} checked={cfg.sideOnly} onChange={e => save({ sideOnly: e.target.checked })} /><span>{x.sideOnly}</span><small>{x.sideOnlyHint}</small></label>
      </div>
    </div>
    {runInfo && <div className="table-panel ad-table"><SortTable><thead><tr><th>{x.account}</th><th>{x.attempts}</th><th>{x.state}</th><th>{x.picks}</th></tr></thead>
      <tbody>{runInfo.accountIds.map(id => { const a = runInfo.accounts[id] || {}; return <tr key={id}><td><b>{accounts.find(v => v.id === id)?.name || id}</b></td><td>{attemptsOf(id) ?? '—'}</td>
        <td>{fill(x.st[a.state] || a.state || '', { slot: a.slot })}</td>
        <td>{(a.picks || []).map((p, k) => <span key={k} className="pill muted"><i />{p.name} · {x.kind[p.kind] || p.kind}</span>)}</td></tr>; })}</tbody></SortTable></div>}
    {(ad.pending || []).length > 0 && <div className="ad-pending"><b>{x.pending}</b> {(ad.pending || []).map((p, k) => <span key={k} className="pill warn"><i />{p.name} · {p.count} · {x.kind[p.kind] || p.kind}</span>)}</div>}
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
          <td><b>{p.visualName || p.name}</b><InjuryMark name={p.name} /></td><td>{p.position}</td><td><RatingBadge grade={p.rating} /></td><td><b>{num(p.baseSalary)}</b></td><td title={x.salaryHint}>{num(p.baseSalary)}</td><td>{num(p.newBaseSalary)}{isAtBase(p.baseSalary, p.newBaseSalary) && <span className="base-badge">BASE</span>}</td>
          <td>{info?.change ? <span className={info.change > 0 ? 'pl-up' : 'pl-down'}>{info.change > 0 ? '▲' : '▼'} {Math.abs(info.change)}</span> : '—'}</td>
          <td><div className="pl-roles">{isBase && <span className="role-badge pl-base-badge">{x.baseBadge}</span>}{rl.map(r => <span key={r.id} className="role-badge" style={roleColors(r.color)}>{r.name}</span>)}</div></td>
          <td>{info?.card ? (info.card.noTeam ? x.noTeam : fill(x.stars, { s: info.card.stars ?? 0 })) + ' · ' + fill(x.cards, { n: info.card.cardCount }) : '—'}</td>
          <td className="actions">{p.signed ? <span className="pill muted"><i />{x.picked}</span> : room.ours.map(o => { const key = `pick:${o.id}:${p.id}`; const mine = room.turn?.userId === o.userId && !room.ended;
            return <button key={o.id} className="btn success small" disabled={!mine || busy[key] || o.picking} title={mine ? '' : x.waitingTurn} onClick={() => run(key, () => api.draft.pick(o.id, p.id))}>{busy[key] ? x.picking : fill(x.pick, { name: o.name })}</button>; })}</td>
        </tr>; })}</tbody></SortTable></div>
  </div>;
}

// source 'card': the players from Bag -> Random Card (user 2026-11-18); otherwise the drafted ones.
export function Drafted({ d, x, players, roles, toast, mainName, source = 'draft', title = null, hint = null, empty = null }) {
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(null);
  const [ask, setAsk] = useState(null);
  const stockIds = roles.filter(r => /^stok$/i.test(r.name)).map(r => r.id);
  const entries = Object.entries(d.drafted || {}).map(([k, list]) => [k, (list || []).filter(r => (r.source || 'draft') === source)]).filter(([, list]) => list.length);
  if (!entries.length) return <><h3 className="section-title">{title || x.drafted}</h3><p className="muted-text">{empty || x.none}</p></>;
  const defaults = p => (players.get(p.id)?.roleIds || []).some(id => stockIds.includes(id)) ? { price: 99999, currency: 'TIX' } : { price: 20, currency: 'APK' };
  const get = p => ({ checked: !p.listed, ...(p.suggest || defaults(p)), ...edits[p.id] });
  const edit = (id, patch) => setEdits(e => ({ ...e, [id]: { ...e[id], ...patch } }));
  const accName = id => (d.accounts || []).find(a => a.id === id)?.name || id;
  const list = async (accountId, rows) => {
    const items = rows.filter(p => !p.listed && get(p).checked).map(p => ({ id: p.id, price: Number(get(p).price), currency: get(p).currency }));
    if (!items.length) return;
    setBusy(accountId);
    try { await api.draft.listPlayers(accountId, items); } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };
  // Kov / Tümünü kov / Karta çevir (user 2026-11-11)
  const act = async (accountId, rows, kind) => {
    if (!rows.length) return;
    const names = rows.map(p => p.name).join(', ');
    if (kind === 'cards' && !mainName) { toast(x.noMain, 'error'); return; }
    setAsk({ text: fill(kind === 'fire' ? x.confirmFire : x.confirmCards, { names, main: mainName }), danger: kind === 'fire', go: () => doAct(accountId, rows, kind) });
  };
  const doAct = async (accountId, rows, kind) => {
    setAsk(null);
    setBusy(accountId);
    try {
      if (kind === 'fire') { const r = await api.draft.firePlayers(accountId, rows.map(p => p.id)); if (r?.queued) toast(fill(x.fireQueuedAT, { n: r.queued }), 'info'); else toast(fill(x.fired, { n: r?.firedByAT ?? rows.length }), 'success'); }
      else {
        const r = await api.draft.toCards(accountId, rows.map(p => p.id));
        if (r?.handed) toast(fill(x.handedAT, { n: r.handed }), 'success');
        else if (r?.queued) toast(fill(x.queuedAT, { n: r.queued }), 'info');
        else toast(fill(x.carded, { n: rows.length }), 'success');
      }
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };
  return <><h3 className="section-title">{title || x.drafted} <small>{hint || x.draftedHint}</small></h3>
    {ask && <div className="modal-backdrop" onClick={() => setAsk(null)}><div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
      <p>{ask.text}</p>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setAsk(null)}>{x.no}</button><button className={`btn ${ask.danger ? 'danger' : 'primary'}`} autoFocus onClick={ask.go}>{x.yes}</button></div>
    </div></div>}
    {entries.map(([accountId, rows]) => <div key={accountId} className="panel table-panel at2-list df-drafted">
      <div className="at2-list-head"><b>{accName(accountId)}</b><div className="toolbar"><button className="btn ghost small" onClick={() => api.draft.clearDrafted(accountId, source)}>{x.clear}</button><button className="btn danger small" disabled={busy === accountId || !rows.some(p => !p.listed)} onClick={() => act(accountId, rows.filter(p => !p.listed), 'fire')}>{x.fireAll}</button><button className="btn ghost" disabled={busy === accountId || !rows.some(p => !p.listed && get(p).checked)} onClick={() => act(accountId, rows.filter(p => !p.listed && !p.cardsQueued && get(p).checked), 'cards')}>{busy === accountId ? x.working : x.cardsSel}</button><button className="btn primary" disabled={busy === accountId} onClick={() => list(accountId, rows)}>{x.list}</button></div></div>
      <SortTable><thead><tr><th></th><th>{x.player}</th><th>{x.value}</th><th>{x.salary}</th><th>{x.base}</th><th>{x.roles}</th><th></th><th></th></tr></thead><tbody>{rows.map(p => { const v = get(p); const info = players.get(p.id); const base = p.base ?? info?.base; const rl = (info?.roleIds || []).map(id => roles.find(r => r.id === id)).filter(Boolean); return <tr key={p.id + p.at}>
        <td>{p.listed ? null : <input type="checkbox" checked={v.checked} onChange={e => edit(p.id, { checked: e.target.checked })} />}</td>
        <td><b>{p.name}</b><InjuryMark name={p.name} /> <span className="muted-text">{p.position}</span> <RatingBadge grade={p.rating} mini />{p.item && <small className="muted-text"> · {p.item}</small>}{p.salaryBefore != null && <small className="muted-text"> · {num(p.salaryBefore)} → {num(p.salary)}</small>}{isAtBase(p.salary, base) && <span className="base-badge">BASE</span>}{p.cardsQueued && <span className="pill warn"><i />{x.queuedTag}</span>}{p.fireQueued && <span className="pill bad"><i />{x.fireQueuedTag}</span>}</td><td>{num(p.value)}</td><td>{num(p.salary)}</td><td>{num(base)}</td>
        <td><div className="pl-roles">{info?.isBase && <span className="role-badge pl-base-badge">{x.baseBadge}</span>}{rl.map(r => <span key={r.id} className="role-badge" style={roleColors(r.color)}>{r.name}</span>)}{!info?.isBase && !rl.length && <span className="muted-text">—</span>}</div></td>
        <td>{p.listed ? <span className="pill ok"><i />{x.listed}</span> : <><input className="eq-small" type="number" min="1" value={v.price} onChange={e => edit(p.id, { price: e.target.value })} /> <select value={v.currency} onChange={e => edit(p.id, { currency: e.target.value })}><option>APK</option><option>TIX</option></select></>}</td>
        <td className="actions">{p.listed ? null : <><button className="btn ghost small" disabled={busy === accountId || p.cardsQueued} onClick={() => act(accountId, [p], 'cards')}>{x.toCard}</button>{' '}<button className="btn danger small" disabled={busy === accountId || p.fireQueued} onClick={() => act(accountId, [p], 'fire')}>{x.fire}</button></>}</td>
      </tr>; })}</tbody></SortTable>
    </div>)}</>;
}
