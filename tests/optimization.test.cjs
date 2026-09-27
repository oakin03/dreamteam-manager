const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppStore } = require('../src/main/services/store.cjs');
const { AccountProfileService } = require('../src/main/services/account-profile-service.cjs');
const { CardsService } = require('../src/main/services/cards-service.cjs');

function temporaryStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-opt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new AppStore(dir);
}

test('store reads one parsed copy and only updates its revision after a durable save', t => {
  const store = temporaryStore(t);
  const accounts = [{ id: 'main', name: 'Main' }];
  store.saveAccounts(accounts);
  assert.equal(store.getAccounts(), accounts);
  assert.equal(store.getAccounts(), store.getAccounts());
  const before = store.revision('accounts');
  store.saveAccounts([{ id: 'side', name: 'Side' }]);
  assert.equal(store.revision('accounts'), before + 1);
  assert.equal(store.getAccounts()[0].id, 'side');
  assert.equal(JSON.parse(fs.readFileSync(store.files.accounts, 'utf8'))[0].id, 'side');
});

test('total usable APK floors the final sum, preserving fractional account contributions', t => {
  const store = temporaryStore(t);
  store.saveAccounts([{ id: 'main' }, { id: 'side' }]);
  store.saveAccountProfile({ mainAccountId: 'main', accounts: { main: { apk: 298 }, side: { apk: 100 } } });
  const profile = new AccountProfileService({ store }).snapshot();
  assert.equal(profile.totalUsableApk, 395);
  assert.equal(profile.effectiveApk.side, 97);
  for (const fraction of [95.05, 95.9]) {
    store.saveAccountProfile({ mainAccountId: 'main', accounts: { main: { apk: 300 }, side: { apk: fraction / .97 } } });
    assert.equal(new AccountProfileService({ store }).snapshot().totalUsableApk, 395);
  }
});

test('unchanged Stadium data does not rewrite account profiles or notify the UI', t => {
  const store = temporaryStore(t);
  store.saveAccounts([{ id: 'main' }]);
  let notifications = 0;
  const profile = new AccountProfileService({ store, onChanged: () => notifications++ });
  profile.merge('main', { apk: 395 });
  const before = store.revision('accountProfile');
  profile.merge('main', { apk: 395 });
  assert.equal(store.revision('accountProfile'), before);
  assert.equal(notifications, 1);
});

test('card views reuse their derived player list until persisted cards change', t => {
  const store = temporaryStore(t);
  const cards = new CardsService({ store });
  const first = cards.snapshot();
  assert.equal(cards.snapshot().players, first.players);
  store.saveCards({ version: 2, players: { a: { key: 'a', name: 'Alpha', stars: 0, cardCount: 0 } } });
  const second = cards.snapshot();
  assert.notEqual(second.players, first.players);
  assert.equal(second.players[0].name, 'Alpha');
});
