const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// The page keeps the latest entries (settings.maxActivityEntries, 500); every entry is
// also appended to a daily archive file logs/YYYY-MM-DD.jsonl (Turkey date) so older
// days can be read back, searched and exported. Archives older than KEEP_DAYS are removed.
const KEEP_DAYS = 30;
const trDay = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(ms));

class ActivityService {
  constructor(store, onChanged, { logDir = null } = {}) {
    this.store = store;
    this.onChanged = onChanged;
    this.logDir = logDir;
    this.buffer = [];
    this.flushTimer = null;
    if (logDir) { try { fs.mkdirSync(logDir, { recursive: true }); this._prune(); } catch {} }
  }

  list() {
    return this.store.getActivity();
  }

  // `code` + `params` let the page show the entry in the selected language;
  // `message` stays as the English fallback.
  add({ level = 'info', accountId = null, accountName = '', taskId = null, taskName = '', message, alertType = null, code = null, params = null }) {
    const settings = this.store.getSettings();
    const max = Number(settings.maxActivityEntries || 500);
    const items = this.store.getActivity();
    const entry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      level,
      accountId,
      accountName,
      taskId,
      taskName,
      message: String(message),
      alertType: alertType || null,
      ...(code ? { code, params: params || {} } : {})
    };
    items.unshift(entry);
    this.store.saveActivity(items.slice(0, max));
    this._archive(entry);
    this.onChanged?.();
  }

  clear() {
    this.store.saveActivity([]);
    this.onChanged?.();
  }

  // ---------- daily archive ----------
  _archive(entry) {
    if (!this.logDir || this.store.frozen) return;
    this.buffer.push(entry);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushArchive(), 1000);
      this.flushTimer.unref?.();
    }
  }

  flushArchive() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.logDir || !this.buffer.length || this.store.frozen) { this.buffer = []; return; }
    const byDay = new Map();
    for (const e of this.buffer) {
      const day = trDay(Date.parse(e.at));
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(JSON.stringify(e));
    }
    this.buffer = [];
    for (const [day, lines] of byDay) {
      try { fs.appendFileSync(path.join(this.logDir, `${day}.jsonl`), lines.join('\n') + '\n'); } catch {}
    }
  }

  days() {
    if (!this.logDir) return [];
    if (this.buffer.length) this.flushArchive();
    try { return fs.readdirSync(this.logDir).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map(f => f.slice(0, 10)).sort().reverse(); } catch { return []; }
  }

  // Entries of one archived day, newest first.
  readDay(day) {
    this.flushArchive();
    if (!this.logDir || !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return [];
    try {
      return fs.readFileSync(path.join(this.logDir, `${day}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
    } catch { return []; }
  }

  // Text search over the archive (newest day first), at most `limit` hits.
  search(text, { limit = 300 } = {}) {
    const q = String(text || '').trim().toLocaleLowerCase('tr-TR');
    if (!q) return [];
    const out = [];
    for (const day of this.days()) {
      for (const e of this.readDay(day)) {
        const hay = `${e.accountName} ${e.taskName} ${e.message} ${JSON.stringify(e.params || {})}`.toLocaleLowerCase('tr-TR');
        if (hay.includes(q)) { out.push(e); if (out.length >= limit) return out; }
      }
    }
    return out;
  }

  _prune() {
    const keep = new Set(this.days().slice(0, KEEP_DAYS));
    for (const day of this.days()) if (!keep.has(day)) { try { fs.unlinkSync(path.join(this.logDir, `${day}.jsonl`)); } catch {} }
  }
}

module.exports = { ActivityService, trDay };
