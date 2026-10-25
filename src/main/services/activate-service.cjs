const { GameSocket } = require('./game-socket.cjs');

// Star card activation, player by player (never the game's "activate all"), read from
// the game client 2026-10-25:
//   /socket/ starcard:activateCard {userId, playerId, quantity: 1}
//            -> starcard:activateSuccess {playerName, oldLevel, newLevel} | starcard:error {message, retryAfter}
// Activating uses the player's highest card above its stars and sets the stars to that
// card's level. Only the chosen star levels are activated, the highest first (5★, then
// 4★, 3★ …, the reverse of synthesis). A player whose highest card is a level that is
// not chosen is left alone, because the game would use that card. X players are never touched.
const GAP_MS = 2500;
const WAIT_MS = 15000;
const MAX_WAITS = 4;
const LEVELS = [5, 4, 3, 2, 1];

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(abortError()); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

// Players of the last card scan that can be activated: target = highest card above the stars.
function activatable(players, levels) {
  const chosen = new Set(levels);
  const rows = [];
  for (const p of players || []) {
    if (p.noTeam || p.x || p.active === false) continue; // X players stay out of activation
    const stars = Number(p.stars) || 0;
    if (stars >= 5) continue;
    const above = Object.entries(p.cards || p.inventoryLevels || {}).filter(([lv, q]) => Number(lv) > stars && Number(q) > 0).map(([lv]) => Number(lv));
    if (!above.length) continue;
    const target = Math.max(...above);
    rows.push({ playerId: p.playerId, name: p.name, team: p.team, teamName: p.teamName, x: Boolean(p.x), stars, target, chosen: chosen.has(target) });
  }
  return rows.sort((a, b) => b.target - a.target || a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
}

class ActivateService {
  constructor({ store, activity, sessions, cards, onChanged, createSocket, now = () => Date.now(), timing = {} }) {
    Object.assign(this, { store, activity, sessions, cards, createSocket, now });
    this.onChanged = onChanged || (() => {});
    this.timing = { gapMs: GAP_MS, waitMs: WAIT_MS, ...timing };
    this.run = null;
    this.controller = null;
  }

  snapshot() {
    return { running: Boolean(this.controller), run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, levels: this.levels(), last: this.store.getSettings?.()?.activateReport || null };
  }
  levels() {
    const saved = this.store.getSettings?.()?.activateLevels;
    return Array.isArray(saved) ? LEVELS.filter(l => saved.includes(l)) : [5, 4, 3, 2];
  }
  _account() {
    const id = this.store.getAccountProfile?.()?.mainAccountId;
    const account = this.store.getAccounts().find(a => a.id === id);
    if (!account) throw new Error('Choose the main account first.');
    return account;
  }
  _log(account, level, code, params, message) {
    this.activity.add({ level, accountId: account.id, accountName: account.name, taskName: 'Activate', code, params, message });
  }
  stop() { this.controller?.abort(); return this.snapshot(); }

  start({ levels } = {}) {
    if (this.controller) throw new Error('Activation is already running.');
    const lv = LEVELS.filter(l => (levels || this.levels()).includes(l));
    if (!lv.length) throw new Error('Select at least one star level.');
    this.store.saveSettings?.({ ...(this.store.getSettings?.() || {}), activateLevels: lv });
    const account = this._account();
    this.controller = new AbortController();
    this.run = { levels: lv, accountName: account.name, status: 'running', step: 'scan', startedAt: new Date(this.now()).toISOString(), current: null, done: [], skipped: 0, failed: 0, message: null };
    this._log(account, 'info', 'ac.start', { levels: lv.map(l => `${l}★`).join(', ') }, `Card activation started · ${lv.map(l => `${l}★`).join(', ')}`);
    this.onChanged();
    this.done = this._run(account, lv, this.controller.signal)
      .then(() => { this.run.status = 'done'; })
      .catch(error => {
        if (error?.name === 'AbortError') { this.run.status = 'stopped'; return; }
        this.run.status = 'error'; this.run.message = error.message;
        this._log(account, 'error', 'ac.failed', { error: error.message }, `Card activation stopped: ${error.message}`);
      })
      .finally(async () => {
        const r = this.run;
        this._log(account, r.failed ? 'warning' : 'success', 'ac.summary', { count: r.done.length, skipped: r.skipped, failed: r.failed }, `Card activation · ${r.done.length} activated · ${r.skipped} skipped · ${r.failed} failed`);
        this.store.saveSettings?.({ ...(this.store.getSettings?.() || {}), activateReport: { at: new Date(this.now()).toISOString(), levels: r.levels, done: r.done, skipped: r.skipped, failed: r.failed, status: r.status } });
        r.current = null;
        this.controller = null;
        this.onChanged();
        try { await this.cards?.refresh?.(); } catch {}
      });
    return this.snapshot();
  }

  async _send(gs, userId, playerId, signal) {
    const sock = gs.socket;
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError());
      const done = d => { clearTimeout(timer); sock.off('starcard:activateSuccess', ok); sock.off('starcard:error', bad); signal.removeEventListener('abort', onAbort); resolve(d); };
      const ok = d => done({ ok: true, ...(d || {}) });
      const bad = d => done({ ok: false, message: typeof d === 'string' ? d : (d?.message || d?.error || 'Star card error'), retryAfter: Number(d?.retryAfter) || null });
      const timer = setTimeout(() => done({ ok: false, timeout: true, message: 'No answer to the activation.' }), this.timing.waitMs);
      const onAbort = () => { clearTimeout(timer); sock.off('starcard:activateSuccess', ok); sock.off('starcard:error', bad); reject(abortError()); };
      sock.on('starcard:activateSuccess', ok);
      sock.on('starcard:error', bad);
      signal.addEventListener('abort', onAbort, { once: true });
      sock.emit('starcard:activateCard', { userId, playerId, quantity: 1 });
    });
  }

  async _run(account, levels, signal) {
    // Fresh stars and cards first.
    await this.cards?.refresh?.();
    if (signal.aborted) throw abortError();
    const rows = activatable(this.cards?.snapshot?.()?.players || [], levels);
    const todo = rows.filter(r => r.chosen);
    this.run.skipped = rows.length - todo.length;
    this.run.total = todo.length;
    this.run.step = 'activate';
    this.onChanged();
    if (!todo.length) return;
    const session = await this.sessions.get(account, { owner: 'activate' });
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
    let registered = false;
    try {
      for (const row of todo) {
        if (signal.aborted) throw abortError();
        this.run.current = row;
        this.onChanged();
        let r = await this._send(gs, session.userId, row.playerId, signal);
        if ((r.timeout || /auth/i.test(r.message || '')) && !registered) {
          await gs.register(session.userId, { signal, owner: 'Activate' });
          registered = true;
          r = await this._send(gs, session.userId, row.playerId, signal);
        }
        for (let i = 0; i < MAX_WAITS && !r.ok && (r.retryAfter || /wait/i.test(r.message || '')); i++) {
          const secs = r.retryAfter || Number(String(r.message).match(/(\d+)\s*s/)?.[1]) || 5;
          await sleep(secs * 1000 + 800, signal);
          r = await this._send(gs, session.userId, row.playerId, signal);
        }
        if (!r.ok) {
          this.run.failed += 1;
          this._log(account, 'warning', 'ac.fail', { name: row.name, target: row.target, error: r.message || '' }, `${row.name} could not be activated (${row.target}★): ${r.message || ''}`);
          if (r.timeout) throw new Error(r.message);
        } else {
          const newLevel = Number(r.newLevel);
          // The game uses its own pick of card: if it is not the expected level, stop and say so.
          if (Number.isFinite(newLevel) && newLevel !== row.target) {
            this.run.done.push({ ...row, newLevel, unexpected: true });
            this._log(account, 'error', 'ac.unexpected', { name: row.name, target: row.target, got: newLevel }, `${row.name}: expected ${row.target}★ but the game made it ${newLevel}★ · stopped`);
            throw new Error(`${row.name}: expected ${row.target}★, got ${newLevel}★`);
          }
          this.run.done.push({ ...row, newLevel: Number.isFinite(newLevel) ? newLevel : row.target });
          this._log(account, 'success', 'ac.ok', { name: row.name, from: row.stars, to: Number.isFinite(newLevel) ? newLevel : row.target, team: row.team }, `${row.name} (${row.team}) ${row.stars}★ → ${row.target}★`);
        }
        this.onChanged();
        await sleep(this.timing.gapMs, signal);
      }
    } finally {
      try { gs.close(); } catch {}
    }
  }
}

module.exports = { ActivateService, activatable, LEVELS };
