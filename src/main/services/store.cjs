const fs = require('fs');
const path = require('path');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

const DEFAULT_PRESETS = [
  { id: 'preset-splus', name: 'S+', salaryMax: 2400, gradeMin: 'S+', gradeMax: 'S+' },
  { id: 'preset-s', name: 'S/S-', salaryMax: 1400, gradeMin: 'S-', gradeMax: 'S' },
  { id: 'preset-ba', name: 'B-/A', salaryMax: 400, gradeMin: 'B-', gradeMax: 'A+' }
];

class AppStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    // All writes go through AppStore. Keep parsed data until the matching save;
    // the frequent UI snapshots should not reread and parse every JSON file.
    this.cache = new Map();
    this.revisions = new Map();
    ensureDir(baseDir);
    this.files = {
      accounts: path.join(baseDir, 'accounts.json'),
      accountProfile: path.join(baseDir, 'account-profile.json'),
      schedules: path.join(baseDir, 'schedules.json'),
      settings: path.join(baseDir, 'settings.json'),
      activity: path.join(baseDir, 'activity.json'),
      tradeAccount: path.join(baseDir, 'trade-account.json'),
      tradingRows: path.join(baseDir, 'trading-hall.json'),
      cards: path.join(baseDir, 'cards.json'),
      cardRoles: path.join(baseDir, 'card-roles.json'),
      cardMetadata: path.join(baseDir, 'card-metadata.json'),
      autoTrade: path.join(baseDir, 'auto-trade.json'),
      dailyRewards: path.join(baseDir, 'daily-rewards.json'),
      playerMarketData: path.join(baseDir, 'player-market.json'),
      playerMarketAccount: path.join(
        baseDir,
        'player-market-account.json'
      ),
      playerMarketData: path.join(
        baseDir,
        'player-market.json'
      ),
    };

    const existing = readJson(this.files.settings, {});
    const next = {
      defaultPreparationMinutes: 6,
      loginStaggerSeconds: 3,
      maxActivityEntries: 500,
      language: 'auto',
      tradeStopPrice: 9999,
      tradeScanCurrency: 'APK_TICKET',
      tradePresets: DEFAULT_PRESETS,
      ...existing
    };
    if (!Array.isArray(next.tradePresets) || !next.tradePresets.length) next.tradePresets = DEFAULT_PRESETS;
    this.saveSettings(next);
  }

  _get(key, fallback) {
    if (!this.cache.has(key)) this.cache.set(key, readJson(this.files[key], fallback));
    return this.cache.get(key);
  }
  _save(key, value) {
    writeJsonAtomic(this.files[key], value);
    this.cache.set(key, value);
    this.revisions.set(key, (this.revisions.get(key) || 0) + 1);
  }
  revision(key) { return this.revisions.get(key) || 0; }

  getAccounts() { return this._get('accounts', []); }
  saveAccounts(v) { this._save('accounts', v); }
  getAccountProfile() { return this._get('accountProfile', { version: 1, mainAccountId: null, accounts: {} }); }
  saveAccountProfile(v) { this._save('accountProfile', v); }
  getSchedules() { return this._get('schedules', []); }
  saveSchedules(v) { this._save('schedules', v); }
  getSettings() { return this._get('settings', {}); }
  saveSettings(v) { this._save('settings', v); }
  getActivity() { return this._get('activity', []); }
  saveActivity(v) { this._save('activity', v); }
  getTradeAccount() { return this._get('tradeAccount', null); }
  getPlayerMarketAccount() {
    return this._get('playerMarketAccount', null);
  }

  savePlayerMarketAccount(v) {
    this._save('playerMarketAccount', v);
  }

  getPlayerMarketData() {
    return this._get(
      'playerMarketData',
      {
        version: 1,
        updatedAt: null,
        players: {}
      }
    );
  }

  savePlayerMarketData(v) {
    this._save('playerMarketData', v);
  }
  saveTradeAccount(v) { this._save('tradeAccount', v); }
  getTradingRows() { return this._get('tradingRows', []); }
  saveTradingRows(v) { this._save('tradingRows', v); }
  getCards() { return this._get('cards', { version: 1, updatedAt: null, players: {} }); }
  saveCards(v) { this._save('cards', v); }
  getCardRoles() { return this._get('cardRoles', []); }
  saveCardRoles(v) { this._save('cardRoles', v); }
  getCardMetadata() { return this._get('cardMetadata', { version: 1, players: {}, trackedTeams: [] }); }
  saveCardMetadata(v) { this._save('cardMetadata', v); }
  getAutoTrade() { return this._get('autoTrade', { version: 1, runtime: null, lastRun: null }); }
  saveAutoTrade(v) { this._save('autoTrade', v); }
  getDailyRewards() { return this._get('dailyRewards', { version: 1, accounts: {} }); }
  saveDailyRewards(v) { this._save('dailyRewards', v); }
}

module.exports = { AppStore, ensureDir, readJson, writeJsonAtomic, DEFAULT_PRESETS };
