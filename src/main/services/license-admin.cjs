// Owner PANEL client — exists ONLY in the full edition (the build pipeline deletes it for pro/basic).
// Calls the license-admin Edge Function with the admin token to list/manage licenses and machines.
const https = require('https');
const crypto = require('crypto');

// A new key is always random (user 2026-11-21): DT- + 5 groups of 4 hex = 80 bits, never guessable.
function newKey() {
  const h = crypto.randomBytes(10).toString('hex').toUpperCase();
  return 'DT-' + h.match(/.{4}/g).join('-');
}

function call(cfg, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(`${cfg.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${cfg.FUNCTION}`); }
    catch { return reject(new Error('Panel ayarı eksik (SUPABASE_URL).')); }
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        // the Supabase gateway lets a request in only with the project's public key; the admin
        // token itself goes in its own header and is checked by the function
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`,
        'x-admin-token': cfg.ADMIN_TOKEN
      },
      timeout: timeoutMs
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let b = {};
        try { b = JSON.parse(data || '{}'); } catch { return resolve({ ok: false, error: `Sunucu yanıtı okunamadı (HTTP ${res.statusCode})` }); }
        // a gateway refusal has no `ok`: show its message instead of a bare "could not load"
        if (b.ok === undefined) return resolve({ ok: false, error: `HTTP ${res.statusCode}: ${b.message || b.error || b.code || 'bilinmeyen hata'}` });
        if (b.ok === false && b.error === 'unauthorized') return resolve({ ok: false, error: 'Admin şifresi sunucudakiyle aynı değil (LICENSE_ADMIN_TOKEN).' });
        resolve(b);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(payload);
  });
}

class LicenseAdmin {
  constructor(config) { this.cfg = config; }
  configured() { return Boolean(this.cfg.SUPABASE_URL && this.cfg.ADMIN_TOKEN && this.cfg.SUPABASE_ANON_KEY); }
  async send(body) {
    if (!this.configured()) return { ok: false, error: 'not-configured' };
    try { return await call(this.cfg, body); }
    catch (e) { return { ok: false, error: e.message }; }
  }
  overview() { return this.send({ action: 'overview' }); }
  async createLicense(p = {}) {
    const key = newKey();
    const r = await this.send({ action: 'createLicense', ...p, key });
    return r?.ok ? { ...r, key } : r;
  }
  updateLicense(p) { return this.send({ action: 'updateLicense', ...p }); }
  deleteLicense(key) { return this.send({ action: 'deleteLicense', key }); }
  machine(p) { return this.send({ action: 'machine', ...p }); }
}

module.exports = { LicenseAdmin, newKey };
