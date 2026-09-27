const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AccountProfileService,readStadiumTelemetry}=require('../src/main/services/account-profile-service.cjs');

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
  const service=Object.create(AccountProfileService.prototype);
  let merged;
  service.merge=(_id,profile)=>{merged={apk:500,...profile};return merged;};
  await service.captureStadium('main',{evaluate:async()=>data},{apkTimeoutMs:0});
  assert.equal(merged.apk,0);
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
  const service=Object.create(AccountProfileService.prototype);
  let seen=0,merged;
  service.merge=(_id,data)=>{merged={apk:500,...Object.fromEntries(Object.entries(data).filter(([,value])=>value!=null))};return merged;};
  await service.captureStadium('main',{evaluate:async()=>++seen===1?{stadiumReady:true,apk:null}:{stadiumReady:true,apk:0}},{apkTimeoutMs:300});
  assert.equal(merged.apk,0);
  assert.equal(seen,2);
});

test('Absent Auto PK widget is unknown and cannot overwrite a stored value',async()=>{
  const service=Object.create(AccountProfileService.prototype);
  let merged;
  service.merge=(_id,data)=>{merged={apk:500,...Object.fromEntries(Object.entries(data).filter(([,value])=>value!=null))};return merged;};
  await service.captureStadium('main',{evaluate:async()=>({stadiumReady:true,apk:null})},{apkTimeoutMs:0});
  assert.equal(merged.apk,500);
});
