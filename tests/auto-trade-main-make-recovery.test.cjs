const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AutoTradeService}=require('../src/main/services/auto-trade-service.cjs');

function service(){
  const s=Object.create(AutoTradeService.prototype);
  s.runtime={mainAccountId:'main',config:{purchaseMaxPrice:500,makeRoleIds:['card']},
    ledger:[],problems:[],results:[],checkpoint:{phase:'main-scout',accountId:'main'}};
  s.sessions=new Map();
  s._save=()=>{};
  s._safeBoundary=async()=>{};
  s._recomputeResults=()=>{};
  s._account=id=>({id,name:id});
  s._cardMap=()=>[];
  s._log=()=>{};
  return s;
}

test('The last two cheap Scout bench players are made even when Stadium displays only five',async()=>{
  const s=service();
  const players=[
    {name:'Last One',imagePath:'/players/last-one.webp',price:100},
    {name:'Last Two',imagePath:'/players/last-two.webp',price:200}
  ];
  s.runtime.ledger=players.map(p=>({type:'scout-acquire',accountId:'main',player:p}));
  const steps=[];
  const selected=[];
  const locator={first(){return this;},filter(){return this;},
    click:async()=>steps.push('Make tab'),waitFor:async()=>{},
    getByRole:()=>({click:async()=>steps.push('Convert 2')}),
    evaluateAll:async()=>players.map(p=>({name:p.name,imagePath:p.imagePath}))};
  const page={
    locator:()=>locator,
    getByText:()=>({waitFor:async()=>{}}),
    getByRole:(_role,{name})=>({first(){return this;},isVisible:async()=>false,
      click:async()=>{assert.ok(name.test('Make 2 Star Cards'));steps.push('Make 2');}}),
    evaluate:async(fn,arg)=>fn.name==='selectMakeBenchTile'?
      (steps.push(`Select ${arg.name}`),selected.push(arg.name),true):[...selected]
  };
  s.sessions.set('main',{session:{page}});
  s._returnHome=async()=>{};
  s._snapshotHome=async()=>({rosterCount:5,players:[
    {name:'First 1',imagePath:'/players/first-1.webp'},
    {name:'First 2',imagePath:'/players/first-2.webp'},
    {name:'First 3',imagePath:'/players/first-3.webp'},
    {name:'First 4',imagePath:'/players/first-4.webp'},
    {name:'First 5',imagePath:'/players/first-5.webp'}
  ]});
  s._openMainStarCards=async()=>steps.push('Open Star Cards');
  s._waitMakeBench=async(_id,_page,required)=>{
    assert.deepEqual(required.map(p=>p.name),players.map(p=>p.name));
    return players;
  };
  s._verifyPendingMake=async(_id,pending)=>{
    assert.equal(pending.rosterBefore,7);
    assert.equal(pending.rosterSource,'scout');
    assert.deepEqual(pending.players.map(p=>p.name),players.map(p=>p.name));
    return 2;
  };
  assert.equal(await s._makeEligible('main',{expectedPlayers:players,scoutRosterCount:7}),2);
  assert.ok(steps.includes('Make 2'));
  assert.ok(steps.includes('Convert 2'));
});

test('An empty Make bench returns to Stadium before Main moves on',async()=>{
  const s=service();
  let screen='Stadium';
  const page={
    locator:()=>({first(){return this;},filter(){return this;},click:async()=>{},waitFor:async()=>{}}),
    getByText:()=>({waitFor:async()=>{}})
  };
  s.sessions.set('main',{session:{page}});
  s._returnHome=async()=>{screen='Stadium';};
  s._snapshotHome=async()=>({rosterCount:6,players:[]});
  s._openMainStarCards=async()=>{screen='Make';};
  s._waitMakeBench=async()=>[];
  assert.equal(await s._makeEligible('main'),0);
  assert.equal(screen,'Stadium');
});

test('Stadium Agent behind the visible Make page never counts as returned Home',async()=>{
  const s=service();
  let starCardsOpen=true,backClicks=0,captures=0;
  s.accountProfile={captureStadium:async()=>{captures++;}};
  const page={
    locator:selector=>{
      if(selector==='[role="dialog"][aria-label="Free agency"]')
        return {first:()=>({isVisible:async()=>false})};
      if(selector==='nav[aria-label="Star card sections"]')
        return {first:()=>({isVisible:async()=>starCardsOpen,
          waitFor:async()=>assert.equal(starCardsOpen,false)})};
      if(selector.includes('alt="Agent"'))
        return {first:()=>({isVisible:async()=>true})};
      throw Error(selector);
    },
    getByRole:()=>({first:()=>({click:async()=>{backClicks++;starCardsOpen=false;}})})
  };
  s.sessions.set('main',{session:{page}});
  assert.equal(await s._returnHome('main'),true);
  assert.equal(backClicks,1);
  assert.equal(captures,1);
});

test('Scout roster verification waits for the conversion instead of trusting a hidden bench',async()=>{
  const s=service();
  let reads=0,closed=false;
  const page={evaluate:async()=>++reads<2?7:5};
  s.sessions.set('main',{session:{page}});
  s._returnHome=async()=>{};
  s.scout={open:async()=>({roster:7}),close:async()=>{closed=true;}};
  const pending={accountId:'main',rosterBefore:7,rosterSource:'scout',
    players:[{name:'Last One',imagePath:'/players/last-one.webp'},
      {name:'Last Two',imagePath:'/players/last-two.webp'}]};
  s.runtime.pendingMake=pending;
  assert.equal(await s._verifyPendingMake('main',pending),2);
  assert.equal(reads,3);
  assert.equal(closed,true);
  assert.equal(s.runtime.pendingMake,null);
});
