const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CardsService, resolvePlayer, disambiguatePlayerKeys } = require('../src/main/services/cards-service.cjs');
const { AutoTradeService } = require('../src/main/services/auto-trade-service.cjs');
const Module=require('node:module');
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='./browser-service.cjs' && parent?.filename?.endsWith('scout-service.cjs'))return {AGENT_SELECTOR:''};
  return originalLoad.call(this,request,parent,isMain);
};
let ScoutService;
try{({ScoutService}=require('../src/main/services/scout-service.cjs'));}
finally{Module._load=originalLoad;}

const players = [
  { key:'slug:seth-curry', name:'Seth Curry', imagePath:'/assets/players/seth-curry.webp', slug:'seth-curry', team:'GSW', grade:'D-', roleIds:[], active:true },
  { key:'slug:stephen-curry', name:'Stephen Curry', imagePath:'/assets/players/stephen-curry.webp', slug:'stephen-curry', team:'GSW', grade:'S-', roleIds:['sellable'], active:true },
  { key:'slug:trey-jemison', name:'Trey Jemison III', imagePath:'/assets/players/trey-jemison.webp', slug:'trey-jemison', team:'ABC', grade:'D', roleIds:['card'], active:true }
];

test('Scout matches the two S. Curry portraits independently without using team or rating', () => {
  const cards = Object.create(CardsService.prototype);
  cards.snapshot = () => ({ players, teams:[] });
  assert.deepEqual(cards.findForScout({name:'S. Curry',imagePath:'https://game.test/assets/players/seth-curry.webp?size=2',team:'OTHER',grade:'S+'}).roleIds,[]);
  assert.deepEqual(cards.findForScout({name:'S. Curry',imagePath:'/other/players/stephen-curry.webp',team:'OTHER',grade:'D-'}).roleIds,['sellable']);
  assert.equal(cards.findForScout({name:'S. Curry',team:'GSW',grade:'S-'}),null);
});

test('Jemison keeps the Kart role even when the Scout name is abbreviated', () => {
  const cards = Object.create(CardsService.prototype);
  cards.snapshot = () => ({ players, teams:[] });
  assert.deepEqual(cards.findForScout({name:'T. Jemison III',imagePath:'/players/trey-jemison.webp',team:'ZZZ'}).roleIds,['card']);
  assert.equal(cards.findForScout({name:'T. Jemison III',imagePath:'/players/new-season-jemison.webp',grade:'S+'}),null);
  assert.equal(resolvePlayer(players,{name:'S. Curry',imagePath:'/players/unknown-curry.webp'}),null);
});

test('Old Scout portraits absent from Cards never inherit a role from a matching abbreviated name', () => {
  const cards=Object.create(CardsService.prototype);
  cards.snapshot=()=>({players,teams:[]});
  assert.equal(cards.findForScout({name:'S. Curry',imagePath:'/players/old-curry.webp'}),null);
  assert.equal(cards.findForScout({name:'T. Jemison III',imagePath:'/players/old-jemison.webp'}),null);
  assert.equal(cards.findForScout({name:'S. Curry'}),null);
  assert.deepEqual(cards.findForScout({name:'Trey Jemison III'}).roleIds,['card']);
});

test('Auto Trade uses the same unique portrait identity for roster roles', () => {
  const trade = Object.create(AutoTradeService.prototype);
  assert.deepEqual(trade._decorate({name:'S. Curry',imagePath:'/players/seth-curry.webp'},players).roleIds,[]);
  assert.deepEqual(trade._decorate({name:'T. Jemison III',imagePath:'/players/trey-jemison.webp'},players).roleIds,['card']);
  assert.deepEqual(trade._decorate({name:'S. Curry'},players).roleIds,[]);
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
  scout.states=new Map([['main',{status:'closed',session:null,data:{agents:[{name:'T. Jemison III',imagePath:'/players/trey-jemison.webp'}]}}]]);
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
