// Every account at once (user 2026-11-11: "RAM yemiyorsa hepsini aynı anda çalıştır"). A game
// socket is a small socket.io connection, not a browser: 141 of them cost a few MB. Only the
// Chromium login fallback stays limited (game-sessions.cjs).
const WIDE = 200;

// Runs fn(item, index) for every item, `limit` at a time. An error in one never stops the others.
async function eachAtOnce(items, fn, limit = WIDE) {
  const list = [...(items || [])];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), list.length) }, async () => {
    for (let i; (i = next++) < list.length;) { try { await fn(list[i], i); } catch {} }
  }));
}

// Same, each lane with a socket of its own (GameSocket.call() answers one request at a time per
// socket, so a shared socket would line the accounts up again). `open()` makes a socket; one that
// fails is closed and the lane opens a new one for its next item. onError(item, error) is told.
async function eachWithSocket(items, open, fn, { limit = WIDE, onError = null } = {}) {
  const list = [...(items || [])];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), list.length) }, async () => {
    let gs = null;
    try {
      for (let i; (i = next++) < list.length;) {
        try { gs ||= await open(); await fn(gs, list[i], i); }
        catch (error) { try { onError?.(list[i], error); } catch {} try { gs?.close(); } catch {} gs = null; }
      }
    } finally { try { gs?.close(); } catch {} }
  }));
}

module.exports = { WIDE, eachAtOnce, eachWithSocket };
