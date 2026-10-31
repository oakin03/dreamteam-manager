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
// 'ask' (roles both ways: the user decides after the signing) or null (not ours). With "base as sellable", a team player whose
// signed salary is at/below Base is sellable before anything else; then the price
// rule, then roles.
function classify(player, config, roleMap, teamPlayers = null) {
  const cfg = normalizeConfig(config);
  if (config?.baseAsSellable && teamPlayers?.has(player?.id || player?.playerId) && salaryAtBase(player, { projected: config.baseProjected !== false })) return 'side';
  const roles = roleMap.get(player?.id || player?.playerId) || [];
  const toMain = roles.some(r => cfg.sideToMainRoleIds.includes(r));
  const toSide = roles.some(r => cfg.mainToSideRoleIds.includes(r));
  // roles both ways (e.g. Satılabilir + Kart): the user decides (user 2026-10-30)
  if (toMain && toSide) return 'ask';
  const price = Number(player?.baseSalary);
  if (cfg.maxPrice >= PRICE_RULE_MIN && Number.isFinite(price) && price <= cfg.maxPrice) return 'main';
  if (toMain) return 'main';
  if (toSide) return 'side';
  return null;
}

// Why classify() sends a player where it does: 'base' | 'ask' | 'price' | 'card' | 'sellable'
// or null (the same order as classify).
function signReason(player, config, roleMap, teamPlayers = null) {
  const cfg = normalizeConfig(config);
  if (config?.baseAsSellable && teamPlayers?.has(player?.id || player?.playerId) && salaryAtBase(player, { projected: config.baseProjected !== false })) return 'base';
  const roles = roleMap.get(player?.id || player?.playerId) || [];
  const toMain = roles.some(r => cfg.sideToMainRoleIds.includes(r));
  const toSide = roles.some(r => cfg.mainToSideRoleIds.includes(r));
  if (toMain && toSide) return 'ask';
  const price = Number(player?.baseSalary);
  if (cfg.maxPrice >= PRICE_RULE_MIN && Number.isFinite(price) && price <= cfg.maxPrice) return 'price';
  if (toMain) return 'card';
  if (toSide) return 'sellable';
  return null;
}

// What a side of an account role may sign (user 2026-10-31: some accounts never take
// Satılabilir players, some no Kart players, some only the players under the price).
// `rule` = { roles: { <player role id>: false, … }, cheap, maxPrice } — every player role of
// the Cards page (Satılabilir, Kart, Stok, the user's own) can be turned off; a missing rule
// or role allows it. Rules saved before per-role columns ({ sellable, card }) still work.
function normalizeRoleRules(raw) {
  const out = {};
  for (const [roleId, r] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const price = Math.floor(Number(r?.maxPrice));
    const roles = {};
    for (const [id, on] of Object.entries(r?.roles && typeof r.roles === 'object' ? r.roles : {})) roles[id] = on !== false;
    out[roleId] = {
      roles, cheap: r?.cheap !== false,
      ...(r?.sellable === false ? { sellable: false } : {}), ...(r?.card === false ? { card: false } : {}),
      maxPrice: r?.maxPrice === '' || r?.maxPrice == null || !Number.isFinite(price) ? null : Math.min(2500, Math.max(0, price))
    };
  }
  return out;
}
// Is one player role allowed by the rule? Its own column first, then the old flags.
function roleAllowed(rule, roleId, cfg) {
  if (rule.roles && roleId in rule.roles) return rule.roles[roleId] !== false;
  if (cfg.sideToMainRoleIds.includes(roleId) && rule.card === false) return false;
  if (cfg.mainToSideRoleIds.includes(roleId) && rule.sellable === false) return false;
  return true;
}
// `player` + `roleMap` + `config` tell which of its roles routed it; the player is signed
// when one of those roles is allowed (a cheap player: when "cheap" is on).
function accountAllows(rule, reason, player = null, roleMap = null, config = {}) {
  if (!reason) return false;
  if (!rule) return true;
  if (reason === 'price') return rule.cheap !== false;
  const cfg = normalizeConfig(config);
  const routing = [...cfg.sideToMainRoleIds, ...cfg.mainToSideRoleIds];
  const own = (roleMap?.get(player?.id || player?.playerId) || []).filter(r => routing.includes(r));
  if (reason === 'base') return cfg.mainToSideRoleIds.some(r => roleAllowed(rule, r, cfg));
  if (!own.length) {
    // legacy callers without the player: the old flags
    if (reason === 'sellable') return rule.sellable !== false;
    if (reason === 'card') return rule.card !== false;
    return rule.card !== false || rule.sellable !== false;
  }
  return own.some(r => roleAllowed(rule, r, cfg));
}
// The config one account signs with: its role's own price limit, if it has one.
function configFor(config, rule) {
  return rule && rule.maxPrice != null ? { ...config, maxPrice: rule.maxPrice } : config;
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

module.exports = { ROSTER_MAX, TRADE_MAX, PRICE_RULE_MIN, roleMapFrom, teamPlayersFrom, salaryAtBase, nextBase, normalizeConfig, classify, signReason, normalizeRoleRules, accountAllows, configFor, tradeBlock, rosterOf, salaryOf, planTrade, sideOrder, tradeFailure };
