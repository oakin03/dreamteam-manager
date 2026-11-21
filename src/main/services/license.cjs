// License check for the PUBLIC build (anti-sharing). The full edition never calls this.
//
// How it stops sharing: the license key is bound to the FIRST machine that activates it. The
// binding lives on the server (Supabase). If the same key is tried on a second machine, the
// server refuses it. The owner sees every machine (and its last-seen time) in the Supabase table
// and can revoke a key or free a machine there — no custom admin panel needed.
//
// The app only ever calls one Edge Function; it never touches the table directly, so a user who
// unpacks the app cannot read or change other people's licenses. The anon key shipped in the app
// can only invoke the function.
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');

const SALT = 'dreamteam-manager:v1';

// A stable per-machine id. On Windows the Cryptography MachineGuid is unique per Windows install and
// does not change with a new computer name, a VPN / USB network adapter or a docking station, so it
// is used alone (user 2026-11-21: a renamed PC must not count as "another machine"). Only when it
// cannot be read are the os fields mixed in as a fallback.
function machineId() {
  let guid = '';
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
      guid = (out.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i) || [])[1] || '';
    } catch {}
  }
  if (guid) return crypto.createHash('sha256').update(SALT + '|guid|' + guid.toLowerCase()).digest('hex').slice(0, 32);
  const macs = Object.values(os.networkInterfaces()).flat().filter(n => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00').map(n => n.mac).sort();
  const parts = [guid, os.hostname(), os.platform(), os.arch(), (os.cpus()[0] || {}).model || '', macs[0] || ''];
  return crypto.createHash('sha256').update(SALT + '|' + parts.join('|')).digest('hex').slice(0, 32);
}

// NOTE (KVKK/privacy): we deliberately do NOT send the real computer name or user name — only the
// anonymous fingerprint above. The owner names a machine themselves in the panel (a label stored on
// the server), so no personal device data is collected.

function keyFile(app) { return path.join(app.getPath('userData'), 'license.json'); }

function readKey(app) {
  try { return JSON.parse(fs.readFileSync(keyFile(app), 'utf8')); } catch { return null; }
}
function writeKey(app, data) {
  try { fs.writeFileSync(keyFile(app), JSON.stringify(data, null, 2)); } catch {}
}
function clearKey(app) { try { fs.unlinkSync(keyFile(app)); } catch {} }

// Offline grace (user 2026-11-21): a short outage of the license server (or of the internet) must
// not stop a licensed copy. After a successful check the time is kept, signed, in license.json; while
// the server cannot be reached the app keeps working for GRACE_MS after that time. A refusal from the
// server (revoked, expired, blocked, another machine…) wipes it at once. `seenAt` only moves forward,
// so turning the clock back does not stretch the grace.
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const GRACE_SECRET = 'dtm-grace:7f3c9a51e2b84d06';
// Answers of the server that are final: the grace never covers them.
const FINAL = new Set(['revoked', 'expired', 'edition', 'blocked', 'pending', 'other-machine', 'not-found', 'machine-limit']);
const sign = (key, machine, okAt, seenAt) => crypto.createHmac('sha256', GRACE_SECRET).update(`${key}|${machine}|${okAt}|${seenAt}`).digest('hex');
function graceOf(saved, key, machine, now) {
  if (!saved || saved.key !== key || !saved.okAt || !saved.seenAt || !saved.sig) return null;
  if (saved.sig !== sign(key, machine, saved.okAt, saved.seenAt)) return null;
  const okAt = Date.parse(saved.okAt); const seenAt = Date.parse(saved.seenAt);
  if (!Number.isFinite(okAt) || !Number.isFinite(seenAt)) return null;
  if (now < seenAt - 5 * 60 * 1000) return null; // the clock went back
  if (now - okAt > GRACE_MS) return null;
  return { until: new Date(okAt + GRACE_MS).toISOString(), seenAt: new Date(Math.max(now, seenAt)).toISOString() };
}
// The key as typed: spaces and line breaks around / inside it are dropped.
const cleanKey = k => String(k || '').replace(/\s+/g, '');

// POST { action, ... } to the Edge Function. Returns the parsed JSON, or throws on a network error.
function callServer(cfg, body, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(`${cfg.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${cfg.FUNCTION}`); }
    catch { return reject(new Error('bad-url')); }
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`
      },
      timeout: timeoutMs
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end(payload);
  });
}

class LicenseClient {
  constructor({ app, config, edition, now = () => Date.now(), call = callServer }) {
    this.app = app;
    this.cfg = config;
    this.edition = edition || 'basic'; // which build this is; the server checks the key matches
    this.machine = machineId();
    this.timer = null;
    this.status = { ok: false, reason: 'init' };
    this.now = now;
    this.call = call; // the server request (tests pass a fake one)
  }

  configured() { return Boolean(this.cfg.SUPABASE_URL && this.cfg.SUPABASE_ANON_KEY); }

  // Try the stored key (if any). Returns { ok, reason, expiresAt }.
  async check(action = 'validate') {
    if (!this.configured()) return (this.status = { ok: false, reason: 'not-configured' });
    const saved = readKey(this.app);
    if (!saved?.key) return (this.status = { ok: false, reason: 'no-key' });
    return this.activate(saved.key, action);
  }

  // Send a key to the server. action 'activate' binds this machine; 'validate' only checks.
  async activate(key, action = 'activate', userIds = []) {
    if (!this.configured()) return (this.status = { ok: false, reason: 'not-configured' });
    key = cleanKey(key);
    if (!key) return (this.status = { ok: false, reason: 'no-key' });
    const now = this.now();
    const saved = readKey(this.app);
    let res;
    try {
      res = await this.call(this.cfg, {
        action, key, machine: this.machine, edition: this.edition,
        userIds: userIds || [], version: this.app.getVersion()
      });
    } catch (e) {
      return (this.status = this._grace(saved, key, now, e.message));
    }
    const b = res.body || {};
    if (res.status === 200 && b.ok) {
      const okAt = new Date(now).toISOString();
      const seenAt = okAt;
      writeKey(this.app, { key, boundAt: saved_boundAt(this.app, key), okAt, seenAt, sig: sign(key, this.machine, okAt, seenAt) });
      return (this.status = { ok: true, reason: 'ok', expiresAt: b.expiresAt || null });
    }
    if (FINAL.has(b.reason)) {
      // a final answer: no grace any more (the key itself stays so the window can show it)
      if (saved?.key === key) writeKey(this.app, { key, boundAt: saved.boundAt || null });
      return (this.status = { ok: false, reason: b.reason, expiresAt: b.expiresAt || null });
    }
    // the server answered, but not with a license decision (paused project, 5xx, gateway error)
    return (this.status = this._grace(saved, key, now, `server ${res.status}`));
  }

  // Server unreachable: allowed while the signed grace from the last good check lasts.
  _grace(saved, key, now, error) {
    const g = graceOf(saved, key, this.machine, now);
    if (!g) return { ok: false, reason: 'offline', error };
    writeKey(this.app, { ...saved, seenAt: g.seenAt, sig: sign(key, this.machine, saved.okAt, g.seenAt) });
    return { ok: true, reason: 'offline-grace', until: g.until, error };
  }

  startPeriodic(onChange) {
    this.stopPeriodic();
    const ms = Number(this.cfg.RECHECK_MS) || 0;
    if (ms <= 0) return;
    this.timer = setInterval(async () => {
      const s = await this.check('validate');
      onChange?.(s);
    }, ms);
    if (this.timer.unref) this.timer.unref();
  }
  stopPeriodic() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  forget() { clearKey(this.app); this.status = { ok: false, reason: 'no-key' }; }
}

function saved_boundAt(app, key) {
  const s = readKey(app);
  return s?.key === key && s?.boundAt ? s.boundAt : new Date().toISOString();
}

module.exports = { LicenseClient, machineId, GRACE_MS, FINAL };
