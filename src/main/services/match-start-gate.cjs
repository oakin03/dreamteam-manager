// The game names a match "<mode>-<start time in ms>" (back-to-peak-floor-5-1792955966820,
// daily-boss-pro-…, professional-…, tower-challenger-floor-1-…). Two accounts starting the
// same mode in the same millisecond got the same match id and one match replaced the other:
// Trophy and CelticsBC on Elite Ascent floor 5 (2026-10-25) — Trophy's match "ended" after
// 25 s as a loss. Every match start of the app therefore waits for this shared gate, which
// keeps starts START_GAP_MS apart across all accounts and services.
const START_GAP_MS = 1500;

let chain = Promise.resolve();
let lastAt = 0;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

function matchStartSlot(signal = null, gapMs = START_GAP_MS) {
  const run = chain.then(() => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const wait = Math.max(0, lastAt + gapMs - Date.now());
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); lastAt = Date.now(); resolve(); }, wait);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  }));
  chain = run.catch(() => {});
  return run;
}

module.exports = { matchStartSlot, START_GAP_MS };
