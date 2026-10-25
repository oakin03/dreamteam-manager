const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../src/main/services/daily-summary.cjs');

test('daily summary counts matches, sales, buys, synthesis and problems', () => {
  const s = summarize([
    { message: 'Quick Play started · Match m1', accountName: 'A' },
    { code: 'qp.started', accountName: 'A' },
    { code: 'pvp.matchStarted', accountName: 'B' },
    { code: 'tw.won', accountName: 'B' }, { code: 'tw.lost' },
    { code: 'mk.claimed', params: { payout: 18, currency: 'APK' }, accountName: 'C' },
    { code: 'by.bought', params: { price: 20, currency: 'APK' }, accountName: 'D' },
    { code: 'sy.ok' }, { code: 'sy.fail' }, { code: 'at2.converted', params: { count: 5 } },
    { level: 'error', message: 'x' }, { level: 'warning', message: 'y' }
  ]);
  assert.deepEqual([s.quickPlay, s.pvp, s.towerWins, s.towerLosses, s.sales, s.salesApk, s.bought, s.spentApk, s.synthOk, s.synthFail, s.atConverted, s.errors, s.warnings], [2, 1, 1, 1, 1, 18, 1, 20, 1, 1, 5, 1, 1]);
  assert.equal(s.perAccount.A.quickPlay, 2);
});
