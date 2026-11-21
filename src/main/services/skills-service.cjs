const { GameSocket } = require('./game-socket.cjs');

// Player skills (Player → Team Players → Skills, game update 2026-11-05). /socket/, the replies come
// as events:
//   skills:getAvailableSkills {userId} -> skills:availableSkills {skills[{id, name, description, type, tier
//     PRIMARY|INTERMEDIATE|SUPERIOR, category}], userLevel}
//   skills:getUserContainers {userId} -> skills:userContainers {containers[{id, name, containerNumber,
//     skills[{slotNumber, isLocked (slot not open), isSkillLocked, skill}], userPlayer{playerId, player}}]}
//   skills:getShuffleStatus {userId} -> skills:shuffleStatus {remainingFreeShuffles (2 a day), nextShuffleCost}
//   skills:createContainer {userId, name} -> skills:containerCreated   ("Learn": 11 containers, level >= 30)
//   skills:shuffleContainer {containerId} -> skills:containerShuffled  (free 2/day; paid = tickets -> never)
//   skills:toggleSkillLock {containerId, slotNumber, locked} -> skills:skillLockToggled
//   skills:getAvailablePlayersForAssignment -> skills:availablePlayersForAssignment
//   skills:assignContainerToPlayer {userId, containerId, playerId} -> skills:containerAssigned
//   skills:unassignContainer {userId, playerId} -> skills:containerUnassigned
// The writes without a user id read the account from a registered socket: another service's
// one is borrowed, otherwise this one registers for the moment (an open game tab is signed out).
const TIMEOUT_MS = 12000;
const CONTAINERS = 11;

class SkillsService {
  constructor({ store, activity, sessions, createSocket, onChanged }) {
    Object.assign(this, { store, activity, sessions, createSocket });
    this.onChanged = onChanged || (() => {});
    this.views = {};
    this.busy = new Set();
  }
  _account(id) { return (this.store.getAccounts?.() || []).find(a => a.id === id) || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id, accountName: this._account(id)?.name || '', taskName: 'Skills', code: `sk.${code}`, params, message });
  }
  snapshot() { return { busy: [...this.busy] }; }

  async _with(id, fn) {
    const account = this._account(id);
    if (!account) throw new Error('Account not found.');
    if (this.busy.has(id)) throw new Error('This account is busy, try again in a moment.');
    this.busy.add(id);
    this.onChanged();
    let gs = null, own = false;
    try {
      const session = await this.sessions.get(account, { owner: 'skills' });
      gs = GameSocket.borrow?.(session.userId);
      if (!gs) {
        gs = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader });
        own = true;
        await gs.register(session.userId, { owner: 'Skills' });
      }
      return await fn(gs, session.userId);
    } finally {
      if (own) { try { gs.close(); } catch {} }
      this.busy.delete(id);
      this.onChanged();
    }
  }

  async _read(gs, userId) {
    const [skills, containers, shuffle] = [
      await gs.call('skills:getAvailableSkills', { userId }, 'skills:availableSkills', { timeoutMs: TIMEOUT_MS }),
      await gs.call('skills:getUserContainers', { userId }, 'skills:userContainers', { timeoutMs: TIMEOUT_MS }),
      await gs.call('skills:getShuffleStatus', { userId }, 'skills:shuffleStatus', { timeoutMs: TIMEOUT_MS })
    ];
    if (!containers?.success) throw new Error(containers?.message || containers?.error || 'Skills could not be read.');
    const level = Number(skills?.userLevel) || null;
    return {
      level,
      skills: (skills?.skills || []).map(s => ({ id: s.id, name: s.name, tier: s.tier, category: s.category, type: s.type, description: s.description })),
      containers: (containers.containers || []).sort((a, b) => a.containerNumber - b.containerNumber).map(c => ({
        id: c.id, number: c.containerNumber, name: c.name,
        player: c.userPlayer ? { playerId: c.userPlayer.playerId, name: c.userPlayer.player?.visualName || c.userPlayer.player?.name || '?', rating: c.userPlayer.player?.rating || null } : null,
        slots: (c.skills || []).sort((a, b) => a.slotNumber - b.slotNumber).map(s => ({ slot: s.slotNumber, open: !s.isLocked, locked: Boolean(s.isSkillLocked), skill: s.skill ? { id: s.skill.id, name: s.skill.name, group: s.skill.skillGroup || String(s.skill.name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''), tier: s.skill.tier, category: s.skill.category, description: s.skill.description } : null }))
      })),
      freeShuffles: Number(shuffle?.remainingFreeShuffles) || 0,
      maxFreeShuffles: Number(shuffle?.maxFreeShuffles) || 2,
      readAt: new Date().toISOString()
    };
  }

  async view(id) {
    return this._with(id, async (gs, userId) => {
      const v = await this._read(gs, userId);
      const players = await gs.call('skills:getAvailablePlayersForAssignment', undefined, 'skills:availablePlayersForAssignment', { timeoutMs: TIMEOUT_MS }).catch(() => null);
      v.players = (players?.players || players?.availablePlayers || []).map(p => ({ playerId: p.playerId || p.id, name: p.player?.visualName || p.player?.name || p.visualName || p.name || '?', rating: p.player?.rating || p.rating || null }));
      this.views[id] = v;
      return v;
    });
  }

  // "Learn": the 11 containers, once (level 30+).
  async learn(id) {
    return this._with(id, async (gs, userId) => {
      const v = await this._read(gs, userId);
      if (v.containers.length) throw new Error('The skills are already learned.');
      if (v.level != null && v.level < 30) throw new Error('Skills open at level 30.');
      for (let n = 1; n <= CONTAINERS; n++) {
        const r = await gs.call('skills:createContainer', { userId, name: `Container ${n}` }, 'skills:containerCreated', { timeoutMs: TIMEOUT_MS });
        if (!r?.success) throw new Error(r?.message || 'A container could not be created.');
      }
      this._log(id, 'success', 'learned', {}, 'Skills learned · 11 containers');
      return (this.views[id] = { ...(this.views[id] || {}), ...(await this._read(gs, userId)) });
    });
  }

  // Free shuffles only; never a paid one.
  async shuffle(id, containerId) {
    return this._with(id, async (gs, userId) => {
      const st = await gs.call('skills:getShuffleStatus', { userId }, 'skills:shuffleStatus', { timeoutMs: TIMEOUT_MS });
      if (!(Number(st?.remainingFreeShuffles) > 0)) throw new Error('No free shuffle left today (the rest costs tickets).');
      const r = await gs.call('skills:shuffleContainer', { containerId }, 'skills:containerShuffled', { timeoutMs: TIMEOUT_MS });
      if (!r?.success) throw new Error(r?.message || 'Shuffle failed.');
      const v = await this._read(gs, userId);
      const c = v.containers.find(x => x.id === containerId);
      const names = (c?.slots || []).filter(s => s.skill).map(s => s.skill.name).join(', ');
      this._log(id, 'success', 'shuffled', { n: c?.number ?? '?', skills: names || '—' }, `Skills shuffled · container ${c?.number ?? '?'} · ${names || '—'}`);
      return (this.views[id] = { ...(this.views[id] || {}), ...v });
    });
  }

  async toggleLock(id, containerId, slot, locked) {
    return this._with(id, async (gs, userId) => {
      const r = await gs.call('skills:toggleSkillLock', { containerId, slotNumber: slot, locked: Boolean(locked) }, 'skills:skillLockToggled', { timeoutMs: TIMEOUT_MS });
      if (!r?.success) throw new Error(r?.message || 'The lock could not be changed.');
      return (this.views[id] = { ...(this.views[id] || {}), ...(await this._read(gs, userId)) });
    });
  }

  async assign(id, containerId, playerId) {
    return this._with(id, async (gs, userId) => {
      const r = playerId
        ? await gs.call('skills:assignContainerToPlayer', { userId, containerId, playerId }, 'skills:containerAssigned', { timeoutMs: TIMEOUT_MS })
        : await gs.call('skills:unassignContainer', { userId, playerId: this.views[id]?.containers?.find(c => c.id === containerId)?.player?.playerId }, 'skills:containerUnassigned', { timeoutMs: TIMEOUT_MS });
      if (!r?.success) throw new Error(r?.message || 'The container could not be assigned.');
      const v = await this._read(gs, userId);
      v.players = this.views[id]?.players || [];
      return (this.views[id] = { ...(this.views[id] || {}), ...v });
    });
  }
}

// ---- Common skill plan for many accounts (user 2026-11-13) -----------------------------------
// One plan for every account: for each position a 1st, 2nd and 3rd choice (skill groups). The
// button, on every ticked account (level 30+) at the same time:
//   1. gives each roster player the container that fits his position best (1st > 2nd > 3rd, a
//      higher tier first: SUPERIOR red > INTERMEDIATE purple > PRIMARY blue); a player with none
//      of his three still gets a container;
//   2. uses the free shuffles (2 a day, never a paid one) on the spare containers no player
//      keeps, and after each shuffle hands a better container over (the old one is taken off);
//   3. tells what each player got.
// A container's open slots all count (slot 2+ open from level 40 with tickets): its best match.
// Position of a player = his court slot (PG…C), for the bench his first listed position.
// The catalog (25 skills × 3 tiers) is the same for every level (read 2026-11-13).
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const TIER_RANK = { PRIMARY: 1, INTERMEDIATE: 2, SUPERIOR: 3 };
const BEST_FREE = 3 * 10 + TIER_RANK.INTERMEDIATE; // a free shuffle never gives SUPERIOR
const CATALOG = [
  ['3_POINTER', '3-POINTER', 'OFFENSIVE', '3-pointer ability +5% / +10%'],
  ['ASSISTING_ABILITY', 'ASSISTING ABILITY', 'OFFENSIVE', 'Assisting ability +5% / +10%'],
  ['BUZZER_BEATER', 'BUZZER BEATER', 'OFFENSIVE', '20%: final shot at the end of a quarter (2% / 5%)'],
  ['FUTURE_DUNK', 'FUTURE DUNK', 'OFFENSIVE', 'Scoring on dunk attempts +5% / +10%'],
  ['LINSANITY', 'LINSANITY', 'OFFENSIVE', '20%: extra scoring in Q4 / critical moments (5% / 10%)'],
  ['LITHESOME', 'LITHESOME', 'OFFENSIVE', '20%: fewer turnovers (2% / 5%)'],
  ['MR_BIGSHOT', 'MR. BIGSHOT', 'OFFENSIVE', '20%: stat boost in the last 2 minutes (2% / 5%)'],
  ['SCORING_ABILITY', 'SCORING ABILITY', 'OFFENSIVE', 'Scoring ability +5% / +10%'],
  ['SKYHOOK', 'SKYHOOK', 'OFFENSIVE', 'Layups +5% / +10%'],
  ['SLAM_DUNK', 'SLAM DUNK', 'OFFENSIVE', 'Dunking ability +5% / +10%'],
  ['BLOCKING_ABILITY', 'BLOCKING ABILITY', 'DEFENSIVE', 'Blocking ability +5% / +10%'],
  ['CALM_DOWN', 'CALM DOWN', 'DEFENSIVE', '20%: fewer panic fouls (5% / 10%)'],
  ['DEPRESS', 'DEPRESS', 'DEFENSIVE', "20%: lowers the opponent's morale after a block (10 / 20)"],
  ['EASY_STEAL', 'EASY STEAL', 'DEFENSIVE', '20%: clean steals (2% / 5%)'],
  ['FAST_RECOVERY', 'FAST RECOVERY', 'DEFENSIVE', '20%: less stamina used on defense (2% / 5%)'],
  ['FLEXIBILITY', 'FLEXIBILITY', 'DEFENSIVE', 'Fewer personal fouls (5% / 10%)'],
  ['REBOUNDING_ABILITY', 'REBOUNDING ABILITY', 'DEFENSIVE', 'Rebounding ability +5% / +10%'],
  ['STEALING_ABILITY', 'STEALING ABILITY', 'DEFENSIVE', 'Stealing ability +5% / +10%'],
  ['BLACK_WHISTLE', 'BLACK WHISTLE', 'UTILITY', '10%: a foul goes to the opponent (2% / 5%)'],
  ['CHARISMA', 'CHARISMA', 'UTILITY', "5%: teammates' stats up (5% / 10%)"],
  ['INFURIATION', 'INFURIATION', 'UTILITY', '20%: morale up when 10+ behind (5 / 10)'],
  ['IRON_PALM', 'IRON PALM', 'UTILITY', '8%: sends an opponent to the bench (2% / 5%)'],
  ['OSCAR_ACTOR', 'OSCAR ACTOR', 'UTILITY', '20%: draws an offensive foul (2% / 5%)'],
  ['TEASE', 'TEASE', 'UTILITY', '20%: baits defenders into fouls (2% / 5%)'],
  ['VITALITY', 'VITALITY', 'UTILITY', '20%: faster stamina back in timeouts (5% / 10%)']
].map(([group, name, category, effect]) => ({ group, name, category, effect }));

const positionOf = p => p.slot || String(p.position || '').split('/')[0].trim() || '';
function scoreOf(container, pos, plan) {
  const want = (plan?.[pos] || []).filter(Boolean);
  let best = 0;
  for (const s of container.slots || []) {
    if (!s.open || !s.skill) continue;
    const r = want.indexOf(s.skill.group);
    if (r >= 0) best = Math.max(best, (3 - r) * 10 + (TIER_RANK[s.skill.tier] || 0));
  }
  return best;
}
// players [{playerId, name, position, slot, order}], containers [{id, player{playerId}, slots}]
// -> Map playerId -> {containerId, score}; the pair with the highest score first, the current
// owner kept on a tie, starters before the bench.
function planAssign(containers, players, plan) {
  const pairs = [];
  for (const p of players) for (const c of containers) pairs.push({ p, c, score: scoreOf(c, positionOf(p), plan), keep: c.player?.playerId === p.playerId ? 1 : 0 });
  pairs.sort((a, b) => b.score - a.score || b.keep - a.keep || a.p.order - b.p.order);
  const usedP = new Set(); const usedC = new Set(); const out = new Map();
  for (const x of pairs) {
    if (usedP.has(x.p.playerId) || usedC.has(x.c.id)) continue;
    usedP.add(x.p.playerId); usedC.add(x.c.id);
    out.set(x.p.playerId, { containerId: x.c.id, score: x.score });
  }
  return out;
}
function validPlan(plan) {
  const groups = new Set(CATALOG.map(c => c.group));
  const out = {};
  for (const pos of POSITIONS) out[pos] = (plan?.[pos] || []).slice(0, 3).map(g => (groups.has(g) ? g : null));
  if (!POSITIONS.some(p => out[p].some(Boolean))) throw new Error('Choose at least one skill in the plan.');
  return out;
}

SkillsService.prototype.catalog = function catalog() { return { skills: CATALOG, positions: POSITIONS }; };

SkillsService.prototype._players = async function _players(gs, userId) {
  const data = await gs.call('equipment:getUserPlayerAndInventory', { userId }, 'equipment:userPlayerAndInventory', { timeoutMs: TIMEOUT_MS });
  const list = (data?.players || []).map(p => ({ playerId: p.playerId, name: p.player?.visualName || p.player?.name || '?', position: p.player?.position || '', slot: p.slot || null, benchSlot: p.benchSlot ?? null }));
  list.sort((a, b) => (a.slot ? 0 : 1) - (b.slot ? 0 : 1) || POSITIONS.indexOf(a.slot) - POSITIONS.indexOf(b.slot) || (a.benchSlot || 99) - (b.benchSlot || 99));
  return list.map((p, order) => ({ ...p, order }));
};

// Puts the plan into the game: takes off what moves, then assigns.
SkillsService.prototype._apply = async function _apply(gs, userId, view, players, target) {
  const owner = new Map(view.containers.filter(c => c.player).map(c => [c.id, c.player.playerId]));
  const current = new Map(view.containers.filter(c => c.player).map(c => [c.player.playerId, c.id]));
  const moves = players.filter(p => target.get(p.playerId) && current.get(p.playerId) !== target.get(p.playerId).containerId);
  if (!moves.length) return 0;
  const off = new Set();
  for (const p of moves) {
    if (current.has(p.playerId)) off.add(p.playerId);
    const o = owner.get(target.get(p.playerId).containerId);
    if (o) off.add(o);
  }
  for (const playerId of off) {
    const r = await gs.call('skills:unassignContainer', { userId, playerId }, 'skills:containerUnassigned', { timeoutMs: TIMEOUT_MS });
    if (!r?.success) throw new Error(r?.message || 'A container could not be taken off.');
  }
  // the players taken off whose new container is the one they had keep it (put it back too)
  let n = 0;
  for (const p of players) {
    const t = target.get(p.playerId);
    if (!t || (!off.has(p.playerId) && current.get(p.playerId) === t.containerId)) continue;
    const r = await gs.call('skills:assignContainerToPlayer', { userId, containerId: t.containerId, playerId: p.playerId }, 'skills:containerAssigned', { timeoutMs: TIMEOUT_MS });
    if (!r?.success) throw new Error(r?.message || 'A container could not be assigned.');
    n++;
  }
  return n;
};

SkillsService.prototype._autoOne = async function _autoOne(id, plan, signal) {
  return this._with(id, async (gs, userId) => {
    let view = await this._read(gs, userId);
    if (view.level != null && view.level < 30) return { result: 'lowLevel', level: view.level };
    if (!view.containers.length) {
      for (let n = 1; n <= CONTAINERS; n++) {
        const r = await gs.call('skills:createContainer', { userId, name: `Container ${n}` }, 'skills:containerCreated', { timeoutMs: TIMEOUT_MS });
        if (!r?.success) throw new Error(r?.message || 'A container could not be created.');
      }
      this._log(id, 'success', 'learned', {}, 'Skills learned · 11 containers');
      view = await this._read(gs, userId);
    }
    const players = await this._players(gs, userId);
    if (!players.length) return { result: 'noPlayers' };
    let target = planAssign(view.containers, players, plan);
    let changes = await this._apply(gs, userId, view, players, target);
    let shuffles = 0; let upgrades = 0;
    // free shuffles on the spare containers, while a player can still get something better
    for (let guard = 0; guard < 4; guard++) {
      if (signal?.aborted) break;
      const st = await gs.call('skills:getShuffleStatus', { userId }, 'skills:shuffleStatus', { timeoutMs: TIMEOUT_MS });
      if (!(Number(st?.remainingFreeShuffles) > 0)) break;
      if (![...target.values()].some(t => t.score < BEST_FREE)) break;
      view = await this._read(gs, userId);
      const used = new Set([...target.values()].map(t => t.containerId));
      const spare = view.containers.filter(c => !used.has(c.id) && c.slots.some(s => s.open && !s.locked))
        .sort((a, b) => Math.max(0, ...POSITIONS.map(p => scoreOf(a, p, plan))) - Math.max(0, ...POSITIONS.map(p => scoreOf(b, p, plan))))[0];
      if (!spare) break;
      const r = await gs.call('skills:shuffleContainer', { containerId: spare.id }, 'skills:containerShuffled', { timeoutMs: TIMEOUT_MS });
      if (!r?.success) break;
      shuffles++;
      view = await this._read(gs, userId);
      const c = view.containers.find(x => x.id === spare.id);
      this._log(id, 'success', 'shuffled', { n: c?.number ?? '?', skills: (c?.slots || []).filter(s => s.skill).map(s => s.skill.name).join(', ') || '—' }, `Skills shuffled · container ${c?.number ?? '?'}`);
      const next = planAssign(view.containers, players, plan);
      const before = [...target.values()].reduce((s, t) => s + t.score, 0);
      const after = [...next.values()].reduce((s, t) => s + t.score, 0);
      if (after > before) { upgrades += await this._apply(gs, userId, view, players, next); target = next; }
    }
    view = await this._read(gs, userId);
    const byId = new Map(view.containers.map(c => [c.id, c]));
    const got = players.map(p => {
      const c = view.containers.find(x => x.player?.playerId === p.playerId);
      const skill = (c?.slots || []).filter(s => s.open && s.skill).map(s => s.skill).sort((a, b) => scoreOf({ slots: [{ open: true, skill: b }] }, positionOf(p), plan) - scoreOf({ slots: [{ open: true, skill: a }] }, positionOf(p), plan))[0];
      const sc = c ? scoreOf(c, positionOf(p), plan) : 0;
      return { name: p.name, pos: positionOf(p), skill: skill?.name || '—', tier: skill?.tier || null, choice: sc ? 3 - Math.floor(sc / 10) + 1 : 0 };
    });
    void byId;
    this.views[id] = { ...(this.views[id] || {}), ...view };
    const hit = got.filter(g => g.choice).length;
    this._log(id, 'success', 'autoDone', { hit, total: got.length, shuffles, changes: changes + upgrades }, `Skills plan · ${hit}/${got.length} player(s) on a chosen skill · ${shuffles} shuffle(s)`);
    return { result: 'done', players: got, shuffles, changes: changes + upgrades, freeLeft: Number((await gs.call('skills:getShuffleStatus', { userId }, 'skills:shuffleStatus', { timeoutMs: TIMEOUT_MS }).catch(() => null))?.remainingFreeShuffles ?? 0) };
  });
};

SkillsService.prototype.autoMany = async function autoMany(accountIds, plan) {
  if (this.auto?.running) throw new Error('The skill plan is already running.');
  const settings = this.store.getSettings?.() || {};
  const p = validPlan(plan || settings.skillPlan);
  if (plan) this.store.saveSettings?.({ ...settings, skillPlan: p });
  const prof = this.store.getAccountProfileRaw?.()?.accounts || {};
  const ids = [...new Set(accountIds)].filter(id => this._account(id));
  if (!ids.length) throw new Error('Choose at least one account.');
  const ctrl = new AbortController();
  const rows = ids.map(id => ({ accountId: id, name: this._account(id)?.name || id, status: 'queued' }));
  this.auto = { running: true, rows, ctrl, startedAt: new Date().toISOString() };
  this.onChanged();
  const { eachAtOnce } = require('./wide.cjs');
  await eachAtOnce(rows, async row => {
    if (ctrl.signal.aborted) { row.status = 'stopped'; return; }
    const lv = Number(prof[row.accountId]?.level);
    if (Number.isFinite(lv) && lv < 30) { row.status = 'lowLevel'; row.level = lv; this.onChanged(); return; }
    row.status = 'running'; this.onChanged();
    try { Object.assign(row, await this._autoOne(row.accountId, p, ctrl.signal)); row.status = row.result; }
    catch (error) { row.status = 'error'; row.error = error.message; this._log(row.accountId, 'error', 'autoFailed', { error: error.message }, `Skills plan failed: ${error.message}`); }
    this.onChanged();
  });
  this.auto = { ...this.auto, running: false, ctrl: null };
  this.onChanged();
  return rows;
};
SkillsService.prototype.stopAuto = function stopAuto() { this.auto?.ctrl?.abort(); return true; };

const baseSnapshot = SkillsService.prototype.snapshot;
SkillsService.prototype.snapshot = function snapshot() {
  const a = this.auto;
  return { ...baseSnapshot.call(this), plan: this.store.getSettings?.()?.skillPlan || null, auto: a ? { running: a.running, startedAt: a.startedAt, rows: a.rows } : null };
};

module.exports = { SkillsService, planAssign, scoreOf, CATALOG, POSITIONS };
