const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// The page keeps the latest entries (settings.maxActivityEntries, 500); every entry is
// also appended to a daily archive file logs/YYYY-MM-DD.jsonl (Turkey date) so older
// days can be read back, searched and exported. Archives older than KEEP_DAYS are removed.
const KEEP_DAYS = 30;
// Routine step entries that piled up to 450 000 lines / 147 MB a day with 1141 accounts (user
// 2026-11-27: "gereksiz kayıtları azaltalım"): they are only counted (the Daily Summary reads the
// counts from logs/YYYY-MM-DD.tally.json), never listed or archived.
const TALLY_ONLY = new Set([
  'qp.own',                                             // Quick Play paired with one of our accounts
  'eq.enhanced', 'eq.enhanceFailed',                    // every enhance step (eq.enhanceDone stays)
  'rt.timeout', 'rt.strategy', 'rt.sub', 'rt.attached', // rotation details (rt.done stays)
  'gu.queued', 'gu.matchStarted',                       // Go-up steps (gu.matchDone stays)
  'st.levelUp', 'mk.scanned', 'sy.ok'                   // per-account routine successes
]);
const TALLY_FLUSH_MS = 10000;
const trDay = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(ms));

class ActivityService {
  constructor(store, onChanged, { logDir = null } = {}) {
    this.store = store;
    this.onChanged = onChanged;
    this.logDir = logDir;
    this.buffer = [];
    this.tallies = new Map(); // day -> { codes: { code: { n, acc: { name: n } } } } not yet written
    this.tallyTimer = null;
    this.flushTimer = null;
    if (logDir) { try { fs.mkdirSync(logDir, { recursive: true }); this._prune(); } catch {} }
  }

  list() {
    return this.store.getActivity();
  }

  // `code` + `params` let the page show the entry in the selected language;
  // `message` stays as the English fallback.
  add({ level = 'info', accountId = null, accountName = '', taskId = null, taskName = '', message, alertType = null, code = null, params = null }) {
    if (code && TALLY_ONLY.has(code) && level !== 'error') { this.tally(code, accountName, params); return; }
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

  // Counts one routine entry of the day (no line in the list or the archive).
  tally(code, accountName = '', params = null) {
    if (!this.logDir || this.store.frozen) return;
    const { amountOf } = require('./daily-summary.cjs');
    const n = amountOf(code, params || {});
    const day = trDay();
    const t = this.tallies.get(day) || { codes: {} };
    const c = (t.codes[code] ||= { n: 0, acc: {} });
    c.n += n;
    if (accountName) c.acc[accountName] = (c.acc[accountName] || 0) + n;
    this.tallies.set(day, t);
    if (!this.tallyTimer) { this.tallyTimer = setTimeout(() => this.flushTallies(), TALLY_FLUSH_MS); this.tallyTimer.unref?.(); }
  }

  tallyFile(day) { return path.join(this.logDir, `${day}.tally.json`); }

  flushTallies() {
    clearTimeout(this.tallyTimer);
    this.tallyTimer = null;
    if (!this.logDir || !this.tallies.size) return;
    for (const [day, add] of this.tallies) {
      const file = this.tallyFile(day);
      let cur = { codes: {} };
      try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      for (const [code, c] of Object.entries(add.codes)) {
        const into = (cur.codes[code] ||= { n: 0, acc: {} });
        into.n += c.n;
        for (const [name, v] of Object.entries(c.acc)) into.acc[name] = (into.acc[name] || 0) + v;
      }
      try { fs.writeFileSync(file + '.tmp', JSON.stringify(cur)); fs.renameSync(file + '.tmp', file); } catch {}
    }
    this.tallies.clear();
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
    this.flushTallies();
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

  _prune() { this.prune(KEEP_DAYS); }

  // Remove the daily archives beyond the newest `keepDays` days (the data cleanup passes its own
  // number of days). Returns how many files and bytes went.
  prune(keepDays = KEEP_DAYS) {
    const out = { files: 0, bytes: 0 };
    if (!this.logDir) return out;
    const n = Math.max(1, Math.round(Number(keepDays) || KEEP_DAYS));
    const keep = new Set(this.days().slice(0, n));
    for (const day of this.days()) {
      if (keep.has(day)) continue;
      const file = path.join(this.logDir, `${day}.jsonl`);
      try { const size = fs.statSync(file).size; fs.unlinkSync(file); out.files++; out.bytes += size; } catch {}
      try { const t = this.tallyFile(day); const size = fs.statSync(t).size; fs.unlinkSync(t); out.bytes += size; } catch {}
    }
    return out;
  }
}

module.exports = { ActivityService, trDay, KEEP_DAYS, TALLY_ONLY };
