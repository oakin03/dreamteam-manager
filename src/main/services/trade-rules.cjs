// Pure Auto Trade rules: which way a player goes, which bench players may be
// touched, and what one trade can carry. No I/O here, so every rule is tested.
const ROSTER_MAX = 11;     // 5 starters + 6 bench on every account
const TRADE_MAX = 5;       // players one side can give in a single trade
const PRICE_RULE_MIN = 50; // Scout never shows players under 50, so a lower limit means "roles only"

// playerId -> roleIds from the Cards page (roles are stored under "id:<playerId>").
function roleMapFrom(cardMetadata) {
  const map = new Map();
  for (const [key, value] of Object.entries(cardMetadata?.players || {})) {
    if (key.startsWith('id:') && Array.isArray(value?.roleIds) && value.roleIds.length) map.set(key.slice(3), value.roleIds);
  }
  return map;
}

function normalizeConfig(raw = {}) {
  const price = Math.floor(Number(raw.maxPrice));
  return {
    sideToMainRoleIds: Array.isArray(raw.sideToMainRoleIds) ? raw.sideToMainRoleIds : ['card'],
    mainToSideRoleIds: Array.isArray(raw.mainToSideRoleIds) ? raw.mainToSideRoleIds : ['sellable'],
    maxPrice: Number.isFinite(price) ? Math.min(2500, Math.max(0, price)) : 100
  };
}

// Players on a team in the Cards system (No Team / unknown players excluded). A team
// the user gave a player on the Cards page counts; "NONE" takes it out of its team.
function teamPlayersFrom(cards, cardMetadata = null) {
  const set = new Set();
  for (const p of Object.values(cards?.players || {})) {
    if (!p?.playerId) continue;
    const custom = cardMetadata?.players?.['id:' + p.playerId]?.customTeam;
    const team = custom === 'NONE' ? null : custom || (!p.noTeam && !p.x && p.team && p.team !== 'No Team' ? p.team : null);
    if (team) set.add(p.playerId);
  }
  return set;
}

// Base by the salary actually signed (Lv30+ accounts can get a 5% discount, so a
// 50 TK player may sign at 48). Unknown before signing. Base is recomputed daily and
// discounted signings pull it ~5% down, so with `projected` the comparison is against
// tomorrow's base (round(base × 0.95)): a 50 salary at base 50 is not Base, 48 is.
function nextBase(base) { return Math.round(Number(base) * 0.95); }
function salaryAtBase(player, { projected = false } = {}) {
  const salary = Number(player?.signedSalary);
  const base = Number(player?.newBaseSalary);
  if (player?.signedSalary == null || !Number.isFinite(salary) || !(base > 0)) return false;
  return salary <= (projected ? nextBase(base) : base);
}

// 'main' (goes to main and becomes a card), 'side' (goes to / stays on a side),
// or null (not ours to buy or move). With "base as sellable", a team player whose
// signed salary is at/below Base is sellable before anything else; then the price
// rule, then roles.
function classify(player, config, roleMap, teamPlayers = null) {
  const cfg = normalizeConfig(config);
  if (config?.baseAsSellable && teamPlayers?.has(player?.id || player?.playerId) && salaryAtBase(player, { projected: config.baseProjected !== false })) return 'side';
  const price = Number(player?.baseSalary);
  if (cfg.maxPrice >= PRICE_RULE_MIN && Number.isFinite(price) && price <= cfg.maxPrice) return 'main';
  const roles = roleMap.get(player?.id || player?.playerId) || [];
  if (roles.some(r => cfg.sideToMainRoleIds.includes(r))) return 'main';
  if (roles.some(r => cfg.mainToSideRoleIds.includes(r))) return 'side';
  return null;
}

// Why a roster player can never be traded, or null. Starters are never touched.
function tradeBlock(player) {
  if (player?.slot) return 'starter';
  if (player?.type === 'XPLAYER') return 'x';
  if (player?.isTemporary || player?.expiresAt || player?.duration) return 'temporary';
  if (Object.values(player?.equippedItems || {}).some(Boolean)) return 'equipped';
  return null;
}

function rosterOf(reply) {
  const starters = reply?.players?.starters || [];
  const bench = reply?.players?.bench || [];
  return { starters, bench, total: starters.length + bench.length, ids: new Set([...starters, ...bench].map(p => p.id)) };
}

const salaryOf = p => Number(p?.signedSalary ?? p?.baseSalary) || 0;

// One trade between main (guest) and a side (host). `mainGive` / `sideGive` are the
// candidates in priority order. Duplicates are left out (reported), each side gives
// at most 5, and neither roster may go over 11 after the trade.
function planTrade({ mainRoster, sideRoster, mainGive, sideGive, mainFunds = Infinity, sideFunds = Infinity }) {
  const dupToSide = mainGive.filter(p => sideRoster.ids.has(p.id));
  const dupToMain = sideGive.filter(p => mainRoster.ids.has(p.id));
  let mg = mainGive.filter(p => !sideRoster.ids.has(p.id)).slice(0, TRADE_MAX);
  let sg = sideGive.filter(p => !mainRoster.ids.has(p.id)).slice(0, TRADE_MAX);
  for (let guard = 0; guard < 20; guard++) {
    const mainAfter = mainRoster.total - mg.length + sg.length;
    const sideAfter = sideRoster.total - sg.length + mg.length;
    if (mainAfter > ROSTER_MAX && sg.length) { sg = sg.slice(0, sg.length - (mainAfter - ROSTER_MAX)); continue; }
    if (sideAfter > ROSTER_MAX && mg.length) { mg = mg.slice(0, mg.length - (sideAfter - ROSTER_MAX)); continue; }
    break;
  }
  // Positive: main pays the side; negative: the side pays main.
  const tk = sg.reduce((n, p) => n + salaryOf(p), 0) - mg.reduce((n, p) => n + salaryOf(p), 0);
  return {
    mainGives: mg,
    sideGives: sg,
    dupToSide,
    dupToMain,
    tk,
    mainCanPay: tk <= 0 || mainFunds >= tk,
    sideCanPay: tk >= 0 || sideFunds >= -tk,
    empty: !mg.length && !sg.length
  };
}

// Side accounts in the order they are opened: highest TK first.
function sideOrder(sides) {
  return [...sides].sort((a, b) => (Number(b.funds) || 0) - (Number(a.funds) || 0));
}

// tradeResult messages of the game.
function tradeFailure(message) {
  const m = String(message || '');
  if (/guest would end up with duplicate/i.test(m)) return 'dupToGuest';
  if (/host would end up with duplicate/i.test(m)) return 'dupToHost';
  if (/equipped items/i.test(m)) return 'equipped';
  if (/max player limit/i.test(m)) return 'rosterFull';
  if (/fund|insufficient|enough/i.test(m)) return 'funds';
  return 'other';
}

module.exports = { ROSTER_MAX, TRADE_MAX, PRICE_RULE_MIN, roleMapFrom, teamPlayersFrom, salaryAtBase, nextBase, normalizeConfig, classify, tradeBlock, rosterOf, salaryOf, planTrade, sideOrder, tradeFailure };
