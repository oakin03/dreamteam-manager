// Toplu Başlat (user 2026-11-24, per account since 2026-11-27): every account goes through its own
// systems in the chosen order and moves to its next system as soon as it finished one — it never
// waits for the other accounts. Each system is one run that takes accounts while it goes:
//   makeRunner(step) -> { start(ids, onDone), add(ids) -> bool | Promise<bool>, close(), promise }
// `onDone(id)` is told by the run when an account is over there. A run is closed when every
// account that will come to it has come, so it ends when they are over.
function runBatch({ steps, sets, makeRunner, onAccountOver = () => {}, onChange = () => {}, log = () => {}, stopRun = () => {} }) {
  const ids = [...new Set(steps.flatMap(step => [...sets[step]]))];
  const path = Object.fromEntries(ids.map(id => [id, steps.filter(step => sets[step].has(id))]));
  const rows = steps.map(id => ({ id, status: 'queued', error: null, accounts: sets[id].size, done: 0, startedAt: null, finishedAt: null }));
  const rowOf = step => rows.find(r => r.id === step);
  const runners = {};
  const arrived = Object.fromEntries(steps.map(step => [step, 0]));
  const doneSeen = new Set();
  const state = { rows, stopped: false, current: null };
  let left = ids.length;
  let finish;
  const allDone = new Promise(resolve => { finish = resolve; });
  if (!left) finish();
  const current = () => { state.current = rows.find(r => r.status === 'running')?.id || null; };

  const accountOver = id => { try { onAccountOver(id); } catch {} if (--left <= 0) finish(); };
  const next = (id, after) => {
    if (state.stopped) return accountOver(id);
    const list = path[id];
    const i = after == null ? 0 : list.indexOf(after) + 1;
    if (i >= list.length) return accountOver(id);
    enter(list[i], id);
  };
  const done = (step, id) => {
    const key = `${step}:${id}`;
    if (doneSeen.has(key)) return;
    doneSeen.add(key);
    const row = rowOf(step);
    row.done += 1;
    if (row.done >= row.accounts) { row.status = state.stopped ? 'stopped' : 'done'; row.finishedAt = new Date().toISOString(); current(); }
    onChange();
    next(id, step);
  };
  const enter = async (step, id) => {
    const row = rowOf(step);
    try {
      if (!runners[step]) {
        const r = runners[step] = makeRunner(step);
        r.onDoneRef = sid => done(step, sid);
        row.status = 'running'; row.startedAt = new Date().toISOString(); current(); onChange();
        r.ready = Promise.resolve(r.start([id], sid => done(step, sid)));
        await r.ready;
      } else if (!(await runners[step].ready.then(() => runners[step].add([id])))) {
        done(step, id); // its run ended a moment before: the account goes on
      }
    } catch (error) {
      row.error = error.message;
      log('warning', 'db.stepFailed', { step, error: error.message }, `${step}: ${error.message} · next system`);
      done(step, id);
    }
    // counted once the account is in (or passed on): when every account that will come to this
    // system is in, its run is closed and ends when they are over
    arrived[step] += 1;
    if (arrived[step] >= sets[step].size) runners[step]?.close();
  };

  // started after the caller made Auto Play step aside
  let promise = null;
  const start = () => (promise ||= (async () => {
    for (const id of ids) next(id, null);
    await allDone;
    for (const r of rows) if (r.status === 'queued') r.status = state.stopped ? 'skipped' : 'done';
    await Promise.all(Object.values(runners).map(r => r.promise).filter(Boolean));
    state.current = null;
  })());

  const stop = () => {
    state.stopped = true;
    for (const step of steps) {
      runners[step]?.close();
      const row = rowOf(step);
      if (row.status === 'queued') row.status = 'skipped';
      if (runners[step]) stopRun(step);
    }
    onChange();
  };
  return { ids, path, state, start, stop };
}

module.exports = { runBatch };
