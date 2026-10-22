const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CardsService, cardProgress, cardEquivalent, buildCardPlayers, readMyPlayerCardTiles } = require('../src/main/services/cards-service.cjs');

test('card equivalents and the 2★ target follow the activation rules', () => {
  assert.equal(cardEquivalent({ 1: 3, 2: 1, 3: 1 }), 3 + 4 + 16);
  // 0★ and 1★ both need one own L2 card (= 4 L1) for 2★; the used card does not count.
  assert.deepEqual(pick(cardProgress(0, { 1: 3 })), { targetStars: 2, current: 3, required: 4, ready: false, guaranteed: true });
  assert.deepEqual(pick(cardProgress(1, { 1: 4 })), { targetStars: 2, current: 4, required: 4, ready: true, guaranteed: true });
  assert.deepEqual(pick(cardProgress(0, { 2: 1 })), { targetStars: 2, current: 4, required: 4, ready: true, guaranteed: true });
  // From 2★ the next star needs an L3 (16) and is not guaranteed.
  assert.deepEqual(pick(cardProgress(2, { 2: 3, 1: 4 })), { targetStars: 3, current: 16, required: 16, ready: true, guaranteed: false });
  assert.equal(cardProgress(5, {}).maxed, true);
});
const pick = p => ({ targetStars: p.targetStars, current: p.current, required: p.required, ready: p.ready, guaranteed: p.guaranteed });

const teams = [{ id: 1, name: 'Atlanta Flamebirds', abbreviation: 'ATL' }, { id: 99, name: 'XTeam', abbreviation: 'X' }];
const roster = (playerId, name, rating, type, stars, avatar) => ({ playerId, currentLevel: stars, totalCardsUsed: 1, player: { id: playerId, name, rating, type, position: 'SF', team: 'LAL', avatarUrl: avatar } });
const card = (playerId, name, level, qty, { type = 'CURRENT', teamId = 1 } = {}) => ({
  quantity: qty, item: { level, linkedPlayerId: playerId, icon: `players/x/${name.toLowerCase().replace(/ /g, '')}.webp`, name,
    linkedPlayer: { id: playerId, name, rating: type === 'XPLAYER' ? 'X' : 'S', type, position: 'SF', starCardTeamAssignment: teamId ? [{ teamId }] : [] } }
});
const rosters = new Map([
  [1, [roster('lebron', 'LeBron James', 'S', 'CURRENT', 2, 'players/newplayers/lakers/lebronjames.webp')]],
  [99, [roster('lebron-x', 'LeBron James', 'X', 'XPLAYER', 0, 'players/newx/lebron.webp')]]
]);
const inventory = [card('lebron', 'LeBron James', 1, 1), card('lebron-x', 'LeBron James', 1, 3, { type: 'XPLAYER', teamId: 99 }),
  card('adou', 'Adou Thiero', 1, 2, { teamId: null }), card('adou', 'Adou Thiero', 2, 1, { teamId: null })];

test('X and normal versions of a player stay separate; No Team owners get one entry', () => {
  const players = buildCardPlayers(teams, inventory, rosters);
  const lebron = players.find(p => p.key === 'id:lebron');
  const lebronX = players.find(p => p.key === 'id:lebron-x');
  assert.deepEqual([lebron.team, lebron.grade, lebron.stars, lebron.cards, lebron.x], ['ATL', 'S', 2, { 1: 1 }, false]);
  assert.deepEqual([lebronX.team, lebronX.grade, lebronX.stars, lebronX.cards, lebronX.x], ['X', 'X', 0, { 1: 3 }, true]);
  assert.deepEqual(lebronX.legacyKeys, [], 'X players never take an old portrait role');
  const adou = players.find(p => p.key === 'id:adou');
  assert.deepEqual([adou.noTeam, adou.team, adou.stars, adou.cards, adou.cardCount], [true, 'No Team', null, { 1: 2, 2: 1 }, 6]);
  assert.equal(players.length, 3);
});

function memoryStore(cards, metadata) {
  const mem = { cards, metadata, roles: [] };
  return { mem, store: {
    getCards: () => mem.cards, saveCards: v => { mem.cards = v; }, getCardMetadata: () => mem.metadata, saveCardMetadata: v => { mem.metadata = v; },
    getCardRoles: () => mem.roles, saveCardRoles: v => { mem.roles = v; }
  } };
}

test('roles move from old portrait / name / No Team keys to player ids, never to the X version', () => {
  const { mem, store } = memoryStore(
    { players: { 'slug:lebronjames': { key: 'slug:lebronjames', name: 'LeBron James' }, 'slug:changedportrait': { key: 'slug:changedportrait', name: 'Adou Thiero' } } },
    { players: { 'slug:lebronjames': { roleIds: ['card'] }, 'slug:changedportrait': { roleIds: ['sellable'] }, 'name:nobodyhere': { roleIds: ['card'] } }, trackedTeams: [] }
  );
  const cards = new CardsService({ store, activity: { add() {} }, onChanged() {} });
  const snap = cards.syncPlayers(buildCardPlayers(teams, inventory, rosters));
  const roles = Object.fromEntries(snap.players.map(p => [p.key, p.roleIds]));
  assert.deepEqual(roles['id:lebron'], ['card']);
  assert.deepEqual(roles['id:lebron-x'], []);
  assert.deepEqual(roles['id:adou'], ['sellable'], 'moved by the unique full name');
  assert.deepEqual(mem.metadata.players['name:nobodyhere'].roleIds, ['card'], 'kept for a player not in the list');
  // A second scan keeps everything in place.
  const again = cards.syncPlayers(buildCardPlayers(teams, inventory, rosters));
  assert.deepEqual(Object.fromEntries(again.players.map(p => [p.key, p.roleIds])), roles);
});

test('teams: X is its own team at the end, No Team is not a team, blockers carry the 2★ progress', () => {
  const { store } = memoryStore({ players: {} }, { players: {}, trackedTeams: [] });
  const cards = new CardsService({ store, activity: { add() {} }, onChanged() {} });
  const snap = cards.syncPlayers(buildCardPlayers(teams, inventory, rosters));
  assert.deepEqual(snap.teams.map(t => [t.team, t.star, t.x]), [['ATL', 2, false], ['X', 0, true]]);
  const x = snap.teams.find(t => t.team === 'X');
  assert.deepEqual(pick(x.blockers[0].progress), { targetStars: 2, current: 3, required: 4, ready: false, guaranteed: true });
});

test('a team given on the Cards page: listed under Modified, never under that team; NONE takes a player out; undo restores', () => {
  const { mem, store } = memoryStore({ players: {} }, { players: {}, trackedTeams: [] });
  const cards = new CardsService({ store, activity: { add() {} }, onChanged() {} });
  cards.syncPlayers(buildCardPlayers(teams, inventory, rosters));
  cards.setCustomTeam('id:adou', 'ATL');      // No Team → ATL
  cards.setCustomTeam('id:lebron', 'NONE');   // ATL → out of its team
  let snap = cards.snapshot();
  const mod = snap.teams.find(t => t.modified);
  assert.ok(mod, 'Modified group exists');
  assert.equal(snap.teams.at(-1).modified, true, 'listed last');
  assert.ok(!snap.teams.some(t => t.team === 'ATL'), 'ATL only had LeBron, who was taken out');
  const adou = snap.players.find(p => p.key === 'id:adou');
  const lebron = snap.players.find(p => p.key === 'id:lebron');
  assert.deepEqual([adou.customTeam, adou.effectiveTeam, lebron.customTeam, lebron.effectiveTeam], ['ATL', 'ATL', 'NONE', null]);
  assert.equal(mem.metadata.players['id:adou'].customTeam, 'ATL');
  cards.setCustomTeam('id:lebron', null);
  snap = cards.snapshot();
  assert.equal(snap.players.find(p => p.key === 'id:lebron').effectiveTeam, 'ATL');
  assert.ok(snap.teams.some(t => t.team === 'ATL'));
});

// Moved from the old Auto Trade tests: the Star Card inventory page reader.
test('Star Card inventory resolves encoded player portraits for post conversion verification', () => {
  const originalDocument=global.document, originalLocation=global.location;
  const player={getAttribute:key=>({alt:'Manual Player',src:'/_next/image?url=%2Fplayers%2Fnewplayers%2Fmanual.webp&w=256&q=75'})[key]||null};
  const card={textContent:'× 1',querySelectorAll:selector=>selector==='img'?[background,player]:[]};
  const background={getAttribute:key=>key==='alt'?'Card Background':'',closest:()=>card};
  global.document={querySelectorAll:()=>[background]};
  global.location={href:'https://www.dreamteamph.com/main'};
  try{
    const cards=readMyPlayerCardTiles();
    assert.equal(cards.length,1);
    assert.equal(cards[0].imagePath,'/players/newplayers/manual.webp');
  }finally{global.document=originalDocument;global.location=originalLocation;}
});

test('Star Card inventory also resolves relative player portraits',()=>{
  const oldDocument=global.document;
  const player={getAttribute:key=>({alt:'Alex Len',src:'players/no-face.webp'})[key]||null};
  const card={textContent:'× 1',querySelectorAll:selector=>selector==='img'?[background,player]:[]};
  const background={getAttribute:key=>key==='alt'?'Card Background':'',closest:()=>card};
  global.document={querySelectorAll:()=>[background]};
  try{assert.equal(readMyPlayerCardTiles()[0].imagePath,'/players/no-face.webp');}
  finally{global.document=oldDocument;}
});
