const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { stripText } = require('../scripts/edition/strip.cjs');
const { TournamentService } = require('../src/main/services/tournament-service.cjs');

test('edition markers: a marked line / block goes only in the listed editions; @only lines turn on there', () => {
  const src = [
    'a();',
    'b(); // @strip(basic)',
    'c(); // @strip(pro,basic)',
    '// @strip-begin(basic)',
    'd();',
    '// @strip-end',
    '//@only(basic) e();',
    '  {/*@only(basic) <X/> */}',
    'f();'
  ].join('\n');
  assert.equal(stripText(src, 'basic').text, ['a();', 'e();', '  <X/>', 'f();'].join('\n'));
  assert.equal(stripText(src, 'pro').text, ['a();', 'b(); // @strip(basic)', '// @strip-begin(basic)', 'd();', '// @strip-end', '//@only(basic) e();', '  {/*@only(basic) <X/> */}', 'f();'].join('\n'));
  // the full edition never strips anything: the markers are comments there
  assert.equal(stripText(src, 'full').text, src);
});

test('edition markers: an unbalanced block stops the build', () => {
  assert.throws(() => stripText('// @strip-begin(basic)\nx();', 'basic', 'f.js'), /no @strip-end/);
  assert.throws(() => stripText('// @strip-begin(basic)\n// @strip-begin(basic)\n// @strip-end', 'basic', 'f.js'), /inside an open block/);
});

// a fake event socket: every account's registration is recorded with its cookie, in order
function fakeGame() {
  const registers = [];
  const ev = { id: 'open1', name: 'APK_MATCH 20-39', type: 'APK_MATCH', status: 'REGISTRATION', minLevel: 20, maxLevel: 39, maxPlayers: 128, startsAt: '2026-10-21T12:00:00.000Z', _count: { registrations: 0 }, registrations: [] };
  const createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.connected = false; s.close = () => {}; s.off = s.removeListener;
    const emit = EventEmitter.prototype.emit.bind(s);
    const handle = (event, payload, ack) => {
      if (event === 'getActiveMultiplayerEvents') ack(null, [ev]);
      else if (event === 'MultiRegistrationJoinRoom') ack(null, true);
      else if (event === 'registerMultiplayer') { registers.push({ cookie: options.extraHeaders?.Cookie, phase: 'start' }); setTimeout(() => { registers.push({ cookie: options.extraHeaders?.Cookie, phase: 'end' }); ack(null, { success: true }); }, 15); }
      else if (event === 'getMatchUserData') setTimeout(() => emit('matchUserData', { success: true, level: 30 }), 1);
    };
    s.timeout = () => ({ emit: (event, ...args) => { const ack = args.pop(); setTimeout(() => handle(event, args[0], ack), 1); } });
    s.emit = (event, payload) => { setTimeout(() => handle(event, payload, () => {}), 1); return true; };
    setTimeout(() => { s.connected = true; emit('connect'); }, 1);
    return s;
  };
  return { createSocket, registers };
}

async function runWith(oneByOne) {
  const game = fakeGame();
  const accounts = ['a1', 'a2', 'a3'].map(id => ({ id, name: id, login: id, passwordEncrypted: 'x' }));
  const s = new TournamentService({
    store: { getAccounts: () => accounts },
    credentials: { decryptSecret: () => 'pw' },
    browserService: { authenticate: async account => ({ userId: 'u-' + account.id, cookieHeader: 'c-' + account.id }) },
    accountProfile: { merge: () => {}, snapshot: () => ({ accounts: {} }) },
    activity: { add: () => {} }, onChanged: () => {},
    createSocket: game.createSocket, pollMs: { blank: 5, ongoing: 5, idle: 5 }, oneByOne
  });
  await s.start(accounts.map(a => a.id));
  await s.run;
  return game.registers;
}

test('tournament registration: one account at a time when oneByOne (shared editions), all at once otherwise (full)', async () => {
  const seq = await runWith(true);
  assert.equal(seq.length, 6);
  // each registration ends before the next account's starts
  for (let i = 0; i < seq.length; i += 2) { assert.equal(seq[i].phase, 'start'); assert.equal(seq[i + 1].phase, 'end'); assert.equal(seq[i].cookie, seq[i + 1].cookie); }
  const par = await runWith(false);
  assert.equal(par.length, 6);
  // all three start before the first one ends
  assert.deepEqual(par.slice(0, 3).map(r => r.phase), ['start', 'start', 'start']);
});
