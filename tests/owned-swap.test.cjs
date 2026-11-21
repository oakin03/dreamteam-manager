const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OwnedSwap, PARK_PRICE } = require('../src/main/services/owned-swap.cjs');

// A small fake account (2026-11-21): roster players with slots, own market listings, and the
// game's refusals — taking back a player already in the roster, selling a temporary player. A
// player taken back from the market lands on the BENCH, so the starting five must be checked.
function fakeAccount({ squad, listings, temporary = [] }) {
  const st = { squad: squad.map(p => ({ ...p })), my: listings.map(l => ({ status: 'LISTED', createdAt: '2026-11-21T08:00:00Z', ...l })), seq: 0, events: [] };
  const benchNext = () => Math.max(0, ...st.squad.map(p => p.benchSlot || 0)) + 1;
  const gs = {
    async call(event, p) {
      st.events.push(event);
      if (event === 'equipment:getUserPlayerAndInventory') return { players: st.squad.map(x => ({ ...x })) };
      if (event === 'market:getMyPlayerListings') return { tickets: st.my.filter(t => t.status !== 'CANCELLED').map(t => ({ id: t.id, playerId: t.playerId, price: t.price, paymentMode: t.paymentMode || 'TICKET', status: t.status, createdAt: t.createdAt, signedSalary: 10, player: { id: t.playerId, name: t.name } })), total: st.my.length };
      if (event === 'getUserBasicInfo') return { salaryCap: 100000, totalSalaryUsed: 0 };
      if (event === 'equipment:unequipSelected' || event === 'equipment:equipItem' || event === 'skills:unassignContainer' || event === 'skills:assignContainerToPlayer') return { success: true };
      if (event === 'market:sellPlayer') {
        if (temporary.includes(p.playerId)) return { success: false, message: 'Temporary players cannot be sold' };
        st.squad = st.squad.filter(x => x.playerId !== p.playerId);
        st.my.push({ id: 'my' + (++st.seq), playerId: p.playerId, price: p.price, paymentMode: p.paymentMode, status: 'LISTED', createdAt: '2026-11-21T09:00:00Z' });
        return { success: true };
      }
      if (event === 'market:cancelPlayerListing') {
        const t = st.my.find(x => x.id === p.ticketId);
        if (st.squad.some(x => x.playerId === t.playerId)) return { success: false, message: 'You already own this player.' };
        t.status = 'CANCELLED';
        st.squad.push({ playerId: t.playerId, slot: null, benchSlot: benchNext() });
        return { success: true, playerId: t.playerId };
      }
      return { success: true };
    },
    async ack(event, p) {
      st.events.push(event);
      if (event === 'updatePlayerPositions') {
        for (const x of st.squad) { const s = p.starters.find(y => y.playerId === x.playerId); const b = p.bench.find(y => y.playerId === x.playerId); x.slot = s ? s.slot : null; x.benchSlot = b ? b.benchSlot : null; }
      }
      return { success: true };
    }
  };
  return { st, os: new OwnedSwap({ gs, userId: 'u1', gapMs: 0 }) };
}
const five = ids => ids.map((playerId, i) => ({ playerId, slot: ['PG', 'SG', 'SF', 'PF', 'C'][i], benchSlot: null }));

test('owned swap: the room-maker taken back from the market is a player NOT in the roster; a refused one → the next', async () => {
  // roster of 5 holds Siakam; his listing must never be the one taken back (Pipelne7, 2026-11-20)
  const { st, os } = fakeAccount({
    squad: five(['deni', 'siakam', 'c', 'd', 'e']),
    listings: [{ id: 'L-deni', playerId: 'deni', name: 'Deni Avdija', price: 50 }, { id: 'L-siakam', playerId: 'siakam', name: 'Pascal Siakam', price: 10 }, { id: 'L-free', playerId: 'free', name: 'Free Agent', price: 30 }]
  });
  const prep = await os.prepare('deni', 'Deni Avdija', { excludeTickets: ['L-deni'] });
  assert.equal(prep.ok, true, prep.message);
  assert.equal(prep.record.filler.name, 'Free Agent');
  assert.equal(st.my.find(t => t.id === 'L-siakam').status, 'LISTED', 'Siakam\'s listing untouched');
});

test('owned swap: a temporary player in the roster is recognised (the game never sells it) and nothing is left changed', async () => {
  const { st, os } = fakeAccount({
    squad: [...five(['booker', 'b', 'c', 'd', 'e']), { playerId: 'f', slot: null, benchSlot: 1 }],
    listings: [{ id: 'L-booker', playerId: 'booker', name: 'Devin Booker', price: 40 }],
    temporary: ['booker']
  });
  const prep = await os.prepare('booker', 'Devin Booker');
  assert.equal(prep.ok, false);
  assert.equal(prep.reason, 'temporary');
  assert.ok(st.squad.some(p => p.playerId === 'booker' && p.slot === 'PG'), 'still a starter');
});

test('owned swap: after everything else (room-maker listed again too) the starting five are checked and put back on their positions', async () => {
  const { st, os } = fakeAccount({
    squad: five(['ace', 'b', 'c', 'd', 'e']),
    listings: [{ id: 'L-ace', playerId: 'ace', name: 'Ace', price: 50 }, { id: 'L-free', playerId: 'free', name: 'Free Agent', price: 30 }]
  });
  const prep = await os.prepare('ace', 'Ace', { excludeTickets: ['L-ace'] });
  assert.equal(prep.ok, true, prep.message);
  // the blocked action: the listing comes back and goes out again at the new price
  const cancel = await os.cancel('L-ace'); assert.equal(cancel.success, true);
  await os.sell('ace', 77, 'APK');
  const back = await os.restore(prep.record);
  assert.equal(back.ok, true);
  assert.deepEqual(back.problems, []);
  // the original came back from the market onto the bench: the final check put it on PG again
  assert.equal(st.squad.find(p => p.playerId === 'ace').slot, 'PG');
  assert.ok(!st.squad.some(p => p.playerId === 'free'), 'the room-maker is on the market again');
  assert.equal(st.my.filter(t => t.playerId === 'free' && t.status === 'LISTED').at(-1).price, 30, 'at its old price');
  // the lineup is set only after the room-maker went back to the market
  const lastSell = st.events.lastIndexOf('market:sellPlayer');
  assert.ok(st.events.lastIndexOf('updatePlayerPositions') > lastSell, 'checked at the very end');
  assert.ok(!st.my.some(t => t.playerId === 'ace' && t.status === 'LISTED' && t.price === PARK_PRICE), 'no park left on the market');
});
