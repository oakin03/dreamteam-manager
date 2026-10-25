const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ActivityService, trDay } = require('../src/main/services/activity.cjs');

test('entries go to a daily archive that can be read back and searched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-logs-'));
  let items = [];
  const store = { getSettings: () => ({ maxActivityEntries: 2 }), getActivity: () => items, saveActivity: v => { items = v; } };
  const a = new ActivityService(store, () => {}, { logDir: dir });
  a.add({ level: 'info', message: 'first', taskName: 'Auto Buy' });
  a.add({ level: 'error', message: 'Game socket could not connect', taskName: 'Auto Buy' });
  a.add({ level: 'success', message: 'third', accountName: 'Trophy3' });
  assert.equal(items.length, 2, 'the page keeps only the latest');
  const day = trDay();
  assert.deepEqual(a.days(), [day]);
  assert.deepEqual(a.readDay(day).map(e => e.message), ['third', 'Game socket could not connect', 'first'], 'the archive keeps all, newest first');
  assert.deepEqual(a.search('socket').map(e => e.level), ['error']);
  fs.rmSync(dir, { recursive: true, force: true });
});
