const { GameSocket } = require('./game-socket.cjs');

// Friends, private chat, blocked players and the mail box (read from the game client
// and tried live 2026-10-25). Everything goes over /socket/:
//   reads need only the user id, no sign-in (one shared plain socket for every account):
//     getFriendsBootstrap {userId} (ack) -> {success, friends, requests, sent, blocked, unreadCounts, totalUnread} (2026-11-05;
//       the old getFriendsList / searchUsers are gone, there is no user search any more)
//     getFriendsList {userId}            -> friendsListUpdate {friends:[{id, teamName, avatarUrl, online, friendshipId}]} (before)
//     getFriendRequests {userId}         -> friendRequestsUpdate {requests}
//     getUnreadMessageCounts {userId}    -> unreadMessageCounts {success, totalUnread, unreadCounts:[{senderId, unreadCount}]}
//     getPrivateMessages {userId, friendId, limit} -> privateMessageHistory {success, messages}
//     getUserMails {userId} (ack)        -> {success, mails:[{id, subject, content, isClaimed, items:[...]}]}
//     GET /api/friends?userId&type=sent|blocked -> {sentRequests} / {blockedUsers:[{blocked}]}
//   writes use the account's session cookie (no `register`, so nothing is signed out):
//     sendPrivateMessage {senderId, receiverId, message} -> privateMessageSent {success, message}
//     acceptFriendRequest / declineFriendRequest / cancelFriendRequest {userId, friendshipId} -> friendRequestActionResult
//     searchUsers {userId, teamName} -> searchResults {success, users:[{id, teamName, level, online, friendshipStatus NONE|PENDING|ACCEPTED}]} (read)
//     sendFriendRequest {userId, targetUserId} -> friendRequestResult
//     removeFriend {userId, friendId} -> friendActionResult;  unblockUser {userId, blockedUserId} -> blockActionResult
//     markConversationAsRead {userId, friendId};  claimMailItems {mailId} / claimAllMailItems {userId} (acks)
// The game only pushes new messages / requests to a registered socket, so the app polls.
// The game wipes chat history every day around 19:00 TR; the app keeps what it has seen
// for one more game day.
const SITE = 'https://www.dreamteamph.com';
const TR_OFFSET_MS = 3 * 3600 * 1000;
const WIPE_MS = 19 * 3600 * 1000;           // chat wipe, 19:00 TR
const DAY_MS = 24 * 3600 * 1000;
const POLL_MS = 60 * 1000;                  // badges: requests, unread messages, mail (13 accounts ≈ 10 s, no sign-in)
const SWEEP_MS = 60 * 60 * 1000;            // every conversation copied into the archive
const SWEEP_BEFORE_WIPE_MS = 12 * 60 * 1000; // ...and once more at 18:48 TR
const TIMEOUT_MS = 10000;

// Start of the game's chat day (the last 19:00 TR at or before `ms`).
function chatDayStart(ms) {
  const tr = ms + TR_OFFSET_MS;
  const start = Math.floor((tr - WIPE_MS) / DAY_MS) * DAY_MS + WIPE_MS;
  return start - TR_OFFSET_MS;
}
// Kept: this chat day and the one before it.
function keepFrom(ms) { return chatDayStart(ms) - DAY_MS; }

function mergeMessages(old = [], fresh = [], from) {
  const byId = new Map();
  for (const m of [...old, ...fresh]) if (m?.id) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()]
    .filter(m => Date.parse(m.timestamp) >= from)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

const unclaimedMails = mails => (mails || []).filter(m => !m.isClaimed && Array.isArray(m.items) && m.items.length);
// A friend request in either shape: before 2026-11-05 {id: friendshipId, from|sender|friend|receiver: {user}},
// since then flat {friendshipId, id: the other user's id, teamName, avatarUrl, ...}. Always gives
// friendshipId (for accept / decline / cancel) and user {id, teamName, avatarUrl}.
function normRequest(r) {
  if (!r || typeof r !== 'object') return null;
  const nested = [r.from, r.user, r.sender, r.friend, r.receiver, r.to].find(x => x && typeof x === 'object') || null;
  const u = nested || r;
  return {
    ...r,
    friendshipId: r.friendshipId || r.id,
    user: { id: u.id ?? r.userId ?? r.senderId ?? r.receiverId ?? null, teamName: u.teamName || r.teamName || null, avatarUrl: u.avatarUrl || r.avatarUrl || null, level: u.level ?? r.level ?? null }
  };
}
const normRequests = list => (Array.isArray(list) ? list : []).map(normRequest).filter(Boolean);
// Unread counts from getFriendsBootstrap / unreadMessageCounts: [{senderId, unreadCount}] or {friendId: n}.
function parseUnread(counts, total) {
  const by = {};
  if (Array.isArray(counts)) {
    for (const u of counts) { const k = u?.senderId || u?.friendId || u?.userId; if (k) by[k] = Number(u.unreadCount ?? u.count) || 0; }
  } else if (counts && typeof counts === 'object') {
    for (const [k, v] of Object.entries(counts)) by[k] = Number(v) || 0;
  }
  const sum = Object.values(by).reduce((a, b) => a + b, 0);
  return { total: Number(total) || sum, by };
}
const POLL_PARALLEL = 6;
const itemName = it => it?.itemDetail?.name || it?.metadata?.name || it?.item?.name || it?.itemName || it?.name || it?.itemType || '?';

class SocialService {
  constructor({ store, activity, sessions, onChanged, createSocket, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), timing = {} }) {
    Object.assign(this, { store, activity, sessions, createSocket, now });
    this.fetch = fetchImpl;
    this.onChanged = onChanged || (() => {});
    this.timing = { pollMs: POLL_MS, sweepMs: SWEEP_MS, ...timing };
    this.badges = {};       // accountId -> { requests, unread, mail, unreadBy: {friendId: n} }
    this.seen = {};         // accountId -> { requests:Set, unread:{friendId:n} } to spot new ones
    this.views = {};        // accountId -> last full view (friends, requests, sent, blocked, mails)
    this.writers = new Map(); // accountId -> { gs, timer } cookie sockets for writes
    this.socks = {};        // plain read sockets: ui (the page), bg (badges), sweep (archive); the page never waits behind the background
    this.running = {};
    this.polledAt = null;
    this.timers = [];
  }

  // ---------- plumbing ----------
  _accounts() { return this.store.getAccounts?.() || []; }
  _account(id) { return this._accounts().find(a => a.id === id) || null; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || 'social', accountName: id ? (this._account(id)?.name || '') : '', taskName: 'Social', code, params, message });
  }

  async _read(kind = 'ui') {
    const held = this.socks[kind];
    if (held?.then) return held;
    if (held?.socket?.connected) return held;
    try { held?.close?.(); } catch {}
    const opening = GameSocket.open({ createSocket: this.createSocket });
    this.socks[kind] = opening;
    try { return (this.socks[kind] = await opening); } catch (e) { delete this.socks[kind]; throw e; }
  }
  // One background job of a kind at a time (a slow round must not pile up on the next one).
  _once(kind, fn) {
    if (this.running[kind]) return this.running[kind];
    this.running[kind] = (async () => { try { return await fn(); } finally { this.running[kind] = null; } })();
    return this.running[kind];
  }

  // A user id for any account: from the profile, or one sign-in that also gives the cookie.
  async _uid(id) {
    const known = this._userId(id);
    if (known) return known;
    const account = this._account(id);
    if (!account) throw new Error('Account not found.');
    return (await this.sessions.get(account, { owner: 'social' })).userId;
  }

  // Cookie socket for writes, closed after a minute of quiet.
  async _writer(id) {
    const held = this.writers.get(id);
    if (held?.gs?.socket?.connected) { this._touch(id); return held; }
    try { held?.gs?.close(); } catch {}
    const account = this._account(id);
    if (!account) throw new Error('Account not found.');
    const session = await this.sessions.get(account, { owner: 'social' });
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader });
    const conn = { gs, userId: session.userId, timer: null };
    this.writers.set(id, conn);
    this._touch(id);
    return conn;
  }
  _touch(id) {
    const c = this.writers.get(id);
    if (!c) return;
    clearTimeout(c.timer);
    c.timer = setTimeout(() => { try { c.gs.close(); } catch {} this.writers.delete(id); }, 60000);
    c.timer.unref?.();
  }

  async _rest(userId, type) {
    const res = await this.fetch(`${SITE}/api/friends?userId=${encodeURIComponent(userId)}&type=${type}`, { headers: { accept: 'application/json' } });
    const body = await res.json();
    if (!body?.success) throw new Error(body?.error || `friends ${type} could not be read`);
    return body;
  }

  // ---------- reads ----------
  async _friends(gs, userId) {
    const r = await gs.call('getFriendsList', { userId }, 'friendsListUpdate', { timeoutMs: TIMEOUT_MS });
    return Array.isArray(r?.friends) ? r.friends : [];
  }
  // Friends, requests, sent, blocked in one answer (the game's friends panel since 2026-11-05).
  async _bootstrap(gs, userId) {
    const r = await gs.ack('getFriendsBootstrap', { userId }, { timeoutMs: TIMEOUT_MS });
    if (!r?.success) throw new Error(r?.error || r?.message || 'friends could not be read');
    return r;
  }
  async _requests(gs, userId) {
    const r = await gs.call('getFriendRequests', { userId }, 'friendRequestsUpdate', { timeoutMs: TIMEOUT_MS });
    return Array.isArray(r?.requests) ? r.requests : [];
  }
  async _unread(gs, userId) {
    const r = await gs.call('getUnreadMessageCounts', { userId }, 'unreadMessageCounts', { timeoutMs: TIMEOUT_MS });
    return parseUnread(r?.unreadCounts, r?.totalUnread);
  }
  // Unread counts that came with the bootstrap; the old event when they are missing or do not add up.
  async _unreadOf(boot, gs, userId) {
    if (boot && boot.unreadCounts && typeof boot.unreadCounts === 'object') {
      const u = parseUnread(boot.unreadCounts, boot.totalUnread);
      if (!u.total || Object.keys(u.by).length) return u;
    }
    return this._unread(gs, userId);
  }
  async _mails(gs, userId) {
    const r = await gs.ack('getUserMails', { userId }, { timeoutMs: TIMEOUT_MS });
    if (!r?.success) throw new Error(r?.message || r?.error || 'mail box could not be read');
    return Array.isArray(r.mails) ? r.mails : [];
  }
  async _history(gs, userId, friendId) {
    const r = await gs.call('getPrivateMessages', { userId, friendId, limit: 50 }, 'privateMessageHistory', { timeoutMs: TIMEOUT_MS });
    return Array.isArray(r?.messages) ? r.messages : [];
  }

  // Everything the page shows for one account.
  async view(id) {
    const userId = await this._uid(id);
    const gs = await this._read('ui');
    const mailsP = this._mails(gs, userId);
    mailsP.catch(() => {});
    let boot = await this._bootstrap(gs, userId).catch(() => null);
    if (!boot) boot = await this._writer(id).then(w => this._bootstrap(w.gs, w.userId)).catch(() => null);
    const [friends, requests, unread, mails, sent, blocked] = boot ? [
      boot.friends || [], normRequests(boot.requests), await this._unreadOf(boot, gs, userId), await mailsP,
      normRequests(boot.sent), (boot.blocked || []).map(x => x?.blocked || x).filter(Boolean)
    ] : [
      await this._friends(gs, userId), normRequests(await this._requests(gs, userId)), await this._unread(gs, userId), await mailsP,
      await this._rest(userId, 'sent').then(b => normRequests(b.sentRequests)).catch(() => null),
      await this._rest(userId, 'blocked').then(b => (b.blockedUsers || []).map(x => x?.blocked || x).filter(Boolean)).catch(() => null)
    ];
    const archive = this._archive().accounts?.[id] || {};
    const view = {
      accountId: id, userId, loadedAt: new Date(this.now()).toISOString(),
      friends: friends.map(f => ({ ...f, unread: unread.by[f.id] || 0, archived: (archive[f.id]?.messages || []).length })),
      requests, sent, blocked, mails, unread: unread.total
    };
    this.views[id] = view;
    this._setBadge(id, { requests: requests.length, unread: unread.total, mail: unclaimedMails(mails).length, unreadBy: unread.by });
    return view;
  }

  // One conversation: the game's copy merged with the app's archive (older than the wipe).
  async conversation(id, friendId) {
    const userId = await this._uid(id);
    const fresh = await this._history(await this._read('ui'), userId, friendId);
    const friend = this.views[id]?.friends?.find(f => f.id === friendId);
    const messages = this._remember(id, friendId, fresh, friend?.teamName);
    // Opening a chat reads it, as in the game.
    if ((this.badges[id]?.unreadBy?.[friendId] || 0) > 0) {
      try {
        const w = await this._writer(id);
        w.gs.socket.emit('markConversationAsRead', { userId: w.userId, friendId });
      } catch {}
      const by = { ...(this.badges[id]?.unreadBy || {}) };
      delete by[friendId];
      this._setBadge(id, { ...this.badges[id], unreadBy: by, unread: Object.values(by).reduce((a, b) => a + b, 0) });
      if (this.seen[id]) this.seen[id].unread = { ...by };
    }
    return { friendId, userId, messages };
  }

  // ---------- writes ----------
  async send(id, friendId, text) {
    const message = String(text || '').trim();
    if (!message) throw new Error('Write a message first.');
    const w = await this._writer(id);
    const r = await w.gs.call('sendPrivateMessage', { senderId: w.userId, receiverId: friendId, message }, 'privateMessageSent', { timeoutMs: TIMEOUT_MS });
    if (!r?.success) throw new Error(r?.error || r?.message || 'The message was not sent.');
    this._remember(id, friendId, [r.message], this.views[id]?.friends?.find(f => f.id === friendId)?.teamName);
    return r.message;
  }

  // accept / decline / cancel (friendshipId), remove (friend id), unblock (user id)
  async act(id, action, targetId) {
    const w = await this._writer(id);
    const spec = {
      request: ['sendFriendRequest', { targetUserId: targetId }, 'friendRequestResult'],
      accept: ['acceptFriendRequest', { friendshipId: targetId }, 'friendRequestActionResult'],
      decline: ['declineFriendRequest', { friendshipId: targetId }, 'friendRequestActionResult'],
      cancel: ['cancelFriendRequest', { friendshipId: targetId }, 'friendRequestActionResult'],
      remove: ['removeFriend', { friendId: targetId }, 'friendActionResult'],
      unblock: ['unblockUser', { blockedUserId: targetId }, 'blockActionResult']
    }[action];
    if (!spec) throw new Error(`Unknown action: ${action}`);
    const [event, payload, reply] = spec;
    const r = await w.gs.call(event, { userId: w.userId, ...payload }, reply, { timeoutMs: TIMEOUT_MS });
    if (!r?.success) throw new Error(r?.error || r?.message || 'The game refused it.');
    this._log(id, 'success', `so.${action}`, { name: this._targetName(id, action, targetId) }, `${action}: ${this._targetName(id, action, targetId)}`);
    return this.view(id);
  }

  // The game has no user search any more (2026-11-05): own accounts whose name contains
  // `text`, with the friendship status this account sees (accounts befriend each other
  // to sign from each other's Scout).
  async search(id, text) {
    const q = String(text || '').trim().toLowerCase();
    if (!q) return [];
    const userId = await this._uid(id);
    const v = this.views[id] || {};
    const friendIds = new Set((v.friends || []).map(f => f.id));
    const pendingIds = new Set([...(v.sent || []), ...(v.requests || [])].map(x => x?.user?.id || x?.receiver?.id || x?.receiverId || x?.sender?.id || x?.senderId || x?.id).filter(Boolean));
    const out = [];
    for (const a of this._accounts()) {
      if (a.id === id || !String(a.name || '').toLowerCase().includes(q)) continue;
      const uid = this._userId(a.id);
      if (!uid || uid === userId) continue;
      out.push({ id: uid, teamName: a.name, level: this.store.getAccountProfile?.()?.accounts?.[a.id]?.level ?? null, own: true, friendshipStatus: friendIds.has(uid) ? 'ACCEPTED' : pendingIds.has(uid) ? 'PENDING' : 'NONE' });
    }
    this.searched = { ...(this.searched || {}), ...Object.fromEntries(out.map(u => [u.id, u.teamName])) };
    return out;
  }

  // A friend's Scout board (6 free agents, refreshed every 30 min) and signing from it.
  async friendScout(id, friendId) {
    const w = await this._writer(id);
    const r = await w.gs.ack('getFriendFreeAgents', { userId: w.userId, friendId }, { timeoutMs: TIMEOUT_MS });
    if (!r?.success) throw new Error(r?.error || r?.message || 'The board could not be read.');
    return { friend: r.friend || null, freeAgents: r.freeAgents || [], refreshesIn: Number(r.refreshesIn) || 0, at: new Date(this.now()).toISOString() };
  }
  async friendSign(id, friendId, playerId) {
    const w = await this._writer(id);
    const r = await w.gs.ack('signFriendFreeAgent', { userId: w.userId, friendId, playerId }, { timeoutMs: TIMEOUT_MS });
    if (!r?.success) throw new Error(r?.message || r?.error || 'The player could not be signed.');
    const p = r.revealedPlayer || (r.freeAgents || []).find(x => x.id === playerId) || {};
    const friendName = this.views[id]?.friends?.find(f => f.id === friendId)?.teamName || '?';
    this._log(id, 'success', 'so.friendSigned', { name: p.name || '?', friend: friendName }, `Signed ${p.name || '?'} from ${friendName}'s Scout`);
    return { freeAgents: r.freeAgents || [], player: p };
  }

  _targetName(id, action, targetId) {
    if (action === 'request') return this.searched?.[targetId] || '?';
    const v = this.views[id] || {};
    const pick = list => (list || []).find(x => x?.id === targetId || x?.friendshipId === targetId);
    const x = pick(v.requests) || pick(v.sent) || pick(v.friends) || pick(v.blocked);
    return x?.teamName || x?.from?.teamName || x?.user?.teamName || x?.friend?.teamName || x?.sender?.teamName || x?.receiver?.teamName || '?';
  }

  // One mail (mailId) or every mail with rewards (null).
  async claimMail(id, mailId = null) {
    const w = await this._writer(id);
    const before = this.views[id]?.mails || [];
    const targets = mailId ? before.filter(m => m.id === mailId) : unclaimedMails(before);
    // one by one: the game removed claimAllMailItems (2026-11-05)
    let ok = 0, r = null;
    for (const m of (mailId ? [{ id: mailId }] : targets)) {
      r = await w.gs.ack('claimMailItems', { mailId: m.id }, { timeoutMs: TIMEOUT_MS });
      if (r?.success) ok++;
    }
    if (!ok) throw new Error(r?.message || r?.error || 'The rewards could not be claimed.');
    const totals = new Map();
    for (const m of targets) for (const it of m.items || []) totals.set(itemName(it), (totals.get(itemName(it)) || 0) + (Number(it.quantity ?? it.amount) || 1));
    const items = [...totals].map(([n, q]) => `${q} ${n}`).join(', ');
    this._log(id, 'success', 'ml.claimed', { count: targets.length || 1, items: items || '—' }, `Mail rewards claimed · ${targets.length || 1} mail(s)${items ? ` · ${items}` : ''}`);
    return this.view(id);
  }

  // ---------- archive ----------
  _archive() { return this.store.getSocialArchive?.() || { version: 1, accounts: {} }; }
  _remember(id, friendId, fresh, name) {
    const data = this._archive();
    const from = keepFrom(this.now());
    const accounts = { ...(data.accounts || {}) };
    const mine = { ...(accounts[id] || {}) };
    const old = mine[friendId] || { name: name || null, messages: [] };
    mine[friendId] = { name: name || old.name, messages: mergeMessages(old.messages, fresh, from) };
    accounts[id] = mine;
    this.store.saveSocialArchive?.({ version: 1, accounts });
    return mine[friendId].messages;
  }
  _prune() {
    const data = this._archive();
    const from = keepFrom(this.now());
    const accounts = {};
    for (const [id, convs] of Object.entries(data.accounts || {})) {
      const kept = {};
      for (const [fid, c] of Object.entries(convs || {})) {
        const messages = (c.messages || []).filter(m => Date.parse(m.timestamp) >= from);
        if (messages.length) kept[fid] = { ...c, messages };
      }
      if (Object.keys(kept).length) accounts[id] = kept;
    }
    this.store.saveSocialArchive?.({ version: 1, accounts });
  }

  // Copies every conversation of every account into the archive (no sign-in).
  sweep() { return this._once('sweep', () => this._sweep()); }
  async _sweep() {
    const gs = await this._read('sweep');
    for (const a of this._accounts()) {
      const userId = this._userId(a.id);
      if (!userId) continue;
      try {
        const boot = await this._bootstrap(gs, userId).catch(() => null);
        for (const f of boot ? (boot.friends || []) : await this._friends(gs, userId)) {
          const fresh = await this._history(gs, userId, f.id);
          if (fresh.length) this._remember(a.id, f.id, fresh, f.teamName);
        }
      } catch {}
    }
    this._prune();
  }

  // ---------- badges ----------
  _setBadge(id, badge) {
    this.badges[id] = badge;
    this.onChanged();
  }

  // Badges of every account: one bootstrap + the mail box each (both acks, so a few accounts at once).
  poll() { return this._once('poll', () => this._poll()); }
  async _poll() {
    const gs = await this._read('bg');
    const queue = this._accounts().filter(a => this._userId(a.id));
    const one = async a => {
      const userId = this._userId(a.id);
      try {
        const [boot, mails] = await Promise.all([this._bootstrap(gs, userId).catch(() => null), this._mails(gs, userId)]);
        const requests = boot ? normRequests(boot.requests) : normRequests(await this._requests(gs, userId));
        const unread = await this._unreadOf(boot, gs, userId);
        this._notice(a, requests, unread);
        this.badges[a.id] = { requests: requests.length, unread: unread.total, mail: unclaimedMails(mails).length, unreadBy: unread.by };
        // New messages go to the archive at once, before a wipe can take them.
        for (const [friendId, n] of Object.entries(unread.by)) if (n > 0) this._remember(a.id, friendId, await this._history(gs, userId, friendId));
      } catch {}
    };
    await Promise.all(Array.from({ length: Math.min(POLL_PARALLEL, queue.length) }, async () => { while (queue.length) await one(queue.shift()); }));
    this.polledAt = new Date(this.now()).toISOString();
    this.onChanged();
  }

  // Activity (and a Windows notification) for a request or message that was not there before.
  _notice(account, requests, unread) {
    // The first look after the app starts counts everything still waiting as new, so a
    // message that came while the app was closed is announced too.
    const before = this.seen[account.id] || { requests: new Set(), unread: {} };
    const ids = new Set(requests.map(r => r.friendshipId || r.id));
    {
      for (const r of requests) {
        if (before.requests.has(r.friendshipId || r.id)) continue;
        const from = r.user?.teamName || r.from?.teamName || r.user?.teamName || r.sender?.teamName || r.teamName || '?';
        this._log(account.id, 'info', 'so.newRequest', { from }, `New friend request from ${from}`);
      }
      for (const [friendId, n] of Object.entries(unread.by)) {
        if (n <= (before.unread[friendId] || 0)) continue;
        const from = this.views[account.id]?.friends?.find(f => f.id === friendId)?.teamName
          || this._archive().accounts?.[account.id]?.[friendId]?.name || '?';
        this._log(account.id, 'info', 'so.newMessage', { from, count: n }, `New message from ${from} (${n} unread)`);
      }
    }
    this.seen[account.id] = { requests: ids, unread: { ...unread.by } };
  }

  snapshot() {
    const totals = { requests: 0, unread: 0, mail: 0 };
    for (const b of Object.values(this.badges)) { totals.requests += b.requests || 0; totals.unread += b.unread || 0; totals.mail += b.mail || 0; }
    return { badges: this.badges, totals, polledAt: this.polledAt };
  }

  start() {
    const every = (ms, fn) => { const t = setInterval(() => fn().catch(() => {}), ms); t.unref?.(); this.timers.push(t); };
    every(this.timing.pollMs, () => this.poll());
    every(this.timing.sweepMs, () => this.sweep());
    const armWipe = () => {
      const next = chatDayStart(this.now()) + DAY_MS - SWEEP_BEFORE_WIPE_MS;
      const wait = next > this.now() ? next - this.now() : next + DAY_MS - this.now();
      const t = setTimeout(() => { this.sweep().catch(() => {}).finally(armWipe); }, Math.min(wait, 2 ** 31 - 1));
      t.unref?.();
      this.timers.push(t);
    };
    armWipe();
    setTimeout(() => this.poll().then(() => this.sweep()).catch(() => {}), 5000).unref?.();
  }

  stop() {
    for (const t of this.timers) { clearInterval(t); clearTimeout(t); }
    this.timers = [];
    for (const s of Object.values(this.socks)) { try { s?.close?.(); } catch {} }
    this.socks = {};
    for (const c of this.writers.values()) { clearTimeout(c.timer); try { c.gs.close(); } catch {} }
    this.writers.clear();
  }
}

module.exports = { SocialService, chatDayStart, keepFrom, mergeMessages, unclaimedMails, normRequest, parseUnread };
