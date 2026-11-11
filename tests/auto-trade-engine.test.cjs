const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutoTradeEngine } = require('../src/main/services/auto-trade-engine.cjs');
const { createWorld, player } = require('./fake-trade-game.cjs');
const { FriendNetwork } = require('../src/main/services/friend-network.cjs');

// Accounts: M (main), A (side, rich), B (side, poorer).
const ROLES = [{ id: 'sellable', name: 'Satılabilir' }, { id: 'card', name: 'Kart' }, { id: 'stok', name: 'Stok' }];
function setup(users, opts = {}) {
  const { roles = {}, accounts = Object.keys(users), mainId = 'M' } = opts;
  const { world, createSocket } = createWorld(users);
  const logs = [];
  const mem = { at: null };
  const accs = accounts.map(id => ({ id, name: users[id].name || id, ...(opts.accountRoles?.[id] ? { role: opts.accountRoles[id] } : {}) }));
  let settings = { accountRoleDefs: [{ id: 'spender', name: 'Harcayıcı' }] };
  const store = {
    getAccounts: () => accs,
    getAccountProfile: () => ({ mainAccountId: mainId, accounts: Object.fromEntries(accounts.map(id => [id, { userId: id, level: opts.levels?.[id] }])) }),
    getCardMetadata: () => ({ players: Object.fromEntries(Object.entries(roles).map(([pid, r]) => [`id:${pid}`, { roleIds: [].concat(r) }])) }),
    getCardRoles: () => ROLES,
    getCards: () => ({ players: Object.fromEntries((opts.teams || []).map(([pid, team]) => [`id:${pid}`, { playerId: pid, team, noTeam: team === 'No Team' }])) }),
    getSettings: () => settings, saveSettings: v => { settings = v; },
    getPlayersData: () => opts.playersData || null,
    getAutoTrade2: () => mem.at, saveAutoTrade2: v => { mem.at = JSON.parse(JSON.stringify(v)); }
  };
  const attention = [];
  const scoutUpdates = [];
  const scans = [];
  const sessions = { get: async a => ({ userId: a.id, cookieHeader: 'c' }) };
  const friendNet = opts.friends ? new FriendNetwork({ store, sessions, createSocket, activity: { add: e => logs.push(e) }, onChanged() {} }) : null;
  const engine = new AutoTradeEngine({
    friendNet, pauseAccount: opts.pauseAccount, onSpenderListed: opts.onSpenderListed, store, credentials: { encryptSecret: s => `enc:${s}`, decryptSecret: s => String(s).replace(/^enc:/, '') },
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
  }, { roles: { card1: 'card', card2: 'card', card3: 'card', sell1: 'sellable', sell2: 'stok' }, levels: { A: 35 } });
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

test('a side that cannot pay its part is skipped; main without TK skips the player and goes on', async () => {
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

  // user 2026-11-06: main short of TK no longer stops the run; the cheaper one is still bought
  const s2 = setup({
    M: { funds: 300, lists: [[player('card1', 600), player('card0', 200)]] },
    A: { funds: 90000, lists: [[]] }
  }, { roles: { card1: 'card', card0: 'card' }, accounts: ['M', 'A'] });
  await s2.engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 49 });
  const r2 = await finish(s2.engine);
  assert.equal(r2.status, 'done', JSON.stringify(r2.error));
  assert.ok(!s2.world.users.M.signed.has('card1') && s2.world.users.M.signed.has('card0'));
  assert.ok(codes(s2.logs).includes('at2.mainFundsSkip'));
});

test("a side buys main-bound players only as far as main's TK pays for them in the trade", async () => {
  const { world, engine, logs } = setup({
    M: { funds: 1000, lists: [[]] },
    A: { funds: 90000, lists: [[player('c1', 600), player('c2', 500), player('c3', 300)]] }
  }, { roles: { c1: 'card', c2: 'card', c3: 'card' }, accounts: ['M', 'A'] });
  await engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 49 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(world.users.A.signed.has('c1') && world.users.A.signed.has('c3'), '600 + 300 fit in 1000');
  assert.ok(!world.users.A.signed.has('c2'), '500 more would not');
  assert.deepEqual(world.users.M.made.sort(), ['c1', 'c3'], 'both reached main');
  assert.ok(codes(logs).includes('at2.mainBudget'));
  assert.equal(world.users.A.bench.length, 0);
});

test('main cannot pay the whole trade: it takes what its TK pays for, the rest waits, the run goes on', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 700, lists: [[]] },
    A: { funds: 90000, bench: [player('old1', 500), player('old2', 400)], lists: [[]] }
  }, { roles: { old1: 'card', old2: 'card' }, accounts: ['M', 'A'] });
  await engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 49,
    benchDecisions: { A: { old1: { action: 'trade' }, old2: { action: 'trade' } } } });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.deepEqual(world.users.M.made, ['old1']);
  assert.ok(world.users.A.bench.some(p => p.id === 'old2'), 'old2 waits on the side');
  assert.ok(codes(logs).includes('at2.mainFundsWait'));
});

test('the run fails half way: the spender that got players lists them before it stops', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, starters: [player('twin', 1000, { slot: 'PG' }), ...['2', '3', '4', '5'].map((n, i) => player(`m${n}`, 1000, { slot: ['SG', 'SF', 'PF', 'C'][i] }))], lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[player('ss1', 800), player('twin', 700)]], friends: ['S'] },
    S: { funds: 9000, friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { ss1: 'sellable', twin: 'card' }, friends: true });
  engine.savePricing({ defaults: { sellable: { price: 4444, currency: 'TIX' } } });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 49 });
  const run = await finish(engine);
  assert.equal(run.status, 'error');
  assert.equal(run.error.code, 'at2.dupOnMain');
  assert.deepEqual((world.users.S.listed || []).map(l => [l.id, l.price]), [['ss1', 4444]], 'listed before the stop');
  assert.ok(codes(logs).includes('at2.leftovers') && codes(logs).includes('at2.leftoversDone'));
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
  }, { roles: Object.fromEntries(keep.map(p => [p.id, 'stok'])), accounts: ['M', 'A'], levels: { A: 35 } });
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

test('a player with roles both ways waits for the user: Satılabilir keeps it, no card is made', async () => {
  const { world, engine, attention } = setup({
    M: { funds: 20000, lists: [[player('dual', 600), player('card1', 500)]] },
    A: { funds: 9000, lists: [[]] }
  }, { roles: { dual: ['sellable', 'card'], card1: 'card' } });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  for (let i = 0; i < 200 && engine.snapshot().run?.status !== 'awaitingRole'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(engine.snapshot().run.status, 'awaitingRole');
  assert.equal(engine.snapshot().run.roleRequest.player.id, 'dual');
  assert.ok(attention.includes('roleAsk'));
  engine.respondRole('side');
  const run = await finish(engine);
  assert.ok(!world.users.M.made.includes('dual'), 'not turned into a card');
  assert.ok(world.users.M.made.includes('card1'));
  // Satılabilir on main goes to the side, like any Satılabilir player
  assert.equal(run.accounts.A.players.dual.dir, 'side');
  assert.ok(world.users.A.bench.some(p => p.id === 'dual'));
});

test('List on market: one player left on a side is fired from its own row', async () => {
  const { world, engine, logs } = setup({ M: { funds: 50000, lists: [[]] }, A: { funds: 90000, bench: [player('k1', 60), player('k2', 70)], lists: [[]] } }, { accounts: ['M', 'A'] });
  await engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100, benchDecisions: { A: { k1: { action: 'none' }, k2: { action: 'none' } } } });
  await finish(engine);
  engine.state.accounts.A.players.k1 = { id: 'k1', name: 'Keeper One', status: 'keep' };
  engine.state.accounts.A.players.k2 = { id: 'k2', name: 'Keeper Two', status: 'keep' };
  await engine.firePlayer('A', 'k1');
  assert.deepEqual(world.users.A.fired, ['k1'], 'only that player');
  assert.deepEqual(ids(world.users.A.bench), ['k2']);
  assert.equal(engine.snapshot().run.accounts.A.players.k1.status, 'fired');
  assert.equal(engine.snapshot().run.accounts.A.players.k2.status, 'keep');
  assert.equal(codes(logs).filter(c => c === 'at2.fired').length, 1);
  await assert.rejects(engine.firePlayer('A', 'nobody'), /not found/);
});

test('List on market: "fire all" fires every player of a side on one connection', async () => {
  const { world, engine, logs } = setup({ M: { funds: 50000, lists: [[]] }, A: { funds: 90000, bench: [player('k1', 60), player('k2', 70), player('k3', 80)], lists: [[]] } }, { accounts: ['M', 'A'] });
  await engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100, benchDecisions: { A: { k1: { action: 'none' }, k2: { action: 'none' }, k3: { action: 'none' } } } });
  await finish(engine);
  engine.state.accounts.A.players.k1 = { id: 'k1', name: 'Keeper One', status: 'keep' };
  engine.state.accounts.A.players.k2 = { id: 'k2', name: 'Keeper Two', status: 'keep' };
  await engine.firePlayers('A', ['k1', 'k2', 'nobody']);
  assert.deepEqual(world.users.A.fired, ['k1', 'k2']);
  assert.deepEqual(ids(world.users.A.bench), ['k3']);
  assert.equal(codes(logs).filter(c => c === 'at2.fired').length, 2);
});

test('the form is remembered as it changes, without starting a run', async () => {
  const { engine } = setup({ M: { funds: 50000, lists: [[]] }, A: { funds: 90000, lists: [[]] } }, { accounts: ['M', 'A'] });
  engine.saveDraft({ accountIds: ['A'], maxPrice: '80', roleRules: { side: { roles: { stock: false }, cheap: false, maxPrice: '' } }, loopMode: 'count', loopCount: '3', roomPassword: 'pw123' });
  const last = engine.snapshot().lastConfig;
  assert.deepEqual(last.accountIds, ['A']);
  assert.equal(last.maxPrice, 80);
  assert.equal(last.roleRules.side.roles.stock, false);
  assert.equal(last.roleRules.side.cheap, false);
  assert.equal(last.loopMode, 'count');
  assert.equal(last.loopCount, 3);
  assert.equal(last.roomPassword, 'pw123');
});

test('accounts below level 10 (trading closed) are left out of a run even when selected', async () => {
  const { engine, logs } = setup({ M: { funds: 50000, lists: [[]] }, A: { funds: 90000, lists: [[]] }, L: { funds: 90000, lists: [[]] } }, { accounts: ['M', 'A', 'L'], levels: { M: 41, A: 12, L: 4 } });
  await engine.start({ accountIds: ['M', 'A', 'L'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 100 });
  const run = await finish(engine);
  assert.deepEqual(run.config.accountIds, ['M', 'A']);
  assert.equal(logs.find(l => l.code === 'at2.lowLevel').params.name, 'L');
  assert.deepEqual((await engine.preflight({ accountIds: ['M', 'A', 'L'] })).accounts.map(r => r.id), ['M', 'A']);
});

// ---------- friends (game update 2026-11-05) ----------
test('friend network: each side gets a Harcayıcı friend, old friends leave its list, main is never touched', async () => {
  const { world, engine } = setup({
    M: { funds: 50000, friends: ['S', 'Z'] }, A: { funds: 9000 }, B: { funds: 9000 }, S: { funds: 9000, friends: ['M', 'Z'] }, Z: { funds: 1, friends: ['M', 'S'] }
  }, { accounts: ['M', 'A', 'B', 'S'], accountRoles: { S: 'spender' }, friends: true });
  const r = await engine.friendNet.sync();
  assert.equal(r.done, 2);
  assert.deepEqual([...world.users.S.friends].sort(), ['A', 'B', 'M']);
  assert.deepEqual([...world.users.M.friends].sort(), ['S', 'Z'], 'main keeps its list');
  assert.ok(!(world.friendOps || []).some(([, from]) => from === 'M'), 'nothing sent from main');
  assert.equal((await engine.friendNet.sync()).skipped, true, 'nothing changed → no second pass');
});

test("friend boards: main signs cards off its friends' boards, a Harcayıcı takes Satılabilir / Stok (also off a side's own Scout)", async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[]], friends: ['F', 'S'] },
    F: { funds: 1, name: 'Friendly', lists: [[player('fc1', 600), player('fs1', 900), player('nobody', 700)]], friends: ['M', 'S'] },
    A: { funds: 90000, lists: [[player('as1', 800)]], friends: ['S'] },
    S: { funds: 5000, friends: ['M', 'F', 'A'] }
  }, { accounts: ['M', 'A', 'S', 'F'], accountRoles: { S: 'spender' }, roles: { fc1: 'card', fs1: 'sellable', as1: 'stok' }, levels: { S: 31 }, friends: true });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  const signs = world.friendSigns || [];
  assert.ok(signs.some(([b, o, pid]) => b === 'M' && o === 'F' && pid === 'fc1'), 'main took the card off F');
  assert.ok(signs.some(([b, o, pid]) => b === 'S' && o === 'F' && pid === 'fs1'), 'the spender took Satılabilir off F');
  assert.ok(signs.some(([b, o, pid]) => b === 'S' && o === 'A' && pid === 'as1'), "the spender took Stok off A's own board");
  assert.ok(!world.users.A.bench.some(p => p.id === 'as1'), 'A did not sign it itself');
  assert.ok(world.users.M.made.includes('fc1'));
  assert.equal(world.users.S.funds, 5000 - 900 - 800);
  assert.ok(!signs.some(([, , pid]) => pid === 'nobody'));
  assert.ok(logs.some(l => l.code === 'at2.spenderSigned') && logs.some(l => l.code === 'at2.friendSigned'));
});

// a Harcayıcı has the player on its bench or (after the turn) on the market
const holds = (u, id) => u.bench.some(p => p.id === id) || (u.listed || []).some(l => l.id === id);

test('a full Harcayıcı lists a bench player at its price first; a refused day falls back to the side', async () => {
  const full = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map(id => player(id, 100));
  const a = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[player('as1', 800)]], friends: ['S'] },
    S: { funds: 5000, bench: full, friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { as1: 'stok' }, levels: { A: 35, S: 31 }, friends: true });
  a.engine.savePricing({ defaults: { sellable: { price: 777777, currency: 'TIX' }, stok: { price: 777777, currency: 'TIX' } } });
  await a.engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  assert.equal((await finish(a.engine)).status, 'done');
  assert.deepEqual(a.world.users.S.listed.map(l => [l.id, l.price]), [['b1', 777777], ['as1', 777777]], 'room made, then what it signed goes to the market too');

  const b = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[player('as1', 800)]], friends: ['S'] },
    S: { funds: 5000, friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { as1: 'stok' }, levels: { A: 35, S: 31 }, friends: true });
  b.world.options.friendLimit = 0;
  await b.engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  assert.equal((await finish(b.engine)).status, 'done');
  assert.ok(b.logs.some(l => l.code === 'at2.friendLimit'));
  assert.ok(b.world.users.A.signed.has('as1'), 'A signed it the old way');
  assert.ok(holds(b.world.users.S, 'as1') && !b.world.users.A.bench.some(p => p.id === 'as1'), 'then traded it to the Harcayıcı');
  assert.equal(b.world.users.S.funds, 5000 - 800, 'the Harcayıcı paid its salary');
});

test("main hands its Satılabilir to a Harcayıcı by trade (Auto Play paused there meanwhile); the side gets nothing", async () => {
  const paused = [];
  const listed = [];
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[player('ms1', 900)]], friends: [] },
    A: { funds: 90000, lists: [[]], friends: ['S'] },
    S: { funds: 5000, bench: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'].map(id => player(id, 100)), friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { ms1: 'sellable' }, friends: true,
    pauseAccount: async id => { paused.push(id); return async () => paused.push(`resume:${id}`); },
    onSpenderListed: e => listed.push([e.accountId, e.player.id, e.price, e.currency]) });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(holds(world.users.S, 'ms1'), 'the Harcayıcı has it');
  assert.ok(!world.users.A.bench.some(p => p.id === 'ms1'));
  assert.equal(world.users.S.funds, 5000 - 900);
  assert.deepEqual(listed, [['S', 'x1', 20, 'APK'], ['S', 'ms1', 20, 'APK']], 'room made, then listed itself at the Satılabilir default (20 APK); both recorded for the price table');
  assert.ok(paused.includes('S') && paused.includes('resume:S'));
  assert.ok(!paused.includes('A') && !paused.includes('M'), 'run accounts are not paused by the engine');
  assert.ok(logs.some(l => l.code === 'at2.toSpender'));
  assert.equal(run.accounts.S.players.ms1.status, 'listed');
});

test('Stok: a Lv30+ Harcayıcı signs it; with none, a Lv30+ side signs it itself and hands it on', async () => {
  const a = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[player('st1', 700)]], friends: ['S', 'T'] },
    S: { funds: 9000, friends: ['A'] }, T: { funds: 3000, friends: ['A'] }
  }, { accounts: ['M', 'A', 'S', 'T'], accountRoles: { S: 'spender', T: 'spender' }, roles: { st1: 'stok' }, levels: { M: 50, A: 35, S: 12, T: 31 }, friends: true });
  await a.engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  assert.equal((await finish(a.engine)).status, 'done');
  assert.ok((a.world.friendSigns || []).some(([b, , pid]) => b === 'T' && pid === 'st1'), 'Lv31 T signed it although S has more TK');

  const b = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[player('st1', 700)]], friends: ['S'] },
    S: { funds: 9000, friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { st1: 'stok' }, levels: { M: 50, A: 35, S: 12 }, friends: true });
  await b.engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  assert.equal((await finish(b.engine)).status, 'done');
  assert.ok(b.world.users.A.signed.has('st1'), 'Lv35 A signed it itself');
  assert.ok(holds(b.world.users.S, 'st1'), 'and traded it to the Harcayıcı');
});

test("the Harcayıcı row of the role table counts: Stok off → it takes only Satılabilir; the side keeps the Stok", async () => {
  const { world, engine } = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[player('as1', 800), player('ss1', 600)]], friends: ['S'] },
    S: { funds: 9000, friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { as1: 'stok', ss1: 'sellable' }, levels: { A: 35 }, friends: true });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100, roleRules: { spender: { roles: { stok: false } } } });
  assert.equal((await finish(engine)).status, 'done');
  assert.ok(holds(world.users.S, 'ss1'), 'Satılabilir went to the Harcayıcı');
  assert.ok(!holds(world.users.S, 'as1'), 'Stok did not');
  assert.ok(world.users.A.bench.some(p => p.id === 'as1'), 'the side signed and kept it');
});

test('a full Harcayıcı lists Stok and Satılabilir at their own price and currency', async () => {
  const bench = [player('k1', 100), player('k2', 100), player('k3', 100), player('k4', 100), player('k5', 100), player('k6', 100)];
  const listed = [];
  const { world, engine } = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[player('n1', 800), player('n2', 700)]], friends: ['S'] },
    S: { funds: 9000, bench, friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { k1: 'stok', k2: 'sellable', n1: 'sellable', n2: 'sellable' }, friends: true, onSpenderListed: e => listed.push([e.player.id, e.price, e.currency]) });
  engine.savePricing({ defaults: { stok: { price: 5000, currency: 'APK' }, sellable: { price: 888888, currency: 'TIX' } } });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  assert.equal((await finish(engine)).status, 'done');
  assert.deepEqual(world.users.S.listed.map(l => [l.id, l.price, l.paymentMode]).map(([id, price]) => [id, price]), [['k1', 5000], ['n1', 888888], ['n2', 888888]], 'k2 is cheap (main-bound): the Satılabilir make the room');
  assert.deepEqual(listed, [['k1', 5000, 'APK'], ['n1', 888888, 'TIX'], ['n2', 888888, 'TIX']]);
});

test('friend network: every side gets N Harcayıcı friends, one of them Lv30+', async () => {
  const { world, engine } = setup({
    M: { funds: 1 }, A: { funds: 1 }, B: { funds: 1 }, S1: { funds: 1 }, S2: { funds: 1 }, S3: { funds: 1 }
  }, { accounts: ['M', 'A', 'B', 'S1', 'S2', 'S3'], accountRoles: { S1: 'spender', S2: 'spender', S3: 'spender' }, levels: { S3: 40 }, friends: true });
  engine.friendNet.perSide = () => 2;
  const r = await engine.friendNet.sync();
  assert.equal(r.done, 4);
  for (const side of ['A', 'B']) {
    const f = [...world.users[side].friends];
    assert.equal(f.length, 2);
    assert.ok(f.includes('S3'), 'the Lv30+ spender is among them');
  }
});

test('start of a run: what earlier runs left on a Harcayıcı bench goes to the market; Kart stays', async () => {
  const { world, engine } = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[]], friends: ['S'] },
    S: { funds: 9000, bench: [player('old1', 900), player('old2', 50)], friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { old1: 'sellable', old2: 'card' }, friends: true });
  engine.savePricing({ defaults: { sellable: { price: 777, currency: 'APK' } } });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  assert.equal((await finish(engine)).status, 'done');
  assert.deepEqual(world.users.S.listed.map(l => [l.id, l.price]), [['old1', 777]]);
  assert.ok(world.users.S.bench.some(p => p.id === 'old2'), 'a Kart player is not listed');
});

test('Stok under Lv30: a Lv30+ account outside the run becomes a friend for one signing, signs, unfriends, trades it to the Harcayıcı', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[player('st1', 700)]], friends: ['S'] },
    S: { funds: 9000, friends: ['A'] },
    H: { funds: 20000, friends: [] }
  }, { accounts: ['M', 'A', 'S', 'H'], accountRoles: { S: 'spender' }, roles: { st1: 'stok' }, levels: { M: 50, A: 12, S: 10, H: 33 }, friends: true });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  assert.equal((await finish(engine)).status, 'done');
  assert.ok(!(world.friendSigns || []).some(([b, , pid]) => b === 'A' && pid === 'st1') && !world.users.A.bench.some(p => p.id === 'st1'), 'Lv12 A did not sign the Stok');
  assert.ok((world.friendSigns || []).some(([b, , pid]) => b === 'H' && pid === 'st1'), 'Lv33 H signed it off A');
  assert.ok(logs.some(l => l.code === 'at2.tempFriend'));
  assert.ok((world.friendOps || []).some(([op, a, b]) => op === 'remove' && a === 'H' && b === 'A'), 'the friendship was removed again');
  assert.ok(holds(world.users.S, 'st1'), 'then H traded it to the Harcayıcı');
});

test('Stok: no Lv30+ account at all → nobody signs it', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[player('st1', 700)]], friends: ['S'] },
    S: { funds: 9000, friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { st1: 'stok' }, levels: { M: 50, A: 12, S: 10 }, friends: true });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  assert.equal((await finish(engine)).status, 'done');
  assert.ok(!world.users.A.signed.has('st1') && !holds(world.users.S, 'st1'));
  assert.ok(logs.some(l => l.code === 'at2.stokSkipped'));
});

test('Otomatik Fiyatlandırma: own price per player, another price when signed 5% off, the default for the rest; saved apart from the run', async () => {
  const listed = [];
  const { world, engine, mem } = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[]], friends: ['S'] },
    S: { funds: 9000, bench: [player('own1', 900), player('disc1', 1000, { signedSalary: 950 }), player('plain1', 800)], friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { own1: 'sellable', disc1: 'sellable', plain1: 'sellable' }, friends: true,
    onSpenderListed: e => listed.push([e.player.id, e.price, e.currency]) });
  engine.savePricing({ defaults: { sellable: { price: 20, currency: 'APK' } }, players: { own1: { price: 300, currency: 'TIX' }, disc1: { price: 500, currency: 'APK', discPrice: 450, discCurrency: 'APK' } } });
  assert.equal(mem.at.pricing.players.own1.price, 300, 'kept in the store');
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  assert.equal((await finish(engine)).status, 'done');
  assert.deepEqual(listed.sort(), [['disc1', 450, 'APK'], ['own1', 300, 'TIX'], ['plain1', 20, 'APK']].sort());
  assert.deepEqual(world.users.S.listed.map(l => l.id).sort(), ['disc1', 'own1', 'plain1']);
});

test('Satılabilir marked "Lv30+ only": a Lv12 Harcayıcı does not sign it, a Lv31 one does; unmarked ones go to the richer Lv12', async () => {
  const { world, engine } = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[player('vip', 900), player('norm', 800)]], friends: ['S', 'T'] },
    S: { funds: 90000, friends: ['A'] }, T: { funds: 3000, friends: ['A'] }
  }, { accounts: ['M', 'A', 'S', 'T'], accountRoles: { S: 'spender', T: 'spender' }, roles: { vip: 'sellable', norm: 'sellable' }, levels: { M: 50, A: 12, S: 12, T: 31 }, friends: true });
  engine.savePricing({ players: { vip: { lv30: true } } });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  assert.equal((await finish(engine)).status, 'done');
  const signs = world.friendSigns || [];
  assert.ok(signs.some(([b, , pid]) => b === 'T' && pid === 'vip'), 'Lv31 T signed the Lv30+ one');
  assert.ok(!signs.some(([b, , pid]) => b === 'S' && pid === 'vip'), 'Lv12 S did not');
  assert.ok(signs.some(([b, , pid]) => b === 'S' && pid === 'norm'), 'the richer S took the unmarked one');
  assert.ok(!world.users.A.bench.some(p => p.id === 'vip'), 'Lv12 A did not sign it itself');
});

test('Otomatik Fiyatlandırma "fire if not 5% off": the full-price copy is fired, a discounted copy is listed', async () => {
  const listed = [];
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[]], friends: ['S'] },
    S: { funds: 9000, bench: [player('junk', 1000), player('good', 1000, { signedSalary: 950 })], friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { junk: 'sellable', good: 'sellable' }, friends: true,
    onSpenderListed: e => listed.push([e.player.id, e.price]) });
  engine.savePricing({ players: { junk: { fireNoDisc: true, price: 99 }, good: { fireNoDisc: true, price: 99 } } });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 100 });
  assert.equal((await finish(engine)).status, 'done');
  assert.ok(!world.users.S.bench.some(p => p.id === 'junk') && !(world.users.S.listed || []).some(l => l.id === 'junk'), 'junk fired, not listed');
  assert.deepEqual(listed, [['good', 99]], 'the discounted one is listed');
  assert.ok(codes(logs).includes('at2.firedNoDisc'));
});

test('full side: each player is listed, fired or held as chosen; held ones stay and are not asked again', async () => {
  const keep = Array.from({ length: 7 }, (_, i) => player(`k${i}`, 1500));
  const { world, engine } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [keep] }
  }, { roles: Object.fromEntries(keep.map(p => [p.id, 'stok'])), accounts: ['M', 'A'], levels: { A: 35 } });
  await engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable', 'stok'], maxPrice: 49 });
  while (engine.snapshot().run.status !== 'awaitingListing') await new Promise(r => setTimeout(r, 5));
  const req = engine.snapshot().run.listingRequest;
  engine.respondListing(req.players.map((p, i) => ({ id: p.id, action: i === 0 ? 'list' : i === 1 ? 'fire' : 'hold', price: 777, currency: 'APK' })));
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.deepEqual(world.users.A.listed.map(l => [l.id, l.price]), [['k0', 777]]);
  assert.ok(!world.users.A.bench.some(p => p.id === 'k1'), 'k1 fired');
  assert.ok(world.users.A.bench.some(p => p.id === 'k2') && run.accounts.A.players.k2.held && run.accounts.A.players.k2.status === 'keep', 'held one stays, still shown under the page');
  assert.ok(world.users.A.signed.has('k6'), 'the 7th was bought in the room made');
});

test('start: a 1-salary player that cannot be traded may be fired or left; nothing else is done with it', async () => {
  const one = player('one', 1, { signedSalary: 1, type: 'XPLAYER' });
  const two = player('two', 1, { signedSalary: 1 });
  const keep = player('keep', 1, { signedSalary: 1 });
  const { world, engine } = setup({ M: { funds: 50000, lists: [[]] }, A: { funds: 90000, bench: [one, two, keep], lists: [[]] } }, { accounts: ['M', 'A'] });
  const pre = await engine.preflight({ accountIds: ['M', 'A'], config: {} });
  const rows = pre.accounts.find(a => a.id === 'A').bench;
  assert.ok(rows.every(r => r.fireOnly), 'all three are fire-only');
  await engine.start({ accountIds: ['M', 'A'], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], maxPrice: 49,
    benchDecisions: { A: { one: { action: 'fire' }, two: { action: 'fire' }, keep: { action: 'none' } } } });
  assert.equal((await finish(engine)).status, 'done');
  assert.deepEqual(world.users.A.bench.map(p => p.id), ['keep']);
});

test("a Satılabilir on the Scout of a Harcayıcı whose turn is still to come is left for it: it signs it itself, no side takes it and trades it back", async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[]], friends: ['S'] },
    S: { funds: 9000, lists: [[player('ss1', 600)]], friends: ['A'] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { ss1: 'sellable' }, friends: true });
  await engine.start({ accountIds: ['M', 'A', 'S'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 100, parallelSides: 1 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(!(world.friendSigns || []).some(([b, , pid]) => b === 'A' && pid === 'ss1'), 'the side (earlier turn) did not take it off S');
  assert.ok(logs.some(l => l.code === 'at2.leftForSpender'));
  assert.ok(holds(world.users.S, 'ss1'), 'the Harcayıcı signed it from its own Scout');
  assert.ok(!world.users.A.bench.some(p => p.id === 'ss1'));
});

test('what a Harcayıcı signs in a side turn is listed right after that turn, not only at the end of the cycle', async () => {
  const { engine, logs } = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    A: { funds: 90000, lists: [[player('ss1', 600)]], friends: ['S'] },
    B: { funds: 80000, lists: [[]], friends: [] },
    S: { funds: 9000, friends: ['A'] }
  }, { accounts: ['M', 'A', 'B', 'S'], accountRoles: { S: 'spender' }, roles: { ss1: 'sellable' }, friends: true });
  await engine.start({ accountIds: ['M', 'A', 'B'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 100, parallelSides: 1 });
  assert.equal((await finish(engine)).status, 'done');
  const listed = logs.findIndex(l => l.code === 'at2.listed');
  const bTurn = logs.findIndex(l => l.code === 'at2.sideTurn' && l.params?.name === 'B');
  assert.ok(logs.some(l => l.code === 'at2.spenderSigned'), 'S signed it off A');
  assert.ok(listed >= 0 && bTurn >= 0 && listed < bTurn, `listed (${listed}) before B's turn (${bTurn})`);
});

test("a stop asked by another task never cuts the spenders' last listing; the user's second Stop does", async () => {
  const { engine } = setup({ M: { funds: 1, lists: [[]] } });
  for (const hard of [false, true]) {
    engine.controller = new AbortController();
    engine.state = { status: 'stopping' };
    engine._save = () => {};
    engine.snapshot = () => null;
    engine.done = Promise.resolve();
    const ctrl = new AbortController();
    engine._leftoverCtrl = ctrl;
    await engine.stop({ hard });
    assert.equal(ctrl.signal.aborted, hard);
  }
});

test('sides run three at a time: every side has exactly one turn, every card reaches main', async () => {
  const sides = ['A', 'B', 'C', 'D', 'E'];
  const users = { M: { funds: 50000, lists: [[]] } };
  sides.forEach((s, i) => { users[s] = { funds: 90000 - i * 1000, lists: [[player(`c${s}1`, 40), player(`c${s}2`, 45)]] }; });
  const { world, engine, logs } = setup(users, { accounts: ['M', ...sides] });
  await engine.start({ accountIds: ['M', ...sides], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, parallelSides: 3 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  const turns = logs.filter(l => l.code === 'at2.sideTurn').map(l => l.params.name);
  assert.deepEqual([...turns].sort(), sides, 'one turn each');
  assert.deepEqual(world.users.M.made.sort(), sides.flatMap(s => [`c${s}1`, `c${s}2`]).sort());
  // the first three started before any of them was done
  const firstDone = logs.findIndex(l => l.code === 'at2.traded');
  assert.ok(logs.slice(0, firstDone).filter(l => l.code === 'at2.sideTurn').length >= 2, 'turns overlap');
  assert.equal(run.activeSides.length, 0);
  assert.ok(engine.snapshot().run.activeSeconds >= 0);
});

test("main's TK at its end: friend boards respect the budget too, the run stops with a notice; on the stop the waiting cheap players go to main or are fired", async () => {
  const { world, engine, logs, attention } = setup({
    M: { funds: 160, lists: [[]], friends: [] },
    F: { funds: 1, name: 'Friendly', lists: [[player('f1', 50), player('f2', 50), player('f3', 50), player('f4', 50)]], friends: ['A'] },
    A: { funds: 90000, lists: [[]], friends: ['F'] }
  }, { accounts: ['M', 'A', 'F'], friends: true });
  // main spends 100 TK elsewhere while the run is stopping: it can pay one of the two left
  const add = engine.activity.add;
  engine.activity = { add: e => { add(e); if (e.code === 'at2.leftovers') world.users.M.funds = 60; } };
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, parallelSides: 1 });
  const run = await finish(engine);
  assert.equal(run.status, 'error');
  assert.equal(run.error.code, 'at2.mainOutOfTk');
  assert.ok(attention.includes('error'));
  const signed = (world.friendSigns || []).filter(([b]) => b === 'A').map(([, , pid]) => pid);
  assert.equal(signed.length, 3, 'f1-f3 fit in 160 TK, f4 is not bought');
  const fired = logs.filter(l => l.code === 'at2.firedNoTk').length;
  assert.equal(world.users.M.made.length + fired, 3, 'each waiting player went to main or was fired');
  assert.ok(fired >= 1 && world.users.M.made.length >= 1);
  assert.equal(world.users.A.bench.length, 0, 'nothing waits on the side');
  const lo = logs.find(l => l.code === 'at2.leftovers');
  assert.ok(lo.params.cheap >= 1 && lo.params.seconds > 0, 'the wrap-up has a time estimate');
});

test('a friend board is read once until its refresh, not by every side again', async () => {
  const { world, engine } = setup({
    M: { funds: 50000, lists: [[]], friends: [] },
    F: { funds: 1, name: 'Friendly', lists: [[player('f1', 40)]], friends: ['A', 'B'] },
    A: { funds: 90000, lists: [[]], friends: ['F'] },
    B: { funds: 80000, lists: [[]], friends: ['F'] }
  }, { accounts: ['M', 'A', 'B', 'F'], friends: true });
  // B's turn comes 11 minutes later: still before the board's 30-minute refresh
  let skew = 0;
  engine.now = () => Date.now() + skew;
  const add = engine.activity.add;
  engine.activity = { add: e => { add(e); if (e.code === 'at2.sideTurn' && e.params?.name === 'B') skew = 11 * 60 * 1000; } };
  await engine.start({ accountIds: ['M', 'A', 'B'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, parallelSides: 1 });
  assert.equal((await finish(engine)).status, 'done');
  assert.equal((world.boardReads || []).filter(([, o]) => o === 'F').length, 1);
  assert.ok(world.users.M.made.includes('f1'));
});

test('Hazırlık does the bench work at once (list, fire, trade / card to main), no Scout; a start within the hour does not ask or list again', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[player('mx', 40)]] },
    A: { funds: 90000, bench: [player('l1', 300), player('t1', 40), player('c1', 900), player('n1', 500)], lists: [[player('ax', 40)]] }
  }, { roles: { l1: 'sellable', t1: 'card' }, accounts: ['M', 'A'] });
  await engine.prepare({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, benchDecisions: { A: { l1: { action: 'list', price: 30, currency: 'APK' }, t1: { action: 'trade' }, c1: { action: 'card' } } } });
  const prepRun = await finish(engine);
  assert.equal(prepRun.status, 'done', JSON.stringify(prepRun.error));
  assert.equal(prepRun.step, 'prepDone');
  assert.equal(engine.snapshot().prep.status, 'done');
  assert.deepEqual(world.users.A.listed.map(l => l.id), ['l1']);
  assert.ok(['t1', 'c1'].every(id => world.users.M.made.includes(id)), 'trade / card players went to main and became cards during the Hazırlık');
  assert.ok(!logs.some(l => ['at2.signed', 'at2.started', 'at2.done'].includes(l.code)), 'no Scout, no run of its own');
  const pre = await engine.preflight({ accountIds: ['M', 'A'] });
  assert.ok(pre.accounts.every(a => a.prepared && !a.bench.length), 'not read again');
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 49, benchDecisions: {} });
  assert.equal((await finish(engine)).status, 'done');
  assert.equal(world.users.A.listed.length, 1, 'not listed twice');
  assert.ok(world.users.A.bench.some(p => p.id === 'n1'), 'an undecided player is left alone');
  assert.equal(engine.snapshot().prep.fresh, false, 'used once');
});

test('pause: the spenders list what they hold, the cheap players waiting on a side are not touched', async () => {
  const { world, engine } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, bench: [player('w1', 50)], lists: [[]] },
    S: { funds: 9000, bench: [player('ss1', 600)], friends: [] }
  }, { accounts: ['M', 'A', 'S'], accountRoles: { S: 'spender' }, roles: { ss1: 'sellable' }, friends: true });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70 });
  await finish(engine);
  // as if the run were paused half way: a cheap player waits on A, S holds a Satılabilir
  engine.state.accounts.A.players.w1 = { id: 'w1', name: 'w1', dir: 'main', status: 'toTrade', salary: 50 };
  engine._spenderTodo.add('S');
  await engine._wrapUp('pause');
  assert.deepEqual(world.users.S.listed.map(l => l.id), ['ss1'], 'listed while paused');
  assert.ok(world.users.A.bench.some(p => p.id === 'w1') && !world.users.M.made.includes('w1'), 'the cheap player stays');
  assert.equal(engine.state.wrapUp, null);
});

test('5 at a time: a side trades with main as soon as it holds 5 for main, before it signs the 6th', async () => {
  const six = [1, 2, 3, 4, 5, 6].map(i => player('k' + i, 40 + i));
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [six] }
  }, { accounts: ['M', 'A'] });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, parallelSides: 1 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  const seq = logs.filter(l => ['at2.signed', 'at2.traded'].includes(l.code) && l.accountId === 'A').map(l => l.code === 'at2.traded' ? 'T' + l.params.take : 's');
  assert.deepEqual(seq, ['s', 's', 's', 's', 's', 'T5', 's', 'T1']);
  assert.deepEqual(world.users.M.made.sort(), six.map(p => p.id).sort());
});

test('another task stopping a paused run: it comes back paused; a run the user stopped meanwhile is not continued; a task stop only lists', async () => {
  const { engine } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [[player('p1', 40)]] }
  }, { accounts: ['M', 'A'] });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, parallelSides: 1 });
  engine.pause();
  const kinds = [];
  const wrap = engine._wrapUpNow.bind(engine);
  engine._wrapUpNow = kind => { kinds.push(kind); return wrap(kind); };
  await engine.stop({ hard: false });
  assert.equal(engine.state.status, 'stopped');
  assert.ok(kinds.includes('task') && !kinds.includes('stop'), 'a task stop does not settle the cheap players');
  engine.resumeAfterTask({ paused: true });
  assert.equal(engine.snapshot().run.status, 'paused', 'paused again, not running');
  await engine.stop();
  assert.equal(engine.state.stoppedBy, 'user');
  engine.resumeAfterTask({ paused: false });
  assert.equal(engine.snapshot().run.status, 'stopped', "the user's stop is final");
});

test('Hazırlık with decisions on main too: main is done first and stays open while the sides trade with it', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, bench: [player('mc', 900)], lists: [[]] },
    A: { funds: 90000, bench: [player('t1', 40)], lists: [[]] },
    B: { funds: 90000, bench: [player('t2', 40)], lists: [[]] }
  }, { roles: { t1: 'card', t2: 'card' }, accounts: ['M', 'A', 'B'] });
  await engine.prepare({ accountIds: ['M', 'A', 'B'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, parallelSides: 2, benchDecisions: { M: { mc: { action: 'card' } }, A: { t1: { action: 'trade' } }, B: { t2: { action: 'trade' } } } });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(['mc', 't1', 't2'].every(id => world.users.M.made.includes(id)), JSON.stringify(world.users.M.made));
  assert.ok(!logs.some(l => l.code === 'at2.traded' && l.accountId === 'M'), 'main does not trade with itself');
});

test('only Satılabilir / Stok: Kart and cheap players are left on Scout, Satılabilir is signed', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [[player('k1', 900), player('c1', 40), player('s1', 500)]] }
  }, { roles: { k1: 'card', s1: 'sellable' }, accounts: ['M', 'A'] });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, sideOnly: true });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  const signed = logs.filter(l => l.code === 'at2.signed').map(l => l.params.player);
  assert.deepEqual(signed.length, 1, JSON.stringify(signed));
  assert.ok(!world.users.M.made.length, 'nothing turned into cards');
});

test('Make on main waits while Synthesis / Activate runs on main, then converts', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [[player('k1', 40)]] }
  }, { roles: {}, accounts: ['M', 'A'] });
  let asked = 0;
  engine.cardBusy = () => ++asked < 4; // busy for the first checks, then free
  engine.timing.cardWaitMs = 5;
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(logs.some(l => l.code === 'at2.waitCards'));
  assert.ok(world.users.M.made.includes('k1'));
});

test('a trade the game does not confirm but that went through counts as done: the players are made cards', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [[player('k1', 40), player('k2', 41)]] }
  }, { accounts: ['M', 'A'] });
  const orig = engine._executeTrade.bind(engine);
  let first = true;
  engine._executeTrade = async (...a) => { const r = await orig(...a); if (first && r.success) { first = false; return { success: false, message: 'No tradeResult from the game.' }; } return r; };
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, parallelSides: 1 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(logs.some(l => l.code === 'at2.tradeLanded'));
  assert.deepEqual(world.users.M.made.sort(), ['k1', 'k2']);
});

test('Stop: Satılabilir a side still holds is listed by the side when no spender takes it', async () => {
  const { world, engine } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [[player('s1', 500)]] }
  }, { roles: { s1: 'sellable' }, accounts: ['M', 'A'] });
  let release;
  const hold = new Promise(r => { release = r; });
  const orig = engine._mainTurn.bind(engine);
  engine._mainTurn = async signal => { await hold; return orig(signal); };
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, parallelSides: 1 });
  await new Promise(r => setTimeout(r, 20));
  // the side signed s1 and keeps it (no spender in this run)
  const acc = engine._ensureAcc('A');
  acc.players.s1 = { ...engine._row(player('s1', 500), engine.state.config, engine._roleMap(), engine._roleNames(), {}), dir: 'side', status: 'keep' };
  world.users.A.bench.push(player('s1', 500));
  const stopping = engine.stop();
  release();
  await stopping;
  assert.deepEqual(world.users.A.listed.map(l => l.id), ['s1']);
});

test('only Satılabilir / Stok: main has its own turn and closes; the sides never open it, each hands to a spender of its own, which lists at once', async () => {
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [[player('a1', 500), player('a2', 510)]] },
    B: { funds: 90000, lists: [[player('b1', 520), player('b2', 530)]] },
    S: { funds: 90000, lists: [[]] },
    T: { funds: 90000, lists: [[]] }
  }, { accounts: ['M', 'A', 'B', 'S', 'T'], accountRoles: { S: 'spender', T: 'spender' }, roles: { a1: 'sellable', a2: 'sellable', b1: 'sellable', b2: 'sellable' } });
  // the spenders are not sides of this run
  await engine.start({ accountIds: ['M', 'A', 'B'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, sideOnly: true });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  const opened = logs.filter(l => l.code === 'at2.opened' || l.code === 'at2.sideTurn').map(l => (l.code === 'at2.sideTurn' ? 'turn:' : '') + l.accountId);
  assert.equal(opened.filter(x => x === 'M').length, 1, 'main opened once, for its own turn');
  assert.ok(opened.indexOf('M') < opened.findIndex(x => x.startsWith('turn:')), 'main before the sides');
  assert.ok(logs.some(l => l.code === 'at2.mainTurn'));
  const traded = logs.filter(l => l.code === 'at2.spenderTraded').map(l => [l.params.from, l.params.name]);
  assert.equal(traded.length, 2, JSON.stringify(traded));
  assert.notEqual(traded[0][1], traded[1][1], 'two sides, two different spenders');
  const listed = [...world.users.S.listed, ...world.users.T.listed].map(l => l.id).sort();
  assert.deepEqual(listed, ['a1', 'a2', 'b1', 'b2']);
  assert.equal(engine._parallel(), 10);
});

test('Stop: a step that never hears the stop is cut after the grace time (connections closed)', async () => {
  const { engine, logs } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [[player('p1', 40)]] }
  }, { accounts: ['M', 'A'] });
  // a step stuck on something that ignores the signal, ended only when the connections close
  let unblock;
  const stuck = new Promise(r => { unblock = r; });
  engine._mainTurn = async () => { await stuck; throw new Error('Game socket disconnected.'); };
  const closeAll = engine._closeAll.bind(engine);
  engine._closeAll = () => { unblock(); return closeAll(); };
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70 });
  await new Promise(r => setTimeout(r, 20));
  const t0 = Date.now();
  await engine.stop();
  assert.ok(Date.now() - t0 < 15000);
  assert.ok(logs.some(l => l.code === 'at2.stopForced'));
  assert.ok(!engine.controller);
});

test('Stop: a step that never ends even with its connections closed is cut loose; the run is stopped and its late end changes nothing', async () => {
  const { engine, logs } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [[player('p1', 40)]] }
  }, { accounts: ['M', 'A'] });
  let release;
  const never = new Promise(r => { release = r; });
  engine._mainTurn = async () => { await never; };
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70 });
  await new Promise(r => setTimeout(r, 20));
  const t0 = Date.now();
  await engine.stop();
  assert.ok(Date.now() - t0 < 20000);
  assert.equal(engine.state.status, 'stopped');
  assert.ok(!engine.controller);
  assert.ok(logs.some(l => l.code === 'at2.stopDetached'));
  // the old run ends late: it must not turn the stopped run into 'done'
  release();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(engine.state.status, 'stopped');
});

test('secret players: the price names the player (signed for its role); a price that names nobody is signed and fired when it is of no use', async () => {
  const known = { ...player('keegan', 1690, { name: 'Keegan Murray' }), secret: true };
  const unknown = { ...player('nobody', 777, { name: 'Random Guy' }), secret: true };
  const { world, engine, logs } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [[known, unknown]] }
  }, { roles: { keegan: 'card' }, accounts: ['M', 'A'], playersData: { players: [{ id: 'keegan', name: 'Keegan Murray', value: 1690, base: 1200, rating: 'S' }] } });
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable'], sideToMainRoleIds: ['card'], maxPrice: 70, parallelSides: 1 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(logs.some(l => l.code === 'at2.secretSigned' && l.params.player === 'Keegan Murray'), JSON.stringify(logs.map(l => l.code)));
  assert.ok(world.users.M.made.includes('keegan'), 'the Kart secret went to main and became a card');
  assert.ok(logs.some(l => l.code === 'at2.secretFired' && l.params.player === 'Random Guy'));
  assert.ok((world.users.A.fired || []).includes('nobody'));
});

test('secret players: a Stok secret is signed by a level 15 account too (the secret cut comes on any level)', async () => {
  const stokSecret = { ...player('jj', 1510, { name: 'Jaren Jackson Jr.' }), secret: true };
  const { engine, logs } = setup({
    M: { funds: 50000, lists: [[]] },
    A: { funds: 90000, lists: [[stokSecret]] }
  }, { roles: { jj: 'stok' }, levels: { A: 15 }, accounts: ['M', 'A'], playersData: { players: [{ id: 'jj', name: 'Jaren Jackson Jr.', value: 1510, base: 1100, rating: 'S-' }] } });
  assert.equal(engine._needsLv30({ id: 'jj', secret: true }), false);
  await engine.start({ accountIds: ['M', 'A'], mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'], maxPrice: 70, parallelSides: 1 });
  const run = await finish(engine);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(logs.some(l => l.code === 'at2.secretSigned' && l.accountId === 'A'), JSON.stringify(logs.map(l => l.code)));
});
