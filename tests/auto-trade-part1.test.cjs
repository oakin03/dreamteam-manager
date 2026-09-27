const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutoTradeService, readMakeBenchTiles, selectMakeBenchTile, matchMakeConfirmation } = require('../src/main/services/auto-trade-service.cjs');
const { readMyPlayerCardTiles } = require('../src/main/services/cards-service.cjs');

function service(config = {}) {
  const s = Object.create(AutoTradeService.prototype);
  s.runtime = { mainAccountId: 'main', config: { purchaseMaxPrice: 500, purchaseRoleIds: [], sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable'], ...config }, ledger: [], sideOrder: [], completedSides: [], problems: [], results: [] };
  s.sessions = new Map();
  s._save = () => {};
  s._safeBoundary = async () => {};
  s._recomputeResults = () => {};
  s._account = id => ({ id, name: id });
  s._roles = () => [{id:'sellable'},{id:'card'},{id:'stock'}];
  return s;
}

test('Main and Side buy every assigned role and cheap players regardless of Trade direction',()=>{
  const s=service({purchaseMaxPrice:500,sideToMainRoleIds:['card'],mainToSideRoleIds:['sellable']});
  const roles=new Set(s._roles().map(r=>r.id));
  const agent=(role,price)=>({canSign:true,price:`${price} TK`,card:{roleIds:role?[role]:[]}});
  for(const role of ['sellable','card','stock'])
    assert.equal(s._shouldBuyScout(agent(role,900),s.runtime.config,roles),true,role);
  assert.equal(s._shouldBuyScout(agent(null,400),s.runtime.config,roles),true);
  assert.equal(s._shouldBuyScout(agent(null,900),s.runtime.config,roles),false);
  assert.equal(s._shouldBuyScout({...agent('card',200),canSign:false},s.runtime.config,roles),false);
});

test('Side Scout actually signs a sellable player excluded from Side to Main roles',async()=>{
  const s=service({purchaseMaxPrice:500,sideToMainRoleIds:['card'],mainToSideRoleIds:['sellable']});
  const signed=[];
  s.sessions.set('side',{session:{page:{}}});
  s._returnHome=async()=>{};
  s._snapshotHome=async()=>({players:signed.map(x=>({name:x.name,imagePath:x.imagePath})),rosterCount:5+signed.length});
  const sellable={key:'sellable',name:'Sellable',imagePath:'/players/sellable.webp',price:'900 TK',canSign:true,card:{roleIds:['sellable']}};
  s.scout={
    open:async()=>({agents:[sellable],roster:5,rosterMax:11,attempts:0}),
    sign:async()=>{signed.push(sellable);return {agents:[{...sellable,canSign:false,signed:true}],roster:6,rosterMax:11,attempts:0};},
    close:async()=>{}
  };
  await s._scoutLoop('side',{allowMake:false});
  assert.deepEqual(signed.map(p=>p.name),['Sellable']);
  assert.equal(s.runtime.ledger[0].type,'scout-acquire');
});

test('Scout signs an eligible price-only player with empty purchase roles', async () => {
  const s = service();
  let count = 0;
  let signed = 0;
  const cheap = { name: 'Cheap', imagePath: '/players/cheap.webp', bench: true, roleIds: [] };
  s.sessions.set('main', { session: { page: {} } });
  s._safeBoundary = async () => {};
  s._returnHome = async () => {};
  s._snapshotHome = async () => ({ players: count ? [cheap] : [] });
  s._makeEligible = async () => 0;
  s.scout = {
    open: async () => ({ agents: [{ name: 'Cheap', key: 'cheap-0', imagePath: cheap.imagePath, canSign: true, price: '500 TK', card: null }], attempts: 0, roster: 5, rosterMax: 11 }),
    sign: async () => { signed++; count++; return {agents:[{key:'cheap-0',signed:true,canSign:false}],attempts:0,roster:6,rosterMax:11}; },
    close: async () => {},
    snapshot: () => ({ main: { data: { attempts: 0 } } })
  };
  await s._scoutLoop('main', { allowMake: false });
  assert.equal(signed, 1);
  assert.equal(s.runtime.ledger[0].player.price, 500);
});

test('Scout signs a role match above max price and ignores disabled Sign', async () => {
  const s = service();
  let signed = 0;
  let roster = [];
  const player = { name: 'Role Player', imagePath: '/players/role.webp', roleIds: ['card'] };
  s.sessions.set('side', { session: { page: {} } });
  s._safeBoundary = async () => {};
  s._returnHome = async () => {};
  s._snapshotHome = async () => ({ players: [...roster] });
  s.scout = {
    open: async () => ({ agents: [
      { key: 'disabled', canSign: false, price: '100 TK', card: null },
      { key: 'role', canSign: !roster.length, price: '2500 TK', card: { roleIds: ['card'] }, imagePath: player.imagePath }
    ], attempts: 0, roster: 5, rosterMax: 11 }),
    sign: async (_id, key) => { assert.equal(key, 'role'); signed++; roster.push(player); return {agents:[{key:'disabled',canSign:false},{key:'role',signed:true,canSign:false}],attempts:0,roster:6,rosterMax:11}; },
    close: async () => {},
    snapshot: () => ({ side: { data: { attempts: 0 } } })
  };
  await s._scoutLoop('side', { allowMake: false });
  assert.equal(signed, 1);
  assert.equal(s.runtime.ledger[0].player.price, 2500);
});

test('Side routing combines price and role while preserving card destination', () => {
  const s = service();
  s.runtime.ledger.push(
    { type: 'scout-acquire', accountId: 'side', player: { imagePath: '/players/cheap.webp', price: 400 } },
    { type: 'scout-acquire', accountId: 'main', player: { imagePath: '/players/maincheap.webp', price: 300 } },
    { type: 'trade-transfer', from: 'side', to: 'main', routeToCard: true, player: { imagePath: '/players/inbound.webp' } },
    { type: 'trade-transfer', from: 'main', to: 'side', player: { imagePath: '/players/returned.webp' } }
  );
  const side = [
    { imagePath: '/players/cheap.webp', roleIds: [] },
    { imagePath: '/players/card.webp', roleIds: ['card'] },
    { imagePath: '/players/other.webp', roleIds: [] },
    { imagePath: '/players/returned.webp', roleIds: ['card'] }
  ];
  assert.deepEqual(s._transferCandidates({ players: side }, ['card'], 'side', true).map(p => p.imagePath), ['/players/cheap.webp', '/players/card.webp']);
  const main = [
    { imagePath: '/players/maincheap.webp', roleIds: ['sellable'] },
    { imagePath: '/players/inbound.webp', roleIds: ['sellable'] },
    { imagePath: '/players/normal.webp', roleIds: ['sellable'] }
  ];
  assert.deepEqual(s._transferCandidates({ players: main }, ['sellable'], 'main', false).map(p => p.imagePath), ['/players/normal.webp']);
});

test('Unselected expensive roles remain on Side while selected roles and cheap players transfer',()=>{
  const s=service({purchaseMaxPrice:500,sideToMainRoleIds:['sellable','card'],mainToSideRoleIds:['sellable']});
  const players=[
    {name:'Cheap Stock',imagePath:'/players/cheap-stock.webp',roleIds:['stock']},
    {name:'Expensive Stock',imagePath:'/players/stock.webp',roleIds:['stock']},
    {name:'Expensive Sellable',imagePath:'/players/sellable.webp',roleIds:['sellable']},
    {name:'Expensive Card',imagePath:'/players/card.webp',roleIds:['card']}
  ];
  s.runtime.ledger=[
    {type:'scout-acquire',accountId:'side',player:{imagePath:players[0].imagePath,price:300}},
    ...players.slice(1).map(p=>({type:'scout-acquire',accountId:'side',player:{imagePath:p.imagePath,price:900}}))
  ];
  assert.deepEqual(s._transferCandidates({players},['sellable','card'],'side',true).map(p=>p.name),
    ['Cheap Stock','Expensive Sellable','Expensive Card']);
});

test('Side order uses stored TK without opening all Side accounts', async () => {
  const s = service({ sideAccountIds: ['low', 'high', 'unknown'] });
  const profiles = { low: { tk: 50 }, high: { tk: 900 }, unknown: {} };
  const visited = [];
  s._profile = id => profiles[id] || {};
  s._account = id => ({ id, name: id });
  s._safeBoundary = async () => {};
  s._open = async a => { visited.push(a.id); s.sessions.set(a.id, { session: { page: {} } }); return { page: {} }; };
  s._snapshotHome = async () => ({ tk: 0, players: [] });
  s._setRowStatus = () => {};
  s._scoutLoop = async () => {};
  s._returnHome = async () => {};
  s._makeEligible = async () => {};
  s._processSide = async () => {};
  s._closeSession = async id => { s.sessions.delete(id); };
  s._closeAllSessions = async () => {};
  s._finishPersist = () => {};
  s._log = () => {};
  await s._run();
  assert.deepEqual(s.runtime.sideOrder, ['high', 'low', 'unknown']);
  assert.deepEqual(visited, ['main']);
});

test('Trade participant check fails closed on missing identity', async () => {
  const s = service();
  s.runtime.activeSideAccountId='side';
  s.runtime.homeSnapshots = { main: { teamName: 'Main Team' }, side: { teamName: 'Side Team' } };
  const page = { evaluate:async()=>[{team:'Unknown Team',you:false},{team:'Main Team',you:true}] };
  await assert.rejects(s._verifyParticipants(page, { id: 'main', name: 'Main' }, { id: 'side', name: 'Side' }), /could not be verified/);
});

test('Both Trade sessions verify Side on the left and Main on the right with their own You badge',async()=>{
  const s=service();
  s.runtime.activeSideAccountId='side';
  s.runtime.homeSnapshots={main:{teamName:'Yozgt66ers'},side:{teamName:'CelticBC'}};
  const main={id:'main',name:'Main'},side={id:'side',name:'Side'};
  assert.equal(await s._verifyParticipants({evaluate:async()=>[
    {team:'CelticBC',you:false},{team:'Yozgt66ers',you:true}
  ]},main,side),true);
  assert.equal(await s._verifyParticipants({evaluate:async()=>[
    {team:'CelticBC',you:true},{team:'Yozgt66ers',you:false}
  ]},side,main),true);
  await assert.rejects(s._verifyParticipants({evaluate:async()=>[
    {team:'Yozgt66ers',you:true},{team:'CelticBC',you:false}
  ]},main,side),/could not be verified/);
});

test('Confirmed trade updates both TK balances and prefers observed amounts', () => {
  const s=service();
  const updates=[];
  s.runtime.results=[{accountId:'main',startTk:1000},{accountId:'side',startTk:100}];
  s.runtime.homeSnapshots={};
  s.accountProfile={merge:(id,patch)=>updates.push({id,...patch})};
  s._account=id=>({id,name:id});
  s._log=()=>{};
  const mainAfter={tk:null,tkSource:'unknown',players:[]};
  const sideAfter={tk:175,tkSource:'observed',players:[]};
  s._syncTradeTk('main','side',1000,100,[{price:25}],[{price:100}],mainAfter,sideAfter);
  assert.equal(mainAfter.tk,925);
  assert.equal(mainAfter.tkSource,'estimated');
  assert.equal(sideAfter.tk,175);
  assert.equal(sideAfter.tkSource,'observed');
  assert.deepEqual(updates,[
    {id:'main',tk:925,tkSource:'estimated'},
    {id:'side',tk:175,tkSource:'observed'}
  ]);
  assert.equal(s.runtime.results[0].tkDelta,-75);
  assert.equal(s.runtime.results[1].tkDelta,75);
});

test('Scout never retries Call Back when its result is unchanged', async () => {
  const s=service();let clicks=0;
  s.sessions.set('main',{session:{page:{}}});
  s._safeBoundary=async()=>{};
  s._returnHome=async()=>{};
  s._snapshotHome=async()=>({players:[]});
  const data={agents:[{key:'costly',price:'1000 TK',canSign:true}],attempts:1,roster:5,rosterMax:11};
  s.scout={open:async()=>data,callback:async()=>{clicks++;return data;},close:async()=>{}};
  await assert.rejects(s._scoutLoop('main',{allowMake:false}),/second click/);
  assert.equal(clicks,1);
});

test('Scout signs all eligible players in the same dialog with fresh card indexes', async () => {
  const s=service();let opens=0,closes=0,makeCalls=0;const selected=[];
  const first={key:'first-0',canSign:true,price:'100 TK',imagePath:'/players/first.webp'};
  const second={key:'second-0',canSign:true,price:'200 TK',imagePath:'/players/second.webp'};
  let players=[];
  s.sessions.set('main',{session:{page:{}}});
  s._safeBoundary=async()=>{};s._returnHome=async()=>{};
  s._snapshotHome=async()=>({players:[...players]});
  s._makeEligible=async()=>{makeCalls++;return 0;};
  s.scout={
    open:async()=>{opens++;return {agents:[first,second],attempts:0,roster:5,rosterMax:11};},
    sign:async(_id,key)=>{selected.push(key);players.push({imagePath:key==='first-0'?first.imagePath:second.imagePath});return {agents:key==='first-0'?[second]:[{...second,signed:true,canSign:false}],attempts:0,roster:5+players.length,rosterMax:11};},
    close:async()=>{closes++;}
  };
  await s._scoutLoop('main',{allowMake:false});
  assert.deepEqual(selected,['first-0','second-0']);
  assert.equal(opens,1);
  assert.equal(closes,1);
  assert.equal(makeCalls,0);
});

test('Scout uses Call Back for another eligible player before closing the dialog', async () => {
  const s=service();const choices=[];let callbacks=0,closes=0;
  const first={key:'first-0',name:'First',imagePath:'/players/first.webp',price:'100 TK',canSign:true};
  const next={key:'next-0',name:'Next',imagePath:'/players/next.webp',price:'100 TK',canSign:true};
  const costly={key:'costly-0',name:'Costly',imagePath:'/players/costly.webp',price:'900 TK',canSign:true};
  s.sessions.set('side',{session:{page:{}}});
  s._safeBoundary=async()=>{};s._returnHome=async()=>{};
  s._snapshotHome=async()=>({players:choices.map(x=>({name:x.name,imagePath:x.imagePath}))});
  s.scout={
    open:async()=>({agents:[first,costly],attempts:1,roster:5,rosterMax:11}),
    sign:async(_id,key)=>{
      const player=key===first.key?first:next;choices.push(player);
      return {agents:key===first.key?[costly]:[costly,{...next,canSign:false,signed:true}],attempts:key===first.key?1:0,roster:5+choices.length,rosterMax:11};
    },
    callback:async()=>{callbacks++;return {agents:[next,costly],attempts:0,roster:6,rosterMax:11};},
    close:async()=>{closes++;}
  };
  await s._scoutLoop('side',{allowMake:false});
  assert.deepEqual(choices.map(x=>x.name),['First','Next']);
  assert.equal(callbacks,1);
  assert.equal(closes,1);
  assert.equal(s.runtime.ledger.length,2);
});

test('Scout uses Call Back even when the current Scout page has no player cards', async () => {
  const s=service();let callbacks=0,signs=0;
  const player={name:'Available',imagePath:'/players/available.webp'};
  s.sessions.set('side',{session:{page:{}}});
  s._returnHome=async()=>{};
  s._snapshotHome=async()=>({players:signs?[player]:[]});
  s.scout={
    open:async()=>({agents:[],roster:5,rosterMax:11,attempts:1}),
    callback:async()=>{callbacks++;return {agents:[{key:'available',name:player.name,imagePath:player.imagePath,price:'100 TK',canSign:true}],roster:5,rosterMax:11,attempts:0};},
    sign:async()=>{signs++;return {agents:[],roster:6,rosterMax:11,attempts:0};},
    close:async()=>{}
  };
  await s._scoutLoop('side',{allowMake:false});
  assert.deepEqual([callbacks,signs],[1,1]);
});

test('A manually acquired or genuinely disabled Scout player is skipped on the initial scan',async()=>{
  const s=service();let clicked=[];
  const manual={name:'Manual',imagePath:'/players/manual.webp'};
  const automatic={name:'Automatic',imagePath:'/players/automatic.webp'};
  const disabled={key:'manual-0',name:manual.name,imagePath:manual.imagePath,price:'100 TK',signed:true,canSign:false};
  const available={key:'automatic-1',name:automatic.name,imagePath:automatic.imagePath,price:'100 TK',canSign:true};
  s.sessions.set('main',{session:{page:{}}});s._safeBoundary=async()=>{};s._returnHome=async()=>{};
  s._snapshotHome=async()=>({players:clicked.length?[manual,automatic]:[manual]});
  s.scout={
    open:async()=>({agents:[disabled,available],roster:6,rosterMax:11,attempts:0}),
    sign:async(_id,key)=>{clicked.push(key);return {agents:[disabled,{...available,signed:true,canSign:false}],roster:7,rosterMax:11,attempts:0};},
    close:async()=>{}
  };
  await s._scoutLoop('main',{allowMake:false});
  assert.deepEqual(clicked,['automatic-1']);
  assert.deepEqual(s.runtime.ledger.map(e=>e.player.imagePath),[automatic.imagePath]);
});

test('A player disabled after selection is not recorded as an Auto Trade purchase',async()=>{
  const s=service();const attempted=[];
  const manual={key:'manual-0',name:'Manual',imagePath:'/players/manual.webp',price:'100 TK',canSign:true};
  const automatic={key:'automatic-1',name:'Automatic',imagePath:'/players/automatic.webp',price:'100 TK',canSign:true};
  s.sessions.set('main',{session:{page:{}}});s._safeBoundary=async()=>{};s._returnHome=async()=>{};
  s._snapshotHome=async()=>({players:attempted.length>1?[manual,automatic]:[]});
  s.scout={
    open:async()=>({agents:[manual,automatic],roster:5,rosterMax:11,attempts:0}),
    sign:async(_id,key)=>{
      attempted.push(key);
      if(key===manual.key)return {signSkipped:true,agents:[{...manual,signed:true,canSign:false},automatic],roster:6,rosterMax:11,attempts:0};
      return {agents:[{...manual,signed:true,canSign:false},{...automatic,signed:true,canSign:false}],roster:7,rosterMax:11,attempts:0};
    },close:async()=>{}
  };
  await s._scoutLoop('main',{allowMake:false});
  assert.deepEqual(attempted,['manual-0','automatic-1']);
  assert.deepEqual(s.runtime.ledger.map(e=>e.player.imagePath),[automatic.imagePath]);
});

test('Delayed Scout arrivals are verified together and each purchase is recorded once', async () => {
  const s=service();let polls=0;
  const one={name:'One',imagePath:'/players/one.webp',price:90};
  const two={name:'Two',imagePath:'/players/two.webp',price:120};
  s.sessions.set('main',{session:{page:{}}});
  s._safeBoundary=async()=>{};
  s._snapshotHome=async()=>({players:++polls<3?[one]:[one,two]});
  s._ledger=(type,data)=>{assert.equal(type,'scout-acquire');s.runtime.ledger.push(data);};
  const batch={accountId:'main',before:[],players:[one,two]};
  s.runtime.pendingScoutBatch=batch;
  await s._verifyScoutBatch('main',batch,3000);
  assert.equal(polls,3);
  assert.deepEqual(s.runtime.ledger.map(x=>x.player.imagePath),[one.imagePath,two.imagePath]);
  assert.equal(s.runtime.pendingScoutBatch,null);
});

test('Pending Star Card conversion confirms roster twice without opening My Player Card', async () => {
  const s=service();const player={name:'T. Jemison III',imagePath:'/players/trey-jemison.webp'};
  s.sessions.set('main',{session:{page:{}}});
  s._safeBoundary=async()=>{};s._returnHome=async()=>{};
  s._openMainStarCards=async()=>{throw new Error('My Player Card must never open for Make verification');};
  let rosterReads=0;
  s._snapshotHome=async()=>({players:++rosterReads===1?[player]:[],rosterCount:rosterReads===1?6:5});
  s._ledger=(type,data)=>{s.runtime.ledger.push({type,...data});};s._log=()=>{};
  const pending={accountId:'main',players:[player],rosterBefore:6};
  s.runtime.pendingMake=pending;
  assert.equal(await s._verifyPendingMake('main',pending,3000),1);
  assert.equal(rosterReads,3);
  assert.equal(s.runtime.ledger[0].type,'make-card');
  assert.equal(s.runtime.pendingMake,null);
});

test('A saved Make checkpoint does not repeat conversion when the roster has not changed',async()=>{
  const s=service();const player={name:'C. Joseph',imagePath:'/players/no-face.webp'};
  s.sessions.set('main',{session:{page:{}}});
  s._safeBoundary=async()=>{};s._returnHome=async()=>{};
  s._snapshotHome=async()=>({rosterCount:6,players:[player]});
  s._ledger=()=>{throw new Error('No card may be logged without a roster decrease');};
  const pending={accountId:'main',players:[player],rosterBefore:6};
  s.runtime.pendingMake=pending;
  await assert.rejects(s._verifyPendingMake('main',pending,1),/roster has not confirmed/);
  assert.equal(s.runtime.pendingMake,pending);
});

test('The same role can route Side to Main and Main to Side independently', async () => {
  const s=service();
  s.runPromise=null;
  s._mainId=()=> 'main';
  s._account=id=>({id,name:id});
  s._profile=()=>({level:10});
  s._roles=()=>[{id:'card'}];
  s.preflight=async()=>({conflicts:[]});s._run=async()=>{};
  s.store={getAutoTrade:()=>({runtime:null})};
  assert.equal(await s.start({sideAccountIds:['side'],sideToMainRoleIds:['card'],mainToSideRoleIds:['card'],purchaseMaxPrice:500}),true);
  assert.deepEqual(s.runtime.config.sideToMainRoleIds,['card']);
  assert.deepEqual(s.runtime.config.mainToSideRoleIds,['card']);
  await s.runPromise;
});

test('Scout does not silently finish when a signable Price is unreadable', async () => {
  const s=service();s.sessions.set('main',{session:{page:{}}});
  s._safeBoundary=async()=>{};s._returnHome=async()=>{};
  s._snapshotHome=async()=>({players:[]});
  s._account=id=>({id,name:id});
  s.scout={open:async()=>({agents:[{key:'unpriced',canSign:true,price:null}],attempts:0,roster:5,rosterMax:11}),close:async()=>{}};
  await assert.rejects(s._scoutLoop('main',{allowMake:false}),/Price values could not be read/);
});

test('Roster fitting never returns a Trade that violates team size limits', () => {
  const s=service();
  const main={players:Array.from({length:11},()=>({}))};
  const side={players:Array.from({length:5},()=>({}))};
  const fitted=s._fitTrade(main,side,[],[{imagePath:'/players/one.webp'}]);
  assert.deepEqual(fitted,{mainToSide:[],sideToMain:[]});
});

test('Trade capacity uses the observed full roster when two players share one portrait', () => {
  const s=service();
  const main={rosterCount:11,players:Array.from({length:10},(_,i)=>({imagePath:`/players/p${i}.webp`}))};
  const side={rosterCount:11,players:Array.from({length:11},(_,i)=>({imagePath:`/players/s${i}.webp`}))};
  assert.deepEqual(s._fitTrade(main,side,[],[{imagePath:'/players/new.webp'}]),{mainToSide:[],sideToMain:[]});
});

test('Side trades on a full roster, scouts again, and trades its final eligible players before completion', async () => {
  const s=service({sideToMainRoleIds:['card'],mainToSideRoleIds:[]});
  const steps=[];
  const mainPlayers=Array.from({length:5},(_,i)=>({name:`Starter ${i}`,imagePath:`/players/main-${i}.webp`,roleIds:[]}));
  let sidePlayers=Array.from({length:9},(_,i)=>({name:`Side ${i}`,imagePath:`/players/side-${i}.webp`,roleIds:[]}));
  sidePlayers.push({name:'First',imagePath:'/players/first.webp',roleIds:['card']},{name:'Second',imagePath:'/players/second.webp',roleIds:['card']});
  let sideScoutCalls=0;
  s._open=async account=>{const session={page:{}};s.sessions.set(account.id,{session});return session;};
  s.sessions.set('main',{session:{page:{}}});
  s._returnHome=async()=>{};
  s._snapshotHome=async id=>({players:id==='main'?[...mainPlayers]:[...sidePlayers],rosterCount:id==='main'?mainPlayers.length:sidePlayers.length,tk:1000});
  s._scoutLoop=async id=>{
    assert.equal(id,'side');sideScoutCalls++;steps.push('Scout');
    if(sideScoutCalls===2)sidePlayers.push(
      {name:'Third',imagePath:'/players/third.webp',roleIds:['card']});
  };
  s._executeTrade=async (_id,_out,inbound)=>{
    if(!_out.length&&!inbound.length)return false;
    steps.push(`Trade ${inbound.length}`);
    const sent=new Set(inbound.map(p=>p.imagePath));
    sidePlayers=sidePlayers.filter(p=>!sent.has(p.imagePath));
    mainPlayers.push(...inbound);
    return true;
  };
  s._makeEligible=async()=>{steps.push('Make');mainPlayers.splice(5);return 2;};
  s._log=()=>{};
  const outcome=await s._processSide('side');
  assert.equal(outcome.deferred,false);
  assert.deepEqual(steps,['Scout','Trade 2','Make','Scout','Trade 1','Make','Scout']);
  assert.equal(s.runtime.pendingTrade,undefined);
});

test('After a Side Trade, Side Scout runs while Main is still making received cards', async () => {
  const s=service({sideToMainRoleIds:['card'],mainToSideRoleIds:[]});
  const main=Array.from({length:5},(_,i)=>({imagePath:`/players/main${i}.webp`,roleIds:[]}));
  let side=[...Array.from({length:5},(_,i)=>({imagePath:`/players/side${i}.webp`,roleIds:[]})),
    {imagePath:'/players/transfer.webp',roleIds:['card']}];
  let scoutRuns=0,finishMake,made=false,secondScout,rejectScout;
  const sideReopened=new Promise((resolve,reject)=>{secondScout=resolve;rejectScout=reject;});
  s.sessions.set('main',{session:{page:{}}});
  s._open=async account=>{const session={page:{}};s.sessions.set(account.id,{session});return session;};
  s._returnHome=async()=>{};
  s._snapshotHome=async id=>({players:id==='main'?[...main]:[...side],rosterCount:id==='main'?main.length:side.length,tk:1000});
  s._scoutLoop=async()=>{if(++scoutRuns===2)secondScout();};
  s._executeTrade=async(_id,_out,inbound)=>{if(!_out.length&&!inbound.length)return false;side=side.filter(p=>p.imagePath!==inbound[0].imagePath);main.push(...inbound);return true;};
  s._makeEligible=async()=>new Promise(resolve=>{finishMake=()=>{main.splice(5);made=true;resolve(1);};});
  const run=s._processSide('side');
  const timeout=setTimeout(()=>rejectScout(new Error('Side Scout did not restart during Main Make')),1000);
  try{
    await sideReopened;
    assert.equal(made,false);
    assert.equal(typeof finishMake,'function');
    finishMake();
    assert.deepEqual(await run,{deferred:false});
  }finally{clearTimeout(timeout);}
});

test('A full Main roster is converted before joining the Side room when it needs space', async () => {
  const s=service({sideToMainRoleIds:['card'],mainToSideRoleIds:[]});
  const order=[];
  let main=Array.from({length:11},(_,i)=>({imagePath:`/players/main${i}.webp`,roleIds:i===10?['card']:[]}));
  let side=[...Array.from({length:5},(_,i)=>({imagePath:`/players/side${i}.webp`,roleIds:[]})),
    {imagePath:'/players/to-main.webp',roleIds:['card']}];
  s.sessions.set('main',{session:{page:{}}});
  s._open=async account=>{const session={page:{}};s.sessions.set(account.id,{session});return session;};
  s._returnHome=async()=>{};
  s._snapshotHome=async id=>({players:id==='main'?[...main]:[...side],rosterCount:id==='main'?main.length:side.length,tk:1000});
  s._scoutLoop=async()=>{};
  s._makeEligible=async()=>{order.push('Make');main=main.filter(p=>!p.roleIds.includes('card'));return 1;};
  s._executeTrade=async(_id,_out,inbound)=>{if(!_out.length&&!inbound.length)return false;order.push('Trade');main.push(...inbound);side=side.filter(p=>!inbound.some(x=>x.imagePath===p.imagePath));return true;};
  assert.deepEqual(await s._processSide('side'),{deferred:false});
  assert.deepEqual(order,['Make','Trade','Make']);
});

test('Full Main roster opens Star Cards before Scout on startup', async () => {
  const s=service();let makes=0,opens=0;
  s.sessions.set('main',{session:{page:{}}});
  s._safeBoundary=async()=>{};s._returnHome=async()=>{};
  s._snapshotHome=async()=>({rosterCount:11,players:[]});
  s._makeEligible=async()=>{makes++;return 0;};
  s.scout={open:async()=>{opens++;}};
  await s._scoutLoop('main',{allowMake:true});
  assert.equal(makes,1);
  assert.equal(opens,0);
});

test('Main with a full roster makes cards, scouts, then makes remaining eligible players when Scout is exhausted', async () => {
  const s=service();const steps=[];let roster=11;
  s.sessions.set('main',{session:{page:{}}});
  s._returnHome=async()=>{};
  s._snapshotHome=async()=>({rosterCount:roster,players:Array.from({length:roster},(_,i)=>({imagePath:`/players/p${i}.webp`}))});
  s._makeEligible=async()=>{
    steps.push('Make');
    if(roster===11){roster=10;return 1;}
    return 0;
  };
  s.scout={
    open:async()=>{steps.push('Scout');return {agents:[{key:'expensive',price:'9999 TK',canSign:true}],roster,rosterMax:11,attempts:0};},
    close:async()=>{steps.push('Close Scout');}
  };
  await s._scoutLoop('main',{allowMake:true});
  assert.deepEqual(steps,['Make','Scout','Close Scout','Make']);
});

test('Main converts the final eligible bench players even if Scout ends with roster space', async () => {
  const s=service();const steps=[];
  s.sessions.set('main',{session:{page:{}}});
  s._returnHome=async()=>{};
  s._snapshotHome=async()=>({rosterCount:8,players:Array.from({length:8},(_,i)=>({imagePath:`/players/p${i}.webp`}))});
  s._makeEligible=async()=>{steps.push('Make');return 2;};
  s.scout={
    open:async()=>{steps.push('Scout');return {agents:[{key:'expensive',price:'9999 TK',canSign:true}],roster:8,rosterMax:11,attempts:0};},
    close:async()=>{steps.push('Close Scout');}
  };
  await s._scoutLoop('main',{allowMake:true});
  assert.deepEqual(steps,['Scout','Close Scout','Make']);
});

test('Main repeats Scout after a full roster is converted while signable players may remain', async () => {
  const s=service();const steps=[];let roster=10,opens=0;
  s.sessions.set('main',{session:{page:{}}});
  s._returnHome=async()=>{};
  s._snapshotHome=async()=>({rosterCount:roster,players:Array.from({length:roster},(_,i)=>({imagePath:`/players/p${i}.webp`}))});
  s._verifyScoutBatch=async()=>({rosterCount:roster,players:Array.from({length:roster},(_,i)=>({imagePath:`/players/p${i}.webp`}))});
  s._makeEligible=async()=>{steps.push('Make');if(roster===11){roster=10;return 1;}return 0;};
  s.scout={
    open:async()=>{opens++;steps.push('Scout');return opens===1
      ?{agents:[{key:'first',name:'First',imagePath:'/players/first.webp',price:'100 TK',canSign:true}],roster:10,rosterMax:11,attempts:1}
      :{agents:[{key:'costly',price:'9999 TK',canSign:true}],roster:10,rosterMax:11,attempts:0};},
    sign:async()=>{roster=11;return {agents:[{key:'first',signed:true,canSign:false}],roster:11,rosterMax:11,attempts:1};},
    close:async()=>{steps.push('Close Scout');}
  };
  await s._scoutLoop('main',{allowMake:true});
  assert.deepEqual(steps,['Scout','Close Scout','Make','Scout','Close Scout','Make']);
});

test('Main can sign a Kart role player above Max Price before converting it', async () => {
  const s=service({makeRoleIds:['card']});let signed=0,roster=9;
  s.sessions.set('main',{session:{page:{}}});
  s._returnHome=async()=>{};
  s._snapshotHome=async()=>({rosterCount:roster,players:roster===9?[]:[{imagePath:'/players/card.webp'}]});
  s._verifyScoutBatch=async()=>({rosterCount:10,players:[{imagePath:'/players/card.webp'}]});
  s.scout={
    open:async()=>({agents:[{key:'card',name:'Card',imagePath:'/players/card.webp',price:'900 TK',canSign:true,card:{roleIds:['card']}}],roster:9,rosterMax:11,attempts:0}),
    sign:async()=>{roster=10;signed++;return {agents:[{key:'card',signed:true,canSign:false}],roster:10,rosterMax:11,attempts:0};},
    close:async()=>{}
  };
  await s._scoutLoop('main',{allowMake:false});
  assert.equal(signed,1);
});

test('Home Team Bench 6/6 counts as a full roster when two players share the no-face portrait', async () => {
  const s=service();
  s._returnHome=async()=>{};s._cardMap=()=>[];s._profile=()=>({});s._resultRow=()=>null;
  const benchHeading={textContent:'Team Bench',parentElement:{querySelectorAll:()=>[{textContent:'6/6'}]}};
  const images=Array.from({length:11},(_,i)=>({
    getAttribute:key=>key==='src'?`/players/${i<2?'no-face':`player${i}`}.webp`:key==='alt'?(i<2?'':`Player ${i}`):'',
    parentElement:null
  }));
  const oldDocument=global.document;
  global.document={
    body:{innerText:'Team Bench 6/6'},querySelector:()=>null,
    querySelectorAll:selector=>selector==='h3'?[benchHeading]:selector==='img[src*="players/"]'?images:[]
  };
  try{
    const snap=await s._snapshotHome('main',{evaluate:async fn=>fn()},false);
    assert.equal(snap.players.length,10);
    assert.equal(snap.rosterCount,11);
  }finally{global.document=oldDocument;}
});

test('Star Card entry clicks the Stadium image parent button and waits for a visible Make tab', async () => {
  const s=service();const actions=[];
  const button={count:async()=>1,click:async()=>actions.push('Stadium button')};
  const image={first(){return this;},waitFor:async()=>actions.push('image visible'),locator:()=>button};
  const make={first(){return this;},waitFor:async()=>actions.push('Make tab visible')};
  const nav={first(){return this;},waitFor:async()=>actions.push('Star Cards nav visible'),locator:()=>({filter:()=>make})};
  const page={bringToFront:async()=>actions.push('front'),locator:selector=>selector.startsWith('img[alt="Star Card"]')?image:nav};
  s.sessions.set('main',{session:{page,visible:true}});
  s._returnHome=async()=>{};s._log=()=>{};
  await s._openMainStarCards('main',page);
  assert.deepEqual(actions,['front','image visible','Stadium button','Star Cards nav visible','Make tab visible']);
});

test('Verified full Main roster converts cards after Scout closes even when Scout reports spare slots', async () => {
  const s=service();let makes=0,closes=0,signs=0;
  s.sessions.set('main',{session:{page:{}}});
  s._safeBoundary=async()=>{};s._returnHome=async()=>{};
  s._snapshotHome=async()=>({players:Array.from({length:10},(_,i)=>({name:`Player ${i}`,imagePath:`/players/p${i}.webp`}))});
  s._verifyScoutBatch=async()=>({rosterCount:11,players:Array.from({length:11},(_,i)=>({name:`Player ${i}`,imagePath:`/players/p${i}.webp`}))});
  s._makeEligible=async()=>{makes++;return 0;};
  s.scout={
    open:async()=>({agents:[{key:'last',name:'Last',imagePath:'/players/last.webp',price:'100 TK',canSign:true}],roster:9,rosterMax:11,attempts:0}),
    sign:async()=>{signs++;return {agents:[{key:'last',price:'100 TK',canSign:false,signed:true}],roster:9,rosterMax:11,attempts:0};},
    close:async()=>{closes++;}
  };
  await s._scoutLoop('main',{allowMake:true});
  assert.deepEqual([signs,closes,makes],[1,1,1]);
});

test('Make includes a previously purchased bench player with Kart role even without a Stadium bench flag', async () => {
  const s=service({makeRoleIds:['card']});
  const bought={name:'Manual Player',imagePath:'/players/manual.webp',roleIds:['card']};
  const bench=[{name:bought.name,imagePath:bought.imagePath}];
  const clicks=[];
  const locator={first(){return this;},filter(){return this;},click:async()=>{clicks.push('Make tab');},waitFor:async()=>{},getByRole:(_role,{name})=>({click:async()=>clicks.push(String(name))}),evaluateAll:async fn=>{
    const prior=global.location;
    global.location={href:'https://www.dreamteamph.com/main'};
    try{return fn([{getAttribute:key=>key==='alt'?bought.name:'/_next/image?url=%2Fplayers%2Fmanual.webp&w=256'}]);}
    finally{global.location=prior;}
  }};
  const page={
    locator:()=>locator,
    getByText:()=>({waitFor:async()=>{}}),
    getByRole:(_role,{name})=>({first(){return this;},isVisible:async()=>false,click:async()=>{clicks.push(String(name));}}),
    evaluate:async(fn,arg)=>{
      if(fn.name==='readMakeBenchTiles')return bench;
      if(fn.name==='selectMakeBenchTile'){clicks.push(`selected ${arg.path}`);return arg.path===bought.imagePath;}
      return [bought.name];
    }
  };
  s.sessions.set('main',{session:{page}});
  s._returnHome=async()=>{};
  s._snapshotHome=async()=>({players:[{name:bought.name,imagePath:bought.imagePath,bench:false,roleIds:['card']}]});
  s._openMainStarCards=async()=>{clicks.push('Star Cards');};
  s._cardMap=()=>[bought];
  s._inventoryCounts=async()=>new Map([[bought.imagePath,0]]);
  const benchWaits=[];
  s._waitMakeBench=async(_id,_page,required)=>{benchWaits.push(required);return bench;};
  s._verifyPendingMake=async(_id,pending)=>{assert.deepEqual(pending.players,[{name:bought.name,imagePath:bought.imagePath}]);return 1;};
  s._log=()=>{};
  assert.equal(await s._makeEligible('main'),1);
  assert.equal(clicks[0],'Star Cards');
  assert.ok(clicks.includes(`selected ${bought.imagePath}`));
  assert.ok(clicks.some(x=>x.includes('Convert')));
  assert.equal(benchWaits.length,1);
  assert.deepEqual(benchWaits[0].map(p=>p.imagePath),[]);
  assert.equal(clicks.filter(x=>x==='Make tab').length,1);
  assert.ok(!clicks.some(x=>x.includes('My Player Card')));
});

test('Auto Trade makes an abbreviated no-face player directly from Make without an inventory tab',async()=>{
  const s=service({makeRoleIds:['card']});
  const player={name:'C. Joseph',imagePath:'/players/no-face.webp',roleIds:['card']};
  const bench=[{name:'Joseph',imagePath:'players/no-face.webp'}];
  const steps=[];
  const makeTab={first(){return this;},filter({hasText}){steps.push(`tab ${hasText}`);return this;},
    click:async()=>{steps.push('click Make');},waitFor:async()=>{},
    getByRole:(_role,{name})=>({click:async()=>{assert.ok(name.test('Convert 1 to Star Card'));steps.push('Convert 1 to Star Card');}}),
    evaluateAll:async fn=>fn([{getAttribute:key=>key==='alt'?'Cory Joseph':'players/no-face.webp'}])};
  const page={
    locator:selector=>{if(selector.includes('My Player Card'))throw new Error('Inventory tab must stay closed');return makeTab;},
    getByText:()=>({waitFor:async()=>{}}),
    getByRole:(_role,{name})=>({first(){return this;},isVisible:async()=>false,click:async()=>{
      if(name instanceof RegExp && String(name).includes('Make'))assert.ok(name.test('Make 1 Star Card'));
      steps.push(String(name));}}),
    evaluate:async(fn,arg)=>fn.name==='selectMakeBenchTile'?(steps.push('select Joseph'),arg.name===player.name):
      fn.name==='readMakeBenchTiles'?bench:['Cory Joseph']
  };
  s.sessions.set('main',{session:{page}});
  s._returnHome=async()=>{};
  s._snapshotHome=async()=>({rosterCount:6,players:[player]});
  s._openMainStarCards=async()=>{steps.push('Star Card opened');};
  s._cardMap=()=>[player];s._waitMakeBench=async()=>bench;s._log=()=>{};
  s._verifyPendingMake=async(_id,pending)=>{
    assert.equal(pending.rosterBefore,6);
    assert.deepEqual(pending.players,[{name:'C. Joseph',imagePath:'players/no-face.webp'}]);
    return 1;
  };
  assert.equal(await s._makeEligible('main'),1);
  assert.deepEqual(steps.slice(0,3),['Star Card opened','tab Make','click Make']);
  assert.ok(steps.includes('select Joseph'));
  assert.ok(steps.some(x=>x.includes('Convert')));
});

test('Make reads Kart role from the bench when an existing player is missing from the Stadium snapshot', async () => {
  const s=service({makeRoleIds:['card']});
  const bought={name:'Existing Player',imagePath:'/players/existing.webp',roleIds:['card']};
  const page={
    locator:()=>({first(){return this;},filter(){return this;},click:async()=>{},waitFor:async()=>{},getByRole:()=>({click:async()=>{}}),evaluateAll:async()=>[{name:bought.name,imagePath:bought.imagePath}]}),
    getByText:()=>({waitFor:async()=>{}}),
    getByRole:()=>({first(){return this;},isVisible:async()=>false,click:async()=>{}}),
    evaluate:async(fn,arg)=>fn.name==='readMakeBenchTiles'?[{name:bought.name,imagePath:bought.imagePath}]:fn.name==='selectMakeBenchTile'?arg.path===bought.imagePath:[bought.name]
  };
  s.sessions.set('main',{session:{page}});
  s._returnHome=async()=>{};s._openMainStarCards=async()=>{};s._log=()=>{};
  s._snapshotHome=async()=>({players:[]});
  s._cardMap=()=>[bought];
  s._inventoryCounts=async()=>new Map([[bought.imagePath,0]]);
  s._waitMakeBench=async()=>[{name:bought.name,imagePath:bought.imagePath}];
  s._verifyPendingMake=async(_id,pending)=>{assert.equal(pending.players[0].imagePath,bought.imagePath);return 1;};
  assert.equal(await s._makeEligible('main'),1);
});

test('Make rejects a different portrait in confirmation even when the player names match', async () => {
  const s=service({makeRoleIds:['card']});
  const target={name:'S. Curry',imagePath:'/players/stephen-curry.webp',roleIds:['card']};
  let converted=false;
  const page={
    locator:()=>({first(){return this;},filter(){return this;},click:async()=>{},waitFor:async()=>{},evaluateAll:async()=>[{name:'S. Curry',imagePath:'/players/seth-curry.webp'}]}),
    getByText:()=>({waitFor:async()=>{}}),
    getByRole:(_role,{name})=>({first(){return this;},isVisible:async()=>false,click:async()=>{if(String(name).includes('Convert'))converted=true;}}),
    evaluate:async(fn,arg)=>fn.name==='readMakeBenchTiles'?[{name:target.name,imagePath:target.imagePath}]:fn.name==='selectMakeBenchTile'?arg.path===target.imagePath:[target.name]
  };
  s.sessions.set('main',{session:{page}});
  s._returnHome=async()=>{};s._openMainStarCards=async()=>{};
  s._snapshotHome=async()=>({players:[{...target,bench:false}]});
  s._cardMap=()=>[target];s._inventoryCounts=async()=>new Map([[target.imagePath,0]]);
  s._waitMakeBench=async()=>[{name:target.name,imagePath:target.imagePath}];
  await assert.rejects(s._makeEligible('main'),/confirmation player list mismatch/);
  assert.equal(converted,false);
  assert.equal(s.runtime.pendingMake,undefined);
});

test('Make confirmation accepts uniquely matched full names for abbreviated no-face players',()=>{
  const selected=[
    {name:'C. Joseph',imagePath:'/players/no-face.webp'},
    {name:'J. Telfort',imagePath:'/players/no-face.webp'},
    {name:'Caleb Love',imagePath:'/players/new1/caleblove.webp'}
  ];
  const confirmation=[
    {name:'Jahmyl Telfort',imagePath:'players/no-face.webp'},
    {name:'Cory Joseph',imagePath:'players/no-face.webp'},
    {name:'Caleb Love',imagePath:'players/new1/caleblove.webp'}
  ];
  assert.deepEqual(matchMakeConfirmation(selected,confirmation),[selected[1],selected[0],selected[2]]);
  assert.equal(matchMakeConfirmation(selected,[...confirmation.slice(0,2),{name:'Caleb Love',imagePath:'/players/other-love.webp'}]),null);
});

test('Make refuses two indistinguishable no-face players instead of guessing',()=>{
  const selected=[
    {name:'C. Joseph',imagePath:'/players/no-face.webp'},
    {name:'C. Joseph',imagePath:'/players/no-face.webp'}
  ];
  assert.equal(matchMakeConfirmation(selected,[
    {name:'Cory Joseph',imagePath:'players/no-face.webp'},
    {name:'Cody Joseph',imagePath:'players/no-face.webp'}
  ]),null);
});

test('An existing Curry portrait does not inherit the other Curry portrait Kart role on the Make bench', async () => {
  const s=service({makeRoleIds:['card']});
  const stephen={name:'S. Curry',imagePath:'/players/stephen-curry.webp',roleIds:['card']};
  const seth={name:'S. Curry',imagePath:'/players/seth-curry.webp'};
  const page={
    locator:()=>({first(){return this;},filter(){return this;},click:async()=>{}}),
    getByText:()=>({waitFor:async()=>{}}),
    evaluate:async()=>[seth]
  };
  s.sessions.set('main',{session:{page}});
  s._returnHome=async()=>{};s._snapshotHome=async()=>({players:[]});
  s._cardMap=()=>[stephen];s._openMainStarCards=async()=>{};s._log=()=>{};
  s._waitMakeBench=async()=>[seth];
  assert.deepEqual(s._decorate(seth).roleIds,[]);
  assert.equal(await s._makeEligible('main'),0);
  assert.equal(s.runtime.pendingMake,undefined);
});

test('Make reads an encoded player portrait inside Your Bench and clicks only that bench tile', () => {
  const originalDocument=global.document, originalLocation=global.location;
  let benchClicks=0,stadiumClicks=0;
  const heading={tagName:'H3',textContent:'Your Bench',children:[]};
  const panel={querySelectorAll:()=>[],parentElement:null};
  const body={};
  const benchButton={tagName:'BUTTON',className:'cursor-pointer',parentElement:panel,getAttribute:()=>null,click:()=>{benchClicks++;}};
  const stadiumButton={tagName:'BUTTON',className:'cursor-pointer',parentElement:body,getAttribute:()=>null,click:()=>{stadiumClicks++;}};
  const image={tagName:'IMG',parentElement:benchButton,getAttribute:key=>({src:'/_next/image?url=%2Fplayers%2Fnewplayers%2Fmanual.webp&w=256&q=75',alt:'Manual Player'})[key]||null};
  const stadiumImage={...image,parentElement:stadiumButton};
  panel.querySelectorAll=()=>[image];
  heading.parentElement={parentElement:panel,querySelectorAll:()=>[]};
  global.document={body,querySelectorAll:()=>[heading,stadiumImage]};
  global.location={href:'https://www.dreamteamph.com/main'};
  try{
    assert.deepEqual(readMakeBenchTiles(),[{name:'Manual Player',imagePath:'/players/newplayers/manual.webp'}]);
    assert.equal(selectMakeBenchTile({path:'/players/newplayers/manual.webp',name:'Manual Player'}),true);
    assert.deepEqual([benchClicks,stadiumClicks],[1,0]);
  }finally{global.document=originalDocument;global.location=originalLocation;}
});

test('Make also reads and selects a CSS background portrait like the Stadium bench', () => {
  const originalDocument=global.document, originalLocation=global.location;
  let clicks=0;
  const body={},root={querySelectorAll:()=>[portrait],parentElement:body};
  const heading={textContent:'Your Bench',children:[],parentElement:root};
  const portrait={tagName:'DIV',className:'cursor-pointer',parentElement:root,
    getAttribute:key=>key==='style'?'background-image: url("/players/newplayers/pelicans/treymurphy.webp")':'',
    querySelector:()=>null,click:()=>{clicks++;}};
  global.document={body,querySelectorAll:()=>[heading]};
  global.location={href:'https://www.dreamteamph.com/main'};
  try{
    assert.deepEqual(readMakeBenchTiles(),[{name:'',imagePath:'/players/newplayers/pelicans/treymurphy.webp'}]);
    assert.equal(selectMakeBenchTile({path:'/players/newplayers/pelicans/treymurphy.webp',name:'T. Murphy'}),true);
    assert.equal(clicks,1);
  }finally{global.document=originalDocument;global.location=originalLocation;}
});

test('Make reads relative CSS portraits and selects separate no-face bench players by surname',()=>{
  const oldDocument=global.document,oldLocation=global.location;
  const clicked=[];
  const body={};
  const root={parentElement:body,querySelectorAll:()=>portraits};
  const heading={textContent:'Your Bench',children:[],parentElement:root};
  const portraits=[['players/newplayers/knicks/mikalbridges.webp','Bridges'],['players/no-face.webp','Len'],['players/no-face.webp','Telfort']].map(([src,label])=>{
    const clickable={tagName:'DIV',className:'relative cursor-pointer transition-all',parentElement:root,
      getAttribute:()=>null,querySelector:()=>({textContent:label}),click:()=>clicked.push(label)};
    return {tagName:'DIV',parentElement:clickable,getAttribute:key=>key==='style'?`background-image: url("${src}")`:null};
  });
  global.document={body,querySelectorAll:()=>[heading]};
  global.location={href:'https://www.dreamteamph.com/main'};
  try{
    assert.deepEqual(readMakeBenchTiles(),[
      {name:'Bridges',imagePath:'/players/newplayers/knicks/mikalbridges.webp'},
      {name:'Len',imagePath:'/players/no-face.webp'},
      {name:'Telfort',imagePath:'/players/no-face.webp'}
    ]);
    assert.equal(selectMakeBenchTile({path:'/players/no-face.webp',name:'Alex Len'}),true);
    assert.equal(selectMakeBenchTile({path:'/players/no-face.webp',name:'Jahmyl Telfort'}),true);
    assert.deepEqual(clicked,['Len','Telfort']);
  }finally{global.document=oldDocument;global.location=oldLocation;}
});

test('Make may legitimately show no portraits when the roster contains only untradeable players', () => {
  const originalDocument=global.document;
  const body={};
  const heading={textContent:'Your Bench',children:[],parentElement:{querySelectorAll:()=>[],parentElement:body}};
  global.document={body,querySelectorAll:()=>[heading]};
  try{assert.deepEqual(readMakeBenchTiles(),[]);}
  finally{global.document=originalDocument;}
});

test('Make waits for known Scout and Trade arrivals even if one unrelated portrait appears first', async () => {
  const s=service();s._log=()=>{};
  const scout={name:'Scout Player',imagePath:'/players/scout.webp'};
  const traded={name:'Traded Player',imagePath:'/players/traded.webp'};
  let reads=0;
  const page={evaluate:async()=>{
    reads++;
    if(reads===1)return [{name:'Award Player',imagePath:'/players/award.webp'}];
    if(reads===2)return [scout];
    return [scout,traded];
  }};
  const bench=await s._waitMakeBench('main',page,[scout,traded],{stableMs:0,timeoutMs:2000});
  assert.equal(reads,3);
  assert.deepEqual(bench,[scout,traded]);
});

test('Make accepts fewer visible portraits than Stadium bench slots when all known arrivals have loaded', async () => {
  const s=service();s._log=()=>{};
  const arrived={name:'Signed Player',imagePath:'/players/signed.webp'};
  const page={evaluate:async()=>[arrived]};
  assert.deepEqual(await s._waitMakeBench('main',page,[arrived],{stableMs:0,timeoutMs:250}),[arrived]);
});

test('Make can finish with an empty list when no known Scout or Trade player is expected', async () => {
  const s=service();s._log=()=>{};
  const page={evaluate:async()=>[]};
  assert.deepEqual(await s._waitMakeBench('main',page,[],{minWaitMs:0,stableMs:0,timeoutMs:250}),[]);
});

test('Make reports a delayed known Scout player instead of treating an empty list as done', async () => {
  const s=service();s._log=()=>{};
  const page={evaluate:async()=>[]};
  await assert.rejects(s._waitMakeBench('main',page,[{name:'Delayed',imagePath:'/players/delayed.webp'}],
    {stableMs:0,timeoutMs:40}),/did not show 1 known Scout\/Trade player/);
});

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

test('Continue waits for a failed run to close its browser before restarting', async () => {
  const s=service({sideAccountIds:['side']});
  s.runtime.status='error';s.runtime.problems=[{type:'error',message:'old Make error'}];
  s.pauseWaiters=[];
  s._mainId=()=> 'main';s.preflight=async()=>({conflicts:[]});
  let finishOld;
  s.runPromise=new Promise(resolve=>{finishOld=resolve;}).finally(()=>{s.runPromise=null;});
  let restarted=0;
  s._run=async()=>{restarted++;};
  const attempt=s.resume();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(restarted,0);
  finishOld();
  assert.equal(await attempt,true);
  await s.runPromise;
  assert.equal(restarted,1);
  assert.equal(s.runtime.status,'running');
  assert.deepEqual(s.runtime.problems,[]);
});

test('Resuming an old side-order checkpoint checks a full Main bench before Side accounts', async () => {
  const s=service({sideAccountIds:['side']});
  s.runtime.checkpoint={phase:'side-order',accountId:'main'};
  s.runtime.completedSides=[];
  const order=[];
  s._safeBoundary=async()=>{};
  s._open=async account=>{order.push(`open ${account.id}`);const session={page:{}};s.sessions.set(account.id,{session});return session;};
  s._snapshotHome=async()=>({rosterCount:11,players:[],tk:0});
  s._makeEligible=async()=>{order.push('Make');return 1;};
  s._returnHome=async()=>{};s._setRowStatus=()=>{};s._profile=()=>({tk:0});
  s._processSide=async()=>{order.push('Side');return {deferred:false};};
  s._closeSession=async()=>{};s._closeAllSessions=async()=>{};
  s._finishPersist=()=>{};s._log=()=>{};
  await s._run(true);
  assert.ok(order.indexOf('Make')>order.indexOf('open main'));
  assert.ok(order.indexOf('Make')<order.indexOf('Side'));
});

test('Resuming after a confirmed Trade converts cards from a partially filled Main roster', async () => {
  const s=service({sideAccountIds:['side']});
  s.runtime.checkpoint={phase:'post-trade',accountId:'side'};
  s.runtime.completedSides=[];
  const steps=[];
  s._open=async account=>{const session={page:{}};s.sessions.set(account.id,{session});return session;};
  s._snapshotHome=async()=>({rosterCount:7,players:Array.from({length:7},(_,i)=>({imagePath:`/players/p${i}.webp`}))});
  s._makeEligible=async()=>{steps.push('Make');return 1;};
  s._returnHome=async()=>{};s._setRowStatus=()=>{};s._profile=()=>({tk:0});
  s._processSide=async()=>{steps.push('Side');return {deferred:false};};
  s._closeSession=async()=>{};s._closeAllSessions=async()=>{};
  s._finishPersist=()=>{};s._log=()=>{};
  await s._run(true);
  assert.deepEqual(steps,['Make','Side']);
});

test('Continue retries an interrupted Main Make before reopening Scout for the final player',async()=>{
  const s=service({sideAccountIds:['side']});
  s.runtime.checkpoint={phase:'main-make',accountId:'main',returnPhase:'main-scout',action:'open-confirmation'};
  s.runtime.completedSides=[];
  const actions=[];
  s._open=async account=>{actions.push(`open ${account.id}`);const session={page:{}};s.sessions.set(account.id,{session});return session;};
  s._snapshotHome=async()=>({rosterCount:6,players:[{name:'Final Player',imagePath:'/players/final.webp'}],tk:100});
  s._makeEligible=async()=>{actions.push('Make');return 1;};
  s._scoutLoop=async()=>{assert.equal(s.runtime.checkpoint.phase,'main-scout');actions.push('Scout');};
  s._returnHome=async()=>{};s._setRowStatus=()=>{};s._profile=()=>({tk:0});
  s._processSide=async()=>{actions.push('Side');return {deferred:false};};
  s._closeSession=async()=>{};s._closeAllSessions=async()=>{};s._finishPersist=()=>{};s._log=()=>{};
  await s._run(true);
  assert.deepEqual(actions.slice(0,4),['open main','Make','Scout','Side']);
});

test('Continue retries an interrupted Side Trade without repeating the completed Side Scout',async()=>{
  const s=service({sideAccountIds:['side'],sideToMainRoleIds:['card']});
  s.runtime.checkpoint={phase:'side-trade',accountId:'side',action:'create-room'};
  s.runtime.completedSides=[];
  let main=Array.from({length:5},(_,i)=>({imagePath:`/players/main${i}.webp`}));
  let side=[...Array.from({length:5},(_,i)=>({imagePath:`/players/side${i}.webp`})),
    {imagePath:'/players/to-main.webp',roleIds:['card']}];
  const actions=[];
  s._open=async account=>{const session={page:{}};s.sessions.set(account.id,{session});return session;};
  s._snapshotHome=async id=>({players:id==='main'?[...main]:[...side],rosterCount:id==='main'?main.length:side.length,tk:1000});
  s._scoutLoop=async()=>{actions.push('Scout');};
  s._executeTrade=async(_id,_out,inbound)=>{actions.push('Trade');if(!inbound.length)return false;main.push(...inbound);side=side.filter(p=>!inbound.some(x=>x.imagePath===p.imagePath));return true;};
  s._makeEligible=async()=>{actions.push('Make');main=main.slice(0,5);return 1;};
  s._returnHome=async()=>{};s._setRowStatus=()=>{};s._profile=()=>({tk:0});
  s._closeSession=async()=>{};s._closeAllSessions=async()=>{};s._finishPersist=()=>{};s._log=()=>{};
  await s._run(true);
  assert.equal(actions[0],'Trade');
  assert.deepEqual(actions,['Trade','Make','Scout','Trade']);
});

test('Continue checks the unchanged roster and Make bench before retrying an unconfirmed Convert',async()=>{
  const s=service();
  const player={name:'C. Joseph',imagePath:'/players/no-face.webp'};
  const pending={accountId:'main',players:[player],rosterBefore:6,
    rosterPlayers:[player,{name:'Starter',imagePath:'/players/starter.webp'}]};
  s.runtime.pendingMake=pending;
  s.runtime.checkpoint={phase:'main-make',accountId:'main',returnPhase:'main-scout',action:'convert-players'};
  let opened=false,benchChecked=false;
  const page={locator:()=>({filter(){return this;},first(){return this;},click:async()=>{}}),
    getByText:()=>({waitFor:async()=>{}})};
  s.sessions.set('main',{session:{page}});
  s._snapshotHome=async()=>({rosterCount:6,players:[...pending.rosterPlayers]});
  s._openMainStarCards=async()=>{opened=true;};
  s._waitMakeBench=async(_id,_page,required)=>{assert.deepEqual(required,[player]);benchChecked=true;return [player];};
  s._log=()=>{};
  await s._retryUnconfirmedMake('main',pending);
  assert.equal(opened,true);assert.equal(benchChecked,true);
  assert.equal(s.runtime.pendingMake,null);
  assert.equal(s.runtime.checkpoint.phase,'main-make');
});

test('Continue preserves an unconfirmed Convert when the Main roster changed',async()=>{
  const s=service();
  const player={name:'C. Joseph',imagePath:'/players/no-face.webp'};
  const pending={accountId:'main',players:[player],rosterBefore:6,rosterPlayers:[player]};
  s.runtime.pendingMake=pending;
  s.sessions.set('main',{session:{page:{}}});
  s._snapshotHome=async()=>({rosterCount:5,players:[]});
  await assert.rejects(s._retryUnconfirmedMake('main',pending),/unverified roster change/);
  assert.equal(s.runtime.pendingMake,pending);
});

test('Returning Home closes the exact Free agency dialog before reading roster', async () => {
  const s=service();let escaped=false,hidden=false;
  s.accountProfile={captureStadium:async()=>{}};
  s._account=id=>({id,name:id});
  const page={
    locator:selector=>{
      if(selector==='[role="dialog"][aria-label="Free agency"]')return {first:()=>({isVisible:async()=>true,waitFor:async()=>{hidden=true;}})};
      if(selector==='nav[aria-label="Star card sections"]')return {first:()=>({isVisible:async()=>false})};
      if(selector.includes('alt="Agent"'))return {first:()=>({isVisible:async()=>hidden})};
      throw Error(`Unexpected selector: ${selector}`);
    },
    keyboard:{press:async key=>{assert.equal(key,'Escape');escaped=true;}}
  };
  s.sessions.set('main',{session:{page}});
  assert.equal(await s._returnHome('main'),true);
  assert.equal(escaped,true);
  assert.equal(hidden,true);
});
