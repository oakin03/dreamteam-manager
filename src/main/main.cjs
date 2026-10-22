const { app, BrowserWindow, ipcMain, shell, globalShortcut, Notification } = require('electron');
const path = require('path');
const crypto = require('crypto');

const { AppStore, ensureDir } = require('./services/store.cjs');
const credentials = require('./services/credentials.cjs');
const { ActivityService } = require('./services/activity.cjs');
const { TaskRegistry } = require('./services/task-registry.cjs');
const { BrowserService } = require('./services/browser-service.cjs');
const { TaskEngine } = require('./services/task-engine.cjs');
const { SchedulerService, BUILTIN_TASKS } = require('./services/scheduler.cjs');
const { ScoutService } = require('./services/scout-service.cjs');
const { TradingHallService } = require('./services/trading-hall-service.cjs');
const { DailyRewardService } = require('./services/daily-reward-service.cjs');
const { AccountProfileService } = require('./services/account-profile-service.cjs');
const { CardsService } = require('./services/cards-service.cjs');
const { AutoTradeEngine } = require('./services/auto-trade-engine.cjs');
const { MarketService } = require('./services/market-service.cjs');
const { GameSessions } = require('./services/game-sessions.cjs');
// The old browser Player Market (player-market-*.cjs) is kept on disk but no longer used.
const { PlayersService } = require('./services/players-service.cjs');
const { DraftService } = require('./services/draft-service.cjs');
const { syncMcpConfig } = require('./services/mcp-sync.cjs');
const { TournamentService } = require('./services/tournament-service.cjs');
const { DailyRoutineService } = require('./services/daily-routine-service.cjs');
const { PvpService } = require('./services/pvp-service.cjs');
const { BuyService } = require('./services/buy-service.cjs');
const { EquipmentService } = require('./services/equipment-service.cjs');

let mainWindow;
let store;
let activity;
let registry;
let browserService;
let engine;
let scheduler;
let scout;
let trading;
let dailyRewards;
let accountProfile;
let cards;
let autoTrade;
let market;
let gameSessions;
let players;
let draft;
let pvp;
let buy;
let lastBuyRevision = -1;
let lastDraftRevision = -1;
let lastPlayersKey = null;
let tournament;
let dailyRoutine;
let equipment;
let lastEquipmentRevision = -1;
let lastAutoTradeRevision = -1;
let dataDir;
let systemLocale = 'en-US';
let pendingState = null;
let lastCardsKey = null;
let lastTradeRows = null;
let lastTradeScanning = null;
let lastActivityRevision = null;

function bundledTasksDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'default-tasks');
  return path.join(__dirname, '..', '..', 'default-tasks');
}
function taskDir() { return path.join(dataDir, 'tasks'); }
function sanitizeAccount(account) { if (!account) return null; const { passwordEncrypted, ...safe } = account; return safe; }

function snapshot({ incremental = false } = {}) {
  const cardKey = [store.revision('cards'), store.revision('cardRoles'), store.revision('cardMetadata'), JSON.stringify(cards.runtime)].join(':');
  const scanning = ['starting', 'running'].includes(trading.runtime.status);
  const tradeRowsChanged = lastTradeRows !== trading.rows || lastTradeScanning !== scanning;
  const state = {
    accounts: store.getAccounts().map(sanitizeAccount),
    tradeAccount: sanitizeAccount(store.getTradeAccount()),
    tasks: registry.list(),
    builtinTasks: Object.entries(BUILTIN_TASKS).map(([id, task]) => ({ id, name: task.name })),
    schedules: store.getSchedules(),
    settings: store.getSettings(),
    runtime: engine.states(),
    accountProfile: accountProfile.snapshot(),
    scout: scout.snapshot(),
    market: market?.snapshot() || {},
    trading: {
      runtime: trading.snapshot()
    },
    rewards: dailyRewards?.snapshot() || {},
    tournament: tournament?.snapshot() || { runtime: { status: 'idle' }, accounts: {}, events: [] },
    dailyRoutine: dailyRoutine?.snapshot() || { selected: [], accounts: {} },
    pvp: pvp?.snapshot() || { running: false, run: null, lastReport: null },
    systemLocale,
    dataDir,
    taskDir: taskDir()
  };
  if (!incremental || tradeRowsChanged) state.trading.rows = trading.rowsSnapshot();
  if (!incremental || lastCardsKey !== cardKey) state.cards = cards.snapshot();
  if (autoTrade && (!incremental || lastAutoTradeRevision !== autoTrade.revision)) { state.autoTrade2 = autoTrade.snapshot(); lastAutoTradeRevision = autoTrade.revision; }
  // 640 players: sent when the list or the roles changed.
  const playersKey = players ? `${players.revision}:${store.revision('cardMetadata')}:${store.revision('cardRoles')}:${store.revision('cards')}` : null;
  if (players && (!incremental || lastPlayersKey !== playersKey)) { state.players = players.snapshot(); lastPlayersKey = playersKey; }
  if (buy && (!incremental || lastBuyRevision !== buy.revision)) { state.buy = buy.snapshot(); lastBuyRevision = buy.revision; }
  if (draft && (!incremental || lastDraftRevision !== draft.revision)) { state.draft = draft.snapshot(); lastDraftRevision = draft.revision; }
  if (equipment && (!incremental || lastEquipmentRevision !== equipment.revision)) { state.equipment = equipment.snapshot(); lastEquipmentRevision = equipment.revision; }
  if (!incremental || lastActivityRevision !== store.revision('activity')) state.activity = store.getActivity();
  lastCardsKey = cardKey;
  lastTradeRows = trading.rows;
  lastTradeScanning = scanning;
  lastActivityRevision = store.revision('activity');
  return state;
}

function emitState() {
  if (pendingState || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return;
  // Services can report several changes in the same event-loop turn. Send the
  // latest complete state once, avoiding repeated disk work and IPC cloning.
  pendingState = setTimeout(() => {
    pendingState = null;
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
      mainWindow.webContents.send('app:state', snapshot({ incremental: true }));
    }
  }, 50);
}


// Auto Trade asks for the user (an error, a market listing, the end of a run): bring
// the window forward when minimized, flash the taskbar and show a Windows notification.
function autoTradeAttention(kind, text) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isFocused()) mainWindow.flashFrame(true);
    }
    if (Notification.isSupported()) {
      const tr = (store?.getSettings()?.language || 'tr') !== 'en';
      const titles = { error: tr ? 'Auto Trade durdu' : 'Auto Trade stopped', listing: tr ? 'Auto Trade: pazara listeleme' : 'Auto Trade: market listing', draftTurn: tr ? 'Draft: sıra sende' : 'Draft: your turn', done: tr ? 'Auto Trade bitti' : 'Auto Trade finished', conflict: tr ? 'Auto Trade: hesaplar kullanımda' : 'Auto Trade: accounts in use', buyNoFunds: tr ? 'Auto Buy durdu' : 'Auto Buy stopped', buyError: tr ? 'Auto Buy durdu' : 'Auto Buy stopped' };
      const bodies = { listing: tr ? `${text} kadrosu doldu · hangi oyuncuların listeleneceğini seç` : `${text}'s roster is full · choose players to list`, done: tr ? 'Tüm hesaplar tamamlandı' : 'All accounts are done', draftTurn: tr ? `${text} seçim yapacak · 30 saniye` : `${text} picks now · 30 seconds`, buyNoFunds: tr ? `Hesapların ${text} miktarı yetersiz` : `The accounts do not have enough ${text}` };
      const n = new Notification({ title: titles[kind] || 'Auto Trade', body: bodies[kind] || String(text || '') });
      n.on('click', () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } });
      n.show();
    }
  } catch {}
}

// Systems that would clash with Auto Trade on the selected accounts.
// PVP page: whatever runs on the chosen accounts (Auto Play) is stopped first, so it
// does not start other matches, and started again when PVP is over.
// PVP and Auto Buy connect the accounts to the game, so whatever runs on them
// (Auto Play) is stopped first and started again when they are over.
// `taskName` / `prefix` name the service in the logs (e.g. 'PVP' / 'pvp').
async function pauseTasksFor(accountIds, taskName, prefix) {
  const resume = [];
  const name = id => store.getAccounts().find(a => a.id === id)?.name || '';
  for (const id of accountIds) {
    const worker = engine.workers.get(id);
    const prepared = engine.prepared.get(id);
    const active = worker && ['running', 'preparing', 'starting'].includes(worker.status) ? worker : prepared;
    if (!active) continue;
    resume.push({ accountId: id, taskId: active.taskId, taskName: active.taskName, visibleBrowser: Boolean(active.visibleBrowser), config: active.config || null });
    await engine.stopAccount(id, { reason: `Stopped for ${taskName}`, quiet: true });
    activity.add({ level: 'info', accountId: id, accountName: name(id), taskName, code: `${prefix}.pausedTask`, params: { task: active.taskName || '' }, message: `${active.taskName} stopped for ${taskName}` });
  }
  return async () => {
    for (const r of resume) {
      try {
        await engine.startAccount(r.accountId, r.taskId, { visibleBrowser: r.visibleBrowser, forceFresh: false, config: r.config });
        activity.add({ level: 'success', accountId: r.accountId, accountName: name(r.accountId), taskName, code: `${prefix}.resumedTask`, params: { task: r.taskName || '' }, message: `${r.taskName} started again` });
      } catch (error) {
        activity.add({ level: 'error', accountId: r.accountId, accountName: name(r.accountId), taskName, code: `${prefix}.resumeFailed`, params: { task: r.taskName || '', error: error.message }, message: `${r.taskName} could not start again: ${error.message}` });
      }
    }
  };
}

async function startPvpManual(accountIds) {
  if (!accountIds.length) throw new Error('Select at least one account.');
  if (pvp.snapshot().running) throw new Error('PVP is already running.');
  const resume = await pauseTasksFor(accountIds, 'PVP', 'pvp');
  pvp.runAndWait(accountIds, { source: 'manual' }).catch(() => {}).finally(resume);
  return pvp.snapshot();
}

async function startAutoBuy(options) {
  const ids = Array.isArray(options?.accountIds) ? options.accountIds : [];
  if (buy.snapshot().auto.status === 'running') throw new Error('Auto Buy is already running.');
  const resume = await pauseTasksFor(ids, 'Auto Buy', 'ab');
  try {
    const snap = await buy.startAuto(options);
    buy.done.finally(resume);
    return snap;
  } catch (error) {
    await resume();
    throw error;
  }
}

function autoTradeConflicts(accountIds) {
  const ids = new Set(accountIds);
  const name = id => store.getAccounts().find(a => a.id === id)?.name || id;
  const out = [];
  for (const [id, r] of Object.entries(engine.states())) {
    if (ids.has(id) && ['running', 'preparing', 'starting'].includes(r.status)) out.push({ kind: 'autoplay', accountId: id, name: name(id) });
  }
  for (const [id, sc] of Object.entries(scout.snapshot() || {})) if (ids.has(id) && sc.browserOpen) out.push({ kind: 'scout', accountId: id, name: name(id) });
  if (equipment?.accountId && ids.has(equipment.accountId)) out.push({ kind: 'equipment', accountId: equipment.accountId, name: name(equipment.accountId) });
  if (market?.snapshot()?.busy) out.push({ kind: 'market' });
  if (tournament?.snapshot()?.runtime?.status === 'running') out.push({ kind: 'tournament' });
  for (const sc of store.getSchedules()) {
    if (sc.enabled && !sc.completed && (sc.accountIds || []).some(id => ids.has(id))) out.push({ kind: 'schedule', name: sc.name || sc.taskName, startAt: sc.startAt, accounts: sc.accountIds.filter(id => ids.has(id)).map(name) });
  }
  return out;
}

async function stopAutoTradeConflicts(accountIds) {
  const ids = new Set(accountIds);
  for (const [id, r] of Object.entries(engine.states())) {
    if (ids.has(id) && ['running', 'preparing', 'starting'].includes(r.status)) await engine.stopAccount(id, { reason: 'Stopped for Auto Trade' });
  }
  for (const [id, sc] of Object.entries(scout.snapshot() || {})) if (ids.has(id) && sc.browserOpen) await scout.close(id).catch(() => {});
  if (equipment?.accountId && ids.has(equipment.accountId)) await equipment.close();
  if (market?.snapshot()?.busy) await market.stop();
  if (tournament?.snapshot()?.runtime?.status === 'running') await tournament.stop();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#F4F6F8',
    title: 'DreamTeam Manager',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  mainWindow.webContents.once('did-finish-load', emitState);
}

function initServices() {
  systemLocale = app.getLocale() || 'en-US';
  dataDir = path.join(app.getPath('userData'), 'DreamTeamAutomator');
  ensureDir(dataDir);
  store = new AppStore(dataDir);
  // Trading Hall is session-only: old scan results must never survive an app restart.
  store.saveTradingRows([]);
  activity = new ActivityService(store, emitState);
  accountProfile = new AccountProfileService({ store, onChanged: emitState, activity });
  registry = new TaskRegistry({ taskDir: taskDir(), bundledTaskDir: bundledTasksDir() });
  browserService = new BrowserService({
    dataDir,
    activity,
    stadiumObserver: (accountId, page) => accountProfile.captureStadium(accountId, page)
  });
  accountProfile.setBasicInfoSource(page => browserService.basicInfoFor(page));
  gameSessions = new GameSessions({ browserService, credentials, accountProfile });
  cards = new CardsService({ store, activity, accountProfile, sessions: gameSessions, onChanged: emitState });
  dailyRoutine = new DailyRoutineService({ store, activity, sessions: gameSessions, onChanged: emitState });
  engine = new TaskEngine({
    store, credentials, registry, browserService, activity, onChanged: emitState,
    beforeRun: ({ account, signal }) => dailyRoutine.runIfDue(account, { signal }),
    beforeRunNextAt: accountId => dailyRoutine.nextDueAt(accountId)
  });
  scheduler = new SchedulerService({ store, engine, activity, onChanged: emitState });
  scout = new ScoutService({ store, credentials, browserService, activity, cardsService: cards, accountProfile, onChanged: emitState });
  trading = new TradingHallService({ store, credentials, browserService, activity, onChanged: emitState });
  dailyRewards = new DailyRewardService({ store, credentials, browserService, activity, engine, onChanged: emitState });
  autoTrade = new AutoTradeEngine({ store, credentials, activity, sessions: gameSessions, accountProfile, onChanged: emitState, onAttention: autoTradeAttention, onScout: (id, reply) => scout.showSocketScout?.(id, reply), onCycleEnd: () => cards.refresh() });
  market = new MarketService({ store, activity, accountProfile, sessions: gameSessions, onChanged: emitState });
  players = new PlayersService({ store, activity, onChanged: emitState });
  buy = new BuyService({ store, activity, sessions: gameSessions, accountProfile, onChanged: emitState, onAttention: autoTradeAttention });
  pvp = new PvpService({ store, activity, sessions: gameSessions, onChanged: emitState });
  draft = new DraftService({ store, activity, sessions: gameSessions, accountProfile, onChanged: emitState, onAttention: autoTradeAttention });
  equipment = new EquipmentService({ store, activity, sessions: gameSessions, onChanged: emitState });
  tournament = new TournamentService({ store, credentials, browserService, accountProfile, activity, sessions: gameSessions, onChanged: emitState });
  scheduler.registerBuiltin('tournament-register', (accountIds, { signal }) => tournament.runAndWait(accountIds, { signal }));
  scheduler.registerBuiltin('market-claim', async (accountIds, { signal }) => {
    const onAbort = () => market.stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    try { await market.claim(accountIds); } finally { signal?.removeEventListener('abort', onAbort); }
  });
  scheduler.registerBuiltin('pvp-arena', (accountIds, { signal }) => pvp.runAndWait(accountIds, { signal, source: 'schedule' }));
  scheduler.registerBuiltin('market-relist', (accountIds, { signal }) => market.relistRecent(accountIds, { signal }));
  scheduler.start();
  players.start();
  dailyRewards.start();
  syncMcpServers();
}

// Dev only: one Playwright MCP server per account in the project's .mcp.json.
let mcpSyncChain = Promise.resolve();
function syncMcpServers() {
  if (app.isPackaged) return;
  // Serialized so two quick account changes never seed the same profile twice.
  mcpSyncChain = mcpSyncChain
    .then(() => syncMcpConfig({ projectRoot: path.join(__dirname, '..', '..'), dataDir, accounts: store.getAccounts() }))
    .then(result => { for (const err of result.errors) console.warn('[mcp] seed failed', err); })
    .catch(err => console.warn('[mcp] sync failed:', err.message));
}

function defaultTaskId() { return registry.list().find(t => !t.loadError)?.id || null; }

function registerIpc() {
  ipcMain.handle('app:bootstrap', async () => snapshot());

  ipcMain.handle('accounts:add', async (_event, payload) => {
    const accounts = store.getAccounts();
    const id = crypto.randomUUID();
    const account = {
      id,
      name: String(payload.name || payload.login || 'Account').trim(),
      login: String(payload.login || '').trim(),
      passwordEncrypted: credentials.encryptSecret(String(payload.password || '')),
      selectedTaskId: payload.selectedTaskId || defaultTaskId(),
      visibleBrowser: false,
      taskConfig: {},
      createdAt: new Date().toISOString()
    };
    if (!account.login || !payload.password) throw new Error('Login and password are required.');
    accounts.push(account); store.saveAccounts(accounts);
    activity.add({ level: 'success', accountId: id, accountName: account.name, message: 'Account added.' });
    syncMcpServers();
    emitState(); return sanitizeAccount(account);
  });

  // The saved order is the order every page lists the accounts in.
  ipcMain.handle('accounts:reorder', async (_event, ids) => {
    const accounts = store.getAccounts();
    const byId = new Map(accounts.map(a => [a.id, a]));
    const listed = [...new Set(Array.isArray(ids) ? ids : [])].filter(id => byId.has(id)).map(id => byId.get(id));
    // Accounts missing from `ids` (e.g. added meanwhile) keep their place at the end.
    const ordered = [...listed, ...accounts.filter(a => !listed.includes(a))];
    store.saveAccounts(ordered); emitState(); return ordered.map(a => a.id);
  });

  ipcMain.handle('accounts:update', async (_event, { id, patch }) => {
    const accounts = store.getAccounts();
    const account = accounts.find(a => a.id === id);
    if (!account) throw new Error('Account not found.');
    if (typeof patch.name === 'string') account.name = patch.name.trim() || account.name;
    if (typeof patch.login === 'string') account.login = patch.login.trim();
    if (typeof patch.password === 'string' && patch.password.length) account.passwordEncrypted = credentials.encryptSecret(patch.password);
    if (typeof patch.visibleBrowser === 'boolean') account.visibleBrowser = patch.visibleBrowser;
    if (patch.taskConfig && typeof patch.taskConfig === 'object') account.taskConfig = { ...(account.taskConfig || {}), ...patch.taskConfig };
    store.saveAccounts(accounts);
    if (typeof patch.name === 'string') syncMcpServers();
    emitState(); return sanitizeAccount(account);
  });

  ipcMain.handle('accounts:remove', async (_event, id) => {
    await market.remove(id);
    gameSessions.invalidate(id);
    await engine.stopAccount(id, { reason: 'Account removed', quiet: true });
    const accounts = store.getAccounts();
    const account = accounts.find(a => a.id === id);
    store.saveAccounts(accounts.filter(a => a.id !== id));
    accountProfile.removeAccount(id);
    browserService.deleteProfile(id);
    const schedules = store.getSchedules().map(s => ({ ...s, accountIds: s.accountIds.filter(x => x !== id) })).filter(s => s.accountIds.length);
    store.saveSchedules(schedules);
    if (account) activity.add({ level: 'warning', accountId: id, accountName: account.name, message: 'Account removed.' });
    syncMcpServers();
    emitState(); return true;
  });

  ipcMain.handle('accounts:start', async (_event, id) => {
    const account = store.getAccounts().find(a => a.id === id);
    if (!account) throw new Error('Account not found.');
    const taskId = account.selectedTaskId || defaultTaskId();
    if (!taskId) throw new Error('Task 1 is not available.');
    await engine.startAccount(id, taskId, { visibleBrowser: Boolean(account.visibleBrowser), forceFresh: false });
    emitState(); return true;
  });
  ipcMain.handle('accounts:stop', async (_event, id) => { await engine.stopAccount(id, { reason: 'Stopped by user' }); emitState(); return true; });
  ipcMain.handle('accounts:select-task', async (_event, { id, taskId }) => {
    const accounts = store.getAccounts(); const account = accounts.find(a => a.id === id); if (!account) throw new Error('Account not found.');
    account.selectedTaskId = taskId; store.saveAccounts(accounts); emitState(); return true;
  });

  ipcMain.handle('accounts:set-main', async (_event, id) => {
    accountProfile.setMainAccount(id || null);
    emitState();
    return true;
  });

  ipcMain.handle('scout:open', async (_event, accountId) => scout.open(accountId));
  ipcMain.handle('scout:refresh', async (_event, accountId) => scout.refresh(accountId));
  ipcMain.handle('scout:callback', async (_event, accountId) => scout.callback(accountId));
  ipcMain.handle('scout:sign', async (_event, { accountId, playerKey }) => scout.sign(accountId, playerKey));
  ipcMain.handle('scout:close', async (_event, accountId) => scout.close(accountId));

  ipcMain.handle('market:scan', async (_event, accountIds) => market.scan(accountIds));
  ipcMain.handle('market:claim', async (_event, accountIds) => market.claim(accountIds));
  ipcMain.handle('market:load-relist', async (_event, accountIds) => market.loadRelist(accountIds));
  ipcMain.handle('market:relist', async (_event, items) => market.relistPlayers(items));
  ipcMain.handle('market:clear-relist', async () => { market.clearRelist(); return true; });
  ipcMain.handle('market:stop', async () => market.stop());

  ipcMain.handle('trade:save-account', async (_event, payload) => trading.saveAccount(payload));
  ipcMain.handle('trade:start', async (_event, options) => trading.start(options));
  ipcMain.handle('trade:stop', async () => trading.stop());
  ipcMain.handle('trade:clear', async () => { trading.clearRows(); return true; });
  ipcMain.handle('equipment:open', async (_event, accountId) => equipment.open(accountId));
  ipcMain.handle('equipment:scan', async () => equipment.scan());
  ipcMain.handle('equipment:close', async () => equipment.close());
  ipcMain.handle('equipment:stop', async () => equipment.stop());
  ipcMain.handle('equipment:recipes', async () => equipment.recipeList());
  ipcMain.handle('equipment:convert', async (_event, { rarity, conversions }) => equipment.convert(rarity, conversions));
  ipcMain.handle('equipment:craft', async (_event, { recipeId, count }) => equipment.craft(recipeId, count));
  ipcMain.handle('equipment:enchant', async (_event, inventoryId) => equipment.enchant(inventoryId));
  ipcMain.handle('equipment:enhance', async (_event, { inventoryId, target }) => equipment.enhance(inventoryId, target));
  ipcMain.handle('equipment:enhance-rate', async (_event, inventoryId) => equipment.enhanceRate(inventoryId));
  ipcMain.handle('equipment:refine-details', async (_event, inventoryId) => equipment.refineDetails(inventoryId));
  ipcMain.handle('equipment:refine', async (_event, inventoryId) => equipment.refine(inventoryId));
  ipcMain.handle('equipment:register', async (_event, collectionId) => equipment.registerCollection(collectionId));
  ipcMain.handle('equipment:plan', async (_event, collectionId, slot) => equipment.planCollection(collectionId, slot || null));
  ipcMain.handle('equipment:prepare', async (_event, collectionId, slot) => equipment.prepareCollection(collectionId, slot || null));
  ipcMain.handle('tournament:start', async (_event, accountIds) => tournament.start(accountIds));
  ipcMain.handle('tournament:stop', async () => tournament.stop());
  ipcMain.handle('tournament:refresh', async () => tournament.refreshEvents());

  ipcMain.handle('auto-trade:preflight', async (_event, options) => ({ conflicts: autoTradeConflicts(options.accountIds || []), ...(await autoTrade.preflight(options)) }));
  ipcMain.handle('auto-trade:attention', async (_event, kind) => { autoTradeAttention(kind); return true; });
  ipcMain.handle('auto-trade:start', async (_event, options) => {
    if (options.stopConflicts) await stopAutoTradeConflicts(options.accountIds || []);
    return autoTrade.start(options);
  });
  ipcMain.handle('auto-trade:pause', async () => autoTrade.pause());
  ipcMain.handle('auto-trade:resume', async () => autoTrade.resume());
  ipcMain.handle('auto-trade:stop', async () => autoTrade.stop());
  ipcMain.handle('auto-trade:continue', async () => autoTrade.continue());
  ipcMain.handle('auto-trade:reset', async () => autoTrade.reset());
  ipcMain.handle('auto-trade:reset-cards', async () => autoTrade.resetCardCounts());
  ipcMain.handle('auto-trade:respond-listing', async (_event, items) => autoTrade.respondListing(items));
  ipcMain.handle('auto-trade:list-players', async (_event, { accountId, items }) => autoTrade.listPlayers(accountId, items));


  ipcMain.handle('cards:add-role', async (_event, payload) => cards.addRole(payload?.name ?? payload, payload?.color));
  ipcMain.handle('cards:update-role', async (_event, { id, patch, name, color }) => cards.updateRole(id, patch || { name, color }));
  ipcMain.handle('cards:delete-role', async (_event, id) => cards.deleteRole(id));
  ipcMain.handle('cards:set-player-roles', async (_event, { playerKey, roleIds }) => cards.setPlayerRoles(playerKey, roleIds));
  ipcMain.handle('cards:set-tracked-teams', async (_event, teams) => cards.setTrackedTeams(teams));
  ipcMain.handle('cards:set-custom-team', async (_event, { playerKey, team }) => cards.setCustomTeam(playerKey, team));
  ipcMain.handle('cards:refresh', async () => cards.refresh());
  ipcMain.handle('cards:reset', async () => cards.resetData());

  ipcMain.handle('tasks:refresh', async () => { registry.refresh(); emitState(); return registry.list(); });
  ipcMain.handle('tasks:open-folder', async () => { ensureDir(taskDir()); return shell.openPath(taskDir()); });

  ipcMain.handle('schedules:add', async (_event, payload) => {
    const schedules = store.getSchedules();
    const builtin = BUILTIN_TASKS[payload.taskId];
    const task = builtin ? { id: payload.taskId, name: builtin.name } : registry.get(payload.taskId || defaultTaskId());
    if (!task) throw new Error('Task not found.');
    const item = {
      id: crypto.randomUUID(),
      name: String(payload.name || task.name).trim(),
      taskId: task.id,
      taskName: task.name,
      scheduleType: payload.scheduleType || 'autoplay',
      accountIds: Array.isArray(payload.accountIds) ? payload.accountIds : [],
      startAt: payload.startAt,
      preparationMinutes: Number(payload.preparationMinutes ?? store.getSettings().defaultPreparationMinutes ?? 6),
      executionMode: payload.executionMode || 'parallel',
      delaySeconds: Number(payload.delaySeconds || 0),
      visibleBrowser: Boolean(payload.visibleBrowser),
      enabled: true,
      prepared: false,
      started: false,
      completed: false,
      createdAt: new Date().toISOString()
    };
    if (!item.accountIds.length) throw new Error('Select at least one account.');
    if (!item.startAt) throw new Error('Start time is required.');
    schedules.push(item); store.saveSchedules(schedules); emitState(); return item;
  });
  ipcMain.handle('schedules:remove', async (_event, id) => { scheduler.cancel(id); store.saveSchedules(store.getSchedules().filter(s => s.id !== id)); emitState(); return true; });
  ipcMain.handle('schedules:toggle', async (_event, { id, enabled }) => {
    const schedules = store.getSchedules(); const item = schedules.find(s => s.id === id); if (!item) throw new Error('Schedule not found.');
    item.enabled = Boolean(enabled); store.saveSchedules(schedules); emitState(); return true;
  });

  ipcMain.handle('daily:refresh-tasks', async (_event, accountIds) => dailyRoutine.refreshTasks(Array.isArray(accountIds) ? accountIds : store.getAccounts().map(a => a.id)));
  ipcMain.handle('daily:claim-rewards', async (_event, accountIds) => dailyRoutine.claimRewards(Array.isArray(accountIds) ? accountIds : []));
  ipcMain.handle('settings:update', async (_event, patch) => {
    const settings = { ...store.getSettings(), ...patch };
    store.saveSettings(settings);
    if ('dailyRoutineAccountIds' in (patch || {})) for (const id of Object.keys(engine.states())) engine.recheckBeforeRun(id);
    emitState(); return settings;
  });
  ipcMain.handle('settings:open-data-folder', async () => shell.openPath(dataDir));
  ipcMain.handle('activity:clear', async () => { activity.clear(); return true; });
  ipcMain.handle('players:refresh', async () => players.refresh());
  ipcMain.handle('buy:buy', async (_event, { accountId, ticket }) => buy.buy(accountId, ticket));
  ipcMain.handle('buy:sell', async (_event, { entryId, price, currency }) => buy.sell(entryId, price, currency));
  ipcMain.handle('buy:remove-bought', async (_event, ids) => buy.removeBought(ids || []));
  ipcMain.handle('buy:add-watch', async (_event, players) => buy.addWatch(players || []));
  ipcMain.handle('buy:update-watch', async (_event, { id, patch }) => buy.updateWatch(id, patch || {}));
  ipcMain.handle('buy:remove-watch', async (_event, ids) => buy.removeWatch(ids || []));
  ipcMain.handle('buy:set-config', async (_event, patch) => buy.setConfig(patch || {}));
  ipcMain.handle('buy:start-auto', async (_event, options) => startAutoBuy(options || {}));
  ipcMain.handle('buy:stop-auto', async () => buy.stopAuto());
  ipcMain.handle('pvp:stop', async () => { pvp.stop(); return pvp.snapshot(); });
  ipcMain.handle('pvp:status', async (_event, accountIds) => pvp.status(Array.isArray(accountIds) ? accountIds : store.getAccounts().map(a => a.id)));
  ipcMain.handle('pvp:start', async (_event, accountIds) => startPvpManual(Array.isArray(accountIds) ? accountIds : []));
  ipcMain.handle('draft:watch', async () => draft.watch());
  ipcMain.handle('draft:unwatch', async () => draft.unwatch());
  ipcMain.handle('draft:join', async (_event, { accountId, slot }) => draft.join(accountId, slot));
  ipcMain.handle('draft:pick', async (_event, { accountId, playerId }) => draft.pick(accountId, playerId));
  ipcMain.handle('draft:list-players', async (_event, { accountId, items }) => draft.listPlayers(accountId, items));
  ipcMain.handle('draft:clear-drafted', async (_event, accountId) => draft.clearDrafted(accountId));
  ipcMain.handle('players:set-roles', async (_event, { playerId, roleIds }) => cards.setRolesById(playerId, roleIds));
}

app.whenReady().then(() => {
  initServices(); registerIpc(); createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', async (event) => {
  if (!engine || app.__closingTasks) return;
  event.preventDefault(); app.__closingTasks = true;
  try {
    try { store?.flush(); } catch {}
    if (pendingState) clearTimeout(pendingState);
    pendingState = null;
    // Each step on its own: one failing service must not leave the others
    // (or their Chromium processes) running.
    const steps = [
      () => scheduler?.stop(),
      () => trading?.stop(),
      () => autoTrade?.shutdown?.(),
      () => market?.shutdown(),
      () => players?.stop(),
      () => draft?.shutdown(),
      () => pvp?.stop(),
      () => buy?.shutdown(),
      () => tournament?.shutdown(),
      () => equipment?.shutdown(),
      () => dailyRewards?.stop(),
      () => engine.stopAll(),
      () => scout.shutdown(),
      () => browserService.closeAll()
    ];
    for (const step of steps) {
      try { await step(); } catch (error) { console.warn('[shutdown]', error?.message || error); }
    }
    try { globalShortcut.unregisterAll(); } catch {}
  } finally { try { store?.flush(); } catch {} app.quit(); }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
