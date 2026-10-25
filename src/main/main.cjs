const { dialog, app, BrowserWindow, ipcMain, shell, globalShortcut, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const crypto = require('crypto');

// Windows: own taskbar identity and DT icon (not Electron's), one window only — a second
// start (desktop shortcut, taskbar pin) brings the open window to the front.
// The installed app uses the build's appId; the development build has its own id so Windows
// never matches it with an old installer's shortcut (that showed the old name and icon).
const APP_ID = app.isPackaged ? 'com.dreamteam.automator' : 'com.dreamteam.manager.dev';
const ICON_PNG = path.join(__dirname, 'assets', 'icon.png');
const ICON_ICO = path.join(__dirname, 'assets', 'icon.ico');
const LAUNCHER = path.join(__dirname, '..', '..', 'scripts', 'DreamTeam Manager.vbs');
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

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
const { GameEvents } = require('./services/game-events.cjs');
const { SocialService } = require('./services/social-service.cjs');
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
const { GoUpService } = require('./services/goup-service.cjs');
const { QuizService } = require('./services/quiz-service.cjs');
const { CheerService } = require('./services/cheer-service.cjs');
const { ChatService } = require('./services/chat-service.cjs');
const { BuyService } = require('./services/buy-service.cjs');
const { TowerService } = require('./services/tower-service.cjs');
const { SynthesisService } = require('./services/synthesis-service.cjs');
const { AutoPlayStop } = require('./services/autoplay-stop.cjs');
const { GameHealth } = require('./services/game-health.cjs');
const { AccountHealth } = require('./services/account-health.cjs');
const { watchAlerts } = require('./services/watch-alerts.cjs');
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
let gameEvents;
let social;
let accountProfile;
let cards;
let autoTrade;
let market;
let gameSessions;
let players;
let draft;
let pvp;
let goup;
let quiz;
let cheer;
let chat;
let goupDone = null;
let quizDone = null;
let buy;
let tower;
let gameHealth;
let accountHealth;
let synthesis;
let towerDone = null;
let autoBuyDone = null;
let pvpDone = null;
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
    goup: goup?.snapshot() || { running: false, run: null, points: {}, event: null, lastReport: null },
    quiz: quiz?.snapshot() || { running: false, run: null, bankSize: 0, lastReport: null },
    cheer: cheer?.snapshot() || { busy: false, last: null },
    social: social?.snapshot() || { badges: {}, totals: { requests: 0, unread: 0, mail: 0 } },
    chat: chat?.snapshot() || { running: false, run: null, limits: { minIntervalSec: 11, maxText: 50 }, lastReport: null },
    tower: tower?.snapshot() || { running: false, run: null, lastReport: null },
    gameHealth: gameHealth?.snapshot() || { down: false },
    globalPause: globalPauseSnapshot(),
    accountHealth: accountHealth?.snapshot() || { rows: [] },
    synthesis: synthesis?.snapshot() || { running: false, run: null, summary: {} },
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
// A finished automation gets a Windows notification (Auto Trade has its own "done").
// Driven by the summary entry each service writes to Activity when it ends.
const DONE_NOTES = {
  'tw.summary': p => ({ tr: ['Kule bitti', `${p.count} hesap · ${p.wins} galibiyet`], en: ['Tower finished', `${p.count} account(s) · ${p.wins} win(s)`] }),
  'pvp.summary': p => ({ tr: ['PVP bitti', `${p.done}/${p.total} hesap tamamladı · ${p.played} maç`], en: ['PVP finished', `${p.done}/${p.total} account(s) done · ${p.played} match(es)`] }),
  'gu.summary': p => ({ tr: ['Go-up bitti', `${p.done}/${p.total} hesap tamamladı · ${p.played} maç`], en: ['Go-up finished', `${p.done}/${p.total} account(s) done · ${p.played} match(es)`] }),
  'qz.summary': p => ({ tr: ['Daily Quiz bitti', `${p.done}/${p.total} hesap tamamladı`], en: ['Daily Quiz finished', `${p.done}/${p.total} account(s) done`] }),
  'sy.done': p => ({ tr: ['Sentez bitti', `${p.ok} başarılı · ${p.fail} başarısız`], en: ['Synthesis finished', `${p.ok} success · ${p.fail} failed`] }),
  'mk.relistDone': p => ({ tr: ['Tekrar listeleme bitti', `${p.listed} listelendi · ${(p.failed || 0) + (p.removedNotListed || 0)} sorunlu`], en: ['Relist finished', `${p.listed} listed · ${(p.failed || 0) + (p.removedNotListed || 0)} with problems`] }),
  'so.newMessage': p => ({ tr: ['Yeni mesaj', `${p.from} · ${p.count} okunmamış`], en: ['New message', `${p.from} · ${p.count} unread`] }),
  'so.newRequest': p => ({ tr: ['Yeni arkadaşlık isteği', `${p.from}`], en: ['New friend request', `${p.from}`] }),
  'cs.summary': p => ({ tr: ['Chat bitti', `${p.sent} mesaj gönderildi · ${p.failed} başarısız`], en: ['Chat finished', `${p.sent} message(s) sent · ${p.failed} failed`] })
};
function notifyDone(entry) {
  const make = DONE_NOTES[entry?.code];
  if (!make || !Notification.isSupported()) return;
  try {
    const tr = (store?.getSettings()?.language || 'tr') !== 'en';
    const [title, body] = make(entry.params || {})[tr ? 'tr' : 'en'];
    const n = new Notification({ title, body });
    n.on('click', () => showMainWindow());
    n.show();
  } catch {}
}

function autoTradeAttention(kind, text) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isFocused()) mainWindow.flashFrame(true);
    }
    if (Notification.isSupported()) {
      const tr = (store?.getSettings()?.language || 'tr') !== 'en';
      const titles = { error: tr ? 'Auto Trade durdu' : 'Auto Trade stopped', listing: tr ? 'Auto Trade: pazara listeleme' : 'Auto Trade: market listing', draftTurn: tr ? 'Draft: sıra sende' : 'Draft: your turn', done: tr ? 'Auto Trade bitti' : 'Auto Trade finished', conflict: tr ? 'Auto Trade: hesaplar kullanımda' : 'Auto Trade: accounts in use', autoPlayStop: tr ? 'Auto Play durduruldu (günlük saat)' : 'Auto Play stopped (daily time)', watchAlert: tr ? 'İzleme listesi: değer değişimi' : 'Watch list: value change', buyNoFunds: tr ? 'Auto Buy durdu' : 'Auto Buy stopped', buyCannot: tr ? 'Auto Buy: oyuncu alınamadı' : 'Auto Buy: could not buy', buyError: tr ? 'Auto Buy durdu' : 'Auto Buy stopped' };
      const bodies = { listing: tr ? `${text} kadrosu doldu · hangi oyuncuların listeleneceğini seç` : `${text}'s roster is full · choose players to list`, done: tr ? 'Tüm hesaplar tamamlandı' : 'All accounts are done', draftTurn: tr ? `${text} seçim yapacak · 30 saniye` : `${text} picks now · 30 seconds`, autoPlayStop: tr ? `${text} hesapta Auto Play durduruldu · turnuva öncesi` : `Auto Play stopped on ${text} account(s) · before the tournament`, watchAlert: text, buyNoFunds: tr ? `Hesapların ${text} miktarı yetersiz` : `The accounts do not have enough ${text}`, buyCannot: tr ? `${text} · hiçbir hesap alamadı (kadroda var / bakiye yetersiz) · tarama sürüyor` : `${text} · no account could buy it (already owned / not enough funds) · still scanning` };
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

// A scheduled task stops every service working on its accounts — Auto Trade, Auto Buy,
// Tower, PVP — and starts them again afterwards (Auto Play is handled by the scheduler).
// Each stopped service first finishes, which also gives back the Auto Play it had
// paused, so the scheduler then stops that Auto Play too and restores it in order.
// skipAutoBuy (a buy / listing of Auto Buy): Auto Buy itself goes on, and services that never
// sign in (PVP, Go-up, Quiz: cookie only, not kicked by a sign-in) are left alone.
async function pauseServicesFor(accountIds, taskName, { prefix = 'sc', logTask = 'Schedule', skipAutoBuy = false } = {}) {
  const ids = new Set(accountIds);
  const overlap = list => (list || []).some(id => ids.has(id));
  const resume = [];
  const note = (level, code, service, extra = {}) => activity.add({ level, accountId: null, accountName: '', taskName: logTask, code, params: { service, task: taskName, ...extra }, message: `${service} · ${code}` });
  const at = autoTrade.snapshot().run;
  if (at && ['running', 'paused', 'awaitingListing', 'stopping'].includes(at.status) && overlap(at.config?.accountIds)) {
    await autoTrade.stop();
    resume.push(['Auto Trade', () => autoTrade.continue()]);
  }
  const ab = buy.snapshot();
  if (!skipAutoBuy && ab.auto?.status === 'running' && overlap(ab.config?.accountOrder)) {
    const options = { accountIds: ab.config.accountOrder, intervalSec: ab.config.intervalSec };
    buy.stopAuto();
    await (autoBuyDone || buy.done)?.catch(() => {});
    resume.push(['Auto Buy', () => startAutoBuy(options)]);
  }
  const tw = tower.snapshot();
  if (tw.running) {
    const active = Object.values(tw.run?.accounts || {}).filter(r => !['done', 'finished', 'stopped', 'error', 'salaryCap'].includes(r.status)).map(r => r.accountId);
    if (overlap(active)) {
      tower.stop();
      await towerDone?.catch(() => {});
      resume.push(['Kule', () => startTower(active)]);
    }
  }
  const pv = pvp.snapshot();
  if (!skipAutoBuy && pv.running) {
    const active = Object.values(pv.run?.accounts || {}).filter(r => !['done', 'inactive', 'error', 'stopped'].includes(r.status)).map(r => r.accountId);
    if (overlap(active)) {
      pvp.stop();
      await pvpDone?.catch(() => {});
      resume.push(['PVP', () => startPvpManual(active)]);
    }
  }
  const gu = goup.snapshot();
  if (!skipAutoBuy && gu.running) {
    const active = Object.values(gu.run?.accounts || {}).filter(r => !['done', 'noAttempts', 'inactive', 'error', 'stopped'].includes(r.status)).map(r => r.accountId);
    if (overlap(active)) {
      const options = { mode: gu.run?.mode, gapSec: gu.run?.gapSec };
      goup.stop();
      await goupDone?.catch(() => {});
      resume.push(['Go-up', () => startGoUpManual(active, options)]);
    }
  }
  if (!skipAutoBuy && quiz.snapshot().running && overlap(Object.keys(quiz.snapshot().run?.accounts || {}))) {
    quiz.stop();
    await quizDone?.catch(() => {});
  }
  for (const [service] of resume) note('info', `${prefix}.servicePaused`, service);
  return async () => {
    for (const [service, start] of resume) {
      try { await start(); note('success', `${prefix}.serviceResumed`, service); }
      catch (error) { note('error', `${prefix}.serviceResumeFailed`, service, { error: error.message }); }
    }
  };
}

// "Stop all automations" switch (turned on by hand, e.g. before the 15:00 tournament):
// stops Auto Play on every account and every other service (Auto Trade, Auto Buy, Tower,
// PVP, Market jobs, Synthesis) and remembers what ran; "Resume" starts the same again.
let globalPause = null; // { at, resume: async () => {}, autoPlay: [...] }
// ---- System tray and start with Windows (settings.closeToTray, settings.openAtLogin) ----
// Closing the window hides it to the tray when closeToTray is on; automations keep
// running. "Quit" in the tray menu really quits. Services are never started on their own.
let tray = null;
function trayMenu() {
  const tr = (store?.getSettings()?.language || 'tr') !== 'en';
  const paused = Boolean(globalPause);
  return Menu.buildFromTemplate([
    { label: tr ? 'DreamTeam Manager\'ı göster' : 'Show DreamTeam Manager', click: showMainWindow },
    { type: 'separator' },
    paused
      ? { label: tr ? 'Otomasyonları devam ettir' : 'Resume automations', click: () => resumeAll().then(updateTray).catch(() => {}) }
      : { label: tr ? 'Tüm otomasyonları durdur' : 'Stop all automations', click: () => pauseAll().then(updateTray).catch(() => {}) },
    { type: 'separator' },
    { label: tr ? 'Çıkış' : 'Quit', click: () => { app.__reallyQuit = true; app.quit(); } }
  ]);
}
function updateTray() { try { tray?.setContextMenu(trayMenu()); } catch {} }
// Brings the window back: from the tray (hidden), minimized or behind other windows.
// A second start of the app lands here too (single-instance lock), never a second copy.
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { if (app.isReady() && engine) createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  // Windows may refuse to bring a background window forward: a short always-on-top does it.
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.focus();
  app.focus({ steal: true });
  setTimeout(() => { try { if (!mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false); } catch {} }, 300);
}
function setupTray() {
  if (tray) return;
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')).resize({ width: 16, height: 16 }));
    tray.setToolTip('DreamTeam Manager');
    tray.on('click', showMainWindow);
    updateTray();
  } catch (error) { console.warn('[tray]', error?.message || error); }
}
function applyLoginItem(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
  } catch (error) { console.warn('[login item]', error?.message || error); }
}

async function pauseAll() {
  if (globalPause) return globalPauseSnapshot();
  const ids = store.getAccounts().map(a => a.id);
  const resumeServices = await pauseServicesFor(ids, 'stop all', { prefix: 'gp', logTask: 'Automations' });
  const autoPlay = [];
  for (const id of ids) {
    const worker = engine.workers.get(id);
    const prepared = engine.prepared.get(id);
    const active = worker && ['running', 'preparing', 'starting'].includes(worker.status) ? worker : prepared;
    if (!active) continue;
    autoPlay.push({ accountId: id, taskId: active.taskId, taskName: active.taskName, visibleBrowser: Boolean(active.visibleBrowser), config: active.config || null });
    try { await engine.stopAccount(id, { reason: 'Stop all automations', quiet: true }); } catch {}
  }
  try { await market?.stop(); } catch {}
  try { synthesis?.stop(); } catch {}
  try { chat?.stop(); } catch {}
  globalPause = { at: new Date().toISOString(), autoPlay, resumeServices };
  activity.add({ level: 'warning', accountId: null, accountName: '', taskName: 'Automations', code: 'gp.paused', params: { autoPlay: autoPlay.length }, message: `All automations stopped · Auto Play on ${autoPlay.length} account(s)` });
  emitState();
  updateTray();
  return globalPauseSnapshot();
}
async function resumeAll() {
  const p = globalPause;
  if (!p) return globalPauseSnapshot();
  globalPause = null;
  let started = 0;
  for (const item of p.autoPlay) {
    try { await engine.startAccount(item.accountId, item.taskId, { visibleBrowser: item.visibleBrowser, forceFresh: false, config: item.config }); started++; } catch {}
  }
  try { await p.resumeServices?.(); } catch {}
  activity.add({ level: 'success', accountId: null, accountName: '', taskName: 'Automations', code: 'gp.resumed', params: { autoPlay: started }, message: `Automations started again · Auto Play on ${started} account(s)` });
  emitState();
  updateTray();
  return globalPauseSnapshot();
}
function globalPauseSnapshot() { return globalPause ? { active: true, at: globalPause.at, autoPlay: globalPause.autoPlay.length } : { active: false }; }

// Go-up and Daily Quiz connect the accounts to the game: Auto Play on them is stopped
// first and started again when they are over (rule for every automation).
async function startGoUpManual(accountIds, options = {}) {
  if (!accountIds.length) throw new Error('Select at least one account.');
  if (goup.snapshot().running) throw new Error('Go-up is already running.');
  const resume = await pauseTasksFor(accountIds, 'Go-up', 'gu');
  goupDone = goup.runAndWait(accountIds, { source: 'manual', mode: options.mode, gapSec: options.gapSec }).catch(() => {}).finally(resume);
  return goup.snapshot();
}
async function startQuizManual(accountIds) {
  if (!accountIds.length) throw new Error('Select at least one account.');
  if (quiz.snapshot().running) throw new Error('Daily Quiz is already running.');
  const resume = await pauseTasksFor(accountIds, 'Daily Quiz', 'qz');
  quizDone = quiz.runAndWait(accountIds, { source: 'manual' }).catch(() => {}).finally(resume);
  return quiz.snapshot();
}

// Daily lines (Auto Play page): a one-off schedule of a built-in task for the accounts
// last chosen on its page (all accounts when none). The scheduler stops what runs on
// them, runs the task and starts the stopped tasks again.
async function addDailySchedule(taskId, name, settingsKey) {
  const all = store.getAccounts().map(a => a.id);
  const chosen = (store.getSettings()[settingsKey] || []).filter(id => all.includes(id));
  const schedules = store.getSchedules();
  if (schedules.some(s => s.taskId === taskId && s.daily && !s.completed)) throw new Error(`${name} is already running.`);
  const item = {
    id: crypto.randomUUID(), name, taskId, taskName: BUILTIN_TASKS[taskId].name,
    scheduleType: 'task', accountIds: chosen.length ? chosen : all, startAt: new Date().toISOString(), preparationMinutes: 0,
    executionMode: 'parallel', delaySeconds: 0, visibleBrowser: false, enabled: true, prepared: false, started: false, completed: false,
    daily: true, createdAt: new Date().toISOString()
  };
  if (!item.accountIds.length) throw new Error('No accounts.');
  schedules.push(item); store.saveSchedules(schedules); emitState();
  return item;
}
const addDailyTournamentSchedule = () => addDailySchedule('tournament-register', 'Turnuva kaydı (günlük)', 'tournamentAccountIds');
const addDailyPvpSchedule = () => addDailySchedule('pvp-arena', 'PVP Arena (günlük)', 'pvpAccountIds');

async function startPvpManual(accountIds) {
  if (!accountIds.length) throw new Error('Select at least one account.');
  if (pvp.snapshot().running) throw new Error('PVP is already running.');
  const resume = await pauseTasksFor(accountIds, 'PVP', 'pvp');
  pvpDone = pvp.runAndWait(accountIds, { source: 'manual' }).catch(() => {}).finally(resume);
  return pvp.snapshot();
}

async function startTower(accountIds) {
  if (!accountIds.length) throw new Error('Select at least one account.');
  if (tower.snapshot().running) throw new Error('Tower is already running.');
  const resume = await pauseTasksFor(accountIds, 'Tower', 'tw');
  towerDone = tower.runAndWait(accountIds).catch(() => {}).finally(resume);
  return tower.snapshot();
}

// Auto Buy scans without signing in, so it runs next to the other automations. Only
// for a buy / listing it signs in on one account: pauseAccountForBuy stops what runs
// there (Auto Play and the other automations, never Auto Buy itself) and the returned
// function starts them again once the account is closed.
async function startAutoBuy(options) {
  if (buy.snapshot().auto.status === 'running') throw new Error('Auto Buy is already running.');
  const snap = await buy.startAuto(options);
  autoBuyDone = buy.done;
  return snap;
}
async function pauseAccountForBuy(accountId, taskName) {
  const resumeServices = await pauseServicesFor([accountId], taskName, { prefix: 'ab', logTask: taskName, skipAutoBuy: true });
  const resumeTasks = await pauseTasksFor([accountId], taskName, 'ab');
  return async () => { await resumeTasks(); await resumeServices(); };
}

function autoTradeConflicts(accountIds) {
  const ids = new Set(accountIds);
  const name = id => store.getAccounts().find(a => a.id === id)?.name || id;
  const out = [];
  for (const [id, r] of Object.entries(engine.states())) {
    if (ids.has(id) && ['running', 'preparing', 'starting'].includes(r.status)) out.push({ kind: 'autoplay', accountId: id, name: name(id) });
  }
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
    icon: ICON_PNG,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  // Development build: pinning the taskbar button relaunches through the launcher with the DT icon.
  if (process.platform === 'win32' && !app.isPackaged) {
    try { mainWindow.setAppDetails({ appId: APP_ID, appIconPath: ICON_ICO, appIconIndex: 0, relaunchCommand: `wscript.exe "${LAUNCHER}"`, relaunchDisplayName: 'DreamTeam Manager' }); } catch {}
  }
  setupTray();
  mainWindow.on('close', event => {
    if (app.__reallyQuit || app.__closingTasks || !store?.getSettings()?.closeToTray) return;
    event.preventDefault();
    mainWindow.hide();
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
  activity = new ActivityService(store, emitState, { logDir: path.join(dataDir, 'logs') });
  const addActivity = activity.add.bind(activity);
  activity.add = entry => { const r = addActivity(entry); notifyDone(entry); return r; };
  gameHealth = new GameHealth({ activity, onChanged: emitState });
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
    gameHealth,
    store, credentials, registry, browserService, activity, onChanged: emitState,
    beforeRun: ({ account, signal }) => dailyRoutine.runIfDue(account, { signal }),
    beforeRunNextAt: accountId => dailyRoutine.nextDueAt(accountId)
  });
  scheduler = new SchedulerService({ store, engine, activity, onChanged: emitState, pauseServices: (ids, name) => pauseServicesFor(ids, name) });
  scout = new ScoutService({ store, activity, sessions: gameSessions, cardsService: cards, accountProfile, gameHealth, onChanged: emitState });
  trading = new TradingHallService({ store, credentials, browserService, activity, onChanged: emitState });
  dailyRewards = new DailyRewardService({ store, activity, engine, sessions: gameSessions, onChanged: emitState });
  autoTrade = new AutoTradeEngine({ gameHealth, store, credentials, activity, sessions: gameSessions, accountProfile, onChanged: emitState, onAttention: autoTradeAttention, onScout: (id, reply) => scout.showSocketScout?.(id, reply), onCycleEnd: () => cards.refresh() });
  market = new MarketService({ store, activity, accountProfile, sessions: gameSessions, onChanged: emitState });
  const alertedDays = new Map(); // playerId -> day already reported
  players = new PlayersService({
    store, activity, onChanged: emitState,
    onRefreshed: (list, previousById, { day }) => {
      const hits = watchAlerts(buy?.snapshot().watch, list, previousById).filter(h => alertedDays.get(h.playerId) !== day);
      for (const h of hits) {
        alertedDays.set(h.playerId, day);
        activity.add({ level: 'warning', accountId: null, accountName: '', taskName: 'Auto Buy', code: 'wl.alert', params: { name: h.name, value: h.value, base: h.base, pct: h.pct, kind: h.becameBase ? 'base' : 'drop' }, message: `Watched ${h.name}: ${h.becameBase ? 'fell to its Base' : `value ${h.pct}%`} · ${h.value} (Base ${h.base})` });
      }
      if (hits.length) autoTradeAttention('watchAlert', hits.map(h => `${h.name} ${h.becameBase ? 'Base' : h.pct + '%'}`).join(', '));
    }
  });
  synthesis = new SynthesisService({ store, activity, sessions: gameSessions, onChanged: emitState, onDone: () => cards.refresh() });
  tower = new TowerService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  buy = new BuyService({ store, activity, gameHealth, sessions: gameSessions, accountProfile, onChanged: emitState, onAttention: autoTradeAttention, onScan: (ids, currency, tickets) => trading.mergeTickets(ids, currency, tickets), pauseAccount: pauseAccountForBuy });
  pvp = new PvpService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  goup = new GoUpService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  quiz = new QuizService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  cheer = new CheerService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  chat = new ChatService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  draft = new DraftService({ store, activity, gameHealth, sessions: gameSessions, accountProfile, onChanged: emitState, onAttention: autoTradeAttention });
  equipment = new EquipmentService({ store, activity, sessions: gameSessions, onChanged: emitState });
  tournament = new TournamentService({ store, credentials, browserService, accountProfile, activity, sessions: gameSessions, onChanged: emitState });
  scheduler.registerBuiltin('tournament-register', (accountIds, { signal }) => tournament.runAndWait(accountIds, { signal }));
  scheduler.registerBuiltin('market-claim', async (accountIds, { signal }) => {
    const onAbort = () => market.stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    try { await market.claim(accountIds, { concurrency: store.getSettings()?.marketScanParallel }); } finally { signal?.removeEventListener('abort', onAbort); }
  });
  scheduler.registerBuiltin('pvp-arena', (accountIds, { signal }) => pvp.runAndWait(accountIds, { signal, source: 'schedule' }), { gate: (accountIds, { signal }) => pvp.waitForArena(signal) });
  scheduler.registerBuiltin('goup', (accountIds, { signal }) => goup.runAndWait(accountIds, { signal, source: 'schedule', mode: store.getSettings()?.goupMode, gapSec: store.getSettings()?.goupGapSec }));
  scheduler.registerBuiltin('market-relist', (accountIds, { signal }) => market.relistRecent(accountIds, { signal }));
  scheduler.start();
  new AutoPlayStop({ store, engine, activity, onChanged: emitState, onAttention: autoTradeAttention, scheduleTournament: addDailyTournamentSchedule, schedulePvp: addDailyPvpSchedule }).start();
  accountHealth = new AccountHealth({ store, engine, gameHealth, onChanged: emitState });
  accountHealth.start();
  players.start();
  dailyRewards.start();
  gameEvents = new GameEvents({ store, activity, onSalaryUpdate: async () => { await players.refresh({ automatic: true, pushed: true }); await accountHealth.refresh(); } });
  gameEvents.start();
  social = new SocialService({ store, activity, sessions: gameSessions, onChanged: emitState });
  social.start();
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

  ipcMain.handle('market:scan', async (_event, accountIds, options) => market.scan(accountIds, options || {}));
  ipcMain.handle('market:claim', async (_event, accountIds, options) => market.claim(accountIds, options || {}));
  ipcMain.handle('market:load-relist', async (_event, accountIds) => market.loadRelist(accountIds));
  ipcMain.handle('market:relist', async (_event, items, options) => market.relistPlayers(items, options || {}));
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
    if ('openAtLogin' in (patch || {})) applyLoginItem(patch.openAtLogin);
    if ('language' in (patch || {})) updateTray();
    emitState(); return settings;
  });
  ipcMain.handle('activity:days', async () => activity.days());
  ipcMain.handle('summary:day', async (_event, day) => { const { summarize } = require('./services/daily-summary.cjs'); const d = day || activity.days()[0]; return { day: d || null, days: activity.days(), summary: summarize(d ? activity.readDay(d) : []) }; });
  ipcMain.handle('activity:day', async (_event, day) => activity.readDay(day));
  ipcMain.handle('activity:search', async (_event, text) => activity.search(text));
  ipcMain.handle('activity:open-folder', async () => shell.openPath(path.join(dataDir, 'logs')));
  // Error report: warnings and errors of the last days plus a short environment summary
  // (no passwords or cookies), saved where the user chooses.
  ipcMain.handle('activity:export', async () => {
    const os = require('os');
    const days = activity.days().slice(0, 3);
    const entries = days.flatMap(d => activity.readDay(d)).filter(e => e.level === 'error' || e.level === 'warning').slice(0, 1000);
    const lines = [
      'DreamTeam Manager · error report',
      `Created: ${new Date().toISOString()}`,
      `App: ${app.getVersion()} · Electron ${process.versions.electron} · ${os.type()} ${os.release()}`,
      `Accounts: ${store.getAccounts().length} · days: ${days.join(', ')}`,
      `Running: Auto Play ${Object.values(engine.states()).filter(w => w.status === 'running').length} · Auto Buy ${buy?.snapshot().auto?.status || '-'} · Auto Trade ${autoTrade?.snapshot().run?.status || '-'} · game reachable ${!gameHealth?.isDown()}`,
      '',
      ...entries.map(e => `${e.at} [${e.level}] ${e.taskName || ''} ${e.accountName || ''} ${e.code || ''} · ${e.message}`)
    ];
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: `dreamteam-hata-raporu-${new Date().toISOString().slice(0, 10)}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] });
    if (result.canceled || !result.filePath) return null;
    require('fs').writeFileSync(result.filePath, lines.join('\r\n'), 'utf8');
    return result.filePath;
  });
  ipcMain.handle('health:refresh', async () => accountHealth.refresh());
  ipcMain.handle('app:pause-all', async () => pauseAll());
  ipcMain.handle('app:resume-all', async () => resumeAll());
  ipcMain.handle('app:factory-reset', async (_event, options) => { setTimeout(() => factoryReset(options || {}).catch(error => console.warn('[factory reset]', error)), 300); return true; });
  ipcMain.handle('settings:open-data-folder', async () => shell.openPath(dataDir));
  ipcMain.handle('activity:clear', async () => { activity.clear(); return true; });
  ipcMain.handle('players:refresh', async () => players.refresh());
  ipcMain.handle('buy:buy', async (_event, { accountId, ticket }) => buy.buy(accountId, ticket));
  ipcMain.handle('buy:cheapest', async (_event, query) => buy.cheapest(query || {}));
  ipcMain.handle('buy:sell', async (_event, { entryId, price, currency }) => buy.sell(entryId, price, currency));
  ipcMain.handle('buy:remove-bought', async (_event, ids) => buy.removeBought(ids || []));
  ipcMain.handle('buy:add-watch', async (_event, players) => buy.addWatch(players || []));
  ipcMain.handle('buy:update-watch', async (_event, { id, patch }) => buy.updateWatch(id, patch || {}));
  ipcMain.handle('buy:remove-watch', async (_event, ids) => buy.removeWatch(ids || []));
  ipcMain.handle('buy:set-config', async (_event, patch) => buy.setConfig(patch || {}));
  ipcMain.handle('buy:start-auto', async (_event, options) => startAutoBuy(options || {}));
  ipcMain.handle('buy:stop-auto', async () => buy.stopAuto());
  ipcMain.handle('synthesis:start', async (_event, options) => synthesis.start(options || {}));
  ipcMain.handle('synthesis:stop', async () => synthesis.stop());
  ipcMain.handle('tower:start', async (_event, accountIds) => startTower(Array.isArray(accountIds) ? accountIds : []));
  ipcMain.handle('tower:stop', async (_event, accountIds) => tower.stop(Array.isArray(accountIds) && accountIds.length ? accountIds : null));
  ipcMain.handle('pvp:stop', async () => { pvp.stop(); return pvp.snapshot(); });
  ipcMain.handle('pvp:status', async (_event, accountIds) => pvp.status(Array.isArray(accountIds) ? accountIds : store.getAccounts().map(a => a.id)));
  ipcMain.handle('pvp:start', async (_event, accountIds) => startPvpManual(Array.isArray(accountIds) ? accountIds : []));
  ipcMain.handle('goup:start', async (_event, { accountIds, mode, gapSec } = {}) => startGoUpManual(Array.isArray(accountIds) ? accountIds : [], { mode, gapSec }));
  ipcMain.handle('goup:stop', async () => { goup.stop(); return goup.snapshot(); });
  ipcMain.handle('goup:status', async (_event, accountIds) => goup.status(Array.isArray(accountIds) ? accountIds : null));
  ipcMain.handle('quiz:start', async (_event, accountIds) => startQuizManual(Array.isArray(accountIds) ? accountIds : []));
  ipcMain.handle('quiz:stop', async () => { quiz.stop(); return quiz.snapshot(); });
  ipcMain.handle('quiz:answer', async (_event, { accountId, letter } = {}) => quiz.answer(accountId, letter));
  ipcMain.handle('social:view', async (_event, accountId) => social.view(accountId));
  ipcMain.handle('social:conversation', async (_event, { accountId, friendId } = {}) => social.conversation(accountId, friendId));
  ipcMain.handle('social:send', async (_event, { accountId, friendId, text } = {}) => social.send(accountId, friendId, text));
  ipcMain.handle('social:act', async (_event, { accountId, action, targetId } = {}) => social.act(accountId, action, targetId));
  ipcMain.handle('social:claimMail', async (_event, { accountId, mailId } = {}) => social.claimMail(accountId, mailId || null));
  ipcMain.handle('social:poll', async () => { await social.poll(); return social.snapshot(); });
  ipcMain.handle('cheer:send', async (_event, { fromIds, targetId } = {}) => cheer.cheer(Array.isArray(fromIds) ? fromIds : [], targetId));
  ipcMain.handle('chat:start', async (_event, config) => { chat.runAndWait(config || {}).catch(() => {}); await new Promise(r => setTimeout(r, 50)); if (!chat.snapshot().running) throw new Error(chat.snapshot().lastReport?.lastError || 'Chat could not start.'); return chat.snapshot(); });
  ipcMain.handle('chat:stop', async () => { chat.stop(); return chat.snapshot(); });
  ipcMain.handle('draft:watch', async () => draft.watch());
  ipcMain.handle('draft:unwatch', async () => draft.unwatch());
  ipcMain.handle('draft:join', async (_event, { accountId, slot }) => draft.join(accountId, slot));
  ipcMain.handle('draft:pick', async (_event, { accountId, playerId }) => draft.pick(accountId, playerId));
  ipcMain.handle('draft:list-players', async (_event, { accountId, items }) => draft.listPlayers(accountId, items));
  ipcMain.handle('draft:clear-drafted', async (_event, accountId) => draft.clearDrafted(accountId));
  ipcMain.handle('players:set-roles', async (_event, { playerId, roleIds }) => cards.setRolesById(playerId, roleIds));
}

app.on('second-instance', () => showMainWindow());

app.whenReady().then(() => {
  if (!singleInstance) return;
  initServices(); registerIpc(); createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Stops every service (and their Chromium processes). Used when quitting and before a
// factory reset.
async function shutdownServices() {
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
    () => goup?.stop(),
    () => quiz?.stop(),
    () => chat?.stop(),
    () => cheer?.stop(),
    () => tower?.stop(),
    () => gameHealth?.shutdown(),
    () => accountHealth?.stop(),
    () => activity?.flushArchive(),
    () => synthesis?.stop(),
    () => buy?.shutdown(),
    () => tournament?.shutdown(),
    () => equipment?.shutdown(),
    () => dailyRewards?.stop(),
    () => gameEvents?.stop(),
    () => social?.stop(),
    () => engine.stopAll(),
    () => scout.shutdown(),
    () => browserService.closeAll()
  ];
  for (const step of steps) {
    try { await step(); } catch (error) { console.warn('[shutdown]', error?.message || error); }
  }
}

// Factory reset: everything back to a fresh install — settings, saved data, logs,
// browser logins. Saved accounts/passwords are kept when asked (default). The app
// restarts afterwards.
const KEEP_ON_RESET = ['accounts.json', 'trade-account.json', 'player-market-account.json'];
async function factoryReset({ keepPasswords = true } = {}) {
  app.__closingTasks = true;
  if (pendingState) clearTimeout(pendingState);
  pendingState = null;
  await shutdownServices();
  store.freeze();
  // Learned Daily Quiz answers are game knowledge, not personal data: always kept.
  const keep = new Set(['mcp-profiles', 'quiz-bank.json', ...(keepPasswords ? KEEP_ON_RESET : [])]);
  for (const name of require('fs').readdirSync(dataDir)) {
    if (keep.has(name)) continue;
    try { require('fs').rmSync(path.join(dataDir, name), { recursive: true, force: true, maxRetries: 3 }); } catch (error) { console.warn('[factory reset]', name, error?.message || error); }
  }
  app.relaunch();
  app.exit(0);
}

app.on('before-quit', async (event) => {
  if (!engine || app.__closingTasks) return;
  event.preventDefault(); app.__closingTasks = true;
  try {
    try { store?.flush(); } catch {}
    if (pendingState) clearTimeout(pendingState);
    pendingState = null;
    await shutdownServices();
    try { globalShortcut.unregisterAll(); } catch {}
  } finally { try { store?.flush(); } catch {} app.quit(); }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
