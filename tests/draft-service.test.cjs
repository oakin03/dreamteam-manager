const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DraftService, joinableSlots } = require('../src/main/services/draft-service.cjs');

const slot = (n, extra = {}) => ({ slotNumber: n, users: [], countdown: 30, hasStarted: false, cooldownRemaining: 0, ...extra });

test('joinable rooms: level range, not started, no cooldown, not full, attempts left, not already in a draft', () => {
  const slots = [slot(3), slot(5), slot(6, { hasStarted: true }), slot(7, { cooldownRemaining: 5000 }), slot(8), slot(9, { users: Array(10).fill('u') }), slot(12), slot(1)];
  assert.deepEqual(joinableSlots(slots, 34, { attempts: 2 }), [8]);
  assert.deepEqual(joinableSlots(slots, 25, { attempts: 1 }), [5]);
  assert.deepEqual(joinableSlots(slots, 34, { attempts: 0 }), [], 'no attempts');
  assert.deepEqual(joinableSlots(slots, 34, { attempts: 2, busy: true }), [], 'already in a draft');
  assert.deepEqual(joinableSlots(slots, 80, { attempts: 2 }), [12]);
});

// Fake /draft-socket/: one room, our account + a stranger, two rounds.
function fakeDraft() {
  const world = { attempts: { u1: 2 }, slots: [slot(8)], sockets: [], calls: [] };
  const pool = [{ id: 'p1', name: 'Bez Mbeng', baseSalary: 1395, newBaseSalary: 900, rating: 'A+', signed: false }, { id: 'p2', name: 'Taze Moore', baseSalary: 50, newBaseSalary: 48, rating: 'D-', signed: false }];
  const createSocket = (_url, options) => {
    const s = new EventEmitter(); s.off = s.removeListener; s.connected = true;
    const local = EventEmitter.prototype.emit.bind(s);
    const push = (e, d) => setTimeout(() => !s.closed && local(e, d), 1);
    s.close = () => { s.closed = true; };
    s.cookie = options?.extraHeaders?.Cookie || null;
    s.emit = (event, p) => {
      world.calls.push({ event, payload: p, cookie: s.cookie });
      if (event === 'getLiveDraftStatus') return push('liveDraftStatus', world.slots);
      if (event === 'joinDraftSlot') { world.room = s; world.slots[0].users.push(p.userId); push('draftJoined', { slotNumber: p.slotNumber, players: pool }); push('draftUsersUpdate', [{ userId: p.userId, teamName: 'Trophy4', signed: false }, { userId: 'x', teamName: 'Stranger', signed: false }]); return true; }
      if (event === 'signDraftPlayer') { pool.find(x => x.id === p.playerId).signed = true; world.attempts[p.userId] -= 1; push('signDraftPlayerResponse', { success: true, playerId: p.playerId }); push('draftPlayersUpdate', pool.map(x => ({ ...x }))); return true; }
      return true;
    };
    s.timeout = () => ({ emit: (event, p, cb) => { world.calls.push({ event, payload: p }); if (event === 'getDraftAttempts') setTimeout(() => cb(null, { success: true, draftAttempts: world.attempts[p.userId] ?? 0, rookieDraftAttempts: 2 }), 1); } });
    setTimeout(() => local('connect'), 1);
    world.sockets.push(s);
    return s;
  };
  return { world, createSocket, push: (e, d) => world.room && EventEmitter.prototype.emit.call(world.room, e, d) };
}

test('join with the session cookie (no register), our turn calls for attention, pick, end re-reads attempts', async () => {
  const { world, createSocket, push } = fakeDraft();
  const logs = []; const attention = []; const mem = { d: null };
  const svc = new DraftService({
    store: {
      getAccounts: () => [{ id: 'a1', name: 'Trophy4' }],
      getAccountProfile: () => ({ accounts: { a1: { userId: 'u1', level: 34 } } }),
      getDraftData: () => mem.d, saveDraftData: v => { mem.d = v; }
    },
    activity: { add: e => logs.push(e) }, onChanged() {}, onAttention: (k, n) => attention.push([k, n]),
    sessions: { get: async () => ({ userId: 'u1', cookieHeader: 'session=abc' }) }, createSocket
  });
  await svc.watch();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(svc.snapshot().accounts[0].joinable, [8]);
  await svc.join('a1', 8);
  const joinCall = world.calls.find(c => c.event === 'joinDraftSlot');
  assert.deepEqual(joinCall.payload, { userId: 'u1', slotNumber: 8, draftType: 'CURRENT' });
  assert.equal(joinCall.cookie, 'session=abc');
  assert.ok(!world.calls.some(c => c.event === 'register'), 'no register on the draft socket');
  assert.equal(svc.snapshot().accounts[0].inSlot, 8);
  assert.deepEqual(svc.snapshot().accounts[0].joinable, [], 'cannot join a second draft');
  push('draftStart', { round: 1, pickOrder: ['x', 'u1'] });
  push('draftPickTimer', { index: 0, seconds: 30, userId: 'x' });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(attention.length, 0, 'not our turn');
  push('draftPickTimer', { index: 1, seconds: 30, userId: 'u1' });
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(attention, [['draftTurn', 'Trophy4']]);
  await svc.pick('a1', 'p1');
  assert.equal(svc.snapshot().drafted.a1[0].name, 'Bez Mbeng');
  await assert.rejects(svc.pick('a1', 'p1'), /already picked|not in a draft/);
  // Attempts are not counted locally; they come from the game after the end.
  assert.equal(svc.snapshot().accounts[0].attempts, 2);
  push('draftEnded');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(svc.snapshot().accounts[0].attempts, 1);
  assert.equal(svc.snapshot().rooms[0].ended, true);
  assert.ok(logs.some(l => l.code === 'df.picked') && logs.some(l => l.code === 'df.ended'));
  svc.unwatch(); svc.shutdown();
});
