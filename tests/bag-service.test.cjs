const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BagService, daysOf, remainingMs } = require('../src/main/services/bag-service.cjs');

const NOW = Date.parse('2026-11-11T12:00:00Z');
function fake({ registeredOnly = true, push = null } = {}) {
  const st = { inv: { 'u-a': [{ id: 'inv1', itemId: 'x1', quantity: 2, item: { id: 'x1', name: 'X2 EXP(1DAY)', type: 'PROPS' } }, { id: 'inv9', itemId: 'z', quantity: 5, item: { id: 'z', name: 'Water Bottle (Small)' } }] }, used: [] };
  const createSocket = (_u, options) => {
    const s = new EventEmitter(); s.off = s.removeListener; s.close = () => {}; s.connected = true;
    const local = EventEmitter.prototype.emit.bind(s);
    let registered = false;
    s.emit = (event, p) => {
      if (event === 'getUserInventory') setTimeout(() => local('userInventoryData', st.inv[p.userId] || []), 1);
      if (event === 'register') { registered = true; setTimeout(() => local('registrationSuccess', {}), 1); }
      if (event === 'useInventoryItem') {
        if (registeredOnly && !registered) return setTimeout(() => local('useInventoryItemResult', { success: false, message: 'User ID is required' }), 1);
        const it = st.inv[p.userId].find(x => x.id === p.inventoryId);
        it.quantity -= 1; st.used.push(p);
        setTimeout(() => { local('useInventoryItemResult', { success: true, message: 'X2 EXP activated' }); if (push) local('xpBoostStatus', push); }, 1);
      }
      return true;
    };
    setTimeout(() => local('connect'), 1);
    return s;
  };
  return { st, createSocket };
}
function service(f) {
  let settings = {};
  const logs = [];
  const store = { getAccounts: () => [{ id: 'a', name: 'Trophy' }], getAccountProfile: () => ({ accounts: { a: { userId: 'u-a' } } }), getSettings: () => settings, saveSettings: v => { settings = v; } };
  const svc = new BagService({ store, activity: { add: e => logs.push(e) }, sessions: { get: async () => ({ userId: 'u-a', cookieHeader: 'c' }) }, createSocket: f.createSocket, now: () => NOW });
  return { svc, logs };
}

test('bag: X2 EXP counts only; days from the name; remainingTime in s or ms', async () => {
  const f = fake();
  const { svc } = service(f);
  await svc.read();
  assert.deepEqual(svc.snapshot().bags.a.items.map(i => [i.name, i.quantity, i.days]), [['X2 EXP(1DAY)', 2, 1]]);
  assert.equal(daysOf('7DAYS X2 EXP'), 7);
  assert.equal(remainingMs(3600), 3600000);
  assert.equal(remainingMs(3600000), 3600000);
});

test('bag: Use signs in when the game asks, uses one, keeps the end time (from the game push or the item days)', async () => {
  const f = fake({ push: { success: true, hasBoost: true, boostData: { multiplier: 2, remainingTime: 86000 } } });
  const { svc, logs } = service(f);
  const r = await svc.use(['a']);
  assert.equal(r.results.a.ok, true, JSON.stringify(r.results));
  assert.equal(f.st.used.length, 1);
  assert.deepEqual(f.st.used[0], { userId: 'u-a', inventoryId: 'inv1', itemId: 'x1' });
  assert.equal(svc.snapshot().bags.a.items[0].quantity, 1);
  const b = svc.snapshot().boosts.a;
  assert.equal(b.multiplier, 2);
  assert.equal(Date.parse(b.endsAt) - NOW, 86000 * 1000);
  assert.ok(logs.some(l => l.code === 'bg.used'));
});
