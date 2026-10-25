const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AccountProfileService,readStadiumTelemetry,parseUserBasicInfo,usableApk}=require('../src/main/services/account-profile-service.cjs');

function capturing(basicInfoFor=null){
  const logs=[];
  const service=new AccountProfileService({
    store:{getAccounts:()=>[{id:'main',name:'Main'}],getAccountProfile:()=>({version:1,mainAccountId:null,accounts:{main:{apk:500,tix:7}}})},
    activity:{add:entry=>logs.push(entry)}
  });
  service.setBasicInfoSource(basicInfoFor);
  const merges=[];
  service.merge=(_id,data)=>{merges.push(data);return {apk:500,tix:7,...Object.fromEntries(Object.entries(data).filter(([,value])=>value!=null))};};
  return {service,merges,logs};
}

// Page whose Stadium widget shows the given reads in order (the last one repeats).
function stadiumPage(reads){
  let i=0;
  const page={reads:0,evaluate:async()=>{page.reads++;return reads[Math.min(i++,reads.length-1)];}};
  return page;
}

test('Zero APK has the Auto PK label but no image and no numeric badge',async()=>{
  const prior=global.document;
  const widget={querySelector:()=>null};
  const label={textContent:'Auto PK',parentElement:{parentElement:widget}};
  global.document={
    body:{textContent:''},
    querySelectorAll:selector=>selector==='span'?[label]:[],
    querySelector:selector=>selector.includes('alt="Agent"')?{}:null
  };
  let data;
  try{data=readStadiumTelemetry();}finally{global.document=prior;}
  assert.equal(data.apk,0);
  const {service,merges}=capturing();
  await service.captureStadium('main',{evaluate:async()=>data},{stableMs:0});
  assert.equal(merges[0].apk,0);
});

test('Nonzero APK reads the badge adjacent to the Auto PK image',()=>{
  const prior=global.document;
  const image={parentElement:{querySelectorAll:()=>[{textContent:'515'}]}};
  const widget={querySelector:()=>image};
  const label={textContent:'Auto PK',parentElement:{parentElement:widget}};
  global.document={body:{textContent:''},querySelectorAll:selector=>selector==='span'?[label]:[],querySelector:()=>null};
  try{assert.equal(readStadiumTelemetry().apk,515);}finally{global.document=prior;}
});

test('Late Auto PK widget is read before preserving the previous value',async()=>{
  const {service,merges}=capturing();
  const page=stadiumPage([{stadiumReady:true,apk:null},{stadiumReady:true,apk:0,tix:0}]);
  await service.captureStadium('main',page,{timeoutMs:300,stableMs:0});
  assert.equal(merges[0].apk,0);
  assert.equal(page.reads,2);
});

test('Absent Auto PK widget is unknown and cannot overwrite a stored value',async()=>{
  const {service,merges}=capturing();
  const result=await service.captureStadium('main',{evaluate:async()=>({stadiumReady:true,apk:null})},{timeoutMs:0});
  assert.equal(result,null);
  assert.equal(merges.length,0);
});

test('The zero shown while returning to Stadium is not stored when the game reports the real APK',async()=>{
  const info={apk:120,tix:3,at:Date.now()};
  const {service,merges}=capturing(()=>info);
  const page=stadiumPage([{stadiumReady:true,apk:0,tix:3},{stadiumReady:true,apk:0,tix:3},{stadiumReady:true,apk:120,tix:3}]);
  await service.captureStadium('main',page,{timeoutMs:3000,stableMs:2000});
  assert.equal(merges.length,1);
  assert.equal(merges[0].apk,120);
  assert.equal(merges[0].tix,3);
  assert.equal(page.reads,3);
});

test('A real zero is stored as soon as the game confirms it',async()=>{
  const {service,merges}=capturing(()=>({apk:0,tix:0,at:Date.now()}));
  const page=stadiumPage([{stadiumReady:true,apk:0,tix:0}]);
  await service.captureStadium('main',page,{timeoutMs:3000,stableMs:2000});
  assert.equal(merges[0].apk,0);
  assert.equal(page.reads,1);
});

test('An old userBasicInfo that equals the transient zero does not confirm it',async()=>{
  // Account had 0 APK before claiming; after the claim the widget flashes 0,
  // then the game pushes the new balance and renders it.
  let info={apk:0,tix:0,at:Date.now()-60000};
  const {service,merges}=capturing(()=>info);
  let reads=0;
  const page={evaluate:async()=>{
    if(++reads<3)return {stadiumReady:true,apk:0,tix:0};
    info={apk:50,tix:0,at:Date.now()};
    return {stadiumReady:true,apk:50,tix:0};
  }};
  await service.captureStadium('main',page,{timeoutMs:3000,stableMs:2000});
  assert.equal(merges.length,1);
  assert.equal(merges[0].apk,50);
});

test('Nothing is stored when the widget never settles on a confirmed value, and it is logged once',async()=>{
  const {service,merges,logs}=capturing(()=>({apk:120,tix:0,at:Date.now()}));
  const page=stadiumPage([{stadiumReady:true,apk:0,tix:0}]);
  assert.equal(await service.captureStadium('main',page,{timeoutMs:300,stableMs:5000}),null);
  assert.equal(await service.captureStadium('main',page,{timeoutMs:300,stableMs:5000}),null);
  assert.equal(merges.length,0);
  assert.equal(logs.length,1);
  assert.equal(logs[0].level,'warning');
  assert.equal(logs[0].accountName,'Main');
  assert.equal(logs[0].taskName,'Stadium');
  assert.match(logs[0].message,/could not be confirmed \(screen showed APK 0 · TIX 0\) · kept APK 500 · TIX 7/);
});

test('A confirmed balance change is logged with old and new values',async()=>{
  const {service,logs}=capturing(()=>({apk:120,tix:7,at:Date.now()}));
  await service.captureStadium('main',stadiumPage([{stadiumReady:true,apk:120,tix:7}]),{timeoutMs:1000});
  assert.equal(logs.length,1);
  assert.match(logs[0].message,/Stadium balance updated \(confirmed by the game\) · APK 500 → 120\./);
});

test('userBasicInfo frames give APK and TIX; other frames are ignored',()=>{
  const frame='42["userBasicInfo",{"success":true,"id":"u","funds":10,"ticket":14,"autoPKTickets":423}]';
  assert.deepEqual(parseUserBasicInfo(frame),{apk:423,tix:14,level:null,expCurrent:null,expMax:null});
  assert.equal(parseUserBasicInfo(frame.replace('"funds"','"level":39,"funds"')).level,39);
  assert.equal(parseUserBasicInfo('42["serverTime",1]'),null);
  assert.equal(parseUserBasicInfo('42["userBasicInfo",{"success":false}]'),null);
  assert.equal(parseUserBasicInfo(Buffer.from(frame)),null);
});

test('APK and TIX use the 5% / minimum 3 cut',()=>{
  // APK: 5% cut rounded up, at least 3; the main account keeps everything
  assert.equal(usableApk(106,false),100);
  assert.equal(usableApk(100,false),95);
  assert.equal(usableApk(20,false),17);
  assert.equal(usableApk(61,false),57);
  assert.equal(usableApk(2,false),0);
  assert.equal(usableApk(0,false),0);
  assert.equal(usableApk(106,true),106);
  const accounts=[{id:'main'},{id:'a'},{id:'b'}];
  const profile={version:1,mainAccountId:'main',accounts:{main:{apk:10,tix:5},a:{apk:100,tix:40},b:{apk:19,tix:200}}};
  const service=new AccountProfileService({store:{getAccounts:()=>accounts,getAccountProfile:()=>profile}});
  const snap=service.snapshot();
  assert.deepEqual(snap.effectiveTix,{main:5,a:37,b:190});
  assert.equal(snap.totalUsableTix,232);
  assert.equal(snap.totalUsableApk,121); // 10 + (100-5) + (19-3)
});

test('Level comes from the game message when the Stadium text is missing',async()=>{
  const {service,merges}=capturing(()=>({apk:120,tix:3,level:39,at:Date.now()}));
  await service.captureStadium('main',stadiumPage([{stadiumReady:true,apk:120,tix:3,level:null}]),{timeoutMs:1000});
  assert.equal(merges[0].level,39);
});

test('EXP comes from the game message when the Stadium text is missing',async()=>{
  const {service,merges}=capturing(()=>({apk:1,tix:2,level:37,expCurrent:88107,expMax:136551,at:Date.now()}));
  await service.captureStadium('main',stadiumPage([{stadiumReady:true,apk:1,tix:2,level:null,expCurrent:null}]),{timeoutMs:1000});
  assert.deepEqual([merges[0].expCurrent,merges[0].expMax,merges[0].expPercent],[88107,136551,64]);
});

test('Stadium header with joined text: level and EXP are read from their own elements',()=>{
  const prior=global.document;
  const el=(t,kids=[])=>{const n={textContent:t,children:kids,querySelectorAll:()=>allOf(n)};kids.forEach(k=>k.parentElement=n);return n;};
  const allOf=n=>n.children.flatMap(k=>[k,...allOf(k)]);
  const lv=el('Lv.37'),xp=el('88107 / 136551'),pct=el('65%');
  const header=el('Trophy2Lv.3788107 / 13655165%',[el('Trophy2'),lv,xp,pct]);
  const body=el('',[header]);
  global.document={body,querySelectorAll:()=>allOf(body),querySelector:()=>null};
  try{
    const d=readStadiumTelemetry();
    assert.deepEqual([d.level,d.expCurrent,d.expMax,d.expPercent],[37,88107,136551,65]);
  }finally{global.document=prior;}
});
