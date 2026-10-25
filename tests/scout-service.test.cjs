const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ScoutService, agentFrom } = require('../src/main/services/scout-service.cjs');

// Fake game: one account's Free Agency list, funds and roster.
function fakeGame() {
  const calls = [];
  const st = {
    attempts: 2,
    agents: [
      { id: 'p1', name: 'Stephen Curry', visualName: 'S. Curry', position: 'PG', rating: 'S', baseSalary: 300, newBaseSalary: 280, lastSalary: 250, offense: 90, defense: 70, isSigned: false },
      { id: 'p2', name: 'Seth Curry', visualName: 'S. Curry', position: 'SG', rating: 'C', baseSalary: 90, newBaseSalary: 90, lastSalary: 100, offense: 60, defense: 50, isSigned: false }
    ]
  };
  const ack = (event, p, registered) => {
    if (event === 'getFreeAgent') return { freeAgents: st.agents, attemptsLeft: st.attempts, cooldownEnds: 123 };
    if (event === 'getTeamOptimized') return { players: { starters: [1, 2, 3, 4, 5], bench: [6] } };
    if (!registered) return { success: false, message: 'Authentication required' };
    if (event === 'signFreeAgent') { st.agents = st.agents.map(a => a.id === p.playerId ? { ...a, isSigned: true } : a); return { success: true, message: 'Player signed successfully.' }; }
    if (event === 'getFreeAgentAttempts') return { attemptsLeft: st.attempts, hasAttempts: st.attempts > 0 };
    if (event === 'CallBackFreeAgent') { st.attempts--; st.agents = [{ id: 'p9', name: 'New Guy', position: 'C', rating: 'B', baseSalary: 120, isSigned: false }]; return { success: true, freeAgents: st.agents }; }
  };
  const createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.off = s.removeListener;
    s.close = () => { s.closed = true; };
    s.connected = true;
    const emitLocal = EventEmitter.prototype.emit.bind(s);
    let registered = false;
    s.emit = (event, payload) => {
      calls.push({ event, cookie: Boolean(options.extraHeaders) });
      const reply = (n, d) => setTimeout(() => !s.closed && emitLocal(n, d), 1);
      if (event === 'register') { registered = true; reply('registrationSuccess', { ok: true }); }
      if (event === 'getUserBasicInfo') reply('userBasicInfo', { funds: 5000, salaryCap: 7000, totalSalaryUsed: 6000 });
      return true;
    };
    s.timeout = () => ({ emit: (event, payload, cb) => { calls.push({ event, cookie: Boolean(options.extraHeaders) }); const d = ack(event, payload, registered); setTimeout(() => cb(null, d), 1); } });
    setTimeout(() => emitLocal('connect'), 1);
    return s;
  };
  return { createSocket, calls, st };
}

function service(game) {
  const logs = [];
  const scout = new ScoutService({
    store: { getAccounts: () => [{ id: 'a', name: 'Trophy' }], getAccountProfile: () => ({ accounts: { a: { userId: 'u-a' } } }) },
    activity: { add: e => logs.push(e) },
    sessions: { get: async () => ({ userId: 'u-a', cookieHeader: 'c=1' }) },
    createSocket: game.createSocket,
    onChanged: () => {}
  });
  return { scout, logs };
}

test('Scout agent: price = base salary, change = price − last salary, id kept', () => {
  const a = agentFrom({ id: 'x', name: 'A', baseSalary: 300, newBaseSalary: 280, lastSalary: 250, isSigned: true }, 0);
  assert.equal(a.playerId, 'x'); assert.equal(a.price, 300); assert.equal(a.base, 280); assert.equal(a.change, 50);
  assert.equal(a.signed, true); assert.equal(a.canSign, false);
});

test('Scout opens without logging in: list, funds, salary space and roster', async () => {
  const game = fakeGame();
  const { scout } = service(game);
  await scout.open('a');
  const s = scout.snapshot().a;
  assert.equal(s.browserOpen, true);
  assert.equal(s.data.agents.length, 2);
  assert.equal(s.data.attempts, 2);
  assert.equal(s.data.funds, 5000);
  assert.equal(s.data.salarySpace, 1000);
  assert.equal(s.data.roster, 6);
  assert.ok(game.calls.every(c => !c.cookie && c.event !== 'register'));
});

test('Scout sign and Call Back go through a registered connection and re-read the list', async () => {
  const game = fakeGame();
  const { scout, logs } = service(game);
  await scout.open('a');
  await scout.sign('a', 'p2');
  assert.equal(scout.snapshot().a.data.agents.find(a => a.playerId === 'p2').signed, true);
  await assert.rejects(scout.sign('a', 'p2'), /already signed/);
  await scout.callback('a');
  const s = scout.snapshot().a;
  assert.deepEqual(s.data.agents.map(a => a.playerId), ['p9']);
  assert.equal(s.data.attempts, 1);
  assert.ok(game.calls.some(c => c.event === 'register' && c.cookie));
  assert.deepEqual(logs.map(l => l.code), ['sct.read', 'sct.signed', 'sct.error', 'sct.callback']);
});

test('Scout Call Back without attempts left is refused', async () => {
  const game = fakeGame();
  game.st.attempts = 0;
  const { scout } = service(game);
  await scout.open('a');
  await assert.rejects(scout.callback('a'), /No Call Back attempts/);
  assert.equal(scout.snapshot().a.status, 'error');
});
