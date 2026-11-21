const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LicenseClient, GRACE_MS } = require('../src/main/services/license.cjs');

const H = 60 * 60 * 1000;
function client(replies) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-lic-'));
  const app = { getPath: () => dir, getVersion: () => 'test' };
  let t = Date.parse('2026-11-21T10:00:00Z');
  const sent = [];
  const call = async (_cfg, body) => {
    sent.push(body);
    const r = replies.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  const c = new LicenseClient({ app, config: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', FUNCTION: 'license' }, edition: 'basic', now: () => t, call });
  return { c, dir, sent, advance: ms => { t += ms; }, setNow: v => { t = v; }, file: () => JSON.parse(fs.readFileSync(path.join(dir, 'license.json'), 'utf8')) };
}
const ok = { status: 200, body: { ok: true, reason: 'ok' } };
const refuse = reason => ({ status: 200, body: { ok: false, reason } });

test('license: a short outage keeps a licensed copy running (offline grace), up to 3 days after the last good check', async () => {
  const env = client([ok, new Error('ECONNREFUSED'), { status: 503, body: {} }, new Error('timeout')]);
  assert.equal((await env.c.activate(' DT-AAAA -BBBB\n', 'activate')).ok, true);
  assert.equal(env.sent[0].key, 'DT-AAAA-BBBB'); // spaces / line breaks dropped
  env.advance(2 * H);
  let s = await env.c.check('validate');
  assert.equal(s.ok, true); assert.equal(s.reason, 'offline-grace');
  env.advance(24 * H);
  s = await env.c.check('validate'); // a 503 (paused project / gateway) is an outage too
  assert.equal(s.ok, true); assert.equal(s.reason, 'offline-grace');
  env.advance(GRACE_MS);
  s = await env.c.check('validate');
  assert.equal(s.ok, false); assert.equal(s.reason, 'offline');
});

test('license: a final answer (revoked, blocked, other machine…) ends the grace at once', async () => {
  const env = client([ok, refuse('revoked'), new Error('offline')]);
  await env.c.activate('DT-1', 'activate');
  const s = await env.c.check('validate');
  assert.deepEqual([s.ok, s.reason], [false, 'revoked']);
  // blocking the license server afterwards does not bring the copy back
  const s2 = await env.c.check('validate');
  assert.deepEqual([s2.ok, s2.reason], [false, 'offline']);
});

test('license: the grace cannot be stretched by editing license.json or turning the clock back', async () => {
  const env = client([ok, new Error('x'), new Error('x'), new Error('x')]);
  await env.c.activate('DT-1', 'activate');
  // edited okAt: the signature no longer matches
  const f = env.file(); f.okAt = '2030-01-01T00:00:00.000Z';
  fs.writeFileSync(path.join(env.dir, 'license.json'), JSON.stringify(f));
  assert.equal((await env.c.check('validate')).reason, 'offline');
  // a fresh good check, then an outage seen a day later, then the clock set back two days
  const env2 = client([ok, new Error('x'), new Error('x')]);
  await env2.c.activate('DT-1', 'activate');
  env2.advance(24 * H);
  assert.equal((await env2.c.check('validate')).ok, true);
  env2.advance(-48 * H);
  assert.equal((await env2.c.check('validate')).reason, 'offline');
});

test('license: without any good check there is no grace', async () => {
  const env = client([new Error('offline')]);
  const s = await env.c.activate('DT-1', 'activate');
  assert.deepEqual([s.ok, s.reason], [false, 'offline']);
});
