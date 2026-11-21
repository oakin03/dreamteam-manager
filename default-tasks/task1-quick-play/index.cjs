function aborted(signal) {
  if (signal.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }
}

function waitForSocket(socket, signal, timeoutMs = 15000) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error('Socket connection timed out.')), timeoutMs);
    const onConnect = () => cleanup();
    const onError = (error) => cleanup(error instanceof Error ? error : new Error(String(error || 'Socket error')));
    const onAbort = () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      cleanup(error);
    };

    function cleanup(error) {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      signal.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve();
    }

    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function emitAck(socket, event, payload, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const ack = (err, response) => {
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(response);
    };
    if (payload === undefined) socket.timeout(timeoutMs).emit(event, ack);
    else socket.timeout(timeoutMs).emit(event, payload, ack);
  });
}

// Sign in over HTTP and open the socket without any Chromium (user 2026-10-31: many
// accounts starting together overloaded the PC, the browser logins timed out and accounts
// got stuck in the browser fallback). Level / TK / APK are read every few minutes by the
// app and the Daily Reward has its own service, so the Stadium visit is not needed here.
async function openSocket(ctx, auth) {
  const socket = ctx.socket.create('https://dreamteamph.com', {
    path: '/simulation-socket/',
    transports: ['websocket'],
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    extraHeaders: {
      Cookie: auth.cookieHeader
    }
  });
  await waitForSocket(socket, ctx.signal, 15000);
  ctx.log('info', 'Socket connected. Verifying the session…');
  const probe = await emitAck(socket, 'requestMatchList', undefined, 12000);
  if (!probe || probe.success !== true) {
    socket.disconnect();
    throw new Error(probe?.error || 'Socket session verification failed.');
  }
  return socket;
}

const BROWSER_FAILS_TO_SOCKET = 3; // browser-mode failures in a row before socket mode is tried again

async function prepareSocketMode(ctx) {
  if (ctx.httpLogin) {
    try {
      ctx.log('info', 'Signing in (no browser)…');
      const auth = await ctx.httpLogin();
      const socket = await openSocket(ctx, auth);
      ctx.log('success', 'Socket mode ready (no browser).');
      return { mode: 'socket', socket, userId: auth.userId };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      ctx.log('warning', `Sign in without a browser failed (${error.message}) · trying with Chromium.`);
    }
  }
  ctx.log('info', 'Opening a temporary Chromium session…');
  const auth = await ctx.browser.authenticate(ctx.account, ctx.credentials(), {
    visible: false,
    forceFresh: ctx.forceFresh,
    keepOpen: true,
    log: ctx.log
  });

  try {
    // First Start must always pass through Stadium before switching to the
    // browserless socket. This is the safe point where APK/LV/EXP and Daily
    // Rewards are checked, including an immediately claimable reward.
    ctx.log('info', 'Checking Stadium data and Daily Reward…');
    await ctx.browser.normalizeToStadium(auth.session, ctx.log);
  } catch (error) {
    await ctx.browser.release(ctx.account.id, auth.owner, { closeWhenUnused: true }).catch(() => {});
    throw error;
  }

  if (!auth.userId || !auth.cookieHeader) {
    await ctx.browser.release(ctx.account.id, auth.owner, { closeWhenUnused: true }).catch(() => {});
    throw new Error('Session or user ID could not be read for socket mode.');
  }

  await ctx.browser.release(ctx.account.id, auth.owner, { closeWhenUnused: true }).catch(() => {});

  const socket = await openSocket(ctx, auth);
  ctx.log('success', 'Socket mode ready. Chromium is closed to save RAM.');
  return { mode: 'socket', socket, userId: auth.userId };
}

async function prepareBrowserMode(ctx, visible) {
  ctx.log('info', visible ? 'Opening visible Chromium…' : 'Opening headless Chromium fallback…');
  const auth = await ctx.browser.authenticate(ctx.account, ctx.credentials(), {
    visible,
    forceFresh: ctx.forceFresh,
    keepOpen: true,
    log: ctx.log
  });
  try {
    // Even in visible browser mode, perform the first telemetry/reward check on
    // Stadium before navigating to Match.
    ctx.log('info', 'Checking Stadium data and Daily Reward…');
    await ctx.browser.normalizeToStadium(auth.session, ctx.log);
    if (visible && !auth.session.visible) {
      throw new Error('Visible Chromium was requested but the active browser session is hidden.');
    }
    const button = await ctx.browser.openMatchScreen(auth.session, ctx.log);
    ctx.log('success', 'Quick Play screen is ready.');
    return { mode: 'browser', session: auth.session, owner: auth.owner, accountId: ctx.account.id, browserRelease: (id, owner) => ctx.browser.release(id, owner, { closeWhenUnused: true }), button };
  } catch (error) {
    await ctx.browser.release(ctx.account.id, auth.owner, { closeWhenUnused: true }).catch(() => {});
    throw error;
  }
}

async function prepare(ctx) {
  if (ctx.visibleBrowser) {
    return prepareBrowserMode(ctx, true);
  }

  try {
    return await prepareSocketMode(ctx);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    ctx.log('warning', `Socket mode unavailable: ${error.message}`);
    ctx.log('warning', 'Switching to headless Chromium fallback.');
    return prepareBrowserMode(ctx, false);
  }
}

// The run loop decides: wait for Auto Trade to make room (ctx.capWait) or stop with an alert.
function throwSalaryCap(ctx, reason) {
  const clean = String(reason || 'Your team is over the salary cap.').trim();
  const error = new Error(`Quick Play stopped: ${clean}`);
  error.fatal = true;
  error.salaryCap = true;
  error.capReason = clean;
  error.suppressEngineLog = true;
  throw error;
}

// The started match as the game sees it: { status 'waiting' | 'started', host, opponent, opponentName }.
async function activeMatch(socket, userId) {
  const r = await emitAck(socket, 'getUserActiveMatch', { userId }, 8000).catch(() => null);
  return r?.match || null;
}

// After quickPlay: wait (up to 30 s) until the match has its opponent, so the next own
// account does not search at the same moment and get paired with this one.
async function waitPaired(ctx, socket, userId) {
  for (let i = 0; i < 15; i++) {
    const m = await activeMatch(socket, userId);
    // right after quickPlay the match can take a moment to show up: a few empty polls are
    // waited out instead of giving up (the opponent name was often missing)
    if (!m && i >= 3) return null;
    if (m && (m.status === 'started' || (m.opponent && m.opponent !== userId))) return m;
    await new Promise(resolve => setTimeout(resolve, 2000));
    aborted(ctx.signal);
  }
  return null;
}

async function doSocketAction(ctx, prepared) {
  aborted(ctx.signal);
  const { socket, userId } = prepared;
  if (!socket.connected) {
    ctx.log('warning', 'Socket disconnected; waiting for reconnection…');
    await waitForSocket(socket, ctx.signal, 15000);
  }

  const turn = ctx.matchTurn || (fn => fn());
  const { response, match } = await turn(async () => {
    const response = await emitAck(socket, 'quickPlay', { userId }, 15000);
    const match = response?.success ? await waitPaired(ctx, socket, userId).catch(() => null) : null;
    return { response, match };
  });
  if (response?.success) {
    const mine = match && match.host === userId;
    const opponentId = match ? (mine ? match.opponent : match.host) : null;
    const opponent = match ? (mine ? match.opponentName : match.hostName) : null;
    const own = Boolean(opponentId && ctx.ownUserIds?.().has(opponentId));
    ctx.setState({ opponent: opponent || null, opponentOwn: own });
    if (own) ctx.log('warning', `Quick Play paired this account with your own account ${opponent}.`);
    else ctx.log('success', `Quick Play started${opponent ? ` · vs ${opponent}` : ''}.`);
    return true;
  }

  const reason = String(response?.error || 'server rejected the request');
  if (/over the salary cap/i.test(reason)) throwSalaryCap(ctx, reason);
  // the game's daily PK limit (2026-11-05): no more Quick Play until midnight Manila
  if (response?.code === 'PK_DAILY_LIMIT' || /PK limit/i.test(reason)) return 'limit';
  // a match of this account is still running (often our own previous one): wait for its end
  if (/already in a match/i.test(reason)) return 'inMatch';
  // an injured starter (2026-11-18): the shared guard swaps in a bench player or heals; when it
  // cannot, Quick Play waits for it instead of asking again every few seconds
  if (/injured and not healed/i.test(reason)) {
    const fixed = ctx.injury ? await ctx.injury.report(reason) : false;
    if (fixed) { ctx.log('info', 'Injured starter replaced · Quick Play tries again'); return false; }
    return { injured: reason };
  }
  // an empty starter slot (a player was traded / listed / fired): the game's own AUTO LINEUP
  // (refreshTeamPosition) fills it, then the next try plays (326 refusals on 2026-11-14..17)
  if (/missing starter|starter positions/i.test(reason)) {
    const fixed = await emitAck(socket, 'refreshTeamPosition', { userId }, 15000).catch(() => null);
    ctx.log(fixed?.success ? 'info' : 'warning', fixed?.success ? 'Empty starter slot · Auto Lineup filled the lineup' : `Quick Play was not started: ${reason} · Auto Lineup failed`);
    return false;
  }

  ctx.log('warning', `Quick Play was not started: ${reason}`);
  return false;
}

async function waitUntilEnabled(button, signal, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    aborted(signal);
    if (await button.isEnabled().catch(() => false)) return true;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return false;
}

async function doBrowserAction(ctx, prepared) {
  aborted(ctx.signal);
  if (ctx.browser.isFeatureLocked?.(ctx.account.id)) {
    ctx.log('info', 'Quick Play paused while another game screen is in use.');
    return true;
  }

  // Reserve the shared page for the duration of this click/recovery cycle.
  // Daily Rewards and Scout check the same feature lock before navigating.
  ctx.browser.lockFeature?.(ctx.account.id, 'autoplay-action');
  try {
    let button = prepared.button;

    if (!(await button.isVisible().catch(() => false))) {
      button = await ctx.browser.openMatchScreen(prepared.session, ctx.log);
      prepared.button = button;
    }

    let enabled = await waitUntilEnabled(button, ctx.signal, 45000);
    if (!enabled) {
      for (let attempt = 1; attempt <= 2 && !enabled; attempt++) {
        ctx.log('warning', `Quick Play is still disabled. Recovery attempt ${attempt}/2…`);
        button = await ctx.browser.recoverMatchScreen(prepared.session, ctx.log);
        prepared.button = button;
        enabled = await waitUntilEnabled(button, ctx.signal, 30000);
      }
    }

    if (!enabled) {
      ctx.log('error', 'Quick Play remained disabled after recovery. The task will retry shortly.');
      return false;
    }

    await button.click();

    // Browser fallback can surface the same rejection as an in-game toast/modal.
    // Catch it immediately so the task stops instead of retrying forever.
    const salaryCapText = await prepared.session.page
      .getByText(/over the salary cap/i)
      .first()
      .textContent({ timeout: 2500 })
      .catch(() => null);
    if (salaryCapText) throwSalaryCap(ctx, salaryCapText);

    try {
      await button.waitFor({ state: 'visible', timeout: 10000 });
      const disabled = await button.isDisabled().catch(() => false);
      if (!disabled) {
        ctx.log('warning', 'Quick Play was clicked but the disabled state was not observed.');
      }
    } catch {}

    ctx.log('success', 'Quick Play clicked.');
    return true;
  } finally {
    ctx.browser.unlockFeature?.(ctx.account.id, 'autoplay-action');
  }
}

// Midnight Manila (UTC+8) = the game's daily reset, plus a few seconds.
function nextManilaMidnight(now = Date.now()) {
  const H8 = 8 * 3600 * 1000;
  const d = new Date(now + H8);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 30) - H8;
}

// Waits (polling every 20 s, at most 20 min) until the account has no running match.
async function waitMatchEnd(ctx, prepared) {
  const until = Date.now() + 20 * 60 * 1000;
  while (Date.now() < until) {
    aborted(ctx.signal);
    const m = await activeMatch(prepared.socket, prepared.userId).catch(() => null);
    if (!m) return;
    await ctx.sleep(20000);
  }
}

async function run(ctx, prepared) {
  const intervalMs = Math.max(60, Number(ctx.config?.intervalSeconds || 270)) * 1000;
  const retryMs = Math.max(10, Number(ctx.config?.retrySeconds || 30)) * 1000;
  ctx.setState({ mode: prepared.mode === 'socket' ? '' : 'browser', message: prepared.mode === 'socket' ? 'Running' : 'Browser mode' });

  // A browser-mode page element that did not show up ("Timed out waiting for img[alt=Match]")
  // is this account's own trouble, not the game being down: reporting it would pause every
  // account's Quick Play (seen 2026-10-30 with a new account in browser fallback).
  const netError = error => { const m = String(error?.message || error); return !/waiting for/i.test(m) && /could not connect|websocket error|disconnect|timed out|transport|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(m); };
  // While the game is unreachable every account waits for the one shared check
  // (every 2 minutes) instead of reconnecting on its own every few seconds.
  const waitForGame = async () => {
    if (prepared.socket) { try { prepared.socket.disconnect(); } catch {} }
    ctx.setState({ message: 'Waiting for the game' });
    await ctx.gameHealth.waitUp();
    if (prepared.socket) { try { prepared.socket.connect(); } catch {} }
    ctx.log('info', 'The game is reachable again · Quick Play continues.');
  };

  let browserFailures = 0;
  let capTries = 0;
  while (!ctx.signal.aborted) {
    if (ctx.gameHealth?.isDown()) { await waitForGame(); continue; }
    let success = false;
    try {
      success = prepared.mode === 'socket'
        ? await doSocketAction(ctx, prepared)
        : await doBrowserAction(ctx, prepared);
    } catch (error) {
      if (error?.salaryCap) {
        // Auto Trade works on this account: wait for it to list / trade / fire (or 2 minutes)
        const wait = ctx.capWait ? await ctx.capWait(++capTries).catch(() => false) : false;
        if (wait && !ctx.signal.aborted) {
          ctx.setState({ message: `Over the salary cap · waiting for Auto Trade (${capTries}/10)` });
          ctx.log('warning', `Over the salary cap · Auto Trade is making room, Quick Play tries again (${capTries}/10).`);
          continue;
        }
        ctx.alert?.('salary-cap', error.message);
        throw error;
      }
      if (error?.name === 'AbortError' || error?.fatal) throw error;
      if (ctx.gameHealth && netError(error)) {
        ctx.log('warning', `Game not reachable (${error.message}) · waiting, checked every 2 minutes with one connection.`);
        ctx.gameHealth.reportDown(error);
        await waitForGame();
        continue;
      }
      ctx.log('error', `Quick Play error: ${error.message}`);
      // stuck in the browser fallback (the page never shows the Match screen): after a few
      // failures go back to socket mode instead of failing every 2 minutes for hours
      if (prepared.mode === 'browser' && !ctx.visibleBrowser && ++browserFailures >= BROWSER_FAILS_TO_SOCKET) {
        browserFailures = 0;
        try {
          const next = await prepareSocketMode(ctx);
          await disposePrepared(prepared);
          for (const k of ['session', 'owner', 'accountId', 'browserRelease', 'button']) delete prepared[k];
          Object.assign(prepared, next);
          ctx.setState({ mode: '', message: 'Running' });
          ctx.log('success', 'Back in socket mode.');
          continue;
        } catch (e) {
          if (e?.name === 'AbortError') throw e;
          ctx.log('warning', `Socket mode still unavailable: ${e.message}`);
        }
      }
    }
    if (success && success.injured) {
      // The guard could not swap in a bench player or heal (user 2026-11-21): no silent wait that
      // looks like running — Auto Play stops with a clear error and the page offers "Anesteziye git".
      const names = (String(success.injured).match(/not healed:\s*([^.]*)\./i) || [])[1] || '?';
      const error = new Error(`Quick Play stopped: injured starter ${names} · heal on Bag → Anesthesia or put a healthy player in, then start again`);
      error.fatal = true;
      error.code = 'injured';
      error.params = { names };
      error.suppressEngineLog = true;
      ctx.alert?.('injured', error.message);
      throw error;
    }
    if (success === 'inMatch') {
      ctx.setState({ message: 'Waiting for the running match to end' });
      await waitMatchEnd(ctx, prepared);
      continue;
    }
    if (success === 'limit') {
      const at = nextManilaMidnight();
      ctx.setState({ message: 'Daily PK limit reached', nextActionAt: new Date(at).toISOString() });
      ctx.log('warning', 'Daily PK limit reached · Quick Play continues after the daily reset (19:00 TR).');
      await ctx.sleep(Math.max(60000, at - Date.now()));
      continue;
    }
    if (success) { browserFailures = 0; if (capTries) { ctx.log('success', 'Back under the salary cap · Quick Play continues.'); capTries = 0; } }

    const delay = success ? intervalMs : retryMs;
    const next = new Date(Date.now() + delay).toISOString();
    ctx.setState({
      lastActionAt: new Date().toISOString(),
      nextActionAt: next,
      message: success ? `Next Quick Play in ${Math.round(delay / 1000)}s` : `Retrying in ${Math.round(delay / 1000)}s`
    });
    await ctx.sleep(delay);
  }
}

async function disposePrepared(prepared) {
  if (!prepared) return;
  if (prepared.socket) {
    try { prepared.socket.disconnect(); } catch {}
  }
  if (prepared.session && prepared.owner && prepared.accountId && prepared.browserRelease) {
    try { await prepared.browserRelease(prepared.accountId, prepared.owner); } catch {}
  } else if (prepared.session && prepared.owner && prepared.accountId) {
    try { await prepared.session.close(); } catch {}
  }
}

module.exports = { prepare, run, disposePrepared };
