const { GameSocket } = require('./game-socket.cjs');

// Chat messages at intervals (read from the game client 2026-10-23), on /chat-socket/:
//   sendMessage {userId, teamName, title, titleColor, level, text, type: 'all'}
//   -> everyone gets newMessage {...}; too early -> cooldownActive {type, retryAfter (s)};
//   chatBlocked {...} when the game blocks the account's chat.
// The game allows one global message every 10 s per account and at most 50 characters,
// so the app never goes below MIN_INTERVAL_SEC / above MAX_TEXT. No megaphone.
// Messages are written in list order, each by its own account; the list repeats
// `loops` times (or until stopped when infinite).
const CHAT_PATH = '/chat-socket/';
const MIN_INTERVAL_SEC = 11;
const MAX_TEXT = 50;
const CONFIRM_MS = 6000;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Cleans a config from the page: valid messages only, limits enforced.
function normalizeConfig(cfg, accountIds = null) {
  const known = accountIds ? new Set(accountIds) : null;
  const messages = (Array.isArray(cfg?.messages) ? cfg.messages : [])
    .map(m => ({ text: String(m?.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT), accountId: m?.accountId || null }))
    .filter(m => m.text && m.accountId && (!known || known.has(m.accountId)));
  const intervalSec = Math.max(MIN_INTERVAL_SEC, Math.round(Number(cfg?.intervalSec) || MIN_INTERVAL_SEC));
  const infinite = cfg?.infinite === true;
  const loops = Math.max(1, Math.min(100000, Math.round(Number(cfg?.loops) || 20)));
  return { messages, intervalSec, infinite, loops };
}

class ChatService {
  constructor({ store, activity, sessions, onChanged, createSocket, gameHealth = null, now = () => Date.now(), timing = {} }) {
    Object.assign(this, { store, activity, sessions, createSocket, gameHealth, now });
    this.onChanged = onChanged || (() => {});
    this.timing = { confirmMs: CONFIRM_MS, secondMs: 1000, ...timing };
    this.run = null;
    this.controller = null;
  }

  snapshot() {
    return { running: Boolean(this.controller), run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, limits: { minIntervalSec: MIN_INTERVAL_SEC, maxText: MAX_TEXT }, lastReport: this.store.getChatReport?.() || null };
  }

  _account(id) { return this.store.getAccounts().find(a => a.id === id) || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? (this._account(id)?.name || '') : '', taskName: 'Chat', code, params, message });
  }

  stop() { this.controller?.abort(); }

  // One chat connection per account for the whole run, with the sender profile.
  async _sender(id, signal) {
    const cached = this.senders.get(id);
    if (cached) return cached;
    const account = this._account(id);
    const session = await this.sessions.get(account, { owner: 'chat' });
    const anon = await GameSocket.open({ createSocket: this.createSocket, signal });
    let info = null;
    try { info = await anon.call('getUserBasicInfo', { userId: session.userId }, 'userBasicInfo', { signal, timeoutMs: 10000 }); }
    finally { try { anon.close(); } catch {} }
    const conn = await GameSocket.open({ createSocket: this.createSocket, path: CHAT_PATH, cookie: session.cookieHeader, signal });
    const sender = {
      conn,
      profile: { userId: session.userId, teamName: info?.teamName || account.name, title: info?.activeTitle ?? null, titleColor: info?.activeTitleColor ?? null, level: Number(info?.level) || null },
      blocked: null
    };
    conn.socket.on('chatBlocked', data => { sender.blocked = data?.message || data?.reason || 'blocked'; });
    this.senders.set(id, sender);
    return sender;
  }

  // Sends one message and waits for the game to show it (newMessage), a cooldown or a block.
  _send(sender, text, signal) {
    const socket = sender.conn.socket;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, value) => {
        if (done) return; done = true; clearTimeout(timer);
        socket.off('newMessage', onMessage); socket.off('cooldownActive', onCooldown); socket.off('chatBlocked', onBlocked);
        signal?.removeEventListener('abort', onAbort);
        if (err) reject(err); else resolve(value);
      };
      const onMessage = m => { if (m?.userId === sender.profile.userId && String(m?.text || '') === text) finish(null, { ok: true }); };
      const onCooldown = c => finish(null, { cooldown: Number(c?.retryAfter) || 10 });
      const onBlocked = b => finish(null, { blocked: b?.message || b?.reason || 'blocked' });
      const onAbort = () => finish(abortError());
      const timer = setTimeout(() => finish(null, { unconfirmed: true }), this.timing.confirmMs);
      socket.on('newMessage', onMessage); socket.on('cooldownActive', onCooldown); socket.on('chatBlocked', onBlocked);
      signal?.addEventListener('abort', onAbort, { once: true });
      socket.emit('sendMessage', { ...sender.profile, text, type: 'all' });
    });
  }

  async runAndWait(config, { signal } = {}) {
    if (this.controller) throw new Error('Chat is already running.');
    const cfg = normalizeConfig(config, this.store.getAccounts().map(a => a.id));
    if (!cfg.messages.length) throw new Error('Add at least one message with an account.');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.controller = controller;
    this.senders = new Map();
    this.run = { startedAt: new Date(this.now()).toISOString(), config: cfg, loop: 0, index: -1, sent: 0, failed: 0, nextAt: null, status: 'running', blocked: {}, lastError: null };
    this._log(null, 'info', 'cs.start', { count: cfg.messages.length, interval: cfg.intervalSec, loops: cfg.infinite ? '∞' : cfg.loops }, `Chat started · ${cfg.messages.length} message(s) · every ${cfg.intervalSec} s · ${cfg.infinite ? 'endless' : `${cfg.loops} loop(s)`}`);
    this.onChanged();
    let stopped = false;
    try {
      for (let loop = 1; cfg.infinite || loop <= cfg.loops; loop++) {
        for (let i = 0; i < cfg.messages.length; i++) {
          const { text, accountId } = cfg.messages[i];
          if (this.run.blocked[accountId]) continue;
          if (Object.keys(this.run.blocked).length && cfg.messages.every(m => this.run.blocked[m.accountId])) throw new Error('Every account is blocked from the chat.');
          if (this.gameHealth?.isDown()) { this.run.status = 'waitingGame'; this.onChanged(); await this.gameHealth.waitUp(controller.signal); }
          Object.assign(this.run, { loop, index: i, status: 'sending', nextAt: null });
          this.onChanged();
          const name = this._account(accountId)?.name || '';
          try {
            const sender = await this._sender(accountId, controller.signal);
            let r = await this._send(sender, text, controller.signal);
            if (r.cooldown) { await sleep((r.cooldown + 1) * this.timing.secondMs, controller.signal); r = await this._send(sender, text, controller.signal); }
            if (r.blocked) {
              this.run.blocked[accountId] = r.blocked;
              this.run.failed++;
              this._log(accountId, 'error', 'cs.blocked', { error: r.blocked }, `Chat blocked by the game (${r.blocked}) · this account's messages are skipped`);
            } else if (r.cooldown) {
              this.run.failed++;
              this._log(accountId, 'warning', 'cs.cooldown', { sec: r.cooldown }, `Chat: still in cooldown (${r.cooldown} s) · message skipped`);
            } else {
              this.run.sent++;
              if (r.unconfirmed) this._log(accountId, 'warning', 'cs.unconfirmed', { text }, `Chat: "${text}" sent but not seen in the chat yet`);
            }
          } catch (error) {
            if (error?.name === 'AbortError') throw error;
            this.run.failed++;
            this.run.lastError = `${name}: ${error.message}`;
            this._log(accountId, 'error', 'cs.failed', { error: error.message }, `Chat message failed: ${error.message}`);
          }
          const last = !cfg.infinite && loop === cfg.loops && i === cfg.messages.length - 1;
          if (!last) {
            this.run.status = 'waiting';
            this.run.nextAt = new Date(this.now() + cfg.intervalSec * this.timing.secondMs).toISOString();
            this.onChanged();
            await sleep(cfg.intervalSec * this.timing.secondMs, controller.signal);
          }
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError') stopped = true;
      else { this.run.lastError = error.message; this._log(null, 'error', 'cs.failed', { error: error.message }, `Chat stopped: ${error.message}`); }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      for (const s of this.senders.values()) { try { s.conn.close(); } catch {} }
      this.senders = new Map();
      const report = { startedAt: this.run.startedAt, finishedAt: new Date(this.now()).toISOString(), sent: this.run.sent, failed: this.run.failed, loops: this.run.loop, stopped, blocked: this.run.blocked, lastError: this.run.lastError };
      this.store.saveChatReport?.(report);
      this._log(null, report.failed ? 'warning' : 'success', 'cs.summary', { sent: report.sent, failed: report.failed, loops: report.loops }, `Chat finished · ${report.sent} message(s) sent · ${report.failed} failed · ${report.loops} loop(s)`);
      this.controller = null;
      this.run = null;
      this.onChanged();
    }
    return this.snapshot();
  }
}

module.exports = { ChatService, normalizeConfig, MIN_INTERVAL_SEC, MAX_TEXT };
