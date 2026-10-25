// A small in-memory DreamTeam for Auto Trade tests: rosters, Scout, Make, market
// listing and the Trade Center, speaking the event names captured from the game.
const { EventEmitter } = require('node:events');

const player = (id, baseSalary, extra = {}) => ({ id, name: extra.name || id, visualName: extra.name || id, baseSalary, signedSalary: baseSalary, type: 'CURRENT', slot: null, benchSlot: null, equippedItems: { jersey: null, pants: null, sleeves: null, headband: null, shoes: null }, isTemporary: false, expiresAt: null, duration: null, ...extra });

function createWorld(users) {
  const world = { users: {}, rooms: new Map(), calls: [], sockets: new Set(), seq: 0, options: {}, tickets: [] };
  for (const [uid, u] of Object.entries(users)) {
    world.users[uid] = {
      name: u.name || uid, funds: u.funds ?? 50000,
      starters: (u.starters || ['s1', 's2', 's3', 's4', 's5'].map(s => `${uid}-${s}`)).map((id, i) => typeof id === 'string' ? player(id, 1000, { slot: ['PG', 'SG', 'SF', 'PF', 'C'][i] }) : id),
      bench: (u.bench || []).map((p, i) => ({ ...p, benchSlot: i + 1 })),
      lists: u.lists || [[]], attempts: u.attempts ?? 0, cooldownEnds: u.cooldownEnds ?? Date.now() + 30 * 60 * 1000,
      signed: new Set(), made: [], listed: [], discount: u.discount || [], apk: u.apk ?? 0
    };
    for (const m of u.market || []) world.tickets.push({ id: `t-${++world.seq}`, sellerId: uid, playerId: m.player.id, player: m.player, signedSalary: m.player.signedSalary, price: m.price, paymentMode: m.paymentMode || 'APK_TICKET', status: 'LISTED' });
  }
  const total = u => u.starters.length + u.bench.length;
  const tradable = u => [...u.starters, ...u.bench].filter(p => p.type !== 'XPLAYER' && !p.isTemporary);

  function handle(s, event, p, reply, push) {
    world.calls.push({ user: s.userId, event, payload: p });
    const uid = p?.userId || s.userId;
    const u = world.users[uid];
    const needAuth = ['market:buyPlayer', 'market:settleTicket', 'signFreeAgent', 'CallBackFreeAgent', 'starcard:makeStarCards', 'market:sellPlayer', 'createTradeRoom', 'joinTradeRoom', 'selectTradePlayers', 'acceptTrade', 'confirmTrade'];
    if (needAuth.includes(event) && !s.userId) return reply({ success: false, message: 'Authentication required' });
    switch (event) {
      case 'register': s.userId = p.userId; return push('registrationSuccess');
      case 'getTeamOptimized': return reply({ userId: uid, players: { starters: u.starters, bench: u.bench } });
      case 'getUserBasicInfo': return push('userBasicInfo', { success: true, funds: u.funds, autoPKTickets: u.apk });
      case 'getFreeAgent': {
        const list = u.lists[0] || [];
        return reply({ freeAgents: list.map(a => ({ ...a, isSigned: u.signed.has(a.id) })), attemptsLeft: u.attempts, cooldownEnds: u.cooldownEnds });
      }
      case 'getFreeAgentAttempts': return reply({ success: true, attemptsLeft: u.attempts, hasAttempts: u.attempts > 0 });
      case 'CallBackFreeAgent': {
        if (u.attempts <= 0) return reply({ success: false, message: 'No attempts' });
        u.attempts -= 1; u.lists.shift(); u.signed.clear();
        return reply({ success: true, freeAgents: u.lists[0] || [] });
      }
      case 'signFreeAgent': {
        const me = world.users[s.userId];
        const a = (me.lists[0] || []).find(x => x.id === p.playerId);
        if (!a || me.signed.has(a.id)) return reply({ success: false, message: 'Player not available' });
        if (total(me) >= 11) return reply({ success: false, message: 'Roster is full' });
        if (me.funds < a.baseSalary) return reply({ success: false, message: 'Not enough funds' });
        me.signed.add(a.id); me.funds -= a.baseSalary;
        const signed = me.discount?.includes(a.id) ? Math.round(a.baseSalary * 0.95) : a.baseSalary;
        me.bench.push({ ...player(a.id, a.baseSalary, { name: a.name, newBaseSalary: a.newBaseSalary }), signedSalary: signed, benchSlot: me.bench.length + 1 });
        return reply({ success: true, message: 'Player signed successfully.' });
      }
      case 'starcard:makeStarCards': {
        const me = world.users[s.userId];
        if (world.options.makeFails) return reply({ success: false, message: 'Make failed' });
        me.bench = me.bench.filter(x => !p.playerIds.includes(x.id));
        me.made.push(...p.playerIds);
        return reply({ success: true, count: p.playerIds.length });
      }
      case 'market:sellPlayer': {
        const me = world.users[s.userId];
        me.gone = [...(me.gone || []), ...me.bench.filter(x => x.id === p.playerId)];
        me.bench = me.bench.filter(x => x.id !== p.playerId);
        const listedPlayer = [...me.starters, ...me.bench, ...(me.gone || [])].find(x => x.id === p.playerId) || player(p.playerId, 0);
        me.listed.push({ id: p.playerId, price: p.price, paymentMode: p.paymentMode });
        world.tickets.push({ id: `t-${++world.seq}`, sellerId: s.userId, playerId: p.playerId, player: listedPlayer, signedSalary: listedPlayer.signedSalary, price: p.price, paymentMode: p.paymentMode, status: 'LISTED' });
        return push('market:sellResult', { success: true, playerId: p.playerId });
      }
      case 'market:getMyPlayerListings': {
        const mine = world.tickets.filter(t => t.sellerId === uid);
        return push('market:myPlayerListingsData', { tickets: mine.slice((p.page - 1) * 8, p.page * 8), total: mine.length });
      }
      case 'market:buyPlayer': {
        const me = world.users[s.userId];
        const t = world.tickets.find(x => x.id === p.ticketId);
        if (!t || t.status !== 'LISTED') return push('market:buyResult', { success: false, message: 'Listing not available' });
        if (me.apk < t.price) return push('market:buyResult', { success: false, message: 'Not enough APK tickets' });
        if ([...me.starters, ...me.bench].some(x => x.id === t.playerId)) return push('market:buyResult', { success: false, message: 'You already own this player.' });
        if (total(me) >= 11) return push('market:buyResult', { success: false, message: 'Roster is full' });
        me.apk -= t.price; t.status = 'SOLD';
        me.bench.push({ ...t.player, benchSlot: me.bench.length + 1 });
        world.buys = (world.buys || 0) + 1;
        return push('market:buyResult', { success: true });
      }
      case 'market:settleTicket': {
        const t = world.tickets.find(x => x.id === p.ticketId);
        if (!t || t.status !== 'SOLD') return push('market:settleResult', { success: false, message: 'Nothing to claim' });
        const fee = Math.ceil(t.price * 0.05); world.users[t.sellerId].apk += t.price - fee; t.status = 'SETTLED';
        return push('market:settleResult', { success: true, paymentMode: t.paymentMode, payout: t.price - fee, fee });
      }
      case 'joinTradeRoomBroadcast': case 'leaveTradeRoomBroadcast': return null;
      case 'createTradeRoom': {
        const roomId = `room-${++world.seq}`;
        world.rooms.set(roomId, { roomId, hostId: s.userId, guestId: null, password: p.password, description: p.description, hostSel: [], guestSel: [], hostAcc: false, guestAcc: false, createdAt: new Date(Date.now() + world.seq).toISOString() });
        return null;
      }
      case 'getTradeRooms': return push('tradeRoomList', { rooms: [...world.rooms.values()].map(r => ({ roomId: r.roomId, hostId: r.hostId, guestId: r.guestId, createdAt: r.createdAt, isPrivate: Boolean(r.password) })) });
      case 'cancelTradeRoom': world.rooms.delete(p.roomId); return null;
      case 'joinTradeRoom': {
        const room = world.rooms.get(p.roomId);
        if (!room || room.password !== p.password) return push('joinRoomError', { message: 'Incorrect password' });
        room.guestId = s.userId;
        const host = world.users[room.hostId]; const guest = world.users[room.guestId];
        return broadcast(room, 'joinedRoomData', { roomId: room.roomId, hostId: room.hostId, guestId: room.guestId, hostUser: { funds: host.funds }, guestUser: { funds: guest.funds }, hostPlayers: tradable(host), guestPlayers: tradable(guest) });
      }
      case 'selectTradePlayers': {
        const room = world.rooms.get(p.roomId);
        // Like the live game under load: a guest selection may be processed late.
        if (world.options.slowGuestSelectMs && s.userId !== room.hostId && !p.__late) { setTimeout(() => handle(s, event, { ...p, __late: true }, reply, push), world.options.slowGuestSelectMs); return; }
        if (s.userId === room.hostId) room.hostSel = p.selected; else room.guestSel = p.selected;
        room.hostAcc = room.guestAcc = false;
        broadcast(room, 'acceptTradeUpdate', { roomId: room.roomId, hostAccepted: false, guestAccepted: false });
        return broadcast(room, 'tradeSelectionUpdate', { roomId: room.roomId, hostSelectedPlayers: room.hostSel, guestSelectedPlayers: room.guestSel });
      }
      case 'acceptTrade': {
        const room = world.rooms.get(p.roomId);
        if (s.userId === room.hostId) room.hostAcc = true; else room.guestAcc = true;
        return broadcast(room, 'acceptTradeUpdate', { hostAccepted: room.hostAcc, guestAccepted: room.guestAcc });
      }
      case 'confirmTrade': {
        const room = world.rooms.get(p.roomId);
        const host = world.users[room.hostId]; const guest = world.users[room.guestId];
        const hs = p.hostSelected.map(x => x.id); const gs = p.guestSelected.map(x => x.id);
        const all = [...host.starters, ...host.bench, ...guest.starters, ...guest.bench];
        const result = msg => { world.rooms.delete(room.roomId); return broadcast(room, 'tradeResult', msg); };
        if (world.options.failNextTrade) { const m = world.options.failNextTrade; world.options.failNextTrade = null; return result({ success: false, message: m }); }
        if ([...hs, ...gs].some(id => Object.values(all.find(x => x.id === id)?.equippedItems || {}).some(Boolean))) return result({ success: false, message: 'Trade failed: one or more selected players has equipped items.' });
        if (hs.some(id => [...guest.starters, ...guest.bench].some(x => x.id === id))) return result({ success: false, message: 'Trade failed: guest would end up with duplicate players.' });
        if (gs.some(id => [...host.starters, ...host.bench].some(x => x.id === id))) return result({ success: false, message: 'Trade failed: host would end up with duplicate players.' });
        if (total(host) - hs.length + gs.length > 11 || total(guest) - gs.length + hs.length > 11) return result({ success: false, message: 'Trade would exceed max player limit (11)' });
        const sum = (u, ids) => u.bench.filter(x => ids.includes(x.id)).reduce((n, x) => n + x.signedSalary, 0);
        const diff = sum(host, hs) - sum(guest, gs); // guest pays the host when positive
        if (diff > 0 && guest.funds < diff) return result({ success: false, message: 'Insufficient funds' });
        if (diff < 0 && host.funds < -diff) return result({ success: false, message: 'Insufficient funds' });
        guest.funds -= diff; host.funds += diff;
        const moving = (u, ids) => { const out = u.bench.filter(x => ids.includes(x.id)); u.bench = u.bench.filter(x => !ids.includes(x.id)); return out; };
        const toGuest = moving(host, hs); const toHost = moving(guest, gs);
        guest.bench.push(...toGuest); host.bench.push(...toHost);
        world.trades = (world.trades || 0) + 1;
        return result({ success: true, message: 'Trade completed successfully' });
      }
    }
    return reply({ success: false, message: `unknown ${event}` });
  }

  function broadcast(room, event, data) {
    for (const s of world.sockets) if (!s.closed && (s.userId === room.hostId || s.userId === room.guestId)) s._push(event, data);
  }

  const createSocket = () => {
    const s = new EventEmitter();
    s.off = s.removeListener;
    s.connected = true;
    const local = EventEmitter.prototype.emit.bind(s);
    s._push = (event, data) => setTimeout(() => !s.closed && local(event, data), 1);
    s.close = () => { s.closed = true; world.sockets.delete(s); };
    s.emit = (event, payload) => { handle(s, event, payload, () => {}, (e, d) => s._push(e, d)); return true; };
    s.timeout = () => ({ emit: (event, payload, cb) => { handle(s, event, payload, d => setTimeout(() => cb(null, d), 1), (e, d) => s._push(e, d)); } });
    world.sockets.add(s);
    setTimeout(() => local('connect'), 1);
    return s;
  };
  return { world, createSocket, player };
}

module.exports = { createWorld, player };
