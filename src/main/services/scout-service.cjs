const { GameSocket } = require('./game-socket.cjs');
const { TradeGameAccount } = require('./trade-game-client.cjs');

// Scout (Free Agency) over the game socket, no Chromium.
//   Reads, without logging in: getFreeAgent {userId} (ack) -> {freeAgents[6], attemptsLeft,
//   cooldownEnds}; getUserBasicInfo -> funds / salaryCap / totalSalaryUsed;
//   getTeamOptimized (ack) -> roster size.
//   Writes (registered connection, like Auto Trade): signFreeAgent {userId, playerId},
//   getFreeAgentAttempts + CallBackFreeAgent {userId}.
// Agents carry the game's player id, so cards and roles are matched by id.
const ROSTER_MAX = 11;
const ATTEMPTS_MAX = 3;
const READ_TIMEOUT_MS = 15000;

function agentFrom(a, index) {
  const price = Number(a.baseSalary);
  const last = Number(a.lastSalary);
  return {
    key: a.id, index, playerId: a.id,
    name: a.visualName || a.name || '', fullName: a.name || '',
    position: a.position || '', grade: a.rating || '',
    price: Number.isFinite(price) ? price : null,
    base: Number.isFinite(Number(a.newBaseSalary)) ? Number(a.newBaseSalary) : null,
    lastSalary: Number.isFinite(last) ? last : null,
    change: Number.isFinite(price) && Number.isFinite(last) ? price - last : null,
    offense: a.offense ?? null, defense: a.defense ?? null,
    rank: a.rank ?? null, team: a.team || null, type: a.type || null,
    signed: Boolean(a.isSigned), canSign: !a.isSigned
  };
}

class ScoutService {
  constructor({ store, activity, sessions, cardsService = null, accountProfile = null, gameHealth = null, onChanged, createSocket }) {
    Object.assign(this, { store, activity, sessions, accountProfile, gameHealth, onChanged, createSocket });
    this.cards = cardsService;
    this.states = new Map();
  }

  accountById(id) {
    const account = this.store.getAccounts().find(a => a.id === id);
    if (!account) throw new Error('Account not found.');
    return account;
  }

  _state(id) {
    let s = this.states.get(id);
    if (!s) { s = { status: 'idle', data: null, error: null, open: false }; this.states.set(id, s); }
    return s;
  }

  snapshot() {
    const out = {};
    const revision = this.cards && typeof this.store?.revision === 'function'
      ? [this.store.revision('cards'), this.store.revision('cardMetadata'), this.store.revision('cardRoles')].join(':') : null;
    for (const [id, s] of this.states) {
      if (s.data?.agents && this.cards && (revision === null || s._cardsRevision !== revision)) {
        for (const agent of s.data.agents) {
          agent.card = this.cards.findForScout(agent);
          agent.cardTeam = agent.card?.team || null;
          agent.cardStars = agent.card?.stars ?? null;
          if (!agent.team && agent.card?.team) agent.team = agent.card.team;
        }
        s._cardsRevision = revision;
      }
      const { _cardsRevision, open, ...publicState } = s;
      // browserOpen: the page's "list is open" flag (kept for the existing UI).
      out[id] = { ...publicState, browserOpen: Boolean(open) };
    }
    return out;
  }

  _log(account, level, code, params, message) {
    this.activity.add({ level, accountId: account.id, accountName: account.name, taskName: 'Scout', code, params, message });
  }

  async _userId(account) {
    const known = this.store.getAccountProfile?.()?.accounts?.[account.id]?.userId;
    if (known) return known;
    const session = await this.sessions.get(account, { owner: 'scout' });
    return session.userId;
  }

  _setList(accountId, reply, extra = {}) {
    const state = this._state(accountId);
    const previous = state.data || {};
    state.data = {
      ...previous,
      agents: reply.freeAgents.map(agentFrom),
      attempts: reply.attemptsLeft ?? previous.attempts ?? null,
      attemptsMax: ATTEMPTS_MAX,
      cooldownEnds: Number(reply.cooldownEnds) || previous.cooldownEnds || null,
      rosterMax: ROSTER_MAX,
      ...extra,
      readAt: new Date().toISOString()
    };
    state._cardsRevision = null;
    return state.data;
  }

  // Auto Trade reads Scout over its own connection; the Scout page shows the same list.
  showSocketScout(accountId, reply) {
    if (!Array.isArray(reply?.freeAgents)) return;
    this._setList(accountId, reply, { source: 'auto-trade' });
    this.onChanged?.();
  }

  // Free agents + funds + roster, read without logging in.
  async _read(account) {
    if (this.gameHealth?.isDown()) throw new Error('The game is not reachable right now; try again shortly.');
    const userId = await this._userId(account);
    const conn = await GameSocket.open({ createSocket: this.createSocket });
    try {
      const fa = await conn.ack('getFreeAgent', { userId }, { timeoutMs: READ_TIMEOUT_MS });
      if (!Array.isArray(fa?.freeAgents)) throw new Error(fa?.message || fa?.error || 'The game did not send the Scout list.');
      const info = await conn.call('getUserBasicInfo', { userId }, 'userBasicInfo', { timeoutMs: READ_TIMEOUT_MS }).catch(() => null);
      const team = await conn.ack('getTeamOptimized', { userId }, { timeoutMs: READ_TIMEOUT_MS }).catch(() => null);
      const roster = team?.players ? (team.players.starters || []).length + (team.players.bench || []).length : null;
      const cap = Number(info?.salaryCap);
      const used = Number(info?.totalSalaryUsed);
      const data = this._setList(account.id, fa, {
        source: 'socket',
        funds: Number.isFinite(Number(info?.funds)) ? Number(info.funds) : null,
        salarySpace: Number.isFinite(cap) && Number.isFinite(used) ? cap - used : null,
        roster
      });
      this.accountProfile?.updateFromScout?.(account.id, data);
      return data;
    } finally {
      try { conn.close(); } catch {}
    }
  }

  async _run(accountId, status, work) {
    const account = this.accountById(accountId);
    const state = this._state(accountId);
    state.status = status;
    state.error = null;
    this.onChanged?.();
    try {
      const result = await work(account, state);
      state.status = 'open';
      state.open = true;
      return result;
    } catch (error) {
      state.status = 'error';
      state.error = error.message;
      this._log(account, 'error', 'sct.error', { error: error.message }, `Scout: ${error.message}`);
      throw error;
    } finally {
      this.onChanged?.();
    }
  }

  open(accountId) {
    return this._run(accountId, 'opening', async account => {
      const data = await this._read(account);
      this._log(account, 'info', 'sct.read', { count: data.agents.length, attempts: data.attempts }, `Scout list read · ${data.agents.length} player(s) · ${data.attempts ?? '—'} call back(s) left`);
      return data;
    });
  }

  refresh(accountId) {
    return this._run(accountId, 'refreshing', account => this._read(account));
  }

  // Writes go through a registered connection (signs the account out of an open game tab).
  async _write(account, fn) {
    if (this.gameHealth?.isDown()) throw new Error('The game is not reachable right now; try again shortly.');
    const client = await TradeGameAccount.open({ account, sessions: this.sessions, createSocket: this.createSocket });
    try { return await fn(client); } finally { client.close(); }
  }

  callback(accountId) {
    return this._run(accountId, 'callback', async account => {
      const r = await this._write(account, c => c.callback());
      if (r?.noAttempts) throw new Error('No Call Back attempts left.');
      if (!r?.success) throw new Error(r?.message || r?.error || 'Call Back failed.');
      const data = await this._read(account);
      this._log(account, 'success', 'sct.callback', { count: data.agents.length, attempts: data.attempts }, `Scout Call Back · new list · ${data.attempts ?? '—'} left`);
      return data;
    });
  }

  sign(accountId, playerKey) {
    return this._run(accountId, 'signing', async (account, state) => {
      const agent = state.data?.agents?.find(a => a.key === playerKey || a.playerId === playerKey);
      if (!agent) throw new Error('This player is no longer in the Scout list; refresh it.');
      if (agent.signed) throw new Error('This player was already signed.');
      const r = await this._write(account, c => c.sign(agent.playerId));
      if (!r?.success) throw new Error(r?.message || r?.error || 'The game refused the signing.');
      const data = await this._read(account);
      this._log(account, 'success', 'sct.signed', { name: agent.name, price: agent.price }, `Scout · ${agent.name} signed · ${agent.price ?? '—'} TK`);
      return data;
    });
  }

  async close(accountId) {
    const state = this.states.get(accountId);
    if (state) { state.open = false; state.status = 'idle'; state.error = null; }
    this.onChanged?.();
    return { ok: true };
  }

  async shutdown() {}
}

module.exports = { ScoutService, agentFrom };
