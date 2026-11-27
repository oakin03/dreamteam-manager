const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runBatch } = require('../src/main/services/daily-batch.cjs');
const { Feed, eachStaggered } = require('../src/main/services/wide.cjs');

const sleep = ms => new Promise(r => setTimeout(r, ms));
// a system like the real ones: a run over a feed, each account takes `ms(step, id)`
function fakeRunner(step, ms, events) {
  const feed = new Feed();
  return {
    start(ids, onDone) {
      feed.push(ids);
      this.promise = eachStaggered(feed, async id => { events.push(`${step}+${id}`); await sleep(ms(step, id)); events.push(`${step}-${id}`); onDone(id); }, 10);
    },
    add(ids) { return feed.push(ids); },
    close() { feed.close(); },
    feed
  };
}

test('Toplu Başlat: an account goes on to its next system without waiting for the others', async () => {
  const events = [];
  const ms = (step, id) => (step === 'goup' && id === 'slow' ? 120 : 10);
  const runners = {};
  const over = [];
  const b = runBatch({
    steps: ['goup', 'boss', 'quiz'],
    sets: { goup: new Set(['fast', 'slow']), boss: new Set(['fast', 'slow']), quiz: new Set(['fast']) },
    makeRunner: step => (runners[step] = fakeRunner(step, ms, events)),
    onAccountOver: id => over.push(id)
  });
  await b.start();
  // fast was in boss (and quiz) while slow was still in Go-up
  assert.ok(events.indexOf('boss+fast') < events.indexOf('goup-slow'));
  assert.ok(events.indexOf('quiz+fast') < events.indexOf('goup-slow'));
  assert.deepEqual(over.sort(), ['fast', 'slow']);
  assert.deepEqual(b.state.rows.map(r => [r.id, r.status, r.done]), [['goup', 'done', 2], ['boss', 'done', 2], ['quiz', 'done', 1]]);
  assert.ok(Object.values(runners).every(r => r.feed.closed), 'every run is closed at the end');
});

test('Toplu Başlat: a stop ends every account after its current system', async () => {
  const events = [];
  const b = runBatch({
    steps: ['goup', 'boss'],
    sets: { goup: new Set(['a', 'b']), boss: new Set(['a', 'b']) },
    makeRunner: step => fakeRunner(step, () => 40, events)
  });
  const p = b.start();
  await sleep(10);
  b.stop();
  await p;
  assert.ok(!events.some(e => e.startsWith('boss+')), 'nobody went on to the next system');
  assert.equal(b.state.rows[1].status, 'skipped');
});
