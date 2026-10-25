const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SocialService, chatDayStart, keepFrom, mergeMessages } = require('../src/main/services/social-service.cjs');

const H = 3600 * 1000;
// 2026-10-25 12:00 TR = 09:00 UTC
const NOW = Date.parse('2026-10-25T09:00:00Z');

test('Chat days start at 19:00 TR and the archive keeps this day and the one before', () => {
  assert.equal(new Date(chatDayStart(NOW)).toISOString(), '2026-10-24T16:00:00.000Z');
  assert.equal(new Date(chatDayStart(Date.parse('2026-10-25T16:30:00Z'))).toISOString(), '2026-10-25T16:00:00.000Z');
  assert.equal(new Date(keepFrom(NOW)).toISOString(), '2026-10-23T16:00:00.000Z');
  const msgs = mergeMessages(
    [{ id: 'a', timestamp: '2026-10-22T10:00:00Z' }, { id: 'b', timestamp: '2026-10-24T10:00:00Z', isRead: false }],
    [{ id: 'b', timestamp: '2026-10-24T10:00:00Z', isRead: true }, { id: 'c', timestamp: '2026-10-25T08:00:00Z' }],
    keepFrom(NOW));
  assert.deepEqual(msgs.map(m => m.id), ['b', 'c'], 'too old dropped, duplicates merged, sorted');
  assert.equal(msgs[0].isRead, true);
});

function fakeGame() {
  const state = {
    friends: [{ id: 'f1', teamName: 'Yozgt66ers', online: false, friendshipId: 'fs1' }, { id: 'f2', teamName: 'Bandirma', online: true, friendshipId: 'fs2' }],
    requests: [], unread: [], history: { f1: [{ id: 'm1', senderId: 'f1', receiverId: 'u1', message: 'hi', timestamp: '2026-10-25T08:00:00Z' }], f2: [] },
    mails: [{ id: 'mail1', subject: 'Comp', isClaimed: false, items: [{ itemType: 'MATERIAL', quantity: 10, itemDetail: { name: 'Refine Ore' } }] }],
    cookies: [], writes: []
  };
  const createSocket = (_u, options) => {
    const s = new EventEmitter();
    s.connected = true; s.off = s.removeListener; s.close = () => { s.connected = false; };
    const local = (...a) => EventEmitter.prototype.emit.apply(s, a);
    const cookie = options.extraHeaders?.Cookie || null;
    state.cookies.push(cookie);
    s.emit = (event, p) => {
      setImmediate(() => {
        if (cookie) state.writes.push({ event, p });
        if (event === 'getFriendsList') local('friendsListUpdate', { friends: state.friends });
        if (event === 'getFriendRequests') local('friendRequestsUpdate', { requests: state.requests });
        if (event === 'getUnreadMessageCounts') local('unreadMessageCounts', { success: true, totalUnread: state.unread.reduce((a, u) => a + u.unreadCount, 0), unreadCounts: state.unread });
        if (event === 'getPrivateMessages') local('privateMessageHistory', { success: true, messages: state.history[p.friendId] || [] });
        if (event === 'sendPrivateMessage') { const m = { id: 'm' + Date.now(), senderId: p.senderId, receiverId: p.receiverId, message: p.message, timestamp: '2026-10-25T09:00:00Z' }; local('privateMessageSent', { success: true, message: m }); }
        if (event === 'acceptFriendRequest') { state.requests = []; state.friends.push({ id: 'f3', teamName: 'New', friendshipId: p.friendshipId }); local('friendRequestActionResult', { success: true }); }
        if (event === 'removeFriend') { state.friends = state.friends.filter(f => f.id !== p.friendId); local('friendActionResult', { success: true }); }
      });
      return true;
    };
    s.timeout = () => ({ emit: (event, p, cb) => setImmediate(() => {
      if (event === 'getUserMails') cb(null, { success: true, mails: state.mails });
      else if (event === 'claimAllMailItems' || event === 'claimMailItems') { for (const m of state.mails) m.isClaimed = true; cb(null, { success: true, message: 'ok' }); }
      else cb(null, { success: false });
    }) });
    setImmediate(() => local('connect'));
    return s;
  };
  return { state, createSocket };
}

function service(game) {
  const logs = [];
  let archive = { version: 1, accounts: {} };
  const store = {
    getAccounts: () => [{ id: 'a1', name: 'Trophy' }],
    getAccountProfile: () => ({ accounts: { a1: { userId: 'u1' } } }),
    getSocialArchive: () => archive, saveSocialArchive: v => { archive = JSON.parse(JSON.stringify(v)); }
  };
  const fetchImpl = async url => ({ json: async () => (url.includes('type=sent') ? { success: true, sentRequests: [{ id: 'fs9', friend: { id: 'x', teamName: 'Waiting' } }] } : { success: true, blockedUsers: [{ blocked: { id: 'b1', teamName: 'Spammer' } }] }) });
  const s = new SocialService({ store, activity: { add: e => logs.push(e) }, sessions: { get: async () => ({ userId: 'u1', cookieHeader: 'session=x' }) }, createSocket: game.createSocket, fetchImpl, now: () => NOW });
  return { s, logs, archive: () => archive };
}

test('The page view reads everything without signing in and counts the badges', async () => {
  const game = fakeGame();
  const { s } = service(game);
  const v = await s.view('a1');
  assert.equal(v.friends.length, 2);
  assert.equal(v.sent[0].friend.teamName, 'Waiting');
  assert.equal(v.blocked[0].teamName, 'Spammer');
  assert.deepEqual(s.snapshot().totals, { requests: 0, unread: 0, mail: 1 });
  assert.ok(game.state.cookies.every(c => c === null), 'reads use a plain socket');
  s.stop();
});

test('Chats are archived so they survive the daily wipe, and sending uses the session cookie', async () => {
  const game = fakeGame();
  const { s, archive } = service(game);
  await s.view('a1');
  const c = await s.conversation('a1', 'f1');
  assert.deepEqual(c.messages.map(m => m.id), ['m1']);
  game.state.history.f1 = []; // the game wiped it at 19:00
  assert.deepEqual((await s.conversation('a1', 'f1')).messages.map(m => m.id), ['m1'], 'still shown from the archive');
  await s.send('a1', 'f1', 'merhaba');
  assert.ok(game.state.writes.some(w => w.event === 'sendPrivateMessage' && w.p.message === 'merhaba' && w.p.senderId === 'u1'));
  assert.equal(archive().accounts.a1.f1.messages.length, 2);
  s.stop();
});

test('Polling spots new requests and messages once, and actions and mail claims refresh the view', async () => {
  const game = fakeGame();
  const { s, logs } = service(game);
  await s.poll();
  assert.equal(logs.length, 0, 'the first look only remembers');
  game.state.requests = [{ id: 'fs7', from: { id: 'f3', teamName: 'New' } }];
  game.state.unread = [{ senderId: 'f2', unreadCount: 2 }];
  game.state.history.f2 = [{ id: 'm9', senderId: 'f2', receiverId: 'u1', message: 'hey', timestamp: '2026-10-25T08:59:00Z' }];
  await s.poll();
  assert.deepEqual(logs.map(l => l.code).sort(), ['so.newMessage', 'so.newRequest']);
  assert.deepEqual(s.snapshot().totals, { requests: 1, unread: 2, mail: 1 });
  await s.poll();
  assert.equal(logs.length, 2, 'nothing new, nothing logged');
  await s.view('a1');
  const v = await s.act('a1', 'accept', 'fs7');
  assert.equal(v.requests.length, 0);
  assert.ok(logs.some(l => l.code === 'so.accept' && l.params.name === 'New'));
  const after = await s.claimMail('a1', null);
  assert.equal(after.mails[0].isClaimed, true);
  assert.deepEqual(logs.find(l => l.code === 'ml.claimed').params, { count: 1, items: '10 Refine Ore' });
  s.stop();
});
