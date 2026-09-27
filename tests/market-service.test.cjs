const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MarketService, readMarketView, clickMarketPager } = require('../src/main/services/market-service.cjs');

function service() {
  const account = { id: 'a', name: 'Main', login: 'login', passwordEncrypted: 'secret' };
  const events = [];
  const merged = [];
  const browser = {
    featureNames: () => [], lockFeature: () => {}, unlockFeature: () => {},
    release: async () => {}, authenticate: async () => ({ owner: 'market:a', session: { page: {} } })
  };
  const s = new MarketService({
    store: { getAccounts: () => [account] }, credentials: { decryptSecret: () => 'password' },
    browserService: browser, accountProfile: { merge: (id, data) => merged.push([id, data]) },
    activity: { add: entry => events.push(entry) }, onChanged: () => {}
  });
  return { s, browser, merged, events, account };
}

function element(tagName, textContent, attrs = {}) {
  return { tagName, textContent, children: [], getAttribute: name => attrs[name] ?? null,
    hasAttribute: name => Object.hasOwn(attrs, name) };
}

function mockCard({ name, fullName, salary, status, price, currency }) {
  const labels = ['Salary', 'Status'].map((label, i) => {
    const value = i ? status : String(salary);
    const item = element('DIV', label);
    const sibling = element('DIV', value);
    item.parentElement = { children: [item, sibling] };
    return item;
  });
  const image = element('IMG', '', { alt: fullName, src: '/_next/image?url=%2Fplayers%2Fplayer.webp' });
  const priceMarker = element(currency === 'TIX' ? 'IMG' : 'SPAN', currency === 'TIX' ? '' : '🎮', { alt: currency === 'TIX' ? 'ticket' : '' });
  const priceValue = element('SPAN', String(price));
  priceMarker.parentElement = { querySelectorAll: () => [priceMarker, priceValue] };
  return {
    querySelectorAll: selector => selector === 'div' ? labels : selector === 'img' ? [image] : selector === 'span' ? [priceMarker, priceValue] : [],
    querySelector: selector => selector === 'h3' ? element('H3', name) : selector === 'img[alt="ticket"]' && currency === 'TIX' ? priceMarker : null
  };
}

test('My Listings parser keeps SOLD, LISTED, and EXPIRED separate with the correct salary and currency', () => {
  const cards = [
    mockCard({ name: 'J. Harden', fullName: 'James Harden', salary: 1870, status: 'SOLD', price: 20, currency: 'APK' }),
    mockCard({ name: 'C. Cunningham', fullName: 'Cade Cunningham', salary: 1930, status: 'LISTED', price: 20, currency: 'APK' }),
    mockCard({ name: 'L. Shamet', fullName: 'Landry Shamet', salary: 50, status: 'EXPIRED', price: 200, currency: 'TIX' })
  ];
  const buttons = ['«', '‹', '›', '»'].map(label => element('BUTTON', label));
  const counter = element('SPAN', '2/5');
  const pager = { children: [buttons[0], buttons[1], counter, buttons[2], buttons[3]] };
  for (const button of buttons) button.parentElement = pager;
  const original = global.document;
  global.document = {
    body: element('BODY', 'My Listings Salary Status'),
    querySelectorAll: selector => selector === 'button' ? buttons : selector === 'h1,h2,h3' ? [element('H2','My Listings')] :
      selector === 'div[class*="group/card"]' ? cards : []
  };
  try {
    const parsed = readMarketView();
    assert.deepEqual(parsed.pagination, { current: 2, total: 5 });
    assert.equal(parsed.invalid, false);
    assert.deepEqual(parsed.rows.map(row => [row.fullName, row.status, row.salary, row.price, row.currency]), [
      ['James Harden', 'SOLD', 1870, 20, 'APK'],
      ['Cade Cunningham', 'LISTED', 1930, 20, 'APK'],
      ['Landry Shamet', 'EXPIRED', 50, 200, 'TIX']
    ]);
  } finally { global.document = original; }
});

test('A short 1/1 My Listings page uses its own pager rather than the Trading Hall pager behind it', async () => {
  const { s } = service();
  const cards = [
    mockCard({ name: 'A', fullName: 'Player A', salary: 100, status: 'LISTED', price: 10, currency: 'APK' }),
    mockCard({ name: 'B', fullName: 'Player B', salary: 200, status: 'SOLD', price: 20, currency: 'APK' }),
    mockCard({ name: 'C', fullName: 'Player C', salary: 300, status: 'EXPIRED', price: 30, currency: 'APK' })
  ];
  const listingButtons = ['«', '‹', '›', '»'].map(label => element('BUTTON', label, { disabled: '' }));
  const listingCounter = element('SPAN', '1/1');
  const listingPager = { children: [listingButtons[0], listingButtons[1], listingCounter,
    listingButtons[2], listingButtons[3]], className: 'flex items-center gap-1' };
  for (const button of listingButtons) button.parentElement = listingPager;
  listingCounter.parentElement = listingPager;
  const hallButton = element('BUTTON', '«');
  hallButton.parentElement = { children: [hallButton, element('SPAN', '1/20')] };
  const heading = element('H3', 'My Listings');
  const badges = ['Listed: 1', 'Sold: 1', 'Expired: 1'].map(value => element('SPAN', value));
  const listingRoot = {
    textContent: 'My Listings',
    querySelectorAll: selector => selector === 'button' ? listingButtons :
      selector === 'span' ? [...badges, listingCounter] :
      selector === 'div[class*="group/card"]' ? cards : []
  };
  heading.closest = selector => selector === 'div.absolute.inset-0' ? listingRoot : null;
  const original = global.document;
  global.document = {
    body: element('BODY', 'Trading Hall'),
    querySelectorAll: selector => selector === 'h1,h2,h3' ? [heading] :
      selector === 'button' ? [hallButton, ...listingButtons] : []
  };
  try {
    const parsed = readMarketView();
    assert.deepEqual(parsed.pagination, { current: 1, total: 1 });
    assert.equal(parsed.headerCount, 3);
    assert.equal(parsed.cardCount, 3);
    assert.equal(clickMarketPager('›'), false);
    s._view = async () => readMarketView();
    s._clickPager = async () => { throw Error('Single-page listings must not turn a pager'); };
    const rows = await s._scanPages({}, 'a', new AbortController().signal);
    assert.equal(rows.length, 3);
    assert.equal(s.snapshot().a.totalPages, 1);
  } finally { global.document = original; }
});

test('A 1/1 counter remains readable when the game omits disabled navigation buttons', async () => {
  const { s } = service();
  const counter = element('SPAN', '1/1');
  counter.parentElement = { className: 'flex items-center gap-1' };
  const heading = element('H3', 'My Listings');
  const cards = [mockCard({ name: 'A', fullName: 'Player A', salary: 100,
    status: 'SOLD', price: 10, currency: 'APK' })];
  const root = { textContent: 'My Listings', querySelectorAll: selector =>
    selector === 'span' ? [counter] : selector === 'div[class*="group/card"]' ? cards : [] };
  heading.closest = selector => selector === 'div.absolute.inset-0' ? root : null;
  const original = global.document;
  global.document = { body: element('BODY', ''),
    querySelectorAll: selector => selector === 'h1,h2,h3' ? [heading] : [] };
  try {
    s._view = async () => readMarketView();
    const view = await s._waitPage({}, 1, new AbortController().signal, null, 1500);
    assert.deepEqual(view.pagination, { current: 1, total: 1 });
    assert.equal(view.cardCount, 1);
  } finally { global.document = original; }
});

test('Page switch waits for eight fresh cards; a new page number with old cards is not accepted', async () => {
  const { s } = service();
  const page = { id: 'page' };
  let reads = 0;
  s._view = async () => {
    reads++;
    return { listingOpen: true, loading: false, invalid: false,
      pagination: { current: 2, total: 4 }, cardCount: reads === 2 ? 4 : 8,
      signature: reads < 3 ? 'old-page-cards' : 'new-page-cards' };
  };
  const result = await s._waitPage(page, 2, new AbortController().signal, 'old-page-cards', 5000);
  assert.equal(result.signature, 'new-page-cards');
  assert.ok(reads >= 4);
});

test('My Listings scan includes every page and keeps the shorter last page', async () => {
  const { s } = service();
  const page = {};
  const counts = [8, 8, 3];
  const views = counts.map((count, pageIndex) => ({
    listingOpen: true, pagination: { current: pageIndex + 1, total: 3 },
    cardCount: count, signature: `page-${pageIndex + 1}`,
    rows: Array.from({ length: count }, (_, index) => ({
      fullName: `Player ${pageIndex + 1}-${index}`, status: pageIndex === 1 && index === 1 ? 'SOLD' : 'LISTED'
    }))
  }));
  s._firstPage = async () => views[0];
  s._clickPager = async (_page, label) => assert.equal(label, '›');
  s._waitPage = async (_page, target, _signal, signature) => {
    assert.equal(signature, views[target - 2].signature);
    return views[target - 1];
  };
  const rows = await s._scanPages(page, 'a', new AbortController().signal);
  assert.equal(rows.length, 19);
  assert.equal(rows.find(row => row.status === 'SOLD').page, 2);
  assert.equal(s.snapshot().a.totalPages, 3);
  assert.equal(s.snapshot().a.rows.filter(row => row.page === 3).length, 3);
});

test('A completed scan retains unsold and expired rows but closes accounts with no SOLD listing', async () => {
  const { s } = service();
  const row = { status: 'LISTED', fullName: 'Available player', salary: 100, price: 20, currency: 'APK' };
  const expired = { status: 'EXPIRED', fullName: 'Stock player', salary: 50, price: 200, currency: 'TIX' };
  let closed = 0;
  s._ensureSession = async () => ({ page: {} });
  s._openListings = async () => {};
  s._scanPages = async (_page, id) => {
    s.set(id, { rows: [row, expired], page: 1, totalPages: 1 });
    return [row, expired];
  };
  s._closeSession = async () => { closed++; };
  const result = await s.open('a');
  assert.equal(closed, 1);
  assert.equal(result.status, 'closed');
  assert.equal(result.rows[1].status, 'EXPIRED');
});

test('An APK verification left pending is retried before closing an account with no remaining SOLD listing', async () => {
  const { s } = service();
  s.state('a').pendingApkRefresh = true;
  s._ensureSession = async () => ({ page: {} });
  s._openListings = async () => {};
  s._scanPages = async (_page, id) => { s.set(id, { rows: [] }); return []; };
  let refreshed = 0;
  let closedWithoutVerification = 0;
  s._refreshApkAndClose = async () => { refreshed++; s.set('a', { pendingApkRefresh: false, status: 'closed' }); };
  s._closeSession = async () => { closedWithoutVerification++; };
  await s.open('a');
  assert.equal(refreshed, 1);
  assert.equal(closedWithoutVerification, 0);
});

test('A failed APK retry leaves the Market session open so the balance can be checked again', async () => {
  const { s } = service();
  s.state('a').pendingApkRefresh = true;
  s._ensureSession = async () => ({ page: {} });
  s._openListings = async () => {};
  s._scanPages = async (_page, id) => { s.set(id, { rows: [] }); return []; };
  s._refreshApkAndClose = async () => { throw new Error('APK still loading'); };
  let closed = 0;
  s._closeSession = async () => { closed++; };
  await assert.rejects(s.open('a'), /APK still loading/);
  assert.equal(closed, 0);
  assert.equal(s.snapshot().a.pendingApkRefresh, true);
  assert.equal(s.snapshot().a.status, 'error');
  await assert.rejects(s.close('a'), /must be verified/);
  assert.equal(closed, 0);
});

test('After claiming on page 2 the game pager goes back and forward, even if the displayed cards already look like page 1', async () => {
  const { s } = service();
  const actions = [];
  s._view = async () => ({ pagination: { current: 2, total: 5 }, signature: 'already-page-one' });
  s._clickPager = async (_page, key) => actions.push(key);
  s._waitPage = async (_page, target, _signal, previous) => {
    actions.push(`${target}:${previous}`);
    return { pagination: { current: target, total: 5 }, signature: `page-${target}` };
  };
  await s._recoverAfterClaim({}, 2, new AbortController().signal, 'before');
  assert.deepEqual(actions, ['‹', '1:null', '›', '2:page-1']);
});

test('Claim requires confirmation and verified success before Continue; a timeout cannot cause a second confirm', async () => {
  const { s } = service();
  const steps = [];
  const row = { accountId: 'a', page: 4, index: 1, status: 'SOLD', fullName: 'James Harden', imagePath: '/players/harden.webp', price: 20, currency: 'APK' };
  s._goToPage = async () => ({ rows: [null, { ...row }], signature: 'page-four' });
  s._recoverAfterClaim = async (_page, number) => steps.push(`recover:${number}`);
  const confirm = {
    waitFor: async () => { steps.push('confirm-visible'); },
    innerText: async () => 'Claim Sale 19 APK — after 3% tax',
    getByRole: () => ({ click: async () => { steps.push('confirm-click'); } })
  };
  const success = {
    waitFor: async ({ state }) => { steps.push(`success-${state}`); },
    innerText: async () => 'CLAIM SUCCESSFUL Successfully claimed 19 APK',
    getByRole: () => ({ click: async () => { steps.push('continue-click'); } })
  };
  const page = { locator: selector => selector.includes('group/card') ? {
    nth: () => ({ getByRole: () => ({ click: async () => { steps.push('claim-click'); } }) })
  } : { first: () => selector.includes('Claim confirmation') ? confirm : success } };
  assert.equal(await s._claimOne(page, row, new AbortController().signal), true);
  assert.equal(s.snapshot().a.pendingApkRefresh, true);
  assert.deepEqual(steps, ['claim-click', 'confirm-visible', 'confirm-click', 'success-visible', 'continue-click', 'success-hidden', 'recover:4']);
  success.waitFor = async () => { throw new Error('success not visible'); };
  steps.length = 0;
  await assert.rejects(s._claimOne(page, row, new AbortController().signal), /success not visible/);
  assert.equal(steps.filter(step => step === 'confirm-click').length, 1);
  assert.equal(steps.includes('recover:4'), false);
});

test('A login failure before Confirm Claim does not lock the account into APK verification', async () => {
  const { s } = service();
  s.state('a').rows = [{ status: 'SOLD' }];
  s._ensureSession = async () => { throw new Error('Login unavailable'); };
  await assert.rejects(s.claim('a'), /Login unavailable/);
  assert.equal(s.snapshot().a.pendingApkRefresh, false);
  s._closeSession = async () => {};
  await s.close('a');
});

test('One account Claim collects every SOLD sale and closes only after the final scan and APK check', async () => {
  const { s } = service();
  const sales = [
    { fullName: 'James Harden', status: 'SOLD', price: 20, currency: 'APK' },
    { fullName: 'Other sale', status: 'SOLD', price: 30, currency: 'APK' }
  ];
  s.state('a').rows = [...sales];
  const steps = [];
  s._ensureSession = async () => ({ page: {} });
  s._openListings = async () => {};
  s._scanPages = async (_page, id) => {
    steps.push(`scan:${sales.length}`);
    s.set(id, { rows: [...sales] });
    return [...sales];
  };
  s._claimOne = async (_page, sale) => {
    steps.push(`claim:${sale.fullName}`);
    sales.shift();
    return true;
  };
  s._refreshApkAndClose = async (_account) => {
    steps.push('stadium-apk-and-close');
    s.set('a', { status: 'closed' });
  };
  const result = await s.claim('a');
  assert.deepEqual(steps, ['scan:2', 'claim:James Harden', 'scan:1', 'claim:Other sale', 'scan:0', 'stadium-apk-and-close']);
  assert.equal(result.claimed, 2);
  assert.equal(result.rows.length, 0);
});

test('Claim returns to City and Stadium and updates APK from the actual widget, including zero', async () => {
  const { s, merged } = service();
  const steps = [];
  const back = { isVisible: async () => true, click: async () => { steps.push('back'); } };
  const stadium = { waitFor: async () => { steps.push('city'); }, click: async () => { steps.push('stadium'); } };
  const agent = { isVisible: async () => false, waitFor: async () => { steps.push('home'); } };
  s.state('a').pendingApkRefresh = true;
  const page = {
    getByRole: () => ({ first: () => back }),
    locator: selector => ({ first: () => selector.includes('Stadium') ? stadium : agent }),
    evaluate: async () => ({ apk: 0, stadiumReady: true, level: 20 })
  };
  s._closeSession = async () => { steps.push('closed'); };
  await s._refreshApkAndClose({ id: 'a' }, { page }, new AbortController().signal);
  assert.deepEqual(steps, ['back', 'city', 'stadium', 'home', 'closed']);
  assert.equal(merged[0][1].apk, 0);
  assert.equal(s.snapshot().a.pendingApkRefresh, false);
});
