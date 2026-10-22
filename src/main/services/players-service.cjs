const { GameSocket } = require('./game-socket.cjs');

// All game players (the City player list) over the socket, no login needed. The
// game moves values once a day at 11:05 TR; the list is fetched after that and a
// short history is kept so a rating letter change can be shown too.
const UPDATE_MINUTE_TR = 11 * 60 + 5;          // 11:05 Türkiye (UTC+3)
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;
const HISTORY_DAYS = 14;

// Start of the current value day: the last 11:05 TR at or before `now`.
function lastUpdateCutoff(now = Date.now()) {
  const tr = new Date(now + TR_OFFSET_MS);
  const cut = Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate(), 0, UPDATE_MINUTE_TR) - TR_OFFSET_MS;
  return cut <= now ? cut : cut - 24 * 60 * 60 * 1000;
}

const dayKey = cutoff => new Date(cutoff + TR_OFFSET_MS).toISOString().slice(0, 10);
const isBase = p => Number(p?.baseSalary) > 0 && Number(p?.newBaseSalary) > 0 && Number(p.baseSalary) <= Number(p.newBaseSalary);

function playerRow(p) {
  const value = Number(p.baseSalary) || 0;
  const previous = Number(p.lastSalary) || 0;
  return {
    id: p.id, name: p.visualName || p.name, team: p.teamAbbr || null, position: p.position, rating: p.rating,
    ranking: p.ranking, offense: p.offense, defense: p.defense, avatarUrl: p.avatarUrl, injured: Boolean(p.isInjured),
    value, base: Number(p.newBaseSalary) || 0, previous, change: previous ? value - previous : 0,
    isBase: isBase(p),
    stats: { pts: p.averagePoints, reb: p.averageRebounds, ast: p.averageAssists, stl: p.averageSteals, blk: p.averageBlocks }
  };
}

class PlayersService {
  constructor({ store, activity, onChanged, createSocket, now = () => Date.now() }) {
    this.store = store;
    this.activity = activity;
    this.createSocket = createSocket;
    this.now = now;
    this.revision = 0;
    this.onChanged = () => { this.revision++; onChanged?.(); };
    this.busy = false;
    this.timer = null;
    this.error = null;
  }

  _data() { return this.store.getPlayersData() || { fetchedAt: null, day: null, players: [], history: {} }; }

  // id -> { isBase, value, base, change } for other services (Auto Trade, Trading Hall, Scout).
  index() {
    const map = new Map();
    for (const p of this._data().players) map.set(p.id, p);
    return map;
  }

  snapshot() {
    const data = this._data();
    const days = Object.keys(data.history || {}).sort();
    const prevDay = days.filter(d => d < data.day).pop();
    const prev = prevDay ? data.history[prevDay] : null;
    // Roles and card status come from the Cards page records (same player ids).
    const meta = this.store.getCardMetadata?.()?.players || {};
    const cards = this.store.getCards?.()?.players || {};
    const players = data.players.map(p => {
      const old = prev?.[p.id];
      const card = cards[`id:${p.id}`];
      const m = meta[`id:${p.id}`] || {};
      return {
        ...p,
        ratingBefore: old && old.rating !== p.rating ? old.rating : null,
        roleIds: Array.isArray(m.roleIds) ? m.roleIds : [],
        card: card ? { stars: card.noTeam ? null : Number(card.stars || 0), cardCount: Number(card.cardCount || 0), noTeam: Boolean(card.noTeam), team: card.team || null, customTeam: m.customTeam || null } : null
      };
    });
    return { fetchedAt: data.fetchedAt, day: data.day, busy: this.busy, error: this.error, players, nextAt: new Date(this.nextFetchAt()).toISOString(), comparedDay: prevDay || null };
  }

  nextFetchAt() {
    const cut = lastUpdateCutoff(this.now());
    return this._data().day === dayKey(cut) ? cut + 24 * 60 * 60 * 1000 : this.now();
  }

  // Fetch now when today's 11:05 list is missing, then every day at 11:05 (+30 s).
  start() {
    const tick = async () => {
      if (this.now() >= this.nextFetchAt()) await this.refresh({ automatic: true }).catch(() => {});
      const wait = Math.max(60 * 1000, this.nextFetchAt() + 30 * 1000 - this.now());
      this.timer = setTimeout(tick, Math.min(wait, 60 * 60 * 1000));
      this.timer.unref?.();
    };
    tick();
  }

  stop() { clearTimeout(this.timer); this.timer = null; }

  async refresh({ automatic = false } = {}) {
    if (this.busy) return this.snapshot();
    this.busy = true;
    this.error = null;
    this.onChanged();
    let socket = null;
    try {
      socket = await GameSocket.open({ createSocket: this.createSocket });
      const list = await socket.call('getPlayerRankings', undefined, 'playerRankingsList', { timeoutMs: 30000 });
      if (!Array.isArray(list) || !list.length) throw new Error('The player list came back empty.');
      const players = list.map(playerRow);
      const cut = lastUpdateCutoff(this.now());
      const day = dayKey(cut);
      const data = this._data();
      const history = { ...(data.history || {}), [day]: Object.fromEntries(players.map(p => [p.id, { rating: p.rating, value: p.value }])) };
      for (const d of Object.keys(history).sort().slice(0, -HISTORY_DAYS)) delete history[d];
      this.store.savePlayersData({ fetchedAt: new Date(this.now()).toISOString(), day, players, history });
      const up = players.filter(p => p.change > 0).length;
      const down = players.filter(p => p.change < 0).length;
      const base = players.filter(p => p.isBase).length;
      this.activity.add({ level: 'success', code: automatic ? 'pl.autoFetched' : 'pl.fetched', params: { count: players.length, up, down, base }, message: `Player list updated · ${players.length} players · ${up} up · ${down} down · ${base} at base` });
      return this.snapshot();
    } catch (error) {
      this.error = error.message;
      this.activity.add({ level: 'error', code: 'pl.failed', params: { error: error.message }, message: `Player list could not be read: ${error.message}` });
      throw error;
    } finally {
      try { socket?.close(); } catch {}
      this.busy = false;
      this.onChanged();
    }
  }
}

module.exports = { PlayersService, playerRow, isBase, lastUpdateCutoff, dayKey };
