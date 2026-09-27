const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
Module._load=function(request,parent,isMain){
  if(parent?.filename?.endsWith('browser-service.cjs')){
    if(request==='electron')return {app:{isPackaged:false},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}})}};
    if(request==='playwright')return {chromium:{}};
    if(request==='./store.cjs')return {ensureDir:()=>{}};
  }
  return original.call(this,request,parent,isMain);
};
const mockLoad=Module._load;
let BrowserService;
try{({BrowserService}=require('../src/main/services/browser-service.cjs'));}
finally{Module._load=original;}

test('Main and Side move to opposite edges while keeping their original window dimensions',async()=>{
  const moved=[];
  const session=(id)=>({visible:true,closed:false,page:{},context:{
    pages:()=>[],
    newCDPSession:async()=>({
      send:async(method,arg)=>{
        if(method==='Browser.getWindowForTarget')return {windowId:id};
        if(method==='Browser.getWindowBounds')return {bounds:{x:33,y:44,width:1400,height:930,windowState:'normal'}};
        if(method==='Browser.setWindowBounds'){moved.push({id,bounds:arg.bounds});return {};}
      },
      detach:async()=>{}
    })
  }});
  Module._load=mockLoad;
  try{await BrowserService.prototype.arrangeVisiblePair(session('main'),session('side'));}
  finally{Module._load=original;}
  assert.deepEqual(moved,[
    {id:'main',bounds:{x:0,y:0}},
    {id:'side',bounds:{x:520,y:0}}
  ]);
});
