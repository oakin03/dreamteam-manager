const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { summarize, summarizeFile } = require('../src/main/services/daily-summary.cjs');

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

test('every system is counted, with the accounts that did it', () => {
  const s = summarize([
    { code: 'df.picked', accountName: 'A' }, { code: 'df.picked', accountName: 'B' },
    { code: 'at2.listed', params: { name: 'x', price: 10 }, accountName: 'A' },
    { code: 'df.listed', params: { name: 'y', price: 10 }, accountName: 'B' },
    { code: 'at2.listed', params: { name: 'z', error: 'refused' }, accountName: 'A' }, // a failed listing does not count
    { code: 'qz.done', params: { score: 10 }, accountName: 'A' }, { code: 'qz.done', params: { error: 'timeout' }, accountName: 'B' },
    { code: 'eq.crafted', params: { count: 3 } }, { code: 'gu.matchDone', accountName: 'C' },
    { code: 'dr.donated', params: { amount: 100 }, accountName: 'A' }
  ]);
  assert.deepEqual(s.stats.draftPicks, { n: 2, accounts: 2, sums: {} });
  assert.equal(s.stats.listed.n, 2);
  assert.equal(s.stats.quiz.n, 1);
  assert.equal(s.stats.eqCrafted.n, 3);
  assert.equal(s.stats.goUp.accounts, 1);
  assert.equal(s.stats.donated.sums.amount, 100);
  assert.equal(s.perAccount.A.listed, 1);
});

test('a day file is read line by line with the same result', async () => {
  const file = path.join(os.tmpdir(), `ds-${process.pid}.jsonl`);
  const entries = [{ code: 'pvp.matchStarted', accountName: 'A' }, { level: 'error', message: 'x' }, { code: 'mk.claimed', params: { payout: 7, currency: 'TIX' }, accountName: 'B' }];
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\nnot json\n');
  try {
    const s = await summarizeFile(file);
    assert.equal(s.pvp, 1); assert.equal(s.errors, 1); assert.equal(s.salesTix, 7);
    assert.equal((await summarizeFile(file + '.none')).pvp, 0);
  } finally { fs.unlinkSync(file); }
});
