const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AppStore } = require('../src/main/services/store.cjs');
const { ActivityService } = require('../src/main/services/activity.cjs');

test('activity entries are visible at once and written to disk in one batch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-store-'));
  const store = new AppStore(dir);
  const activity = new ActivityService(store, () => {});
  const file = path.join(dir, 'activity.json');
  const writes = [];
  const realRename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === file) writes.push(Date.now()); return realRename(from, to); };
  try {
    const before = store.revision('activity');
    for (let i = 0; i < 50; i++) activity.add({ message: `m${i}`, code: 'x.test', params: { i } });
    assert.equal(store.getActivity().length, 50, 'in memory immediately');
    assert.equal(store.revision('activity'), before + 50, 'the page sees every change');
    assert.equal(writes.length, 0, 'nothing written yet');
    await new Promise(r => setTimeout(r, 600));
    assert.equal(writes.length, 1, 'one batched write');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 50);
    activity.add({ message: 'last' });
    store.flush();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].message, 'last', 'flush writes pending entries');
    assert.deepEqual(store.getActivity()[1].params, { i: 49 });
  } finally {
    fs.renameSync = realRename;
    store.flush();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
