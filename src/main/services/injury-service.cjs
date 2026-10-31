// NBA injuries from ESPN's public API (the data of espn.com/nba/injuries, user 2026-10-30):
//   site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries
//   -> injuries[{ displayName (team), injuries[{ status 'Out' | 'Day-To-Day', date,
//      athlete{displayName, team{abbreviation}}, details{type, detail, side, returnDate} }] }]
// Read when the app starts and every day at 11:00 TR (with the player values). Players are
// matched by name (the game's team can be wrong); the page shows a red + (Out) or an orange
// one (Day-To-Day, or back within a few days), the return date on hover.
const URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
const UPDATE_UTC_HOUR = 8;          // 11:00 TR
const SOON_DAYS = 3;                // back within 3 days → orange like Day-To-Day

function normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.']/g, '').trim().replace(/(\s+(jr|sr|ii|iii|iv|v))+$/, '').replace(/[^a-z]/g, '');
}

function nextRunAt(now) {
  const d = new Date(now);
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), UPDATE_UTC_HOUR, 1);
  return at > now ? at : at + 86400000;
}

// ESPN reply -> { normName: { name, team, status, returnDate, type, detail, date, level } }
function parseInjuries(reply, now = Date.now()) {
  const out = {};
  for (const team of reply?.injuries || []) {
    for (const i of team.injuries || []) {
      const name = i.athlete?.displayName;
      if (!name) continue;
      const returnDate = i.details?.returnDate || null;
      const days = returnDate ? (Date.parse(returnDate) - now) / 86400000 : null;
      const dayToDay = /day/i.test(i.status || '');
      out[normName(name)] = {
        name, team: i.athlete?.team?.abbreviation || null, status: i.status || null, returnDate,
        type: [i.details?.side, i.details?.type, i.details?.detail].filter(Boolean).join(' ') || null,
        date: i.date || null,
        // like espn.com: Out red, Day-To-Day orange; an Out that ends within SOON_DAYS too
        level: dayToDay || (days != null && days <= SOON_DAYS) ? 'soon' : 'out'
      };
    }
  }
  return out;
}

class InjuryService {
  constructor({ store, activity, onChanged, fetchJson = null, now = () => Date.now() }) {
    Object.assign(this, { store, activity, now });
    this.revision = 0;
    this.onChanged = () => { this.revision++; onChanged?.(); };
    this.fetchJson = fetchJson || (async url => { const r = await fetch(url, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(`ESPN ${r.status}`); return r.json(); });
    this.timer = null;
  }

  snapshot() { return this.store.getInjuries?.() || { fetchedAt: null, players: {} }; }

  async refresh() {
    try {
      const players = parseInjuries(await this.fetchJson(URL), this.now());
      this.store.saveInjuries?.({ fetchedAt: new Date(this.now()).toISOString(), players });
      this.onChanged();
    } catch (error) {
      this.activity?.add({ level: 'warning', accountId: null, accountName: '', taskName: 'Injuries', code: 'inj.failed', params: { error: error.message }, message: `NBA injury list could not be read: ${error.message}` });
    }
    return this.snapshot();
  }

  // at start (when the saved list is from before the last 11:00), then every day at 11:00 TR
  start() {
    const saved = this.snapshot();
    const lastRun = nextRunAt(this.now()) - 86400000;
    if (!saved.fetchedAt || Date.parse(saved.fetchedAt) < lastRun) this.refresh();
    const plan = () => {
      this.timer = setTimeout(async () => { await this.refresh(); plan(); }, Math.max(60000, nextRunAt(this.now()) - this.now()));
      this.timer.unref?.();
    };
    plan();
  }

  stop() { clearTimeout(this.timer); this.timer = null; }
}

module.exports = { InjuryService, parseInjuries, normName, nextRunAt };
