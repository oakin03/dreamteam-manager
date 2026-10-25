const { GameSocket } = require('./game-socket.cjs');

// Things the game tells every client by itself, heard without signing in:
//   /chat-socket/ salaryUpdateComplete  (players re-ranked and resalaried, once a day)
//   /chat-socket/ getInitialGlobalMessages -> initialGlobalMessages {success, messages} (last 10)
//                 newMessage {userId, teamName, title, titleColor, type:'all'|..., text, timestamp}
// The global chat is kept for two days (chat-history.json) for the Daily page.
// and the "signed in elsewhere" kicks of our own connections (GameSocket.onKick),
// written to Activity with the service that lost the account and the one that took it.
const CHAT_PATH = '/chat-socket/';
const RETRY_MS = 5 * 60 * 1000;
const SALARY_DEDUPE_MS = 10 * 60 * 1000;
const CHAT_KEEP_MS = 2 * 24 * 3600 * 1000;
const CHAT_MAX = 1500;

class GameEvents {
  constructor({ store, activity, createSocket, onSalaryUpdate = () => {}, onChat = () => {}, now = () => Date.now() }) {
    this.onChat = onChat;
    this.chatSaveTimer = null;
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
      this.chat.socket.on('initialGlobalMessages', d => { if (d?.success) this._chatAdd(d.messages || []); });
      this.chat.socket.on('newMessage', m => { if (m?.type === 'all') this._chatAdd([m]); });
      // after every (re)connect the last messages are asked again; duplicates are dropped
      const ask = () => { try { this.chat.socket.emit('getInitialGlobalMessages'); } catch {} };
      this.chat.socket.on('connect', ask);
      ask();
    } catch {
      this.timer = setTimeout(() => this._listen(), RETRY_MS);
      this.timer.unref?.();
    }
  }

  // Global chat kept for two days, newest last.
  _chatAdd(list) {
    const data = { messages: [...(this.chatCache || this.store.getChatHistory?.()?.messages || [])] };
    const key = m => `${m.userId}|${m.timestamp}|${m.text}`;
    const seen = new Set(data.messages.map(key));
    let added = 0;
    for (const m of list) {
      if (!m?.text || seen.has(key(m))) continue;
      seen.add(key(m));
      data.messages.push({ userId: m.userId, teamName: m.teamName, title: m.title || null, text: String(m.text), timestamp: Number(m.timestamp) || this.now() });
      added++;
    }
    if (!added) return;
    const from = this.now() - CHAT_KEEP_MS;
    data.messages = data.messages.filter(m => m.timestamp >= from).sort((a, b) => a.timestamp - b.timestamp).slice(-CHAT_MAX);
    this.chatCache = data.messages;
    clearTimeout(this.chatSaveTimer);
    this.chatSaveTimer = setTimeout(() => this.store.saveChatHistory?.({ version: 1, messages: this.chatCache }), 3000);
    this.chatSaveTimer.unref?.();
    this.onChat();
  }

  chatFeed(limit = 200) {
    const all = this.chatCache || (this.chatCache = (this.store.getChatHistory?.()?.messages) || []);
    return all.slice(-limit);
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
