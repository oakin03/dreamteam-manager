const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planAssign, scoreOf } = require('../src/main/services/skills-service.cjs');
const { materialPlan, recipeRows, rosterRows } = require('../src/main/services/equipment-service.cjs');

const C = (id, group, tier = 'PRIMARY', player = null) => ({ id, player: player ? { playerId: player } : null, slots: [{ slot: 1, open: true, skill: { group, tier } }, { slot: 2, open: false, skill: null }] });
const plan = { PG: ['ASSISTING_ABILITY', '3_POINTER', 'SCORING_ABILITY'], SG: ['3_POINTER', 'SCORING_ABILITY', null], SF: [], PF: ['REBOUNDING_ABILITY'], C: ['BLOCKING_ABILITY', 'REBOUNDING_ABILITY'] };

test('skill plan: 1st choice before 2nd, a higher tier first, every player gets one', () => {
  const players = [
    { playerId: 'pg', slot: 'PG', order: 0 }, { playerId: 'sg', slot: 'SG', order: 1 }, { playerId: 'c', slot: 'C', order: 2 },
    { playerId: 'bench', slot: null, position: 'PF/C', order: 3 }
  ];
  const containers = [C('k1', '3_POINTER', 'PRIMARY', 'pg'), C('k2', '3_POINTER', 'INTERMEDIATE'), C('k3', 'ASSISTING_ABILITY'), C('k4', 'REBOUNDING_ABILITY'), C('k5', 'VITALITY')];
  const out = planAssign(containers, players, plan);
  assert.equal(out.get('pg').containerId, 'k3', 'PG: 1st choice assisting');
  assert.equal(out.get('sg').containerId, 'k2', 'SG: the purple 3-pointer');
  assert.equal(out.get('bench').containerId, 'k4', 'bench PF/C counts as PF: rebounding');
  assert.ok(out.get('c'), 'C has none of its choices left but still gets one');
  assert.equal(scoreOf(C('x', 'BLOCKING_ABILITY', 'INTERMEDIATE'), 'C', plan), 32);
});

test('materials: Common → Rare is two steps for each kind, with the right ratios', () => {
  const recipes = recipeRows([
    { id: 'uf', resultItem: { name: 'Uncommon Fabric', type: 'MATERIAL', rarity: 'UNCOMMON' }, ingredients: [{ materialId: 'cf', quantity: 10, material: { name: 'Common Fabric', type: 'MATERIAL' } }] },
    { id: 'rf', resultItem: { name: 'Rare Fabric', type: 'MATERIAL', rarity: 'RARE' }, ingredients: [{ materialId: 'uf', quantity: 10, material: { name: 'Uncommon Fabric', type: 'MATERIAL' } }] },
    { id: 'us', resultItem: { name: 'Uncommon Refine Stone', type: 'MATERIAL', rarity: 'UNCOMMON' }, ingredients: [{ materialId: 'cs', quantity: 4, material: { name: 'Common Refine Stone', type: 'MATERIAL' } }] },
    { id: 'rs', resultItem: { name: 'Rare Refine Stone', type: 'MATERIAL', rarity: 'RARE' }, ingredients: [{ materialId: 'us', quantity: 4, material: { name: 'Uncommon Refine Stone', type: 'MATERIAL' } }] }
  ]);
  const steps = materialPlan(recipes, ['Fabric', 'Refine Stone'], 'COMMON', 'RARE');
  assert.deepEqual(steps.map(s => `${s.recipeId}:${s.per}`), ['uf:10', 'us:4', 'rf:10', 'rs:4']);
  assert.throws(() => materialPlan(recipes, ['Fabric'], 'RARE', 'COMMON'));
});

test('roster rows: starters by court order, then the bench, with the gear per slot', () => {
  const rows = rosterRows({ players: [
    { playerId: 'b', benchSlot: 1, player: { name: 'Bench' } },
    { playerId: 'c', slot: 'C', jerseyInventoryId: 'j1', player: { name: 'Center', position: 'C' } },
    { playerId: 'pg', slot: 'PG', player: { name: 'Guard', position: 'PG' } }
  ] });
  assert.deepEqual(rows.map(r => r.playerId), ['pg', 'c', 'b']);
  assert.equal(rows[1].gear.JERSEY, 'j1');
});
