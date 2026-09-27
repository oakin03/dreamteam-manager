const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutoTradeService } = require('../src/main/services/auto-trade-service.cjs');

test('Side clicks the Trade rooms Create Room button and submits the scoped form',async()=>{
  const s=Object.create(AutoTradeService.prototype);
  const steps=[];
  const sentinel=new Error('Side room created; Main joins in the next step');
  const sideRooms={getByRole:()=>({click:async()=>steps.push('open Create Room form')})};
  const createForm={
    waitFor:async({state})=>steps.push(`form ${state}`),
    locator:selector=>({fill:async value=>steps.push(`${selector} = ${value}`)}),
    getByRole:()=>({click:async()=>steps.push('submit Create Room form')})
  };
  const sidePage={locator:selector=>selector.includes('Create trade room')?createForm:sideRooms,
    getByRole:()=>{throw new Error('Global Create Room locator must not be used');}};
  const mainPage={};
  s.runtime={mainAccountId:'main',homeSnapshots:{side:{teamName:'CelticBC'}},config:{roomDescription:'CelticsBC trade',roomPasswordEncrypted:'encrypted'}};
  s._save=()=>{};
  s.sessions=new Map([['main',{session:{page:mainPage}}],['side',{session:{page:sidePage}}]]);
  s._account=id=>({id,name:id});s._returnHome=async()=>{};
  s._openTradeRooms=async page=>{if(page===mainPage)throw sentinel;steps.push('Side Trade rooms visible');};
  s.credentials={decryptSecret:()=> 'room-password'};
  await assert.rejects(s._executeTrade('side',[],[]),error=>error===sentinel);
  assert.deepEqual(steps,[
    'Side Trade rooms visible','open Create Room form','form visible',
    'input[placeholder="e.g. Looking to trade SF"] = CelticsBC trade',
    'input[type="password"] = room-password','submit Create Room form','form hidden'
  ]);
});

test('Main joins the exact Side host row and accepts its browser password prompt during the click',async()=>{
  const s=Object.create(AutoTradeService.prototype);
  s.runtime={homeSnapshots:{side:{teamName:'CelticBC'}}};
  s._openTradeRooms=async()=>{};
  let listener=null,enteredPassword='',searched='',joined=false,desk=false,scrolled=false;
  const join={isEnabled:async()=>true,
    scrollIntoViewIfNeeded:async()=>{scrolled=true;},
    boundingBox:async()=>({width:54,height:24}),
    click:async({position})=>{
    assert.equal(scrolled,true);
    assert.ok(position.x>1 && position.x<12,'click must hit the button padding, outside the Join text span');
    assert.equal(position.y,12);
    assert.ok(listener,'the dialog listener must be attached before Join');
    await new Promise(resolve=>{
      void listener({type:()=> 'prompt',message:()=> 'This room is protected. Enter password:',
        accept:async value=>{enteredPassword=value;resolve();},dismiss:async()=>resolve()});
    });
    joined=true;
  }};
  const row={waitFor:async()=>{},getByRole:(_role,{name})=>{
    assert.equal(name,'Join');return join;
  }};
  const rooms={first:()=>row,count:async()=>1};
  const hostLabel={host:true};
  const page={
    locator:selector=>{
      if(selector.includes('Search by host'))return {fill:async value=>{searched=value;}};
      if(selector==='span.w-32 > span:first-child')return {filter:({hasText})=>{
        assert.ok(hasText.test('CelticBC'));assert.equal(hasText.test('Another Team'),false);return hostLabel;
      }};
      if(selector.includes('Trade rooms')&&selector.endsWith('li'))return {filter:({has})=>{
        assert.equal(has,hostLabel);return rooms;
      }};
      throw new Error(`Unexpected locator ${selector}`);
    },
    on:(event,fn)=>{assert.equal(event,'dialog');listener=fn;},
    off:(event,fn)=>{assert.equal(event,'dialog');assert.equal(listener,fn);listener=null;}
  };
  s._waitTradeDesk=async()=>{assert.equal(joined,true);desk=true;};
  await s._joinSideRoom(page,'side','room-secret');
  assert.equal(searched,'CelticBC');assert.equal(enteredPassword,'room-secret');
  assert.equal(desk,true);assert.equal(listener,null);
});

test('Main refuses multiple rooms with the same Side host instead of joining arbitrarily',async()=>{
  const s=Object.create(AutoTradeService.prototype);
  s.runtime={homeSnapshots:{side:{teamName:'CelticBC'}}};
  s._openTradeRooms=async()=>{};
  let clicked=false;
  const page={locator:selector=>{
    if(selector.includes('Search by host'))return {fill:async()=>{}};
    if(selector==='span.w-32 > span:first-child')return {filter:()=>({})};
    if(selector.includes('Trade rooms'))return {filter:()=>({first:()=>({waitFor:async()=>{}}),count:async()=>2,
      getByRole:()=>({click:async()=>{clicked=true;}})})};
    throw Error(selector);
  }};
  await assert.rejects(s._joinSideRoom(page,'side','secret'),/Multiple Trade rooms/);
  assert.equal(clicked,false);
});

test('The Side session confirms only after both ordered agreement buttons are active',async()=>{
  const s=Object.create(AutoTradeService.prototype);
  s.runtime={homeSnapshots:{side:{teamName:'CelticBC'},main:{teamName:'Yozgt66ers'}}};
  const confirm={isEnabled:async()=>true};
  const agreements={allTextContents:async()=>['CelticBC agrees to trade','Yozgt66ers agrees to trade'],
    nth:index=>({getAttribute:async()=>index===0?'bg-green-500/15':'border-green-400/50'})};
  const page={getByRole:(_role,{name})=>String(name).includes('Confirm')?{first:()=>confirm}:agreements};
  assert.equal(await s._waitTradeConfirmReady(page,'side','main'),confirm);
  agreements.allTextContents=async()=>['Yozgt66ers agrees to trade','CelticBC agrees to trade'];
  await assert.rejects(s._waitTradeConfirmReady(page,'side','main'),/agreement order/);
});

test('The room creator Side clicks Confirm after Main and Side select their own players',async()=>{
  const s=Object.create(AutoTradeService.prototype);
  const steps=[];const sentinel=new Error('Side clicked Confirm');
  const sidePage={id:'side',locator:selector=>selector.includes('Create trade room')?{
    waitFor:async()=>{},locator:()=>({fill:async()=>{}}),getByRole:()=>({click:async()=>{}})
  }:{getByRole:()=>({click:async()=>{}})}};
  const mainPage={id:'main'};
  s.runtime={mainAccountId:'main',config:{roomDescription:'Auto Trade'},problems:[],
    homeSnapshots:{main:{teamName:'Yozgt66ers',tk:1000},side:{teamName:'CelticBC',tk:1000}}};
  s.sessions=new Map([['main',{session:{page:mainPage}}],['side',{session:{page:sidePage}}]]);
  s._save=()=>{};s._account=id=>({id,name:id});s._returnHome=async()=>{};
  s._openTradeRooms=async()=>{};s._joinSideRoom=async page=>{assert.equal(page,mainPage);steps.push('Main Join');};
  s._waitTradeDesk=async page=>{assert.equal(page,sidePage);};s._verifyParticipants=async()=>{};
  s._enrichAndFilterTradePlayers=async(_page,_id,players)=>players;
  s._readTradeRoster=async page=>page===mainPage?[toSide]:[toMain];
  s._tradeBench=(_id,players)=>players;
  s._transferCandidates=(_home,_roles,id)=>id==='main'?[toSide]:[toMain];
  s._fitTrade=(_main,_side,mainToSide,sideToMain)=>({mainToSide,sideToMain});
  s._selectOffer=async(page,players)=>{steps.push(`${page.id} selects ${players.length}`);};
  s._verifyOffer=async()=>{};
  s._agree=async(page)=>{steps.push(`${page.id} agrees`);};
  s._waitTradeConfirmReady=async page=>{
    assert.equal(page,sidePage);steps.push('Side confirms ready');
    return {click:async()=>{steps.push('Side Confirm Trade');throw sentinel;}};
  };
  const toSide={name:'Main Player',imagePath:'/players/main.webp',price:100,selectable:true};
  const toMain={name:'Side Player',imagePath:'/players/side.webp',price:200,selectable:true};
  await assert.rejects(s._executeTrade('side',[toSide],[toMain]),error=>error===sentinel);
  assert.deepEqual(steps,['Main Join','main selects 1','side selects 1','main agrees','side agrees',
    'Side confirms ready','Side Confirm Trade']);
  assert.equal(s.runtime.pendingTrade.sideId,'side');
});

test('Trade waits for its desk to disappear before treating the visible Stadium background as Home',async()=>{
  const s=Object.create(AutoTradeService.prototype);
  let polls=0,captured=0;
  const page={getByText:()=>({first:()=>({isVisible:async()=>++polls===1})}),
    locator:()=>({first:()=>({isVisible:async()=>true})})};
  s.accountProfile={captureStadium:async()=>{captured++;}};
  await s._waitHomeAfterTrade('main',page);
  assert.equal(polls,3);assert.equal(captured,1);
});

test('Trade offer checks a visible state change, and validates it before agree', async () => {
  const service=Object.create(AutoTradeService.prototype);
  let selected=false;
  const page={evaluate:async function(fn){
    if(fn.toString().includes('card.click()')){selected=true;return true;}
    return {found:true,offerCount:selected?1:0,offerLimit:5,
      signature:selected?'selected':'unselected'};
  }};
  const player={name:'A. Player',imagePath:'/players/a.webp'};
  await service._selectOffer(page,[player]);
  await service._verifyOffer(page,[player]);
  selected=false;
  await assert.rejects(service._verifyOffer(page,[player]),/changed before agreement/);
});

test('Trade offer aborts when the click has no observable effect', async () => {
  const service=Object.create(AutoTradeService.prototype);
  const page={evaluate:async fn => fn.toString().includes('card.click()')?true:
    {found:true,offerCount:0,offerLimit:5,signature:'unchanged'}};
  await assert.rejects(service._selectOffer(page,[{name:'A. Player',imagePath:'/players/a.webp'}]),/did not change/);
});

test('Trade agreement cannot fall back to another participant button', async () => {
  const service=Object.create(AutoTradeService.prototype);
  service.runtime={homeSnapshots:{main:{teamName:'Main Team'}}};
  let clicked=false;
  const page={getByRole:()=>({first:()=>({isVisible:async()=>false,click:async()=>{clicked=true;}})})};
  await assert.rejects(service._agree(page,{id:'main',name:'Main'}),/not available/);
  assert.equal(clicked,false);
});
