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

  // Fallback for minor Stadium markup changes. Still only accept the explicit Lv label.
  if (level == null) {
    const bodyText = text(document.body);
    const lv = bodyText.match(/\bLv\.?\s*(\d{1,3})\b/i);
    const parsed = lv ? Number(lv[1]) : null;
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) level = parsed;
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

class AccountProfileService {
  constructor({ store, onChanged }) {
    this.store = store;
    this.onChanged = onChanged;
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
    const effectiveApk = {};

    for (const account of accounts) {
      const apk = Math.max(0, Number(state.accounts?.[account.id]?.apk || 0));
      let effective = 0;
      if (account.id === mainAccountId) effective = apk;
      else if (apk < 20) effective = 0;
      else if (apk < 50) effective = apk;
      else effective = apk * 0.97;
      effectiveApk[account.id] = effective;
      if (totalUsableApk != null) totalUsableApk += effective;
    }

    return { ...state, mainAccountId, effectiveApk, totalUsableApk: totalUsableApk == null ? null : Math.floor(totalUsableApk) };
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

  async captureStadium(accountId, page, { apkTimeoutMs = 3000 } = {}) {
    if (!accountId || !page) return null;
    let data = null;
    const deadline = Date.now() + apkTimeoutMs;
    for (let attempt = 0; ; attempt++) {
      data = await page.evaluate(readStadiumTelemetry).catch(() => null);
      if (data?.apk != null) break;
      if (!data?.stadiumReady && attempt >= 3) break;
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!data) return null;
    const { stadiumReady, ...profile } = data;
    // No Auto PK label means this may still be loading or a different page.
    return this.merge(accountId, profile);
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

module.exports = { AccountProfileService, readStadiumTelemetry, normalizeNumber, normalizeLevel };
