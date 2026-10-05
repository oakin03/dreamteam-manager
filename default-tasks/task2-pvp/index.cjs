function aborted(signal) {
  if (signal.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }
}

async function prepare(ctx) {
  ctx.log('info', 'PVP için Chromium açılıyor…');

  const auth = await ctx.browser.authenticate(ctx.account, ctx.credentials(), {
    visible: Boolean(ctx.visibleBrowser),
    forceFresh: ctx.forceFresh,
    keepOpen: true,
    log: ctx.log
  });

  try {
    const page = auth.session.page;

    ctx.log('info', 'Anasayfa doğrulanıyor…');

    await ctx.browser.waitForMain(page, {
      timeoutMs: 180000,
      log: ctx.log
    });

    return {
      mode: 'browser',
      session: auth.session,
      owner: auth.owner,
      accountId: ctx.account.id,
      released: false
    };
  } catch (error) {
    await ctx.browser.release(ctx.account.id, auth.owner, {
      closeWhenUnused: true
    }).catch(() => {});

    throw error;
  }
}

async function run(ctx, prepared) {
  const page = prepared.session.page;

  const clickCount = Math.max(
    1,
    Number(ctx.config?.clickCount || 10)
  );

  const intervalMs =
    Math.max(1, Number(ctx.config?.intervalSeconds || 270)) * 1000;

  const finishWaitMs =
    Math.max(1, Number(ctx.config?.finishWaitSeconds || 270)) * 1000;

  aborted(ctx.signal);

  ctx.log('info', 'City ekranı açılıyor…');

  const city = page.locator(
    'img[alt="City"], img[src*="/iconss/city.webp"]'
  ).first();

  await city.waitFor({
    state: 'visible',
    timeout: 90000
  });

  await city.click();

  const cityButton = page.locator(
    'div.absolute.cursor-pointer[style*="bottom: -160px"][style*="left: 220px"]'
  ).first();

  await cityButton.waitFor({
    state: 'visible',
    timeout: 90000
  });

  await cityButton.click();

  ctx.log('info', 'PVP ekranı açılıyor…');

  const pvpImage = page.locator(
    'img[src*="pvp.webp"], img[alt*="PVP" i]'
  ).first();

  await pvpImage.waitFor({
    state: 'visible',
    timeout: 90000
  });

  await pvpImage.click();

  const findButton = page.getByRole(
    'button',
    { name: /FIND\s+PVP\s+MATCH/i }
  ).first();

  await findButton.waitFor({
    state: 'visible',
    timeout: 90000
  });

  for (let i = 1; i <= clickCount; i++) {
    aborted(ctx.signal);

    await findButton.click();

    ctx.log(
      'success',
      `FIND PVP MATCH tıklandı · ${i}/${clickCount}`
    );

    if (i < clickCount) {
      const nextAt = new Date(
        Date.now() + intervalMs
      ).toISOString();

      ctx.setState({
        lastActionAt: new Date().toISOString(),
        nextActionAt: nextAt,
        message: `PVP ${i}/${clickCount} · sonraki tıklama 4.5 dakika sonra`
      });

      await ctx.sleep(intervalMs);

      await findButton.waitFor({
        state: 'visible',
        timeout: 90000
      });
    }
  }

  ctx.log(
    'success',
    'PVP 10/10 tamamlandı. Chromium kapatılıyor…'
  );

  await ctx.browser.release(
    ctx.account.id,
    prepared.owner,
    { closeWhenUnused: true }
  ).catch(() => {});

  prepared.released = true;

  const finishAt = new Date(
    Date.now() + finishWaitMs
  ).toISOString();

  ctx.setState({
    lastActionAt: new Date().toISOString(),
    nextActionAt: finishAt,
    message: 'PVP tıklamaları tamamlandı · görev bitiş beklemesi 4.5 dakika'
  });

  await ctx.sleep(finishWaitMs);

  ctx.log('success', 'PVP görevi tamamlandı.');
}

async function disposePrepared(prepared, runtime) {
  if (!prepared || prepared.released) return;

  if (prepared.session && prepared.owner && prepared.accountId) {
    await runtime.browser.release(
      prepared.accountId,
      prepared.owner,
      { closeWhenUnused: true }
    ).catch(() => {});
  }
}

module.exports = {
  prepare,
  run,
  disposePrepared
};