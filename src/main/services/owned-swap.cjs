// market-service uses this module too: load its helpers when first needed (no require cycle).
const listingRow = (...a) => require('./market-service.cjs').listingRow(...a);
const listingKind = (...a) => require('./market-service.cjs').listingKind(...a);

// "Already own this player": the game refuses to buy, sign or take back from the market
// a player the account already has in its roster. The way around it, on one account
// (user's method, 2026-10-25):
//   prepare  — remember the roster copy's equipment, skill and the lineup; with only 5
//              players first take one of the account's own market listings back (the
//              roster may not drop to 4); unequip, unassign the skill and park the copy
//              on the market at 9,999,999 TIX.
//   (the blocked action runs: buy / sign / relist)
//   restore  — once the new copy has left the roster: take the original back from the
//              market, equip the same items, assign the same skill, put the starting
//              five on their old positions, list the withdrawn player again (old price;
//              a stock player at 9,999,999 TIX).
// Captured 2026-10-25 on /socket/ (registered connection):
//   equipment:getUserPlayerAndInventory {userId} → equipment:userPlayerAndInventory {players[]}
//     players[]: playerId, slot | benchSlot, signedSalary, <slot>InventoryId ×5, skillContainerId
//   equipment:unequipSelected {userId, playerId} → equipment:unequipSelectedResult
//   equipment:equipItem {playerId, inventoryId, equipmentSlot} → equipment:equipmentUpdated
//   skills:unassignContainer {userId, playerId} → skills:containerUnassigned
//   skills:assignContainerToPlayer {userId, containerId, playerId} → skills:containerAssigned
//   updatePlayerPositions {userId, starters[{playerId, slot}], bench[{playerId, benchSlot}]} (ack)
const PARK_PRICE = 9999999;
const ROSTER_MIN = 5;
const PAGE_SIZE = 8;
const TIMEOUT_MS = 20000;
const EQUIP_SLOTS = [['HEADBAND', 'headbandInventoryId'], ['JERSEY', 'jerseyInventoryId'], ['PANTS', 'pantsInventoryId'], ['SHOES', 'shoesInventoryId'], ['SLEEVES', 'sleevesInventoryId']];
const PAYMENT_MODE = { APK: 'APK_TICKET', TIX: 'TICKET' };

const isOwnedError = message => /already own/i.test(String(message || ''));
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const waitOf = r => r?.retryAfter ?? Number(String(r?.message || r?.error || '').match(/(?:please wait|try again in)\s*(\d+)/i)?.[1]);

// Which own listing to take back to make room (user's order): on sale under the cap,
// was on sale under the cap, on sale over, was on sale over, stock under, stock over.
const FILLER_ORDER = [['onSale', false], ['recent', false], ['onSale', true], ['recent', true], ['stock', false], ['stock', true]];
function pickFiller(rows, { cap, used } = {}, now = Date.now()) {
  const over = r => Number.isFinite(cap) && Number.isFinite(used) && used + (Number(r.salary) || 0) > cap;
  for (const [kind, isOver] of FILLER_ORDER) {
    const hit = rows.filter(r => listingKind(r, now) === kind && over(r) === isOver).sort((a, b) => (Number(a.salary) || 0) - (Number(b.salary) || 0))[0];
    if (hit) return { ...hit, kind };
  }
  return null;
}

// Starters back on their old positions; everybody else on the bench (old order first).
function lineupFor(remembered, squad) {
  const here = new Set(squad.map(p => p.playerId));
  const starters = remembered.starters.filter(s => here.has(s.playerId));
  const used = new Set(starters.map(s => s.playerId));
  const freeSlots = ['PG', 'SG', 'SF', 'PF', 'C'].filter(sl => !starters.some(s => s.slot === sl));
  for (const p of squad) {
    if (starters.length >= 5 || !freeSlots.length) break;
    if (!used.has(p.playerId) && p.slot) { starters.push({ playerId: p.playerId, slot: freeSlots.shift() }); used.add(p.playerId); }
  }
  const order = new Map(remembered.bench.map((b, i) => [b.playerId, i]));
  const rest = squad.filter(p => !used.has(p.playerId)).sort((a, b) => (order.get(a.playerId) ?? 1e9) - (order.get(b.playerId) ?? 1e9));
  for (const p of rest) { if (starters.length >= 5 || !freeSlots.length) break; starters.push({ playerId: p.playerId, slot: freeSlots.shift() }); used.add(p.playerId); }
  const bench = squad.filter(p => !used.has(p.playerId)).sort((a, b) => (order.get(a.playerId) ?? 1e9) - (order.get(b.playerId) ?? 1e9)).map((p, i) => ({ playerId: p.playerId, benchSlot: i + 1 }));
  return { starters, bench };
}
const sameLineup = (squad, want) => want.starters.every(s => squad.find(p => p.playerId === s.playerId)?.slot === s.slot);

class OwnedSwap {
  // gs: a registered GameSocket of the account; log(level, code, params, message)
  // onActivity: keeps the owner's idle timer from closing the connection mid-way.
  constructor({ gs, userId, log = () => {}, gapMs = 400, onActivity = () => {} }) {
    Object.assign(this, { gs, userId, log, gapMs, onActivity });
  }

  async _call(event, payload, replyEvent) {
    for (let attempt = 0; ; attempt++) {
      this.onActivity();
      const r = await this.gs.call(event, payload, replyEvent, { timeoutMs: TIMEOUT_MS });
      this.onActivity();
      const wait = waitOf(r);
      if (r?.success === false && Number.isFinite(wait) && attempt < 4) { await sleep(wait * 1000 + 250); continue; }
      await sleep(this.gapMs);
      return r;
    }
  }

  async squad() {
    this.onActivity();
    const r = await this.gs.call('equipment:getUserPlayerAndInventory', { userId: this.userId }, 'equipment:userPlayerAndInventory', { timeoutMs: TIMEOUT_MS });
    return Array.isArray(r?.players) ? r.players : [];
  }
  async listings() {
    this.onActivity();
    const rows = [];
    for (let page = 1; page <= 30; page++) {
      const d = await this.gs.call('market:getMyPlayerListings', { userId: this.userId, page, search: '', basePlayersOnly: false }, 'market:myPlayerListingsData', { timeoutMs: TIMEOUT_MS });
      this.onActivity();
      for (const t of d?.tickets || []) rows.push(listingRow(t, null));
      if ((d?.tickets || []).length < PAGE_SIZE || page * PAGE_SIZE >= Number(d?.total || 0)) break;
    }
    return rows.filter(r => r.status === 'LISTED' || r.status === 'EXPIRED');
  }
  async cap() {
    const r = await this.gs.call('getUserBasicInfo', { userId: this.userId }, 'userBasicInfo', { timeoutMs: TIMEOUT_MS }).catch(() => null);
    return { cap: Number(r?.salaryCap), used: Number(r?.totalSalaryUsed) };
  }
  sell(playerId, price, currency) { return this._call('market:sellPlayer', { userId: this.userId, playerId, price: Number(price), paymentMode: PAYMENT_MODE[currency] || 'TICKET' }, 'market:sellResult'); }
  cancel(ticketId) { return this._call('market:cancelPlayerListing', { userId: this.userId, ticketId }, 'cancelResult'); }

  // → { ok: true, record } | { ok: false, reason: 'notInRoster' | 'noListings' | 'failed', message }
  // excludeTickets: listings that must not be taken back (e.g. the ones being relisted).
  async prepare(playerId, name = '', { excludeTickets = [] } = {}) {
    const squad = await this.squad();
    const copy = squad.find(p => p.playerId === playerId);
    if (!copy) return { ok: false, reason: 'notInRoster' };
    const record = {
      playerId, name: name || copy.player?.name || '',
      equipment: EQUIP_SLOTS.map(([slot, key]) => copy[key] ? { slot, inventoryId: copy[key] } : null).filter(Boolean),
      skillContainerId: copy.skillContainerId || null,
      lineup: { starters: squad.filter(p => p.slot).map(p => ({ playerId: p.playerId, slot: p.slot })), bench: squad.filter(p => p.benchSlot != null).sort((a, b) => a.benchSlot - b.benchSlot).map(p => ({ playerId: p.playerId, benchSlot: p.benchSlot })) },
      filler: null,
      at: new Date().toISOString()
    };
    // Only 5 players: the roster may not drop to 4, so one own listing comes back first.
    if (squad.length <= ROSTER_MIN) {
      const skip = new Set(excludeTickets);
      const own = (await this.listings()).filter(r => r.playerId !== playerId && !skip.has(r.ticketId));
      const filler = pickFiller(own, await this.cap());
      if (!filler) return { ok: false, reason: 'noListings' };
      const r = await this.cancel(filler.ticketId);
      if (!r?.success) return { ok: false, reason: 'failed', message: `Listing ${filler.name} could not be taken back: ${r?.message || '?'}` };
      record.filler = { playerId: filler.playerId, name: filler.name, price: filler.price, currency: filler.currency, kind: filler.kind };
      this.log('info', 'os.fillerTaken', { name: filler.name, kind: filler.kind }, `${filler.name} taken back from the market to make room`);
    }
    const undo = async () => { await this._refill(record).catch(() => {}); };
    if (record.equipment.length) {
      const r = await this._call('equipment:unequipSelected', { userId: this.userId, playerId }, 'equipment:unequipSelectedResult');
      if (!r?.success) { await undo(); return { ok: false, reason: 'failed', message: `Equipment could not be taken off: ${r?.message || r?.error || '?'}` }; }
    }
    if (record.skillContainerId) {
      const r = await this._call('skills:unassignContainer', { userId: this.userId, playerId }, 'skills:containerUnassigned');
      if (!r?.success) { await this._dress(record).catch(() => {}); await undo(); return { ok: false, reason: 'failed', message: `Skill could not be taken off: ${r?.message || r?.error || '?'}` }; }
    }
    const parked = await this.sell(playerId, PARK_PRICE, 'TIX');
    if (!parked?.success) { await this._dress(record).catch(() => {}); await undo(); return { ok: false, reason: 'failed', message: `${record.name} could not be parked: ${parked?.message || '?'}` }; }
    // Remember which listing is the park, so restore takes back exactly this one (a
    // relist puts a second listing of the same player on the market).
    const parkRow = (await this.listings().catch(() => [])).find(r => r.playerId === playerId && r.status === 'LISTED' && r.price === PARK_PRICE);
    record.parkTicketId = parkRow?.ticketId || null;
    this.log('info', 'os.parked', { name: record.name, items: record.equipment.length, skill: Boolean(record.skillContainerId) }, `${record.name} parked on the market (equipment and skill remembered)`);
    return { ok: true, record };
  }

  // Equipment and skill back on the player.
  async _dress(record) {
    const problems = [];
    for (const e of record.equipment) {
      const r = await this._call('equipment:equipItem', { playerId: record.playerId, inventoryId: e.inventoryId, equipmentSlot: e.slot }, 'equipment:equipmentUpdated');
      if (!r?.success) problems.push(`${e.slot}: ${r?.message || r?.error || '?'}`);
    }
    if (record.skillContainerId) {
      const r = await this._call('skills:assignContainerToPlayer', { userId: this.userId, containerId: record.skillContainerId, playerId: record.playerId }, 'skills:containerAssigned');
      if (!r?.success) problems.push(`skill: ${r?.message || r?.error || '?'}`);
    }
    return problems;
  }
  // The withdrawn listing goes back on the market (stock at 9,999,999 TIX).
  async _refill(record) {
    if (!record.filler) return null;
    const f = record.filler;
    const stock = f.kind === 'stock';
    const r = await this.sell(f.playerId, stock ? PARK_PRICE : f.price, stock ? 'TIX' : f.currency);
    if (r?.success) record.filler = null;
    return r;
  }

  // → { ok, reason?, problems[] }. reason 'copyInRoster': the new copy has not left yet.
  async restore(record) {
    const problems = [];
    const mine = (await this.listings()).filter(r => r.playerId === record.playerId && r.status === 'LISTED');
    const parked = mine.find(r => r.ticketId === record.parkTicketId) || mine.find(r => r.price === PARK_PRICE && r.currency === 'TIX') || (mine.length === 1 ? mine[0] : null);
    if (parked) {
      const r = await this.cancel(parked.ticketId);
      if (!r?.success) return { ok: false, reason: isOwnedError(r?.message) ? 'copyInRoster' : 'failed', message: r?.message || '?', problems };
    } else if (!(await this.squad()).some(p => p.playerId === record.playerId)) {
      return { ok: false, reason: 'failed', message: `${record.name} is neither on the market nor in the roster`, problems };
    }
    problems.push(...await this._dress(record));
    const squad = await this.squad();
    const want = lineupFor(record.lineup, squad);
    if (!sameLineup(squad, want)) {
      this.onActivity();
      const r = await this.gs.ack('updatePlayerPositions', { userId: this.userId, starters: want.starters, bench: want.bench }, { timeoutMs: TIMEOUT_MS }).catch(e => ({ success: false, message: e.message }));
      if (!r?.success) problems.push(`lineup: ${r?.message || '?'}`);
    }
    if (record.filler) {
      const name = record.filler.name;
      const r = await this._refill(record);
      if (!r?.success) problems.push(`${name} could not be listed again: ${r?.message || '?'}`);
    }
    this.log(problems.length ? 'warning' : 'success', 'os.restored', { name: record.name, problems: problems.join(' · ') }, `${record.name} back in the roster${problems.length ? ' · ' + problems.join(' · ') : ' · equipment, skill and lineup restored'}`);
    return { ok: true, problems };
  }
}

module.exports = { OwnedSwap, pickFiller, lineupFor, isOwnedError, PARK_PRICE };
