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
const { SchedulerService, BUILTIN_TASKS } = require('./services/scheduler.cjs'); // @strip(basic)
const { ScoutService } = require('./services/scout-service.cjs');
const { TradingHallService } = require('./services/trading-hall-service.cjs');
const { DailyRewardService } = require('./services/daily-reward-service.cjs');
const { GameEvents } = require('./services/game-events.cjs');
const { SocialService } = require('./services/social-service.cjs');
const { AccountProfileService } = require('./services/account-profile-service.cjs');
const { CardsService } = require('./services/cards-service.cjs');
const { AutoTradeEngine } = require('./services/auto-trade-engine.cjs');
const { FriendNetwork } = require('./services/friend-network.cjs');
const { MarketService } = require('./services/market-service.cjs');
const { GameSessions } = require('./services/game-sessions.cjs');
// The old browser Player Market (player-market-*.cjs) is kept on disk but no longer used.
const { PlayersService } = require('./services/players-service.cjs');
const { RostersService } = require('./services/rosters-service.cjs');
const { BagService } = require('./services/bag-service.cjs');
const { LaborService } = require('./services/labor-service.cjs');
const { InjuryGuard, setGuard: setInjuryGuard } = require('./services/injury-guard.cjs');
const { ScoutHunter } = require('./services/scout-hunter.cjs'); // @strip(basic)
const { MatchControl } = require('./services/match-control.cjs'); // @strip(basic)
const { TournamentLive } = require('./services/tournament-live.cjs'); // @strip(basic)
const { DraftService } = require('./services/draft-service.cjs');
const { syncMcpConfig } = require('./services/mcp-sync.cjs');
const { TournamentService } = require('./services/tournament-service.cjs');
const { TournamentLevelService } = require('./services/tournament-level-service.cjs'); // @strip(basic)
const { DailyRoutineService } = require('./services/daily-routine-service.cjs');
const { PvpService } = require('./services/pvp-service.cjs');
const { GoUpService } = require('./services/goup-service.cjs');
const { DailyBossService, EliteAscentService, ProfessionalService } = require('./services/proving-service.cjs');
const { OfficeService, MagicTeamService } = require('./services/office-service.cjs');
const { Big3Auto } = require('./services/big3-auto.cjs');
const { SkillsService } = require('./services/skills-service.cjs');
const { TkTransferService } = require('./services/tk-transfer-service.cjs');
const { ApkTransferService } = require('./services/apk-transfer-service.cjs');
const { ValuePredictService } = require('./services/value-predict-service.cjs');
const { InjuryService } = require('./services/injury-service.cjs');
const { ActivateService } = require('./services/activate-service.cjs');
const { PropService } = require('./services/prop-service.cjs');
const { QuizService } = require('./services/quiz-service.cjs');
const { CheerService } = require('./services/cheer-service.cjs');
const { DailySlotService } = require('./services/daily-slot-service.cjs');
const { ChatService } = require('./services/chat-service.cjs');
const { BuyService } = require('./services/buy-service.cjs');
const { TowerService } = require('./services/tower-service.cjs');
const { SynthesisService } = require('./services/synthesis-service.cjs');
const { AutoPlayStop } = require('./services/autoplay-stop.cjs'); // @strip(basic)
const { GameHealth } = require('./services/game-health.cjs');
const { AccountHealth } = require('./services/account-health.cjs');
const { watchAlerts } = require('./services/watch-alerts.cjs'); // @strip(basic)
const { EquipmentService } = require('./services/equipment-service.cjs');
const { SignupService } = require('./services/signup-service.cjs'); // @strip(basic)
const { DataCleanup } = require('./services/data-cleanup.cjs');
const PROFILE_REFRESH_MS = 3 * 60 * 1000;

let mainWindow;
let store;
let activity;
let registry;
let browserService;
let engine;
let scheduler; // @strip(basic)
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
let rosters;
let bag;
let labor;
let injuryGuard;
let hunter;
let matchControl; // @strip(basic)
let tournamentLive; // @strip(basic)
// Auto Play start batches running in the main process (accounts:start-many)
const startBatches = new Set();
const apBatchState = () => { try { emitState(); } catch {} };
let lastRostersRevision = -1;
let draft;
let pvp;
let goup;
let quiz;
let cheer;
let dailySlot;
let chat;
let goupDone = null;
let dailyBoss;
let activate;
let props;
let eliteAscent;
let office;
let big3;
let magicTeam;
let magicDone = null;
let skills;
let bossDone = null;
let ascentDone = null;
let professional;
let tkTransfer;
let apkTransfer;
let apkDone = null;
let valuePredict;
let injuries;
let lastInjuryRevision = -1;
let tkDone = null;
let proDone = null;
let quizDone = null;
let buy;
let tower;
let gameHealth;
let accountHealth;
let dataCleanup;
let synthesis;
let towerDone = null;
let autoBuyDone = null; // @strip(basic)
let pvpDone = null;
let lastVpRevision = -1;
let lastBuyRevision = -1;
let lastDraftRevision = -1;
let lastPlayersKey = null;
let tournament;
let tournamentLevel; // @strip(basic)
let dailyRoutine;
let equipment;
let signup; // @strip(basic)
let lastEquipmentRevision = -1;
let lastAutoTradeRevision = -1;
let dataDir;
let systemLocale = 'en-US';
let pendingState = null;
// The page gets a new state only after it has taken the last one (app:state-ack), and at
// most every STATE_GAP_MS: with many accounts (PVP: a log line every few ms) states piled
// up in the page faster than it could draw them, until it ran out of memory and went white.
const STATE_GAP_MS = 250;
const STATE_ACK_WAIT_MS = 5000;
let stateInFlightAt = 0;   // when the last unanswered state was sent (0: none waiting)
let stateDirty = false;
let lastStateSentAt = 0;
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
    builtinTasks: Object.entries(BUILTIN_TASKS).map(([id, task]) => ({ id, name: task.name })), // @strip(basic)
    schedules: store.getSchedules(), // @strip(basic)
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
    tournamentLevel: tournamentLevel?.snapshot() || null, // @strip(basic)
    bag: bag?.snapshot() || null,
    labor: labor?.snapshot() || null,
    injuryGuard: injuryGuard?.snapshot() || null,
    injuryViewer: injuryViewerState(),
    hunter: hunter?.snapshot() || null, // @strip(basic)
    rotation: matchControl?.snapshot() || null, // @strip(basic)
    tournamentLive: tournamentLive?.snapshot() || null, // @strip(basic)
    apBatch: startBatches.size ? [...startBatches].reduce((o, r) => ({ running: true, done: o.done + r.done, total: o.total + r.total, started: o.started + r.started }), { running: true, done: 0, total: 0, started: 0 }) : null,
    dailyRoutine: dailyRoutine?.snapshot() || { selected: [], accounts: {} },
    pvp: pvp?.snapshot() || { running: false, run: null, lastReport: null },
    dailyBoss: dailyBoss?.snapshot() || { running: false, run: null, info: {}, bosses: [] },
    eliteAscent: eliteAscent?.snapshot() || { running: false, run: null, info: {} },
    office: office?.snapshot() || { info: {}, busy: [], auto: { coach: [], big3: {} } },
    big3: big3?.snapshot() || null,
    magicTeam: magicTeam?.snapshot() || { running: false, run: null, info: {} },
    skills: skills?.snapshot() || { busy: [] },
    professional: professional?.snapshot() || { running: false, run: null, info: {} },
    tkTransfer: tkTransfer?.snapshot() || { running: false, run: null, config: null, lastReport: null },
    apkTransfer: apkTransfer?.snapshot() || { running: false, run: null, config: null, lastReport: null },
    goup: goup?.snapshot() || { running: false, run: null, points: {}, event: null, lastReport: null },
    quiz: quiz?.snapshot() || { running: false, run: null, bankSize: 0, lastReport: null },
    cheer: cheer?.snapshot() || { busy: false, last: null },
    dailySlot: dailySlot?.snapshot() || { running: false, rows: {}, lastRun: null },
    signup: signup?.snapshot() || { running: false, rows: [] }, // @strip(basic)
    chatFeed: gameEvents?.chatFeed() || [],
    social: social?.snapshot() || { badges: {}, totals: { requests: 0, unread: 0, mail: 0 } },
    chat: chat?.snapshot() || { running: false, run: null, limits: { minIntervalSec: 11, maxText: 50 }, lastReport: null },
    tower: tower?.snapshot() || { running: false, run: null, lastReport: null },
    gameHealth: gameHealth?.snapshot() || { down: false },
    dataCleanup: dataCleanup?.snapshot() || null,
    globalPause: globalPauseSnapshot(),
    accountHealth: accountHealth?.snapshot() || { rows: [] },
    synthesis: synthesis?.snapshot() || { running: false, run: null, summary: {} },
    props: props?.snapshot() || { runs: {}, bags: {}, busy: [] },
    activate: activate?.snapshot() || { running: false, run: null, levels: [5, 4, 3, 2] },
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
  if (rosters && (!incremental || lastRostersRevision !== rosters.revision)) { state.rosters = rosters.snapshot(); lastRostersRevision = rosters.revision; }
  if (injuries && (!incremental || lastInjuryRevision !== injuries.revision)) { state.injuries = injuries.snapshot(); lastInjuryRevision = injuries.revision; }
  if (valuePredict && (!incremental || lastVpRevision !== valuePredict.revision)) { state.valuePredict = valuePredict.snapshot(); lastVpRevision = valuePredict.revision; }
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
  stateDirty = true;
  if (pendingState || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return;
  // Services can report several changes in the same event-loop turn. Send the
  // latest complete state once, avoiding repeated disk work and IPC cloning.
  const wait = Math.max(50, STATE_GAP_MS - (Date.now() - lastStateSentAt));
  pendingState = setTimeout(sendState, wait);
}

function sendState() {
  pendingState = null;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return;
  // the page is still on the last one: the ack sends the next (a page that never answers,
  // e.g. while reloading, gets one again after STATE_ACK_WAIT_MS)
  if (stateInFlightAt && Date.now() - stateInFlightAt < STATE_ACK_WAIT_MS) return;
  stateDirty = false;
  stateInFlightAt = lastStateSentAt = Date.now();
  mainWindow.webContents.send('app:state', onlyChanged(snapshot({ incremental: true })));
}

// Only the parts of the state that changed since the last send (user 2026-11-24: the mouse wheel
// stuck, moved a little or not at all). Every send carried ~1.5 MB — settings with the old reports
// (~490 KB), the daily routine of every account, the Tower / APK / TK reports… — several times a
// second, and the page spent ~100 ms on each, so wheel turns were lost. The page merges a state
// into the one it has (a part that is not sent stays as it was). A bootstrap (full state, page
// (re)load) starts the comparison again.
const lastSentJson = new Map();
function onlyChanged(state) {
  for (const key of Object.keys(state)) {
    const json = JSON.stringify(state[key] ?? null);
    if (lastSentJson.get(key) === json) delete state[key];
    else lastSentJson.set(key, json);
  }
  return state;
}

function onStateAck() {
  stateInFlightAt = 0;
  if (stateDirty) emitState();
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
  'bo.summary': p => ({ tr: ['Daily Boss bitti', `${p.done}/${p.total} hesap · ${p.played} maç · ${p.won} galibiyet`], en: ['Daily Boss finished', `${p.done}/${p.total} account(s) · ${p.played} match(es) · ${p.won} won`] }),
  'tk.doneTarget': p => ({ tr: ['TK aktarımı bitti', `${p.tk} TK aktarıldı · ${p.apk} APK harcandı`], en: ['TK transfer finished', `${p.tk} TK transferred · ${p.apk} APK spent`] }),
  'tk.apkOut': p => ({ tr: ['APK bitti · TK aktarımı durdu', `${p.tk} TK aktarıldı · ${p.apk} APK harcandı`], en: ['APK ran out · TK transfer stopped', `${p.tk} TK transferred · ${p.apk} APK spent`] }),
  'tk.noListings': p => ({ tr: ['TK aktarımı durdu · uygun ilan kalmadı', `${p.tk} TK aktarıldı · ${p.apk} APK harcandı`], en: ['TK transfer stopped · no usable listing left', `${p.tk} TK transferred · ${p.apk} APK spent`] }),
  'tk.summaryError': p => ({ tr: ['TK aktarımı hatayla durdu', `${p.tk} TK aktarıldı · ${p.apk} APK harcandı`], en: ['TK transfer stopped with an error', `${p.tk} TK transferred · ${p.apk} APK spent`] }),
  'pf.summary': p => ({ tr: ['Professional bitti', `${p.done}/${p.total} hesap · ${p.played} maç · ${p.won} galibiyet`], en: ['Professional finished', `${p.done}/${p.total} account(s) · ${p.played} match(es) · ${p.won} won`] }),
  'ea.summary': p => ({ tr: ['Elite Ascent bitti', `${p.done}/${p.total} hesap · ${p.played} maç · ${p.won} galibiyet`], en: ['Elite Ascent finished', `${p.done}/${p.total} account(s) · ${p.played} match(es) · ${p.won} won`] }),
  'ac.summary': p => ({ tr: ['Kart aktivasyonu bitti', `${p.count} aktif edildi · ${p.failed} başarısız`], en: ['Card activation finished', `${p.count} activated · ${p.failed} failed`] }),
  'cs.summary': p => ({ tr: ['Chat bitti', `${p.sent} mesaj gönderildi · ${p.failed} başarısız`], en: ['Chat finished', `${p.sent} message(s) sent · ${p.failed} failed`] })
};
function notifyDone(entry) {
  const make = DONE_NOTES[entry?.code];
  if (!make || !Notification.isSupported()) return;
  try {
    const tr = !['en', 'fil'].includes(store?.getSettings()?.language || 'tr');
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
      const tr = !['en', 'fil'].includes(store?.getSettings()?.language || 'tr');
      const titles = { error: tr ? 'Auto Trade durdu' : 'Auto Trade stopped', listing: tr ? 'Auto Trade: pazara listeleme' : 'Auto Trade: market listing', roleAsk: tr ? 'Auto Trade: seçimini bekliyor' : 'Auto Trade: waiting for your choice', draftTurn: tr ? 'Draft: sıra sende' : 'Draft: your turn', done: tr ? 'Auto Trade bitti' : 'Auto Trade finished', conflict: tr ? 'Auto Trade: hesaplar kullanımda' : 'Auto Trade: accounts in use', autoPlayStop: tr ? 'Auto Play durduruldu (günlük saat)' : 'Auto Play stopped (daily time)', watchAlert: tr ? 'İzleme listesi: değer değişimi' : 'Watch list: value change', buyNoFunds: tr ? 'Auto Buy durdu' : 'Auto Buy stopped', buyCannot: tr ? 'Auto Buy: oyuncu alınamadı' : 'Auto Buy: could not buy', buyError: tr ? 'Auto Buy durdu' : 'Auto Buy stopped' };
      const bodies = { roleAsk: tr ? `${text} · rolü iki yönlü: karta mı çevrilsin, satılabilir mi kalsın?` : `${text} · roles both ways: card or Satılabilir?`, listing: tr ? `${text} kadrosu doldu · hangi oyuncuların listeleneceğini seç` : `${text}'s roster is full · choose players to list`, done: tr ? 'Tüm hesaplar tamamlandı' : 'All accounts are done', draftTurn: tr ? `${text} seçim yapacak · 30 saniye` : `${text} picks now · 30 seconds`, autoPlayStop: tr ? `${text} hesapta Auto Play durduruldu · turnuva öncesi` : `Auto Play stopped on ${text} account(s) · before the tournament`, watchAlert: text, buyNoFunds: tr ? `Hesapların ${text} miktarı yetersiz` : `The accounts do not have enough ${text}`, buyCannot: tr ? `${text} · hiçbir hesap alamadı (kadroda var / bakiye yetersiz) · tarama sürüyor` : `${text} · no account could buy it (already owned / not enough funds) · still scanning` };
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
async function pauseTasksFor(accountIds, taskName, prefix, { keepSocket = false } = {}) {
  const resume = [];
  const pausedAt = Date.now(); // a user Stop after this wins over the resume below
  const name = id => store.getAccounts().find(a => a.id === id)?.name || '';
  for (const id of accountIds) {
    const worker = engine.workers.get(id);
    const prepared = engine.prepared.get(id);
    const active = worker && ['running', 'preparing', 'starting'].includes(worker.status) ? worker : prepared;
    if (!active) continue;
    // Auto Trade with "keep Auto Play": Quick Play over its own socket does not clash with Auto
    // Trade's connection, only the browser fallback (one game page per account) does
    if (keepSocket && worker === active && worker.status === 'running' && worker.mode !== 'browser') continue;
    resume.push({ accountId: id, taskId: active.taskId, taskName: active.taskName, visibleBrowser: Boolean(active.visibleBrowser), config: active.config || null });
  }
  // all of them at once (user 2026-11-12)
  await engine.stopMany(resume.map(r => r.accountId), { reason: `Stopped for ${taskName}`, quiet: true });
  for (const r of resume) activity.add({ level: 'info', accountId: r.accountId, accountName: name(r.accountId), taskName, code: `${prefix}.pausedTask`, params: { task: r.taskName || '' }, message: `${r.taskName} stopped for ${taskName}` });
  return async () => {
    const since = pausedAt;
    for (const r of resume) {
      try {
        if (engine.stoppedByUserSince(r.accountId, since)) continue;
        await engine.startAccount(r.accountId, r.taskId, { visibleBrowser: r.visibleBrowser, forceFresh: false, config: r.config, since });
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
  if (at && ['running', 'paused', 'awaitingListing', 'awaitingRole', 'stopping'].includes(at.status) && overlap(at.config?.accountIds)) {
    // a quick buy / listing / fire by hand on an account Auto Trade is not on right now: Auto
    // Trade only waits for that account (user 2026-11-06,
    // the whole run stopped for every listing / fire by hand)
    if (prefix === 'ab' && autoTrade.holdAccounts && ![...ids].some(id => autoTrade.usesAccount(id))) {
      const release = autoTrade.holdAccounts([...ids]);
      resume.push(['Auto Trade', async () => release()]);
    } else {
      // paused stays paused afterwards; a run the user stops meanwhile stays stopped (user 2026-11-08)
      const wasPaused = at.status === 'paused';
      await autoTrade.stop({ hard: false });
      resume.push(['Auto Trade', () => autoTrade.resumeAfterTask({ paused: wasPaused })]);
    }
  }
  // @strip-begin(basic)
  const ab = buy.snapshot();
  if (!skipAutoBuy && ab.auto?.status === 'running' && overlap(ab.config?.accountOrder)) {
    const options = { accountIds: ab.config.accountOrder, intervalSec: ab.config.intervalSec };
    buy.stopAuto();
    await (autoBuyDone || buy.done)?.catch(() => {});
    resume.push(['Auto Buy', () => startAutoBuy(options)]);
  }
  // @strip-end
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
  for (const [svc, label, getDone] of [[dailyBoss, 'Daily Boss', () => bossDone], [eliteAscent, 'Elite Ascent', () => ascentDone], [professional, 'Professional', () => proDone]]) {
    const snap = svc.snapshot();
    if (skipAutoBuy || !snap.running) continue;
    const active = Object.values(snap.run?.accounts || {}).filter(r => !['done', 'noAttempts', 'locked', 'error', 'stopped', 'eliminated', 'champion', 'needPick', 'hofDone'].includes(r.status)).map(r => r.accountId);
    if (!overlap(active)) continue;
    const plan = Object.fromEntries(active.map(id => [id, snap.run.accounts[id].target]));
    svc.stop();
    await getDone()?.catch(() => {});
    resume.push([label, () => startProvingManual(svc, plan, label, { 'Daily Boss': 'bo', 'Elite Ascent': 'ea', Professional: 'pf' }[label], p => { if (label === 'Daily Boss') bossDone = p; else if (label === 'Elite Ascent') ascentDone = p; else proDone = p; })]);
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
  const tr = !['en', 'fil'].includes(store?.getSettings()?.language || 'tr');
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
  }
  for (const run of startBatches) run.cancelled = true;
  await engine.stopMany(autoPlay.map(a => a.accountId), { reason: 'Stop all automations', quiet: true });
  try { await market?.stop(); } catch {}
  try { synthesis?.stop(); } catch {}
  try { chat?.stop(); } catch {}
  // Scout Hunter too; its saved "running" stays so Resume (or a restart after Resume) brings it back
  const hunterWasRunning = Boolean(hunter?.snapshot()?.running);
  if (hunterWasRunning) { try { hunter.stop({ remember: false }); } catch {} } // @strip(basic)
  globalPause = { at: new Date().toISOString(), autoPlay, resumeServices, hunter: hunterWasRunning };
  saveGlobalPause();
  activity.add({ level: 'warning', accountId: null, accountName: '', taskName: 'Automations', code: 'gp.paused', params: { autoPlay: autoPlay.length }, message: `All automations stopped · Auto Play on ${autoPlay.length} account(s)` });
  emitState();
  updateTray();
  return globalPauseSnapshot();
}
async function resumeAll() {
  const p = globalPause;
  if (!p) return globalPauseSnapshot();
  globalPause = null;
  saveGlobalPause();
  let started = 0;
  const since = Date.parse(p.at) || Date.now();
  for (const item of p.autoPlay) {
    try { const r = await engine.startAccount(item.accountId, item.taskId, { visibleBrowser: item.visibleBrowser, forceFresh: false, config: item.config, since }); if (!r?.skipped) started++; } catch {}
  }
  try { await p.resumeServices?.(); } catch {}
  if (p.hunter) { try { hunter?.resumeIfRunning(); } catch {} } // @strip(basic)
  activity.add({ level: 'success', accountId: null, accountName: '', taskName: 'Automations', code: 'gp.resumed', params: { autoPlay: started }, message: `Automations started again · Auto Play on ${started} account(s)` });
  emitState();
  updateTray();
  return globalPauseSnapshot();
}
// "Stop all automations" survives an app restart (user 2026-11-18: stopped, closed the app, it ran
// again on the next start). Only plain data is saved; services stopped through pauseServicesFor
// cannot be rebuilt after a restart, Auto Play and Scout Hunter can.
function saveGlobalPause() {
  try {
    const s = store.getSettings() || {};
    const gp = globalPause ? { at: globalPause.at, autoPlay: globalPause.autoPlay, hunter: Boolean(globalPause.hunter) } : null;
    store.saveSettings({ ...s, globalPause: gp });
  } catch {}
}
function restoreGlobalPause() {
  const gp = store.getSettings()?.globalPause;
  if (!gp?.at) return false;
  globalPause = { at: gp.at, autoPlay: Array.isArray(gp.autoPlay) ? gp.autoPlay : [], resumeServices: null, hunter: Boolean(gp.hunter) };
  return true;
}
function globalPauseSnapshot() { return globalPause ?{ active: true, at: globalPause.at, autoPlay: globalPause.autoPlay.length } : { active: false }; }

// Daily Boss and Elite Ascent play matches: Auto Play on those accounts is stopped
// first and started again when they are over. plan = { accountId: bossId | true }.
async function startProvingManual(service, plan, label, prefix, setDone) {
  const ids = Object.keys(plan || {});
  if (!ids.length) throw new Error('Select at least one account.');
  if (service.snapshot().running) throw new Error(`${label} is already running.`);
  const resume = await pauseTasksFor(ids, label, prefix);
  setDone(service.runAndWait(plan, { source: 'manual' }).catch(() => {}).finally(resume));
  return service.snapshot();
}

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

// @strip-begin(basic)
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
// @strip-end

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

// @strip-begin(basic)
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
// @strip-end
// Çanta → Anestezi "Sakat hesapları sırayla aç" (user 2026-11-19): the injured accounts open in a
// visible browser, a few at a time (signed in with the saved password); the account's other
// services step aside while its window is open (so the app's own connection does not sign the
// window out), and when the user closes a window the next account opens.
const injuryViewer = { queue: [], open: new Map(), max: 3 };
function injuryViewerState() {
  const name = id => store.getAccounts().find(a => a.id === id)?.name || id;
  return { max: injuryViewer.max, queue: injuryViewer.queue.map(id => ({ id, name: name(id) })), open: [...injuryViewer.open.entries()].map(([id, v]) => ({ id, name: name(id), status: v.status, error: v.error || null })) };
}
function injuryViewLog(level, accountId, code, params, message) {
  activity.add({ level, accountId, accountName: store.getAccounts().find(a => a.id === accountId)?.name || '', taskName: 'Anestezi', code: `inj.${code}`, params, message });
}
async function injuryViewStart(accountIds, max) {
  injuryViewer.max = Math.min(6, Math.max(1, Number(max) || 3));
  const have = new Set([...injuryViewer.queue, ...injuryViewer.open.keys()]);
  for (const id of accountIds) if (!have.has(id) && store.getAccounts().some(a => a.id === id)) { injuryViewer.queue.push(id); have.add(id); }
  injuryViewNext();
  emitState();
  return injuryViewerState();
}
async function injuryViewStop() {
  injuryViewer.queue = [];
  for (const [, v] of injuryViewer.open) await v.close?.().catch(() => {});
  emitState();
  return injuryViewerState();
}
function injuryViewNext() {
  while (injuryViewer.open.size < injuryViewer.max && injuryViewer.queue.length) injuryViewOne(injuryViewer.queue.shift());
}
async function injuryViewOne(accountId) {
  const account = store.getAccounts().find(a => a.id === accountId);
  if (!account) return;
  const owner = `injury-view:${accountId}`;
  const entry = { status: 'opening' };
  injuryViewer.open.set(accountId, entry);
  emitState();
  let resume = null;
  let session = null;
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    injuryViewer.open.delete(accountId);
    await browserService.release(accountId, owner, { closeWhenUnused: true }).catch(() => {});
    await resume?.().catch(() => {});
    // the player may be healed / swapped by hand meanwhile
    injuryGuard?.scan([accountId]).catch(() => {});
    injuryViewNext();
    emitState();
  };
  entry.close = async () => { await session?.close?.().catch(() => {}); await finish(); };
  try {
    resume = await pauseAccountForBuy(accountId, 'Anestezi').catch(() => null);
    const creds = { login: account.login, password: credentials.decryptSecret(account.passwordEncrypted) };
    const r = await browserService.authenticate(account, creds, { visible: true, keepOpen: true, owner });
    session = r.session;
    entry.status = 'open';
    injuryViewLog('info', accountId, 'viewOpened', {}, 'Opened in the browser · close the window to open the next one');
    const onGone = () => { finish(); };
    session.page.on('close', () => { session.close?.().catch(() => {}); onGone(); });
    session.context.on('close', onGone);
    if (session.closed) onGone();
    emitState();
  } catch (error) {
    entry.status = 'error';
    entry.error = error.message;
    injuryViewLog('warning', accountId, 'viewFailed', { error: error.message }, `Could not be opened in the browser: ${error.message}`);
    await finish();
  }
}

async function pauseAccountForBuy(accountId, taskName) {
  const resumeServices = await pauseServicesFor([accountId], taskName, { prefix: 'ab', logTask: taskName, skipAutoBuy: true });
  const resumeTasks = await pauseTasksFor([accountId], taskName, 'ab');
  return async () => { await resumeTasks(); await resumeServices(); };
}

// A Harcayıcı opened by Auto Trade (it is not one of the run's accounts): its Auto Play and
// other services step aside while the connection is open.
async function pauseAccountForTrade(accountId, taskName) {
  const resumeServices = await pauseServicesFor([accountId], taskName, { prefix: 'atp', logTask: taskName });
  const resumeTasks = await pauseTasksFor([accountId], taskName, 'atp', { keepSocket: Boolean(autoTrade?.keepsAutoPlay?.()) });
  return async () => { await resumeTasks(); await resumeServices(); };
}

// keepAutoPlay (Auto Trade's option): only Auto Play in the browser fallback has to stop.
const autoPlayClashes = (id, r, keepAutoPlay) => ['running', 'preparing', 'starting'].includes(r.status) && !(keepAutoPlay && r.status === 'running' && engine.workers.get(id)?.mode !== 'browser');
function autoTradeConflicts(accountIds, { keepAutoPlay = false } = {}) {
  const ids = new Set(accountIds);
  const name = id => store.getAccounts().find(a => a.id === id)?.name || id;
  const out = [];
  for (const [id, r] of Object.entries(engine.states())) {
    if (ids.has(id) && autoPlayClashes(id, r, keepAutoPlay)) out.push({ kind: 'autoplay', accountId: id, name: name(id) });
  }
  if (equipment?.accountId && ids.has(equipment.accountId)) out.push({ kind: 'equipment', accountId: equipment.accountId, name: name(equipment.accountId) });
  if (market?.snapshot()?.busy) out.push({ kind: 'market' });
  if (tournament?.snapshot()?.runtime?.status === 'running') out.push({ kind: 'tournament' });
  for (const sc of store.getSchedules()) { // @strip(basic)
    if (sc.enabled && !sc.completed && (sc.accountIds || []).some(id => ids.has(id))) out.push({ kind: 'schedule', name: sc.name || sc.taskName, startAt: sc.startAt, accounts: sc.accountIds.filter(id => ids.has(id)).map(name) }); // @strip(basic)
  } // @strip(basic)
  return out;
}

async function stopAutoTradeConflicts(accountIds, { keepAutoPlay = false } = {}) {
  const ids = new Set(accountIds);
  await engine.stopMany(Object.entries(engine.states()).filter(([id, r]) => ids.has(id) && autoPlayClashes(id, r, keepAutoPlay)).map(([id]) => id), { reason: 'Stopped for Auto Trade' });
  if (equipment?.accountId && ids.has(equipment.accountId)) await equipment.close();
  if (market?.snapshot()?.busy) await market.stop();
  if (tournament?.snapshot()?.runtime?.status === 'running') await tournament.stop();
}

// Auto Play over the salary cap while Auto Trade (with "keep Auto Play") works on that account
// (user 2026-11-13): instead of stopping, Quick Play waits for Auto Trade to make room (it lists,
// trades, fires or makes cards there: capRelief) or 2 minutes, at most 10 times.
const CAP_WAIT_MS = 2 * 60 * 1000;
const CAP_WAIT_TRIES = 10;
const capWaiters = new Map(); // accountId -> Set(resolve)
function capRelief(accountId) {
  const set = capWaiters.get(accountId);
  if (!set) return;
  capWaiters.delete(accountId);
  for (const done of set) done('relief');
}
function autoPlayCapWait({ accountId, attempt, signal }) {
  if (!autoTrade?.keepsAutoPlay?.() || !autoTrade.worksWith(accountId) || attempt > CAP_WAIT_TRIES) return Promise.resolve(false);
  return new Promise(resolve => {
    let timer = null;
    const done = why => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); capWaiters.get(accountId)?.delete(done); resolve(why !== 'abort'); };
    const onAbort = () => done('abort');
    timer = setTimeout(() => done('timeout'), CAP_WAIT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (!capWaiters.has(accountId)) capWaiters.set(accountId, new Set());
    capWaiters.get(accountId).add(done);
  });
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
  // also after a reload (the page crashed and came back): a full new start
  mainWindow.webContents.on('did-finish-load', () => { stateInFlightAt = 0; emitState(); });
  // The page process died (out of memory, GPU): it used to stay white while the tasks went
  // on. It is logged and the page loaded again; the tasks keep running.
  let reloads = [];
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    stateInFlightAt = 0;
    if (details?.reason === 'clean-exit' || app.__reallyQuit || app.__closingTasks) return;
    activity?.add({ level: 'warning', taskName: 'App', code: 'app.rendererGone', params: { reason: details?.reason || '?', code: details?.exitCode ?? '' }, message: `The window crashed (${details?.reason || '?'}) and was reloaded; the tasks went on.` });
    reloads = reloads.filter(at => Date.now() - at < 60000);
    if (reloads.length >= 3) return; // crashing again and again: left as it is
    reloads.push(Date.now());
    setTimeout(() => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload(); } catch {} }, 1000);
  });
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
  if (cards.clearedCustomTeams) activity.add({ level: 'info', accountId: null, accountName: '', taskName: 'Cards', code: 'cd.customCleared', params: { count: cards.clearedCustomTeams }, message: `User-given teams were removed · ${cards.clearedCustomTeams} player(s) back on the game's own team · roles kept` });
  dailyRoutine = new DailyRoutineService({ store, activity, sessions: gameSessions, onChanged: emitState });
  engine = new TaskEngine({
    gameHealth,
    capWait: autoPlayCapWait,
    store, credentials, registry, browserService, activity, onChanged: emitState,
    beforeRun: ({ account, signal }) => dailyRoutine.runIfDue(account, { signal }),
    beforeRunNextAt: accountId => dailyRoutine.nextDueAt(accountId)
  });
  // Group Match helpers: accounts whose Auto Play runs fill a short party / form the opponent party
  dailyRoutine.setHelpers({ idle: () => engine.idleRunning(), hold: (id, fn) => engine.hold(id, fn) });
  scheduler = new SchedulerService({ store, engine, activity, onChanged: emitState, pauseServices: (ids, name) => pauseServicesFor(ids, name) }); // @strip(basic)
  scout = new ScoutService({ store, activity, sessions: gameSessions, cardsService: cards, accountProfile, gameHealth, onChanged: emitState });
  trading = new TradingHallService({ store, credentials, browserService, activity, onChanged: emitState });
  dailyRewards = new DailyRewardService({ store, activity, engine, sessions: gameSessions, gameHealth, isPaused: () => Boolean(globalPause), onChanged: emitState });
  const friendNet = new FriendNetwork({ store, sessions: gameSessions, activity, perSide: () => autoTrade?.lastConfig?.spendersPerSide, onChanged: () => { if (autoTrade) autoTrade.revision++; emitState(); } });
  autoTrade = new AutoTradeEngine({ onRoster: id => capRelief(id), cardBusy: () => Boolean(synthesis?.snapshot().running || activate?.snapshot().running), friendNet, pauseAccount: pauseAccountForTrade, onSpenderListed: e => buy?.recordListed?.(e), gameHealth, store, credentials, activity, sessions: gameSessions, accountProfile, onChanged: emitState, onAttention: autoTradeAttention, onScout: (id, reply) => scout.showSocketScout?.(id, reply), onCycleEnd: () => cards.refresh() });
  market = new MarketService({ store, activity, accountProfile, sessions: gameSessions, onChanged: emitState });
  const alertedDays = new Map(); // playerId -> day already reported // @strip(basic)
  rosters = new RostersService({ store, activity, onChanged: emitState });
  bag = new BagService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState, onCardPlayers: (id, rows) => draft?.addRows(id, rows) });
  injuryGuard = new InjuryGuard({ store, activity, sessions: gameSessions, onChanged: emitState });
  setInjuryGuard(injuryGuard);
  labor = new LaborService({ store, activity, sessions: gameSessions, onChanged: emitState, onLaborPlayers: (id, rows) => draft?.addRows(id, rows) });
  players = new PlayersService({
    store, activity, onChanged: emitState,
    onRefreshed: (list, previousById, { day }) => {
      // @strip-begin(basic)
      const hits = watchAlerts(buy?.snapshot().watch, list, previousById).filter(h => alertedDays.get(h.playerId) !== day);
      for (const h of hits) {
        alertedDays.set(h.playerId, day);
        activity.add({ level: 'warning', accountId: null, accountName: '', taskName: 'Auto Buy', code: 'wl.alert', params: { name: h.name, value: h.value, base: h.base, pct: h.pct, kind: h.becameBase ? 'base' : 'drop' }, message: `Watched ${h.name}: ${h.becameBase ? 'fell to its Base' : `value ${h.pct}%`} · ${h.value} (Base ${h.base})` });
      }
      if (hits.length) autoTradeAttention('watchAlert', hits.map(h => `${h.name} ${h.becameBase ? 'Base' : h.pct + '%'}`).join(', '));
      // @strip-end
      // a new game list: compare it with the value prediction made before
      valuePredict?.refresh({ automatic: true }).catch(() => {});
    }
  });
  synthesis = new SynthesisService({ store, activity, sessions: gameSessions, cards, onChanged: emitState, onDone: () => cards.refresh() });
  props = new PropService({ store, activity, sessions: gameSessions, onChanged: emitState });
  activate = new ActivateService({ store, activity, sessions: gameSessions, cards, onChanged: emitState });
  tower = new TowerService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  buy = new BuyService({ store, activity, gameHealth, sessions: gameSessions, accountProfile, onChanged: emitState, onAttention: autoTradeAttention, onScan: (ids, currency, tickets, scope, opts) => trading.mergeTickets(ids, currency, tickets, scope, opts), onBought: ticketId => trading.removeTicket(ticketId), pauseAccount: pauseAccountForBuy });
  // @strip-begin(basic)
  // Scout Avcısı: its own friend connections (Auto Trade keeps its own), Auto Trade's pricing, the
  // bought table of Auto Buy; an account Auto Trade uses or whose Auto Play is in the browser is left alone
  hunter = new ScoutHunter({
    store, activity, gameHealth, sessions: gameSessions, onChanged: emitState,
    friendNet: new FriendNetwork({ store, sessions: gameSessions, activity, onChanged: emitState }),
    priceOf: (player, accountId) => { const r = autoTrade?._listPrice?.(player, accountId); return r ? (r.fire ? { fire: true } : { price: r.price, currency: r.currency, isDefault: r.isDefault }) : null; },
    recordListed: e => buy?.recordListed?.(e),
    isBusy: id => Boolean(autoTrade?.usesAccount?.(id)) || (engine?.workers?.get(id)?.status === 'running' && engine.workers.get(id).mode === 'browser')
  });
  // @strip-end
  // a "Stop all automations" from before the restart holds: nothing resumes until Resume
  const pausedAtBoot = restoreGlobalPause();
  setTimeout(() => { if (!globalPause) hunter.resumeIfRunning(); }, 15000).unref?.(); // @strip(basic)
  if (pausedAtBoot) activity.add({ level: 'warning', accountId: null, accountName: '', taskName: 'Automations', code: 'gp.stillPaused', params: {}, message: 'All automations are still stopped (stopped before the app was closed)' });
  pvp = new PvpService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  goup = new GoUpService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  dailyBoss = new DailyBossService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  eliteAscent = new EliteAscentService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  office = new OfficeService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  big3 = new Big3Auto({ store, activity, office, gameHealth, isPaused: () => Boolean(globalPause), onChanged: emitState });
  office.big3AutoOn = () => big3.enabled();
  magicTeam = new MagicTeamService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  skills = new SkillsService({ store, activity, sessions: gameSessions, onChanged: emitState });
  professional = new ProfessionalService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  valuePredict = new ValuePredictService({ store, activity, onChanged: emitState, injuries: () => injuries?.snapshot() });
  injuries = new InjuryService({ store, activity, onChanged: emitState });
  tkTransfer = new TkTransferService({ store, activity, sessions: gameSessions, onChanged: emitState });
  apkTransfer = new ApkTransferService({ store, activity, sessions: gameSessions, friendNet, accountProfile, onChanged: emitState });
  quiz = new QuizService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  cheer = new CheerService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  dailySlot = new DailySlotService({ store, activity, engine, gameHealth, sessions: gameSessions, onChanged: emitState });
  chat = new ChatService({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState });
  draft = new DraftService({
    store, activity, gameHealth, sessions: gameSessions, accountProfile, onChanged: emitState, onAttention: autoTradeAttention,
    // Auto Trade's pricing for a drafted player (its Stok / Satılabilir price, the discounted one
    // when it was signed at the 5% cut)
    priceOf: (row, accountId) => { const r = autoTrade?._listPrice?.({ id: row.id, baseSalary: row.value, signedSalary: row.salary ?? row.value }, accountId); return r && !r.fire ? { price: r.price, currency: r.currency } : null; }
  });
  equipment = new EquipmentService({ store, activity, sessions: gameSessions, onChanged: emitState });
  // @strip-begin(basic)
  signup = new SignupService({
    store, activity, sessions: gameSessions, onChanged: emitState,
    addAccount: payload => addAccountRecord(payload),
    // registered by an earlier run that stopped before the team (no team name seen yet)
    // a prefix goes on after its highest number, kept per prefix
    lastNumber: prefix => Number(store.getSettings().signupNumbers?.[prefix.toLowerCase()]) || 0,
    saveLastNumber: (prefix, n) => { const s = store.getSettings(); const k = prefix.toLowerCase(); if ((Number(s.signupNumbers?.[k]) || 0) < n) store.saveSettings({ ...s, signupNumbers: { ...(s.signupNumbers || {}), [k]: n } }); },
    isUnfinished: a => String(a.login || '').toLowerCase().startsWith(`${String(a.name).toLowerCase()}@`) && !store.getAccountProfile().accounts?.[a.id]?.teamName,
    // the new account joins the daily routine (Daily Signin streak, tasks, Friendly Match)
    setDaily: id => {
      const settings = store.getSettings();
      const ids = Array.isArray(settings.dailyRoutineAccountIds) ? settings.dailyRoutineAccountIds : [];
      if (!ids.includes(id)) store.saveSettings({ ...settings, dailyRoutineAccountIds: [...ids, id] });
    },
    startAccount: async id => {
      const account = store.getAccounts().find(a => a.id === id);
      const taskId = account?.selectedTaskId || defaultTaskId();
      if (!account || !taskId) throw new Error('Task 1 is not available.');
      await engine.startAccount(id, taskId, { visibleBrowser: false, forceFresh: false });
    }
  });
  // @strip-end
  tournament = new TournamentService({ store, credentials, browserService, accountProfile, activity, sessions: gameSessions, onChanged: emitState });
  tournamentLevel = new TournamentLevelService({ store, activity, tournament, onChanged: emitState, createSocket: (url, options) => tournament.createSocket(url, options) }); // @strip(basic)
  tournamentLevel.start(); // @strip(basic)
  // Turnuva → Canlı and Rotasyon (user 2026-11-13): both run by themselves, nothing to start
  tournamentLive = new TournamentLive({ store, activity, engine, gameHealth, onChanged: emitState }); // @strip(basic)
  tournamentLive.start(); // @strip(basic)
  matchControl = new MatchControl({ store, activity, gameHealth, sessions: gameSessions, onChanged: emitState, allowed: (id, mode) => mode !== 'tournament' || tournamentLive.rotationOn(id) }); // @strip(basic)
  matchControl.start(); // @strip(basic)
  // @strip-begin(basic)
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
  // @strip-end
  accountHealth = new AccountHealth({ store, engine, gameHealth, onChanged: emitState });
  accountHealth.start();
  // daily data cleanup: browser caches, profiles of removed accounts, old logs (never passwords / settings / license)
  dataCleanup = new DataCleanup({ store, activity, dataDir, isOpen: id => Boolean(browserService?.shared?.has(id)), onChanged: emitState });
  dataCleanup.start();
  players.start();
  valuePredict.start();
  injuries.start();
  dailyRewards.start();
  office.start();
  big3.start();
  gameEvents = new GameEvents({ store, activity, onChat: emitState, onSalaryUpdate: async () => { await players.refresh({ automatic: true, pushed: true }); await accountHealth.refresh(); } });
  gameEvents.start();
  social = new SocialService({ store, activity, sessions: gameSessions, onChanged: emitState });
  social.start();
  // @strip-begin(basic)
  // an account creation the app was closed in the middle of: go on with it
  const pendingSignup = store.getSettings().signupJob;
  if (pendingSignup?.count > 0 && pendingSignup.passwordEncrypted) {
    setTimeout(() => {
      activity.add({ level: 'info', accountId: null, accountName: '', taskName: 'Account creation', code: 'su.resume', params: { prefix: pendingSignup.prefix, n: pendingSignup.count }, message: `Account creation continues · ${pendingSignup.prefix} · ${pendingSignup.count} left` });
      runSignupJob(pendingSignup);
    }, 30000);
  }
  // @strip-end
  // Level / TK / TIX / APK of every account, read from the game every few minutes
  // (the Stadium is seen only when Auto Play opens Chromium).
  const { GameSocket } = require('./services/game-socket.cjs');
  const refreshProfiles = () => accountProfile.refreshFromGame({ openSocket: signal => GameSocket.open({ signal }) }).catch(() => {});
  setTimeout(refreshProfiles, 20000);
  setInterval(refreshProfiles, PROFILE_REFRESH_MS);
  syncMcpServers();
}

// Dev only: one Playwright MCP server per account in the project's .mcp.json.
let mcpSyncChain = Promise.resolve();
function syncMcpServers() {
  if (app.isPackaged) return;
  // Many account changes in a row (bulk creation) make one sync a few seconds later.
  clearTimeout(mcpSyncTimer);
  mcpSyncTimer = setTimeout(runMcpSync, 5000);
}
let mcpSyncTimer = null;
function runMcpSync() {
  // Serialized so two quick account changes never seed the same profile twice.
  mcpSyncChain = mcpSyncChain
    .then(() => syncMcpConfig({ projectRoot: path.join(__dirname, '..', '..'), dataDir, accounts: store.getAccounts() }))
    .then(result => { for (const err of result.errors) console.warn('[mcp] seed failed', err); })
    .catch(err => console.warn('[mcp] sync failed:', err.message));
}

function defaultTaskId() { return registry.list().find(t => !t.loadError)?.id || null; }

// @strip-begin(basic)
// Bulk account creation keeps its job in the settings until it ends, so closing the app
// mid-run continues it at the next start (user 2026-10-31). `count` = accounts still to make.
function runSignupJob(job) {
  store.saveSettings({ ...store.getSettings(), signupJob: job });
  const password = credentials.decryptSecret(job.passwordEncrypted);
  return signup.create({ prefix: job.prefix, count: job.count, password, avatar: job.avatar, parallel: job.parallel }, {
    onProgress: ({ created }) => { const s = store.getSettings(); if (s.signupJob) store.saveSettings({ ...s, signupJob: { ...s.signupJob, count: Math.max(0, job.count - created) } }); }
  }).catch(() => null).finally(() => { const { signupJob, ...rest } = store.getSettings(); if (signupJob) store.saveSettings(rest); emitState(); });
}
// @strip-end

// Adds an account (Accounts page, bulk account creation).
function addAccountRecord(payload) {
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
    createdAt: new Date().toISOString(),
    // bulk creation: registered, first steps (team, logo) not done yet
    ...(payload.signupPending ? { signupPending: true } : {})
  };
  if (!account.login || !payload.password) throw new Error('Login and password are required.');
  accounts.push(account); store.saveAccounts(accounts);
  activity.add({ level: 'success', accountId: id, accountName: account.name, message: 'Account added.' });
  syncMcpServers();
  emitState(); return sanitizeAccount(account);
}

function registerIpc() {
  ipcMain.handle('app:bootstrap', async () => { lastSentJson.clear(); return snapshot(); });
  ipcMain.on('app:state-ack', onStateAck);

  ipcMain.handle('accounts:add', async (_event, payload) => addAccountRecord(payload));
  // @strip-begin(basic)
  ipcMain.handle('signup:create', async (_event, form) => {
    const clean = SignupService.validate(form || {});
    if (signup.snapshot().running) throw new Error('Account creation is already running.');
    runSignupJob({ prefix: clean.prefix, count: clean.count, avatar: clean.avatar, parallel: clean.parallel, passwordEncrypted: credentials.encryptSecret(clean.password) });
    await new Promise(r => setTimeout(r, 50));
    const snap = signup.snapshot();
    if (!snap.running && snap.error) throw new Error(snap.error);
    return snap;
  });
  ipcMain.handle('signup:stop', async () => { signup.stop(); return true; });
  // @strip-end

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
    const schedules = store.getSchedules().map(s => ({ ...s, accountIds: s.accountIds.filter(x => x !== id) })).filter(s => s.accountIds.length); // @strip(basic)
    store.saveSchedules(schedules); // @strip(basic)
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
  // Start many (Auto Play page "Start all" / selected / group): one account after another, here in
  // the main process so a Stop from any page cancels what is not started yet (user 2026-11-14: after
  // "stop all" 131 accounts kept opening one by one). Every start carries `since`: an account the
  // user stopped after the batch began is skipped, and one that was starting is stopped once up.
  ipcMain.handle('accounts:start-many', async (_event, ids) => {
    const list = (Array.isArray(ids) ? ids : []).filter(id => store.getAccounts().some(a => a.id === id));
    const run = { since: Date.now(), total: list.length, done: 0, started: 0, cancelled: false };
    startBatches.add(run);
    apBatchState();
    const failed = [];
    try {
      for (const id of list) {
        if (run.cancelled) break;
        run.done++;
        const r = engine.states()?.[id];
        if (r && ['running', 'preparing', 'starting', 'stopping'].includes(r.status)) continue;
        if (engine.stoppedByUserSince(id, run.since)) continue;
        const account = store.getAccounts().find(a => a.id === id);
        const taskId = account?.selectedTaskId || defaultTaskId();
        if (!account || !taskId) continue;
        try {
          const res = await engine.startAccount(id, taskId, { visibleBrowser: Boolean(account.visibleBrowser), forceFresh: false, since: run.since });
          if (!res?.skipped) run.started++;
        } catch (error) { failed.push(`${account.name}: ${error.message}`); }
        apBatchState();
      }
    } finally {
      startBatches.delete(run);
      apBatchState();
    }
    return { started: run.started, failed, cancelled: run.cancelled };
  });
  ipcMain.handle('accounts:stop', async (_event, id) => { engine.markUserStop([id]); await engine.stopAccount(id, { reason: 'Stopped by user' }); emitState(); return true; });
  // the Auto Play page's bulk Stop: every selected account at once
  ipcMain.handle('accounts:stop-many', async (_event, ids) => {
    const list = Array.isArray(ids) ? ids : [];
    engine.markUserStop(list);
    // every account asked (or all of them): the start batches stop going on at once
    const all = new Set(list);
    for (const run of startBatches) if (store.getAccounts().every(a => all.has(a.id))) run.cancelled = true;
    apBatchState();
    await engine.stopMany(list, { reason: 'Stopped by user' });
    emitState(); return true;
  });
  ipcMain.handle('accounts:select-task', async (_event, { id, taskId }) => {
    const accounts = store.getAccounts(); const account = accounts.find(a => a.id === id); if (!account) throw new Error('Account not found.');
    account.selectedTaskId = taskId; store.saveAccounts(accounts); emitState(); return true;
  });

  ipcMain.handle('accounts:set-main', async (_event, id) => {
    accountProfile.setMainAccount(id || null);
    emitState();
    return true;
  });
  // Account roles (user 2026-10-31): Main and "2. Main" live in the profile (one account
  // each), the others on the account; no role = Side. Every role but Main counts as Side for
  // the automations, "2. Main" as main while there is no Main.
  ipcMain.handle('accounts:set-role', async (_event, { id, role }) => {
    const accounts = store.getAccounts();
    const account = accounts.find(a => a.id === id);
    if (!account) throw new Error('Account not found.');
    const prof = accountProfile.snapshot();
    if (role !== 'main' && prof.realMainAccountId === id) accountProfile.setMainAccount(null);
    if (role !== 'main2' && prof.secondMainId === id) accountProfile.setSecondMain(null);
    if (role === 'main') accountProfile.setMainAccount(id);
    if (role === 'main2') accountProfile.setSecondMain(id);
    account.role = ['main', 'main2', 'side'].includes(role) || !role ? null : String(role);
    store.saveAccounts(accounts);
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
  ipcMain.handle('market:remove', async (_event, ticketIds, options) => market.removePlayers(ticketIds, options || {}));
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
  ipcMain.handle('equipment:batch', async (_event, opts) => equipment.batchCollections(opts || {}));
  ipcMain.handle('equipment:batch-stop', async () => equipment.stopBatch());
  ipcMain.handle('equipment:materials', async (_event, opts) => equipment.batchMaterials(opts || {}));
  ipcMain.handle('equipment:dismantle', async (_event, opts) => equipment.batchDismantle(opts || {}));
  ipcMain.handle('equipment:many', async (_event, opts) => equipment.strengthenMany(opts || {}));
  ipcMain.handle('equipment:equip', async (_event, { playerId, inventoryId }) => equipment.equip(playerId, inventoryId));
  ipcMain.handle('equipment:unequip', async (_event, { playerId, slot }) => equipment.unequip(playerId, slot || null));
  ipcMain.handle('equipment:quick-equip', async (_event, playerIds) => equipment.quickEquip(playerIds || null));
  ipcMain.handle('equipment:unequip-all', async () => equipment.unequipAll());
  ipcMain.handle('equipment:prepare', async (_event, collectionId, slot) => equipment.prepareCollection(collectionId, slot || null));
  ipcMain.handle('tournament:start', async (_event, accountIds) => tournament.start(accountIds));
  ipcMain.handle('tournament:stop', async () => tournament.stop());
  ipcMain.handle('tournament-level:check', async (_event, { swap } = {}) => tournamentLevel.check({ swap: Boolean(swap) })); // @strip(basic)
  ipcMain.handle('tournament-level:auto', async (_event, { on } = {}) => tournamentLevel.setAuto(Boolean(on))); // @strip(basic)
  ipcMain.handle('tournament:refresh', async () => tournament.refreshEvents());

  ipcMain.handle('auto-trade:preflight', async (_event, options) => ({ conflicts: autoTradeConflicts(options.accountIds || [], { keepAutoPlay: Boolean(options.keepAutoPlay ?? options.config?.keepAutoPlay) }), ...(await autoTrade.preflight(options)) }));
  ipcMain.handle('auto-trade:attention', async (_event, kind) => { autoTradeAttention(kind); return true; });
  ipcMain.handle('auto-trade:start', async (_event, options) => {
    if (options.stopConflicts) await stopAutoTradeConflicts(options.accountIds || [], { keepAutoPlay: Boolean(options.keepAutoPlay ?? options.config?.keepAutoPlay) });
    return autoTrade.start(options);
  });
  // Hazırlık: a run that only does the bench decisions (list, fire, trade / card to main).
  // Auto Play steps aside on main and the accounts with a decision.
  ipcMain.handle('auto-trade:prepare', async (_event, options) => {
    if (options.stopConflicts) await stopAutoTradeConflicts(options.accountIds || []);
    return autoTrade.prepare(options);
  });
  ipcMain.handle('auto-trade:stop-prepare', async () => autoTrade.stopPrepare());
  ipcMain.handle('auto-trade:clear-prepare', async () => autoTrade.clearPrepare());
  ipcMain.handle('auto-trade:pause', async () => autoTrade.pause());
  ipcMain.handle('auto-trade:resume', async () => autoTrade.resume());
  ipcMain.handle('auto-trade:stop', async () => autoTrade.stop());
  ipcMain.handle('auto-trade:continue', async () => autoTrade.continue());
  ipcMain.handle('auto-trade:reset', async () => autoTrade.reset());
  ipcMain.handle('auto-trade:reset-cards', async () => autoTrade.resetCardCounts());
  ipcMain.handle('auto-trade:respond-listing', async (_event, items) => autoTrade.respondListing(items));
  ipcMain.handle('auto-trade:respond-role', async (_event, dir) => autoTrade.respondRole(dir));
  ipcMain.handle('auto-trade:list-players', async (_event, { accountId, items }) => autoTrade.listPlayers(accountId, items));
  ipcMain.handle('auto-trade:fire-player', async (_event, { accountId, playerId }) => autoTrade.firePlayer(accountId, playerId));
  ipcMain.handle('auto-trade:save-draft', async (_event, form) => autoTrade.saveDraft(form));
  ipcMain.handle('auto-trade:save-pricing', async (_event, pricing) => autoTrade.savePricing(pricing));
  ipcMain.handle('auto-trade:friend-sync', async () => autoTrade.friendNet.sync({ force: true }));
  ipcMain.handle('auto-trade:fire-players', async (_event, { accountId, playerIds }) => autoTrade.firePlayers(accountId, playerIds));


  ipcMain.handle('cards:add-role', async (_event, payload) => cards.addRole(payload?.name ?? payload, payload?.color));
  ipcMain.handle('cards:update-role', async (_event, { id, patch, name, color }) => cards.updateRole(id, patch || { name, color }));
  ipcMain.handle('cards:delete-role', async (_event, id) => cards.deleteRole(id));
  ipcMain.handle('cards:set-player-roles', async (_event, { playerKey, roleIds }) => cards.setPlayerRoles(playerKey, roleIds));
  ipcMain.handle('cards:set-hidden-roles', async (_event, { playerKey, roleIds }) => cards.setHiddenRoles(playerKey, roleIds));
  ipcMain.handle('cards:set-tracked-teams', async (_event, teams) => cards.setTrackedTeams(teams));
  ipcMain.handle('cards:refresh', async () => cards.refresh());
  ipcMain.handle('cards:reset', async () => cards.resetData());

  ipcMain.handle('tasks:refresh', async () => { registry.refresh(); emitState(); return registry.list(); });
  ipcMain.handle('tasks:open-folder', async () => { ensureDir(taskDir()); return shell.openPath(taskDir()); });

  // @strip-begin(basic)
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
  ipcMain.handle('schedules:remove', async (_event, id) => { scheduler.cancel(id); store.saveSchedules(store.getSchedules().filter(s => s.id !== id)); emitState(); return true; }); // @strip(basic)
  ipcMain.handle('schedules:toggle', async (_event, { id, enabled }) => {
    const schedules = store.getSchedules(); const item = schedules.find(s => s.id === id); if (!item) throw new Error('Schedule not found.');
    item.enabled = Boolean(enabled); store.saveSchedules(schedules); emitState(); return true;
  });
  // @strip-end

  ipcMain.handle('daily:refresh-tasks', async (_event, accountIds) => dailyRoutine.refreshTasks(Array.isArray(accountIds) ? accountIds : store.getAccounts().map(a => a.id)));
  ipcMain.handle('daily:claim-rewards', async (_event, accountIds) => dailyRoutine.claimRewards(Array.isArray(accountIds) ? accountIds : []));
  ipcMain.handle('settings:update', async (_event, patch) => {
    const settings = { ...store.getSettings(), ...patch };
    store.saveSettings(settings);
    if ('dailyRoutineAccountIds' in (patch || {})) for (const id of Object.keys(engine.states())) engine.recheckBeforeRun(id);
    // a deleted role: its accounts go back to Side
    if (Array.isArray(patch?.accountRoleDefs)) {
      const known = new Set(patch.accountRoleDefs.map(r => r.id));
      const accounts = store.getAccounts();
      let changed = false;
      for (const a of accounts) if (a.role && !known.has(a.role)) { a.role = null; changed = true; }
      if (changed) store.saveAccounts(accounts);
    }
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
      `Running: Auto Play ${Object.values(engine.states()).filter(w => w.status === 'running').length} · Auto Buy ${buy?.snapshot().auto?.status || '-'} · Auto Trade ${autoTrade?.snapshot().run?.status || '-'} · game reachable ${!gameHealth?.isDown()}`, // @strip(basic)
      //@only(basic) `Running: Auto Play ${Object.values(engine.states()).filter(w => w.status === 'running').length} · Auto Trade ${autoTrade?.snapshot().run?.status || '-'} · game reachable ${!gameHealth?.isDown()}`,
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
  // After a native confirm()/alert() Electron may leave the page without keyboard focus: inputs
  // then take no typing until the window is clicked away and back (user 2026-11-13, Draft prices).
  ipcMain.handle('app:refocus', async () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.blur(); mainWindow.focus(); mainWindow.webContents.focus(); } return true; });
  ipcMain.handle('app:resume-all', async () => resumeAll());
  ipcMain.handle('app:factory-reset', async (_event, options) => { setTimeout(() => factoryReset(options || {}).catch(error => console.warn('[factory reset]', error)), 300); return true; });
  ipcMain.handle('settings:open-data-folder', async () => shell.openPath(dataDir));
  ipcMain.handle('data-cleanup:run', async () => dataCleanup.run({ source: 'manual' }));
  ipcMain.handle('data-cleanup:set-days', async (_event, days) => dataCleanup.setDays(days));
  ipcMain.handle('activity:clear', async () => { activity.clear(); return true; });
  ipcMain.handle('players:refresh', async () => players.refresh());
  ipcMain.handle('rosters:refresh', async () => rosters.refresh());
  ipcMain.handle('rotation:set-mode', async (_event, { mode, on }) => matchControl.setMode(mode, on)); // @strip(basic)
  ipcMain.handle('rotation:stop', async (_event, accountId) => matchControl.stopAccount(accountId)); // @strip(basic)
  ipcMain.handle('tlive:set-auto', async (_event, ids) => tournamentLive.setAuto(Array.isArray(ids) ? ids : [])); // @strip(basic)
  ipcMain.handle('tlive:set-rotation', async (_event, { ids, on }) => tournamentLive.setRotation(Array.isArray(ids) ? ids : [], Boolean(on))); // @strip(basic)
  ipcMain.handle('hunter:add', async (_event, players) => hunter.addWatch(players || [])); // @strip(basic)
  ipcMain.handle('hunter:update', async (_event, { playerId, patch }) => hunter.updateWatch(playerId, patch || {})); // @strip(basic)
  ipcMain.handle('hunter:remove', async (_event, ids) => hunter.removeWatch(ids || [])); // @strip(basic)
  ipcMain.handle('hunter:start', async () => hunter.start()); // @strip(basic)
  ipcMain.handle('hunter:stop', async () => hunter.stop()); // @strip(basic)
  ipcMain.handle('hunter:clear-warnings', async () => hunter.clearWarnings()); // @strip(basic)
  ipcMain.handle('hunter:set-option', async (_event, patch) => hunter.setOption(patch || {})); // @strip(basic)
  ipcMain.handle('hunter:set-refresh', async (_event, patch) => hunter.setRefresh(patch || {})); // @strip(basic)
  ipcMain.handle('bag:read', async (_event, { accountIds } = {}) => bag.read(Array.isArray(accountIds) ? accountIds : null));
  ipcMain.handle('bag:use', async (_event, { accountIds, itemId } = {}) => bag.use(Array.isArray(accountIds) ? accountIds : [], { itemId: itemId || null }));
  ipcMain.handle('bag:open-cards', async (_event, { accountIds, itemIds, count } = {}) => bag.openCards({ accountIds: Array.isArray(accountIds) ? accountIds : [], itemIds: Array.isArray(itemIds) ? itemIds : [], count }));
  ipcMain.handle('bag:status', async (_event, { accountId } = {}) => { await bag.status(accountId); return bag.snapshot(); });
  ipcMain.handle('vp:refresh', async () => valuePredict.refresh());
  ipcMain.handle('injuries:refresh', async () => injuries.refresh());
  ipcMain.handle('buy:buy', async (_event, { accountId, ticket }) => buy.buy(accountId, ticket));
  ipcMain.handle('buy:cheapest', async (_event, query) => buy.cheapest(query || {}));
  ipcMain.handle('buy:sell', async (_event, { entryId, price, currency }) => buy.sell(entryId, price, currency));
  ipcMain.handle('buy:remove-bought', async (_event, ids) => buy.removeBought(ids || []));
  ipcMain.handle('buy:bulk-buy', async (_event, { accountId, tickets, convert }) => buy.bulkBuy(accountId, tickets || [], { convert: Boolean(convert) }));
  ipcMain.handle('buy:stop-bulk', async () => buy.stopBulk());
  ipcMain.handle('buy:clear-bulk', async () => buy.clearBulk());
  ipcMain.handle('buy:convert', async (_event, entryId) => buy.convert(entryId));
  ipcMain.handle('buy:fire', async (_event, ids) => buy.fire(ids || []));
  ipcMain.handle('buy:add-watch', async (_event, players) => buy.addWatch(players || [])); // @strip(basic)
  ipcMain.handle('buy:update-watch', async (_event, { id, patch }) => buy.updateWatch(id, patch || {})); // @strip(basic)
  ipcMain.handle('buy:add-range', async (_event, id) => buy.addRange(id)); // @strip(basic)
  ipcMain.handle('buy:remove-watch', async (_event, ids) => buy.removeWatch(ids || [])); // @strip(basic)
  ipcMain.handle('buy:set-config', async (_event, patch) => buy.setConfig(patch || {})); // @strip(basic)
  ipcMain.handle('buy:start-auto', async (_event, options) => startAutoBuy(options || {})); // @strip(basic)
  ipcMain.handle('buy:stop-auto', async () => buy.stopAuto()); // @strip(basic)
  // props with rotation on: only the starting five get them, the aces go back on court first (user 2026-11-13)
  ipcMain.handle('props:run', async (_event, accountId) => { matchControl?.forProps(accountId); return props.run(accountId); }); // @strip(basic)
  //@only(basic) ipcMain.handle('props:run', async (_event, accountId) => props.run(accountId));
  ipcMain.handle('props:stop', async (_event, accountId) => { props.stop(accountId); return props.snapshot(); });
  ipcMain.handle('props:bags', async (_event, accountIds) => props.bagsOf(Array.isArray(accountIds) ? accountIds : null));
  ipcMain.handle('activate:start', async (_event, options) => activate.start(options || {}));
  ipcMain.handle('activate:stop', async () => activate.stop());
  ipcMain.handle('activate:levels', async (_event, levels) => { store.saveSettings({ ...store.getSettings(), activateLevels: Array.isArray(levels) ? levels : [] }); emitState(); return activate.snapshot(); });
  ipcMain.handle('synthesis:start', async (_event, options) => synthesis.start(options || {}));
  ipcMain.handle('synthesis:stop', async () => synthesis.stop());
  ipcMain.handle('tower:start', async (_event, accountIds) => startTower(Array.isArray(accountIds) ? accountIds : []));
  ipcMain.handle('tower:stop', async (_event, accountIds) => tower.stop(Array.isArray(accountIds) && accountIds.length ? accountIds : null));
  ipcMain.handle('pvp:stop', async () => { pvp.stop(); return pvp.snapshot(); });
  ipcMain.handle('pvp:status', async (_event, accountIds) => pvp.status(Array.isArray(accountIds) ? accountIds : store.getAccounts().map(a => a.id)));
  ipcMain.handle('pvp:start', async (_event, accountIds) => startPvpManual(Array.isArray(accountIds) ? accountIds : []));
  ipcMain.handle('boss:start', async (_event, plan) => startProvingManual(dailyBoss, plan, 'Daily Boss', 'bo', p => { bossDone = p; }));
  ipcMain.handle('boss:stop', async () => { dailyBoss.stop(); return dailyBoss.snapshot(); });
  ipcMain.handle('boss:status', async (_event, accountIds) => dailyBoss.status(Array.isArray(accountIds) ? accountIds : null));
  ipcMain.handle('ascent:start', async (_event, plan) => startProvingManual(eliteAscent, plan, 'Elite Ascent', 'ea', p => { ascentDone = p; }));
  // TK transfer: Auto Play on the chosen accounts is stopped first and started again afterwards.
  ipcMain.handle('tk:start', async (_event, raw) => {
    const config = tkTransfer.validate(raw || {});
    if (tkTransfer.snapshot().running) throw new Error('TK transfer is already running.');
    const resume = await pauseTasksFor([config.mainId, ...config.sideIds], 'TK Transfer', 'tk');
    tkDone = tkTransfer.runAndWait(config).catch(() => {}).finally(resume);
    return tkTransfer.snapshot();
  });
  ipcMain.handle('tk:stop', async () => { tkTransfer.stop(); return tkTransfer.snapshot(); });
  // APK / TIX transfer: Auto Play on the chosen accounts (and the spenders it may use) is stopped first.
  ipcMain.handle('game:probe-now', async () => gameHealth.probeNow());
  // Owner license panel — FULL edition only. All its code lives in license-admin-ipc.cjs, which the @strip(pro,basic)
  // build pipeline deletes for pro/basic, so none of it is compiled into a shared edition. @strip(pro,basic)
  if (BUILD_EDITION === 'full') { try { require('./license-admin-ipc.cjs').register(ipcMain); } catch { /* shared edition */ } } // @strip(pro,basic)
  ipcMain.handle('apk:scan', async (_event, ids) => apkTransfer.scanBalances(Array.isArray(ids) ? ids : []));
  ipcMain.handle('apk:start', async (_event, raw) => {
    const config = apkTransfer.validate(raw || {});
    if (apkTransfer.snapshot().running) throw new Error('APK transfer is already running.');
    const spenders = config.useSpenders ? store.getAccounts().filter(a => a.role === 'spender').map(a => a.id) : [];
    const resume = await pauseTasksFor([...new Set([config.mainId, ...config.sideIds, ...spenders])], 'APK Transfer', 'apk');
    apkDone = apkTransfer.runAndWait(config).catch(() => {}).finally(resume);
    return apkTransfer.snapshot();
  });
  ipcMain.handle('apk:stop', async () => { apkTransfer.stop(); return apkTransfer.snapshot(); });
  ipcMain.handle('apk:save-config', async (_event, raw) => apkTransfer.saveConfig(raw || {}));
  ipcMain.handle('pro:start', async (_event, plan) => startProvingManual(professional, plan, 'Professional', 'pf', p => { proDone = p; }));
  ipcMain.handle('pro:stop', async () => { professional.stop(); return professional.snapshot(); });
  ipcMain.handle('pro:status', async (_event, accountIds) => professional.status(Array.isArray(accountIds) ? accountIds : null));
  ipcMain.handle('pro:reset', async (_event, ids) => professional.resetProgress(Array.isArray(ids) ? ids : []));
  ipcMain.handle('ascent:reset', async (_event, ids) => eliteAscent.resetProgress(Array.isArray(ids) ? ids : []));
  ipcMain.handle('pro:createHof', async (_event, accountId) => professional.createHof(accountId));
  ipcMain.handle('ascent:stop', async () => { eliteAscent.stop(); return eliteAscent.snapshot(); });
  ipcMain.handle('ascent:status', async (_event, accountIds) => eliteAscent.status(Array.isArray(accountIds) ? accountIds : null));
  ipcMain.handle('magic:start', async (_event, plan) => startProvingManual(magicTeam, plan, 'Magic Team', 'mt', p => { magicDone = p; }));
  ipcMain.handle('magic:stop', async () => { magicTeam.stop(); return magicTeam.snapshot(); });
  ipcMain.handle('magic:status', async (_event, accountIds) => magicTeam.status(Array.isArray(accountIds) ? accountIds : null));
  ipcMain.handle('big3:scan', async (_event, { accountIds } = {}) => big3.scanAccounts(Array.isArray(accountIds) ? accountIds : null));
  ipcMain.handle('big3:setup', async (_event, { accountIds } = {}) => big3.setup(Array.isArray(accountIds) ? accountIds : []));
  ipcMain.handle('big3:enable', async (_event, { on } = {}) => big3.setEnabled(Boolean(on)));
  ipcMain.handle('big3:bonus', async (_event, { accountId, type } = {}) => big3.setBonus(accountId, type));
  ipcMain.handle('office:status', async (_event, { accountIds, teamIds } = {}) => office.status(accountIds, { teamIds: teamIds || {} }));
  ipcMain.handle('office:select-coach', async (_event, { accountId, coachId }) => { await office.selectCoach(accountId, coachId); return office.snapshot(); });
  ipcMain.handle('office:coach-tick', async (_event, { accountId }) => ({ result: await office.coachTick(accountId, { manual: true }), snapshot: office.snapshot() }));
  ipcMain.handle('office:big3-tick', async (_event, { accountId, teamId }) => ({ result: await office.big3Tick(accountId, teamId, { manual: true }), snapshot: office.snapshot() }));
  ipcMain.handle('office:bonus', async (_event, { accountId, teamId, type }) => { await office.upgradeBonus(accountId, teamId, type); return office.snapshot(); });
  ipcMain.handle('office:active', async (_event, { accountId, on }) => { await office.setActive(accountId, Boolean(on)); return office.snapshot(); });
  ipcMain.handle('office:read-team', async (_event, { accountId, teamId }) => office.status([accountId], { teamIds: { [accountId]: teamId } }));
  ipcMain.handle('office:super-players', async (_event, { accountId }) => office.superPlayers(accountId));
  ipcMain.handle('office:super-set', async (_event, { accountId, playerIds }) => { await office.superSetPlayers(accountId, playerIds); return office.snapshot(); });
  ipcMain.handle('office:super-bonus', async (_event, { accountId, type }) => { await office.superBonus(accountId, type); return office.snapshot(); });
  ipcMain.handle('office:super-active', async (_event, { accountId, on }) => { await office.superActive(accountId, Boolean(on)); return office.snapshot(); });
  ipcMain.handle('office:super-tick', async (_event, { accountId }) => ({ result: await office.superTick(accountId, { manual: true }), snapshot: office.snapshot() }));
  ipcMain.handle('skills:view', async (_event, { accountId }) => skills.view(accountId));
  ipcMain.handle('skills:learn', async (_event, { accountId }) => skills.learn(accountId));
  ipcMain.handle('skills:shuffle', async (_event, { accountId, containerId }) => skills.shuffle(accountId, containerId));
  ipcMain.handle('skills:lock', async (_event, { accountId, containerId, slot, locked }) => skills.toggleLock(accountId, containerId, slot, locked));
  ipcMain.handle('skills:assign', async (_event, { accountId, containerId, playerId }) => skills.assign(accountId, containerId, playerId || null));
  ipcMain.handle('skills:auto', async (_event, { accountIds, plan }) => skills.autoMany(accountIds || [], plan || null));
  ipcMain.handle('skills:auto-stop', async () => skills.stopAuto());
  ipcMain.handle('skills:catalog', async () => skills.catalog());
  ipcMain.handle('goup:start', async (_event, { accountIds, mode, gapSec } = {}) => startGoUpManual(Array.isArray(accountIds) ? accountIds : [], { mode, gapSec }));
  ipcMain.handle('goup:stop', async () => { goup.stop(); return goup.snapshot(); });
  ipcMain.handle('goup:status', async (_event, accountIds) => goup.status(Array.isArray(accountIds) ? accountIds : null));
  ipcMain.handle('quiz:start', async (_event, accountIds) => startQuizManual(Array.isArray(accountIds) ? accountIds : []));
  ipcMain.handle('quiz:stop', async () => { quiz.stop(); return quiz.snapshot(); });
  ipcMain.handle('quiz:answer', async (_event, { accountId, letter } = {}) => quiz.answer(accountId, letter));
  ipcMain.handle('social:view', async (_event, accountId) => social.view(accountId));
  ipcMain.handle('social:conversation', async (_event, { accountId, friendId } = {}) => social.conversation(accountId, friendId));
  ipcMain.handle('social:send', async (_event, { accountId, friendId, text } = {}) => social.send(accountId, friendId, text));
  ipcMain.handle('social:search', async (_event, { accountId, text } = {}) => social.search(accountId, text));
  ipcMain.handle('social:friend-scout', async (_event, { accountId, friendId } = {}) => social.friendScout(accountId, friendId));
  ipcMain.handle('social:friend-sign', async (_event, { accountId, friendId, playerId } = {}) => social.friendSign(accountId, friendId, playerId));
  ipcMain.handle('social:act', async (_event, { accountId, action, targetId } = {}) => social.act(accountId, action, targetId));
  ipcMain.handle('social:claimAllMail', async () => social.claimAllMail());
  ipcMain.handle('social:claimMail', async (_event, { accountId, mailId } = {}) => social.claimMail(accountId, mailId || null));
  ipcMain.handle('social:poll', async () => { await social.poll(); return social.snapshot(); });
  ipcMain.handle('slot:scan', async (_event, ids) => dailySlot.scan(Array.isArray(ids) ? ids : []));
  ipcMain.handle('slot:spin', async (_event, ids) => dailySlot.spin(Array.isArray(ids) ? ids : []));
  ipcMain.handle('slot:stop', async () => { dailySlot.stop(); return dailySlot.snapshot(); });
  ipcMain.handle('cheer:start', async (_event, { fromIds, targetIds } = {}) => cheer.start(Array.isArray(fromIds) ? fromIds : [], Array.isArray(targetIds) ? targetIds : []));
  ipcMain.handle('cheer:stop', async () => cheer.stopRun());
  ipcMain.handle('cheer:send', async (_event, { fromIds, targetId } = {}) => cheer.cheer(Array.isArray(fromIds) ? fromIds : [], targetId));
  ipcMain.handle('chat:start', async (_event, config) => { chat.runAndWait(config || {}).catch(() => {}); await new Promise(r => setTimeout(r, 50)); if (!chat.snapshot().running) throw new Error(chat.snapshot().lastReport?.lastError || 'Chat could not start.'); return chat.snapshot(); });
  ipcMain.handle('chat:stop', async () => { chat.stop(); return chat.snapshot(); });
  ipcMain.handle('draft:watch', async () => draft.watch());
  ipcMain.handle('draft:unwatch', async () => draft.unwatch());
  ipcMain.handle('draft:join', async (_event, { accountId, slot }) => draft.join(accountId, slot));
  ipcMain.handle('draft:pick', async (_event, { accountId, playerId }) => draft.pick(accountId, playerId));
  ipcMain.handle('draft:list-players', async (_event, { accountId, items }) => draft.listPlayers(accountId, items));
  ipcMain.handle('draft:clear-drafted', async (_event, arg) => (arg && typeof arg === 'object' ? draft.clearDrafted(arg.accountId, arg.source) : draft.clearDrafted(arg, 'draft')));
  // Kov / Karta çevir on drafted players: like a quick hand action, the accounts' other services
  // step aside for it; an account Auto Trade is working on right now is not touched.
  const draftHand = async (ids, fn) => {
    const busy = ids.filter(id => autoTrade?.usesAccount?.(id));
    if (busy.length) throw new Error(`Auto Trade is using ${busy.map(id => store.getAccounts().find(a => a.id === id)?.name || id).join(', ')} right now · try again when it is done.`);
    const resumes = [];
    try { for (const id of ids) resumes.push(await pauseAccountForBuy(id, 'Draft')); return await fn(); }
    finally { for (const r of resumes.reverse()) await r().catch(() => {}); }
  };
  // Kov while Auto Trade runs (user 2026-11-13): an account of the run fires over Auto Trade's own
  // connection; another account Auto Trade holds waits and is fired once it is free.
  const draftFireNow = async (accountId, playerIds) => {
    const rows = (draft.snapshot().drafted?.[accountId] || []).filter(p => playerIds.includes(p.id));
    if (autoTrade?.isRunning?.()) {
      const fired = await autoTrade.fireForDraft(accountId, rows);
      if (fired) { draft.firedByAutoTrade(accountId, fired); if (fired.length < rows.length) throw new Error(`${rows.length - fired.length} player(s) could not be fired.`); return { firedByAT: fired.length }; }
    }
    if (autoTrade?.usesAccount?.(accountId)) { draft.queueFire(accountId, playerIds); return { queued: rows.length }; }
    await draftHand([accountId], () => draft.firePlayers(accountId, playerIds));
    return { done: rows.length };
  };
  ipcMain.handle('draft:fire-players', async (_event, { accountId, playerIds }) => draftFireNow(accountId, playerIds || []));
  // Karta çevir while Auto Trade runs (user 2026-11-13): an account of the run hands the players to
  // Auto Trade (its own trade to main + Make does it); otherwise, while Auto Trade holds the
  // account or main, the request waits and runs by itself once both are free.
  const draftCardIds = accountId => [...new Set([accountId, store.getAccountProfile()?.mainAccountId].filter(Boolean))];
  const draftCardsNow = async (accountId, playerIds) => {
    const rows = (draft.snapshot().drafted?.[accountId] || []).filter(p => playerIds.includes(p.id));
    if (autoTrade?.isRunning?.() && autoTrade.handToCards(accountId, rows)) { draft.handedToAutoTrade(accountId, playerIds); return { handed: rows.length }; }
    if (draftCardIds(accountId).some(id => autoTrade?.usesAccount?.(id))) { draft.queueCards(accountId, playerIds); return { queued: rows.length }; }
    await draftHand(draftCardIds(accountId), () => draft.toCards(accountId, playerIds));
    return { done: rows.length };
  };
  ipcMain.handle('draft:to-cards', async (_event, { accountId, playerIds }) => draftCardsNow(accountId, playerIds || []));
  // Laborer Contract (user 2026-11-18): the two accounts' other services step aside like for Draft's Kov.
  ipcMain.handle('labor:read', async () => labor.read());
  // Sakatlık / Anestezi (user 2026-11-18)
  ipcMain.handle('injury:scan', async (_event, ids) => injuryGuard.scan(Array.isArray(ids) ? ids : null));
  ipcMain.handle('injury:heal', async (_event, { items, quantity } = {}) => injuryGuard.heal(Array.isArray(items) ? items : [], quantity || 1));
  ipcMain.handle('injury:swap', async (_event, ids) => injuryGuard.swap(Array.isArray(ids) ? ids : []));
  ipcMain.handle('injury:view-start', async (_event, { accountIds, max } = {}) => injuryViewStart(Array.isArray(accountIds) ? accountIds : [], max));
  ipcMain.handle('injury:view-stop', async () => injuryViewStop());
  ipcMain.handle('injury:settings', async (_event, patch) => injuryGuard.saveSettings(patch || {}));
  ipcMain.handle('labor:range', async (_event, playerId) => labor.range(playerId));
  ipcMain.handle('labor:apply', async (_event, o = {}) => draftHand([...new Set([o.fromAccountId, o.toAccountId].filter(Boolean))], () => labor.apply(o)));
  let draftCardsBusy = false;
  setInterval(async () => {
    if (draftCardsBusy) return;
    const queued = draft?.queuedCards?.() || {};
    const fires = draft?.queuedFire?.() || {};
    if (!Object.keys(queued).length && !Object.keys(fires).length) return;
    draftCardsBusy = true;
    try {
      for (const [accountId, ids] of Object.entries(fires)) {
        const inRun = autoTrade?.isRunning?.() && autoTrade.state?.config?.accountIds?.includes(accountId);
        if (autoTrade?.usesAccount?.(accountId) && !inRun) continue;
        draft.queueFire(accountId, ids, false);
        await draftFireNow(accountId, ids).catch(() => {});
      }
      for (const [accountId, ids] of Object.entries(queued)) {
        if (draftCardIds(accountId).some(id => autoTrade?.usesAccount?.(id)) && !(autoTrade?.isRunning?.() && autoTrade.state?.config?.accountIds?.includes(accountId))) continue;
        await draftCardsNow(accountId, ids).catch(() => draft.queueCards(accountId, ids, false));
      }
    } finally { draftCardsBusy = false; }
  }, 20000).unref?.();
  ipcMain.handle('players:set-roles', async (_event, { playerId, roleIds }) => cards.setRolesById(playerId, roleIds));
}

app.on('second-instance', () => showMainWindow());

// --- License gate (shared editions only; the full edition skips all of this) --------------------
const { isLicensed: IS_LICENSED, EDITION: BUILD_EDITION } = require('./edition.cjs');
let licenseClient = null;
// The periodic check found the license gone. A short outage never lands here: the client covers it
// with its offline grace (3 days), so this is a final answer (revoked, expired, blocked…) or a server
// that stayed unreachable past the grace. Quitting goes through before-quit, so the services stop
// cleanly first.
const LICENSE_LOST_TEXT = {
  revoked: 'Lisansınız iptal edildi.', expired: 'Lisansınızın süresi doldu.', blocked: 'Bu bilgisayar engellendi.',
  'other-machine': 'Bu lisans başka bir bilgisayara bağlı.', 'not-found': 'Lisans bulunamadı.', edition: 'Bu lisans bu sürüm için değil.',
  pending: 'Bu bilgisayar henüz onaylanmadı.', 'machine-limit': 'Bu lisansın cihaz sınırı dolu.',
  offline: 'Lisans sunucusuna 3 gündür ulaşılamıyor. İnternet bağlantınızı kontrol edin.'
};
function onLicenseLost(status) {
  if (status?.ok) return;
  const why = LICENSE_LOST_TEXT[status?.reason] || 'Lisans doğrulanamadı.';
  try { dialog.showErrorBox('DreamTeam Manager', `${why} Uygulama kapatılıyor.`); } catch {}
  app.__reallyQuit = true;
  app.quit();
}
function createLicenseWindow() {
  const win = new BrowserWindow({
    width: 480, height: 470, resizable: false, title: 'DreamTeam Manager', icon: ICON_PNG,
    autoHideMenuBar: true, webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile(path.join(__dirname, 'license.html'));
  return win;
}
// Returns true when the app may start. In the full edition it returns true at once.
async function gateLicense() {
  if (!IS_LICENSED) return true;
  const { LicenseClient } = require('./services/license.cjs');
  licenseClient = new LicenseClient({ app, config: require('./license-config.cjs'), edition: BUILD_EDITION });
  ipcMain.handle('license:machine', () => licenseClient.machine);
  const first = await licenseClient.check('validate');
  if (first.ok) { licenseClient.startPeriodic(onLicenseLost); return true; }
  return await new Promise(resolve => {
    const win = createLicenseWindow();
    let done = false;
    ipcMain.handle('license:submit', async (_e, key) => {
      const s = await licenseClient.activate(key, 'activate', []);
      if (s.ok) { done = true; licenseClient.startPeriodic(onLicenseLost); try { win.close(); } catch {} resolve(true); }
      return s;
    });
    win.on('closed', () => { if (!done) resolve(false); });
  });
}

app.whenReady().then(async () => {
  if (!singleInstance) return;
  if (!(await gateLicense())) { app.__reallyQuit = true; app.quit(); return; }
  initServices(); registerIpc(); createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Stops every service (and their Chromium processes). Used when quitting and before a
// factory reset.
async function shutdownServices() {
  // Each step on its own: one failing service must not leave the others
  // (or their Chromium processes) running.
  const steps = [
    () => matchControl?.stop(), // @strip(basic)
    () => tournamentLive?.stop(), // @strip(basic)
    () => hunter?.stop({ remember: false }), // @strip(basic)
    () => scheduler?.stop(), // @strip(basic)
    () => trading?.stop(),
    () => autoTrade?.shutdown?.(),
    () => market?.shutdown(),
    () => players?.stop(),
    () => draft?.shutdown(),
    () => pvp?.stop(),
    () => goup?.stop(),
    () => activate?.stop(),
    () => dailyBoss?.stop(),
    () => eliteAscent?.stop(),
    () => magicTeam?.stop(),
    () => office?.stop(),
    () => tournamentLevel?.stop(), // @strip(basic)
    () => big3?.stop(),
    () => professional?.stop(),
    () => tkTransfer?.stop(),
    () => apkTransfer?.stop(),
    () => valuePredict?.stop(),
    () => injuries?.stop(),
    () => quiz?.stop(),
    () => chat?.stop(),
    () => cheer?.stop(),
    () => dailySlot?.stop(),
    () => tower?.stop(),
    () => dataCleanup?.stop(),
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
  // The license key (userData/license.json) is outside the data folder, so a reset never asks
  // for the license again; 'license.json' is listed too in case it ever lives here.
  const keep = new Set(['mcp-profiles', 'quiz-bank.json', 'license.json', ...(keepPasswords ? KEEP_ON_RESET : [])]);
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
