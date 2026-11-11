const { GameSocket } = require('./game-socket.cjs');
const { WIDE, eachAtOnce, eachWithSocket } = require('./wide.cjs');

// "Kadrolarım" (user 2026-11-09): the starters and the bench of every account in one list.
// getTeamOptimized {userId} answers on an anonymous /socket/ (no sign-in, so no game tab is
// kicked; ~0.3 s an account). A few sockets read the accounts in parallel; the last list is
// kept on disk so it shows after a restart.
const PARALLEL = WIDE; // every account at once (user 2026-11-11)

function rowsOf(account, profile, reply) {
  const out = [];
  const add = (p, group) => {
    if (!p?.id) return;
    const value = Number(p.baseSalary);
    const last = Number(p.lastSalary);
    out.push({
      accountId: account.id,
      account: account.name,
      level: profile?.level ?? null,
      group,                                   // 'starter' | 'bench'
      slot: p.slot || null,
      benchSlot: p.benchSlot ?? null,
      id: p.id,
      name: String(p.visualName || p.name || '').trim(),
      position: p.position || '',
      rating: p.rating || '',
      team: p.team || '',
      value: Number.isFinite(value) ? value : null,
      base: Number(p.newBaseSalary) || null,
      change: Number.isFinite(value) && Number.isFinite(last) ? value - last : 0,
      salary: Number(p.signedSalary) || null,
      injured: Boolean(p.isInjured) && !p.isHealed,
      x: p.type === 'XPLAYER' || String(p.rating).toUpperCase() === 'X',
      temporary: Boolean(p.isTemporary || p.expiresAt || p.duration)
    });
  };
  for (const p of reply?.players?.starters || []) add(p, 'starter');
  for (const p of reply?.players?.bench || []) add(p, 'bench');
  return out;
}

class RostersService {
  constructor({ store, activity, onChanged, createSocket, now = () => Date.now() }) {
    Object.assign(this, { store, activity, createSocket, now });
    const changed = onChanged || (() => {});
    this.revision = 0; // ~1500 rows: the state carries them only when this changes
    this.onChanged = () => { this.revision += 1; changed(); };
    this.busy = null; // { done, total }
  }

  snapshot() {
    const d = this.store.getRostersData?.() || {};
    return { busy: this.busy ? { ...this.busy } : null, fetchedAt: d.fetchedAt || null, failed: d.failed || [], rows: d.rows || [] };
  }

  async refresh() {
    if (this.busy) return this.snapshot();
    const prof = this.store.getAccountProfile?.()?.accounts || {};
    const accounts = this.store.getAccounts().filter(a => prof[a.id]?.userId);
    this.busy = { done: 0, total: accounts.length };
    this.onChanged();
    const rows = [];
    const failed = [];
    let i = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(PARALLEL, accounts.length) }, async () => {
        let sock = null;
        try {
          for (let a; (a = accounts[i++]);) {
            try {
              sock ||= await GameSocket.open({ createSocket: this.createSocket });
              const r = await sock.ack('getTeamOptimized', { userId: prof[a.id].userId }, { timeoutMs: 15000 });
              if (!r?.players) throw new Error('no roster in the reply');
              rows.push(...rowsOf(a, prof[a.id], r));
            } catch (error) {
              failed.push({ accountId: a.id, name: a.name, error: error.message });
              try { sock?.close(); } catch {}
              sock = null;
            }
            this.busy.done += 1;
            this.onChanged();
          }
        } finally { try { sock?.close(); } catch {} }
      }));
      const order = new Map(this.store.getAccounts().map((a, k) => [a.id, k]));
      rows.sort((a, b) => (order.get(a.accountId) - order.get(b.accountId)) || (a.group === b.group ? 0 : a.group === 'starter' ? -1 : 1));
      this.store.saveRostersData?.({ fetchedAt: new Date(this.now()).toISOString(), rows, failed });
      this.activity?.add({ level: failed.length ? 'warning' : 'success', taskName: 'Kadrolar', code: 'rs.done', params: { accounts: accounts.length - failed.length, players: rows.length, failed: failed.length }, message: `Rosters read · ${accounts.length - failed.length} account(s) · ${rows.length} players${failed.length ? ` · ${failed.length} failed` : ''}` });
    } finally {
      this.busy = null;
      this.onChanged();
    }
    return this.snapshot();
  }
}

module.exports = { RostersService, rowsOf };
