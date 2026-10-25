const { GameSocket } = require('./game-socket.cjs');

// Things the game tells every client by itself, heard without signing in:
//   /chat-socket/ salaryUpdateComplete  (players re-ranked and resalaried, once a day)
// and the "signed in elsewhere" kicks of our own connections (GameSocket.onKick),
// written to Activity with the service that lost the account and the one that took it.
const CHAT_PATH = '/chat-socket/';
const RETRY_MS = 5 * 60 * 1000;
const SALARY_DEDUPE_MS = 10 * 60 * 1000;

class GameEvents {
  constructor({ store, activity, createSocket, onSalaryUpdate = () => {}, now = () => Date.now() }) {
    this.store = store;
    this.activity = activity;
    this.createSocket = createSocket;
    this.onSalaryUpdate = onSalaryUpdate;
    this.now = now;
    this.chat = null;
    this.timer = null;
    this.lastSalaryAt = 0;
    this.stopped = false;
  }

  start() {
    GameSocket.onKick(info => this._kick(info));
    this._listen();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    try { this.chat?.close(); } catch {}
    this.chat = null;
  }

  async _listen() {
    if (this.stopped) return;
    try {
      this.chat = await GameSocket.open({ createSocket: this.createSocket, path: CHAT_PATH });
      this.chat.socket.on('salaryUpdateComplete', () => this._salary());
    } catch {
      this.timer = setTimeout(() => this._listen(), RETRY_MS);
      this.timer.unref?.();
    }
  }

  _salary() {
    if (this.now() - this.lastSalaryAt < SALARY_DEDUPE_MS) return;
    this.lastSalaryAt = this.now();
    this.activity.add({ level: 'info', accountId: 'game', accountName: '', taskName: 'Game', code: 'ge.salaryUpdated', params: {}, message: 'The game finished the daily salary update · players are read again now' });
    Promise.resolve().then(() => this.onSalaryUpdate()).catch(() => {});
  }

  _account(userId) {
    const profile = this.store.getAccountProfile?.()?.accounts || {};
    const id = Object.keys(profile).find(key => String(profile[key]?.userId) === String(userId));
    return (this.store.getAccounts?.() || []).find(a => a.id === id) || null;
  }

  _kick({ userId, owner, by, count, waitMs, slowed, gaveUp }) {
    const account = this._account(userId);
    const base = { accountId: account?.id || 'game', accountName: account?.name || '', taskName: owner };
    const who = by || 'Game';
    if (gaveUp) {
      this.activity.add({ ...base, level: 'error', code: 'gs.gaveUp', params: { service: owner, by: who, count },
        message: `${owner}: the account was signed in elsewhere (${who}) ${count} times in 10 minutes · stopped signing in again so the two do not keep kicking each other` });
    } else if (slowed) {
      this.activity.add({ ...base, level: 'warning', code: 'gs.pingPong', params: { service: owner, by: who, count, sec: Math.round(waitMs / 1000) },
        message: `${owner} and ${who} keep taking the account from each other (${count}×) · waiting ${Math.round(waitMs / 1000)} s before signing in again` });
    } else {
      this.activity.add({ ...base, level: 'warning', code: by ? 'gs.kicked' : 'gs.kickedByGame', params: { service: owner, by: who },
        message: `${owner} connection was signed out because ${!by ? 'the account was opened in the game' : `${who} signed the account in`} · it signs in again on its next request` });
    }
  }
}

module.exports = { GameEvents };
