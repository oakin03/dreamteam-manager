const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppStore } = require('../src/main/services/store.cjs');
const { DailyRewardService, nextDailyResetAt, readMainRewardState } = require('../src/main/services/daily-reward-service.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-reward-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new AppStore(dir);
  store.saveAccounts([{ id: 'main', name: 'Main' }, { id: 'side', name: 'Side' }]);
  const events = [];
  const service = (savedStore = store) => new DailyRewardService({
    store: savedStore,
    credentials: {},
    browserService: { isFeatureLocked: () => false },
    activity: { add: e => events.push(e) },
    engine: { states: () => ({}) },
    onChanged: () => {}
  });
  return { dir, store, service, events, account: store.getAccounts()[0] };
}

function giftPage(rewardText, timerText = null) {
  const widget = { innerText: rewardText, textContent: rewardText };
  const outer = { innerText: `${rewardText} ${timerText || ''}`, textContent: `${rewardText} ${timerText || ''}` };
  const button = { parentElement: widget };
  widget.parentElement = outer;
  const img = { parentElement: button, closest: () => button };
  return {
    evaluate: async (fn, selector) => {
      const previous = global.document;
      global.document = { querySelector: () => img };
      try { return fn(selector); } finally { global.document = previous; }
    },
    locator: () => ({
      first: () => ({
        waitFor: async () => {},
        locator: () => ({ count: async () => 1, click: async () => {} })
      })
    })
  };
}

test('Reset is 19:00 Türkiye time, including a new day after the boundary', () => {
  const before = Date.UTC(2026, 8, 27, 15, 59, 59);
  const after = Date.UTC(2026, 8, 27, 16, 0, 0);
  assert.equal(new Date(nextDailyResetAt(before)).toISOString(), '2026-09-27T16:00:10.000Z');
  assert.equal(new Date(nextDailyResetAt(after)).toISOString(), '2026-09-28T16:00:10.000Z');
});

test('Tier 6 gift is still claimable, while completion is read only from the gift widget', async t => {
  const { service, store } = fixture(t);
  const ready = await readMainRewardState(giftPage('CLAIM TIER 6 REWARD!'));
  assert.equal(ready.rewardText, 'CLAIM TIER 6 REWARD!');
  assert.equal(ready.timerText, null);
  const s = service();
  const timed = await readMainRewardState(giftPage('NEXT IN: 04:59:17', '04:59:17'));
  assert.equal(timed.timerText, '04:59:17');
  await s.inspectStadium('main', giftPage('ALL REWARDS COLLECTED'));
  assert.equal(store.getDailyRewards().accounts.main.reason, 'completed');
  assert.equal(s.snapshot().main.status, 'completed');
});

test('Unrecognized click pauses the account until reset and persists across app restart', async t => {
  const { dir, service, store, account, events } = fixture(t);
  const s = service();
  const page = giftPage('CLAIM TIER 6 REWARD!');
  let clicks = 0;
  page.locator = () => ({ first: () => ({
    waitFor: async () => {},
    locator: () => ({ count: async () => 1, click: async () => { clicks++; } })
  }) });
  s.installRewardCapture = async () => {};
  s.readRewardCapture = async () => '';
  s.waitForRewardResult = async () => ({ type: 'unknown', tier: null, timerText: null });
  s.waitForMainTimer = async () => ({ timerText: null });
  s.dismissRewardOverlay = async () => {};
  const result = await s.claimOnPage(account, page);
  assert.equal(clicks, 1);
  assert.ok(result.delayMs > 60_000);
  assert.equal(store.getDailyRewards().accounts.main.reason, 'unknown');
  assert.equal(events.filter(e => e.level === 'warning').length, 1);

  const restarted = service(new AppStore(dir));
  assert.equal(restarted.snapshot().main.status, 'reset-wait');
  assert.equal(restarted.snapshot().main.nextAt, store.getDailyRewards().accounts.main.nextAt);
  assert.equal(restarted.snapshot().side, undefined);
  let navigations = 0;
  restarted.browser.isFeatureLocked = () => { navigations++; return false; };
  await restarted.inspectStadium('main', { evaluate: () => { throw new Error('should not inspect'); } });
  await restarted.checkOrClaim(account, new AbortController().signal);
  assert.equal(navigations, 0);
  const controller = new AbortController();
  const job = restarted.runWorker('main', controller.signal);
  controller.abort();
  await assert.rejects(job, { name: 'AbortError' });
  assert.equal(navigations, 0);

  // Once the persisted time has passed, normal checks resume for this account.
  const expired = { ...store.getDailyRewards(), accounts: { main: { nextAt: '2000-01-01T00:00:00.000Z', reason: 'unknown' } } };
  restarted.store.saveDailyRewards(expired);
  const resumed = service(new AppStore(dir));
  let attempts = 0;
  const afterReset = new AbortController();
  resumed.checkOrClaim = async () => { attempts++; afterReset.abort(); return { delayMs: 1000 }; };
  await assert.rejects(resumed.runWorker('main', afterReset.signal), { name: 'AbortError' });
  assert.equal(attempts, 1);
  assert.equal(resumed.store.getDailyRewards().accounts.main, undefined);
});

test('Sixth successful claim is remembered without waiting for another tier timer', async t => {
  const { service, store, account } = fixture(t);
  const s = service();
  s.installRewardCapture = async () => {};
  s.readRewardCapture = async () => 'Collected Tier 6 · 6 rewards received';
  s.waitForMainTimer = async () => { throw new Error('No seventh timer should be read'); };
  s.dismissRewardOverlay = async () => {};
  await s.claimOnPage(account, giftPage('CLAIM TIER 6 REWARD!'));
  assert.equal(s.snapshot().main.status, 'completed');
  assert.equal(store.getDailyRewards().accounts.main.reason, 'completed');
});
