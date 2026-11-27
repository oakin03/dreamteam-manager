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

// Long match runs (Go-up, PVP, Tower, Daily Boss…; user 2026-11-27): only the START is limited.
// At most `limit` accounts are starting at the same time; an account frees its place as soon as
// it calls `started()` (its first match began) or ends, so the next group starts while the first
// one is still playing — every account ends up playing at once, none waits for another's run.
async function eachStaggered(items, fn, limit = WIDE) {
  let active = 0;
  const waiters = [];
  const acquire = () => (active < limit ? (active++, Promise.resolve()) : new Promise(resolve => waiters.push(resolve)));
  const release = () => { const next = waiters.shift(); if (next) next(); else active--; };
  await Promise.all([...(items || [])].map(async (item, i) => {
    await acquire();
    let held = true;
    const started = () => { if (held) { held = false; release(); } };
    try { await fn(item, i, started); } catch {} finally { started(); }
  }));
}

module.exports = { WIDE, eachAtOnce, eachWithSocket, eachStaggered };
