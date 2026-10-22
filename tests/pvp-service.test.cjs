const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PvpService } = require('../src/main/services/pvp-service.cjs');

// Fake game: per user attempts and a PVP match that lasts `matchPolls` reads.
// `closeAfter` closes the arena after that many finds in total.
function fakeGame({ users, matchPolls = 2, closeAfter = Infinity, active = true }) {
  const calls = [];
  const st = { active, finds: 0, users: Object.fromEntries(Object.entries(users).map(([k, v]) => [k, { attempts: v.attempts, match: null, left: 0, other: v.otherMatch || 0, refuse: v.refuse || 0 }])) };
  const sim = (event, p) => {
    const u = st.users[p.userId];
    if (event === 'getUserActiveMatch') {
      if (u.other > 0) { u.other--; return { success: true, match: { match_id: 'm1', type: 'PK' } }; }
      return { success: true, match: u.match };
    }
    if (event === 'getUserPVPMatch') {
      if (u.match && --u.left < 0) u.match = null;
      return { success: true, match: u.match };
    }
    if (event === 'findPvpMatch') {
      if (u.refuse > 0) { u.refuse--; return { success: false, message: 'You are already in a match' }; }
      if (!st.active) return { success: false, message: 'PVP Arena is not active' };
      if (u.attempts <= 0) return { success: false, message: 'No attempts remaining' };
      u.attempts--; st.finds++;
      if (st.finds >= closeAfter) st.active = false;
      u.match = { match_id: 'pvp-' + st.finds, type: 'PVPARENA', status: 'started' }; u.left = matchPolls;
      return { success: true, matchId: u.match.match_id, server: 1 };
    }
  };
  const main = (event, p, reply) => {
    if (event === 'getPvpArenaStatus') return reply('pvpArenaStatus', { success: true, isActive: st.active, nextSession: null });
    if (event === 'getUserBasicInfo') return reply('userBasicInfo', { success: true, PVParenaAttempts: st.users[p.userId].attempts });
  };
  const createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.off = s.removeListener;
    s.close = () => { s.closed = true; };
    const emitLocal = EventEmitter.prototype.emit.bind(s);
    const path = options.path;
    s.emit = (event, payload) => { calls.push({ path, event, cookie: Boolean(options.extraHeaders) }); main(event, payload, (n, d) => setTimeout(() => !s.closed && emitLocal(n, d), 1)); return true; };
    s.timeout = () => ({ emit: (event, payload, cb) => { calls.push({ path, event, cookie: Boolean(options.extraHeaders) }); const d = sim(event, payload); setTimeout(() => cb(null, d), 1); } });
    setTimeout(() => emitLocal('connect'), 1);
    return s;
  };
  return { createSocket, calls, st };
}

function service(game, accounts) {
  const logs = [];
  let report = null;
  const store = {
    getAccounts: () => accounts.map(([id, name]) => ({ id, name })),
    getAccountProfile: () => ({ accounts: Object.fromEntries(accounts.map(([id]) => [id, { userId: 'u-' + id }])) }),
    getPvpReport: () => report, savePvpReport: r => { report = r; }
  };
  const svc = new PvpService({
    store, activity: { add: e => logs.push(e) }, onChanged() {},
    sessions: { get: async a => ({ userId: 'u-' + a.id, cookieHeader: 'session=x' }), invalidate() {} },
    createSocket: game.createSocket, timing: { pollMs: 1, appearGraceMs: 200 }
  });
  return { svc, logs, report: () => report };
}

test('PVP plays every account until its attempts are used up, then reports', async () => {
  const game = fakeGame({ users: { 'u-a': { attempts: 3 }, 'u-b': { attempts: 1 } } });
  const { svc, logs, report } = service(game, [['a', 'Trophy3'], ['b', 'Trophy4']]);
  await svc.runAndWait(['a', 'b']);
  assert.deepEqual(report().rows.map(r => [r.name, r.status, r.played, r.attemptsLeft]), [['Trophy3', 'done', 3, 0], ['Trophy4', 'done', 1, 0]]);
  assert.equal(game.st.users['u-a'].attempts, 0);
  // Finding a match uses the cookie; reads do not.
  assert.ok(game.calls.filter(c => c.event === 'findPvpMatch').every(c => c.cookie));
  assert.ok(game.calls.filter(c => c.event === 'getUserPVPMatch').every(c => !c.cookie));
  assert.ok(logs.some(l => l.code === 'pvp.summary' && l.params.done === 2 && l.params.played === 4));
  assert.equal(svc.snapshot().running, false);
});

test('arena inactive stops that account with the inactive message; others still finish', async () => {
  const closed = fakeGame({ users: { 'u-a': { attempts: 10 } }, active: false });
  const one = service(closed, [['a', 'Trophy3']]);
  await one.svc.runAndWait(['a']);
  assert.equal(one.report().rows[0].status, 'inactive');
  assert.ok(one.logs.some(l => l.code === 'pvp.inactive' && l.level === 'error'));
  assert.equal(closed.calls.filter(c => c.event === 'findPvpMatch').length, 0);

  // The arena closes after the 2nd match of the run: the account with attempts left is cut.
  const game = fakeGame({ users: { 'u-a': { attempts: 1 }, 'u-b': { attempts: 5 } }, closeAfter: 2 });
  const two = service(game, [['a', 'Trophy3'], ['b', 'Trophy4']]);
  await two.svc.runAndWait(['a', 'b']);
  const rows = Object.fromEntries(two.report().rows.map(r => [r.name, r]));
  assert.equal(rows.Trophy3.status, 'done');
  assert.equal(rows.Trophy4.status, 'inactive');
  assert.ok(rows.Trophy4.played >= 1 && rows.Trophy4.attemptsLeft > 0);
  assert.ok(two.logs.some(l => l.code === 'pvp.resultCut' && l.accountName === 'Trophy4'));
});

test('an account already in a match waits for it, then plays; a refused find waits and retries', async () => {
  const game = fakeGame({ users: { 'u-a': { attempts: 1, otherMatch: 3 }, 'u-b': { attempts: 1, refuse: 1 } } });
  const { svc, logs, report } = service(game, [['a', 'Trophy3'], ['b', 'Trophy4']]);
  await svc.runAndWait(['a', 'b']);
  assert.deepEqual(report().rows.map(r => r.status), ['done', 'done']);
  assert.ok(logs.some(l => l.code === 'pvp.waitMatch' && l.accountName === 'Trophy3'));
  assert.ok(logs.some(l => l.code === 'pvp.findFailed' && l.accountName === 'Trophy4'));
});

test('stopping the run marks unfinished accounts as stopped', async () => {
  const game = fakeGame({ users: { 'u-a': { attempts: 10 } }, matchPolls: 1000 });
  const { svc, report } = service(game, [['a', 'Trophy3']]);
  const ctl = new AbortController();
  const p = svc.runAndWait(['a'], { signal: ctl.signal });
  setTimeout(() => ctl.abort(), 60);
  await assert.rejects(p, { name: 'AbortError' });
  assert.equal(report().rows[0].status, 'stopped');
});

test('status reads arena state and attempts per account without logging in', async () => {
  const game = fakeGame({ users: { 'u-a': { attempts: 7 }, 'u-b': { attempts: 0 } }, active: false });
  const { svc } = service(game, [['a', 'Trophy3'], ['b', 'Trophy4']]);
  const st = await svc.status(['a', 'b']);
  assert.equal(st.active, false);
  assert.deepEqual(st.attempts, { a: 7, b: 0 });
  assert.ok(game.calls.every(c => !c.cookie));
  assert.deepEqual(svc.snapshot().status.attempts, { a: 7, b: 0 });
});
