const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Veri temizliği (user 2026-11-21: the data folder had grown to 3.3 GB). Once a day — and on
// "Şimdi temizle" — the data folder sheds what only takes room:
//   * the browser caches of every Chromium profile (HTTP cache, code cache, GPU / shader caches):
//     a cache folder older than `days` is removed; the browser builds it again when needed.
//     Cookies, local storage and everything else that keeps an account signed in stay.
//   * the profile folder of an account that no longer exists, once it is older than `days`;
//   * the daily activity archives older than `days`.
// Never touched: accounts and passwords, settings, cards, roles, reports, the license (it lives
// outside the data folder) — only the folders and files listed here are ever removed.
// A profile whose browser is open (the app's own, or locked by a running Chromium) is skipped.
// settings.dataCleanupDays: 15 (default) or 30; 0 = off (the activity archives then keep the old
// 30-day limit of the activity service).
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 15;
const ALLOWED_DAYS = [0, 15, 30];
const FIRST_RUN_MS = 3 * 60 * 1000;   // after the start, when the app has settled
const EVERY_MS = DAY_MS;
// Chromium cache folders, relative to a profile (user data dir). Nothing here holds a login.
const CACHE_DIRS = [
  'Default/Cache', 'Default/Code Cache', 'Default/GPUCache', 'Default/DawnWebGPUCache', 'Default/DawnGraphiteCache',
  'Default/Service Worker/CacheStorage', 'Default/Service Worker/ScriptCache',
  'GrShaderCache', 'ShaderCache', 'GraphiteDawnCache', 'component_crx_cache', 'extensions_crx_cache', 'BrowserMetrics'
];
const CACHE_FILES = ['BrowserMetrics-spare.pma'];

const normDays = v => (ALLOWED_DAYS.includes(Number(v)) ? Number(v) : DEFAULT_DAYS);

async function sizeOf(p) {
  let st;
  try { st = await fsp.lstat(p); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let total = 0;
  let entries = [];
  try { entries = await fsp.readdir(p); } catch { return 0; }
  for (const e of entries) total += await sizeOf(path.join(p, e));
  return total;
}
// When a folder / file was made (Windows keeps the creation time; elsewhere the change time).
async function bornAt(p) {
  try { const st = await fsp.stat(p); return st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs; } catch { return null; }
}
// A running Chromium keeps `lockfile` open in its profile, so it cannot be removed then.
async function inUse(profileDir) {
  const lock = path.join(profileDir, 'lockfile');
  try { await fsp.access(lock); } catch { return false; }
  try { await fsp.unlink(lock); return false; } catch { return true; }
}

class DataCleanup {
  constructor({ store, activity, dataDir, isOpen = () => false, onChanged = null, now = () => Date.now() }) {
    Object.assign(this, { store, activity, dataDir, isOpen, onChanged, now });
    this.timer = null;
    this.firstTimer = null;
    this.running = null;
  }

  days() { return normDays(this.store.getSettings()?.dataCleanupDays); }
  setDays(days) {
    const d = normDays(days);
    this.store.saveSettings({ ...this.store.getSettings(), dataCleanupDays: d });
    this.onChanged?.();
    return this.snapshot();
  }
  snapshot() {
    return { days: this.days(), running: Boolean(this.running), last: this.store.getSettings()?.dataCleanupLast || null };
  }

  start() {
    if (this.timer) return;
    this.firstTimer = setTimeout(() => this.run({ source: 'auto' }).catch(() => {}), FIRST_RUN_MS);
    this.firstTimer.unref?.();
    this.timer = setInterval(() => this.run({ source: 'auto' }).catch(() => {}), EVERY_MS);
    this.timer.unref?.();
  }
  stop() { clearTimeout(this.firstTimer); clearInterval(this.timer); this.firstTimer = null; this.timer = null; }

  _log(level, code, params, message) {
    this.activity?.add({ level, accountId: null, accountName: '', taskName: 'Veri temizliği', code, params, message });
  }

  // One pass. `source`: 'auto' (the daily timer) or 'manual' (the Settings button).
  run({ source = 'manual' } = {}) {
    if (this.running) return this.running;
    const days = this.days();
    if (!days && source === 'auto') return Promise.resolve(null);
    this.running = this._run(days || DEFAULT_DAYS, source).finally(() => { this.running = null; this.onChanged?.(); });
    this.onChanged?.();
    return this.running;
  }

  async _run(days, source) {
    const cutoff = this.now() - days * DAY_MS;
    const out = { at: new Date(this.now()).toISOString(), days, source, freed: 0, caches: 0, orphans: 0, logs: 0, skipped: 0 };
    this._log('info', 'dc.start', { days }, `Data cleanup started · keeping the last ${days} days`);
    try {
      const accountIds = new Set((this.store.getAccounts?.() || []).map(a => a.id));
      // the app's own account profiles: caches, and the folders of removed accounts
      await this._profiles(path.join(this.dataDir, 'browser-profiles'), { cutoff, out, accountIds });
      // the Playwright MCP profiles (development only): their caches
      await this._profiles(path.join(this.dataDir, 'mcp-profiles'), { cutoff, out, accountIds: null });
      const logs = this.activity?.prune?.(days) || { files: 0, bytes: 0 };
      out.logs = logs.files; out.freed += logs.bytes;
    } catch (error) {
      this._log('error', 'dc.failed', { error: error.message }, `Data cleanup failed: ${error.message}`);
      throw error;
    }
    this.store.saveSettings({ ...this.store.getSettings(), dataCleanupLast: out });
    const mb = Math.round(out.freed / 1048576);
    this._log(out.freed ? 'success' : 'info', 'dc.done', { mb, caches: out.caches, orphans: out.orphans, logs: out.logs, skipped: out.skipped },
      `Data cleanup done · ${mb} MB freed (${out.caches} browser cache(s), ${out.orphans} unused profile(s), ${out.logs} old log day(s))${out.skipped ? ` · ${out.skipped} open profile(s) skipped` : ''}`);
    return out;
  }

  async _profiles(root, { cutoff, out, accountIds }) {
    let names = [];
    try { names = await fsp.readdir(root); } catch { return; }
    for (const name of names) {
      const dir = path.join(root, name);
      try { if (!(await fsp.stat(dir)).isDirectory()) continue; } catch { continue; }
      if (this.isOpen(name) || await inUse(dir)) { out.skipped++; continue; }
      // a profile of an account that is gone: the whole folder, once it is old enough
      if (accountIds && !accountIds.has(name)) {
        const st = await fsp.stat(dir).catch(() => null);
        if (st && st.mtimeMs < cutoff) {
          const size = await sizeOf(dir);
          try { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 2 }); out.freed += size; out.orphans++; } catch {}
        }
        continue;
      }
      for (const rel of [...CACHE_DIRS, ...CACHE_FILES]) {
        const p = path.join(dir, rel);
        const born = await bornAt(p);
        if (born == null || born >= cutoff) continue;
        const size = await sizeOf(p);
        try { await fsp.rm(p, { recursive: true, force: true, maxRetries: 2 }); out.freed += size; if (size) out.caches++; } catch {}
      }
    }
  }
}

module.exports = { DataCleanup, CACHE_DIRS, CACHE_FILES, normDays, DEFAULT_DAYS };
