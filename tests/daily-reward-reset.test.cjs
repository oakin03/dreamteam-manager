const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { AppStore } = require('../src/main/services/store.cjs');
const { DailyRewardService, nextDailyResetAt, waitMsOf, rewardText, retryAfterMs } = require('../src/main/services/daily-reward-service.cjs');

// A fake game socket: answers dailyRewards:* from a small tier model.
function fakeGame({ tier = 1, ready = true, waitMs = 600000, claimReply = null } = {}) {
  const game = { tier, ready, emits: [], claims: 0 };
  game.createSocket = () => {
    const socket = new EventEmitter();
    socket.connected = true;
    socket.close = () => {};
    socket.emit = (event, payload) => {
      if (['connect', 'dailyRewards:progressResult', 'dailyRewards:claimResult'].includes(event)) return EventEmitter.prototype.emit.call(socket, event, payload);
      game.emits.push({ event, payload });
      setImmediate(() => {
        if (event === 'dailyRewards:getProgress') {
          const done = game.tier > 6;
          EventEmitter.prototype.emit.call(socket, 'dailyRewards:progressResult', { success: true, data: {
            currentTier: Math.min(game.tier, 6), isComplete: done, isReadyToClaim: !done && game.ready,
            timeUntilClaim: game.ready ? 0 : waitMs, totalTiers: 6, nextClaimTime: game.ready ? null : new Date(Date.now() + waitMs).toISOString()
          } });
        } else if (event === 'dailyRewards:claim') {
          game.claims++;
          let reply = claimReply;
          if (!reply) {
            const claimed = game.tier;
            game.tier++;
            game.ready = false;
            reply = { success: true, data: { currentTier: claimed, isComplete: claimed >= 6, rewards: [{ type: 'ITEM', amount: 2, item: { name: 'Energy Drink' } }] } };
          }
          EventEmitter.prototype.emit.call(socket, 'dailyRewards:claimResult', reply);
        }
      });
      return true;
    };
    setImmediate(() => EventEmitter.prototype.emit.call(socket, 'connect'));
    return socket;
  };
  return game;
}

function fixture(t, game) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-reward-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new AppStore(dir);
  store.saveAccounts([{ id: 'main', name: 'Main' }]);
  const events = [];
  const service = (savedStore = store) => new DailyRewardService({
    store: savedStore,
    activity: { add: e => events.push(e) },
    engine: { states: () => ({}) },
    sessions: { get: async () => ({ userId: 'u1', cookieHeader: 'c=1' }), invalidate: () => {} },
    createSocket: game?.createSocket,
    onChanged: () => {}
  });
  return { dir, store, service, events, account: store.getAccounts()[0] };
}

test('Reset is 19:00 Türkiye time, including a new day after the boundary', () => {
  assert.equal(new Date(nextDailyResetAt(Date.parse('2026-05-01T15:59:00Z'))).toISOString(), '2026-05-01T16:00:10.000Z');
  assert.equal(new Date(nextDailyResetAt(Date.parse('2026-05-01T16:00:20Z'))).toISOString(), '2026-05-02T16:00:10.000Z');
});

test('Progress, rewards and refusals are read from the socket replies', () => {
  assert.equal(waitMsOf({ isReadyToClaim: true }), 0);
  assert.equal(waitMsOf({ nextClaimTime: '2026-01-01T00:10:00Z' }, Date.parse('2026-01-01T00:00:00Z')), 600000);
  assert.equal(waitMsOf({ timeUntilClaim: 5000 }), 5000);
  assert.equal(waitMsOf({}), null);
  assert.equal(rewardText([{ type: 'XP', amount: 500 }, { type: 'ITEM', amount: 2, item: { name: 'Energy Drink' } }]), '500 XP, 2 Energy Drink');
  assert.equal(retryAfterMs({ error: 'Please wait 12 seconds' }), 12000);
  assert.equal(retryAfterMs({ error: 'Rate limit', retryAfter: 30 }), 30000);
});

test('A ready tier is claimed over the socket, then the next timer is waited', async t => {
  const game = fakeGame({ tier: 3, ready: true, waitMs: 1200000 });
  const { service, events, account } = fixture(t, game);
  const svc = service();
  const result = await svc.checkOrClaim(account, new AbortController().signal);
  assert.equal(game.claims, 1);
  assert.deepEqual(game.emits.find(e => e.event === 'dailyRewards:claim').payload, { userId: 'u1' });
  assert.ok(result.delayMs > 1200000 - 5000 && result.delayMs < 1200000 + 5000);
  assert.equal(svc.snapshot().main.status, 'waiting');
  assert.ok(events.some(e => e.code === 'dw.claimed' && e.params.tier === 3 && e.params.rewards === '2 Energy Drink'));
  assert.ok(!game.emits.some(e => e.event === 'register'), 'never registers, nothing is kicked');
});

test('Sixth claim holds the account until the reset and survives a restart', async t => {
  const game = fakeGame({ tier: 6, ready: true });
  const { service, store, dir, events, account } = fixture(t, game);
  const result = await service().checkOrClaim(account, new AbortController().signal);
  assert.ok(result.delayMs > 1000);
  assert.ok(events.some(e => e.code === 'dw.completed'));
  const saved = store.getDailyRewards().accounts.main;
  assert.equal(saved.reason, 'completed');
  const restarted = service(new AppStore(dir));
  assert.equal(restarted.snapshot().main.status, 'completed');
});

test('A refused claim waits as long as the server asks', async t => {
  const game = fakeGame({ tier: 2, ready: true, claimReply: { success: false, error: 'Please wait 20 seconds before claiming' } });
  const { service, events, account } = fixture(t, game);
  const result = await service().checkOrClaim(account, new AbortController().signal);
  assert.equal(result.delayMs, 21500);
  assert.ok(events.some(e => e.code === 'dw.refused'));
});

test('An already complete day only waits for the reset', async t => {
  const game = fakeGame({ tier: 7 });
  const { service, account } = fixture(t, game);
  const svc = service();
  await svc.checkOrClaim(account, new AbortController().signal);
  assert.equal(game.claims, 0);
  assert.equal(svc.snapshot().main.status, 'completed');
});
