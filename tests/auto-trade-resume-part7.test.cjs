const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutoTradeService } = require('../src/main/services/auto-trade-service.cjs');

test('Restart marks an active saved run interrupted', () => {
  let saved={runtime:{status:'running',checkpoint:{phase:'side',accountId:'side'},results:[]},lastRun:null};
  const store={getAutoTrade:()=>saved,saveAutoTrade:next=>{saved=next;}};
  const s=new AutoTradeService({store,onChanged:()=>{}});
  assert.equal(s.snapshot().runtime.status,'interrupted');
  assert.equal(s.snapshot().runtime.checkpoint.accountId,'side');
});

test('An old disabled Sign error drops only its unclicked intent on restart',()=>{
  let saved={runtime:{status:'error',message:'Sign button is disabled.',pendingScoutBatch:{accountId:'main',before:[],players:[
    {imagePath:'/players/acquired.webp'},
    {imagePath:'/players/not-clicked.webp'}
  ]}},lastRun:null};
  const store={getAutoTrade:()=>saved,saveAutoTrade:next=>{saved=next;}};
  new AutoTradeService({store,onChanged:()=>{}});
  assert.deepEqual(saved.runtime.pendingScoutBatch.players.map(p=>p.imagePath),['/players/acquired.webp']);
  assert.equal(saved.runtime.status,'error');
});

test('An old Make timeout upgrades its stale Scout checkpoint before Continue',()=>{
  let saved={runtime:{status:'error',phase:'main-make',mainAccountId:'main',
    checkpoint:{phase:'main-scout',accountId:'main'},results:[]},lastRun:null};
  const store={getAutoTrade:()=>saved,saveAutoTrade:next=>{saved=next;}};
  new AutoTradeService({store,onChanged:()=>{}});
  assert.deepEqual(saved.runtime.checkpoint,{phase:'main-make',accountId:'main',
    returnPhase:'main-scout',action:'select-players'});
});

test('A full Side roster with remaining Scout attempts is deferred', async () => {
  const s=Object.create(AutoTradeService.prototype);
  s.runtime={mainAccountId:'main',config:{purchaseMaxPrice:500,sideToMainRoleIds:[],mainToSideRoleIds:[]},ledger:[],problems:[]};
  s.sessions=new Map([['main',{session:{page:{}}}],['side',{session:{page:{}}}]]);
  s._account=id=>({id,name:id});s._open=async()=>{};s._returnHome=async()=>{};
  s._roles=()=>[];
  s._safeBoundary=async()=>{};s._scoutLoop=async()=>{};
  s._snapshotHome=async id=>({players:id==='side'?Array.from({length:11},(_,i)=>({imagePath:`/players/${i}.webp`})) : []});
  s._executeTrade=async()=>false;
  s._save=()=>{};
  s.scout={open:async()=>({agents:[],attempts:1}),close:async()=>{}};
  const result=await s._processSide('side');
  assert.equal(result.deferred,true);
});

test('Pending Trade is reconciled only when both roster movements are present', async () => {
  const s=Object.create(AutoTradeService.prototype);
  const toSide={imagePath:'/players/to-side.webp',price:50};
  const toMain={imagePath:'/players/to-main.webp',price:100};
  s.runtime={mainAccountId:'main',status:'interrupted',config:{},ledger:[],pendingTrade:{sideId:'side',mainToSide:[toSide],sideToMain:[toMain],mainBefore:1000,sideBefore:100}};
  s._mainId=()=> 'main';s._account=id=>({id,name:id});
  s.preflight=async()=>({conflicts:[]});s._open=async()=>({page:{}});
  let verified=false;
  s._snapshotHome=async id=>({players:verified?(id==='main'?[toMain]:[toSide]):(id==='main'?[toSide]:[toMain])});
  s._save=()=>{};s._closeAllSessions=async()=>{};
  s._verifyTransferOnFreshDesk=async()=>{throw new Error('Trade could not be verified on either roster.');};
  const transfers=[];s._ledger=(_type,data)=>transfers.push(data);
  s._syncTradeTk=()=>{};
  await assert.rejects(s.reconcilePending(),/could not be verified/);
  assert.ok(s.runtime.pendingTrade);
  assert.equal(transfers.length,0);
  verified=true;
  assert.equal(await s.reconcilePending(),true);
  assert.equal(s.runtime.pendingTrade,null);
  assert.equal(s.runtime.status,'paused');
  assert.deepEqual(s.runtime.checkpoint,{phase:'post-trade',accountId:'side'});
  assert.equal(transfers.length,2);
});

test('Saved room password is encrypted and omitted from renderer snapshots', () => {
  let saved={runtime:{status:'paused',config:{roomPassword:'secret-room'},results:[]},lastRun:{config:{roomPassword:'old-secret'}}};
  const store={getAutoTrade:()=>saved,saveAutoTrade:next=>{saved=next;}};
  const credentials={encryptSecret:text=>`sealed:${text}`};
  const service=new AutoTradeService({store,credentials,onChanged:()=>{}});
  assert.equal(saved.runtime.config.roomPasswordEncrypted,'sealed:secret-room');
  assert.equal(saved.runtime.config.roomPassword,undefined);
  assert.equal(saved.lastRun.config.roomPassword,undefined);
  assert.equal(service.snapshot().runtime.config.roomPasswordEncrypted,undefined);
});

test('App shutdown preserves the checkpoint instead of marking the run stopped', async () => {
  const s=Object.create(AutoTradeService.prototype);
  s.runtime={status:'running',checkpoint:{phase:'side-trade',accountId:'side'},ledger:[]};
  s.pauseWaiters=[];s._save=()=>{};s._closeAllSessions=async()=>{};
  await s.shutdown();
  assert.equal(s.runtime.status,'interrupted');
  assert.equal(s.runtime.checkpoint.phase,'side-trade');
  assert.equal(s.stopRequested,true);
});
