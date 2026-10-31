const { GameSocket } = require('./game-socket.cjs');

// Player value prediction (user request 2026-10-26).
//
// What the game data shows (2026-10-26, all 640 players):
//   ranking = players sorted by offense + defense (exact);
//   value (salary) and rating letter depend only on the ranking (rank 1 = 2500, steps
//   30 / 20 / 10 / 5 / 3 down to 50) — the table is read from the current list;
//   offense / defense come from the per-game averages the game stores (last season's
//   until a team has played 5 games of the new season). The formula is not published:
//   it is fitted here by least squares on the game's own players (hand-set rookies fall
//   out as outliers) and fitted again after every value update of the game.
// Real stats: ESPN's public NBA API (cdn.nba.com refuses non-browser requests):
//   site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD
//   site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=<id>  (box score)
// After every finished game the prediction is computed again. When the game moves values
// (daily ~11:05 TR), the prediction made before is compared with what happened and the
// comparison is kept (shown on the page), and the formula is fitted again.
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const SEASON_FROM = '2026-10-15';         // regular season games are picked by season.type = 2
const POLL_MS = 30 * 60 * 1000;
const FEATURES = ['pts', 'reb', 'ast', 'stl', 'blk', 'to', 'pf'];
const GAME_FIELDS = { pts: 'averagePoints', reb: 'averageRebounds', ast: 'averageAssists', stl: 'averageSteals', blk: 'averageBlocks', to: 'averageTurnovers', pf: 'averageFoul' };
const ESPN_TEAM = { SA: 'SAS', NY: 'NYK', GS: 'GSW', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' };
const FIRST_UPDATE_GAMES = 5;
const MAX_COMPARISONS = 4000;
// 3: rows also keep OREB and the shots (FG, 3PT, FT made/attempted)
// 4: the prediction follows the game's update rule (5 own games, tier caps): older
// comparisons came from the first, wrong rule and are dropped
const DATA_VERSION = 4;

const round1 = v => Math.round(v * 10) / 10;
const round2 = v => Math.round(v * 100) / 100;
// f(averages): offense / defense from the game's per-game averages, fitted on the game's
// players before the first update of the 2026-27 season (last season's stats).
const BASE_FORMULA = {
  offense: [12.6434, 3.9182, 2.1288, 8.9043, 0.7177, 1.4644, -6.423, -0.8152],
  defense: [0.4255, 0.1084, 9.1874, -0.1811, 30.8482, 27.5199, 0.265, -0.3005]
};
// Largest offense / defense move per update by rating tier before the update. A+ and below:
// a fixed number (learned again at every update). The S tiers move by a share of the
// current offense / defense instead, at least 5 (all 70 capped S moves of the 2026-10-30
// and 10-31 updates fit exactly): S+ 3 %, S 4 %, S- 5 %.
const DEFAULT_CAPS = { 'S+': 7, S: 7, 'S-': 9, 'A+': 12, A: 14, 'A-': 16, 'B+': 18, B: 20, 'B-': 22, 'C+': 15, C: 16, 'C-': 18, 'D+': 20, D: 22, 'D-': 24 };
const SHARE_CAPS = { 'S+': 0.03, S: 0.04, 'S-': 0.05 };
const MIN_SHARE_CAP = 5;
const capFor = (caps, tier, current) => (SHARE_CAPS[tier] ? Math.max(MIN_SHARE_CAP, Math.round(current * SHARE_CAPS[tier])) : (caps[tier] ?? 10));
const MIN_SAMPLES = 40;
// The game moves values every day at 11:00 TR (08:00 UTC, user 2026-10-30). The games of an
// update: started after the previous 11:00 − 3 h and finished before 11:00 (start + 3 h).
const UPDATE_UTC_HOUR = 8;
const GAME_HOURS = 3;
function nextUpdateAt(now) {
  const d = new Date(now);
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), UPDATE_UTC_HOUR);
  return at > now ? at : at + 86400000;
}   // uncapped moves needed before the formula is fitted again
function normName(s) {
  // "Jimmy Butler III" = "Jimmy Butler", "V.J. Edgecombe" = "VJ Edgecombe": suffixes only at the end
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.']/g, '').trim().replace(/(\s+(jr|sr|ii|iii|iv|v))+$/, '').replace(/[^a-z]/g, '');
}
function ymd(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
function* days(fromIso, toDate) {
  for (let d = new Date(`${fromIso}T12:00:00Z`); d <= toDate; d = new Date(d.getTime() + 86400000)) yield new Date(d);
}

// Least squares (normal equations, partial pivoting). X rows start with 1 for the constant.
function lstsq(X, y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => Array(k).fill(0));
  const b = Array(k).fill(0);
  X.forEach((row, i) => { for (let a = 0; a < k; a++) { b[a] += row[a] * y[i]; for (let c = 0; c < k; c++) A[a][c] += row[a] * row[c]; } });
  for (let i = 0; i < k; i++) A[i][i] += 1e-6;
  for (let i = 0; i < k; i++) {
    let m = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < k; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  return b.map((v, i) => v / A[i][i]);
}
const dot = (w, x) => w[0] + FEATURES.reduce((s, f, i) => s + w[i + 1] * (Number(x?.[f]) || 0), 0);

// offense / defense = w · averages, fitted on the game's players; players far off the line
// (hand-set stats) are dropped and the fit repeated.
function fitModel(players) {
  const rows = players.filter(p => FEATURES.some(f => Number(p.avg[f]) > 0));
  if (rows.length < 30) return null;
  const out = { n: 0, trimmed: 0 };
  for (const target of ['offense', 'defense']) {
    let use = rows;
    let w = null;
    let mae = 0;
    for (let pass = 0; pass < 3; pass++) {
      w = lstsq(use.map(p => [1, ...FEATURES.map(f => Number(p.avg[f]) || 0)]), use.map(p => Number(p[target]) || 0));
      const err = rows.map(p => Math.abs(dot(w, p.avg) - (Number(p[target]) || 0)));
      mae = use.reduce((s, p) => s + Math.abs(dot(w, p.avg) - (Number(p[target]) || 0)), 0) / use.length;
      const cut = Math.max(6, mae * 2.5);
      const next = rows.filter((p, i) => err[i] <= cut);
      if (next.length === use.length) break;
      use = next;
    }
    out[target] = { w, mae: round1(mae), n: use.length };
    out.trimmed = Math.max(out.trimmed, rows.length - use.length);
  }
  out.n = rows.length;
  return out;
}

// rank -> value / rating, read from the current list (the game's own table).
function rankTables(players) {
  const byRank = players.filter(p => p.ranking).sort((a, b) => a.ranking - b.ranking);
  return { value: byRank.map(p => p.value), rating: byRank.map(p => p.rating) };
}
const tableAt = (arr, rank, fallback) => (rank >= 1 && rank <= arr.length ? arr[rank - 1] : arr.length ? arr[arr.length - 1] : fallback);

class ValuePredictService {
  constructor({ store, activity, onChanged, createSocket, fetchJson = null, injuries = null, now = () => Date.now() }) {
    Object.assign(this, { store, activity, createSocket, now, injuries });
    this.revision = 0;
    this.onChanged = () => { this.revision++; onChanged?.(); };
    this.fetchJson = fetchJson || (async url => { const r = await fetch(url, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(`ESPN ${r.status}`); return r.json(); });
    this.busy = false;
    this.timer = null;
    this.error = null;
    this.prediction = null;
  }

  _data() {
    const saved = this.store.getValuePredict?.() || {};
    const fresh = { version: DATA_VERSION, games: {}, logs: {}, espnPlayers: {}, scannedDays: {}, lastGame: null, model: null, window: 'season', comparisons: [], updates: [] };
    // version 2 keeps the games a player missed (0 minutes): older logs are read again
    if ((saved.version || 1) < DATA_VERSION) return { ...fresh, lastGameState: saved.lastGameState, lastPrediction: null };
    return { ...fresh, ...saved };
  }
  _save(d) { this.store.saveValuePredict?.(d); }
  _log(level, code, params, message) { this.activity?.add({ level, accountId: null, accountName: '', taskName: 'Value Prediction', code: `vp.${code}`, params, message }); }

  start() {
    const tick = async () => { await this.refresh({ automatic: true }).catch(() => {}); this.timer = setTimeout(tick, POLL_MS); this.timer.unref?.(); };
    this.timer = setTimeout(tick, 15000);
    this.timer.unref?.();
  }
  stop() { clearTimeout(this.timer); this.timer = null; }

  snapshot() {
    const d = this._data();
    return {
      busy: this.busy, error: this.error, checkedAt: d.checkedAt || null, lastGame: d.lastGame, games: Object.keys(d.games).length,
      model: this.prediction?.model || null, nextUpdateAt: this.prediction?.nextUpdateAt || null, window: this.prediction?.window || null, rule: this.prediction?.rule || 'team', teamGames: this.prediction?.teamGames || {}, rows: this.prediction?.rows || [], predictedAt: this.prediction?.at || null,
      comparisons: d.comparisons.slice(0, 1500), updates: d.updates.slice(0, 30), accuracy: this._accuracy(d)
    };
  }

  _accuracy(d) {
    const c = d.comparisons.filter(x => x.actual != null && x.predicted != null);
    if (!c.length) return null;
    const mae = c.reduce((s, x) => s + Math.abs(x.predicted - x.actual), 0) / c.length;
    const moved = c.filter(x => x.actual !== 0 || x.predicted !== 0);
    const dir = moved.filter(x => Math.sign(x.predicted) === Math.sign(x.actual)).length;
    const exact = c.filter(x => x.predicted === x.actual).length;
    return { n: c.length, mae: round1(mae), direction: moved.length ? Math.round(dir / moved.length * 100) : null, exact: Math.round(exact / c.length * 100) };
  }

  async refresh({ automatic = false } = {}) {
    if (this.busy) return this.snapshot();
    this.busy = true;
    this.error = null;
    this.onChanged();
    try {
      const d = this._data();
      // ESPN down: the game part (update check, prediction) still runs
      let newGames = 0;
      try { newGames = await this._scanEspn(d); } catch (error) { this.error = `ESPN: ${error.message}`; }
      const game = await this._readGame();
      this._detectUpdate(d, game);
      d.checkedAt = new Date(this.now()).toISOString();
      this._save(d);
      this.prediction = this._predict(d, game);
      if (newGames) this._log('info', 'games', { n: newGames, total: Object.keys(d.games).length }, `${newGames} new NBA game(s) read · prediction updated`);
    } catch (error) {
      this.error = error.message;
      if (!automatic) throw error;
    } finally {
      this.busy = false;
      this.onChanged();
    }
    return this.snapshot();
  }

  // ---------- ESPN ----------
  async _scanEspn(d) {
    const today = new Date(this.now());
    let added = 0;
    const upcoming = {};   // team -> { date, state } of a game not finished yet
    const noteUpcoming = ev => {
      const c = ev.competitions?.[0];
      for (const t of c?.competitors || []) {
        const team = ESPN_TEAM[t.team?.abbreviation] || t.team?.abbreviation;
        // the earliest game that is not finished yet
        if (team && (!upcoming[team] || ev.date < upcoming[team].date)) upcoming[team] = { date: ev.date, state: c?.status?.type?.state || 'pre' };
      }
    };
    // ESPN dates are US dates: tonight's games are on tomorrow's UTC date, so the scan runs
    // one day ahead (not finished games there only fill `upcoming`)
    for (const day of days(SEASON_FROM, new Date(today.getTime() + 86400000))) {
      const key = ymd(day);
      const ageDays = (today - day) / 86400000;
      if (d.scannedDays[key] === 'done' && ageDays > 2) continue;   // recent days are read again
      const sb = await this.fetchJson(`${ESPN}/scoreboard?dates=${key}`);
      let open = false;
      for (const ev of sb?.events || []) {
        if (Number(ev.season?.type) !== 2) continue;
        const done = ev.competitions?.[0]?.status?.type?.completed;
        if (!done) { open = true; noteUpcoming(ev); continue; }
        if (d.games[ev.id]) continue;
        const box = await this.fetchJson(`${ESPN}/summary?event=${ev.id}`);
        const parsed = this._parseBox(ev, box);
        if (!parsed) { open = true; continue; }
        d.games[ev.id] = { date: ev.date, teams: parsed.teams };
        for (const line of parsed.lines) {
          (d.logs[line.key] ||= []).push(line.row);
          d.espnPlayers[line.key] = { name: line.name, team: line.team };
        }
        d.lastGame = { id: ev.id, date: ev.date, teams: parsed.teams };
        added++;
      }
      d.scannedDays[key] = open ? 'open' : 'done';
    }
    d.upcoming = upcoming;
    return added;
  }

  _parseBox(ev, box) {
    const teams = [];
    const lines = [];
    for (const side of box?.boxscore?.players || []) {
      const team = ESPN_TEAM[side.team?.abbreviation] || side.team?.abbreviation;
      teams.push(team);
      const st = side.statistics?.[0];
      if (!st) continue;
      const at = name => st.names?.indexOf(name) ?? st.labels?.indexOf(name);
      const idx = { min: at('MIN'), pts: at('PTS'), fg: at('FG'), tp: at('3PT'), ft: at('FT'), reb: at('REB'), ast: at('AST'), to: at('TO'), stl: at('STL'), blk: at('BLK'), oreb: at('OREB'), dreb: at('DREB'), pf: at('PF') };
      for (const a of st.athletes || []) {
        // a player on the box score who did not play is kept with 0 minutes: the game
        // counts the missed games in his average
        const s = a.didNotPlay || !a.stats?.length ? [] : a.stats;
        const n = i => (i >= 0 && s.length ? Number(String(s[i]).split('-')[0]) || 0 : 0);
        const min = n(idx.min);
        // '7-15' -> [7, 15]
        const made = i => { const [m, a] = String(i >= 0 && s.length ? s[i] : '0-0').split('-').map(Number); return [m || 0, a || 0]; };
        const name = a.athlete?.displayName || '';
        lines.push({ key: `${team}|${normName(name)}`, name, team, row: [ev.date.slice(0, 10), ev.id, min, n(idx.pts), n(idx.reb), n(idx.ast), n(idx.stl), n(idx.blk), n(idx.to), n(idx.pf), n(idx.dreb), n(idx.oreb), ...made(idx.fg), ...made(idx.tp), ...made(idx.ft)] });
      }
    }
    return teams.length === 2 ? { teams, lines } : null;
  }

  // Averages of an ESPN log: the whole season or the last 5 games, per game the player
  // played (minutes > 0). The game's averages match this (2026-10-31, 164 players: ±0.49
  // points; per team game with missed games as 0 was further off, ±0.70).
  _avg(rows, window) {
    const played = rows.filter(r => r[2] > 0);
    const use = window === 'last5' ? played.slice(-5) : played;
    const games = use.length;
    if (!games) return null;
    const sum = i => use.reduce((s, r) => s + r[i], 0) / games;
    return { gp: games, games, min: round1(sum(2)), pts: round1(sum(3)), reb: round1(sum(4)), ast: round1(sum(5)), stl: round1(sum(6)), blk: round1(sum(7)), to: round1(sum(8)), pf: round1(sum(9)) };
  }

  // ESPN log of a game player: same team first, then the name alone (traded players).
  _logFor(d, p) {
    // the rows carry `team`: the ESPN team of his latest game
    const n = normName(p.name);
    const withTeam = (rows, team) => Object.assign(rows, { team });
    if (d.logs[`${p.team}|${n}`]) return withTeam(d.logs[`${p.team}|${n}`].slice(), p.team);
    const keys = Object.keys(d.logs).filter(k => k.endsWith(`|${n}`));
    if (!keys.length) return null;
    const latest = keys.slice().sort((a, b) => (d.logs[a].at(-1)[0] < d.logs[b].at(-1)[0] ? 1 : -1))[0];
    return withTeam(keys.flatMap(k => d.logs[k]).sort((a, b) => (a[0] < b[0] ? -1 : 1)), latest.split('|')[0]);
  }

  // ---------- game ----------
  async _readGame() {
    const gs = await GameSocket.open({ createSocket: this.createSocket });
    try {
      const list = await gs.call('getPlayerRankings', undefined, 'playerRankingsList', { timeoutMs: 30000 });
      const raw = Array.isArray(list) ? list : (list?.players || []);
      if (!raw.length) throw new Error('The game player list is empty.');
      return raw.map(p => ({
        id: p.id, name: p.visualName || p.name, team: p.teamAbbr || null, position: p.position, rating: p.rating, ranking: Number(p.ranking) || null,
        offense: Number(p.offense) || 0, defense: Number(p.defense) || 0, value: Number(p.baseSalary) || 0,
        avg: Object.fromEntries(FEATURES.map(f => [f, Number(p[GAME_FIELDS[f]]) || 0]))
      }));
    } finally { try { gs.close(); } catch {} }
  }



  // The game moved values: compare with the prediction made before, then learn the caps and
  // the formula again from the players it updated.
  _detectUpdate(d, game) {
    const prev = d.lastGameState;
    const state = Object.fromEntries(game.map(p => [p.id, [p.value, p.offense, p.defense, p.ranking, ...FEATURES.map(f => p.avg[f]), p.rating]]));
    d.lastGameState = state;
    if (!prev) return;
    const changed = game.filter(p => prev[p.id] && (prev[p.id][0] !== p.value || prev[p.id][1] !== p.offense || prev[p.id][2] !== p.defense));
    if (!changed.length) return;
    const at = new Date(this.now()).toISOString();
    d.lastUpdateAt = at;
    const before = d.lastPrediction || {};
    const rows = game.filter(p => prev[p.id]).map(p => {
      const was = prev[p.id][0];
      const pr = before[p.id];
      return { at, id: p.id, name: p.name, team: p.team, before: was, after: p.value, actual: p.value - was, predicted: pr ? pr.value - was : null, predictedValue: pr?.value ?? null, offense: [prev[p.id][1], p.offense, pr?.offense ?? null], defense: [prev[p.id][2], p.defense, pr?.defense ?? null] };
    }).filter(r => r.actual !== 0 || (r.predicted != null && r.predicted !== 0));
    d.comparisons = [...rows, ...d.comparisons].slice(0, MAX_COMPARISONS);
    // the players the game recomputed (their averages moved): learn the caps and the formula
    const updated = game.filter(p => prev[p.id] && FEATURES.some((f, i) => prev[p.id][4 + i] !== p.avg[f]) && (prev[p.id][1] !== p.offense || prev[p.id][2] !== p.defense));
    const caps = { ...DEFAULT_CAPS, ...(d.caps || {}) };
    const seen = {};
    for (const p of updated) {
      const tier = this._tierOf(prev, p);
      if (SHARE_CAPS[tier]) continue;   // share caps are not learned
      const move = Math.max(Math.abs(p.offense - prev[p.id][1]), Math.abs(p.defense - prev[p.id][2]));
      (seen[tier] ||= []).push(move);
    }
    // a tier's cap = the largest move seen there (needs 3 players)
    for (const [tier, moves] of Object.entries(seen)) if (moves.length >= 3) caps[tier] = Math.max(...moves);
    d.caps = caps;
    // moves below the cap landed on the formula's level: they teach the formula
    d.samples ||= { offense: [], defense: [] };
    for (const p of updated) {
      const tier = this._tierOf(prev, p);
      for (const [t, i] of [['offense', 1], ['defense', 2]]) if (Math.abs(p[t] - prev[p.id][i]) < capFor(caps, tier, prev[p.id][i])) d.samples[t].push([...FEATURES.map(f => p.avg[f]), p[t]]);
    }
    for (const t of ['offense', 'defense']) {
      d.samples[t] = d.samples[t].slice(-600);
      if (d.samples[t].length < MIN_SAMPLES) continue;
      const X = d.samples[t].map(r => [1, ...r.slice(0, FEATURES.length)]);
      const y = d.samples[t].map(r => r[FEATURES.length]);
      const w = lstsq(X, y);
      const errOf = ww => X.reduce((s2, x, k) => s2 + Math.abs(x.reduce((u, v, j) => u + v * ww[j], 0) - y[k]), 0) / X.length;
      const formula = d.formula?.[t] || BASE_FORMULA[t];
      if (errOf(w) < errOf(formula)) (d.formula ||= {})[t] = w;
    }
    const acc = this._accuracy({ comparisons: rows });
    d.updates = [{ at, changed: changed.length, updated: updated.length, mae: acc?.mae ?? null, direction: acc?.direction ?? null, exact: acc?.exact ?? null }, ...d.updates].slice(0, 100);
    this._log('success', 'gameUpdate', { n: changed.length, mae: acc?.mae ?? '—', direction: acc?.direction ?? '—' }, `The game moved ${changed.length} player value(s) · prediction error ${acc?.mae ?? '—'} TK · direction right ${acc?.direction ?? '—'}%`);
  }

  // ---------- prediction ----------
  // What the game does (learned from its 2026-10-29 update, 132 players; replayed: value
  // error ±4.5 TK, direction right 98%, offense / defense ±1.1):
  //   · a player is recomputed only when HE has played 5 games this season and played in a
  //     game of this update's window (checked again on 2026-10-31: this finds all 164
  //     recomputed players with 5 wrong; "the team's 5 games" marked 74 players wrongly),
  //   · his averages become this season's per game he played,
  //   · offense / defense move toward the formula's level f(averages), but by at most the
  //     cap of his rating tier per update (S+ 3 % … A 14 … D- 24): new = old + clamp(f − old),
  //   · the rank follows offense + defense, the value and the rating follow the rank.
  // the tier before the update (the cap belongs to it); older saved states have no rating
  _tierOf(prev, p) { return prev[p.id]?.[4 + FEATURES.length] || p.rating; }

  // The games of the next update: finished ones (with stats) and scheduled ones, per team,
  // and each team's game count at that moment.
  _window(d) {
    const at = nextUpdateAt(this.now());
    const from = at - 86400000 - GAME_HOURS * 3600000;
    const to = at - GAME_HOURS * 3600000;
    const teams = {};
    const teamGames = {};
    for (const [id, g] of Object.entries(d.games)) {
      const t = Date.parse(g.date);
      if (t <= to) for (const team of g.teams) teamGames[team] = (teamGames[team] || 0) + 1;
      if (t > from && t <= to) for (const team of g.teams) teams[team] = { id, date: g.date, state: 'final' };
    }
    for (const [team, u] of Object.entries(d.upcoming || {})) {
      const t = Date.parse(u.date);
      if (t > from && t <= to && !teams[team]) { teams[team] = { date: u.date, state: u.state || 'pre' }; teamGames[team] = (teamGames[team] || 0) + 1; }
    }
    return { at, teams, teamGames };
  }

  _predict(d, game) {
    const tables = rankTables(game);
    const caps = { ...DEFAULT_CAPS, ...(d.caps || {}) };
    // The 5-game rule is the player's own (the 2026-10-30 and 10-31 updates: all 200
    // recomputed players had played 5 games themselves and played in the window; the team
    // rule marked 97 players who did not move).
    const rule = 'player';
    const win = this._window(d);
    const winFrom = win.at - 86400000 - GAME_HOURS * 3600000;
    const injured = this.injuries?.()?.players || {};
    const formula = { offense: d.formula?.offense || BASE_FORMULA.offense, defense: d.formula?.defense || BASE_FORMULA.defense };
    const teamGames = {};
    for (const g of Object.values(d.games)) for (const t of g.teams) teamGames[t] = (teamGames[t] || 0) + 1;
    const rows = game.map(p => {
      const log = this._logFor(d, p);
      const gp = log ? log.filter(r => r[2] > 0).length : 0;
      // Recomputed at the next update: a player who plays in a game of its window (finished
      // before 11:00 TR) and has 5 games of his own by then. Everyone else moves only by rank.
      const espnTeam = (log && log.team) || p.team;
      const game = win.teams[espnTeam] || null;
      // A window game not played yet: "Out" on the ESPN injury list = he misses it.
      const injury = injured[normName(p.name)] || null;
      const missesNext = Boolean(game) && game.state !== 'final' && /^out$/i.test(injury?.status || '');
      const playedWindow = (log || []).some(r => r[2] > 0 && Date.parse(d.games[r[1]]?.date || 0) > winFrom);
      const playsWindow = playedWindow || (Boolean(game) && game.state !== 'final' && !missesNext);
      const gpAtUpdate = gp + (!playedWindow && playsWindow ? 1 : 0);
      const season = log && log.length ? this._avg(log, 'season') : null;
      const eligible = playsWindow && gpAtUpdate >= FIRST_UPDATE_GAMES && Boolean(season);
      const upcoming = game;
      // one update: toward the formula's level, at most the tier's cap
      const capOf = t => capFor(caps, p.rating, p[t]);
      const cap = capOf('offense');
      const step = t => { const target = dot(formula[t], season); const c = capOf(t); return Math.max(0, Math.round(p[t] + Math.max(-c, Math.min(c, target - p[t])))); };
      const next = season ? { offense: step('offense'), defense: step('defense') } : null;
      return {
        id: p.id, name: p.name, team: p.team, position: p.position, rating: p.rating, ranking: p.ranking, value: p.value, offense: p.offense, defense: p.defense,
        season, gp, eligible, upcoming, cap, missesNext, predOffense: eligible ? next.offense : p.offense, predDefense: eligible ? next.defense : p.defense, atFive: !eligible && gpAtUpdate < FIRST_UPDATE_GAMES ? next : null, teamGames: teamGames[espnTeam] || 0, gpAtUpdate
      };
    });
    const order = rows.slice().sort((x, y) => (y.predOffense + y.predDefense) - (x.predOffense + x.predDefense) || (x.ranking || 9999) - (y.ranking || 9999));
    order.forEach((r, i) => {
      r.predRank = i + 1;
      r.predValue = tableAt(tables.value, r.predRank, 50);
      r.predRating = tableAt(tables.rating, r.predRank, 'D-');
      r.change = r.predValue - r.value;
    });
    d.lastPrediction = Object.fromEntries(rows.map(r => [r.id, { value: r.predValue, offense: r.predOffense, defense: r.predDefense }]));
    this._save(d);
    return { at: new Date(this.now()).toISOString(), rows, teamGames, nextUpdateAt: new Date(win.at).toISOString(), window: { teams: win.teams, teamGames: win.teamGames }, rule, firstUpdateGames: FIRST_UPDATE_GAMES, model: { caps, learnedFormula: Boolean(d.formula), samples: { offense: d.samples?.offense?.length || 0, defense: d.samples?.defense?.length || 0 } } };
  }
}

module.exports = { ValuePredictService, fitModel, rankTables, normName, lstsq, capFor, FEATURES };
