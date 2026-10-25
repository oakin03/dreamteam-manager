const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CardsService, resolvePlayer, disambiguatePlayerKeys } = require('../src/main/services/cards-service.cjs');
const { ScoutService } = require('../src/main/services/scout-service.cjs');

const players = [
  { key:'slug:seth-curry', name:'Seth Curry', imagePath:'/assets/players/seth-curry.webp', slug:'seth-curry', team:'GSW', grade:'D-', roleIds:[], active:true },
  { key:'slug:stephen-curry', name:'Stephen Curry', imagePath:'/assets/players/stephen-curry.webp', slug:'stephen-curry', team:'GSW', grade:'S-', roleIds:['sellable'], active:true },
  { key:'slug:trey-jemison', name:'Trey Jemison III', imagePath:'/assets/players/trey-jemison.webp', slug:'trey-jemison', team:'ABC', grade:'D', roleIds:['card'], active:true }
];

test('Scout matches cards only by the game player id, never by portrait or name', () => {
  const cards = Object.create(CardsService.prototype);
  cards.snapshot = () => ({ players: players.map((p, i) => ({ ...p, playerId: 'p' + i })), teams: [] });
  assert.deepEqual(cards.findForScout({ playerId: 'p1', name: 'S. Curry' }).roleIds, ['sellable']);
  assert.deepEqual(cards.findForScout({ playerId: 'p2', name: 'Someone Else' }).roleIds, ['card']);
  assert.equal(cards.findForScout({ name: 'Trey Jemison III', imagePath: '/players/trey-jemison.webp' }), null);
  assert.equal(cards.findForScout({ playerId: 'missing', name: 'Stephen Curry' }), null);
});

test('Cards refresh does not transfer a role by a shared initial and surname', () => {
  let data={players:{old:{key:'old',name:'S. Curry',imagePath:'',active:true}}};
  let meta={players:{old:{roleIds:['sellable']}},trackedTeams:[]};
  const cards=Object.create(CardsService.prototype);
  cards.store={getCards:()=>data,getCardMetadata:()=>meta,getCardRoles:()=>[],saveCards:value=>{data=value;},saveCardMetadata:value=>{meta=value;}};
  cards.runtime={};
  cards.onChanged=()=>{};
  cards.syncPlayers(players.slice(0,2));
  assert.equal(meta.players['slug:seth-curry'],undefined);
  assert.equal(meta.players['slug:stephen-curry'],undefined);
});

test('An already open Scout shows current roles after the Cards role assignment changes', () => {
  let revision=1;
  const scout=Object.create(ScoutService.prototype);
  scout.cards={findForScout:agent=>({roleIds:revision===1?['sellable']:['card'],team:null,stars:0})};
  scout.store={revision:()=>revision};
  scout.states=new Map([['main',{status:'idle',open:false,data:{agents:[{playerId:'p2',name:'T. Jemison III'}]}}]]);
  assert.deepEqual(scout.snapshot().main.data.agents[0].card.roleIds,['sellable']);
  revision=2;
  assert.deepEqual(scout.snapshot().main.data.agents[0].card.roleIds,['card']);
});

test('All shared portrait names stay separate while an ambiguous initial remains unresolved', () => {
  const entries=disambiguatePlayerKeys([
    {name:'Seth Curry',imagePath:'/players/curry.webp'},
    {name:'Stephen Curry',imagePath:'/players/curry.webp'},
    {name:'Trey Jemison III',imagePath:'/players/jemison.webp'}
  ]);
  assert.equal(new Set(entries.map(p=>p.key)).size,3);
  assert.equal(resolvePlayer(entries,{name:'S. Curry',imagePath:'/players/curry.webp'}),null);
  assert.equal(resolvePlayer(entries,{name:'Seth Curry',imagePath:'/players/curry.webp'}).key,entries[0].key);
  assert.equal(resolvePlayer(entries,{name:'Stephen Curry',imagePath:'/players/curry.webp'}).key,entries[1].key);
  assert.equal(resolvePlayer(entries,{name:'Unrelated Player',imagePath:'/players/jemison.webp'}),null);
});

test('Unresolvable duplicate card identities stop a refresh before role data changes', () => {
  assert.throws(()=>disambiguatePlayerKeys([
    {name:'S. Curry',imagePath:'/players/curry.webp'},
    {name:'S. Curry',imagePath:'/players/curry.webp'}
  ]),/güvenli biçimde ayrılamadı/);
  let saved=false;
  const cards=Object.create(CardsService.prototype);
  cards.store={getCards:()=>({players:{}}),getCardMetadata:()=>({players:{}}),saveCards:()=>{saved=true;},saveCardMetadata:()=>{saved=true;}};
  assert.throws(()=>cards.syncPlayers([
    {key:'slug:collision',name:'Seth Curry'},
    {key:'slug:collision',name:'Stephen Curry'}
  ]),/aynı kimlikle/);
  assert.equal(saved,false);
});
