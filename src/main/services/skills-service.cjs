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
        slots: (c.skills || []).sort((a, b) => a.slotNumber - b.slotNumber).map(s => ({ slot: s.slotNumber, open: !s.isLocked, locked: Boolean(s.isSkillLocked), skill: s.skill ? { id: s.skill.id, name: s.skill.name, tier: s.skill.tier, category: s.skill.category, description: s.skill.description } : null }))
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

module.exports = { SkillsService };
