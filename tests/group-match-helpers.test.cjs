const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DailyRoutineService } = require('../src/main/services/daily-routine-service.cjs');
const { GameSocket } = require('../src/main/services/game-socket.cjs');

// A small multi-user Group Match world (user 2026-11-23): parties of 3, two searching parties are
// paired, their games end after a few polls and the members' group_match task is done.
function world({ strangerMatchesUs = false } = {}) {
  const w = { parties: [], done: new Set(), calls: [], everMatched: new Set() };
  const mine = u => w.parties.find(p => p.members.some(m => m.userId === u)) || null;
  const tick = p => {
    if (p.status === 'matched' && ++p.polls > 6) {
      p.status = 'open'; p.members.forEach(m => { w.done.add(m.userId); m.ready = m.userId === p.leader; });
    }
  };
  const pairSearching = () => {
    const s = w.parties.filter(p => p.status === 'searching');
    if (s.length >= 2) for (const p of s.slice(0, 2)) { p.status = 'matched'; p.polls = 0; w.everMatched.add(p.party_id); }
  };
  const sim = (event, p = {}) => {
    const u = p.userId;
    if (event === 'getUserActiveMatch') return { success: true, match: null };
    if (event === 'requestPartyList') return { success: true, parties: w.parties };
    if (event === 'getMyParty') {
      const party = mine(u);
      // another (stranger) party takes our searching party while the helpers' party is still forming
      if (strangerMatchesUs && party?.leader === 'u1' && party.status === 'searching' && w.parties.some(x => x.leader === 'uh3')) {
        party.status = 'matched'; party.polls = 0; w.everMatched.add(party.party_id);
      }
      if (party) tick(party);
      return { success: true, party };
    }
    if (event === 'createParty') {
      const party = { party_id: 'p-' + u, mode: 'GROUP', leader: u, leaderName: u, members: [{ userId: u, teamName: u, ready: true }], status: 'open', hasPassword: false, maxMembers: 3 };
      w.parties.push(party); return { success: true, party };
    }
    if (event === 'joinParty') {
      const party = w.parties.find(x => x.party_id === p.partyId);
      if (!party || party.members.length >= 3) return { success: false, error: 'Party is full' };
      party.members.push({ userId: u, teamName: u, ready: false }); return { success: true, party };
    }
    if (event === 'setPartyReady') { const party = mine(u); party.members.find(m => m.userId === u).ready = p.ready; return { success: true, party }; }
    if (event === 'findPartyMatch') { const party = mine(u); party.status = 'searching'; pairSearching(); return { success: true, party }; }
    if (event === 'cancelPartySearch') { const party = mine(u); if (party) party.status = 'open'; return { success: true }; }
    if (event === 'leaveParty') {
      const party = mine(u);
      if (!party) return { success: true };
      if (party.status === 'matched') return { success: false, error: 'Nobody can leave while the games are being played' };
      party.members = party.members.filter(m => m.userId !== u);
      if (!party.members.length) w.parties = w.parties.filter(x => x !== party);
      else if (party.leader === u) party.leader = party.members[0].userId;
      return { success: true };
    }
    if (event === 'kickPartyMember') { const party = mine(u); party.members = party.members.filter(m => m.userId !== p.targetId); return { success: true }; }
    return { success: false, error: 'unknown ' + event };
  };
  const mainAck = (event, p = {}) => {
    if (event === 'getDailyTasks') return { tasks: [{ taskId: 't-gm', task: { key: 'group_match' }, completed: w.done.has(p.userId), isClaimed: false }] };
    return { success: false, error: 'unknown' };
  };
  w.createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.off = s.removeListener;
    s.close = () => { s.closed = true; };
    const emitLocal = EventEmitter.prototype.emit.bind(s);
    s.emit = () => true;
    s.timeout = () => ({
      emit: (event, payload, cb) => {
        w.calls.push({ path: options.path, event, payload });
        const data = options.path === '/simulation-socket/' ? sim(event, payload) : mainAck(event, payload);
        setTimeout(() => cb(null, data), 1);
      }
    });
    setTimeout(() => emitLocal('connect'), 1);
    return s;
  };
  return w;
}

function setup(w) {
  const logs = [];
  const ids = ['a1', 'h1', 'h2', 'h3', 'h4', 'h5', 'main'];
  const accounts = ids.map(id => ({ id, name: id === 'a1' ? 'Pipelne3' : id }));
  const user = id => (id === 'a1' ? 'u1' : 'u' + id);
  const held = [];
  const s = new DailyRoutineService({
    store: {
      getSettings: () => ({}), getAccounts: () => accounts,
      getAccountProfile: () => ({ mainAccountId: 'main', accounts: Object.fromEntries(ids.map(id => [id, { userId: user(id) }])) }),
      getDailyRoutine: () => ({ accounts: {} }), saveDailyRoutine() {}
    },
    activity: { add: e => logs.push(e) }, onChanged() {},
    sessions: { get: async a => ({ userId: user(a.id), cookieHeader: 'session=x' }) },
    createSocket: w.createSocket,
    timing: { pollMs: 2, helperAfterMs: 20, opponentAfterMs: 20, helperGraceMs: 10, partyWaitMs: 1e9, groupTotalMs: 4000, helperMaxMs: 4000, helperBusyMs: 1000, leaveWaitMs: 2000, unreadyKickMs: 1e9, idleLeaderMs: 1e9 }
  });
  // every account but a1 runs Auto Play; main must never be lent
  s.setHelpers({
    idle: () => ids.filter(id => id !== 'a1' && !held.includes(id)).map(id => ({ accountId: id, message: '' })),
    hold: (id, fn) => { held.push(id); return Promise.resolve(fn(new AbortController().signal)).catch(error => ({ error })); }
  });
  return { s, logs, held };
}

async function playGroup(s, w) {
  const sim = await GameSocket.open({ createSocket: w.createSocket, path: '/simulation-socket/' });
  const main = await GameSocket.open({ createSocket: w.createSocket, path: '/socket/' });
  const result = await s._groupMatch({ id: 'a1', name: 'Pipelne3' }, sim, main, 'u1', null);
  await Promise.all(s.helperRuns);
  return result;
}
const codes = logs => logs.map(l => l.code);

test('Group Match helpers: a short party is filled by Auto Play accounts, and with no opponent 3 more form one; everyone leaves after', async () => {
  const w = world();
  const { s, logs, held } = setup(w);
  const result = await playGroup(s, w);
  assert.equal(result, 'played', JSON.stringify(logs.map(l => l.message)));
  assert.ok(codes(logs).includes('dr.gmHelpers'), 'fillers sent');
  assert.ok(codes(logs).includes('dr.gmOpponents'), 'opponent party formed');
  assert.equal(held.length, 5, 'two fillers + three opponents');
  assert.ok(!held.includes('main'), 'the main account is never lent');
  assert.equal(w.everMatched.size, 2, 'our party played the helpers\' party');
  assert.equal(w.parties.length, 0, 'nobody is left in a party (Quick Play needs it)');
  assert.equal(s.helping.size, 0);
});

test('Group Match helpers: our party matched with another party while the helpers\' party forms → that party breaks up', async () => {
  const w = world({ strangerMatchesUs: true });
  const { s, logs } = setup(w);
  const result = await playGroup(s, w);
  assert.equal(result, 'played', JSON.stringify(logs.map(l => l.message)));
  assert.ok(codes(logs).includes('dr.gmHelpDisband'), JSON.stringify(logs.map(l => l.message)));
  assert.ok(![...w.everMatched].some(id => id === 'p-uh3'), 'the helpers\' party never played');
  assert.equal(w.parties.length, 0, 'nobody is left in a party');
});
