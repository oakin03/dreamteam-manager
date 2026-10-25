const { GameSocket } = require('./game-socket.cjs');

// Equipment for one account at a time over the game's /socket/: bag (equipment +
// materials), Strengthen Equipment (convert, craft, enchant, enhance, refine) and
// Item Collection (register sets, prepare a set: craft → enhance → register).
// Every write is followed by the server's own numbers, never by a guess.
const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];
const GEAR_TYPES = ['JERSEY', 'PANTS', 'SLEEVES', 'HEADBAND', 'SHOES'];
const CALC_URL = 'https://www.dreamteamph.com/api/enhancement/calculate';
const MAX_ENHANCE_ATTEMPTS = 300;
// Minimum time between two writes; the game's cooldown is ~2 s for enhance.
const WRITE_GAP_MS = { 'enhance:item': 2100, 'refine:item': 2100, enchantItem: 2100 };
const DEFAULT_WRITE_GAP_MS = 1100;
const TIMEOUT_MS = 20000;

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
const titleCase = s => s.charAt(0) + s.slice(1).toLowerCase();
const isGear = item => GEAR_TYPES.includes(item?.type);

// Fabric / Refine Stone / Refine Ore / Scroll of Enhancement counts.
function materialSummary(inventory) {
  const fabric = {}; const stone = {};
  let ore = 0; let scroll = 0;
  const other = [];
  for (const row of inventory || []) {
    const item = row.item || {};
    if (item.type !== 'MATERIAL') continue;
    const q = Number(row.quantity) || 0;
    if (/ Fabric$/.test(item.name) && RARITIES.includes(item.rarity)) fabric[item.rarity] = (fabric[item.rarity] || 0) + q;
    else if (/ Refine Stone$/.test(item.name) && RARITIES.includes(item.rarity)) stone[item.rarity] = (stone[item.rarity] || 0) + q;
    else if (item.name === 'Refine Ore') ore += q;
    else if (item.name === 'Scroll of Enhancement') scroll += q;
    else other.push({ name: item.name, rarity: item.rarity, quantity: q });
  }
  return { fabric, stone, ore, scroll, other };
}

function gearRows(data) {
  const owner = new Map();
  for (const [index, p] of (data?.players || []).entries()) {
    for (const slot of ['headband', 'jersey', 'pants', 'shoes', 'sleeves']) {
      const id = p[`${slot}InventoryId`];
      if (id) owner.set(id, { name: p.player?.visualName || p.player?.name || '', index });
    }
  }
  return (data?.inventory || []).filter(r => isGear(r.item)).map(r => ({
    id: r.id,
    itemId: r.itemId,
    name: r.item.name,
    type: r.item.type,
    rarity: r.item.rarity,
    icon: r.item.icon,
    level: Number(r.level) || 0,
    refine: Number(r.refineLevel) || 0,
    enchantPct: Number(r.enchantPct) || 0,
    enchantOffense: Number(r.enchantOffense) || 0,
    enchantDefense: Number(r.enchantDefense) || 0,
    hasEnchant: Boolean(r.enchantPct || r.enchantOffense || r.enchantDefense),
    offense: Number(r.item.offenseBoost) || 0,
    defense: Number(r.item.defenseBoost) || 0,
    equipped: Boolean(r.isEquipped),
    equippedBy: owner.get(r.id)?.name || null,
    playerIndex: owner.get(r.id)?.index ?? null, // roster order, as the game lists players
    exclusive: r.item.exclusivePlayerId ? true : false
  }));
}

function recipeRows(recipes) {
  return (recipes || []).map(r => ({
    id: r.id,
    resultItemId: r.resultItemId,
    name: r.resultItem?.name,
    type: r.resultItem?.type,
    rarity: r.resultItem?.rarity,
    exclusive: Boolean(r.resultItem?.exclusivePlayerId),
    ingredients: (r.ingredients || []).map(i => ({ itemId: i.materialId, name: i.material?.name, type: i.material?.type, rarity: i.material?.rarity, quantity: i.quantity, level: isGear(i.material) ? i.requiredLevel || 0 : 0 }))
  }));
}

function collectionRows(collections) {
  return (collections || []).map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    bonus: { pts: c.ptsPct, ast: c.astPct, reb: c.rebPct, stl: c.stlPct, blk: c.blkPct },
    items: (c.items || []).map(i => ({ slot: i.slot, minLevel: i.minLevel || 0, itemId: i.item?.id, name: i.item?.name, rarity: i.item?.rarity, icon: i.item?.icon })),
    completed: Boolean(c.isCompleted),
    registered: c.registeredSlots || [],
    available: c.availableSlots || []
  }));
}

// What preparing a set needs. Owned, unequipped gear is used first (the game never
// registers equipped gear); missing pieces are crafted, recursively for gear made
// from other gear (All-Star +12 → Legend's). Returns steps or the missing materials.
function planCollection(collection, gear, recipes, materials) {
  const free = gear.filter(g => !g.equipped).map(g => ({ ...g }));
  const used = new Set();
  const need = {}; // material name -> quantity
  const steps = [];
  const recipeFor = itemId => recipes.find(r => r.resultItemId === itemId);
  const missing = [];

  function obtain(itemId, name, level, depth) {
    if (depth > 4) { missing.push({ name, reason: 'depth' }); return null; }
    // The game registers a piece only at exactly the set's + level (a +5 does not
    // count for +4), so higher copies are skipped; lower ones are enhanced up to it.
    const copies = free.filter(g => g.itemId === itemId && !used.has(g.id));
    const ready = copies.find(g => g.level === level);
    if (ready) { used.add(ready.id); return { kind: 'owned', id: ready.id, name, level: ready.level }; }
    const lower = copies.filter(g => g.level < level).sort((a, b) => b.level - a.level)[0];
    if (lower) {
      used.add(lower.id);
      steps.push({ kind: 'enhance', ref: lower.id, name, from: lower.level, to: level, rarity: lower.rarity });
      return { kind: 'enhanced', id: lower.id, name, level };
    }
    const recipe = recipeFor(itemId);
    if (!recipe) { missing.push({ name, reason: 'noRecipe' }); return null; }
    const ref = `craft:${steps.length}:${itemId}`;
    for (const ing of recipe.ingredients) {
      if (isGear({ type: ing.type })) {
        const part = obtain(ing.itemId, ing.name, ing.level, depth + 1);
        if (!part) return null;
      } else {
        need[ing.name] = (need[ing.name] || 0) + ing.quantity;
      }
    }
    steps.push({ kind: 'craft', ref, recipeId: recipe.id, itemId, name, rarity: recipe.rarity });
    if (level > 0) steps.push({ kind: 'enhance', ref, name, from: 0, to: level, rarity: recipe.rarity });
    return { kind: 'crafted', ref, name, level };
  }

  const pieces = [];
  for (const it of collection.items) {
    if (collection.registered.includes(it.slot)) continue;
    const got = obtain(it.itemId, it.name, it.minLevel, 0);
    pieces.push({ slot: it.slot, name: it.name, minLevel: it.minLevel, source: got?.kind || 'missing' });
  }
  const owned = name => {
    const m = name.match(/^(\w+) (Fabric|Refine Stone)$/);
    if (m && RARITIES.includes(m[1].toUpperCase())) return (m[2] === 'Fabric' ? materials.fabric : materials.stone)[m[1].toUpperCase()] || 0;
    return (materials.other.find(o => o.name === name)?.quantity) || 0;
  };
  const short = Object.entries(need).filter(([n, q]) => owned(n) < q).map(([n, q]) => ({ name: n, need: q, have: owned(n) }));
  return { pieces, steps, materials: need, short, missing, ok: !missing.length && !short.length };
}

class EquipmentService {
  constructor({ store, activity, sessions, onChanged, createSocket, fetchImpl = (...a) => fetch(...a), writeGapScale = 1 }) {
    this.writeGapScale = writeGapScale;
    this.store = store;
    this.activity = activity;
    this.sessions = sessions;
    // The page gets the equipment state only when this revision moved.
    this.revision = 0;
    this.onChanged = () => { this.revision++; onChanged?.(); };
    this.createSocket = createSocket;
    this.fetch = fetchImpl;
    this.conn = null;
    this.userId = null;
    this.accountId = null;
    this.raw = null;           // last equipment:userPlayerAndInventory
    this.recipes = null;       // raw recipes (same for everyone)
    this.collections = null;
    this.refineConfig = null;
    this.state = { status: 'closed', step: null, stepParams: {}, error: null, job: null, scannedAt: null, lastResult: null, eventRewards: 0 };
    this.controller = null;
    this.queue = Promise.resolve();
  }

  snapshot() {
    const gear = this.raw ? gearRows(this.raw) : [];
    return {
      ...this.state,
      accountId: this.accountId,
      gear,
      materials: this.raw ? materialSummary(this.raw.inventory) : null,
      hasRecipes: Boolean(this.recipes),
      collections: this.collections ? collectionRows(this.collections) : [],
      refineConfig: this.refineConfig
    };
  }

  _set(patch) { Object.assign(this.state, patch); this.onChanged?.(); }

  _account() {
    const account = this.store.getAccounts().find(a => a.id === this.accountId);
    if (!account) throw new Error('Account not found.');
    return account;
  }

  _log(level, code, params, message) {
    const account = this.store.getAccounts().find(a => a.id === this.accountId);
    this.activity.add({ level, accountId: this.accountId, accountName: account?.name || '', taskName: 'Equipment', code, params, message });
  }

  // One operation at a time; a new one waits for the previous to finish.
  _exclusive(job, fn) {
    const run = async () => {
      this.controller = new AbortController();
      this._set({ job, error: null });
      try {
        return await fn(this.controller.signal);
      } catch (error) {
        if (error?.name === 'AbortError') { this._log('warning', 'eq.stopped', {}, 'Equipment job stopped'); return { stopped: true }; }
        this._set({ error: error.message });
        this._log('error', 'eq.failed', { error: error.message }, `Equipment error: ${error.message}`);
        throw error;
      } finally {
        this.controller = null;
        this._set({ job: null, step: null, stepParams: {} });
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  stop() { this.controller?.abort(); return true; }

  recipeList() { return this.recipes ? recipeRows(this.recipes) : []; }

  async open(accountId) {
    if (this.accountId !== accountId) await this.close();
    this.accountId = accountId;
    return this.scan();
  }

  async close() {
    this.stop();
    try { this.conn?.close(); } catch {}
    this.conn = null; this.userId = null; this.raw = null; this.collections = null; this.accountId = null;
    this.state = { status: 'closed', step: null, stepParams: {}, error: null, job: null, scannedAt: null, lastResult: null, eventRewards: 0 };
    this.onChanged?.();
    return true;
  }

  shutdown() { return this.close(); }

  async _connect(signal) {
    if (this.conn?.socket?.connected) return this.conn;
    try { this.conn?.close(); } catch {}
    const account = this._account();
    this._set({ step: 'login' });
    const session = await this.sessions.get(account, { owner: 'equipment' });
    const conn = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
    // The bag and every write answer only on a socket registered as the user.
    await conn.register(session.userId, { signal, owner: 'Equipment' });
    this.conn = conn; this.userId = session.userId;
    return conn;
  }

  async _call(event, payload, reply, signal, timeoutMs = TIMEOUT_MS, errorEvents = []) {
    const conn = await this._connect(signal);
    return conn.call(event, payload, reply, { signal, timeoutMs, errorEvents });
  }

  // Writes have a short cooldown. The game answers a too-early write on a separate
  // error event ("enhance:itemError" {error:"Please wait 2 seconds…", retryAfter:2}),
  // so those are listened to as well; writes are also spaced by the known gap.
  async _write(event, payload, reply, signal) {
    const errorEvents = [`${event}Error`, `${event}:error`, `${event.split(':')[0]}:error`, `${reply}Error`];
    const gap = (WRITE_GAP_MS[event] ?? DEFAULT_WRITE_GAP_MS) * this.writeGapScale;
    for (let attempt = 0; ; attempt++) {
      const wait0 = (this.lastWriteAt || 0) + gap - Date.now();
      if (wait0 > 0) await sleep(wait0, signal);
      const r = await this._call(event, payload, reply, signal, TIMEOUT_MS, [...new Set(errorEvents)]);
      this.lastWriteAt = Date.now();
      const text = String(r?.message || r?.error || '');
      const wait = r?.retryAfter ?? Number(text.match(/please wait (\d+)/i)?.[1]);
      if (r?.success === false && Number.isFinite(wait) && attempt < 8) {
        await sleep(wait * 1000 + 250, signal);
        continue;
      }
      return r;
    }
  }

  async _loadInventory(signal) {
    const data = await this._call('equipment:getUserPlayerAndInventory', { userId: this.userId }, 'equipment:userPlayerAndInventory', signal);
    if (!Array.isArray(data?.inventory)) throw new Error('The bag could not be read.');
    this.raw = data;
    return data;
  }

  async _loadCollections(signal) {
    const data = await this._call('collection:getData', { userId: this.userId }, 'collection:data', signal);
    if (!Array.isArray(data?.collections)) throw new Error('Collections could not be read.');
    this.collections = data.collections;
    return data;
  }

  scan() {
    return this._exclusive('scan', async signal => {
      const started = Date.now();
      this._set({ status: 'scanning', step: 'login' });
      await this._connect(signal);
      this._set({ step: 'bag' });
      await this._loadInventory(signal);
      this._set({ step: 'collections' });
      await this._loadCollections(signal);
      if (!this.recipes) {
        this._set({ step: 'recipes' });
        const recipes = await this._call('craft:getCraftingRecipes', undefined, 'craft:craftingRecipes', signal);
        if (Array.isArray(recipes)) this.recipes = recipes;
      }
      if (!this.refineConfig) {
        const cfg = await this._call('refine:getConfig', {}, 'refine:configSuccess', signal).catch(() => null);
        this.refineConfig = cfg?.configs || null;
      }
      const gear = gearRows(this.raw);
      const m = materialSummary(this.raw.inventory);
      const sets = collectionRows(this.collections);
      this._set({ status: 'ready', scannedAt: new Date().toISOString() });
      this._log('success', 'eq.scanned', {
        gear: gear.length, equipped: gear.filter(g => g.equipped).length, ore: m.ore, scroll: m.scroll,
        sets: sets.filter(s => s.completed).length, total: sets.length, seconds: Math.round((Date.now() - started) / 100) / 10
      }, `Equipment scanned · ${gear.length} gear · ${sets.filter(s => s.completed).length}/${sets.length} sets`);
      return this.snapshot();
    });
  }

  _requireOpen() { if (!this.accountId) throw new Error('Select an account first.'); }

  convert(rarity, conversions) {
    this._requireOpen();
    const n = Math.max(1, Math.floor(Number(conversions) || 0));
    if (!RARITIES.includes(rarity)) throw new Error('Unknown rarity.');
    return this._exclusive('convert', async signal => {
      this._set({ step: 'convert', stepParams: { rarity, count: n } });
      const r = await this._write('convert:convertFabricToStone', { userId: this.userId, rarity, conversions: n }, 'convert:convertFabricToStoneResult', signal);
      if (!r?.success) throw new Error(r?.message || r?.error || 'Convert refused');
      this._log('success', 'eq.converted', { rarity: titleCase(rarity), fabric: n * 5, stone: n, left: r.updatedFabricItems?.[0]?.quantity ?? '?', stones: r.refineStoneItem?.quantity ?? '?' }, r.message);
      await this._loadInventory(signal);
      this._set({ lastResult: { kind: 'convert', ok: true, message: r.message } });
      return r;
    });
  }

  // Equipment or material recipe, `count` times (material upgrades are 10:1 / 4:1).
  craft(recipeId, count = 1) {
    this._requireOpen();
    const n = Math.max(1, Math.min(500, Math.floor(Number(count) || 1)));
    return this._exclusive('craft', async signal => this._craft(recipeId, n, signal));
  }

  async _craft(recipeId, n, signal) {
    const recipe = recipeRows(this.recipes).find(r => r.id === recipeId);
    if (!recipe) throw new Error('Recipe not found.');
    this._set({ step: 'craft', stepParams: { name: recipe.name, count: n } });
    const before = new Set((this.raw?.inventory || []).map(r => r.id));
    let r;
    if (n === 1) {
      r = await this._write('craft:craftItem', { recipeId }, 'craft:craftItemResult', signal);
    } else {
      r = await this._write('craft:bulkCraftItems', { recipeIds: Array(n).fill(recipeId) }, 'craft:bulkCraftResult', signal);
    }
    if (!r?.success) throw new Error(r?.message || r?.error || 'Craft refused');
    this._log('success', 'eq.crafted', { name: recipe.name, count: n }, `Crafted ${n} × ${recipe.name}`);
    await this._loadInventory(signal);
    this._set({ lastResult: { kind: 'craft', ok: true, message: r.message || `${n} × ${recipe.name}` } });
    const created = r.craftedItem?.id || (this.raw.inventory.find(x => !before.has(x.id) && x.itemId === recipe.resultItemId)?.id) || null;
    return { ...r, createdId: created };
  }

  _gear(inventoryId) {
    const g = gearRows(this.raw).find(x => x.id === inventoryId);
    if (!g) throw new Error('Item not found in the bag.');
    return g;
  }

  enchant(inventoryId) {
    this._requireOpen();
    return this._exclusive('enchant', async signal => {
      const g = this._gear(inventoryId);
      this._set({ step: 'enchant', stepParams: { name: g.name } });
      const r = await this._write('enchantItem', { userId: this.userId, inventoryId }, 'enchantItemResult', signal);
      if (!r?.success) throw new Error(r?.message || r?.error || 'Enchant refused');
      const u = r.updatedInventory || {};
      this._log('success', 'eq.enchanted', { name: g.name, pct: u.enchantPct ?? 0, off: u.enchantOffense ?? 0, def: u.enchantDefense ?? 0, scroll: r.updatedScroll?.quantity ?? '?' }, `${g.name} enchanted`);
      await this._loadInventory(signal);
      this._set({ lastResult: { kind: 'enchant', ok: true, id: inventoryId, pct: u.enchantPct, off: u.enchantOffense, def: u.enchantDefense } });
      return r;
    });
  }

  async enhanceRate(inventoryId) {
    const g = this._gear(inventoryId);
    const res = await this.fetch(CALC_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inventoryId, level: g.level, itemRarity: g.rarity, itemOffense: g.offense, itemDefense: g.defense })
    });
    const body = await res.json().catch(() => ({}));
    return { level: g.level, successRate: body?.successRate ?? null, stats: body?.stats || null };
  }

  // Enhance until +target (or one try when target is null). A failed try keeps
  // the level; the item's refine stone is used either way.
  enhance(inventoryId, target = null) {
    this._requireOpen();
    return this._exclusive('enhance', async signal => this._enhanceTo(inventoryId, target, signal));
  }

  async _enhanceTo(inventoryId, target, signal) {
    let g = this._gear(inventoryId);
    const goal = target == null ? g.level + 1 : Number(target);
    let tries = 0; let fails = 0;
    const startLevel = g.level;
    // Running out of the item's Refine Stone is a normal end, not an error: the run
    // stops and a report says how far it got.
    let noStone = null;
    const stonesLeft = () => { try { return materialSummary(this.raw?.inventory || []).stone[g.rarity] ?? null; } catch { return null; } };
    while (g.level < goal) {
      if (signal.aborted) throw abortError();
      if (stonesLeft() === 0) { noStone = 'none'; break; }
      if (++tries > MAX_ENHANCE_ATTEMPTS) throw new Error(`Stopped after ${MAX_ENHANCE_ATTEMPTS} tries.`);
      this._set({ step: 'enhance', stepParams: { name: g.name, level: g.level, target: goal, tries, fails } });
      const r = await this._write('enhance:item', { inventoryId, useGodsBlessing: false, godsBlessingInventoryId: null }, 'enhance:itemSuccess', signal);
      this._applyStone(r?.updatedRefineStone);
      if (r?.eventReward) {
        this.state.eventRewards += 1;
        this._log('success', 'eq.eventReward', { reward: describeReward(r.eventReward) }, `Equipment event reward: ${describeReward(r.eventReward)}`);
        await this._loadInventory(signal); // the reward changes the material counts
      }
      if (r?.success && r.updatedInventory) {
        this._applyGear(r.updatedInventory);
        g = this._gear(inventoryId);
        this._log('success', 'eq.enhanced', { name: g.name, level: g.level }, r.message || `${g.name} +${g.level}`);
      } else if (/failed at/i.test(String(r?.message))) {
        fails++;
        this._log('info', 'eq.enhanceFailed', { name: g.name, level: g.level, message: r.message }, r.message);
      } else if (/not enough|insufficient|don.?t have|do not have|no (refine )?stone|out of|required|need/i.test(String(r?.message || r?.error || ''))) {
        noStone = String(r?.message || r?.error);
        break;
      } else {
        throw new Error(r?.message || r?.error || 'Enhance refused');
      }
      if (target == null) break;
    }
    await this._loadInventory(signal);
    g = this._gear(inventoryId);
    this._set({ lastResult: { kind: 'enhance', ok: g.level >= goal, id: inventoryId, name: g.name, from: startLevel, level: g.level, target: goal, tries: noStone && noStone !== 'none' ? tries - 1 : tries, fails, noStone: Boolean(noStone), rarity: g.rarity, at: new Date().toISOString() } });
    if (noStone) this._log('warning', 'eq.noStone', { name: g.name, from: startLevel, level: g.level, target: goal }, `${g.name}: Refine Stone ran out · +${startLevel} → +${g.level} (target +${goal})`);
    else if (target != null) this._log(g.level >= goal ? 'success' : 'warning', 'eq.enhanceDone', { name: g.name, from: startLevel, level: g.level, tries, fails }, `${g.name} +${startLevel} → +${g.level} · ${tries} tries`);
    return { level: g.level, tries, fails, noStone: Boolean(noStone) };
  }

  _applyGear(updated) {
    const row = this.raw?.inventory?.find(x => x.id === updated.id);
    if (row) Object.assign(row, updated, { item: updated.item || row.item });
    this.onChanged?.();
  }

  _applyStone(updated) {
    if (!updated?.id) return;
    const row = this.raw?.inventory?.find(x => x.id === updated.id);
    if (row) row.quantity = updated.quantity;
  }

  refineDetails(inventoryId) {
    this._requireOpen();
    return this._call('refine:getDetails', { inventoryId }, 'refine:detailsSuccess', null);
  }

  refine(inventoryId) {
    this._requireOpen();
    return this._exclusive('refine', async signal => {
      const g = this._gear(inventoryId);
      this._set({ step: 'refine', stepParams: { name: g.name, level: g.refine } });
      const r = await this._write('refine:item', { inventoryId }, 'refine:itemSuccess', signal);
      if (r?.updatedInventory) this._applyGear(r.updatedInventory);
      const ok = Boolean(r?.success);
      const level = r?.newRefineLevel ?? r?.updatedInventory?.refineLevel ?? g.refine;
      if (!ok && !r?.updatedOre && !r?.updatedInventory) throw new Error(r?.message || r?.error || 'Refine refused');
      this._log(ok ? 'success' : 'warning', ok ? 'eq.refined' : (r?.downgraded ? 'eq.refineDowngraded' : 'eq.refineFailed'), { name: g.name, from: g.refine, level, ore: r?.updatedOre?.quantity ?? '?' }, r?.message || `${g.name} refine ${g.refine} → ${level}`);
      await this._loadInventory(signal);
      this._set({ lastResult: { kind: 'refine', ok, id: inventoryId, from: g.refine, level, downgraded: Boolean(r?.downgraded) } });
      return r;
    });
  }

  registerCollection(collectionId) {
    this._requireOpen();
    return this._exclusive('register', async signal => this._register(collectionId, signal));
  }

  // Without `slot` every ready piece of the set is registered (quickRegister); with a
  // slot only that piece (collection:register, like clicking the piece in the game).
  async _register(collectionId, signal, slot = null) {
    const set = collectionRows(this.collections).find(c => c.id === collectionId);
    if (!set) throw new Error('Set not found.');
    this._set({ step: 'register', stepParams: { name: set.name } });
    const r = slot
      ? await this._write('collection:register', { userId: this.userId, collectionId, slot }, 'collection:registerResult', signal)
      : await this._write('collection:quickRegister', { userId: this.userId, collectionId }, 'collection:registerResult', signal);
    if (!r?.success) throw new Error(r?.message || r?.error || 'Register refused');
    await this._loadCollections(signal);
    await this._loadInventory(signal);
    this._log('success', r.completed ? 'eq.setCompleted' : 'eq.registered', { name: set.name, count: r.registeredCount ?? '?' }, r.message || `${set.name} registered`);
    this._set({ lastResult: { kind: 'register', ok: true, name: set.name, completed: Boolean(r.completed), count: r.registeredCount } });
    return r;
  }

  planCollection(collectionId, slot = null) {
    this._requireOpen();
    if (!this.raw || !this.collections || !this.recipes) throw new Error('Scan first.');
    const set = collectionRows(this.collections).find(c => c.id === collectionId);
    if (!set) throw new Error('Set not found.');
    const piece = slot ? set.items.find(i => i.slot === slot) : null;
    return { set: piece ? `${set.name} · ${piece.name}` : set.name, slot, ...planCollection(onlySlot(set, slot), gearRows(this.raw), recipeRows(this.recipes), materialSummary(this.raw.inventory)) };
  }

  // Craft what is missing, enhance to each piece's level, then register the set.
  // With `slot`: only that piece is made, raised to its level and registered.
  prepareCollection(collectionId, slot = null) {
    this._requireOpen();
    return this._exclusive('prepare', async signal => {
      await this._loadInventory(signal);
      await this._loadCollections(signal);
      const set = collectionRows(this.collections).find(c => c.id === collectionId);
      if (!set) throw new Error('Set not found.');
      if (set.completed) { this._log('info', 'eq.setAlready', { name: set.name }, `${set.name} is already complete`); return { completed: true }; }
      if (slot && set.registered.includes(slot)) { this._log('info', 'eq.setAlready', { name: set.name }, `${set.name} · ${slot} is already registered`); return { completed: false }; }
      const plan = planCollection(onlySlot(set, slot), gearRows(this.raw), recipeRows(this.recipes), materialSummary(this.raw.inventory));
      if (!plan.ok) {
        const text = [...plan.short.map(s => `${s.name} ${s.have}/${s.need}`), ...plan.missing.map(m => m.name)].join(', ');
        this._log('error', 'eq.prepareShort', { name: set.name, short: text }, `${set.name} cannot be prepared · missing ${text}`);
        this._set({ lastResult: { kind: 'prepare', ok: false, name: set.name, short: plan.short, missing: plan.missing } });
        return { ok: false, plan };
      }
      this._log('info', 'eq.prepareStart', { name: set.name, crafts: plan.steps.filter(s => s.kind === 'craft').length, enhances: plan.steps.filter(s => s.kind === 'enhance').length }, `Preparing ${set.name}`);
      const made = new Map(); // craft ref -> inventory id
      const total = plan.steps.length;
      for (const [i, step] of plan.steps.entries()) {
        if (signal.aborted) throw abortError();
        this._set({ step: 'prepare', stepParams: { name: set.name, done: i, total } });
        if (step.kind === 'craft') {
          const r = await this._craft(step.recipeId, 1, signal);
          if (!r.createdId) throw new Error(`${step.name} was crafted but not found in the bag.`);
          made.set(step.ref, r.createdId);
        } else {
          const id = made.get(step.ref) || step.ref;
          const er = await this._enhanceTo(id, step.to, signal);
          if (er?.noStone) throw new Error(`Refine Stone ran out while enhancing ${step.name} (+${er.level} of +${step.to}).`);
        }
      }
      if (signal.aborted) throw abortError();
      const r = await this._register(collectionId, signal, slot);
      return { ok: true, completed: Boolean(r.completed) };
    });
  }
}

function onlySlot(set, slot) { return slot ? { ...set, items: set.items.filter(i => i.slot === slot) } : set; }

function describeReward(reward) {
  if (!reward) return '';
  if (Array.isArray(reward)) return reward.map(describeReward).join(', ');
  if (typeof reward !== 'object') return String(reward);
  const name = reward.item?.name || reward.name || reward.itemName || '';
  const amount = reward.amount ?? reward.quantity ?? '';
  return [amount, name].filter(x => x !== '').join(' ') || JSON.stringify(reward).slice(0, 80);
}

module.exports = { EquipmentService, materialSummary, gearRows, recipeRows, collectionRows, planCollection, RARITIES };
