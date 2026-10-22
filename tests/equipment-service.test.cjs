const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { EquipmentService, materialSummary, planCollection, gearRows, recipeRows, collectionRows } = require('../src/main/services/equipment-service.cjs');

const USER = 'u1';
const mat = (id, name, rarity, quantity) => ({ id, itemId: `i-${name}`, quantity, level: null, isEquipped: false, item: { name, type: 'MATERIAL', rarity } });
const gear = (id, itemId, name, rarity, level, extra = {}) => ({ id, itemId, quantity: null, level, refineLevel: 0, enchantPct: 0, enchantOffense: 0, enchantDefense: 0, isEquipped: false, equippedSlot: null, item: { name, type: name.split(' ').pop().toUpperCase(), rarity, offenseBoost: 1, defenseBoost: 1 }, ...extra });
const recipe = (id, resultItemId, name, type, rarity, ingredients) => ({ id, resultItemId, resultItem: { name, type, rarity }, ingredients: ingredients.map(([materialId, mname, mtype, mrarity, quantity, requiredLevel = 1]) => ({ materialId, quantity, requiredLevel, material: { name: mname, type: mtype, rarity: mrarity } })) });

const RECIPES = [
  recipe('r-jersey', 'it-jersey', 'Starter Jersey', 'JERSEY', 'COMMON', [['i-Common Fabric', 'Common Fabric', 'MATERIAL', 'COMMON', 20]]),
  recipe('r-shoes', 'it-shoes', 'Starter Shoes', 'SHOES', 'COMMON', [['i-Common Fabric', 'Common Fabric', 'MATERIAL', 'COMMON', 20]]),
  recipe('r-legend', 'it-legend', "Legend's Shoes", 'SHOES', 'LEGENDARY', [['it-shoes', 'Starter Shoes', 'SHOES', 'COMMON', 1, 3], ['i-Legendary Fabric', 'Legendary Fabric', 'MATERIAL', 'LEGENDARY', 50]]),
  recipe('r-upg', 'i-Uncommon Fabric', 'Uncommon Fabric', 'MATERIAL', 'UNCOMMON', [['i-Common Fabric', 'Common Fabric', 'MATERIAL', 'COMMON', 10]])
];
const SET = { id: 's1', name: 'Spark Set', items: [
  { slot: 'JERSEY', minLevel: 2, item: { id: 'it-jersey', name: 'Starter Jersey', rarity: 'COMMON' } },
  { slot: 'SHOES', minLevel: 0, item: { id: 'it-shoes', name: 'Starter Shoes', rarity: 'COMMON' } }
], isCompleted: false, registeredSlots: [], availableSlots: [] };

// Fake /socket/ game for the equipment events. Writes need register, like the game.
function fakeGame(opts = {}) {
  const calls = [];
  const state = {
    inventory: [mat('m1', 'Common Fabric', 'COMMON', 100), mat('m2', 'Common Refine Stone', 'COMMON', 10), mat('m3', 'Refine Ore', 'RARE', 5),
      gear('g1', 'it-shoes', 'Starter Shoes', 'COMMON', 0, { isEquipped: true, equippedSlot: 'SHOES' }), ...(opts.inventory || [])],
    players: [{ playerId: 'p1', shoesInventoryId: 'g1', player: { visualName: 'Luka Doncic' } }],
    collections: [JSON.parse(JSON.stringify(SET))],
    cooldownOnce: new Set(opts.cooldownOnce || []),
    enhanceFails: [...(opts.enhanceFails || [])], // levels where the next try fails once
    eventRewardAt: opts.eventRewardAt ?? null,
    seq: 0,
    enhanceCooldownOnce: Boolean(opts.enhanceCooldownOnce)
  };
  const createSocket = () => {
    const s = new EventEmitter();
    s.off = s.removeListener;
    s.close = () => { s.closed = true; };
    s.registered = false;
    const emitLocal = EventEmitter.prototype.emit.bind(s);
    const reply = (event, data) => setTimeout(() => !s.closed && emitLocal(event, data), 1);
    s.emit = (event, p) => {
      calls.push({ event, payload: p });
      if (event === 'register') { s.registered = true; return reply('registrationSuccess'); }
      if (!s.registered && event !== 'craft:getCraftingRecipes' && event !== 'collection:getData') return true; // the game stays silent
      if (state.cooldownOnce.has(event)) { state.cooldownOnce.delete(event); return reply(replyOf(event), { success: false, message: 'Please wait 1 seconds before trying again.' }); }
      const inv = state.inventory;
      switch (event) {
        case 'equipment:getUserPlayerAndInventory': return reply('equipment:userPlayerAndInventory', { players: state.players, inventory: JSON.parse(JSON.stringify(inv)) });
        case 'collection:getData': return reply('collection:data', { success: true, collections: state.collections });
        case 'craft:getCraftingRecipes': return reply('craft:craftingRecipes', RECIPES);
        case 'refine:getConfig': return reply('refine:configSuccess', { configs: [] });
        case 'convert:convertFabricToStone': {
          inv.find(x => x.id === 'm1').quantity -= 5 * p.conversions; inv.find(x => x.id === 'm2').quantity += p.conversions;
          return reply('convert:convertFabricToStoneResult', { success: true, message: 'ok', updatedFabricItems: [inv.find(x => x.id === 'm1')], refineStoneItem: inv.find(x => x.id === 'm2') });
        }
        case 'craft:craftItem': {
          const r = RECIPES.find(x => x.id === p.recipeId);
          for (const ing of r.ingredients) {
            if (ing.material.type === 'MATERIAL') inv.find(x => x.item.name === ing.material.name).quantity -= ing.quantity;
            else state.inventory = state.inventory.filter(x => x !== inv.find(g => g.itemId === ing.materialId && !g.isEquipped && g.level >= ing.requiredLevel));
          }
          const made = gear(`new${++state.seq}`, r.resultItemId, r.resultItem.name, r.resultItem.rarity, 0);
          state.inventory.push(made);
          return reply('craft:craftItemResult', { success: true, message: `Crafted ${r.resultItem.name}`, craftedItem: { id: made.id } });
        }
        case 'enhance:item': {
          // Like the game: a second enhance within the cooldown answers on a separate error event.
          if (state.enhanceCooldownOnce) { state.enhanceCooldownOnce = false; return reply('enhance:itemError', { error: 'Please wait 1 seconds before trying again.', retryAfter: 1 }); }
          const g = inv.find(x => x.id === p.inventoryId);
          const stone = inv.find(x => x.id === 'm2'); stone.quantity -= 1;
          if (state.enhanceFails[0] === g.level) { state.enhanceFails.shift(); return reply('enhance:itemSuccess', { success: false, updatedRefineStone: stone, message: `Enhancement failed at +${g.level} → +${g.level + 1} (chance: 50%)` }); }
          g.level += 1;
          const eventReward = state.eventRewardAt === g.level ? { item: { name: 'Common Refine Stone' }, amount: 3 } : null;
          if (eventReward) stone.quantity += 3;
          return reply('enhance:itemSuccess', { success: true, updatedInventory: g, updatedRefineStone: stone, eventReward, message: `Enhancement successful! Item is now +${g.level}` });
        }
        case 'collection:register': {
          // One piece only, like clicking it in the game.
          const c = state.collections.find(x => x.id === p.collectionId);
          const it = c.items.find(x => x.slot === p.slot);
          const g = inv.find(x => x.itemId === it.item.id && !x.isEquipped && x.level === it.minLevel);
          if (!g) return reply('collection:registerResult', { success: false, message: 'No registrable item' });
          state.inventory = state.inventory.filter(x => x !== g); c.registeredSlots.push(it.slot);
          c.isCompleted = c.registeredSlots.length === c.items.length;
          return reply('collection:registerResult', { success: true, collectionId: c.id, slot: it.slot, completed: c.isCompleted, message: `${it.item.name} registered` });
        }
        case 'collection:quickRegister': {
          const c = state.collections.find(x => x.id === p.collectionId);
          let n = 0;
          for (const it of c.items) {
            if (c.registeredSlots.includes(it.slot)) continue;
            const g = inv.find(x => x.itemId === it.item.id && !x.isEquipped && x.level === it.minLevel); // exact + level, like the game
            if (g) { state.inventory = state.inventory.filter(x => x !== g); c.registeredSlots.push(it.slot); n++; }
          }
          c.isCompleted = c.registeredSlots.length === c.items.length;
          return reply('collection:registerResult', { success: true, completed: c.isCompleted, registeredCount: n, message: `Registered ${n} items` });
        }
      }
      return true;
    };
    setTimeout(() => emitLocal('connect'), 1);
    return s;
  };
  return { createSocket, calls, state };
}
const replyOf = e => ({ 'convert:convertFabricToStone': 'convert:convertFabricToStoneResult', 'craft:craftItem': 'craft:craftItemResult', 'enhance:item': 'enhance:itemSuccess', 'collection:quickRegister': 'collection:registerResult', 'collection:register': 'collection:registerResult' })[e];

function service(game) {
  const logs = [];
  const s = new EquipmentService({
    store: { getAccounts: () => [{ id: 'a1', name: 'Trophy6' }] }, activity: { add: e => logs.push(e) }, onChanged() {},
    sessions: { get: async () => ({ userId: USER, cookieHeader: 'session=x' }) }, createSocket: game.createSocket,
    fetchImpl: async () => ({ json: async () => ({ successRate: 100 }) }), writeGapScale: 0
  });
  return { s, logs };
}
const codes = logs => logs.map(l => l.code);

test('scan reads the bag (+, refine, enchant, who wears it), materials and sets after register', async () => {
  const game = fakeGame({ inventory: [gear('g2', 'it-jersey', 'Starter Jersey', 'COMMON', 3, { refineLevel: 2, enchantPct: 1.7 })] });
  const { s, logs } = service(game);
  const snap = await s.open('a1');
  assert.ok(game.calls.findIndex(c => c.event === 'register') < game.calls.findIndex(c => c.event === 'equipment:getUserPlayerAndInventory'));
  assert.deepEqual(snap.materials.fabric, { COMMON: 100 });
  assert.deepEqual([snap.materials.stone.COMMON, snap.materials.ore], [10, 5]);
  const shoes = snap.gear.find(g => g.id === 'g1');
  const jersey = snap.gear.find(g => g.id === 'g2');
  assert.deepEqual([shoes.equipped, shoes.equippedBy], [true, 'Luka Doncic']);
  assert.deepEqual([jersey.level, jersey.refine, jersey.enchantPct, jersey.hasEnchant, jersey.equippedBy], [3, 2, 1.7, true, null]);
  assert.equal(snap.collections[0].name, 'Spark Set');
  assert.equal(codes(logs).at(-1), 'eq.scanned');
});

test('a "Please wait" answer is waited out and retried', async () => {
  const game = fakeGame({ cooldownOnce: ['convert:convertFabricToStone'] });
  const { s } = service(game);
  await s.open('a1');
  await s.convert('COMMON', 2);
  assert.equal(game.calls.filter(c => c.event === 'convert:convertFabricToStone').length, 2);
  assert.deepEqual([s.snapshot().materials.fabric.COMMON, s.snapshot().materials.stone.COMMON], [90, 12]);
});

test('plan: equipped gear is never used, missing pieces are crafted (also gear made from gear), shortages reported', () => {
  const inv = [mat('m1', 'Common Fabric', 'COMMON', 30), gear('g1', 'it-shoes', 'Starter Shoes', 'COMMON', 5, { isEquipped: true })];
  const g = gearRows({ inventory: inv, players: [] });
  const plan = planCollection(collectionRows([SET])[0], g, recipeRows(RECIPES), materialSummary(inv));
  assert.deepEqual(plan.steps.map(s => `${s.kind}:${s.name}${s.to != null ? `+${s.to}` : ''}`), ['craft:Starter Jersey', 'enhance:Starter Jersey+2', 'craft:Starter Shoes']);
  assert.deepEqual(plan.short, [{ name: 'Common Fabric', need: 40, have: 30 }]);
  assert.equal(plan.ok, false);
  const legend = { id: 's2', name: 'Legend', items: [{ slot: 'SHOES', minLevel: 0, item: { id: 'it-legend', name: "Legend's Shoes" } }], isCompleted: false, registeredSlots: [], availableSlots: [] };
  const p2 = planCollection(collectionRows([legend])[0], g, recipeRows(RECIPES), materialSummary(inv));
  assert.deepEqual(p2.steps.map(s => `${s.kind}:${s.name}${s.to != null ? `+${s.to}` : ''}`), ['craft:Starter Shoes', 'enhance:Starter Shoes+3', "craft:Legend's Shoes"]);
  assert.deepEqual(p2.materials, { 'Common Fabric': 20, 'Legendary Fabric': 50 });
});

test('prepare: crafts, enhances through failures, registers and completes the set', async () => {
  const game = fakeGame({ enhanceFails: [1], eventRewardAt: 2 });
  const { s, logs } = service(game);
  const snap = await s.open('a1');
  const result = await s.prepareCollection(snap.collections[0].id);
  assert.deepEqual(result, { ok: true, completed: true });
  const enh = game.calls.filter(c => c.event === 'enhance:item');
  assert.equal(enh.length, 3, '+0→+1, fail at +1, +1→+2');
  assert.ok(codes(logs).includes('eq.enhanceFailed'));
  assert.ok(codes(logs).includes('eq.eventReward'));
  assert.equal(codes(logs).at(-1), 'eq.setCompleted');
  assert.equal(s.snapshot().collections[0].completed, true);
  assert.ok(s.snapshot().gear.some(g => g.id === 'g1'), 'the equipped shoes stay');
  assert.equal(s.snapshot().materials.stone.COMMON, 10 - 3 + 3, 'stones used, event reward added');
});

test('prepare stops before doing anything when materials are short', async () => {
  const game = fakeGame();
  game.state.inventory.find(x => x.id === 'm1').quantity = 10;
  const { s, logs } = service(game);
  const snap = await s.open('a1');
  const result = await s.prepareCollection(snap.collections[0].id);
  assert.equal(result.ok, false);
  assert.ok(!game.calls.some(c => c.event === 'craft:craftItem'));
  assert.ok(codes(logs).includes('eq.prepareShort'));
});

test('stop during a long enhance ends it between tries', async () => {
  const game = fakeGame({ inventory: [gear('g3', 'it-jersey', 'Starter Jersey', 'COMMON', 0)], enhanceFails: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  const { s, logs } = service(game);
  await s.open('a1');
  const run = s.enhance('g3', 5);
  while (game.calls.filter(c => c.event === 'enhance:item').length < 2) await new Promise(r => setTimeout(r, 2));
  s.stop();
  assert.deepEqual(await run, { stopped: true });
  assert.ok(codes(logs).includes('eq.stopped'));
  assert.ok(game.calls.filter(c => c.event === 'enhance:item').length < 10);
});

test('an enhance answered on enhance:itemError (cooldown) is waited out, not a 20 s timeout', async () => {
  const game = fakeGame({ inventory: [gear('g4', 'it-jersey', 'Starter Jersey', 'COMMON', 0)], enhanceCooldownOnce: true });
  const { s } = service(game);
  await s.open('a1');
  const t0 = Date.now();
  assert.deepEqual(await s.enhance('g4', 2), { level: 2, tries: 2, fails: 0 });
  assert.equal(game.calls.filter(c => c.event === 'enhance:item').length, 3, 'one cooldown answer, retried');
  assert.ok(Date.now() - t0 < 5000);
});

test('plan: a higher + copy does not count (the game needs the exact level) → a new one is crafted and enhanced', () => {
  const inv = [mat('m1', 'Common Fabric', 'COMMON', 100), gear('g5', 'it-jersey', 'Starter Jersey', 'COMMON', 5), gear('g6', 'it-jersey', 'Starter Jersey', 'COMMON', 1), gear('g7', 'it-shoes', 'Starter Shoes', 'COMMON', 0)];
  const g = gearRows({ inventory: inv, players: [] });
  const plan = planCollection(collectionRows([SET])[0], g, recipeRows(RECIPES), materialSummary(inv));
  assert.deepEqual(plan.steps.map(s => `${s.kind}:${s.ref}:+${s.from}→+${s.to}`), ['enhance:g6:+1→+2'], 'the +1 is enhanced to +2, the +5 is left alone');
  const only5 = [mat('m1', 'Common Fabric', 'COMMON', 100), gear('g5', 'it-jersey', 'Starter Jersey', 'COMMON', 5), gear('g7', 'it-shoes', 'Starter Shoes', 'COMMON', 0)];
  const p2 = planCollection(collectionRows([SET])[0], gearRows({ inventory: only5, players: [] }), recipeRows(RECIPES), materialSummary(only5));
  assert.deepEqual(p2.steps.map(s => `${s.kind}:${s.name}${s.to != null ? '+' + s.to : ''}`), ['craft:Starter Jersey', 'enhance:Starter Jersey+2']);
});

test('prepare one piece: only that piece is made and registered, the other ready piece stays in the bag', async () => {
  // A free +0 shoes is ready for the set too; preparing the jersey must not register it.
  const game = fakeGame({ inventory: [gear('g2', 'it-shoes', 'Starter Shoes', 'COMMON', 0)] });
  const { s } = service(game);
  const snap = await s.open('a1');
  const plan = s.planCollection(snap.collections[0].id, 'JERSEY');
  assert.equal(plan.slot, 'JERSEY');
  assert.deepEqual(plan.pieces.map(p => p.slot), ['JERSEY']);
  const result = await s.prepareCollection(snap.collections[0].id, 'JERSEY');
  assert.deepEqual(result, { ok: true, completed: false });
  const regs = game.calls.filter(c => c.event.startsWith('collection:') && c.event !== 'collection:getData');
  assert.deepEqual(regs.map(c => [c.event, c.payload.slot]), [['collection:register', 'JERSEY']]);
  assert.deepEqual(game.state.collections[0].registeredSlots, ['JERSEY']);
  assert.ok(game.state.inventory.some(g => g.id === 'g2'), 'the ready shoes were not registered');
});
