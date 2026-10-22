const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutoTradeEngine } = require('../src/main/services/auto-trade-engine.cjs');
const { createWorld, player } = require('./fake-trade-game.cjs');

// Accounts: M (main), A (side, rich), B (side, poorer).
const ROLES = [{ id: 'sellable', name: 'Satılabilir' }, { id: 'card', name: 'Kart' }, { id: 'stok', name: 'Stok' }];
function setup(users, opts = {}) {
  const { roles = {}, accounts = Object.keys(users), mainId = 'M' } = opts;
  const { world, createSocket } = createWorld(users);
  const logs = [];
  const mem = { at: null };
  const accs = accounts.map(id => ({ id, name: users[id].name || id }));
  const store = {
    getAccounts: () => accs,
    getAccountProfile: () => ({ mainAccountId: mainId, accounts: Object.fromEntries(accounts.map(id => [id, { userId: id }])) }),
    getCardMetadata: () => ({ players: Object.fromEntries(Object.entries(roles).map(([pid, r]) => [`id:${pid}`, { roleIds: [].concat(r) }])) }),
    getCardRoles: () => ROLES,
    getCards: () => ({ players: Object.fromEntries((opts.teams || []).map(([pid, team]) => [`id:${pid}`, { playerId: pid, team, noTeam: team === 'No Team' }])) }),
    getAutoTrade2: () => mem.at, saveAutoTrade2: v => { mem.at = JSON.parse(JSON.stringify(v)); }
  };
  const attention = [];
  const scoutUpdates = [];
  const scans = [];
  const engine = new AutoTradeEngine({
    store, credentials: { encryptSecret: s => `enc:${s}`, decryptSecret: s => String(s).replace(/^enc:/, '') },
    activity: { add: e => logs.push(e) }, onChanged() {}, onAttention: (k, t) => attention.push(k), onCycleEnd: async () => { scans.push(Date.now()); if (opts.scanFails) throw new Error('scan failed'); }, onScout: (id, reply) => scoutUpdates.push({ id, signed: (reply.freeAgents || []).filter(a => a.isSigned).map(a => a.id) }),
    sessions: { get: async a => ({ userId: a.id, cookieHeader: 'c' }) }, createSocket, timing: { stepMs: 0 }
  });
  return { world, engine, logs, attention, mem, scoutUpdates, scans };
}
const codes = logs => logs.map(l => l.code);
const finish = async engine => { await engine.done; return engine.snapshot().run; };
const ids = list => list.map(p => p.id).sort();

test('full run: main buys and converts, sides by TK swap players in one trade each way', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 20000, lists: [[player('card1', 600), player('cheap1', 60), player('sell1', 1300), player('nobody', 700)]] },
    A: { funds: 90000, lists: [[player('card2', 500), player('sell2', 900), player('cheap2', 80)]] },
    B: { funds: 30000, lists: [[player('card3', 400)]] }
  }, { roles: { card1: 'card', card2: 'card', card3: 'card', sell1: 'sellable', sell2: 'stok' } });
  await engine.start({ accountIds: ['M', 'A', 'B'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  const M = world.users.M, A = world.users.A, B = world.users.B;
  // Main converted its card + cheap player and everything the sides sent.
  assert.deepEqual(M.made.sort(), ['card1', 'card2', 'card3', 'cheap1', 'cheap2']);
  assert.ok(!M.signed.has('nobody'), 'no role and over the price → not bought');
  // A (highest TK) took main's Satılabilir; it keeps its own Stok.
  assert.deepEqual(ids(A.bench), ['sell1', 'sell2']);
  assert.deepEqual(B.bench, []);
  assert.equal(M.bench.length, 0);
  assert.ok(M.starters.every(p => p.slot), 'starters untouched');
  // A was opened before B.
  const opened = logs.filter(l => l.code === 'at2.sideTurn').map(l => l.accountId);
  assert.deepEqual(opened, ['A', 'B']);
  assert.equal(run.cardCounts.card2.count, 1);
  assert.equal(run.accounts.A.players.sell1.status, 'keep');
  assert.equal(run.accounts.A.players.sell1.from, 'M');
  assert.equal(run.accounts.M.players.card2.status, 'converted');
  // TK = salary difference per trade. At A's start only main had players for it
  // (A pays 1300 for sell1); after scouting A sent card2 + cheap2 (main pays 580).
  assert.equal(run.accounts.A.tkPaid, 1300);
  assert.equal(run.accounts.A.tkReceived, 580);
  assert.equal(world.users.A.funds, 90000 - 500 - 900 - 80 - 1300 + 580);
  assert.ok(codes(logs).includes('at2.done'));
});

test('main full of side-bound players unloads to the highest-TK side mid-scouting', async () => {
  const sells = Array.from({ length: 8 }, (_, i) => player(`s${i}`, 1200));
  const { world, engine } = setup({
    M: { funds: 50000, lists: [sells] },
    A: { funds: 90000, lists: [[]] },
    B: { funds: 10000, lists: [[]] }
  }, { roles: Object.fromEntries(sells.map(p => [p.id, 'sellable'])) });
  await engine.start({ accountIds: ['M', 'A', 'B'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  // 6 fit on main's bench; A got 5 in the first unload, the rest followed later.
  assert.equal(world.users.M.signed.size, 8);
  assert.equal(world.users.A.bench.length + world.users.B.bench.length, 8);
  assert.ok(world.users.A.bench.length <= 6 && world.users.B.bench.length <= 6);
  assert.equal(world.users.M.bench.length, 0);
});

test('a player main gives that the side already has is kept for the next side', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[player('dup', 1300)]] },
    A: { funds: 90000, bench: [player('dup', 1300)], lists: [[]] },
    B: { funds: 10000, lists: [[]] }
  }, { roles: { dup: 'sellable' } });
  await engine.start({ accountIds: ['M', 'A', 'B'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 49 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(codes(logs).includes('at2.dupNextSide'));
  assert.deepEqual(ids(world.users.B.bench), ['dup']);
  assert.equal(world.users.A.bench.length, 1, 'A only has its own copy');
});

test('side→main duplicate: Make once, then stop for the user; Continue resumes', async () => {
  const { world, engine } = setup({
    M: { funds: 50000, starters: [player('twin', 1000, { slot: 'PG' }), ...['2', '3', '4', '5'].map((n, i) => player(`m${n}`, 1000, { slot: ['SG', 'SF', 'PF', 'C'][i] }))], lists: [[]] },
    A: { funds: 90000, lists: [[player('twin', 700)]] }
  }, { roles: { twin: 'card' }, accounts: ['M', 'A'] });
  await engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 49 });
  let run = await finish(engine);
  assert.equal(run.status, 'error');
  assert.equal(run.error.code, 'at2.dupOnMain');
  assert.equal(run.error.userFix, true);
  // The user moves main's starter out; Continue picks up from the side.
  world.users.M.starters[0] = player('other', 1000, { slot: 'PG' });
  engine.continue();
  run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(world.users.M.made.includes('twin'));
});

test('a side that cannot pay its part is skipped; main without TK stops the run', async () => {
  const s1 = setup({
    M: { funds: 50000, lists: [[player('sell1', 2000)]] },
    A: { funds: 100, lists: [[]] },
    B: { funds: 50, lists: [[]] }
  }, { roles: { sell1: 'sellable' } });
  await s1.engine.start({ accountIds: ['M', 'A', 'B'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 49 });
  const run = await finish(s1.engine);
  assert.equal(run.status, 'done');
  assert.deepEqual(run.sidesSkipped.sort(), ['A', 'B']);
  assert.ok(codes(s1.logs).includes('at2.sideFunds'));

  const s2 = setup({
    M: { funds: 300, lists: [[player('card1', 600)]] },
    A: { funds: 90000, lists: [[]] }
  }, { roles: { card1: 'card' }, accounts: ['M', 'A'] });
  await s2.engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 49 });
  const r2 = await finish(s2.engine);
  assert.equal(r2.status, 'error');
  assert.equal(r2.error.code, 'at2.mainFunds');
  assert.ok(s2.attention.includes('error'));
});

test('pre-existing bench: equipped/X never move, "trade" joins if it fits, "list" is listed, "none" stays', async () => {
  const eq = player('eq', 60, { equippedItems: { jersey: { id: 'j' } } });
  const xp = player('xp', 60, { type: 'XPLAYER' });
  const { world, engine } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, bench: [eq, xp, player('old1', 60), player('old2', 70), player('old3', 1500)], lists: [[]] }
  }, { accounts: ['M', 'A'] });
  await engine.start({
    accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100,
    benchDecisions: { A: { eq: { action: 'trade' }, xp: { action: 'trade' }, old1: { action: 'trade' }, old2: { action: 'none' }, old3: { action: 'list', price: 20, currency: 'APK' } } }
  });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.deepEqual(world.users.M.made, ['old1']);
  assert.deepEqual(ids(world.users.A.bench), ['eq', 'old2', 'xp']);
  assert.deepEqual(world.users.A.listed, [{ id: 'old3', price: 20, paymentMode: 'APK_TICKET' }]);
});

test('a side full of players it keeps asks which to list, then goes on', async () => {
  const keep = Array.from({ length: 7 }, (_, i) => player(`k${i}`, 1500));
  const { world, engine, attention } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [keep] }
  }, { roles: Object.fromEntries(keep.map(p => [p.id, 'stok'])), accounts: ['M', 'A'] });
  await engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable', 'stok'], maxPrice: 49 });
  while (engine.snapshot().run.status !== 'awaitingListing') await new Promise(r => setTimeout(r, 5));
  const req = engine.snapshot().run.listingRequest;
  assert.equal(req.players.length, 6);
  assert.deepEqual([req.players[0].price, req.players[0].currency], [99999, 'TIX'], 'Stok default');
  assert.ok(attention.includes('listing'));
  engine.respondListing([{ id: 'k0', price: 99999, currency: 'TIX' }, { id: 'k1', price: 50000, currency: 'TIX' }]);
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.equal(world.users.A.listed.length, 2);
  assert.ok(world.users.A.signed.has('k6'), 'bought the 7th after making room');
});

test('pause holds the run between steps; stop ends it and Continue finishes it', async () => {
  const many = Array.from({ length: 5 }, (_, i) => player(`c${i}`, 60));
  const { world, engine } = setup({ M: { funds: 50000, lists: [many] }, A: { funds: 90000, lists: [[]] } }, { accounts: ['M', 'A'] });
  await engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100 });
  while (world.users.M.signed.size < 1) await new Promise(r => setTimeout(r, 2));
  engine.pause();
  const at = world.users.M.signed.size;
  await new Promise(r => setTimeout(r, 60));
  assert.ok(world.users.M.signed.size <= at + 1, 'at most the step in flight finishes');
  assert.equal(engine.snapshot().run.status, 'paused');
  await engine.stop();
  assert.equal(engine.snapshot().run.status, 'stopped');
  engine.continue();
  const run = await finish(engine);
  assert.equal(run.status, 'done');
  assert.equal(world.users.M.made.length, 5);
});

test('loop mode: N cycles enter every account N times; main is chosen when the real main is not selected', async () => {
  const past = Date.now() - 1000;
  const { world, engine } = setup({
    M: { funds: 50000, lists: [[]], cooldownEnds: past },
    A: { funds: 90000, lists: [[player('c1', 60)], [player('c2', 60)]], attempts: 0, cooldownEnds: past },
    B: { funds: 80000, lists: [[]], cooldownEnds: past }
  }, { accounts: ['M', 'A', 'B'], mainId: 'M' });
  await assert.rejects(engine.start({ accountIds: ['A', 'B'] }), /acts as main/);
  await engine.start({ accountIds: ['A', 'B'], actingMainId: 'B', loopMode: 'count', loopCount: 2, sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100 });
  // Second cycle: the side's Scout shows a new list.
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.equal(run.config.mainId, 'B');
  assert.equal(run.accounts.A.visits, 2);
  assert.equal(run.accounts.B.visits >= 2, true);
  assert.deepEqual(world.users.B.made, ['c1']);
});

test('the Scout page sees each bought player as signed; card counts can be reset', async () => {
  const { engine, scoutUpdates } = setup({ M: { funds: 50000, lists: [[player('c1', 60), player('c2', 70)]] }, A: { funds: 90000, lists: [[]] } }, { accounts: ['M', 'A'] });
  await engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100 });
  const run = await finish(engine);
  assert.equal(run.status, 'done');
  const main = scoutUpdates.filter(u => u.id === 'M').map(u => u.signed.sort().join(','));
  assert.ok(main.includes('c1') && main.includes('c1,c2'), main.join(' | '));
  assert.equal(engine.snapshot().cardTotals.c1.count, 1);
  engine.resetCardCounts();
  assert.deepEqual(engine.snapshot().cardTotals, {});
  assert.deepEqual(engine.snapshot().run.cardCounts, {});
});

test('the main account card scan runs after the last side, once per cycle; a failed scan never stops the run', async () => {
  const past = Date.now() - 1000;
  const a = setup({ M: { funds: 50000, lists: [[]], cooldownEnds: past }, A: { funds: 90000, lists: [[]], cooldownEnds: past }, B: { funds: 10, lists: [[]], cooldownEnds: past } });
  await a.engine.start({ accountIds: ['M', 'A', 'B'], loopMode: 'count', loopCount: 2, sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100 });
  const run = await finish(a.engine);
  assert.equal(run.status, 'done');
  assert.equal(a.scans.length, 2);
  const order = a.logs.map(l => l.code).filter(c => ['at2.sideTurn', 'at2.cardScan'].includes(c));
  assert.deepEqual(order, ['at2.sideTurn', 'at2.sideTurn', 'at2.cardScan', 'at2.sideTurn', 'at2.sideTurn', 'at2.cardScan']);
  const b = setup({ M: { funds: 50000, lists: [[]] }, A: { funds: 90000, lists: [[]] } }, { accounts: ['M', 'A'], scanFails: true });
  await b.engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100 });
  assert.equal((await finish(b.engine)).status, 'done');
  assert.ok(b.logs.some(l => l.code === 'at2.cardScanFailed'));
});

test("base as sellable: a team player signed under tomorrow's Base (5% discount) is kept as Satılabilir; No Team / unknown still become cards", async () => {
  const pl = (id, price, base) => player(id, price, { newBaseSalary: base });
  const run1 = setup({
    M: { funds: 50000, lists: [[pl('teamDisc', 50, 50), pl('noTeamDisc', 50, 50), pl('unknownDisc', 50, 50), pl('teamFull', 50, 50), pl('cardAbove', 900, 400)]], discount: ['teamDisc', 'noTeamDisc', 'unknownDisc'] },
    A: { funds: 90000, lists: [[]] }
  }, { accounts: ['M', 'A'], roles: { cardAbove: 'card' }, teams: [['teamDisc', 'BOS'], ['noTeamDisc', 'No Team'], ['teamFull', 'BOS'], ['cardAbove', 'LAL']] });
  await run1.engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100, baseAsSellable: true });
  const run = await finish(run1.engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  // teamDisc signed at 48 = tomorrow's Base (50 × 0.95) → sellable; teamFull at 50/50 is not Base tomorrow → went to the side; the rest became cards.
  assert.deepEqual(run1.world.users.M.made.sort(), ['cardAbove', 'noTeamDisc', 'teamFull', 'unknownDisc']);
  assert.deepEqual(run1.world.users.A.bench.map(p => p.id), ['teamDisc']);
  assert.ok(run1.logs.some(l => l.code === 'at2.baseSellable'));
  // Projection off: 50 at today's Base 50 counts too.
  const run3 = setup({ M: { funds: 50000, lists: [[pl('teamFull', 50, 50)]] }, A: { funds: 90000, lists: [[]] } }, { accounts: ['M', 'A'], teams: [['teamFull', 'BOS']] });
  await run3.engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100, baseAsSellable: true, baseProjected: false });
  await finish(run3.engine);
  assert.deepEqual(run3.world.users.A.bench.map(p => p.id), ['teamFull']);
  // Option off: the same discount changes nothing.
  const run2 = setup({ M: { funds: 50000, lists: [[pl('teamDisc', 50, 48)]], discount: ['teamDisc'] }, A: { funds: 90000, lists: [[]] } }, { accounts: ['M', 'A'], teams: [['teamDisc', 'BOS']] });
  await run2.engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100 });
  await finish(run2.engine);
  assert.deepEqual(run2.world.users.M.made, ['teamDisc']);
});

test("trade where main gives nothing: no empty selection is sent, so a late one cannot reset the side's acceptance", async () => {
  const { world, engine } = setup({ M: { funds: 50000, lists: [[]] }, A: { funds: 90000, lists: [[player('card1', 500)]] } }, { accounts: ['M', 'A'], roles: { card1: 'card' } });
  world.options.slowGuestSelectMs = 400;
  await engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(world.users.M.made.includes('card1'));
  assert.equal(world.calls.filter(c => c.event === 'selectTradePlayers' && c.user === 'M').length, 0);
});
