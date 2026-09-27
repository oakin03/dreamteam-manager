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

async function prepareSocketMode(ctx) {
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

function throwSalaryCap(ctx, reason) {
  const clean = String(reason || 'Your team is over the salary cap.').trim();
  const message = `Quick Play stopped: ${clean}`;
  ctx.alert?.('salary-cap', message);
  const error = new Error(message);
  error.fatal = true;
  error.suppressEngineLog = true;
  throw error;
}

async function doSocketAction(ctx, prepared) {
  aborted(ctx.signal);
  const { socket, userId } = prepared;
  if (!socket.connected) {
    ctx.log('warning', 'Socket disconnected; waiting for reconnection…');
    await waitForSocket(socket, ctx.signal, 15000);
  }

  const response = await emitAck(socket, 'quickPlay', { userId }, 15000);
  if (response?.success) {
    const matchSuffix = response.matchId ? ` · Match ${response.matchId}` : '';
    ctx.log('success', `Quick Play started${matchSuffix}.`);
    return true;
  }

  const reason = String(response?.error || 'server rejected the request');
  if (/over the salary cap/i.test(reason)) throwSalaryCap(ctx, reason);

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

async function run(ctx, prepared) {
  const intervalMs = Math.max(60, Number(ctx.config?.intervalSeconds || 270)) * 1000;
  const retryMs = Math.max(10, Number(ctx.config?.retrySeconds || 30)) * 1000;
  ctx.setState({ mode: prepared.mode, message: prepared.mode === 'socket' ? 'Socket mode' : 'Browser mode' });

  while (!ctx.signal.aborted) {
    let success = false;
    try {
      success = prepared.mode === 'socket'
        ? await doSocketAction(ctx, prepared)
        : await doBrowserAction(ctx, prepared);
    } catch (error) {
      if (error?.name === 'AbortError' || error?.fatal) throw error;
      ctx.log('error', `Quick Play error: ${error.message}`);
    }

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
