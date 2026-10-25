const { GameSocket } = require('./game-socket.cjs');
const R = require('./synthesis-rules.cjs');

// Star Card synthesis for the Cards page account (the main account), over /socket/:
//   starcard:getUserStarCards {userId}  -> starcard:userStarCards {inventory[]}   (no login needed)
//   starcard:synthesize {userId, selectedCards[4]{inventoryId,itemId,linkedPlayerId,level}}
//     -> starcard:synthesisSuccess {message, resultCard{playerId, playerName, level, combinationType}}
//      | starcard:synthesisFailed {message} | starcard:error
// Four cards of the same player = the same inventory row four times ("fourSame"); four
// different No Team players = a random next-level card ("allDifferent"). L1→L2 always
// works; from L2 a synthesis can fail and gives one card back.
// "team" mode: every group of 4 cards of the same team player. "noTeam" mode: the first
// four different No Team players in the game's order (quantity, then name). Levels are
// done in order 1→4 and the cards are read again after every synthesis, so cards made
// (or given back) on the way are used too. X players are never touched.
// The game's own page locks Synthesize for 5 s after a success, and the server answers
// "Too many requests. Try again in N seconds" when syntheses come faster (5 in ~26 s
// were refused on 2026-10-23). Syntheses stay 8 s apart; a "try again in N" is waited
// out and the same cards are sent again.
const GAP_MS = 8000;
const MAX_WAITS = 4;
const WAIT_MS = 15000;
const MAX_STEPS = 400;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(abortError()); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

// Seconds the game asks to wait ("Try again in 180 seconds", "Please wait 5 seconds",
// retryAfter), or null when the answer is not a cooldown.
function waitSeconds(r) {
  if (Number(r?.retryAfter) > 0) return Math.ceil(Number(r.retryAfter));
  const m = String(r?.message || '').match(/(?:try again in|wait)\s*(\d+)\s*s/i);
  if (m) return Number(m[1]);
  return /too many|cooldown|too fast/i.test(String(r?.message || '')) ? 10 : null;
}

class SynthesisService {
  constructor({ store, activity, sessions, onChanged, onDone, createSocket, now = () => Date.now(), timing = {} }) {
    this.store = store;
    this.activity = activity;
    this.sessions = sessions;
    this.onChanged = onChanged || (() => {});
    this.onDone = onDone;          // async () → Cards page rescan
    this.createSocket = createSocket;
    this.now = now;
    this.timing = { gapMs: GAP_MS, waitMs: WAIT_MS, ...timing };
    this.run = null;
    this.controller = null;
  }

  snapshot() {
    return { running: Boolean(this.controller), run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, summary: this.store.getSynthesisData?.()?.summary || {} };
  }

  _account() {
    const id = this.store.getAccountProfile?.()?.mainAccountId;
    const account = this.store.getAccounts().find(a => a.id === id);
    if (!account) throw new Error('Choose the main account first.');
    return account;
  }
  _log(account, level, code, params, message) {
    this.activity.add({ level, accountId: account.id, accountName: account.name, taskName: 'Synthesis', code, params, message });
  }

  stop() { this.controller?.abort(); return this.snapshot(); }

  start({ mode, levels } = {}) {
    if (this.controller) throw new Error('Synthesis is already running.');
    if (!['team', 'noTeam'].includes(mode)) throw new Error('Unknown synthesis mode.');
    const lv = R.LEVELS.filter(l => (levels || R.LEVELS).includes(l));
    if (!lv.length) throw new Error('Select at least one level.');
    const account = this._account();
    this.controller = new AbortController();
    this.run = { mode, levels: lv, accountId: account.id, accountName: account.name, status: 'running', level: null, startedAt: new Date(this.now()).toISOString(), current: null, history: [], counts: Object.fromEntries(R.LEVELS.map(l => [l, { ok: 0, fail: 0 }])), obtained: [], message: null };
    this._log(account, 'info', 'sy.start', { mode, levels: lv.map(l => `${l}→${l + 1}`).join(', ') }, `Synthesis started (${mode})`);
    this.onChanged();
    this.done = this._run(account, this.controller.signal)
      .then(() => { this.run.status = 'done'; this._log(account, 'success', 'sy.done', this._totals(), 'Synthesis finished'); })
      .catch(error => {
        if (error?.name === 'AbortError') { this.run.status = 'stopped'; this._log(account, 'warning', 'sy.stopped', this._totals(), 'Synthesis stopped'); return; }
        this.run.status = 'error'; this.run.message = error.message;
        this._log(account, 'error', 'sy.failed', { error: error.message }, `Synthesis stopped: ${error.message}`);
      })
      .finally(async () => {
        this.run.current = null;
        this._saveSummary();
        this.controller = null;
        this.onChanged();
        try { await this.onDone?.(); } catch {}
      });
    return this.snapshot();
  }

  _totals() {
    const c = this.run.counts;
    return { ok: Object.values(c).reduce((n, x) => n + x.ok, 0), fail: Object.values(c).reduce((n, x) => n + x.fail, 0) };
  }

  // Last run per account and mode: success/fail per level for the summary table.
  _saveSummary() {
    // A run that synthesized nothing keeps the previous "last run" of that mode.
    if (!this._totals().ok && !this._totals().fail) return;
    const data = { version: 1, summary: {}, ...(this.store.getSynthesisData?.() || {}) };
    const prev = data.summary[this.run.accountId] || {};
    data.summary[this.run.accountId] = { ...prev, name: this.run.accountName, [this.run.mode]: { at: new Date(this.now()).toISOString(), counts: this.run.counts } };
    this.store.saveSynthesisData?.(data);
  }

  async _rawInventory(signal) {
    const r = await this.anon.call('starcard:getUserStarCards', { userId: this.userId }, 'starcard:userStarCards', { signal, timeoutMs: 30000 });
    if (!Array.isArray(r?.inventory)) throw new Error('Star cards could not be read.');
    return r.inventory;
  }
  async _inventory(signal) { return R.stacksFrom(await this._rawInventory(signal)); }

  // Cards per "playerId:level" — compared before/after a synthesis to see what it really made.
  static counts(inventory) {
    const m = new Map();
    for (const x of inventory || []) {
      const pid = x.item?.linkedPlayerId || x.item?.linkedPlayer?.id;
      const lvl = Number(x.level ?? x.item?.level);
      if (!pid || !Number.isFinite(lvl)) continue;
      const k = pid + ':' + lvl;
      m.set(k, (m.get(k) || 0) + (Number(x.quantity) || 0));
    }
    return m;
  }

  async _run(account, signal) {
    const session = await this.sessions.get(account, { owner: 'synthesis' });
    this.userId = session.userId;
    this.anon = await GameSocket.open({ createSocket: this.createSocket, signal });
    this.conn = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
    this.registered = false;
    try {
      let steps = 0;
      for (const level of this.run.levels) {
        this.run.level = level;
        this.onChanged();
        for (;;) {
          if (signal.aborted) throw abortError();
          if (++steps > MAX_STEPS) throw new Error('Too many syntheses in one run.');
          const raw = await this._rawInventory(signal);
          const stacks = R.stacksFrom(raw);
          const pick = this.run.mode === 'team'
            ? (s => s ? [s, s, s, s] : null)(R.teamCandidates(stacks, level)[0])
            : R.noTeamPick(stacks, level);
          if (!pick) break;
          await this._synthesize(account, level, pick, signal, SynthesisService.counts(raw));
          await sleep(this.timing.gapMs, signal);
        }
      }
    } finally {
      try { this.anon?.close(); } catch {}
      try { this.conn?.close(); } catch {}
    }
  }

  async _send(cards, signal) {
    const sock = this.conn.socket;
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError());
      const done = d => { clearTimeout(timer); for (const [e, f] of handlers) sock.off(e, f); signal.removeEventListener('abort', onAbort); resolve(d); };
      const handlers = [
        ['starcard:synthesisSuccess', d => done({ ok: true, ...d })],
        ['starcard:synthesisFailed', d => done({ ok: false, failed: true, ...(d && typeof d === 'object' ? d : { message: String(d) }) })],
        ['starcard:error', d => done({ ok: false, error: true, retryAfter: Number(d?.retryAfter) || null, message: typeof d === 'string' ? d : (d?.message || d?.error || 'Star card error') })]
      ];
      const timer = setTimeout(() => done({ ok: false, timeout: true }), this.timing.waitMs);
      const onAbort = () => { clearTimeout(timer); for (const [e, f] of handlers) sock.off(e, f); reject(abortError()); };
      for (const [e, f] of handlers) sock.on(e, f);
      signal.addEventListener('abort', onAbort, { once: true });
      sock.emit('starcard:synthesize', { userId: this.userId, selectedCards: R.selectedCards(cards) });
    });
  }

  async _synthesize(account, level, cards, signal, before = null) {
    const names = cards.map(c => c.name);
    this.run.current = { level, used: names, result: null };
    this.onChanged();
    let r = await this._send(cards, signal);
    // The cookie alone may not be enough for writes: register once and repeat.
    if ((r.timeout || /auth/i.test(r.message || '')) && !this.registered) {
      await this.conn.register(this.userId, { signal });
      this.registered = true;
      r = await this._send(cards, signal);
    }
    for (let i = 0; i < MAX_WAITS && !r.ok && !r.failed && waitSeconds(r) != null; i++) {
      const secs = waitSeconds(r);
      this.run.waitUntil = new Date(this.now() + secs * 1000).toISOString();
      this._log(account, 'warning', 'sy.wait', { seconds: secs, message: r.message || '' }, `The game asks to wait ${secs} s · ${r.message || ''}`);
      this.onChanged();
      await sleep(secs * 1000 + 1500, signal);
      this.run.waitUntil = null;
      this.onChanged();
      r = await this._send(cards, signal);
    }
    if (r.timeout) throw new Error('No answer to the synthesis.');
    if (r.error) throw new Error(r.message);
    // A failed synthesis may also arrive as synthesisSuccess: the card given back keeps
    // the old level (seen 2026-10-23: 4× 2★ → one 2★). Only a higher level is a success.
    const rcLevel = Number(r.resultCard?.level);
    if (r.ok && Number.isFinite(rcLevel) && rcLevel <= level) {
      r = { ...r, ok: false, failed: true, returnedCard: r.resultCard };
    }
    // The inventory decides: a success adds a card one level up. If no card at
    // level+1 grew, the synthesis failed whatever the event said.
    if (r.ok && before) {
      await sleep(400, signal);
      const after = SynthesisService.counts(await this._rawInventory(signal).catch(() => null));
      if (after.size) {
        const grew = [...after].some(([k, q]) => k.endsWith(':' + (level + 1)) && q > (before.get(k) || 0));
        if (!grew) r = { ...r, ok: false, failed: true, returnedCard: r.resultCard, verified: true };
      }
    }
    const entry = { at: new Date(this.now()).toISOString(), level, used: names, ok: r.ok, message: r.message || '' };
    // Cards used up from what this run made earlier are no longer "obtained".
    for (const c of cards) {
      const o = this.run.obtained.find(x => x.playerId === c.playerId && x.level === c.level && x.count > 0);
      if (o) o.count -= 1;
    }
    if (r.ok) {
      const rc = r.resultCard || {};
      entry.result = { name: rc.playerName, level: rc.level, playerId: rc.playerId, rating: rc.rating, random: rc.combinationType === 'allDifferent' };
      this.run.counts[level].ok += 1;
      const o = this.run.obtained.find(x => x.playerId === rc.playerId && x.level === rc.level);
      if (o) o.count += 1; else this.run.obtained.push({ playerId: rc.playerId, name: rc.playerName, level: rc.level, rating: rc.rating, count: 1 });
      this._log(account, 'success', 'sy.ok', { from: level, to: level + 1, used: names.join(', '), result: rc.playerName || '?', resultLevel: rc.level ?? null }, `${level}★→${level + 1}★ · ${names.join(', ')} → ${rc.playerName}`);
    } else {
      // The card given back is named in the message when the game says it.
      const rb = r.returnedCard;
      const back = rb ? { name: rb.playerName, playerId: rb.playerId } : cards.find(c => (r.message || '').includes(c.name));
      entry.result = back ? { name: back.name, level, playerId: back.playerId, returned: true } : null;
      this.run.counts[level].fail += 1;
      this._log(account, 'warning', 'sy.fail', { from: level, to: level + 1, used: names.join(', '), message: r.message || '', resultLevel: r.returnedCard?.level ?? null, byInventory: Boolean(r.verified) }, `${level}★→${level + 1}★ failed · ${names.join(', ')} · ${r.message || ''}`);
    }
    this.run.obtained = this.run.obtained.filter(x => x.count > 0);
    this.run.current = { level, used: names, result: entry.result, ok: r.ok };
    this.run.history = [entry, ...this.run.history].slice(0, 200);
    this.onChanged();
  }
}

module.exports = { SynthesisService, waitSeconds };
