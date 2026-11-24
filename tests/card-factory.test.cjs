const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CardFactoryService } = require('../src/main/services/card-factory-service.cjs');
const { createWorld, player } = require('./fake-trade-game.cjs');
const { FriendNetwork } = require('../src/main/services/friend-network.cjs');

// T = target, A / B = sides, O = one of our accounts outside the run
function setup(users, opts = {}) {
  const { world, createSocket } = createWorld(users);
  const ids = Object.keys(users);
  const accs = ids.map(id => ({ id, name: users[id].name || id }));
  let saved = opts.saved || null;
  const logs = [];
  const store = {
    getAccounts: () => accs,
    getAccountProfile: () => ({ accounts: Object.fromEntries(ids.map(id => [id, { userId: id }])) }),
    getCardFactory: () => saved, saveCardFactory: v => { saved = JSON.parse(JSON.stringify(v)); }
  };
  const sessions = { get: async a => ({ userId: a.id, cookieHeader: 'c' }) };
  const friendNet = opts.friends ? new FriendNetwork({ store, sessions, createSocket, activity: { add: e => logs.push(e) }, onChanged() {} }) : null;
  const paused = [];
  const svc = new CardFactoryService({ store, activity: { add: e => logs.push(e) }, sessions, createSocket, friendNet, pauseAccount: async id => { paused.push(id); return async () => paused.push('resume:' + id); }, usedElsewhere: opts.usedElsewhere || (() => false), timing: { stepMs: 0, idleMs: 50 } });
  return { world, svc, logs, saved: () => saved, paused };
}
const cheap = (id, price = 40) => player(id, price);
const codes = logs => logs.map(l => l.code);

test('Kart Fabrikası: sides sign the cheap players, trade them to the target, the target makes them cards; stops at the goal', async () => {
  const { world, svc, logs, saved, paused } = setup({
    T: { funds: 100000, lists: [[cheap('t1')]] },
    A: { funds: 5000, lists: [[cheap('a1'), cheap('a2', 70), player('dear', 900), cheap('a3', 71)]] },
    B: { funds: 5000, lists: [[cheap('b1'), cheap('b2')]] }
  });
  const r = await svc.start({ targetId: 'T', sideIds: ['A', 'B'], maxPrice: 70, goal: 5, parallel: 3 });
  assert.ok(!r.tkShort, JSON.stringify(r.tkShort));
  await svc.done;
  const snap = svc.snapshot();
  assert.equal(snap.run.status, 'done', JSON.stringify(snap.run.error));
  assert.equal(snap.made, 5);
  assert.equal(world.users.T.made.length, 5);
  assert.ok(!world.users.T.made.includes('dear') && !world.users.T.made.includes('a3'), 'never above the max price');
  assert.ok(!world.users.A.bench.length && !world.users.B.bench.length, 'nothing left on the sides');
  assert.ok(world.trades >= 2, 'traded to the target');
  assert.ok(codes(logs).includes('cf.done'));
  assert.equal(saved().made, 5, 'the count is saved');
  assert.ok(paused.includes('A') && paused.includes('resume:A'), 'other services step aside and come back');
});

test('Kart Fabrikası: does not start when the target TK does not cover the rest at the max price', async () => {
  const { svc, logs } = setup({ T: { funds: 300, lists: [[]] }, A: { funds: 5000, lists: [[cheap('a1')]] } });
  const r = await svc.start({ targetId: 'T', sideIds: ['A'], maxPrice: 70, goal: 10 });
  assert.ok(r.tkShort, 'refused');
  assert.equal(r.tkShort.need, 700);
  assert.equal(r.tkShort.covers, 4);
  assert.equal(svc.isRunning(), false);
  assert.ok(codes(logs).includes('cf.tkShort'));
});

test('Kart Fabrikası: "continue" goes on from the saved count; Make batches a full bench and stays under 8 a minute', async () => {
  const list = Array.from({ length: 12 }, (_, i) => cheap('p' + i, 30));
  const { world, svc } = setup({
    T: { funds: 100000, lists: [[]] },
    A: { funds: 5000, lists: [list.slice(0, 6)] },
    B: { funds: 5000, lists: [list.slice(6)] }
  }, { saved: { made: 30, holds: {}, targetHold: [] } });
  await svc.start({ targetId: 'T', sideIds: ['A', 'B'], maxPrice: 70, goal: 42, parallel: 2 });
  await svc.done;
  assert.equal(svc.snapshot().made, 42, '30 before + 12 now');
  assert.ok((world.calls.filter(c => c.event === 'starcard:makeStarCards').length) <= 4, 'batched Makes');
});

test('Kart Fabrikası: accounts Auto Trade uses are refused; a side holding players from before joins the run', async () => {
  const a = setup({ T: { funds: 100000, lists: [[]] }, A: { funds: 5000, lists: [[]] } }, { usedElsewhere: id => id === 'A' });
  await assert.rejects(a.svc.start({ targetId: 'T', sideIds: ['A'], maxPrice: 70, goal: 1 }), /Auto Trade is using/);

  const { world, svc } = setup({
    T: { funds: 100000, lists: [[]] },
    A: { funds: 5000, lists: [[]] },
    H: { funds: 5000, bench: [cheap('h1')], lists: [[]] }
  }, { saved: { made: 0, holds: { H: [{ id: 'h1', name: 'h1', salary: 40 }] }, targetHold: [] } });
  await svc.start({ targetId: 'T', sideIds: ['A'], maxPrice: 70, goal: 1, parallel: 2 });
  await svc.done;
  assert.deepEqual(world.users.T.made, ['h1'], "H's player was traded and made a card");
});

test('Kart Fabrikası: free callbacks only, then friends\' boards', async () => {
  const { world, svc } = setup({
    T: { funds: 100000, lists: [[]] },
    A: { funds: 5000, attempts: 1, lists: [[player('x', 500)], [cheap('cb1')]], friends: ['F'] },
    F: { funds: 5000, lists: [[cheap('f1')]], friends: ['A'] }
  }, { friends: true });
  await svc.start({ targetId: 'T', sideIds: ['A'], maxPrice: 70, goal: 2, parallel: 2 });
  await svc.done;
  assert.deepEqual(world.users.T.made.sort(), ['cb1', 'f1']);
  assert.ok(!world.calls.some(c => c.event === 'useCallbackItem'), 'never a Callback item');
});
