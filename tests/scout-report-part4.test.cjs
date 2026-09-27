const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module=require('node:module');
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='./browser-service.cjs' && parent?.filename?.endsWith('scout-service.cjs'))return {AGENT_SELECTOR:''};
  return originalLoad.call(this,request,parent,isMain);
};
let ScoutService;
try{({ScoutService}=require('../src/main/services/scout-service.cjs'));}
finally{Module._load=originalLoad;}

test('Scout reads verified price when the optional team field is absent', async () => {
  const scout=Object.create(ScoutService.prototype);
  const report={price:'400 TK',team:null,name:null,identityText:'Scout Report A. Player Price 400 TK'};
  const page={evaluate:async()=>report};
  assert.equal(await scout._readReportFor(page,'A. Player',50),report);
});

test('Scout rejects a stale report from a different player', async () => {
  const scout=Object.create(ScoutService.prototype);
  const page={evaluate:async()=>({price:'400 TK',team:'ABC',name:'B. Player',identityText:'Scout Report B. Player Price 400 TK'})};
  assert.equal(await scout._readReportFor(page,'A. Player',30),null);
});

test('Scout waits through a disabled Sign banner and buys the intended next player once', async () => {
  const scout=Object.create(ScoutService.prototype);
  let reads=0,afterReads=0,clicks=0,scanned=0;
  const target={key:'next-1',index:1,name:'Next Player',canSign:true,signed:false};
  const other={key:'other-2',index:2,name:'Other Player',canSign:true,signed:false};
  const state={data:{roster:5,agents:[target,other]}};
  const button={isEnabled:async()=>reads>=3,click:async()=>{clicks++;assert.ok(reads>=3);}};
  const dialog={isVisible:async()=>true,locator:()=>({filter:()=>({nth:()=>button})})};
  const page={
    locator:()=>({first:()=>dialog}),
    evaluate:async()=>{
      if(!clicks){reads++;return {roster:5,agents:[{...target,canSign:reads>=3,signDisabled:reads<3},other]};}
      afterReads++;
      return {roster:6,rosterMax:11,agents:[{...target,signed:true,canSign:false},{...other,canSign:afterReads>=3,signDisabled:afterReads<3}]};
    }
  };
  scout._ensureOpen=async()=>({account:{id:'main',name:'Main'},state,session:{page}});
  scout.scan=async()=>{scanned++;return {roster:6,agents:[{...target,signed:true},other]};};
  scout.log=()=>{};scout.onChanged=()=>{};
  const result=await scout.sign('main',target.key);
  assert.equal(result.roster,6);
  assert.equal(clicks,1);
  assert.equal(scanned,1);
  assert.ok(afterReads>=3);
});

test('Call Back waits for a temporarily disabled control without a blind retry', async () => {
  const scout=Object.create(ScoutService.prototype);
  let clicks=0;
  const dialog={isVisible:async()=>true};
  const button={click:async options=>{assert.equal(options.timeout,45000);clicks++;}};
  const page={locator:()=>({first:()=>dialog}),getByRole:()=>({first:()=>button}),evaluate:async()=>({agents:[{key:'changed'}],attempts:0})};
  const state={data:{agents:[{key:'old'}],attempts:1}};
  scout._ensureOpen=async()=>({account:{id:'main'},state,session:{page}});
  scout.scan=async()=>({agents:[{key:'changed'}],attempts:0});
  scout.log=()=>{};scout.onChanged=()=>{};
  await scout.callback('main');
  assert.equal(clicks,1);
});

test('A Sign that stays disabled while other players are actionable is skipped',async()=>{
  const scout=Object.create(ScoutService.prototype);
  let clicks=0;
  const target={key:'disabled-0',index:0,name:'Unavailable',canSign:true,signed:false};
  const other={key:'other-1',index:1,name:'Available',canSign:true,signed:false};
  const disabled={...target,canSign:false,signDisabled:true};
  const dialog={isVisible:async()=>true,locator:()=>({filter:()=>({nth:()=>({isEnabled:async()=>false,click:async()=>{clicks++;}})})})};
  const page={locator:()=>({first:()=>dialog}),evaluate:async()=>({agents:[disabled,other],roster:5})};
  const state={data:{roster:5,agents:[target,other]}};
  scout._ensureOpen=async()=>({account:{id:'main'},state,session:{page}});
  scout.scan=async()=>({agents:[disabled,other],roster:5});
  scout.onChanged=()=>{};
  const result=await scout.sign('main',target.key);
  assert.equal(result.signSkipped,true);
  assert.equal(clicks,0);
  assert.equal(state.status,'open');
});
