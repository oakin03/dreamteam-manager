const { AGENT_SELECTOR } = require('./browser-service.cjs');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const SCOUT_DIALOG = '[role="dialog"][aria-label="Free agency"]';

function probeScoutList() {
  const dialog = document.querySelector('[role="dialog"][aria-label="Free agency"]');
  if (!dialog) return { dialog: false, advertised: 0, artwork: 0, signButtons: 0 };
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const allText = clean(dialog.textContent);
  const advertisedMatch = allText.match(/(\d+)\s+agents\b/i);
  const artwork = [...dialog.querySelectorAll('[style*="background-image"]')]
    .filter(el => (el.getAttribute('style') || '').includes('players/'));
  const signButtons = [...dialog.querySelectorAll('button')]
    .filter(b => /^(Sign|Signed)$/i.test(clean(b.innerText || b.textContent)));
  return {
    dialog: true,
    advertised: advertisedMatch ? Number(advertisedMatch[1]) : 0,
    artwork: artwork.length,
    signButtons: signButtons.length
  };
}

function extractScoutData() {
  const dialog = document.querySelector('[role="dialog"][aria-label="Free agency"]');
  if (!dialog) return null;
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const allText = txt(dialog);

  // Free Attempts is rendered as its own value (for example `3 / 3`) next to
  // a timer. Reading the whole dialog can concatenate that timer and turn
  // `3 / 3` into values such as `3/327`. Read the dedicated value node first
  // and keep the game-defined maximum fixed at 3.
  let attempts = null;
  let attemptsMax = 3;
  const attemptsLabel = [...dialog.querySelectorAll('*')].find(el => txt(el) === 'Free Attempts');
  const attemptsBox = attemptsLabel?.parentElement || null;
  if (attemptsBox) {
    const exactAttempts = [...attemptsBox.querySelectorAll('*')]
      .map(el => txt(el))
      .find(v => /^([0-3])\s*\/\s*3$/.test(v));
    const m = exactAttempts?.match(/^([0-3])\s*\/\s*3$/);
    if (m) attempts = Number(m[1]);
  }
  if (attempts == null) {
    const fallback = allText.match(/Free Attempts\s*([0-3])\s*\/\s*3/i);
    if (fallback) attempts = Number(fallback[1]);
  }

  const rosterMatch = allText.match(/Players\s*(\d+)\s*\/\s*(\d+)/i);
  const fundsMatch = allText.match(/Funds\s*([0-9.,]+)\s*TK/i);
  const salarySpaceMatch = allText.match(/Salary Space\s*([0-9.,]+)\s*TK/i);

  let timer = null;
  const fa = [...dialog.querySelectorAll('*')].find(el => txt(el) === 'Free Attempts');
  if (fa) {
    const box = fa.parentElement;
    const m = txt(box).match(/(\d{1,2}:\d{2})/);
    if (m) timer = m[1];
  }

  // Prefer the six Sign/Signed controls as anchors. Each button belongs to one
  // agent card and lets us climb to the exact card even if the artwork style is
  // mounted a render later. Fall back to artwork-only discovery when needed.
  const actionButtons = [...dialog.querySelectorAll('button')]
    .filter(b => /^(Sign|Signed)$/i.test(txt(b)));
  const candidates = [];
  const seenCards = new Set();

  for (const actionButton of actionButtons) {
    let card = actionButton.parentElement;
    let art = null;
    while (card && card !== dialog) {
      art = [...card.querySelectorAll('[style*="background-image"]')]
        .find(el => (el.getAttribute('style') || '').includes('players/')) || null;
      const ownActions = [...card.querySelectorAll('button')]
        .filter(b => /^(Sign|Signed)$/i.test(txt(b)));
      const hasPlayerLabel = [...card.querySelectorAll('span')].some(el =>
        /text-xs/.test(el.className || '') && /[A-Za-z]/.test(txt(el)) && !/^(Sign|Signed)$/i.test(txt(el))
      );
      if (ownActions.length === 1 && (art || hasPlayerLabel)) break;
      card = card.parentElement;
    }
    if (!card || card === dialog || seenCards.has(card)) continue;
    seenCards.add(card);
    candidates.push({ art, card, actionButton });
  }

  if (!candidates.length) {
    const artwork = [...dialog.querySelectorAll('[style*="background-image"]')]
      .filter(el => (el.getAttribute('style') || '').includes('players/'));
    for (const art of artwork) {
      let card = art;
      let actionButton = null;
      while (card && card !== dialog) {
        actionButton = [...card.querySelectorAll('button')]
          .find(b => /^(Sign|Signed)$/i.test(txt(b))) || null;
        if (actionButton) break;
        card = card.parentElement;
      }
      if (!card || card === dialog || seenCards.has(card)) continue;
      seenCards.add(card);
      candidates.push({ art, card, actionButton });
    }
  }

  const agents = candidates.map(({ art, card, actionButton }, index) => {
    const style = art?.getAttribute('style') || '';
    const pathMatch = style.match(/url\(["']?([^"')]+)["']?\)/i);
    const imagePath = pathMatch ? pathMatch[1] : (card.querySelector('img[src*="players/"]')?.getAttribute('src') || '');
    const imageSlug = (imagePath.split('/').pop() || '')
      .replace(/\.(webp|png|jpg|jpeg)$/i, '')
      .toLowerCase();

    const spans = [...card.querySelectorAll('span')].map(s => ({ el: s, value: txt(s) })).filter(x => x.value);
    const position = spans.map(x => x.value).find(v => /^(PG|SG|SF|PF|C)(\/(PG|SG|SF|PF|C))?$/.test(v.replace(/\s/g, ''))) || '';
    const grade = spans.map(x => x.value).find(v => /^(S\+|S|S-|A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|N)$/.test(v)) || '';

    let name = '';
    const styledName = spans.find(({ el, value }) =>
      /text-xs/.test(el.className || '') &&
      value !== position && value !== grade &&
      !/^(Sign|Signed)$/i.test(value) &&
      !/^↑?\+?\d+(?:\.\d+)?$/.test(value) &&
      value.length < 40
    );
    if (styledName) name = styledName.value;
    if (!name) {
      const fallback = spans.find(({ value }) =>
        /^[A-Z](?:\.|[A-Za-z'-]+)\s+.+/i.test(value) &&
        value !== position && value !== grade &&
        !/^(Sign|Signed)$/i.test(value) &&
        value.length < 40
      );
      if (fallback) name = fallback.value;
    }

    const nameSlug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const safeImageSlug = ['no-face', 'noface'].includes(imageSlug) ? '' : imageSlug;
    const key = `${nameSlug || safeImageSlug || 'agent'}-${index}`;
    const buttonText = txt(actionButton);

    return {
      index,
      key,
      imagePath,
      name,
      position: position.replace(/\s/g, ''),
      grade,
      // A successful Sign briefly disables every button while the result
      // banner is shown. Disabled is not the same as Signed.
      signed: /^Signed$/i.test(buttonText),
      signDisabled: Boolean(actionButton?.disabled) && /^Sign$/i.test(buttonText),
      canSign: Boolean(actionButton) && !actionButton.disabled && /^Sign$/i.test(buttonText)
    };
  }).filter(agent => agent.name || agent.imagePath);

  return {
    attempts,
    attemptsMax,
    timer,
    roster: rosterMatch ? Number(rosterMatch[1]) : null,
    rosterMax: rosterMatch ? Number(rosterMatch[2]) : null,
    funds: fundsMatch ? fundsMatch[1] : null,
    salarySpace: salarySpaceMatch ? salarySpaceMatch[1] : null,
    agents
  };
}

function extractScoutReport() {
  const dialog = document.querySelector('[role="dialog"][aria-label="Free agency"]');
  if (!dialog) return null;
  const txt = (el) => (el?.textContent || '').trim();
  const marker = [...dialog.querySelectorAll('*')].find(el => txt(el) === 'Scout Report');
  const aside = marker?.closest('aside');
  if (!aside) return null;

  const rows = {};
  for (const el of aside.querySelectorAll('div')) {
    const kids = [...el.children];
    if (kids.length !== 2) continue;
    const k = txt(kids[0]);
    const v = txt(kids[1]);
    if (/^(Price|Rank|Offense|Defense)$/i.test(k)) rows[k.toLowerCase()] = v;
  }

  const bullet = [...aside.querySelectorAll('div')]
    .map(txt)
    .find(v => /^(PG|SG|SF|PF|C)(\/(PG|SG|SF|PF|C))?\s*•\s*[A-Z0-9]{2,4}$/.test(v));

  let team = null;
  let position = null;
  if (bullet) {
    const m = bullet.match(/^([^•]+)•\s*([A-Z0-9]{2,4})$/);
    if (m) {
      position = m[1].trim().replace(/\s/g, '');
      team = m[2].trim();
    }
  }

  const name = [...aside.querySelectorAll('div')]
    .map(txt)
    .find(v => /^[A-Z]\.\s*.+/i.test(v) && v.length < 35 && !v.includes('•')) || null;

  const grade = [...aside.querySelectorAll('span')]
    .map(txt)
    .find(v => /^(S\+|S|S-|A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|N)$/.test(v)) || null;

  const baseText = [...aside.querySelectorAll('*')]
    .map(txt)
    .find(v => /^Base:\s*[0-9.,]+\s*TK$/i.test(v));
  const baseMatch = baseText?.match(/Base:\s*([0-9.,]+)\s*TK/i);

  return {
    name,
    identityText: (aside.textContent || '').replace(/\s+/g, ' ').trim(),
    team,
    position,
    grade,
    price: rows.price || null,
    rank: rows.rank || null,
    offense: rows.offense || null,
    defense: rows.defense || null,
    base: baseMatch ? `${baseMatch[1]} TK` : null
  };
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function reportMatchesAgent(report, expectedName) {
  const expected = normalizeName(expectedName);
  if (!expected) return Boolean(report?.name);
  const actual = normalizeName(report?.name);
  if (actual && actual === expected) return true;
  // Some report layouts omit the dedicated abbreviated name node. Check the
  // selected player's name in the report pane itself, never in the entire dialog
  // (which also contains the other five players).
  return Boolean(report?.identityText && normalizeName(report.identityText).includes(expected));
}

class ScoutService {
  constructor({ store, credentials, browserService, activity, cardsService = null, accountProfile = null, onChanged }) {
    this.store = store;
    this.credentials = credentials;
    this.browser = browserService;
    this.activity = activity;
    this.cards = cardsService;
    this.accountProfile = accountProfile;
    this.onChanged = onChanged;
    this.states = new Map();
  }

  accountById(id) {
    const account = this.store.getAccounts().find(a => a.id === id);
    if (!account) throw new Error('Account not found.');
    return account;
  }

  snapshot() {
    const out = {};
    const revision = this.cards && typeof this.store?.revision === 'function'
      ? [this.store.revision('cards'),this.store.revision('cardMetadata'),this.store.revision('cardRoles')].join(':') : null;
    for (const [id, s] of this.states) {
      if (s.data?.agents && this.cards && (revision === null || s._cardsRevision !== revision)) {
        for (const agent of s.data.agents) {
          agent.card=this.cards.findForScout(agent);
          agent.cardTeam=agent.card?.team||null;
          agent.cardStars=agent.card?.stars??null;
        }
        s._cardsRevision=revision;
      }
      const { _cardsRevision, ...publicState }=s;
      out[id] = { ...publicState, browserOpen: Boolean(s.session && !s.session.closed), session: undefined, owner: undefined };
    }
    return out;
  }

  log(account, level, message) {
    this.activity.add({ level, accountId: account.id, accountName: account.name, message });
  }

  async _ensureOpen(accountId) {
    const account = this.accountById(accountId);
    const owner = `scout:${accountId}`;
    let state = this.states.get(accountId);
    let session = state?.session;
    if (!session || session.closed) {
      const auth = await this.browser.authenticate(account, {
        login: account.login,
        password: this.credentials.decryptSecret(account.passwordEncrypted)
      }, { visible: false, keepOpen: true, owner, log: (level, msg) => this.log(account, level, msg) });
      session = auth.session;
      state = { ...(state || {}), status: 'opening', session, owner, data: state?.data || null, error: null };
      this.states.set(accountId, state);
    }
    return { account, state, session };
  }

  async open(accountId) {
    const { account, state, session } = await this._ensureOpen(accountId);
    // Reserve the game page before navigating so Auto Play / Daily Rewards cannot
    // move the shared Chromium session while Scout is opening and being scanned.
    this.browser.lockFeature(accountId, 'scout');
    state.status = 'opening';
    state.error = null;
    this.onChanged?.();
    try {
      const page = session.page;
      const dialog = page.locator(SCOUT_DIALOG).first();
      if (!(await dialog.isVisible().catch(() => false))) {
        await this.browser.normalizeToStadium(session, (level, msg) => this.log(account, level, msg));
        const agent = page.locator(AGENT_SELECTOR).first();
        await agent.waitFor({ state: 'visible', timeout: 60000 });
        await agent.click();
        await dialog.waitFor({ state: 'visible', timeout: 60000 });
      }
      state.data = await this.scan(accountId, false);
      this.browser.lockFeature(accountId, 'scout');
      state.status = 'open';
      this.log(account, 'success', `Scout opened · ${state.data?.agents?.length || 0} players.`);
      this.onChanged?.();
      return state.data;
    } catch (error) {
      await session.page.keyboard.press('Escape').catch(() => {});
      this.browser.unlockFeature(accountId, 'scout');
      if (state.owner) await this.browser.release(accountId, state.owner, { closeWhenUnused: true }).catch(() => {});
      state.session = null;
      state.owner = null;
      state.status = 'error';
      state.error = error.message;
      this.onChanged?.();
      this.log(account, 'error', `Scout: ${error.message}`);
      throw error;
    }
  }

  async _readReportFor(page, expectedName, timeoutMs = 3000) {
    const end = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < end) {
      last = await page.evaluate(extractScoutReport).catch(() => null);
      if (last?.price && reportMatchesAgent(last,expectedName)) return last;
      await sleep(100);
    }

    // Never return the previously selected player's report for a different
    // card. That used to make several rows inherit the wrong team/price.
    if (!expectedName && last?.price && last?.name) return last;
    return null;
  }

  async _waitForAgentList(page, timeoutMs = 20000) {
    const end = Date.now() + timeoutMs;
    let last = null;
    let stablePositive = 0;
    let previousArtwork = -1;

    while (Date.now() < end) {
      last = await page.evaluate(probeScoutList).catch(() => null);
      if (last?.dialog) {
        const expected = Number(last.advertised || 0);
        const rendered = Number(last.artwork || 0);
        const actions = Number(last.signButtons || 0);
        if ((rendered > 0 || actions > 0) && (!expected || rendered >= expected || actions >= expected)) return last;

        if (rendered > 0 && rendered === previousArtwork) stablePositive += 1;
        else stablePositive = 0;
        previousArtwork = rendered;
        if (!expected && stablePositive >= 2) return last;
      }
      await sleep(150);
    }
    return last;
  }

  async _selectAgentForReport(page, agent, artworkIndex) {
    // The detailed values only appear after selecting the player image/card.
    // First use the artwork directly; if that selector is unavailable on a
    // particular render, anchor from the matching Sign button and click the
    // card's visual area instead.
    let target = page.locator(`${SCOUT_DIALOG} [style*="background-image"][style*="players/"]`).nth(artworkIndex);
    if (!(await target.isVisible().catch(() => false))) {
      const actions = page.locator(`${SCOUT_DIALOG} button`).filter({ hasText: /^(Sign|Signed)$/i });
      const action = actions.nth(artworkIndex);
      const card = action.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " pt-7 ")][1]');
      const localArt = card.locator('[style*="background-image"]').first();
      target = (await localArt.isVisible().catch(() => false)) ? localArt : card;
    }
    if (!(await target.isVisible().catch(() => false))) return null;

    await target.scrollIntoViewIfNeeded().catch(() => {});
    const box = await target.boundingBox().catch(() => null);
    const position = box ? { x: Math.max(8, Math.min(box.width / 2, box.width - 8)), y: Math.max(8, Math.min(box.height * 0.35, box.height - 8)) } : undefined;
    const clicked = await target.click({ timeout: 5000, ...(position ? { position } : {}) })
      .then(() => true)
      .catch(() => false);
    if (!clicked) return null;

    return this._readReportFor(page, agent?.name, 4000);
  }

  async scan(accountId, updateState = true) {
    const current = this.states.get(accountId);
    if (!current?.session || current.session.closed) return this.open(accountId);
    const page = current.session.page;
    const dialog = page.locator(SCOUT_DIALOG).first();
    await dialog.waitFor({ state: 'visible', timeout: 60000 });

    // The Free Agency shell becomes visible before the async six-player grid is
    // always ready. Waiting only for the dialog was the reason valid screens
    // could be saved as "0 players".
    const probe = await this._waitForAgentList(page, 20000);
    if (!probe?.artwork && !probe?.signButtons) {
      const account = this.accountById(accountId);
      this.log(account, 'warn', `Scout list not ready · header ${probe?.advertised ?? 0} · artwork ${probe?.artwork ?? 0} · sign ${probe?.signButtons ?? 0}.`);
    }

    const base = await page.evaluate(extractScoutData);
    if (!base || !Array.isArray(base.agents)) throw new Error('Scout data could not be read.');
    if (!base.agents.length) {
      throw new Error(`Scout player list could not be read (header ${probe?.advertised ?? 0}, artwork ${probe?.artwork ?? 0}, sign ${probe?.signButtons ?? 0}).`);
    }

    let reportsRead = 0;
    for (let i = 0; i < base.agents.length; i++) {
      const agent = base.agents[i];
      let report = null;

      // React sometimes needs a second event cycle when changing the selected
      // Scout card. Retry the artwork click before giving up on this player.
      for (let attempt = 0; attempt < 2 && !report; attempt++) {
        report = await this._selectAgentForReport(page, agent, i);
        if (!report && attempt === 0) await sleep(150);
      }

      if (report) {
        reportsRead += 1;
        agent.team = report.team;
        agent.price = report.price;
        agent.rank = report.rank;
        agent.offense = report.offense;
        agent.defense = report.defense;
        agent.base = report.base;
        if (report.position) agent.position = report.position;
        if (report.grade) agent.grade = report.grade;
      } else {
        agent.team = null;
        agent.price = null;
        agent.rank = null;
        agent.offense = null;
        agent.defense = null;
        agent.base = null;
      }

      const cardInfo = this.cards?.findForScout(agent) || null;
      agent.card = cardInfo;
      agent.cardTeam = cardInfo?.team || null;
      agent.cardStars = cardInfo?.stars ?? null;
    }

    if (base.agents.length && reportsRead !== base.agents.length) {
      const account = this.accountById(accountId);
      this.log(account, 'warn', `Scout details read · ${reportsRead}/${base.agents.length}.`);
    }

    base.updatedAt = new Date().toISOString();
    this.accountProfile?.updateFromScout(accountId, base);
    if (updateState) {
      current.data = base;
      current.status = 'open';
      current.error = null;
      this.onChanged?.();
    }
    return base;
  }

  async refresh(accountId) {
    const { account, state, session } = await this._ensureOpen(accountId);
    const page = session.page;
    const dialog = page.locator(SCOUT_DIALOG).first();

    state.status = 'refreshing';
    state.error = null;
    this.onChanged?.();

    try {
      // A Scout refresh is intentionally different from Call Back:
      // close the Free Agency modal without spending an attempt, return to Stadium,
      // reopen Agent, then read the newly rendered Scout state.
      if (await dialog.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
      }

      // Closing Scout returns to the Stadium/main screen. Loading transitions may appear,
      // so wait for Agent to become usable instead of relying on a fixed delay.
      let agent;
      try {
        agent = await this.browser.waitForSelectorReady(page, AGENT_SELECTOR, 90000);
      } catch {
        await this.browser.normalizeToStadium(session, (level, msg) => this.log(account, level, msg));
        agent = await this.browser.waitForSelectorReady(page, AGENT_SELECTOR, 90000);
      }

      await this.accountProfile?.captureStadium(accountId, page);
      await agent.click();
      await dialog.waitFor({ state: 'visible', timeout: 60000 });

      const data = await this.scan(accountId, false);
      state.data = data;
      state.status = 'open';
      state.error = null;
      this.browser.lockFeature(accountId, 'scout');
      this.onChanged?.();
      this.log(account, 'success', 'Scout reopened and refreshed.');
      return data;
    } catch (error) {
      state.status = 'error';
      state.error = error.message;
      this.onChanged?.();
      this.log(account, 'error', `Scout refresh: ${error.message}`);
      throw error;
    }
  }

  async callback(accountId) {
    const { account, state, session } = await this._ensureOpen(accountId);
    const page = session.page;
    if (!(await page.locator(SCOUT_DIALOG).first().isVisible().catch(() => false))) await this.open(accountId);
    state.status = 'refreshing';
    this.onChanged?.();

    const before = state.data?.agents?.map(a => a.key).join('|') || '';
    const beforeAttempts = state.data?.attempts;
    const button = page.getByRole('button', { name: /^Call Back$/i }).first();
    // The purchase banner can temporarily disable Call Back too. Playwright
    // waits until the control is actionable, without issuing a second click.
    await button.click({timeout:45000});

    const end = Date.now() + 20000;
    while (Date.now() < end) {
      await sleep(250);
      const data = await page.evaluate(extractScoutData).catch(() => null);
      const sig = data?.agents?.map(a => a.key).join('|') || '';
      if (data && ((sig && sig !== before) || (beforeAttempts != null && data.attempts !== beforeAttempts))) break;
    }

    const data = await this.scan(accountId, false);
    state.data = data;
    state.status = 'open';
    state.error = null;
    this.onChanged?.();
    this.log(account, 'success', 'Scout list refreshed.');
    return data;
  }

  async sign(accountId, playerKey) {
    const { account, state, session } = await this._ensureOpen(accountId);
    const page = session.page;
    if (!(await page.locator(SCOUT_DIALOG).first().isVisible().catch(() => false))) await this.open(accountId);
    state.status = 'signing';
    this.onChanged?.();

    const target = state.data?.agents?.find(a => a.key === playerKey);
    if (!target || !target.canSign) {
      const error=new Error(!target?'Player is no longer available in Scout.':'This player cannot be signed.');
      error.beforeClick=true;
      throw error;
    }

    const oldRoster = Number(state.data?.roster);
    const otherSignable = state.data?.agents?.some(a=>a.key!==playerKey && a.canSign && !a.signed);
    const dialog = page.locator(SCOUT_DIALOG).first();
    const actionButtons = dialog.locator('button').filter({ hasText: /^(Sign|Signed)$/i });
    // The previous purchase may still be showing its result banner. Wait for
    // this same player's Sign control to become available instead of failing
    // immediately or clicking a different player's button after a rerender.
    const readyDeadline=Date.now()+45000;
    let clicked=false;
    let disabledSince=null;
    while(Date.now()<readyDeadline){
      const probe=await page.evaluate(extractScoutData).catch(()=>null);
      const current=probe?.agents?.find(a=>a.key===playerKey);
      if(current?.signed){
        const data=await this.scan(accountId,false);
        state.data=data;state.status='open';this.onChanged?.();
        return {...data,signSkipped:true};
      }
      if(current?.canSign && current.index===target.index){
        disabledSince=null;
        const btn=actionButtons.nth(current.index);
        if(await btn.isEnabled().catch(()=>false)){
          // Playwright waits for a transient overlay to stop intercepting the
          // click. A failed click is never retried because its result is unknown.
          await btn.click({timeout:Math.max(1000,readyDeadline-Date.now())});
          clicked=true;
          break;
        }
      }
      if(current?.signDisabled && probe?.agents?.some(a=>a.key!==playerKey && a.canSign && !a.signed)){
        disabledSince??=Date.now();
        if(Date.now()-disabledSince>=1800){
          const data=await this.scan(accountId,false);
          if(!data.agents?.find(a=>a.key===playerKey)?.canSign){
            state.data=data;state.status='open';this.onChanged?.();
            return {...data,signSkipped:true};
          }
          disabledSince=null;
        }
      } else disabledSince=null;
      await sleep(200);
    }
    if(!clicked){
      const error=new Error(`Scout Sign for ${target.name||playerKey} stayed unavailable for 45 seconds. No other player was clicked.`);
      error.beforeClick=true;
      throw error;
    }

    // The game shows a short result message and then returns to Free Agency.
    const end = Date.now() + 45000;
    let reacted = false;
    while (Date.now() < end) {
      await sleep(250);
      if (!(await dialog.isVisible().catch(() => false))) continue;
      const probe = await page.evaluate(extractScoutData).catch(() => null);
      if (!probe) continue;
      const same = probe.agents?.find(a => a.key === playerKey);
      const rosterChanged = Number.isFinite(oldRoster) && Number(probe.roster) > oldRoster;
      if (rosterChanged || same?.signed || !same) { reacted = true; break; }
    }

    if (!reacted) throw new Error(`Scout Sign for ${target.name || playerKey} did not update within 45 seconds. Check the roster before attempting it again.`);

    if(otherSignable){
      const readyEnd=Date.now()+45000;
      let ready=false;
      while(Date.now()<readyEnd){
        const probe=await page.evaluate(extractScoutData).catch(()=>null);
        if(probe?.roster!=null && probe.rosterMax!=null && probe.roster>=probe.rosterMax){ready=true;break;}
        if(probe?.agents?.some(a=>a.key!==playerKey && a.canSign && !a.signed)){ready=true;break;}
        await sleep(200);
      }
      if(!ready)throw new Error(`Scout Sign for ${target.name||playerKey} was confirmed, but the remaining Sign buttons did not become available within 45 seconds. Continue will verify the roster before any retry.`);
    }

    const data = await this.scan(accountId, false);
    state.data = data;
    state.status = 'open';
    state.error = null;
    this.onChanged?.();
    this.log(account, 'success', `${target.name || playerKey} signed · roster ${data.roster ?? '—'}/${data.rosterMax ?? '—'}.`);
    return data;
  }

  async close(accountId) {
    const state = this.states.get(accountId);
    if (!state) return true;
    const account = this.accountById(accountId);
    const session = state.session;
    if (session && !session.closed) {
      const page = session.page;
      if (await page.locator(SCOUT_DIALOG).first().isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.locator(SCOUT_DIALOG).first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
    }
    this.browser.unlockFeature(accountId, 'scout');
    if (state.owner) await this.browser.release(accountId, state.owner, { closeWhenUnused: true }).catch(() => {});
    state.session = null;
    state.owner = null;
    state.status = 'closed';
    // Keep the last Scout snapshot in memory so the board remains useful after
    // Chromium is closed. Reopening Scout replaces it with fresh data.
    state.error = null;
    this.onChanged?.();
    this.log(account, 'info', 'Scout closed · Chromium released.');
    return true;
  }

  async shutdown() {
    for (const [id, state] of this.states.entries()) {
      this.browser.unlockFeature(id, 'scout');
      if (state?.owner) await this.browser.release(id, state.owner, { closeWhenUnused: true }).catch(() => {});
    }
    this.states.clear();
  }
}

module.exports = { ScoutService };
