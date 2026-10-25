function normalizeNumber(value) {
  if (value == null) return null;
  const digits = String(value).replace(/[^0-9-]/g, '');
  if (!digits || digits === '-') return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function normalizeLevel(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

function readStadiumTelemetry() {
  const text = el => (el?.textContent || '').trim();
  const numberFrom = value => {
    const digits = String(value || '').replace(/[^0-9-]/g, '');
    if (!digits || digits === '-') return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  };

  const exactText = wanted => [...document.querySelectorAll('span,div')].find(el => text(el) === wanted);
  const metricByImageAlt = (alt, label) => {
    const img = document.querySelector(`img[alt="${alt}"]`);
    if (!img) return null;
    let node = img.parentElement;
    for (let i = 0; node && i < 6; i++, node = node.parentElement) {
      const t = text(node);
      if (label && !t.toLowerCase().includes(label.toLowerCase())) continue;
      const spans = [...node.querySelectorAll('span')].map(text).filter(Boolean);
      const numeric = spans.find(v => /^[-+]?\d[\d.,]*$/.test(v));
      if (numeric != null) return numberFrom(numeric);
    }
    return null;
  };

  let level = null;
  let expCurrent = null;
  let expMax = null;
  let expPercent = null;
  const experience = exactText('Experience');
  if (experience) {
    let root = experience.parentElement;
    for (let i = 0; root && i < 6; i++, root = root.parentElement) {
      // Level and EXP are separate values. Prefer the dedicated "Lv.xx" node so the
      // first number in "61127 / 72311" can never be mistaken for the level.
      const levelText = [...root.querySelectorAll('span,div')]
        .map(text)
        .find(v => /^Lv\.?\s*\d{1,3}$/i.test(v));
      if (levelText) {
        const lv = levelText.match(/^Lv\.?\s*(\d{1,3})$/i);
        const parsed = lv ? Number(lv[1]) : null;
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) level = parsed;
      }

      const t = text(root);
      const xp = t.match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/);
      if (xp) {
        expCurrent = numberFrom(xp[1]);
        expMax = numberFrom(xp[2]);
      }
      const pct = t.match(/(\d{1,3})\s*%/);
      if (pct) expPercent = Number(pct[1]);
      if (level != null && expCurrent != null && expMax != null) break;
    }
  }

  // The current Stadium header has no "Experience" label: the team name,
  // "Lv.37", "88107 / 136551" and "65%" sit in separate elements whose
  // parent text runs together ("Trophy2Lv.3788107 / 13655165%"), so read the
  // exact elements instead of searching the joined text.
  if (level == null || expCurrent == null) {
    const lvNode = [...document.querySelectorAll('span,div')].find(n => /^Lv\.?\s*\d{1,3}$/i.test(text(n)));
    const parsed = lvNode ? Number(text(lvNode).match(/(\d{1,3})$/)[1]) : null;
    if (level == null && Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) level = parsed;
    let root = lvNode?.parentElement;
    for (let i = 0; root && i < 4 && expCurrent == null; i++, root = root.parentElement) {
      const parts = [...root.querySelectorAll('span,div')].map(text);
      const xp = parts.find(v => /^\d[\d.,]*\s*\/\s*\d[\d.,]*$/.test(v));
      if (xp) {
        const [cur, max] = xp.split('/');
        expCurrent = numberFrom(cur);
        expMax = numberFrom(max);
        const pct = parts.find(v => /^\d{1,3}\s*%$/.test(v));
        if (pct) expPercent = Number(pct.replace('%', ''));
      }
    }
  }

  let teamName = null;
  const teamLabel = exactText('Team Name');
  if (teamLabel) {
    let root = teamLabel.parentElement;
    for (let i = 0; root && i < 4; i++, root = root.parentElement) {
      const spans = [...root.querySelectorAll('span')].map(text).filter(Boolean);
      const candidate = spans.find(v => v !== 'Team Name' && v !== 'Experience' && !/^Lv\./i.test(v));
      if (candidate) { teamName = candidate; break; }
    }
  }

  // IMPORTANT: Auto PK is read-only here. The button/toggle is never clicked.
  const apkLabel = [...document.querySelectorAll('span')].find(el => text(el) === 'Auto PK');
  const apkWidget = apkLabel?.parentElement?.parentElement;
  const apkImg = apkWidget?.querySelector('img[alt="Auto PK Tickets"], img[src*="/ui/autopk.webp"]');
  let apk = null;
  if (apkImg?.parentElement) {
    const values = [...apkImg.parentElement.querySelectorAll('span')].map(text).filter(v => /^\d[\d.,]*$/.test(v));
    // Positive APK renders a number beside the image.
    apk = values.length ? numberFrom(values[0]) : 0;
  } else if (apkWidget) {
    // In the game's zero-APK markup both the image and its numeric badge are
    // absent, while the Auto PK label and toggle remain. The toggle is read-only.
    apk = 0;
  }

  return {
    teamName,
    level,
    expCurrent,
    expMax,
    expPercent,
    tk: metricByImageAlt('Funds', 'Funds'),
    tix: metricByImageAlt('Ticket', 'Tickets'),
    salary: metricByImageAlt('Used Salary', 'Salary'),
    salaryCap: metricByImageAlt('Salary Cap', 'Salary Cap'),
    teamValue: metricByImageAlt('Value', 'Value'),
    apk,
    stadiumReady: Boolean(document.querySelector('img[alt="Agent"], img[src*="/stadium/scout.webp"]'))
  };
}

// The game page receives `userBasicInfo` on its main socket right before it
// renders the Stadium numbers (autoPKTickets = APK, ticket = TIX).
function parseUserBasicInfo(payload) {
  if (typeof payload !== 'string' || !payload.startsWith('42["userBasicInfo"')) return null;
  try {
    const data = JSON.parse(payload.slice(2))[1];
    const apk = Number(data?.autoPKTickets);
    const tix = Number(data?.ticket);
    const level = Number(data?.level);
    if (!data?.success || !Number.isFinite(apk)) return null;
    const expCurrent = Number(data?.experience);
    const expMax = Number(data?.nextLvl);
    return {
      apk, tix: Number.isFinite(tix) ? tix : null,
      level: Number.isInteger(level) && level >= 1 && level <= 100 ? level : null,
      // Stadium shows "experience / nextLvl" and the percentage of the two.
      expCurrent: Number.isFinite(expCurrent) ? expCurrent : null,
      expMax: Number.isFinite(expMax) && expMax > 0 ? expMax : null
    };
  } catch {
    return null;
  }
}

// APK / TIX of a side account if it were all moved to the main account (user rule
// 2026-10-25, TIX the same): a 5% cut rounded up to a whole number, at least 3. The main
// account keeps its balance as it is.
const APK_CUT_RATE = 5;   // percent
const APK_CUT_MIN = 3;
function usableApk(value, isMain) {
  const amount = Math.max(0, Number(value || 0));
  if (isMain) return amount;
  const cut = Math.max(APK_CUT_MIN, Math.ceil((amount * APK_CUT_RATE) / 100 - 1e-9));
  return Math.max(0, amount - cut);
}

// Returning to Stadium renders the Auto PK label before its number, so the
// widget briefly reads as zero. A DOM value is stored only once it matches a
// userBasicInfo the page received during this capture, or stays unchanged
// for stableMs (and agrees with the last known userBasicInfo, if any).
const BASIC_INFO_FRESH_MS = 3000;
const UNVERIFIED_LOG_INTERVAL_MS = 60000;

class AccountProfileService {
  constructor({ store, onChanged, activity = null }) {
    this.store = store;
    this.onChanged = onChanged;
    this.activity = activity;
    this.basicInfoFor = null;
    this.unverifiedLoggedAt = new Map();
  }

  _log(accountId, level, message, code = null, params = null) {
    if (!this.activity) return;
    const account = this.store.getAccounts().find(a => a.id === accountId);
    this.activity.add({ level, accountId, accountName: account?.name || '', taskName: 'Stadium', message, code, params });
  }

  setBasicInfoSource(fn) {
    this.basicInfoFor = typeof fn === 'function' ? fn : null;
  }

  _state() {
    const raw = this.store.getAccountProfile();
    const accounts = raw?.accounts && typeof raw.accounts === 'object' ? raw.accounts : {};
    const sanitizedAccounts = {};
    for (const [accountId, stats] of Object.entries(accounts)) {
      sanitizedAccounts[accountId] = {
        ...(stats || {}),
        level: normalizeLevel(stats?.level)
      };
    }
    return {
      version: 1,
      mainAccountId: raw?.mainAccountId || null,
      accounts: sanitizedAccounts
    };
  }

  snapshot() {
    const state = this._state();
    const accounts = this.store.getAccounts();
    const validIds = new Set(accounts.map(a => a.id));
    const mainAccountId = validIds.has(state.mainAccountId) ? state.mainAccountId : null;
    let totalUsableApk = mainAccountId ? 0 : null;
    let totalUsableTix = mainAccountId ? 0 : null;
    const effectiveApk = {};
    const effectiveTix = {};

    for (const account of accounts) {
      const stats = state.accounts?.[account.id];
      const isMain = account.id === mainAccountId;
      effectiveApk[account.id] = usableApk(stats?.apk, isMain);
      effectiveTix[account.id] = usableApk(stats?.tix, isMain);
      if (totalUsableApk != null) totalUsableApk += effectiveApk[account.id];
      if (totalUsableTix != null) totalUsableTix += effectiveTix[account.id];
    }

    return {
      ...state, mainAccountId, effectiveApk, effectiveTix,
      totalUsableApk: totalUsableApk == null ? null : Math.floor(totalUsableApk),
      totalUsableTix: totalUsableTix == null ? null : Math.floor(totalUsableTix)
    };
  }

  setMainAccount(accountId) {
    const accounts = this.store.getAccounts();
    if (accountId && !accounts.some(a => a.id === accountId)) throw new Error('Account not found.');
    const state = this._state();
    state.mainAccountId = accountId || null;
    this.store.saveAccountProfile(state);
    this.onChanged?.();
    return this.snapshot();
  }

  removeAccount(accountId) {
    const state = this._state();
    if (state.mainAccountId === accountId) state.mainAccountId = null;
    if (state.accounts?.[accountId]) delete state.accounts[accountId];
    this.store.saveAccountProfile(state);
    this.onChanged?.();
  }

  merge(accountId, patch) {
    if (!accountId) return null;
    if (!this.store.getAccounts().some(a => a.id === accountId)) return null;
    const state = this._state();
    const old = { ...(state.accounts[accountId] || {}) };
    old.level = normalizeLevel(old.level);
    const clean = {};
    for (const [key, value] of Object.entries(patch || {})) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'level') {
        const validLevel = normalizeLevel(value);
        if (validLevel != null) clean.level = validLevel;
        continue;
      }
      clean[key] = value;
    }
    // The Stadium observer also reports unchanged values. Avoid a JSON write
    // and full UI update when only the observation time would be different.
    if (Object.keys(clean).every(key => Object.is(old[key], clean[key]))) return state.accounts[accountId] || old;
    state.accounts[accountId] = { ...old, ...clean, updatedAt: new Date().toISOString() };
    this.store.saveAccountProfile(state);
    this.onChanged?.();
    return state.accounts[accountId];
  }

  // Returns the stored stats, or null when no trustworthy value was seen in
  // time; the stored APK/TIX are then left untouched.
  async captureStadium(accountId, page, { timeoutMs = 8000, stableMs = 3000 } = {}) {
    if (!accountId || !page) return null;
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    let stableKey = null;
    let stableFrom = 0;
    let lastSeen = null;
    for (;;) {
      const data = await page.evaluate(readStadiumTelemetry).catch(() => null);
      // No Auto PK label means this may still be loading or a different page.
      if (data?.stadiumReady && data.apk != null) {
        lastSeen = data;
        const key = `${data.apk}|${data.tix}`;
        if (key !== stableKey) { stableKey = key; stableFrom = Date.now(); }
        const info = this.basicInfoFor?.(page) || null;
        const matches = Boolean(info) && data.apk === info.apk && (info.tix == null || data.tix === info.tix);
        const fresh = Boolean(info) && info.at >= startedAt - BASIC_INFO_FRESH_MS;
        const stable = Date.now() - stableFrom >= stableMs;
        if ((fresh && matches) || (stable && (!info || matches))) {
          const { stadiumReady, ...profile } = data;
          // The Stadium "Lv" text no longer reads; the game's own message has it.
          if (profile.level == null && info?.level != null) profile.level = info.level;
          if (profile.expCurrent == null && info?.expCurrent != null && info.expMax) {
            profile.expCurrent = info.expCurrent;
            profile.expMax = info.expMax;
            profile.expPercent = Math.floor((info.expCurrent / info.expMax) * 100);
          }
          const before = this._state().accounts[accountId] || {};
          const saved = this.merge(accountId, profile);
          this._logBalanceChange(accountId, before, saved, fresh && matches ? 'confirmed by the game' : 'stable on screen');
          return saved;
        }
      }
      if (Date.now() >= deadline) {
        this._logUnverified(accountId, lastSeen);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  _logBalanceChange(accountId, before, after, how) {
    if (!after) return;
    const changes = [['APK', 'apk'], ['TIX', 'tix'], ['TK', 'tk'], ['LV', 'level']]
      .filter(([, key]) => after[key] != null && !Object.is(before[key], after[key]))
      .map(([label, key]) => `${label} ${before[key] ?? '—'} → ${after[key]}`);
    if (changes.length) this._log(accountId, 'info', `Stadium balance updated (${how}) · ${changes.join(' · ')}.`, 'st.updated', { changes: changes.join(' · ') });
  }

  _logUnverified(accountId, seen) {
    const now = Date.now();
    if (now - (this.unverifiedLoggedAt.get(accountId) || 0) < UNVERIFIED_LOG_INTERVAL_MS) return;
    this.unverifiedLoggedAt.set(accountId, now);
    const stored = this._state().accounts[accountId] || {};
    const shown = seen ? `screen showed APK ${seen.apk} · TIX ${seen.tix ?? '—'}` : 'Stadium numbers were not visible';
    this._log(accountId, 'warning', `Stadium APK/TIX could not be confirmed (${shown}) · kept APK ${stored.apk ?? '—'} · TIX ${stored.tix ?? '—'}.`, 'st.unverified', { apk: stored.apk ?? '—', tix: stored.tix ?? '—' });
  }

  updateFromScout(accountId, scoutData) {
    if (!scoutData) return null;
    return this.merge(accountId, {
      tk: normalizeNumber(scoutData.funds),
      roster: Number.isFinite(Number(scoutData.roster)) ? Number(scoutData.roster) : null,
      rosterMax: Number.isFinite(Number(scoutData.rosterMax)) ? Number(scoutData.rosterMax) : null,
      salarySpace: normalizeNumber(scoutData.salarySpace)
    });
  }
}

module.exports = { AccountProfileService, readStadiumTelemetry, parseUserBasicInfo, usableApk, normalizeNumber, normalizeLevel };
