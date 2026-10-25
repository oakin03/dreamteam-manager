const { GameSocket } = require('./game-socket.cjs');

// Account health for the Home page, read without logging in every 10 minutes:
//   getUserBasicInfo {userId} -> salaryCap, totalSalaryUsed, funds, level
//   getTeamOptimized {userId} (ack) -> roster (starters + bench, max 11)
// Problems: over the salary cap (Quick Play / Tower refuse matches), close to it, roster
// full (Scout / Draft / buying cannot add players), low TK, and Auto Play in an error.
const REFRESH_MS = 10 * 60 * 1000;
const ROSTER_MAX = 11;
// Warning limits; the user can change them from the Home panel (settings.healthLimits).
const DEFAULT_LIMITS = { lowTk: 5000, nearCapPct: 97, rosterWarn: ROSTER_MAX };

function healthLimits(saved) {
  const pick = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
  return {
    lowTk: pick(saved?.lowTk, DEFAULT_LIMITS.lowTk, 0, 1e12),
    nearCapPct: pick(saved?.nearCapPct, DEFAULT_LIMITS.nearCapPct, 1, 100),
    rosterWarn: pick(saved?.rosterWarn, DEFAULT_LIMITS.rosterWarn, 1, ROSTER_MAX)
  };
}

class AccountHealth {
  constructor({ store, engine, gameHealth = null, onChanged, createSocket, now = () => Date.now() }) {
    Object.assign(this, { store, engine, gameHealth, onChanged, createSocket, now });
    this.rows = {};
    this.checkedAt = null;
    this.timer = null;
    this.busy = false;
  }

  start() {
    if (this.timer) return;
    setTimeout(() => this.refresh().catch(() => {}), 20000).unref?.();
    this.timer = setInterval(() => this.refresh().catch(() => {}), REFRESH_MS);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }

  async refresh() {
    if (this.busy || this.gameHealth?.isDown()) return this.snapshot();
    this.busy = true;
    let conn = null;
    try {
      conn = await GameSocket.open({ createSocket: this.createSocket });
      const rows = {};
      for (const account of this.store.getAccounts()) {
        const userId = this._userId(account.id);
        if (!userId) { rows[account.id] = { name: account.name, unknown: true }; continue; }
        const info = await conn.call('getUserBasicInfo', { userId }, 'userBasicInfo', { timeoutMs: 10000 }).catch(() => null);
        const team = await conn.ack('getTeamOptimized', { userId }, { timeoutMs: 10000 }).catch(() => null);
        const roster = team?.players ? (team.players.starters || []).length + (team.players.bench || []).length : null;
        rows[account.id] = {
          name: account.name,
          level: Number(info?.level) || null,
          cap: Number(info?.salaryCap) || null,
          used: Number(info?.totalSalaryUsed) || null,
          tk: Number.isFinite(Number(info?.funds)) ? Number(info.funds) : null,
          roster
        };
      }
      this.rows = rows;
      this.checkedAt = new Date(this.now()).toISOString();
    } finally {
      try { conn?.close(); } catch {}
      this.busy = false;
      this.onChanged?.();
    }
    return this.snapshot();
  }

  // Issues per account, worst first: [{ kind, level: 'bad'|'warn', ... }]
  static issues(row, worker, limits = DEFAULT_LIMITS) {
    const out = [];
    if (row.cap && row.used != null) {
      if (row.used > row.cap) out.push({ kind: 'overCap', level: 'bad', used: row.used, cap: row.cap });
      else if (row.used >= row.cap * limits.nearCapPct / 100) out.push({ kind: 'nearCap', level: 'warn', used: row.used, cap: row.cap });
    }
    if (row.roster != null && row.roster >= limits.rosterWarn) out.push({ kind: 'rosterFull', level: 'warn', roster: row.roster });
    if (row.tk != null && row.tk < limits.lowTk) out.push({ kind: 'lowTk', level: 'warn', tk: row.tk });
    if (worker?.status === 'error') out.push({ kind: 'autoPlayError', level: 'bad', message: worker.lastError || worker.message || '' });
    return out;
  }

  snapshot() {
    const workers = this.engine?.states?.() || {};
    const limits = healthLimits(this.store.getSettings?.()?.healthLimits);
    const rows = Object.entries(this.rows).map(([id, row]) => ({ accountId: id, ...row, issues: AccountHealth.issues(row, workers[id], limits) }));
    return { checkedAt: this.checkedAt, busy: this.busy, rows, limits: { rosterMax: ROSTER_MAX, ...limits }, defaults: DEFAULT_LIMITS };
  }
}

module.exports = { AccountHealth, healthLimits, DEFAULT_LIMITS };
