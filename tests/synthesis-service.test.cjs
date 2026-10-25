const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SynthesisService } = require('../src/main/services/synthesis-service.cjs');

// Fake star card inventory. `failNext` makes the next L2+ synthesis fail (one card back).
function fakeGame({ cards, failNext = 0, failAsSuccess = false, lieLevel = false }) {
  const calls = [];
  const st = { cards: cards.map(c => ({ ...c })), seq: 0, failNext, randomPool: ['Dylan Harper', 'Lonzo Ball'] };
  const row = c => ({ id: c.inv, itemId: 'it-' + c.pid + '-' + c.level, quantity: c.qty, item: { id: 'it-' + c.pid + '-' + c.level, level: c.level, linkedPlayerId: c.pid, linkedPlayer: { id: c.pid, name: c.name, rating: c.x ? 'X' : 'B', type: c.x ? 'XPLAYER' : 'CURRENT', starCardTeamAssignment: c.team ? [{ teamId: 1 }] : [] } } });
  const add = (pid, name, level, team) => {
    const have = st.cards.find(c => c.pid === pid && c.level === level);
    if (have) have.qty += 1; else st.cards.push({ inv: 'inv' + (++st.seq), pid, name, level, qty: 1, team });
  };
  const createSocket = () => {
    const s = new EventEmitter();
    s.off = s.removeListener; s.close = () => {};
    const local = EventEmitter.prototype.emit.bind(s);
    const reply = (e, d) => setTimeout(() => local(e, d), 1);
    s.emit = (event, p) => {
      calls.push({ event, payload: p });
      if (event === 'starcard:getUserStarCards') return reply('starcard:userStarCards', { inventory: st.cards.filter(c => c.qty > 0).map(row) });
      if (event === 'starcard:synthesize') {
        if (st.limitOnce) { st.limitOnce = false; return reply('starcard:error', { message: 'Too many requests. Try again in 1 seconds.' }); }
        const sel = p.selectedCards;
        for (const c of sel) st.cards.find(x => x.inv === c.inventoryId).qty -= 1;
        const used = sel.map(c => st.cards.find(x => x.inv === c.inventoryId));
        const level = sel[0].level;
        const same = new Set(sel.map(c => c.linkedPlayerId)).size === 1;
        if (level >= 2 && st.failNext > 0) {
          st.failNext--;
          const back = used[0];
          add(back.pid, back.name, level, back.team);
          // The real game (2026-10-23) also reports a failure as synthesisSuccess, with the card back at the same level.
          if (failAsSuccess) return reply('starcard:synthesisSuccess', { message: 'ok', resultCard: { playerId: back.pid, playerName: back.name, level: lieLevel ? level + 1 : level, combinationType: 'fourSame' } });
          return reply('starcard:synthesisFailed', { message: `Synthesis failed! You got back ${back.name}.` });
        }
        const name = same ? used[0].name : st.randomPool[st.seq % 2];
        const pid = same ? used[0].pid : 'r-' + name;
        add(pid, name, level + 1, same ? used[0].team : false);
        return reply('starcard:synthesisSuccess', { message: 'ok', resultCard: { playerId: pid, playerName: name, level: level + 1, combinationType: same ? 'fourSame' : 'allDifferent' } });
      }
      return true;
    };
    setTimeout(() => local('connect'), 1);
    return s;
  };
  return { createSocket, calls, st };
}

function service(game) {
  const logs = []; let data = null; let rescans = 0;
  const store = {
    getAccounts: () => [{ id: 'm', name: 'Yozgt66ers' }], getAccountProfile: () => ({ mainAccountId: 'm' }),
    getSynthesisData: () => data, saveSynthesisData: v => { data = JSON.parse(JSON.stringify(v)); }
  };
  const svc = new SynthesisService({ store, activity: { add: e => logs.push(e) }, onChanged() {}, onDone: async () => { rescans++; }, sessions: { get: async () => ({ userId: 'u', cookieHeader: 'c' }) }, createSocket: game.createSocket, timing: { gapMs: 1 } });
  return { svc, logs, data: () => data, rescans: () => rescans };
}

test('team mode: every group of 4 of the same player, level by level, X players untouched, then a rescan', async () => {
  const game = fakeGame({ cards: [
    { inv: 'a', pid: 'p1', name: 'Jaron Pierre Jr.', level: 1, qty: 9, team: true },
    { inv: 'b', pid: 'p2', name: 'Aaron Wiggins', level: 1, qty: 3, team: true },
    { inv: 'c', pid: 'p3', name: 'X Doncic', level: 1, qty: 8, team: true, x: true },
    { inv: 'd', pid: 'p4', name: 'Nobody', level: 1, qty: 8, team: false },
    { inv: 'e', pid: 'p5', name: 'Embiid', level: 2, qty: 2, team: true }
  ] });
  const { svc, data, rescans } = service(game);
  svc.start({ mode: 'team', levels: [1, 2, 3, 4] });
  await svc.done;
  const synth = game.calls.filter(c => c.event === 'starcard:synthesize');
  assert.equal(synth.length, 2, '9 Jaron cards → 2 syntheses; Aaron (3), X, No Team untouched');
  assert.ok(synth.every(c => new Set(c.payload.selectedCards.map(s => s.inventoryId)).size === 1 && c.payload.selectedCards.length === 4));
  const run = svc.snapshot().run;
  assert.deepEqual([run.counts[1].ok, run.counts[1].fail], [2, 0]);
  assert.deepEqual(run.obtained.map(o => [o.name, o.level, o.count]), [['Jaron Pierre Jr.', 2, 2]]);
  assert.equal(run.status, 'done');
  assert.equal(rescans(), 1);
  assert.deepEqual(data().summary.m.team.counts[1], { ok: 2, fail: 0 });
});

test('No Team mode: quantity then name order, 4 different players, results reused at the next level, a failure counted', async () => {
  const cards = [
    { inv: 'z', pid: 'z', name: 'Zed', level: 1, qty: 10 },
    ...['Eve', 'Bob', 'Dan', 'Cal'].map((n, i) => ({ inv: 'q' + i, pid: 'q' + i, name: n, level: 1, qty: 9 })),
    ...['K', 'L', 'M'].map((n, i) => ({ inv: 'l2' + i, pid: 'l2' + i, name: n, level: 2, qty: 1 })),
    { inv: 't', pid: 't', name: 'Team guy', level: 1, qty: 40, team: true }
  ];
  const game = fakeGame({ cards, failNext: 1 });
  const { svc } = service(game);
  svc.start({ mode: 'noTeam', levels: [1, 2] });
  await svc.done;
  const first = game.calls.find(c => c.event === 'starcard:synthesize').payload.selectedCards.map(c => c.linkedPlayerId);
  assert.deepEqual(first, ['z', 'q1', 'q3', 'q2'], 'Zed (10) then Bob, Cal, Dan (9, alphabetical)');
  const run = svc.snapshot().run;
  assert.ok(run.counts[1].ok >= 1);
  assert.equal(run.counts[2].fail, 1, 'the L2 failure is counted');
  assert.ok(!game.calls.some(c => c.event === 'starcard:synthesize' && c.payload.selectedCards.some(s => s.linkedPlayerId === 't')), 'team players never used in No Team mode');
  const fail = run.history.find(h => !h.ok);
  assert.ok(fail.result?.returned, 'the returned card is recognised from the message');
});

test('only the ticked levels are tried', async () => {
  const game = fakeGame({ cards: [{ inv: 'a', pid: 'p1', name: 'A', level: 1, qty: 4, team: true }, { inv: 'b', pid: 'p2', name: 'B', level: 2, qty: 4, team: true }] });
  const { svc } = service(game);
  svc.start({ mode: 'team', levels: [2] });
  await svc.done;
  const synth = game.calls.filter(c => c.event === 'starcard:synthesize');
  assert.deepEqual(synth.map(c => c.payload.selectedCards[0].level), [2]);
});

test('"Too many requests. Try again in N seconds" is waited out and the same synthesis is sent again', async () => {
  const game = fakeGame({ cards: [{ inv: 'a', pid: 'p1', name: 'A', level: 1, qty: 4, team: true }] });
  game.st.limitOnce = true;
  const { svc, logs } = service(game);
  const t0 = Date.now();
  svc.start({ mode: 'team', levels: [1] });
  await svc.done;
  assert.ok(Date.now() - t0 >= 1000, 'waited the asked seconds');
  assert.equal(game.calls.filter(c => c.event === 'starcard:synthesize').length, 2);
  assert.equal(svc.snapshot().run.status, 'done');
  assert.equal(svc.snapshot().run.counts[1].ok, 1);
  assert.ok(logs.some(l => l.code === 'sy.wait' && l.params.seconds === 1));
});

test('a failure reported as synthesisSuccess (card back at the same level) is counted as failed; an empty run keeps the summary', async () => {
  const game = fakeGame({ cards: [{ inv: 'c', pid: 'c', name: 'Colin Castleton', level: 2, qty: 4, team: true }], failNext: 1, failAsSuccess: true });
  const { svc, logs, data } = service(game);
  svc.start({ mode: 'team', levels: [2] });
  await svc.done;
  const run = svc.snapshot().run;
  assert.deepEqual(run.counts[2], { ok: 0, fail: 1 });
  assert.ok(logs.some(l => l.code === 'sy.fail'));
  assert.ok(!logs.some(l => l.code === 'sy.ok'));
  assert.equal(run.history[0].result.returned, true);
  assert.equal(run.history[0].result.name, 'Colin Castleton');
  assert.deepEqual(data().summary.m.team.counts[2], { ok: 0, fail: 1 });
  // Nothing left to synthesize: the last real run stays in the summary.
  svc.start({ mode: 'team', levels: [2] });
  await svc.done;
  assert.deepEqual(data().summary.m.team.counts[2], { ok: 0, fail: 1 });
});

test('the inventory decides: a "success" that made no card one level up is a failure', async () => {
  const game = fakeGame({ cards: [{ inv: 'j', pid: 'j', name: 'Jamal Shead', level: 2, qty: 8, team: true }], failNext: 1, failAsSuccess: true, lieLevel: true });
  const { svc, logs } = service(game);
  svc.start({ mode: 'team', levels: [2] });
  await svc.done;
  const run = svc.snapshot().run;
  assert.deepEqual(run.counts[2], { ok: 1, fail: 1 }, 'first (lying) one failed, the second really made a 3★');
  assert.ok(logs.some(l => l.code === 'sy.fail' && l.params.byInventory === true));
});
