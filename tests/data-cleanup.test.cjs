const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DataCleanup, normDays } = require('../src/main/services/data-cleanup.cjs');

const DAY = 24 * 60 * 60 * 1000;
function put(file, bytes = 1000) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes)); }

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-cleanup-'));
  const data = path.join(root, 'DreamTeamAutomator');
  const prof = id => path.join(data, 'browser-profiles', id);
  // a1: an account with caches and its login data; a2: open right now; gone: a removed account
  for (const id of ['a1', 'a2', 'gone']) {
    put(path.join(prof(id), 'Default', 'Cache', 'Cache_Data', 'f_000001'), 5000);
    put(path.join(prof(id), 'Default', 'Code Cache', 'js', 'index'), 3000);
    put(path.join(prof(id), 'GrShaderCache', 'data_0'), 2000);
    put(path.join(prof(id), 'Default', 'Network', 'Cookies'), 100);
    put(path.join(prof(id), 'Default', 'Local Storage', 'leveldb', '000003.log'), 100);
  }
  put(path.join(data, 'accounts.json'), 50);
  put(path.join(data, 'settings.json'), 50);
  put(path.join(root, 'license.json'), 50);
  let settings = {};
  const store = { getSettings: () => settings, saveSettings: s => { settings = s; }, getAccounts: () => [{ id: 'a1' }, { id: 'a2' }] };
  const logs = [];
  const pruned = [];
  const activity = { add: e => logs.push(e), prune: days => { pruned.push(days); return { files: 2, bytes: 700 }; } };
  return { root, data, prof, store, logs, pruned, activity, get settings() { return settings; } };
}

test('data cleanup: old browser caches and removed accounts\' profiles go; logins, accounts, settings and the license stay', async () => {
  const env = setup();
  // everything was made "now": run the clock 16 days ahead so it is older than the 15-day limit
  const c = new DataCleanup({ store: env.store, activity: env.activity, dataDir: env.data, isOpen: id => id === 'a2', now: () => Date.now() + 16 * DAY });
  const r = await c.run({ source: 'manual' });
  const has = p => fs.existsSync(p);
  // a1: caches removed, cookies and local storage kept
  assert.equal(has(path.join(env.prof('a1'), 'Default', 'Cache')), false);
  assert.equal(has(path.join(env.prof('a1'), 'Default', 'Code Cache')), false);
  assert.equal(has(path.join(env.prof('a1'), 'GrShaderCache')), false);
  assert.equal(has(path.join(env.prof('a1'), 'Default', 'Network', 'Cookies')), true);
  assert.equal(has(path.join(env.prof('a1'), 'Default', 'Local Storage', 'leveldb', '000003.log')), true);
  // a2 is open: untouched
  assert.equal(has(path.join(env.prof('a2'), 'Default', 'Cache')), true);
  // the profile of a removed account: gone
  assert.equal(has(env.prof('gone')), false);
  // never touched
  for (const f of [path.join(env.data, 'accounts.json'), path.join(env.data, 'settings.json'), path.join(env.root, 'license.json')]) assert.equal(has(f), true);
  assert.equal(r.caches, 3);
  assert.equal(r.orphans, 1);
  assert.equal(r.logs, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.freed, 3 * 0 + (5000 + 3000 + 2000) + (5000 + 3000 + 2000 + 200) + 700);
  assert.deepEqual(env.pruned, [15]);
  assert.equal(env.settings.dataCleanupLast.freed, r.freed);
  assert.ok(env.logs.some(e => e.code === 'dc.done' && e.params.caches === 3));
});

test('data cleanup: nothing younger than the limit is removed; 30 days keeps more; off skips the daily run', async () => {
  const env = setup();
  const c = new DataCleanup({ store: env.store, activity: env.activity, dataDir: env.data, now: () => Date.now() + 16 * DAY });
  c.setDays(30);
  const r = await c.run({ source: 'manual' });
  assert.equal(r.caches, 0);
  assert.equal(r.orphans, 0);
  assert.equal(fs.existsSync(path.join(env.prof('a1'), 'Default', 'Cache')), true);
  assert.deepEqual(env.pruned, [30]);
  c.setDays(0);
  assert.equal(await c.run({ source: 'auto' }), null);
  assert.equal(normDays('15'), 15);
  assert.equal(normDays(7), 15); // only 15 / 30 / 0
});
