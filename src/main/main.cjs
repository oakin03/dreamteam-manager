const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen } = require('electron');
const path = require('path');
const crypto = require('crypto');

const { AppStore, ensureDir } = require('./services/store.cjs');
const credentials = require('./services/credentials.cjs');
const { ActivityService } = require('./services/activity.cjs');
const { TaskRegistry } = require('./services/task-registry.cjs');
const { BrowserService } = require('./services/browser-service.cjs');
const { TaskEngine } = require('./services/task-engine.cjs');
const { SchedulerService } = require('./services/scheduler.cjs');
const { ScoutService } = require('./services/scout-service.cjs');
const { TradingHallService } = require('./services/trading-hall-service.cjs');
const { DailyRewardService } = require('./services/daily-reward-service.cjs');
const { AccountProfileService } = require('./services/account-profile-service.cjs');
const { CardsService } = require('./services/cards-service.cjs');
const { AutoTradeService } = require('./services/auto-trade-service.cjs');
const { MarketService } = require('./services/market-service.cjs');

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
let autoTradeOverlay;
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
    playerMarketAccount: {
      username: '',
      password: ''
    },
    tasks: registry.list(),
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
    autoTrade: autoTrade?.snapshot() || { runtime: null, lastRun: null },
    systemLocale,
    dataDir,
    taskDir: taskDir()
  };
  if (!incremental || tradeRowsChanged) state.trading.rows = trading.rowsSnapshot();
  if (!incremental || lastCardsKey !== cardKey) state.cards = cards.snapshot();
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


function destroyAutoTradeOverlay() {
  if (autoTradeOverlay && !autoTradeOverlay.isDestroyed()) autoTradeOverlay.destroy();
  autoTradeOverlay = null;
}
function ensureAutoTradeOverlay() {
  const rt = autoTrade?.snapshot()?.runtime;
  const shouldShow = Boolean(['running','paused','stopping'].includes(rt?.status));
  if (!shouldShow) { destroyAutoTradeOverlay(); return; }
  if (autoTradeOverlay && !autoTradeOverlay.isDestroyed()) {
    if (!autoTradeOverlay.webContents.isLoading()) autoTradeOverlay.webContents.send('auto-trade:overlay-state', rt.status);
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  autoTradeOverlay = new BrowserWindow({
    width: 356, height: 58, x: area.x + area.width - 370, y: area.y + 12,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#1a1f2a', webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  const html = `<!doctype html><html><body style="margin:0;background:#111827;font-family:Segoe UI;color:white;display:flex;align-items:center;justify-content:center;gap:8px;height:100vh"><button id="pause" style="width:166px;height:38px;background:#2456aa;color:#fff;border:1px solid #5190ef;border-radius:8px;font-weight:800;cursor:pointer">Duraklat (F8)</button><button id="stop" style="width:166px;height:38px;background:#b42318;color:#fff;border:1px solid #ef4444;border-radius:8px;font-weight:800;cursor:pointer">Durdur (F9)</button><script>const ipc=require('electron').ipcRenderer;const pause=document.getElementById('pause');ipc.on('auto-trade:overlay-state',(_event,status)=>{pause.textContent=status==='paused'?'Devam Et (F8)':'Duraklat (F8)';pause.disabled=status==='stopping';pause.style.opacity=pause.disabled?'.55':'1'});pause.onclick=()=>ipc.send('auto-trade:overlay-toggle-pause');document.getElementById('stop').onclick=()=>ipc.send('auto-trade:overlay-stop')</script></body></html>`;
  autoTradeOverlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  autoTradeOverlay.webContents.once('did-finish-load', () => {
    if (autoTradeOverlay && !autoTradeOverlay.isDestroyed()) autoTradeOverlay.webContents.send('auto-trade:overlay-state', autoTrade?.snapshot()?.runtime?.status);
  });
  autoTradeOverlay.on('closed', () => { autoTradeOverlay = null; });
}
function syncAutoTradeControls() {
  const rt = autoTrade?.snapshot()?.runtime;
  const enabled = Boolean(['running','paused'].includes(rt?.status));
  const overlayEnabled = Boolean(['running','paused','stopping'].includes(rt?.status));
  ensureAutoTradeOverlay();
  if (syncAutoTradeControls.lastEnabled === enabled && syncAutoTradeControls.lastOverlayEnabled === overlayEnabled) return;
  syncAutoTradeControls.lastEnabled = enabled;
  syncAutoTradeControls.lastOverlayEnabled = overlayEnabled;
  try { globalShortcut.unregister('F8'); globalShortcut.unregister('F9'); } catch {}
  if (enabled) {
    globalShortcut.register('F8', () => {
      const status = autoTrade?.snapshot()?.runtime?.status;
      if (status === 'paused') autoTrade.resume().catch(() => {});
      else if (status === 'running') autoTrade.pause().catch(() => {});
    });
    globalShortcut.register('F9', () => {
      if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('auto-trade:hotkey', 'stop'); }
    });
  }
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
  accountProfile = new AccountProfileService({ store, onChanged: emitState });
  registry = new TaskRegistry({ taskDir: taskDir(), bundledTaskDir: bundledTasksDir() });
  browserService = new BrowserService({
    dataDir,
    activity,
    stadiumObserver: (accountId, page) => accountProfile.captureStadium(accountId, page)
  });
  cards = new CardsService({ store, credentials, browserService, activity, accountProfile, onChanged: emitState });
  engine = new TaskEngine({ store, credentials, registry, browserService, activity, onChanged: emitState });
  scheduler = new SchedulerService({ store, engine, activity, onChanged: emitState });
  scout = new ScoutService({ store, credentials, browserService, activity, cardsService: cards, accountProfile, onChanged: emitState });
  trading = new TradingHallService({ store, credentials, browserService, activity, onChanged: emitState });
  dailyRewards = new DailyRewardService({ store, credentials, browserService, activity, engine, onChanged: emitState });
  autoTrade = new AutoTradeService({ store, credentials, browserService, scoutService: scout, cardsService: cards, accountProfile, activity, taskEngine: engine, onChanged: () => { emitState(); syncAutoTradeControls(); } });
  market = new MarketService({ store, credentials, browserService, accountProfile, activity, onChanged: emitState });
  scheduler.start();
  dailyRewards.start();
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
    emitState(); return sanitizeAccount(account);
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
    store.saveAccounts(accounts); emitState(); return sanitizeAccount(account);
  });

  ipcMain.handle('accounts:remove', async (_event, id) => {
    await market.remove(id);
    await engine.stopAccount(id, { reason: 'Account removed', quiet: true });
    const accounts = store.getAccounts();
    const account = accounts.find(a => a.id === id);
    store.saveAccounts(accounts.filter(a => a.id !== id));
    accountProfile.removeAccount(id);
    browserService.deleteProfile(id);
    const schedules = store.getSchedules().map(s => ({ ...s, accountIds: s.accountIds.filter(x => x !== id) })).filter(s => s.accountIds.length);
    store.saveSchedules(schedules);
    if (account) activity.add({ level: 'warning', accountId: id, accountName: account.name, message: 'Account removed.' });
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

  ipcMain.handle('market:open', async (_event, accountId) => market.open(accountId));
  ipcMain.handle('market:claim', async (_event, accountId) => market.claim(accountId));
  ipcMain.handle('market:close', async (_event, accountId) => market.close(accountId));

  ipcMain.handle('trade:save-account', async (_event, payload) => trading.saveAccount(payload));
  ipcMain.handle('trade:start', async (_event, options) => trading.start(options));
  ipcMain.handle('trade:stop', async () => trading.stop());
  ipcMain.handle('trade:clear', async () => { trading.clearRows(); return true; });

  ipcMain.handle('auto-trade:preflight', async (_event, options) => autoTrade.preflight(options));
  ipcMain.handle('auto-trade:start', async (_event, options) => autoTrade.start(options));
  ipcMain.handle('auto-trade:pause', async () => autoTrade.pause());
  ipcMain.handle('auto-trade:resume', async () => autoTrade.resume());
  ipcMain.handle('auto-trade:resume-side', async (_event, sideId) => autoTrade.resumeSide(sideId));
  ipcMain.handle('auto-trade:reconcile-pending', async () => autoTrade.reconcilePending());
  ipcMain.handle('auto-trade:stop', async () => autoTrade.stop());
  ipcMain.handle('auto-trade:reset', async () => autoTrade.reset());
  ipcMain.on('auto-trade:overlay-toggle-pause', () => {
    const status = autoTrade?.snapshot()?.runtime?.status;
    if (status === 'paused') autoTrade.resume().catch(() => {});
    else if (status === 'running') autoTrade.pause().catch(() => {});
  });
  ipcMain.on('auto-trade:overlay-stop', () => { autoTrade.stop().catch(() => {}); });

  ipcMain.handle('cards:add-role', async (_event, payload) => cards.addRole(payload?.name ?? payload, payload?.color));
  ipcMain.handle('cards:update-role', async (_event, { id, patch, name, color }) => cards.updateRole(id, patch || { name, color }));
  ipcMain.handle('cards:delete-role', async (_event, id) => cards.deleteRole(id));
  ipcMain.handle('cards:set-player-roles', async (_event, { playerKey, roleIds }) => cards.setPlayerRoles(playerKey, roleIds));
  ipcMain.handle('cards:set-tracked-teams', async (_event, teams) => cards.setTrackedTeams(teams));
  ipcMain.handle('cards:refresh', async () => cards.refresh());
  ipcMain.handle('cards:reset', async () => cards.resetData());

  ipcMain.handle('tasks:refresh', async () => { registry.refresh(); emitState(); return registry.list(); });
  ipcMain.handle('tasks:open-folder', async () => { ensureDir(taskDir()); return shell.openPath(taskDir()); });

  ipcMain.handle('schedules:add', async (_event, payload) => {
    const schedules = store.getSchedules(); const task = registry.get(payload.taskId || defaultTaskId()); if (!task) throw new Error('Task not found.');
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
  ipcMain.handle('schedules:remove', async (_event, id) => { store.saveSchedules(store.getSchedules().filter(s => s.id !== id)); emitState(); return true; });
  ipcMain.handle('schedules:toggle', async (_event, { id, enabled }) => {
    const schedules = store.getSchedules(); const item = schedules.find(s => s.id === id); if (!item) throw new Error('Schedule not found.');
    item.enabled = Boolean(enabled); store.saveSchedules(schedules); emitState(); return true;
  });

  ipcMain.handle('settings:update', async (_event, patch) => {
    const settings = { ...store.getSettings(), ...patch };
    store.saveSettings(settings); emitState(); return settings;
  });
  ipcMain.handle('settings:open-data-folder', async () => shell.openPath(dataDir));
  ipcMain.handle('activity:clear', async () => { activity.clear(); return true; });
  ipcMain.handle('player-market:get', async () => {
    return playerMarketService.snapshot();
  });

  ipcMain.handle('player-market:scan', async () => {
    return playerMarketService.start();
  });

  ipcMain.handle('player-market:stop', async () => {
    return playerMarketService.stop();
  });

  ipcMain.handle(
    'player-market:set-role',
    async (_event, playerKey, roleIds) => {
      return playerMarketService.setRole(
        playerKey,
        roleIds
      );
    }
  );
}

app.whenReady().then(() => {
  initServices(); registerIpc(); createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', async (event) => {
  if (!engine || app.__closingTasks) return;
  event.preventDefault(); app.__closingTasks = true;
  try {
    if (pendingState) clearTimeout(pendingState);
    pendingState = null;
    scheduler?.stop();
    await trading?.stop();
    await autoTrade?.shutdown();
    await market?.shutdown();
    await dailyRewards?.stop();
    await engine.stopAll();
    await scout.shutdown();
    await browserService.closeAll();
    try { globalShortcut.unregisterAll(); } catch {}
    destroyAutoTradeOverlay();
  } finally { app.quit(); }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
