const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  AutoTradeService, readStadiumStartingFive, readOwnTradePlayers
} = require('../src/main/services/auto-trade-service.cjs');

const starters = prefix => Array.from({ length: 5 }, (_, index) => ({
  name: `${prefix} ${index}`, imagePath: `/players/${prefix.toLowerCase()}-${index}.webp`,
  roleIds: ['card'], price: 200, selectable: true
}));

function service() {
  const s = Object.create(AutoTradeService.prototype);
  s.runtime = { mainAccountId: 'main', config: {
    purchaseMaxPrice: 500, sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable']
  }, ledger: [], problems: [], homeSnapshots: {}, protectedStarters: {
    main: starters('Main'), side: starters('Side')
  } };
  s._save = () => {};
  s._account = id => ({ id, name: id });
  s._cardMap = () => [];
  return s;
}

test('Stadium court portrait tiles identify five starters including their short names', () => {
  const old = global.document;
  const players = starters('Court');
  const tiles = players.map(player => ({
    getAttribute: key => key === 'style' ? `background-image: url("${player.imagePath}")` : null,
    parentElement: { querySelector: () => ({ textContent: player.name }) }
  }));
  global.document = { querySelectorAll: selector =>
    selector.includes('-top-[35px]') ? tiles : [] };
  try {
    assert.deepEqual(readStadiumStartingFive(), players.map(({name,imagePath}) => ({name,imagePath})));
  } finally { global.document = old; }
});

test('The opening Stadium snapshot saves the five protected portraits for this account', async () => {
  const s = service();
  delete s.runtime.protectedStarters.side;
  s._returnHome = async () => {};
  s._profile = () => ({ tkSource: 'observed' });
  s._recomputeResults = () => {};
  s.accountProfile = { merge: () => {} };
  const five = starters('Celtic');
  const page = { evaluate: async fn => fn.name === 'readStadiumStartingFive' ? five : {
    teamName: 'CelticBC', tk: 1500, rosterCount: 8, players: five
  } };
  await s._snapshotHome('side', page, true);
  assert.deepEqual(s.runtime.protectedStarters.side, five);
  assert.equal(s.runtime.homeSnapshots.side.rosterCount, 8);
});

test('A later Stadium lineup change protects the newly promoted starter as well', async () => {
  const s = service();
  const original = starters('Side');
  const newlyPromoted = {name:'Promoted',imagePath:'/players/promoted.webp'};
  const current = [...original.slice(0,4),newlyPromoted];
  s._returnHome = async () => {};
  s._profile = () => ({});
  s._recomputeResults = () => {};
  s.accountProfile = { merge: () => {} };
  const page = { evaluate: async fn => fn.name === 'readStadiumStartingFive' ? current : {
    teamName:'Side',tk:1000,rosterCount:7,players:current
  } };
  await s._snapshotHome('side',page,false);
  assert.equal(s._protectedStarter('side',original[4]),true);
  assert.equal(s._protectedStarter('side',newlyPromoted),true);
});

test('Trade roster reads every own card, not the other side or the Offering slots', () => {
  const old = global.document;
  const image = (name, path, status = 'cursor-pointer') => {
    const card = { className: `group relative h-[80px] border-2 ${status}`,
      textContent: `${name} Salary: 1.175 Price: 2.320` };
    return { getAttribute: key => key === 'src' ? path : key === 'alt' ? name : null,
      parentElement: card };
  };
  const ownImages = [image('Bench Player', '/players/bench.webp'),
    image('Other Bench', '/players/other.webp', 'cursor-not-allowed')];
  const ownPanel = { textContent: 'You Funds Offering', querySelectorAll: selector =>
    selector === 'div.grid.grid-cols-6 img[src*="players/"]' ? ownImages : [] };
  const you = { textContent: 'You', parentElement: ownPanel };
  global.document = { querySelectorAll: selector => selector === 'span' ? [you] : [] };
  try {
    assert.deepEqual(readOwnTradePlayers().map(p => [p.name,p.salary,p.price,p.selectable]), [
      ['Bench Player',1175,2320,true], ['Other Bench',1175,2320,false]
    ]);
  } finally { global.document = old; }
});

test('The Trade roster waits for delayed bench cards when Scout observed seven players', async () => {
  const s=service();
  s.runtime.homeSnapshots.side={rosterCount:5};
  s._scoutRosterCounts=new Map([['side',7]]);
  const court=starters('Side').map(p=>({...p,salary:100,price:100}));
  const bench=[0,1].map(i=>({name:`Bench ${i}`,imagePath:`/players/bench-${i}.webp`,
    salary:100,price:250,selectable:true}));
  let reads=0;
  const page={evaluate:async()=>++reads<=4?court:[...court,...bench]};
  const players=await s._readTradeRoster(page,'side');
  assert.equal(players.length,7);
  assert.ok(reads>4);
});

test('Only bench players match transfer rules; manual role and affordable price players are included', () => {
  const s = service();
  const manual = [
    {name:'Manual Card',imagePath:'/players/manual-card.webp',roleIds:['card'],tradePrice:1200},
    {name:'Manual Cheap',imagePath:'/players/manual-cheap.webp',roleIds:[],tradePrice:250},
    {name:'Manual Stock',imagePath:'/players/manual-stock.webp',roleIds:['stock'],tradePrice:1300}
  ];
  const bench = s._tradeBench('side', [...starters('Side'), ...manual]);
  assert.deepEqual(bench, manual);
  assert.deepEqual(s._transferCandidates({players:bench},['card'],'side',true)
    .map(player => player.name), ['Manual Card','Manual Cheap']);
  assert.equal(s._transferCandidates({players:[...starters('Side'), ...manual]},['card'],'side',true)
    .some(player=>player.name.startsWith('Side ')),false);
});

test('An ambiguous no-face court player prevents a Trade rather than risking a starter', () => {
  const s = service();
  s.runtime.protectedStarters.side = [...starters('Side').slice(0,4),
    {name:'J. Brown',imagePath:'/players/no-face.webp'}];
  assert.throws(() => s._tradeBench('side', [
    {name:'Jaylen Brown',imagePath:'/players/no-face.webp'},
    {name:'Jalen Brown',imagePath:'/players/no-face.webp'}
  ]), /cannot be identified uniquely/);
});

test('Stadium hides a manual bench player: Side opens Trade once to inspect, then stops if none qualify', async () => {
  const s = service();
  s.sessions = new Map([['main',{session:{page:{}}}],['side',{session:{page:{}}}]]);
  s._open = async () => {};
  s._returnHome = async () => {};
  s._snapshotHome = async id => ({
    players:starters(id === 'main' ? 'Main' : 'Side'),
    rosterCount:id === 'main' ? 5 : 7, tk:1000
  });
  s._safeBoundary = async () => {};
  s._scoutLoop = async () => {};
  let inspected = 0;
  s._executeTrade = async () => { inspected++;return false; };
  assert.deepEqual(await s._processSide('side'), {deferred:false});
  assert.equal(inspected,1);
});

test('A five-player Stadium snapshot still inspects Trade before finishing the Side account', async () => {
  const s = service();
  s.sessions = new Map([['main',{session:{page:{}}}],['side',{session:{page:{}}}]]);
  s._open = async () => {};
  s._returnHome = async () => {};
  s._snapshotHome = async id => ({
    players:starters(id === 'main' ? 'Main' : 'Side'),rosterCount:5,tk:1000
  });
  s._safeBoundary = async () => {};
  s._scoutLoop = async () => {};
  let inspected = 0;
  s._executeTrade = async () => {inspected++;return false;};
  assert.deepEqual(await s._processSide('side'),{deferred:false});
  assert.equal(inspected,1);
});

test('A Trade wave selects five eligible bench players, leaves the sixth for a later wave, and protects court players', async () => {
  const s = service();
  const mainPage = {}, sidePage = {};
  s.sessions = new Map([['main',{session:{page:mainPage}}],['side',{session:{page:sidePage}}]]);
  s.runtime.homeSnapshots = {main:{teamName:'Main',rosterCount:5,players:starters('Main'),tk:10000},
    side:{teamName:'Side',rosterCount:11,players:starters('Side'),tk:10000}};
  s._returnHome = async () => {};
  s._createSideTradeRoom = async () => '';
  s._joinSideRoom = async () => {};
  s._waitTradeDesk = async () => {};
  s._verifyParticipants = async () => {};
  const six = Array.from({length:6},(_,i)=>({name:`Bench ${i}`,imagePath:`/players/bench-${i}.webp`,
    roleIds:['card'],tradePrice:900,price:900,salary:100,selectable:true}));
  s._readTradeRoster = async page => page === mainPage ? starters('Main') : [...starters('Side'),...six];
  s._enrichAndFilterTradePlayers = async (_page,_id,players) => players;
  const selected = [];
  const stop = new Error('Offers inspected before agreement');
  s._selectOffer = async (page,players) => {
    selected.push({page,players});
    if(page === sidePage)throw stop;
  };
  await assert.rejects(s._executeTrade('side',[],[]),error=>error===stop);
  assert.deepEqual(selected.map(x=>x.players.map(p=>p.name)),[[],six.slice(0,5).map(p=>p.name)]);
  assert.equal(selected[1].players.some(p=>p.name.startsWith('Side ')),false);
});

test('Trade capacity uses both complete live rosters when Stadium shows five', async () => {
  const s = service();
  const mainPage = {}, sidePage = {};
  s.sessions = new Map([['main',{session:{page:mainPage}}],['side',{session:{page:sidePage}}]]);
  s.runtime.homeSnapshots = {
    main:{teamName:'Main',rosterCount:5,players:starters('Main'),tk:10000},
    side:{teamName:'Side',rosterCount:5,players:starters('Side'),tk:10000}
  };
  s._returnHome = async () => {};
  s._createSideTradeRoom = async () => '';
  s._joinSideRoom = async () => {};
  s._waitTradeDesk = async () => {};
  s._verifyParticipants = async () => {};
  const mainBench = Array.from({length:5},(_,i)=>({name:`Main Bench ${i}`,
    imagePath:`/players/main-bench-${i}.webp`,roleIds:[],tradePrice:1000,selectable:true}));
  const sideBench = Array.from({length:6},(_,i)=>({name:`Side Bench ${i}`,
    imagePath:`/players/side-bench-${i}.webp`,roleIds:['card'],tradePrice:900,selectable:true}));
  s._readTradeRoster = async page => page===mainPage ? [...starters('Main'),...mainBench] :
    [...starters('Side'),...sideBench];
  s._enrichAndFilterTradePlayers = async (_page,_id,players) => players;
  const selected=[];
  const stop=new Error('Inspect offers before agreement');
  s._selectOffer=async (page,players) => {
    selected.push({page,players});
    if(page===sidePage)throw stop;
  };
  await assert.rejects(s._executeTrade('side',[],[]),error=>error===stop);
  assert.deepEqual(selected.map(({players})=>players.map(p=>p.name)),[[],['Side Bench 0']]);
});

test('Every requested offer changes the player card and the Offering count', async () => {
  const s = service();
  const selected = new Set();
  const page = { evaluate: async (fn,arg) => {
    const path = arg.path;
    if(fn.toString().includes('card.click()')){
      selected.add(path);return true;
    }
    return {found:true,offerCount:selected.size,offerLimit:5,
      signature:selected.has(path)?`selected:${path}`:`unselected:${path}`};
  } };
  const players = [
    {name:'First Bench',imagePath:'/players/first-bench.webp'},
    {name:'Second Bench',imagePath:'/players/second-bench.webp'}
  ];
  await s._selectOffer(page,players);
  await s._verifyOffer(page,players);
  assert.equal(selected.size,2);
  selected.delete(players[1].imagePath);
  await assert.rejects(s._verifyOffer(page,players),/selection changed/);
});

test('An empty planned offer rejects an extra player selected in the game', async () => {
  const s = service();
  const page = {evaluate: async fn => {
    assert.equal(fn.name,'readOwnTradeOfferCount');
    return {count:1,limit:5};
  }};
  await assert.rejects(s._selectOffer(page,[]),/unexpected player/);
});

test('Completed Trade is verified against both live rosters before closing the verification room', async () => {
  const s = service();
  const outgoing = {name:'Manual Sellable',imagePath:'/players/sellable.webp'};
  const incoming = {name:'Manual Card',imagePath:'/players/card.webp'};
  let mainReads = 0, sideReads = 0;
  const clicked = [];
  const page = id => ({
    evaluate: async fn => {assert.equal(fn.name,'readOwnTradePlayers');
      if(id==='main')return ++mainReads < 2 ? [outgoing] : [incoming];
      return ++sideReads < 2 ? [incoming] : [outgoing];},
    getByRole: () => ({first: () => ({click: async () => clicked.push(id)})})
  });
  const mainPage = page('main'), sidePage = page('side');
  s.sessions = new Map([['main',{session:{page:mainPage}}],['side',{session:{page:sidePage}}]]);
  s._createSideTradeRoom = async () => '';
  s._joinSideRoom = async () => {};
  s._waitTradeDesk = async () => {};
  s._verifyParticipants = async () => {};
  s._waitHomeAfterTrade = async () => {};
  await s._verifyTransferOnFreshDesk('side',[outgoing],[incoming]);
  assert.ok(mainReads>=2 && sideReads>=2);
  assert.deepEqual(clicked,['main','side']);
});
