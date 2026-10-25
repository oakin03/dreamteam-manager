const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameHealth, isNetError } = require('../src/main/services/game-health.cjs');

function sockets(failFirst) {
  let opened = 0;
  const createSocket = () => {
    const s = new EventEmitter();
    s.off = s.removeListener; s.close = () => {};
    const local = EventEmitter.prototype.emit.bind(s);
    s.emit = event => { if (event === 'getServerTime') setTimeout(() => local('serverTime', {}), 1); return true; };
    opened++;
    setTimeout(() => (opened <= failFirst ? local('connect_error', new Error('websocket error')) : local('connect')), 1);
    return s;
  };
  return { createSocket, opened: () => opened };
}

test('one report starts one probe loop; waiters continue when a probe gets through', async () => {
  const net = sockets(1);
  const logs = [];
  const h = new GameHealth({ activity: { add: e => logs.push(e) }, createSocket: net.createSocket, probeMs: 20 });
  assert.equal(isNetError(new Error('Game socket could not connect: websocket error')), true);
  assert.equal(isNetError(new Error('Your team is over the salary cap.')), false);
  h.reportDown('Auto Play · A', new Error('websocket error'));
  h.reportDown('Auto Play · B', new Error('websocket error'));
  assert.equal(logs.filter(l => l.code === 'gh.down').length, 1, 'reported once');
  const t0 = Date.now();
  await Promise.all([h.waitUp(), h.waitUp()]);
  assert.ok(Date.now() - t0 >= 30, 'waited for the second probe');
  assert.equal(net.opened(), 2, 'one connection per probe, not one per waiter');
  assert.equal(h.isDown(), false);
  assert.ok(logs.some(l => l.code === 'gh.up'));
  await h.waitUp(); // up: resolves at once
  h.shutdown();
});
