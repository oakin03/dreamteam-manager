// Owner PANEL client — exists ONLY in the full edition (the build pipeline deletes it for pro/basic).
// Calls the license-admin Edge Function with the admin token to list/manage licenses and machines.
const https = require('https');

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
        'x-admin-token': cfg.ADMIN_TOKEN,
        apikey: cfg.ADMIN_TOKEN
      },
      timeout: timeoutMs
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({ ok: false, error: 'bad-response' }); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(payload);
  });
}

class LicenseAdmin {
  constructor(config) { this.cfg = config; }
  configured() { return Boolean(this.cfg.SUPABASE_URL && this.cfg.ADMIN_TOKEN); }
  async send(body) {
    if (!this.configured()) return { ok: false, error: 'not-configured' };
    try { return await call(this.cfg, body); }
    catch (e) { return { ok: false, error: e.message }; }
  }
  overview() { return this.send({ action: 'overview' }); }
  createLicense(p) { return this.send({ action: 'createLicense', ...p }); }
  updateLicense(p) { return this.send({ action: 'updateLicense', ...p }); }
  deleteLicense(key) { return this.send({ action: 'deleteLicense', key }); }
  machine(p) { return this.send({ action: 'machine', ...p }); }
}

module.exports = { LicenseAdmin };
