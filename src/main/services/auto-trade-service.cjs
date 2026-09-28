const crypto = require('crypto');
const { resolvePlayer, playerKeyOf, namesMatch } = require('./cards-service.cjs');

const TRADE_ICON = 'img[alt="Trade"][src*="/ui/trade.webp"]';
const SCOUT_DIALOG = '[role="dialog"][aria-label="Free agency"]';
const ROOM_DIALOG = '[role="dialog"][aria-label="Trade rooms"]';
const CREATE_DIALOG = '[role="dialog"][aria-label="Create trade room"]';
const MAKE_CONFIRM = '[role="dialog"][aria-label="Confirm star card creation"]';
const MAKE_PROGRESS = '[role="alertdialog"][aria-label="Creating star cards"]';
const HOME_AGENT = 'img[alt="Agent"], img[src*="/stadium/scout.webp"]';
const STAR_CARD_IMAGE = 'img[alt="Star Card"], img[src*="/ui/star_card.webp"]';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function num(v) {
  const s = String(v ?? '').replace(/[^0-9-]/g, '');
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function clean(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
function escapeRegExp(v) { return String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function normPath(v) {
  const path=clean(v).replace(/^https?:\/\/[^/]+/i,'').split('?')[0].toLowerCase();
  return /^\/?players\//.test(path)?`/${path.replace(/^\/+/, '')}`:path;
}
function normName(v) { return clean(v).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function placeholderPath(v) { return /\/players\/(?:no-face|noface|avatar)\.[a-z]+$/i.test(normPath(v)); }
function identityOf(p) {
  const path=normPath(p?.imagePath),name=normName(p?.name);
  return placeholderPath(path)&&name?`name:${name}`:path||name;
}
function normalizeTradeName(v) {
  return clean(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function tradeSurname(v) {
  const parts=normalizeTradeName(v).split(' ').filter(Boolean);
  return parts[parts.length-1]||'';
}
function tradeIdentityOf(p) {
  return [
    normalizeTradeName(p?.name),
    clean(p?.position).toUpperCase(),
    clean(p?.rating).toUpperCase(),
    num(p?.salary)??'',
    num(p?.price)??''
  ].join('|');
}
function resolveTradePlayer(players, subject) {
  const pool=(players||[]).filter(Boolean);
  const wantedName=normalizeTradeName(subject?.name);
  let candidates=wantedName?pool.filter(p=>normalizeTradeName(p?.name)===wantedName):[];
  if(!candidates.length && subject?.name)
    candidates=pool.filter(p=>p?.name&&namesMatch(p.name,subject.name));
  if(!candidates.length){
    const surname=tradeSurname(subject?.name);
    if(surname)candidates=pool.filter(p=>tradeSurname(p?.name)===surname);
  }
  const narrow=(key,normalize)=>{
    const wanted=subject?.[key];
    if(wanted==null||wanted==='')return;
    const matches=candidates.filter(p=>p?.[key]!=null&&p?.[key]!==''&&normalize(p[key])===normalize(wanted));
    if(matches.length)candidates=matches;
  };
  narrow('position',v=>clean(v).toUpperCase());
  narrow('rating',v=>clean(v).toUpperCase());
  narrow('salary',v=>num(v));
  narrow('price',v=>num(v));
  return candidates.length===1?candidates[0]:null;
}
function makeNameMatches(full,short) {
  const name=clean(full).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const label=clean(short).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if(!label.length)return true;
  return name.length>=label.length && name.slice(-label.length).join('')===label.join('');
}
function resolveMakeBenchPlayer(players,tile) {
  const pool=players||[];

  const named=tile?.name?pool.filter(p=>
    makeNameMatches(p.name,tile.name)||
    makeNameMatches(tile.name,p.name)
  ):[];

  if(named.length===1)return named[0];

  const path=normPath(tile?.imagePath);
  if(!path)return null;

  const samePath=pool.filter(p=>normPath(p.imagePath)===path);

  // Gerçek oyuncu portrait'i benzersizse path tek başına yeterlidir.
  // Make ekranı "Trey Jemison III" -> "Jemison" gibi isimleri kısaltabiliyor.
  if(samePath.length===1 && !placeholderPath(path))
    return samePath[0];

  // no-face gibi ortak portrait'lerde isim eşleşmesi hâlâ zorunlu.
  const matches=tile.name?samePath.filter(p=>
    makeNameMatches(p.name,tile.name)||
    makeNameMatches(tile.name,p.name)
  ):samePath;

  return matches.length===1?matches[0]:null;
}
function matchMakeConfirmation(selected, tiles) {
  if(tiles.length!==selected.length)return null;
  const used=new Set(),matches=[];
  for(const tile of tiles){
    if(!tile.name && !normPath(tile.imagePath))return null;
    const named=tile.name?selected.map((p,index)=>({p,index}))
      .filter(x=>!used.has(x.index) && namesMatch(x.p.name,tile.name)):[];
    const path=normPath(tile.imagePath);
    const byPath=path?selected.map((p,index)=>({p,index}))
      .filter(x=>
        !used.has(x.index) &&
        normPath(x.p.imagePath)===path &&
        (
          !placeholderPath(path) ||
          !tile.name ||
          namesMatch(x.p.name,tile.name)
        )
      ):[];
    const candidates=named.length===1?named:byPath;
    if(candidates.length!==1)return null;
    used.add(candidates[0].index);matches.push(candidates[0].p);
  }
  return used.size===selected.length?matches:null;
}

// Stadium displays exactly the five court players using these portrait tiles.
// Its general player-image scan does not include the rest of the bench.
function readStadiumStartingFive() {
  const tiles=[...document.querySelectorAll('[class*="-top-[35px]"][style*="background-image"][style*="players/"]')];
  return tiles.map(tile=>{
    const style=tile.getAttribute('style')||'';
    const path=style.match(/url\(["']?([^"')]+)["']?\)/i)?.[1]||'';
    const imagePath=path.replace(/^https?:\/\/[^/]+/i,'').split('?')[0];
    const name=(tile.parentElement?.querySelector('span[class*="max-w-"]')?.textContent||'').replace(/\s+/g,' ').trim();
    return {name,imagePath:/^\/?players\//i.test(imagePath)?`/${imagePath.replace(/^\/+/, '')}`:''};
  }).filter(player=>player.imagePath);
}

function readOwnTradePlayers() {
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const number=value=>{const digits=String(value||'').replace(/[^0-9]/g,'');return digits?Number(digits):null;};
  const you=[...document.querySelectorAll('span')].find(node=>clean(node.textContent)==='You');
  let panel=you;
  for(let i=0;panel&&i<6;i++,panel=panel.parentElement)
    if(clean(panel.textContent).includes('Offering'))break;
  if(!panel || !clean(panel.textContent).includes('Offering'))return null;

  const cards=[];
  for(const card of panel.querySelectorAll('div.grid.grid-cols-6 > div')) {
    if(!/h-\[80px\]/.test(String(card.className||'')) || !/\bgroup\b/.test(String(card.className||'')))continue;

    const tooltip=[...card.querySelectorAll('div')].find(node=>{
      const cls=String(node.className||'');
      return /\bgroup-hover:block\b/.test(cls) && /\bpointer-events-none\b/.test(cls);
    });
    if(!tooltip)continue;

    const header=[...tooltip.querySelectorAll('div')].find(node=>{
      const cls=String(node.className||'');
      return /\bjustify-between\b/.test(cls) && /\buppercase\b/.test(cls);
    });
    const spans=[...(header?.querySelectorAll('span')||[])];
    const name=clean(spans[0]?.textContent);
    const position=clean(spans[1]?.textContent).toUpperCase();

    const portrait=[...card.querySelectorAll('img')]
      .find(img=>/players\//i.test(img.getAttribute('src')||''));

    let imagePath=portrait?.getAttribute('src')||'';

    if(imagePath.includes('/_next/image')){
      try{
        imagePath=new URL(imagePath,location.href).searchParams.get('url')||imagePath;
      }catch{}
    }

    imagePath=String(imagePath||'')
      .replace(/^https?:\/\/[^/]+/i,'')
      .split('?')[0];

    if(/^\/?players\//i.test(imagePath))
      imagePath=`/${imagePath.replace(/^\/+/,'')}`;
    else
      imagePath='';

    const text=clean(tooltip.textContent);
    const rating=clean(text.match(/Rating:\s*([A-Z][+-]?)/i)?.[1]).toUpperCase();
    const offense=number(text.match(/Offense:\s*([\d.,]+)/i)?.[1]);
    const defense=number(text.match(/Defense:\s*([\d.,]+)/i)?.[1]);
    const salary=number(text.match(/Salary:\s*([\d.,]+)/i)?.[1]);
    const price=number(text.match(/Price:\s*([\d.,]+)/i)?.[1]);
    if(!name || salary==null || price==null)continue;

      cards.push({
        name,imagePath,position,rating,offense,defense,salary,price,
        selectable:/\bcursor-pointer\b/.test(String(card.className||'')) &&
          !/\bcursor-not-allowed\b/.test(String(card.className||''))
      });
  }
  return cards;
}

function readOwnTradeOfferCount() {
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const you=[...document.querySelectorAll('span')].find(node=>clean(node.textContent)==='You');
  let panel=you;
  for(let i=0;panel&&i<6;i++,panel=panel.parentElement)
    if(clean(panel.textContent).includes('Offering'))break;
  const offering=[...(panel?.querySelectorAll('span')||[])]
    .find(node=>clean(node.textContent)==='Offering');
  const value=clean(offering?.nextElementSibling?.textContent).match(/^(\d+)\s*\/\s*(\d+)/);
  return value?{count:Number(value[1]),limit:Number(value[2])}:null;
}

function tradeCardAction({player,action}) {
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const number=value=>{const digits=String(value??'').replace(/[^0-9]/g,'');return digits?Number(digits):null;};
  const norm=value=>clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const surname=value=>{const parts=norm(value).split(' ').filter(Boolean);return parts[parts.length-1]||'';};
  const nameMatch=(a,b)=>{
    const aa=norm(a),bb=norm(b);
    if(!aa||!bb)return false;
    if(aa===bb)return true;
    const pa=aa.split(' ').filter(Boolean),pb=bb.split(' ').filter(Boolean);
    const shortLong=(short,long)=>{
      if(short.length<2||long.length<2)return false;
      const first=short[0].replace(/\.$/,'');
      return first.length===1&&long[0].startsWith(first)&&
        long[long.length-1]===short[short.length-1];
    };
    return shortLong(pa,pb)||shortLong(pb,pa);
  };

  const you=[...document.querySelectorAll('span')].find(node=>clean(node.textContent)==='You');
  let panel=you;
  for(let i=0;panel&&i<6;i++,panel=panel.parentElement)
    if(clean(panel.textContent).includes('Offering'))break;
  if(!panel)return action==='state'?null:false;

  const parsed=[];
  for(const card of panel.querySelectorAll('div.grid.grid-cols-6 > div')){
    if(!/h-\[80px\]/.test(String(card.className||'')) || !/\bgroup\b/.test(String(card.className||'')))continue;
    const tooltip=[...card.querySelectorAll('div')].find(node=>{
      const cls=String(node.className||'');
      return /\bgroup-hover:block\b/.test(cls)&&/\bpointer-events-none\b/.test(cls);
    });
    if(!tooltip)continue;
    const header=[...tooltip.querySelectorAll('div')].find(node=>{
      const cls=String(node.className||'');
      return /\bjustify-between\b/.test(cls)&&/\buppercase\b/.test(cls);
    });
    const spans=[...(header?.querySelectorAll('span')||[])];
    const text=clean(tooltip.textContent);
    parsed.push({
      card,
      name:clean(spans[0]?.textContent),
      position:clean(spans[1]?.textContent).toUpperCase(),
      rating:clean(text.match(/Rating:\s*([A-Z][+-]?)/i)?.[1]).toUpperCase(),
      salary:number(text.match(/Salary:\s*([\d.,]+)/i)?.[1]),
      price:number(text.match(/Price:\s*([\d.,]+)/i)?.[1])
    });
  }

  let candidates=parsed.filter(x=>norm(x.name)===norm(player?.name));
  if(!candidates.length)candidates=parsed.filter(x=>nameMatch(x.name,player?.name));
  if(!candidates.length){
    const wantedSurname=surname(player?.name);
    if(wantedSurname)candidates=parsed.filter(x=>surname(x.name)===wantedSurname);
  }
  const narrow=(key,normalize)=>{
    const wanted=player?.[key];
    if(wanted==null||wanted==='')return;
    const matches=candidates.filter(x=>x[key]!=null&&x[key]!==''&&normalize(x[key])===normalize(wanted));
    if(matches.length)candidates=matches;
  };
  narrow('position',v=>clean(v).toUpperCase());
  narrow('rating',v=>clean(v).toUpperCase());
  narrow('salary',v=>number(v));
  narrow('price',v=>number(v));

  if(candidates.length!==1)return action==='state'?null:false;
  const chosen=candidates[0];

  if(action==='click'){
    if(!/\bcursor-pointer\b/.test(String(chosen.card.className||'')) ||
       /\bcursor-not-allowed\b/.test(String(chosen.card.className||'')))return false;
    chosen.card.click();
    return true;
  }

  const offering=[...panel.querySelectorAll('span')].find(x=>clean(x.textContent)==='Offering');
  const offerCount=clean(offering?.nextElementSibling?.textContent).match(/^(\d+)\s*\/\s*(\d+)/);
  if(!offerCount)return null;
  const parts=[chosen.card,chosen.card.parentElement,
    ...chosen.card.querySelectorAll('[aria-selected],[aria-pressed],[data-state]')];
  return {
    found:true,
    offerCount:Number(offerCount[1]),
    offerLimit:Number(offerCount[2]),
    signature:JSON.stringify(parts.map(el=>[
      String(el?.className||''),
      el?.getAttribute('style'),
      el?.getAttribute('aria-selected'),
      el?.getAttribute('aria-pressed'),
      el?.getAttribute('data-state')
    ]))
  };
}

// This reads the game's Make tab, where the actual convertible bench lives.
// Stadium player portraits do not reliably carry a Bench label.
function readMakeBenchTiles() {
  const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
  const pathOf=el=>{
    let raw=el.tagName==='IMG'?(el.getAttribute('src')||el.getAttribute('srcset')||''):
      (String(el.getAttribute('style')||'').match(/url\(["']?([^"')]+)["']?\)/i)?.[1]||'');
    if(raw.includes('/_next/image')){
      try{raw=new URL(raw,location.href).searchParams.get('url')||raw;}catch{}
    }
    const path=String(raw||'').replace(/^https?:\/\/[^/]+/i,'').split('?')[0];
    return /^\/?players\//i.test(path)?`/${path.replace(/^\/+/, '')}`:'';
  };
  const portraits=root=>[...root.querySelectorAll('img,[style*="background-image"]')]
    .filter(el=>pathOf(el));
  const marker=[...document.querySelectorAll('h1,h2,h3,h4,span,p,div')]
    .find(el=>clean(el.textContent)==='Your Bench' &&
      ![...el.children].some(child=>clean(child.textContent)==='Your Bench'));
  let root=marker?.parentElement;
  while(root && root!==document.body && !portraits(root).length)root=root.parentElement;
  if(!root || root===document.body)return marker?[]:null;
  const seen=new Set(),tiles=[];
  for(const el of portraits(root)){
    let tile=el;
    while(tile && tile!==root && !(/\bcursor-pointer\b/.test(String(tile.className||'')) || tile.tagName==='BUTTON' || tile.getAttribute('role')==='button'))tile=tile.parentElement;
    if(!tile || tile===root || seen.has(tile))continue;
    seen.add(tile);
    const imagePath=pathOf(el);
    const name=clean(
      el.getAttribute('alt') ||
      tile.querySelector('span[class*="max-w-"]')?.textContent ||
      [...tile.querySelectorAll('span')]
        .map(span=>clean(span.textContent))
        .find(value =>
          value &&
          /[a-z]/i.test(value) &&
          !/^(Make|Bench|Selected|Clear All|Rating|Salary|Price)$/i.test(value)
        ) ||
      ''
    );
    tiles.push({name,imagePath});
  }
  return tiles;
}

function selectMakeBenchTile({path,name}) {
  const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
  const norm=v=>{
    const s=String(v||'').replace(/^https?:\/\/[^/]+/i,'').split('?')[0].toLowerCase();
    return /^\/?players\//.test(s)?`/${s.replace(/^\/+/, '')}`:s;
  };
  const nameMatches=(a,b)=>{
    const tokens=v=>clean(v).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const aa=tokens(a),bb=tokens(b);
    if(!aa.length||!bb.length)return false;
    if(aa.join('')===bb.join(''))return true;
    const suffix=(full,short)=>full.length>=short.length &&
      full.slice(-short.length).join('')===short.join('');
    return suffix(aa,bb)||suffix(bb,aa);
  };
  const pathOf=el=>{
    let raw=el.tagName==='IMG'?(el.getAttribute('src')||el.getAttribute('srcset')||''):
      (String(el.getAttribute('style')||'').match(/url\(["']?([^"')]+)["']?\)/i)?.[1]||'');
    if(raw.includes('/_next/image')){
      try{raw=new URL(raw,location.href).searchParams.get('url')||raw;}catch{}
    }
    const found=String(raw||'').replace(/^https?:\/\/[^/]+/i,'').split('?')[0];
    return /^\/?players\//i.test(found)?`/${found.replace(/^\/+/, '')}`:'';
  };
  const portraits=root=>[...root.querySelectorAll('img,[style*="background-image"]')]
    .filter(el=>pathOf(el));
  const marker=[...document.querySelectorAll('h1,h2,h3,h4,span,p,div')]
    .find(el=>clean(el.textContent)==='Your Bench' &&
      ![...el.children].some(child=>clean(child.textContent)==='Your Bench'));
  let root=marker?.parentElement;
  while(root && root!==document.body && !portraits(root).length)root=root.parentElement;
  if(!root || root===document.body)return false;
  const candidates=[];
  for(const el of portraits(root)){
    let clickable=el;
    while(clickable && clickable!==root && !( /\bcursor-pointer\b/.test(String(clickable.className||'')) || clickable.tagName==='BUTTON' || clickable.getAttribute('role')==='button'))clickable=clickable.parentElement;
    if(!clickable || clickable===root)continue;
    const label=clean(
      el.getAttribute('alt') ||
      clickable.querySelector('span[class*="max-w-"]')?.textContent ||
      [...clickable.querySelectorAll('span')]
        .map(span=>clean(span.textContent))
        .find(value =>
          value &&
          /[a-z]/i.test(value) &&
          !/^(Make|Bench|Selected|Clear All|Rating|Salary|Price)$/i.test(value)
        ) ||
      ''
    );
    candidates.push({clickable,label,imagePath:pathOf(el)});
  }
  const unique=list=>[...new Set(list.map(x=>x.clickable))];
  const byName=unique(candidates.filter(x=>name&&nameMatches(x.label,name)));
  const byPath=unique(candidates.filter(x=>path&&norm(x.imagePath)===norm(path)));
  const namedPath=unique(candidates.filter(x=>path&&name&&norm(x.imagePath)===norm(path)&&nameMatches(x.label,name)));
  const selected=byName.length===1?byName[0]:namedPath.length===1?namedPath[0]:byPath.length===1?byPath[0]:null;
  if(!selected)return false;
  selected.click();
  return true;
}

function readMakeSelectedNames() {
  const heading=[...document.querySelectorAll('span')]
    .find(x=>/^Selected\s*[—-]/i.test((x.textContent||'').trim()));
  const list=heading?.parentElement?.parentElement;
  return list?[...list.querySelectorAll('img[alt]')]
    .map(img=>img.getAttribute('alt')).filter(Boolean):[];
}

class AutoTradeService {
  constructor({ store, credentials, browserService, scoutService, cardsService, accountProfile, activity, taskEngine, onChanged }) {
    this.store = store;
    this.credentials = credentials;
    this.browser = browserService;
    this.scout = scoutService;
    this.cards = cardsService;
    this.accountProfile = accountProfile;
    this.activity = activity;
    this.engine = taskEngine;
    this.onChanged = onChanged;
    this.runtime = null;
    this.sessions = new Map();
    this.runPromise = null;
    this.pauseWaiters = [];
    this.stopRequested = false;
    const stored=this.store.getAutoTrade();
    const saved=stored?.runtime;
    let migrated=false;
    if(saved?.status==='error' && saved.message==='Sign button is disabled.' && saved.pendingScoutBatch?.players?.length){
      // In older builds this error was raised before pressing Sign, after its
      // intent was saved. Remove only that final, unclicked intent so Continue
      // verifies purchases that actually preceded it.
      saved.pendingScoutBatch.players.pop();
      if(!saved.pendingScoutBatch.players.length)saved.pendingScoutBatch=null;
      saved.message='The previously disabled Sign was not clicked. Continue verifies earlier Scout purchases, then resumes.';
      migrated=true;
    }
    if(saved && ['error','interrupted'].includes(saved.status) && saved.phase==='main-make' &&
       ['preparing-main','main-scout'].includes(saved.checkpoint?.phase)){
      // Older builds saved the visible Make phase but retained the earlier
      // Scout checkpoint. Continue must recover the already selected player.
      saved.checkpoint={phase:'main-make',accountId:saved.mainAccountId,
        returnPhase:saved.checkpoint.phase,action:'select-players'};
      migrated=true;
    }
    if(saved?.config?.roomPassword){
      saved.config.roomPasswordEncrypted=this.credentials.encryptSecret(saved.config.roomPassword);
      delete saved.config.roomPassword;
      migrated=true;
    }
    if(stored?.lastRun?.config?.roomPassword){delete stored.lastRun.config.roomPassword;migrated=true;}
    if(migrated)this.store.saveAutoTrade(stored);
    if(saved && ['running','stopping'].includes(saved.status)){
      this.runtime={...saved,status:'interrupted',paused:true,message:'Auto Trade was interrupted. Review the checkpoint before resuming.'};
      this._save();
    }
  }

  snapshot() {
    const saved = this.store.getAutoTrade();
    const runtime = this.runtime || saved?.runtime || null;
    const safe=value=>{
      if(!value)return null;
      const copy={...value,config:value.config?{...value.config}:null};
      if(copy.config){delete copy.config.roomPassword;delete copy.config.roomPasswordEncrypted;}
      return copy;
    };
    return { runtime:safe(runtime), lastRun:safe(saved?.lastRun) };
  }

  _save() {
    const old = this.store.getAutoTrade();
    this.store.saveAutoTrade({ version: 1, runtime: this.runtime, lastRun: old?.lastRun || null });
    this.onChanged?.();
  }
  _finishPersist() {
    const old = this.store.getAutoTrade();
    this.store.saveAutoTrade({ version: 1, runtime: this.runtime, lastRun: this.runtime ? JSON.parse(JSON.stringify(this.runtime)) : old?.lastRun || null });
    this.onChanged?.();
  }
  _log(level, message, account = null) {
    this.activity.add({ level, accountId: account?.id || null, accountName: account?.name || 'Auto Trade', taskName: 'Auto Trade', message });
  }
  _accounts() { return this.store.getAccounts(); }
  _account(id) { return this._accounts().find(a => a.id === id) || null; }
  _profile(id) { return this.accountProfile.snapshot().accounts?.[id] || {}; }
  _mainId() { return this.accountProfile.snapshot().mainAccountId || null; }
  _roles() { return this.cards.snapshot().roles || []; }
  _cardMap() {
    return (this.cards.snapshot().players || []).filter(p => p.active !== false);
  }
  _decorate(p, players = this._cardMap()) {
    // resolvePlayer already rejects ambiguous name matches. Do not discard its
    // safe name match merely because different game screens expose a different
    // portrait URL; doing so removes the saved Auto-Trade roles.
    const card = resolvePlayer(players, p);
    return { ...p, name:p.name||card?.name||'', roleIds: card?.roleIds || [], roles: card?.roles || [], cardKey: card?.key || null };
  }
  _hasAnyRole(p, roleIds) {
    const wanted = new Set(roleIds || []);
    return (p.roleIds || []).some(id => wanted.has(id));
  }
  _shouldBuyScout(agent, cfg, purchaseRoles) {
    const price=num(agent?.price);
    const roleIds=agent?.card?.roleIds||agent?.card?.roles?.map(r=>r.id)||[];
    return Boolean(agent?.canSign && !agent.signed && price!=null && price>=0 &&
      (price<=cfg.purchaseMaxPrice || roleIds.some(id=>purchaseRoles.has(id))));
  }
  _config() { return this.runtime?.config || {}; }
  _resultRow(accountId) { return this.runtime?.results?.find(r => r.accountId === accountId) || null; }

  async preflight(options = {}) {
    const mainId = this._mainId();
    const main = this._account(mainId);
    const requestedSides = [...new Set(options.sideAccountIds || [])].filter(id => id && id !== mainId);
    const conflicts = [];
    for (const id of [mainId, ...requestedSides.filter(id=>(this._profile(id)?.level||0)>=10)].filter(Boolean)) {
      const runtime = this.engine?.states?.()?.[id];
      const scout = this.scout?.snapshot?.()?.[id];
      const locks = this.browser.featureNames?.(id) || [];
      if (runtime?.status === 'running' || runtime?.status === 'preparing') conflicts.push({ accountId: id, feature: 'Auto Play' });
      if (scout?.status && !['closed','idle','error'].includes(scout.status)) conflicts.push({ accountId: id, feature: 'Scout' });
      for (const feature of locks) if (!['auto-trade'].includes(feature)) conflicts.push({ accountId: id, feature });
    }
    return {
      mainAccountId: mainId,
      mainExists: Boolean(main),
      mainLevel: this._profile(mainId)?.level ?? null,
      sides: requestedSides.map(id => ({ id, name: this._account(id)?.name || id, level: this._profile(id)?.level ?? null })),
      conflicts
    };
  }

  async start(options = {}) {
    if (this.runPromise) throw new Error('Auto Trade is already running.');
    if(this.runtime?.pendingTrade || this.store.getAutoTrade()?.runtime?.pendingTrade)
      throw new Error('A previous Trade is awaiting roster reconciliation. Review it before starting another run.');
    if(this.runtime?.pendingScoutBatch || this.store.getAutoTrade()?.runtime?.pendingScoutBatch)
      throw new Error('A previous Scout purchase is awaiting roster verification. Continue or reset that run first.');
    if(this.runtime?.pendingMake || this.store.getAutoTrade()?.runtime?.pendingMake)
      throw new Error('A previous Star Card conversion awaits roster verification. Continue or reset that run first.');
    if(['paused','interrupted','needs-attention','error'].includes(this.runtime?.status))
      throw new Error('Continue or stop the previous Auto Trade run before starting a new one.');
    const mainId = this._mainId();
    const main = this._account(mainId);
    if (!main) throw new Error('Main Account is not selected.');
    if ((this._profile(mainId)?.level || 0) < 10) throw new Error('Main Account must be level 10 or higher for Trade.');
    if ((options.sideAccountIds || []).includes(mainId)) throw new Error('Main Account cannot also be a Side account.');
    let sideIds = [...new Set(options.sideAccountIds || [])].filter(id => id && id !== mainId && this._account(id));
    if (!sideIds.length) throw new Error('Select at least one Side account.');
    const knownRoles = new Set(this._roles().map(r => r.id));
    const sideToMainRoles = [...new Set(options.sideToMainRoleIds || [])];
    const mainToSideRoles = [...new Set(options.mainToSideRoleIds || [])];
    if ([...sideToMainRoles,...mainToSideRoles].some(id=>!knownRoles.has(id)))
      throw new Error('An Auto Trade role no longer exists. Review the selected roles.');

    const validSides = [];
    const invalidSides = [];
    for (const id of sideIds) {
      const lv = this._profile(id)?.level;
      if ((lv || 0) >= 10) validSides.push(id); else invalidSides.push(id);
    }
    sideIds = validSides;
    if (!sideIds.length) throw new Error('No selected Side account is level 10 or higher.');

    const pf = await this.preflight({...options,sideAccountIds:sideIds});
    if (pf.conflicts.length && !options.stopConflicts) {
      const names = pf.conflicts.map(x => `${this._account(x.accountId)?.name || x.accountId}: ${x.feature}`).join(', ');
      throw new Error(`CONFLICTS:${names}`);
    }
    if (options.stopConflicts) await this._stopConflicts([mainId, ...sideIds]);

    const kartRoleIds = this._roles().filter(r=>r.id==='card'||clean(r.name).toLowerCase()==='kart').map(r=>r.id);
    const config = {
      sideAccountIds: sideIds,
      visible: Boolean(options.visible),
      purchaseMaxPrice: num(options.purchaseMaxPrice),
      sideToMainRoleIds: sideToMainRoles,
      mainToSideRoleIds: mainToSideRoles,
      makeRoleIds: kartRoleIds,
      roomDescription: clean(options.roomDescription || 'Auto Trade'),
      roomPasswordEncrypted: options.roomPassword ? this.credentials.encryptSecret(String(options.roomPassword)) : '',
      startedAt: new Date().toISOString()
    };
    if (!config.roomDescription) throw new Error('Room Description is required.');
    if (config.roomDescription.length > 50) throw new Error('Room Description can be at most 50 characters.');
    if (config.purchaseMaxPrice == null || config.purchaseMaxPrice < 0) throw new Error('Scout Max Price must be a non-negative number.');

    this.stopRequested = false;
    this._scoutRosterCounts = new Map();
    this.runtime = {
      id: crypto.randomUUID(), status: 'running', phase: 'preparing-main', paused: false, message: 'Preparing Main Account…',
      startedAt: config.startedAt, finishedAt: null, config,
      mainAccountId: mainId, activeSideAccountId: null, sideOrder: [], completedSides: [], deferredSides: [],
      problems: invalidSides.map(id => ({ accountId:id, type:'level', message:'Level is below 10; account was skipped.' })),
      ledger: [], checkpoint: { phase:'preparing-main', accountId: mainId },
      results: [mainId, ...sideIds, ...invalidSides].map((id, index) => ({ accountId:id, accountName:this._account(id)?.name || id, isMain:index===0, startTk:null, currentTk:null, tkDelta:0, gainedPlayers:0, cardsMade:0, status:index===0?'active':invalidSides.includes(id)?'skipped':'queued' }))
    };
    this._save();
    this.runPromise = this._run().catch(err => this._fatal(err)).finally(() => { this.runPromise = null; });
    return true;
  }

  async pause() {
    if (!this.runtime || !['running','paused'].includes(this.runtime.status)) return false;
    this.runtime.paused = true; this.runtime.status = 'paused'; this.runtime.message = 'Paused at a safe boundary.'; this._save(); return true;
  }
  async resume() {
    if (!this.runtime) {
      const saved = this.store.getAutoTrade()?.runtime;
      if (!saved || !['paused','interrupted','error'].includes(saved.status)) throw new Error('No previous Auto Trade run can be resumed.');
      this.runtime = saved;
    }
    if(this.runtime.pendingTrade)throw new Error('A Trade confirmation was interrupted. Review both rosters before resuming.');
    if(this._mainId()!==this.runtime.mainAccountId)throw new Error('The Main Account changed since this run. Restore it before resuming.');
    // An error is saved before browser cleanup finishes. A quick Continue must
    // wait for that old run to end, or it marks the run active without starting it.
    if(this.runPromise && (['error','interrupted'].includes(this.runtime.status) ||
       (this.runtime.status==='paused' && this.runtime.checkpoint?.phase==='main-roster-full')))
      await this.runPromise.catch(()=>{});
    if(!this.runPromise && (await this.preflight({sideAccountIds:this.runtime.config.sideAccountIds})).conflicts.length)
      throw new Error('Another automation is using an Auto Trade account. Stop it before resuming.');
    this.runtime.problems=this.runtime.problems.filter(p=>p.type!=='error');
    this.runtime.paused = false; this.runtime.status = 'running'; this.runtime.message = 'Resuming Auto Trade…'; this.stopRequested = false; this._save();
    for (const w of this.pauseWaiters.splice(0)) w();
    if (!this.runPromise) this.runPromise = this._run(true).catch(err => this._fatal(err)).finally(() => { this.runPromise = null; });
    return true;
  }
  async resumeSide(sideId){
    if(this.runPromise)throw new Error('An Auto Trade run is already active.');
    if(!this.runtime)this.runtime=this.store.getAutoTrade()?.runtime||null;
    if(!this.runtime || this.runtime.status!=='needs-attention' || !this.runtime.deferredSides?.includes(sideId))
      throw new Error('This Side account is not awaiting attention.');
    if(this.runtime.pendingTrade)throw new Error('A Trade confirmation must be reconciled first.');
    if(this._mainId()!==this.runtime.mainAccountId)throw new Error('The Main Account changed since this run.');
    if((this._profile(sideId)?.level||0)<10)throw new Error('Side account must be level 10 or higher.');
    if((await this.preflight({sideAccountIds:[sideId]})).conflicts.length)
      throw new Error('Another automation is using Main or this Side account. Stop it before continuing.');
    this.runtime.checkpoint=this.runtime.deferredCheckpoints?.[sideId] || {phase:'side-scout',accountId:sideId};
    this.runtime.resumeSideAccountId=sideId;
    this.runtime.status='running';this.runtime.paused=false;this.stopRequested=false;
    this.runtime.message=`Resuming ${this._account(sideId)?.name||sideId}…`;
    this._save();
    this.runPromise=this._run(true).catch(err=>this._fatal(err)).finally(()=>{this.runPromise=null;});
    return true;
  }
  async reconcilePending(){
    if(this.runPromise)throw new Error('Pause Auto Trade before checking the pending Trade.');
    if(!this.runtime)this.runtime=this.store.getAutoTrade()?.runtime||null;
    const pending=this.runtime?.pendingTrade;
    if(!pending)throw new Error('No pending Trade needs reconciliation.');
    if(this._mainId()!==this.runtime.mainAccountId)throw new Error('Restore the saved Main Account before checking the pending Trade.');
    if((await this.preflight({sideAccountIds:[pending.sideId]})).conflicts.length)
      throw new Error('Another automation is using an account needed to check the pending Trade.');
    try{
      const mainId=this.runtime.mainAccountId,sideId=pending.sideId;
      const main=await this._open(this._account(mainId),'reconcile-main');
      const side=await this._open(this._account(sideId),'reconcile-side');
      const mainAfter=await this._snapshotHome(mainId,main.page,false);
      const sideAfter=await this._snapshotHome(sideId,side.page,false);
      const confirmedByHome=pending.mainToSide.every(p=>this._contains(sideAfter.players,p)&&!this._contains(mainAfter.players,p))
        && pending.sideToMain.every(p=>this._contains(mainAfter.players,p)&&!this._contains(sideAfter.players,p));
      if(!confirmedByHome)await this._verifyTransferOnFreshDesk(sideId,pending.mainToSide,pending.sideToMain);
      for(const p of pending.mainToSide)this._ledger('trade-transfer',{from:mainId,to:sideId,player:p});
      for(const p of pending.sideToMain)this._ledger('trade-transfer',{from:sideId,to:mainId,player:p,routeToCard:true});
      this._syncTradeTk(mainId,sideId,pending.mainBefore,pending.sideBefore,pending.mainToSide,pending.sideToMain,mainAfter,sideAfter);
      this.runtime.pendingTrade=null;
      this.runtime.checkpoint={phase:'post-trade',accountId:sideId};
      this.runtime.status='paused';this.runtime.paused=true;
      this.runtime.message='Pending Trade verified from both rosters. Continue the run.';
      this._save();return true;
    }finally{await this._closeAllSessions();}
  }
  async stop() {
    this.stopRequested = true;
    if (this.runtime) { this.runtime.status = 'stopping'; this.runtime.message = 'Stopping safely…'; this._save(); }
    for (const w of this.pauseWaiters.splice(0)) w();
    await this._closeAllSessions();
    if (this.runtime) { this.runtime.status='stopped'; this.runtime.finishedAt=new Date().toISOString(); this.runtime.message='Stopped.'; this._recomputeResults(); this._finishPersist(); }
    return true;
  }
  async reset() {
    const pending=this.runtime?.pendingTrade || this.store.getAutoTrade()?.runtime?.pendingTrade;
    if (pending) throw new Error('A Trade may already have completed. Verify the pending Trade before resetting, to avoid repeating transfers.');
    if (this.runPromise) {
      await this.stop();
      await this.runPromise.catch(() => {});
    } else {
      await this._closeAllSessions();
    }
    for (const id of this.runtime?.config?.sideAccountIds || []) await this.scout?.close?.(id).catch(() => {});
    if (this.runtime?.mainAccountId) await this.scout?.close?.(this.runtime.mainAccountId).catch(() => {});
    this.runtime=null;
    this.stopRequested=false;
    this.pauseWaiters=[];
    this.store.saveAutoTrade({version:1,runtime:null,lastRun:null});
    this.onChanged?.();
    return true;
  }
  async shutdown(){
    if(!this.runtime || !['running','paused','stopping'].includes(this.runtime.status))return;
    this.stopRequested=true;
    this.runtime.status='interrupted';this.runtime.paused=true;
    this.runtime.message='Auto Trade was interrupted by app shutdown. Review the checkpoint before continuing.';
    this._save();
    for(const resolve of this.pauseWaiters.splice(0))resolve();
    await this._closeAllSessions();
  }

  async _safeBoundary() {
    if (this.stopRequested) throw new Error('__STOP__');
    while (this.runtime?.paused && !this.stopRequested) await new Promise(resolve => this.pauseWaiters.push(resolve));
    if (this.stopRequested) throw new Error('__STOP__');
  }
  async _stopConflicts(ids) {
    for (const id of ids) {
      await this.engine?.stopAccount?.(id, { reason:'Stopped for Auto Trade', quiet:true }).catch(() => {});
      await this.scout?.close?.(id).catch(() => {});
      const deadline = Date.now()+15000;
      while (this.browser.isFeatureLocked(id) && Date.now()<deadline) await sleep(150);
      if (this.browser.isFeatureLocked(id)) await this.browser.forceCloseAccount?.(id).catch(() => {});
    }
  }
  async _fatal(err) {
    if (this.stopRequested || err?.message === '__STOP__' || err?.message === '__PAUSE_CHECKPOINT__') return;
    if (this.runtime) {
      this.runtime.status='error'; this.runtime.message=err?.message || 'Auto Trade failed.';
      this.runtime.problems.push({ type:'error', accountId:this.runtime.checkpoint?.accountId || this.runtime.activeSideAccountId || this.runtime.mainAccountId, message:this.runtime.message });
      this._recomputeResults(); this._finishPersist();
    }
    this._log('error', `Auto Trade: ${err?.message || err}`);
    await this._closeAllSessions();
  }

  async _run(resuming = false) {
    this.runtime.deferredSides ||= [];
    const mainId = this.runtime.mainAccountId;
    const main = this._account(mainId);
    let resumeCheckpoint=resuming?{...this.runtime.checkpoint}:null;
    await this._safeBoundary();
    const mainSession = await this._open(main, 'main');
    let initialMain = await this._snapshotHome(mainId, mainSession.page, true);
    if (this.runtime.pendingScoutBatch?.accountId===mainId) initialMain=await this._verifyScoutBatch(mainId,this.runtime.pendingScoutBatch);
    if (this.runtime.pendingMake?.accountId===mainId) {
      try { await this._verifyPendingMake(mainId,this.runtime.pendingMake); }
      catch(error){
        if(!resuming || !/roster has not confirmed the Star Card conversion/.test(error.message))throw error;
        await this._retryUnconfirmedMake(mainId,this.runtime.pendingMake);
        resumeCheckpoint={...this.runtime.checkpoint};
      }
      initialMain=await this._snapshotHome(mainId,mainSession.page,false);
    }
    this._setRowStatus(mainId, 'active');

    if(resumeCheckpoint?.phase==='main-make'){
      // This is the failed action, even when a preceding Scout wave was the
      // last completed phase. Reopen Make and select against the live bench.
      await this._makeEligible(mainId);
      await this._returnHome(mainId);
      if(['preparing-main','main-scout'].includes(resumeCheckpoint.returnPhase)){
        this.runtime.checkpoint={phase:'main-scout',accountId:mainId,action:'open-scout'};this._save();
        await this._scoutLoop(mainId,{allowMake:true});
        await this._returnHome(mainId);
        this.runtime.checkpoint={phase:'side-order',accountId:mainId};this._save();
      }else{
        const sideId=resumeCheckpoint.sideId;
        this.runtime.checkpoint=sideId?
          {phase:resumeCheckpoint.sideScoutDone?'side-trade':
            resumeCheckpoint.returnPhase==='side-scout'?'side-scout':'side-trade',accountId:sideId}:
          {phase:'side-order',accountId:mainId};
        this._save();
      }
    }else if (!resuming || ['preparing-main','main-scout'].includes(this.runtime.checkpoint?.phase)) {
      this.runtime.phase='main-scout'; this.runtime.message='Main Account: Scout / Make preparation'; this._save();
      await this._scoutLoop(mainId, { allowMake:true });
      await this._returnHome(mainId);
      this.runtime.checkpoint={phase:'side-order',accountId:mainId};this._save();
    } else if (['side-order','post-trade'].includes(this.runtime.checkpoint?.phase) &&
               (num(initialMain.rosterCount)??initialMain.players.length)>5 &&
               !this.runtime.pendingMake) {
      // An interrupted post-Trade run may have received players without ever
      // reaching Make. Audit Main's bench before continuing any Side account,
      // even if that roster is only partially filled.
      await this._makeEligible(mainId);
      await this._returnHome(mainId);
      this.runtime.checkpoint={...resumeCheckpoint};this._save();
    }

    if (!this.runtime.sideOrder.length) {
      // The account panel already contains TK. Do not log into every Side merely
      // to rank them; the actual value is captured when each Side is opened.
      this.runtime.sideOrder = [...this.runtime.config.sideAccountIds].sort((a, b) =>
        (num(this._profile(b).tk) ?? -1) - (num(this._profile(a).tk) ?? -1));
      this._save();
    }

    const selectedSides=this.runtime.resumeSideAccountId?[this.runtime.resumeSideAccountId]:this.runtime.sideOrder;
    for (const sideId of selectedSides) {
      if (this.runtime.completedSides.includes(sideId)) continue;
      await this._safeBoundary();
      this.runtime.activeSideAccountId = sideId; this.runtime.phase='side';
      if(this.runtime.checkpoint?.accountId!==sideId ||
         !['side','side-scout','side-trade','post-trade'].includes(this.runtime.checkpoint.phase))
        this.runtime.checkpoint={phase:'side-scout',accountId:sideId,action:'open-scout'};
      this._setRowStatus(sideId,'active'); this._save();
      let outcome;
      try{outcome=await this._processSide(sideId);}
      catch(err){if(!err.sideOnly)throw err;outcome={deferred:true,type:'side-error',reason:err.message};}
      if(outcome?.deferred){
        this.runtime.deferredCheckpoints ||= {};
        this.runtime.deferredCheckpoints[sideId]=this.runtime.checkpoint?.accountId===sideId?
          {...this.runtime.checkpoint}:{phase:'side-trade',accountId:sideId};
        if(!this.runtime.deferredSides.includes(sideId))this.runtime.deferredSides.push(sideId);
        this.runtime.problems.push({accountId:sideId,type:outcome.type||'roster-full',message:outcome.reason});
        this._setRowStatus(sideId,'needs-attention');
      } else {
        if(this.runtime.deferredCheckpoints)delete this.runtime.deferredCheckpoints[sideId];
        this.runtime.deferredSides=this.runtime.deferredSides.filter(id=>id!==sideId);
        if (!this.runtime.completedSides.includes(sideId)) this.runtime.completedSides.push(sideId);
        this._setRowStatus(sideId,'completed');
        this.runtime.problems=this.runtime.problems.filter(p=>!(p.accountId===sideId&&['roster-full','side-error'].includes(p.type)));
      }
      await this._closeSession(sideId);
      this.runtime.activeSideAccountId = null; this._recomputeResults(); this._save();
      // There is only one persisted Scout purchase intent. Verify it on this
      // Side before another account is allowed to create a new intent.
      if(this.runtime.pendingScoutBatch?.accountId===sideId)break;
    }

    await this._safeBoundary();
    await this._returnHome(mainId);
    await this._snapshotHome(mainId, this.sessions.get(mainId)?.session?.page, false);
    await this._closeAllSessions();
    this.runtime.resumeSideAccountId=null;
    this.runtime.status=this.runtime.deferredSides.length?'needs-attention':'completed'; this.runtime.phase='done'; this.runtime.message=this.runtime.deferredSides.length?'Auto Trade has Side accounts needing attention.':'Auto Trade completed.'; this.runtime.finishedAt=new Date().toISOString(); this.runtime.activeSideAccountId=null;
    this._setRowStatus(mainId,this.runtime.deferredSides.length?'needs-attention':'completed'); this._recomputeResults(); this._finishPersist();
    this._log(this.runtime.deferredSides.length?'warning':'success',this.runtime.message);
  }

  async _processSide(sideId) {
    const side = this._account(sideId); const mainId=this.runtime.mainAccountId;
    await this._open(side,'side');
    await this._returnHome(sideId); await this._snapshotHome(sideId,this.sessions.get(sideId).session.page,true);
    if (this.runtime.pendingScoutBatch?.accountId===sideId) await this._verifyScoutBatch(sideId,this.runtime.pendingScoutBatch);
    const phase=this.runtime.checkpoint?.accountId===sideId?this.runtime.checkpoint.phase:null;
    if(phase!=='side-trade'){
      try{await this._scoutLoop(sideId,{ allowMake:false });}
      catch(err){err.sideOnly=true;throw err;}
    }
    await this._returnHome(sideId);
    this.runtime.checkpoint={phase:'side-trade',accountId:sideId};this._save();

    let round=0;
    for (; round<60; round++) {
      await this._safeBoundary();
      let mainHome = await this._snapshotHome(mainId,this.sessions.get(mainId).session.page,false);
      const sideHome = await this._snapshotHome(sideId,this.sessions.get(sideId).session.page,false);
      if((num(mainHome.rosterCount)??mainHome.players.length)>=11 &&
         (num(sideHome.rosterCount)??sideHome.players.length)>5){
        await this._makeEligible(mainId);
        await this._returnHome(mainId);
        mainHome=await this._snapshotHome(mainId,this.sessions.get(mainId).session.page,false);
      }
      let sideToMain = this._transferCandidates(sideHome, this.runtime.config.sideToMainRoleIds, sideId, true)
        .filter(p=>!this._contains(mainHome.players,p));
      if(sideToMain.length && (num(mainHome.rosterCount)??mainHome.players.length)>=11){
        await this._makeEligible(mainId);
        await this._returnHome(mainId);
        mainHome=await this._snapshotHome(mainId,this.sessions.get(mainId).session.page,false);
        sideToMain=sideToMain.filter(p=>!this._contains(mainHome.players,p));
      }
      let mainToSide = this._transferCandidates(mainHome, this.runtime.config.mainToSideRoleIds, mainId, false)
        .filter(p=>!this._contains(sideHome.players,p))
        .filter(p=>!(this.runtime.deferredMainToSideBySide?.[sideId]||[]).includes(identityOf(p)));
      sideToMain = sideToMain.slice(0,5); mainToSide = mainToSide.slice(0,5);
      const safe = this._fitTrade(mainHome,sideHome,mainToSide,sideToMain);
      if(sideToMain.length && !safe.sideToMain.length && (num(mainHome.rosterCount)??mainHome.players.length)>=11 && !safe.mainToSide.length){
        this.runtime.paused=true;this.runtime.status='paused';this.runtime.phase='main-roster-full';
        this.runtime.message='Main roster is full and cannot accept the pending Side players.';
        this.runtime.checkpoint={phase:'main-roster-full',accountId:mainId,sideId};this._save();
        await this._closeAllSessions();throw new Error('__PAUSE_CHECKPOINT__');
      }
      if((sideToMain.length||mainToSide.length)&&!safe.sideToMain.length&&!safe.mainToSide.length)
        return {deferred:true,type:'roster-limit',reason:'Current roster limits prevent a safe Trade. Adjust the Side roster, then Continue this Side.'};
      mainToSide=safe.mainToSide; sideToMain=safe.sideToMain;
      // Stadium renders the court five but not every bench portrait. Even if
      // its candidate list is empty, the Trade desk must inspect real bench
      // players (including players the account owner acquired manually).
      // Even a visible manual bench player may have no Scout purchase price;
      // only the Trade desk can supply that price for the routing rules.
      // A Stadium snapshot may contain only the five court portraits even
      // when either account has a full bench. Inspect the Trade desk once
      // before concluding that this Side has nothing left to transfer.
      const traded = await this._executeTrade(sideId, mainToSide, sideToMain);
      if (!traded) break;
      // The two accounts have independent browser sessions. Resume Side Scout
      // while Main converts the players received in this Trade. Wait for both
      // to settle before checking either roster or starting another Trade.
      const [mainMake,sideScout]=await Promise.allSettled([
        (async()=>{
          await this._returnHome(mainId);
          await this._makeEligible(mainId);
          await this._returnHome(mainId);
        })(),
        (async()=>{
          await this._returnHome(sideId);
          await this._scoutLoop(sideId,{allowMake:false});
          await this._returnHome(sideId);
        })()
      ]);
      if(mainMake.status==='rejected'){
        this.runtime.checkpoint={phase:'main-make',accountId:mainId,sideId,
          returnPhase:'post-trade',sideScoutDone:sideScout.status==='fulfilled',action:'retry-make'};
        this._save();
        throw mainMake.reason;
      }
      if(sideScout.status==='rejected'){
        this.runtime.checkpoint={phase:'side-scout',accountId:sideId,action:'open-scout'};this._save();
        sideScout.reason.sideOnly=true;
        throw sideScout.reason;
      }
      this.runtime.checkpoint={phase:'side-trade',accountId:sideId};this._save();
    }

    if(round>=60)
      return {deferred:true,type:'round-limit',reason:'This Side still needs Scout or Trade after 60 verified rounds. Continue it after reviewing the rosters.'};

    const finalSide = await this._snapshotHome(sideId,this.sessions.get(sideId).session.page,false);
    const remaining = this._transferCandidates(finalSide,this.runtime.config.sideToMainRoleIds,sideId,true);
    if(remaining.length)
      return {deferred:true,type:'remaining-transfer',reason:'Transferable players remain on this Side. Review its roster and Continue this Side.'};
    if((num(finalSide.rosterCount)??finalSide.players.length)>=11){
      let scoutPending=false;
      try{
        const data=await this.scout.open(sideId);
        const cfg=this.runtime.config;
        const purchaseRoles=new Set(this._roles().map(r=>r.id));
        scoutPending=(data.agents||[]).some(agent=>{
          const price=num(agent.price);
          return agent.canSign && (price==null || this._shouldBuyScout(agent,cfg,purchaseRoles));
        }) || num(data.attempts)>0;
      }catch(err){scoutPending=true;this._log('warning',`Side Scout could not be checked: ${err.message}`,side);}
      finally{await this.scout.close(sideId).catch(()=>{});}
      if(remaining.length || scoutPending)
        return {deferred:true,reason:'Side roster is full while players or Scout actions remain. Free roster space, then Continue this Side.'};
    }
    return {deferred:false};
  }

  async _open(account, purpose) {
    if (!account) throw new Error('Account not found.');
    const existing=this.sessions.get(account.id); if(existing && !existing.session.closed) return existing.session;
    const owner=`auto-trade:${this.runtime.id}:${purpose}:${account.id}`;
    const secret={ login:account.login, password:this.credentials.decryptSecret(account.passwordEncrypted) };
    const auth=await this.browser.authenticate(account,secret,{visible:this.runtime.config.visible,keepOpen:true,owner,log:(level,msg)=>this._log(level,msg,account)});
    this.browser.lockFeature(account.id,'auto-trade');
    this.sessions.set(account.id,{owner,session:auth.session});
    if (this.runtime.config.visible) await this._placeWindows();
    return auth.session;
  }
  async _placeWindows() {
    const main=this.sessions.get(this.runtime.mainAccountId)?.session;
    const side=this.runtime.activeSideAccountId ? this.sessions.get(this.runtime.activeSideAccountId)?.session : null;
    await this.browser.arrangeVisiblePair?.(main,side).catch(()=>{});
  }
  async _closeSession(id) {
    const e=this.sessions.get(id); if(!e)return;
    this.sessions.delete(id); this.browser.unlockFeature(id,'auto-trade');
    await this.browser.release(id,e.owner,{closeWhenUnused:true}).catch(()=>{});
  }
  async _closeAllSessions() { for(const id of [...this.sessions.keys()]) await this._closeSession(id); }

  async _returnHome(accountId) {
    const e=this.sessions.get(accountId); if(!e) return null;
    const {page}=e.session;
    const starNav=page.locator('nav[aria-label="Star card sections"]').first();
    // A completed Auto-Trade Scout action can leave its result modal mounted
    // over Stadium. Close only a visible modal that owns the Call Back button;
    // otherwise its backdrop intercepts the next Agent/Scout click.
    const callbackButton=page.getByRole('button',{name:/^Call Back$/i}).first();
    if(await callbackButton.isVisible().catch(()=>false)) {
      await page.keyboard.press('Escape').catch(()=>{});
      await callbackButton.waitFor({state:'hidden',timeout:5000}).catch(()=>{});
      if(await callbackButton.isVisible().catch(()=>false)) {
        const modal=callbackButton.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " fixed ")][1]');
        const close=modal.getByRole('button',{name:/^(Close|Cancel|×)$/i}).first();
        if(await close.isVisible().catch(()=>false))await close.click({timeout:5000}).catch(()=>{});
        await callbackButton.waitFor({state:'hidden',timeout:5000}).catch(()=>{});
      }
    }
    if(await page.locator(SCOUT_DIALOG).first().isVisible().catch(()=>false)) {
      await page.keyboard.press('Escape');
      await page.locator(SCOUT_DIALOG).first().waitFor({state:'hidden',timeout:10000});
    }
    // The Stadium can remain mounted behind Star Cards. Its Agent image alone
    // does not prove that Make was closed.
    if(await starNav.isVisible().catch(()=>false)) {
      const back=page.getByRole('button',{name:/^Back$/i}).first();
      await back.click({timeout:15000});
      await starNav.waitFor({state:'hidden',timeout:30000});
    }
    const homeReady=async()=>!(await starNav.isVisible().catch(()=>false)) &&
      await page.locator(HOME_AGENT).first().isVisible().catch(()=>false);
    if(await homeReady()) { await this.accountProfile.captureStadium(accountId,page).catch(()=>{}); return true; }
    const back=page.getByRole('button',{name:/^Back$/i}).first();
    if(await back.isVisible().catch(()=>false)) await back.click().catch(()=>{});
    const end=Date.now()+120000;
    while(Date.now()<end){
      if(await homeReady()) { await this.accountProfile.captureStadium(accountId,page).catch(()=>{}); return true; }
      await sleep(300);
    }
    await this.browser.normalizeToStadium(e.session,(l,m)=>this._log(l,m,this._account(accountId)));
    if(!(await homeReady()))throw new Error('Star Cards Make was not closed; Main did not return to Stadium.');
    return true;
  }

  async _snapshotHome(accountId,page,initial=false) {
    await this._returnHome(accountId);
    const snap=await page.evaluate(()=>{
      const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
      const n=v=>{const s=String(v||'').replace(/[^0-9-]/g,'');const x=Number(s);return Number.isFinite(x)?x:null};
      const metric=alt=>{const img=document.querySelector(`img[alt="${alt}"]`); if(!img)return null; let r=img.parentElement; for(let i=0;r&&i<6;i++,r=r.parentElement){const vals=[...r.querySelectorAll('span')].map(x=>clean(x.textContent)).filter(x=>/^[-+]?\d[\d.,]*$/.test(x));if(vals.length)return n(vals[0]);}return null};
      const teamLabel=[...document.querySelectorAll('div,span')].find(x=>clean(x.textContent)==='Team Name'); let teamName='';
      if(teamLabel){let r=teamLabel.parentElement;for(let i=0;r&&i<4;i++,r=r.parentElement){const s=[...r.querySelectorAll('span')].map(x=>clean(x.textContent)).find(x=>x&&x!=='Team Name'&&x!=='Experience'&&!/^Lv\./i.test(x));if(s){teamName=s;break}}}
      const lv=clean(document.body.innerText).match(/\bLv\.?\s*(\d{1,3})\b/i); const level=lv?Number(lv[1]):null;
      const raw=[];
      const add=(name,path,el)=>{path=String(path||'').replace(/^https?:\/\/[^/]+/i,'').split('?')[0];if(!/players\//i.test(path))return;let bench=false;let p=el;for(let i=0;p&&i<7;i++,p=p.parentElement){const tx=clean(p.textContent);if(/\bBench\b/i.test(tx)){bench=true;break}}raw.push({name:clean(name),imagePath:path,bench});};
      for(const img of document.querySelectorAll('img[src*="players/"]')) add(img.getAttribute('alt')||'',img.getAttribute('src')||'',img);
      for(const el of document.querySelectorAll('[style*="background-image"][style*="players/"]')) { const m=String(el.getAttribute('style')||'').match(/url\(["']?([^"')]+players\/[^"')]+)["']?\)/i); if(m)add('',m[1],el); }
      const pathNames=new Map();
      for(const p of raw){if(!p.name)continue;const key=p.imagePath.toLowerCase();if(!pathNames.has(key))pathNames.set(key,new Set());pathNames.get(key).add(p.name.toLowerCase());}
      const generic=path=>/\/(?:no-face|noface|avatar)\.[a-z]+$/i.test(path);
      const identityConflict=[...pathNames].find(([path,names])=>names.size>1&&!generic(path))?.[0]||null;
      const seen=new Set(), players=[];for(const p of raw){
        const path=p.imagePath.toLowerCase();
        const k=generic(path)&&p.name?`${path}|${p.name.toLowerCase()}`:path;
        if(seen.has(k))continue;seen.add(k);players.push(p);
      }
      const rosterText=clean(document.body.innerText).match(/\b(?:Players|Roster)\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/i);
      const declaredRoster=rosterText && Number(rosterText[2])===11?Number(rosterText[1]):null;
      const benchHeading=[...document.querySelectorAll('h3')].find(el=>clean(el.textContent)==='Team Bench');
      const benchText=[...(benchHeading?.parentElement?.querySelectorAll('span')||[])]
        .map(el=>clean(el.textContent)).find(v=>/^\d\s*\/\s*6$/.test(v));
      const benchCount=benchText?Number(benchText.split('/')[0].trim()):null;
      return {teamName,level,tk:metric('Funds'),players,identityConflict,
        rosterCount:Math.max(players.length,declaredRoster??0,benchCount==null?0:5+benchCount),
        updatedAt:new Date().toISOString()};
    });
    if(snap.identityConflict)throw new Error('Two roster players share a portrait and cannot be distinguished safely during Auto Trade. Review the roster before continuing.');
    if(initial || this.runtime.protectedStarters?.[accountId]){
      let starters=[];
      const deadline=Date.now()+(initial?30000:0);
      do{
        starters=await page.evaluate(readStadiumStartingFive).catch(()=>[]);
        if(starters.length===5 && new Set(starters.map(identityOf)).size===5 &&
           starters.every(p=>!placeholderPath(p.imagePath)||p.name))break;
        if(initial)await sleep(250);
      }while(Date.now()<deadline);
      const valid=starters.length===5 && new Set(starters.map(identityOf)).size===5 &&
        starters.every(p=>!placeholderPath(p.imagePath)||p.name);
      if(initial && !valid)
        throw new Error(`The starting five could not be identified safely for ${this._account(accountId)?.name||accountId}. No Trade was attempted.`);
      if(valid){
        this.runtime.protectedStarters ||= {};
        const protectedPlayers=this.runtime.protectedStarters[accountId]||[];
        const seen=new Set(protectedPlayers.map(identityOf));
        for(const starter of starters)if(!seen.has(identityOf(starter))){
          seen.add(identityOf(starter));protectedPlayers.push(starter);
        }
        this.runtime.protectedStarters[accountId]=protectedPlayers;
      }
    }
    const cardMap=this._cardMap();
    snap.players=(snap.players||[]).map(p=>this._decorate(p,cardMap));
    const previous=this.runtime.homeSnapshots?.[accountId];
    snap.tkSource=snap.tk!=null?'observed':previous?.tkSource==='estimated'?'estimated':'unknown';
    if(snap.tk==null && snap.tkSource==='estimated')snap.tk=previous.tk;
    if(initial && snap.tk==null)throw new Error(`Funds could not be verified for ${this._account(accountId)?.name || accountId}.`);
    if(snap.tkSource==='observed' && this._profile(accountId).tkSource==='estimated')
      this.accountProfile.merge(accountId,{tk:snap.tk,tkSource:'observed'});
    const row=this._resultRow(accountId); if(row){ if(initial&&row.startTk==null)row.startTk=snap.tk; row.currentTk=snap.tk; row.tkEstimated=snap.tkSource==='estimated'; row.tkDelta=(row.startTk!=null&&snap.tk!=null)?snap.tk-row.startTk:row.tkDelta; row.lastRoster=snap.players.map(identityOf); }
    this.runtime.homeSnapshots=this.runtime.homeSnapshots||{}; this.runtime.homeSnapshots[accountId]=snap; this._recomputeResults(); this._save();
    return snap;
  }
  _contains(players,p){const k=identityOf(p);return (players||[]).some(x=>identityOf(x)===k);}
  _scoutPrice(accountId, player) {
    const entry = this.runtime?.ledger?.find(e => e.type === 'scout-acquire' && e.accountId === accountId && identityOf(e.player) === identityOf(player));
    return entry ? num(entry.player.price) : null;
  }
  _protectedStarter(accountId, player) {
    return (this.runtime?.protectedStarters?.[accountId]||[]).some(starter=>{
      const samePath=normPath(starter.imagePath)===normPath(player.imagePath);
      if(samePath && !placeholderPath(starter.imagePath))return true;
      return Boolean(starter.name && player.name && namesMatch(starter.name,player.name));
    });
  }
  _tradeBench(accountId, players) {
    const starters=this.runtime?.protectedStarters?.[accountId];
    if(!Array.isArray(starters) || starters.length<5)
      throw new Error(`The starting five was not recorded for ${this._account(accountId)?.name||accountId}. No Trade was attempted.`);
    for(const starter of starters){
      const matches=players.filter(player=>{
        const samePath=normPath(player.imagePath)===normPath(starter.imagePath);
        return samePath && !placeholderPath(starter.imagePath) ||
          starter.name && player.name && namesMatch(starter.name,player.name);
      });
      if(matches.length>1)
        throw new Error(`A starting-five player cannot be identified uniquely on ${this._account(accountId)?.name||accountId}'s Trade roster. No offer was made.`);
    }
    return players.filter(player=>!this._protectedStarter(accountId,player));
  }
  async _readTradeRoster(page,accountId){
    const began=Date.now(),deadline=began+30000;
    let signature='',stableSince=0,players=null;
    do{
      players=await page.evaluate(readOwnTradePlayers).catch(()=>null);
      if(players && players.length>=1 && players.every(p=>p.name&&p.imagePath&&p.salary!=null&&p.price!=null)){
        const next=JSON.stringify(players);
        if(next!==signature){signature=next;stableSince=Date.now();}
        if(Date.now()-stableSince>=1200 && Date.now()-began>=2200){
          const ids=players.map(identityOf);
          if(new Set(ids).size!==ids.length)
            throw new Error(`The Trade roster has duplicate player identities on ${this._account(accountId)?.name||accountId}. No offer was made.`);
          return players.map(p=>({...this._decorate(p),tradePrice:p.price}));
        }
      }else{signature='';stableSince=0;}
      await sleep(200);
    }while(Date.now()<deadline);
    throw new Error(`The Trade roster for ${this._account(accountId)?.name||accountId} did not finish loading (${players?.length??0} visible players). No offer was made.`);
  }
  _transferCandidates(home, roleIds, fromId, toMain) {
    const excluded = new Set(this.runtime?.transferExclusions?.[fromId] || []);
    const maxPrice = num(this.runtime?.config?.purchaseMaxPrice);
    return (home.players || []).filter(p => {
      if (excluded.has(identityOf(p))) return false;
      if (this._protectedStarter(fromId,p)) return false;
      const incoming = (this.runtime?.ledger || []).some(e => e.type === 'trade-transfer'
        && e.to === fromId && identityOf(e.player) === identityOf(p));
      if (incoming) return false;
      const price = this._scoutPrice(fromId, p) ?? num(p.tradePrice);
      const cheap = price != null && maxPrice != null && price <= maxPrice;
      if (toMain) return cheap || this._hasAnyRole(p, roleIds);
      return !cheap && this._hasAnyRole(p, roleIds);
    });
  }
  _fitTrade(main,side,mainToSide,sideToMain){
    let a=[...mainToSide],b=[...sideToMain];
    const mainCount=num(main.rosterCount)??main.players.length, sideCount=num(side.rosterCount)??side.players.length;
    while(a.length||b.length){const mainAfter=mainCount-a.length+b.length, sideAfter=sideCount-b.length+a.length; if(mainAfter<=11&&sideAfter<=11&&mainAfter>=5&&sideAfter>=5)break; if(sideAfter>11&&a.length)a.pop(); else if(mainAfter>11&&b.length)b.pop(); else if(mainAfter<5&&a.length)a.pop(); else if(sideAfter<5&&b.length)b.pop(); else break;}
    const mainAfter=mainCount-a.length+b.length,sideAfter=sideCount-b.length+a.length;
    if(mainAfter>11||sideAfter>11||mainAfter<5||sideAfter<5)return {mainToSide:[],sideToMain:[]};
    return {mainToSide:a,sideToMain:b};
  }

  async _verifyScoutBatch(accountId, batch, timeoutMs=60000) {
    const session=this.sessions.get(accountId)?.session;
    if(!session)throw new Error(`Auto Trade browser session is missing for ${accountId}.`);
    const before=batch.before||[];
    const expected=batch.players||[];
    const deadline=Date.now()+timeoutMs;
    let after=null;
    while(Date.now()<deadline) {
      await this._safeBoundary();
      after=await this._snapshotHome(accountId,session.page,false);
      const additions=(after.players||[]).filter(p=>!this._contains(before,p));
      const unmatched=[...additions];
      const acquired=expected.map(p=>{
        const index=unmatched.findIndex(a=>identityOf(a)===identityOf(p));
        return index<0?null:unmatched.splice(index,1)[0];
      });
      const countBefore=num(batch.rosterBefore)??
        (expected.some(p=>placeholderPath(p.imagePath))?null:before.length);
      const countAfter=num(after.rosterCount)??after.players.length;
      const visiblePaths=new Set(after.players.map(p=>normPath(p.imagePath)));
      const verified=expected.map((p,i)=>acquired[i] ||
        (placeholderPath(p.imagePath) && visiblePaths.has(normPath(p.imagePath))
          ? {name:p.name,imagePath:p.imagePath}:null));
      if(countBefore!=null && verified.every(Boolean) && countAfter>=countBefore+expected.length){
        for(let i=0;i<expected.length;i++)this._ledger('scout-acquire',{accountId,player:{...verified[i],name:verified[i].name||expected[i].name,price:expected[i].price}});
        this.runtime.pendingScoutBatch=null;
        this._save();
        return after;
      }
      await sleep(750);
    }
    throw new Error(`Scout purchases did not appear in ${this._account(accountId)?.name||accountId}'s roster within ${Math.ceil(timeoutMs/1000)} seconds. The run is paused for review; no purchase was repeated.`);
  }

  async _scoutLoop(accountId,{allowMake}) {
    const cfg=this._config();
    // Purchase roles are independent of Trade routing. Every account may buy
    // any assigned role, as well as any player at or under Max Price.
    const purchaseRoles=new Set(this._roles().map(r=>r.id));
    const session=this.sessions.get(accountId)?.session;
    if(!session)throw new Error(`Auto Trade browser session is missing for ${accountId}.`);
    const markScout=action=>{
      // Main Make and Side Scout can run at the same time after a Trade.
      // A Side action must not erase a failed Main Make checkpoint.
      if(!allowMake && this.runtime.checkpoint?.phase==='main-make' &&
         this.runtime.checkpoint.sideId===accountId)return;
      this.runtime.checkpoint={phase:allowMake?'main-scout':'side-scout',accountId,action};
      this._save();
    };
    markScout('open-scout');
    const attemptedAgentKeys=new Set();
    let actions=0;
    for(let wave=0;wave<12;wave++) {
      await this._safeBoundary();
      await this._returnHome(accountId);
      let before=await this._snapshotHome(accountId,session.page,false);
      if((num(before.rosterCount)??before.players.length)>=11 || before.players.length>=11) {
        if(!allowMake || !(await this._makeEligible(accountId)))return;
        markScout('open-scout');
        await this._returnHome(accountId);
        before=await this._snapshotHome(accountId,session.page,false);
        if((num(before.rosterCount)??before.players.length)>=11)return;
      }
      let data=await this.scout.open(accountId);
      const roster=num(data?.roster);
      const rosterMax=Math.min(11,num(data?.rosterMax)??11);
      if(roster==null || roster<0 || roster>rosterMax)
        throw new Error(`Scout roster capacity could not be verified for ${this._account(accountId)?.name||accountId}.`);
      let slots=rosterMax-roster;
      const batch={accountId,before:before.players.map(p=>({name:p.name,imagePath:p.imagePath})),rosterBefore:num(before.rosterCount)??before.players.length,players:[]};
      let scoutExhausted=false;
      try {
        while(slots>0 && actions<40) {
          await this._safeBoundary();
          if(!Array.isArray(data?.agents))throw new Error(`Scout player list could not be read for ${this._account(accountId)?.name||accountId}.`);
          const agent=data.agents.find(a=>
            !attemptedAgentKeys.has(a.key) &&
            this._shouldBuyScout(a,cfg,purchaseRoles)
          );
          if(agent) {
            attemptedAgentKeys.add(agent.key);
            const pending={name:agent.name,imagePath:agent.imagePath,price:num(agent.price)};
            // Persist intent before clicking. If the app exits at the click,
            // Continue checks the roster rather than buying the same player again.
            batch.players.push(pending);
            this.runtime.pendingScoutBatch=batch;markScout('sign-player');
            let result;
            try{result=await this.scout.sign(accountId,agent.key);}
            catch(error){
              if(error.beforeClick){
                batch.players.pop();
                this.runtime.pendingScoutBatch=batch.players.length?batch:null;
                this._save();
              }
              throw error;
            }
            if(result.signSkipped){
              batch.players.pop();
              this.runtime.pendingScoutBatch=batch.players.length?batch:null;
              this._save();

              data=result;

              // Bu denemede yeni oyuncu alınmadı.
              // "You already signed" sonrası Scout roster değeri kısa süreli yanlış/full
              // görünebildiği için kalan slot sayısını burada değiştirme.
              actions++;
              continue;
            }
            data=result;
            slots=Math.max(0,Math.min(slots-1,num(data.roster)==null?slots-1:rosterMax-num(data.roster)));
            actions++;
            this.runtime.message=`${this._account(accountId)?.name||accountId}: ${batch.players.length} Scout purchase(s); ${slots} roster slots remain.`;
            this._save();
            continue;
          }
          if(data.agents.some(a=>a.canSign && num(a.price)==null))
            throw new Error(`Some available Scout Price values could not be read for ${this._account(accountId)?.name||accountId}; selection was paused.`);
          const attempts=num(data.attempts);
          if(attempts==null)throw new Error('Free Attempts could not be read; Call Back was not clicked.');
          if(attempts<=0){scoutExhausted=true;break;}
          const signature=value=>(value?.agents||[]).map(a=>`${a.key}:${a.price}:${a.canSign}`).join('|');
          markScout('call-back');
          const next=await this.scout.callback(accountId);
          if(next?.attempts===data.attempts && signature(next)===signature(data))
            throw new Error('Scout Call Back did not change the attempts or player list; stopped to avoid a second click.');
          data=next;actions++;
        }
      } finally {
        await this.scout.close(accountId).catch(()=>{});
      }
      if(accountId!==this.runtime.mainAccountId && num(data?.roster)!=null){
        this._scoutRosterCounts ||= new Map();
        this._scoutRosterCounts.set(accountId,num(data.roster));
      }
      const verified=batch.players.length?await this._verifyScoutBatch(accountId,batch):null;

      if(
        accountId===this.runtime.mainAccountId &&
        batch.players.length
      ){
        this.runtime.pendingMakePlayers=batch.players.map(p=>({
          name:p.name,
          imagePath:p.imagePath,
          price:p.price
        }));
        this._save();
      }

      if(actions>=40)throw new Error('Scout reached the maximum number of verified actions without completing.');
      if(!allowMake)return;
      const home=verified || await this._snapshotHome(accountId,session.page,false);
      const full=(num(home.rosterCount)??home.players.length)>=rosterMax;
      this.runtime.phase='main-make';
      this.runtime.message=full?'Main roster is full; converting eligible players to Star Cards.':
        'Scout attempts and eligible purchases are exhausted; converting remaining eligible players to Star Cards.';
      this._save();
      if(!(await this._makeEligible(accountId,{expectedPlayers:batch.players,scoutRosterCount:num(data.roster)})))return;
      if(scoutExhausted && !full)return;
      markScout('open-scout');
    }
    throw new Error('Scout / Make reached the maximum number of verified rounds without completing.');
  }

  async _openMainStarCards(accountId,page) {
    await this._returnHome(accountId);
    this.runtime.phase='main-make';
    this.runtime.message='Main roster full · clicking the Stadium Star Card button';
    this._save();
    if(this.sessions.get(accountId)?.session?.visible && page.bringToFront)
      await page.bringToFront().catch(()=>{});
    const image=page.locator(STAR_CARD_IMAGE).first();
    await image.waitFor({state:'visible',timeout:60000});
    const button=image.locator('xpath=ancestor::button[1]');
    if(!(await button.count()))throw new Error('The Stadium Star Card image is visible but its button could not be found.');
    await button.click({timeout:30000});
    const nav=page.locator('nav[aria-label="Star card sections"]').first();
    await nav.waitFor({state:'visible',timeout:60000});
    await nav.locator('button').filter({hasText:'Make'}).first().waitFor({state:'visible',timeout:30000});
    this.runtime.message='Main Star Cards opened · selecting Make';this._save();
    this._log('info','Stadium Star Card button clicked; Star Cards navigation and Make tab are visible.',this._account(accountId));
  }

  async _verifyPendingMake(accountId, pending, timeoutMs=60000) {
    const page=this.sessions.get(accountId)?.session?.page;
    if(!page)throw new Error('The Main session is missing for Star Card verification.');
    const selected=pending.players||[];
    const rosterBefore=num(pending.rosterBefore);
    const rosterDeadline=Date.now()+timeoutMs;
    let after,confirmed=0;
    if(pending.rosterSource==='scout'){
      // Stadium can show only the court five. Verify the real roster number
      // from Scout rather than treating invisible bench players as converted.
      await this._returnHome(accountId);
      try{
        await this.scout.open(accountId);
        do{
          await this._safeBoundary();
          const count=await page.evaluate(()=>{
            const dialog=document.querySelector('[role="dialog"][aria-label="Free agency"]');
            const match=(dialog?.innerText||'').match(/\bPlayers\s*(\d+)\s*\/\s*11\b/i);
            return match?Number(match[1]):null;
          }).catch(()=>null);
          confirmed=count!=null && rosterBefore!=null && count<=rosterBefore-selected.length?confirmed+1:0;
          if(confirmed>=2)break;
          await sleep(750);
        }while(Date.now()<rosterDeadline);
      }finally{await this.scout.close(accountId).catch(()=>{});}
    }else{
      do{
        await this._safeBoundary();
        after=await this._snapshotHome(accountId,page,false);
        const countAfter=num(after.rosterCount);
        const countConfirmed=rosterBefore==null || countAfter!=null && countAfter<=rosterBefore-selected.length;
        confirmed=countConfirmed && selected.every(p=>!this._contains(after.players,p))?confirmed+1:0;
        if(confirmed>=2)break;
        await sleep(750);
      }while(Date.now()<rosterDeadline);
    }
    if(confirmed<2)
      throw new Error('The Main roster has not confirmed the Star Card conversion. The conversion will not be repeated.');
    for(const p of selected)this._ledger('make-card',{accountId,player:p});

    this.runtime.pendingMake=null;
    this.runtime.pendingMakePlayers=null;
    this._save();
    this._log('success',`${selected.length} Star Card(s) verified by the Main roster decrease.`,this._account(accountId));
    return selected.length;
  }

  async _retryUnconfirmedMake(accountId,pending){
    // A saved Convert intent may be left by a click timeout. Wait for the
    // delayed roster update first; retry only if the original whole roster is
    // unchanged and every intended player is still in Make's live bench.
    const page=this.sessions.get(accountId)?.session?.page;
    const after=await this._snapshotHome(accountId,page,false);
    const count=num(after.rosterCount);
    const baseline=pending.rosterPlayers||[];
    if(count!==num(pending.rosterBefore) ||
       baseline.length && (baseline.length!==after.players.length ||
         baseline.some(p=>!this._contains(after.players,p))) ||
       (pending.players||[]).some(p=>!this._contains(after.players,p)))
      throw new Error('Star Card conversion has an unverified roster change. Review Main before trying Convert again.');
    await this._openMainStarCards(accountId,page);
    await page.locator('nav[aria-label="Star card sections"] button').filter({hasText:'Make'}).first().click({timeout:30000});
    await page.getByText('Your Bench',{exact:true}).waitFor({state:'visible',timeout:60000});
    await this._waitMakeBench(accountId,page,pending.players,{timeoutMs:30000,stableMs:1200});
    const previous=this.runtime.checkpoint||{};
    this.runtime.pendingMake=null;
    this.runtime.checkpoint={phase:'main-make',accountId,action:'select-players',
      returnPhase:previous.phase==='main-make'?previous.returnPhase:previous.phase,
      sideId:previous.sideId||this.runtime.activeSideAccountId||null,
      sideScoutDone:previous.sideScoutDone};
    this._save();
    this._log('info','Unchanged roster and Make bench verified; retrying the saved Star Card action.',this._account(accountId));
  }

  async _waitMakeBench(accountId, page, requiredPlayers, {timeoutMs=120000,stableMs=1200,minWaitMs=15000}={}) {
    // Make omits unsellable, rookie and X players, so its count is not the
    // Stadium's bench count. Only players this run acquired via Scout/Trade
    // are required to appear.
    const required=requiredPlayers||[];
    this.runtime.message=required.length
      ? `Star Card Make · waiting for ${required.length} known player(s) to appear`
      : 'Star Card Make · waiting for the eligible bench list to settle';
    this._save();
    const started=Date.now();
    const deadline=Date.now()+timeoutMs;
    let lastSignature='',stableSince=0;
    do{
      await this._safeBoundary();
      const bench=await page.evaluate(readMakeBenchTiles).catch(()=>null);
      if(bench){
        const signature=JSON.stringify(bench);
        if(signature!==lastSignature){lastSignature=signature;stableSince=Date.now();}
        const allPresent=required.every(p=>bench.some(tile=>resolveMakeBenchPlayer([p],tile)));
        if(allPresent && Date.now()-stableSince>=stableMs &&
           Date.now()-started>=(required.length?0:minWaitMs))return bench;
      }else{lastSignature='';stableSince=0;}
      await sleep(250);
    }while(Date.now()<deadline);
    const detail=await page.evaluate(()=>{
      const raw=[...document.querySelectorAll('img,[style*="background-image"]')]
        .map(el=>el.tagName==='IMG'?el.getAttribute('src'):el.getAttribute('style'))
        .filter(Boolean).filter(v=>/players|_next\/image/i.test(v));
      return {url:location.pathname,heading:[...document.querySelectorAll('h1,h2,h3,h4,span')].some(el=>el.textContent.trim()==='Your Bench'),visiblePortraits:raw.length,portraitSamples:raw.slice(0,3)};
    }).catch(()=>null);
    this._log('warning',`Make bench inspection: ${JSON.stringify({requiredPlayers:required.map(p=>p.name||p.imagePath),...detail})}`,this._account(accountId));
    throw new Error(`Star Cards Make did not show ${required.length} known Scout/Trade player(s) within ${Math.ceil(timeoutMs/1000)} seconds. No conversion was attempted.`);
  }

  async _makeEligible(accountId,{expectedPlayers=[],scoutRosterCount=null}={}) {
    if(accountId!==this.runtime.mainAccountId)return 0;
    if(this.runtime.pendingMake)return this._verifyPendingMake(accountId,this.runtime.pendingMake);

    if(
      !expectedPlayers.length &&
      Array.isArray(this.runtime.pendingMakePlayers) &&
      this.runtime.pendingMakePlayers.length
    ){
      expectedPlayers=this.runtime.pendingMakePlayers;
    }
    const previous=this.runtime.checkpoint||{};
    this.runtime.checkpoint={phase:'main-make',accountId,action:'open-make',
      returnPhase:previous.phase==='main-make'?previous.returnPhase:previous.phase,
      sideId:previous.sideId||this.runtime.activeSideAccountId||null,
      sideScoutDone:previous.sideScoutDone};
    this._save();
    const e=this.sessions.get(accountId); if(!e)return 0; await this._returnHome(accountId);
    const before=await this._snapshotHome(accountId,e.session.page,false);
    // Stadium can render only five starters while Scout sees one or more
    // bench players. Skip Make only when Scout also confirmed exactly five.
    if(num(before.rosterCount)===5 && num(scoutRosterCount)===5)return 0;
    const cardRoles=[...new Set([...(this.runtime.config.makeRoleIds||[]),'card'])];
    const cardMap=this._cardMap();
    const rosterCandidates=before.players.filter(p=>!this._protectedStarter(accountId,p) &&
      (!placeholderPath(p.imagePath)||p.name) && (
      this._hasAnyRole(p,cardRoles)
      || (this._scoutPrice(accountId,p)!=null && this._scoutPrice(accountId,p)<=this.runtime.config.purchaseMaxPrice)
      || (this.runtime.ledger||[]).some(e=>e.type==='trade-transfer'&&e.to===accountId&&identityOf(e.player)===identityOf(p)&&e.routeToCard)
    ));
    const addCandidate=p=>{
      const index=rosterCandidates.findIndex(old=>identityOf(old)===identityOf(p) ||
        placeholderPath(p.imagePath)&&normPath(old.imagePath)===normPath(p.imagePath)&&namesMatch(old.name,p.name));
      if(index<0)rosterCandidates.push(p);
      else if((p.name||'').length>(rosterCandidates[index].name||'').length)
        rosterCandidates[index]={...rosterCandidates[index],...p};
    };
    const hasPortrait=p=>before.players.some(home=>normPath(home.imagePath)===normPath(p.imagePath));
    const alreadyMade=p=>(this.runtime.ledger||[]).some(entry=>entry.type==='make-card'&&entry.accountId===accountId&&identityOf(entry.player)===identityOf(p));
    for(const player of expectedPlayers||[]){
      if(!player || alreadyMade(player) || this._protectedStarter(accountId,player))continue;

      const candidate=this._decorate(player,cardMap);
      const price=num(player.price);

      if(
        this._hasAnyRole(candidate,cardRoles) ||
        (price!=null && price<=this.runtime.config.purchaseMaxPrice)
      ){
        addCandidate(candidate);
      }
    }
    for(const entry of this.runtime.ledger||[]){
      if(!entry.player || alreadyMade(entry.player) || this._protectedStarter(accountId,entry.player))continue;
      const acquired=entry.type==='scout-acquire'&&entry.accountId===accountId;
      const inbound=entry.type==='trade-transfer'&&entry.to===accountId&&entry.routeToCard;
      if(!acquired&&!inbound)continue;
      const candidate=this._decorate(entry.player,cardMap);
      if(inbound || this._hasAnyRole(candidate,cardRoles) ||
         num(entry.player.price)!=null&&num(entry.player.price)<=this.runtime.config.purchaseMaxPrice)
        addCandidate(candidate);
    }
    for(const card of cardMap){
      if(placeholderPath(card.imagePath) && hasPortrait(card) && !alreadyMade(card) &&
        this._hasAnyRole(card,cardRoles))
        addCandidate(card);
    }
    const page=e.session.page;
    await this._openMainStarCards(accountId,page);
    const makeNav=page.locator('nav[aria-label="Star card sections"] button').filter({hasText:'Make'}).first();
    await makeNav.click({timeout:30000});
    await page.getByText('Your Bench',{exact:true}).waitFor({state:'visible',timeout:60000});
    // The current Scout wave is authoritative for delayed arrivals. Historical
    // ledger entries may already have been made or transferred away; requiring
    // every old portrait here can leave Make waiting even with an empty bench.
    const incoming=(this.runtime.ledger||[]).filter(entry=>entry.type==='trade-transfer' &&
      entry.to===accountId && entry.routeToCard && !alreadyMade(entry.player))
      .map(entry=>entry.player);
    const knownArrivals=[...expectedPlayers,...incoming]
      .filter(p=>rosterCandidates.some(candidate=>identityOf(candidate)===identityOf(p)))
      .filter((p,index,all)=>all.findIndex(other=>identityOf(other)===identityOf(p))===index);
    const bench=await this._waitMakeBench(accountId,page,knownArrivals);
    this.runtime.message=`Star Card Make · ${bench.length} bench portrait(s) read`;this._save();
    const eligible=[...rosterCandidates];
    // Existing players with a Card role are eligible too, even if they were
    // acquired manually or Stadium did not label their portraits as Bench.
    for(const tile of bench){
      const card=resolveMakeBenchPlayer(cardMap,tile);
      const decorated={...tile,name:card?.name||tile.name,
        roleIds:card?.roleIds||[],roles:card?.roles||[],cardKey:card?.key||null};
      if(this._hasAnyRole(decorated,cardRoles)){
        if(!eligible.some(p=>identityOf(p)===identityOf(decorated)))eligible.push(decorated);
      }
    }
    if(!eligible.length){
      this._log('info','Main Star Cards checked: no roster or bench player matches the Card role or verified purchase rules.',this._account(accountId));
      await this._returnHome(accountId);
      return 0;
    }
    const onBench=[];
    for(const tile of bench){
      const match=resolveMakeBenchPlayer(eligible,tile);
      if(match && !onBench.some(p=>identityOf(p)===identityOf(match)))
        onBench.push({...match,name:match.name||tile.name,imagePath:tile.imagePath||match.imagePath});
    }

    this._log(
      'warning',
      `MAKE DEBUG · bench=${JSON.stringify(
        bench.map(p=>({name:p.name,imagePath:p.imagePath}))
      )} · eligible=${JSON.stringify(
        eligible.map(p=>({name:p.name,imagePath:p.imagePath,roleIds:p.roleIds,price:p.price}))
      )}`,
      this._account(accountId)
    );

    if(!onBench.length){
      this._log('info','Star Card Make has no eligible bench player; players in the starting five are left on the team.',this._account(accountId));
      await this._returnHome(accountId);
      return 0;
    }
    // Go straight from Make selection to its confirmation. The Auto Trade
    // conversion never navigates to My Player Card.
    const clear=page.getByRole('button',{name:'Clear All',exact:true}).first();
    if(await clear.isVisible().catch(()=>false)){
      await clear.click({timeout:10000});
      const until=Date.now()+10000;
      while(Date.now()<until){
        if(!(await page.evaluate(readMakeSelectedNames)).length)break;
        await sleep(150);
      }
      if((await page.evaluate(readMakeSelectedNames)).length)
        throw new Error('Make could not clear the previous selection. No conversion was attempted.');
    }
    const selected=[];
    for(const p of onBench){
      const ok=await page.evaluate(selectMakeBenchTile,{path:p.imagePath,name:p.name}).catch(()=>false);
      if(!ok)throw new Error(`Eligible player ${p.name||p.imagePath} could not be selected from Your Bench. No Star Cards were converted.`);
      const deadline=Date.now()+10000;
      let names=[];
      do{
        names=await page.evaluate(readMakeSelectedNames).catch(()=>[]);
        if(names.length===selected.length+1 && names.some(name=>namesMatch(name,p.name)))break;
        await sleep(150);
      }while(Date.now()<deadline);
      if(names.length!==selected.length+1 || !names.some(name=>namesMatch(name,p.name)))
        throw new Error(`Make did not confirm the selection of ${p.name||p.imagePath}; no conversion was attempted.`);
      selected.push(p);
    }
    const selectedNames=await page.evaluate(readMakeSelectedNames).catch(()=>[]);
    if(selectedNames.length!==selected.length || selectedNames.some(name=>!selected.some(p=>namesMatch(name,p.name))))
      throw new Error('Make selection verification failed.');
    this.runtime.checkpoint.action='open-confirmation';this._save();
    // The game uses the singular "Star Card" when exactly one player is selected.
    const makeButton=page.getByRole('button',{name:new RegExp(`^Make\\s+${selected.length}\\s+Star Cards?$`,'i')}).first();
    try{await makeButton.click({timeout:15000});}
    catch(error){
      const actual=await page.locator('button').evaluateAll(buttons=>buttons
        .map(b=>(b.textContent||'').replace(/\s+/g,' ').trim())
        .filter(text=>/^Make\b/i.test(text)).slice(0,8)).catch(()=>[]);
      throw new Error(`Make button for ${selected.length} selected player(s) could not be clicked. Visible Make labels: ${actual.join(' | ')||'none'}. ${error.message}`);
    }
    await page.locator(MAKE_CONFIRM).waitFor({state:'visible',timeout:30000});
    const confirmTiles=await page.locator(`${MAKE_CONFIRM} img[alt]`).evaluateAll(xs=>xs.map(x=>{
      let src=x.getAttribute('src')||'';
      if(src.includes('/_next/image')){
        try{src=new URL(src,location.href).searchParams.get('url')||src;}catch{}
      }
      const path=src.replace(/^https?:\/\/[^/]+/i,'').split('?')[0];
      return {name:x.getAttribute('alt')||'',imagePath:/^\/?players\//i.test(path)?`/${path.replace(/^\/+/, '')}`:''};
    }).filter(x=>x.name && x.imagePath));
    const confirmed=matchMakeConfirmation(selected,confirmTiles);
    if(!confirmed)
      throw new Error('Make confirmation player list mismatch.');
    // The confirmation click is a non-repeatable action. Persist the roster
    // baseline first so a restarted run verifies the result without repeating it.
    const scoutCount=num(scoutRosterCount),homeCount=num(before.rosterCount);
    const pending={accountId,players:selected.map(p=>({name:p.name,imagePath:p.imagePath})),
      rosterBefore:scoutCount!=null && scoutCount>homeCount?scoutCount:homeCount,
      rosterSource:scoutCount!=null && scoutCount>homeCount?'scout':'home',
      rosterPlayers:before.players.map(p=>({name:p.name,imagePath:p.imagePath}))};
    this.runtime.pendingMake=pending;this._save();
    this.runtime.checkpoint.action='convert-players';this._save();
    await page.locator(MAKE_CONFIRM).getByRole('button',{name:new RegExp(`^Convert\\s+${selected.length}\\s+to Star Cards?$`,'i')}).click();
    await page.locator(MAKE_PROGRESS).waitFor({state:'visible',timeout:30000}).catch(()=>{});
    await page.locator(MAKE_PROGRESS).waitFor({state:'hidden',timeout:120000}).catch(()=>{});
    return this._verifyPendingMake(accountId,pending);
  }

  async _createSideTradeRoom(page) {
    await this._openTradeRooms(page);
    const sideRooms=page.locator(ROOM_DIALOG);
    await sideRooms.getByRole('button',{name:'Create Room',exact:true}).click({timeout:30000});
    const createForm=page.locator(CREATE_DIALOG);
    await createForm.waitFor({state:'visible',timeout:30000});
    await createForm.locator('input[placeholder="e.g. Looking to trade SF"]').fill(this.runtime.config.roomDescription);
    const roomPassword=this.runtime.config.roomPasswordEncrypted?this.credentials.decryptSecret(this.runtime.config.roomPasswordEncrypted):'';
    if(roomPassword)await createForm.locator('input[type="password"]').fill(roomPassword);
    await createForm.getByRole('button',{name:'Create Room',exact:true}).click({timeout:30000});
    await createForm.waitFor({state:'hidden',timeout:30000});
    return roomPassword;
  }

  async _executeTrade(sideId, mainToSide, sideToMain) {
    const mainId=this.runtime.mainAccountId, main=this._account(mainId), side=this._account(sideId);
    const sideSession=this.sessions.get(sideId).session, mainSession=this.sessions.get(mainId).session;
    this.runtime.checkpoint={phase:'side-trade',accountId:sideId,action:'create-room'};this._save();
    await this._returnHome(sideId); await this._returnHome(mainId);
    const roomPassword=await this._createSideTradeRoom(sideSession.page);
    this.runtime.checkpoint.action='join-room';this._save();

    await this._joinSideRoom(mainSession.page,sideId,roomPassword);
    await this._waitTradeDesk(sideSession.page);
    await this._verifyParticipants(mainSession.page,main,side); await this._verifyParticipants(sideSession.page,side,main);
    this.runtime.checkpoint.action='prepare-offers';this._save();

    // Only the Trade desk contains the whole current roster. Rebuild both
    // offers from its live cards, excluding the five saved at Stadium login.
    const [fullMain,fullSide]=await Promise.all([
      this._readTradeRoster(mainSession.page,mainId),
      this._readTradeRoster(sideSession.page,sideId)
    ]);
    const mainBench=this._tradeBench(mainId,fullMain);
    const sideBench=this._tradeBench(sideId,fullSide);
    const config=this.runtime.config;
    const allMain=this._transferCandidates({players:mainBench},config.mainToSideRoleIds,mainId,false)
      .filter(p=>!this._contains(fullSide,p))
      .filter(p=>!(this.runtime.deferredMainToSideBySide?.[sideId]||[]).includes(identityOf(p)));
    const allSide=this._transferCandidates({players:sideBench},config.sideToMainRoleIds,sideId,true)
      .filter(p=>!this._contains(fullMain,p));
    const blocked=[...allMain,...allSide].filter(p=>!p.selectable);
    if(blocked.length)
      throw new Error(`An eligible bench player cannot be selected in Trade: ${blocked[0].name}. No offer was made.`);
    // The Trade roster includes the whole team; Stadium may display only five.
    // Use the live sizes so neither side can exceed eleven after confirmation.
    const mainRosterCount =
      num(this.runtime.homeSnapshots?.[mainId]?.rosterCount) ??
      fullMain.length;

    const sideRosterCount =
      this._scoutRosterCounts?.get(sideId) ??
      num(this.runtime.homeSnapshots?.[sideId]?.rosterCount) ??
      fullSide.length;

    const fitted=this._fitTrade(
      {players:fullMain,rosterCount:mainRosterCount},
      {players:fullSide,rosterCount:sideRosterCount},
      allMain.slice(0,5),
      allSide.slice(0,5)
    );
    if((allMain.length||allSide.length) && !fitted.mainToSide.length && !fitted.sideToMain.length)
      throw new Error('Eligible bench players were found, but current roster limits prevent a safe Trade. No offer was made.');
    mainToSide=fitted.mainToSide;sideToMain=fitted.sideToMain;
    mainToSide = await this._enrichAndFilterTradePlayers(mainSession.page, mainId, mainToSide);
    sideToMain = await this._enrichAndFilterTradePlayers(sideSession.page, sideId, sideToMain);

    const mainTk = num(this.runtime.homeSnapshots?.[mainId]?.tk);
    const sideTk = num(this.runtime.homeSnapshots?.[sideId]?.tk);
    if(mainTk==null||sideTk==null)throw new Error('Trade Funds could not be verified for both accounts.');
    const sum = xs => xs.reduce((a,p)=>a+Number(p.price||0),0);
    while (mainToSide.length && sum(mainToSide)-sum(sideToMain) > sideTk) {
      const deferred = mainToSide.pop();
      this.runtime.deferredMainToSideBySide ||= {};
      this.runtime.deferredMainToSideBySide[sideId] ||= [];
      if (!this.runtime.deferredMainToSideBySide[sideId].includes(identityOf(deferred))) this.runtime.deferredMainToSideBySide[sideId].push(identityOf(deferred));
      this.runtime.problems.push({ accountId:sideId, type:'side-tk', message:`${deferred.name||'Player'} was deferred to a later Side account because this account cannot afford the Price difference.` });
      this._save();
    }
    const mainPayment = Math.max(0, sum(sideToMain)-sum(mainToSide));
    if (mainPayment > mainTk) {
      this.runtime.paused=true; this.runtime.status='paused'; this.runtime.phase='insufficient-main-tk'; this.runtime.message=`Main Account needs ${mainPayment} TK for the pending Trade but has ${mainTk} TK.`;
      this.runtime.checkpoint={phase:'insufficient-main-tk',accountId:mainId,sideId};
      this.runtime.problems.push({ accountId:mainId,type:'main-tk',message:this.runtime.message }); this._save();
      await this._closeAllSessions();
      throw new Error('__PAUSE_CHECKPOINT__');
    }
    if (!mainToSide.length && !sideToMain.length) {
      await mainSession.page.getByRole('button',{name:/^Cancel$/i}).first().click().catch(()=>{});
      await sideSession.page.getByRole('button',{name:/^Cancel$/i}).first().click().catch(()=>{});
      await Promise.all([this._waitHomeAfterTrade(mainId,mainSession.page),
        this._waitHomeAfterTrade(sideId,sideSession.page)]);
      return false;
    }

    await this._selectOffer(mainSession.page,mainToSide); await this._selectOffer(sideSession.page,sideToMain);
    await this._verifyOffer(mainSession.page,mainToSide); await this._verifyOffer(sideSession.page,sideToMain);
    await this._agree(sideSession.page,side);
    await this._agree(mainSession.page,main);
    const confirm=await this._waitTradeConfirmReady(sideSession.page,sideId,mainId);
    this.runtime.pendingTrade={sideId,mainToSide,sideToMain,mainBefore:mainTk,sideBefore:sideTk,at:new Date().toISOString()};
    this.runtime.checkpoint={phase:'trade-confirm',accountId:sideId};this._save();
    await confirm.click();
    await Promise.all([this._waitHomeAfterTrade(mainId,mainSession.page),this._waitHomeAfterTrade(sideId,sideSession.page)]);
    await this._verifyTransferOnFreshDesk(sideId,mainToSide,sideToMain);
    const mainAfter=await this._snapshotHome(mainId,mainSession.page,false), sideAfter=await this._snapshotHome(sideId,sideSession.page,false);
    for(const p of mainToSide)this._ledger('trade-transfer',{from:mainId,to:sideId,player:p});
    for(const p of sideToMain)this._ledger('trade-transfer',{from:sideId,to:mainId,player:p,routeToCard:true});
    this._syncTradeTk(mainId,sideId,mainTk,sideTk,mainToSide,sideToMain,mainAfter,sideAfter);
    this._scoutRosterCounts?.delete(sideId);
    this.runtime.pendingTrade=null;this.runtime.checkpoint={phase:'post-trade',accountId:sideId};this._save();
    return true;
  }

  async _verifyTransferOnFreshDesk(sideId,mainToSide,sideToMain) {
    const mainId=this.runtime.mainAccountId;
    const mainPage=this.sessions.get(mainId)?.session?.page;
    const sidePage=this.sessions.get(sideId)?.session?.page;
    if(!mainPage || !sidePage)throw new Error('Both accounts must remain open to verify the completed Trade.');
    this.runtime.checkpoint={phase:'trade-verify',accountId:sideId,action:'read-rosters'};this._save();
    const password=await this._createSideTradeRoom(sidePage);
    await this._joinSideRoom(mainPage,sideId,password);
    await this._waitTradeDesk(sidePage);
    await this._verifyParticipants(mainPage,this._account(mainId),this._account(sideId));
    await this._verifyParticipants(sidePage,this._account(sideId),this._account(mainId));
    const deadline=Date.now()+60000;
    let verified=false;
    do{
      const [main,side]=await Promise.all([
        mainPage.evaluate(readOwnTradePlayers).catch(()=>null),
        sidePage.evaluate(readOwnTradePlayers).catch(()=>null)
      ]);
      if(main && side && mainToSide.every(p=>resolveTradePlayer(side,p)&&!resolveTradePlayer(main,p)) &&
         sideToMain.every(p=>resolveTradePlayer(main,p)&&!resolveTradePlayer(side,p))) {
        verified=true;break;
      }
      await sleep(500);
    }while(Date.now()<deadline);
    if(!verified)throw new Error('Trade returned Home, but the expected player transfer could not be verified in both Trade rosters. The Trade remains pending for review.');
    await Promise.all([mainPage,sidePage].map(page=>page.getByRole('button',{name:/^Cancel$/i}).first().click({timeout:15000})));
    await Promise.all([this._waitHomeAfterTrade(mainId,mainPage),this._waitHomeAfterTrade(sideId,sidePage)]);
  }

  _syncTradeTk(mainId,sideId,mainBefore,sideBefore,mainToSide,sideToMain,mainAfter,sideAfter) {
    const sum=players=>players.reduce((value,p)=>value+num(p.price),0);
    const mainDelta=sum(mainToSide)-sum(sideToMain);
    for(const [accountId,before,after,delta] of [[mainId,mainBefore,mainAfter,mainDelta],[sideId,sideBefore,sideAfter,-mainDelta]]) {
      const observed=after.tkSource==='observed'?num(after.tk):null;
      const expected=before+delta;
      const current=observed??expected;
      after.tk=current;
      after.tkSource=observed!=null?'observed':'estimated';
      this.runtime.homeSnapshots[accountId]=after;
      this.accountProfile.merge(accountId,{tk:current,tkSource:after.tkSource});
      const row=this._resultRow(accountId);
      if(row){row.currentTk=current;row.tkEstimated=observed==null;row.tkDelta=row.startTk!=null?current-row.startTk:row.tkDelta;}
      if(observed!=null && observed!==expected)this._log('warning',`Trade Funds differ from Price estimate for ${this._account(accountId)?.name||accountId}: observed ${observed} TK, expected ${expected} TK.`,this._account(accountId));
    }
    this._recomputeResults();this._save();
  }

  async _enrichAndFilterTradePlayers(page, fromId, players) {
    const visible=await page.evaluate(readOwnTradePlayers).catch(()=>[]);
    const out=[];
    for(const p of players){
      const found=resolveTradePlayer(visible,p);
      const price=found?num(found.price):null;
      if(price==null||price<0){
        const err=new Error(`Current Trade Price could not be verified for ${p.name||'Player'} on ${this._account(fromId)?.name||fromId}.`);
        err.sideOnly=fromId!==this.runtime.mainAccountId;
        throw err;
      }
      out.push({
        ...p,
        name:p.name||found.name,
        position:found.position||p.position,
        rating:found.rating||p.rating,
        offense:found.offense??p.offense,
        defense:found.defense??p.defense,
        salary:found.salary??p.salary,
        price
      });
    }
    this._save();
    return out;
  }

  async _openTradeRooms(page){if(await page.locator(ROOM_DIALOG).isVisible().catch(()=>false))return;await page.locator(TRADE_ICON).first().click();await page.locator(ROOM_DIALOG).waitFor({state:'visible',timeout:60000});}
  async _joinSideRoom(page,sideId,roomPassword){
    const host=clean(this.runtime.homeSnapshots?.[sideId]?.teamName||this._profile(sideId)?.teamName);
    if(!host)throw new Error('Side team name is missing; Main cannot identify the correct Trade room.');
    await this._openTradeRooms(page);
    await page.locator('input[placeholder="Search by host team name"]').fill(host);
    // The row also contains status and other text; only its Host label may
    // identify the Side account. Never use the first search result blindly.
    const hostLabel=page.locator('span.w-32 > span:first-child')
      .filter({hasText:new RegExp(`^\\s*${escapeRegExp(host)}\\s*$`,'i')});
    const rooms=page.locator(`${ROOM_DIALOG} li`).filter({has:hostLabel});
    await rooms.first().waitFor({state:'visible',timeout:30000});
    if(await rooms.count()!==1)throw new Error(`Multiple Trade rooms belong to ${host}; cannot choose one safely.`);
    const join=rooms.first().getByRole('button',{name:'Join',exact:true});
    if(!(await join.isEnabled()))throw new Error(`The Trade room for ${host} cannot be joined.`);
    await join.scrollIntoViewIfNeeded({timeout:15000});
    const bounds=await join.boundingBox();
    if(!bounds || bounds.width<24 || bounds.height<12)
      throw new Error(`The Trade room Join button for ${host} is not visible at a usable size.`);
    // The game's Join label sits in a child span that does not handle pointer
    // clicks reliably. Hit the button's left padding (px-3), outside the span.
    const joinPadding={x:Math.min(7,bounds.width/6),y:bounds.height/2};
    let passwordSeen=false,dialogError=null;
    const handleDialog=async dialog=>{
      try{
        if(dialog.type()==='prompt' && /protected|password/i.test(dialog.message()) && roomPassword){
          passwordSeen=true;
          await dialog.accept(roomPassword);
        }else{
          dialogError=new Error(`The Trade room for ${host} requested an unexpected confirmation or password.`);
          await dialog.dismiss();
        }
      }catch(error){dialogError=error;await dialog.dismiss().catch(()=>{});}
    };
    // Playwright waits for a JS prompt before resolving click(). Its handler
    // must accept the password while click is in progress.
    page.on('dialog',handleDialog);
    try{
      await join.click({position:joinPadding,timeout:30000});
      if(dialogError)throw dialogError;
      if(roomPassword && !passwordSeen)throw new Error(`The protected Trade room for ${host} did not request its password.`);
      await this._waitTradeDesk(page);
      if(dialogError)throw dialogError;
    }finally{page.off('dialog',handleDialog);}
  }
  async _waitTradeDesk(page){await page.getByText('Trade Desk',{exact:true}).first().waitFor({state:'visible',timeout:60000});}
  async _verifyParticipants(page,self,other){
    const sideId=this.runtime.activeSideAccountId||this.runtime.checkpoint?.accountId;
    const mainId=this.runtime.mainAccountId;
    const sideTeam=this.runtime.homeSnapshots?.[sideId]?.teamName||this._profile(sideId)?.teamName;
    const mainTeam=this.runtime.homeSnapshots?.[mainId]?.teamName||this._profile(mainId)?.teamName;
    if(!sideTeam||!mainTeam||sideTeam===mainTeam ||
       ![sideId,mainId].includes(self.id)||![sideId,mainId].includes(other.id))
      throw new Error(`Trade participants could not be verified for ${self.name} and ${other.name}.`);
    const slots=await page.evaluate(()=>[...document.querySelectorAll('div.flex.gap-3.items-stretch > div.flex-1.min-w-0.flex.flex-col')]
      .map(panel=>{
        const header=panel.firstElementChild;
        const labels=[...(header?.querySelectorAll('span')||[])].map(el=>(el.textContent||'').trim());
        return {team:labels[0]||'',you:labels.includes('You')};
      }));
    if(slots.length!==2 || clean(slots[0].team)!==clean(sideTeam) ||
       clean(slots[1].team)!==clean(mainTeam) ||
       slots[0].you!==(self.id===sideId) || slots[1].you!==(self.id===mainId))
      throw new Error(`Trade participants could not be verified for ${self.name} and ${other.name}.`);
    return true;
  }
  async _offerCardState(page,player){
    return page.evaluate(tradeCardAction,{player:{
      name:player.name,
      position:player.position,
      rating:player.rating,
      salary:player.salary,
      price:player.price
    },action:'state'});
  }
  async _selectOffer(page,players){
    this.offerProofs ||= new WeakMap();
    const proof=new Map();
    this.offerProofs.set(page,proof);

    if(!players.length){
      const summary=await page.evaluate(readOwnTradeOfferCount);
      if(!summary || summary.count!==0)
        throw new Error('The Trade offer contains an unexpected player. No agreement was made.');
    }

    for(const [index,p] of players.entries()){
      const before=await this._offerCardState(page,p);
      if(!before)throw new Error(`Trade player could not be found in the own roster: ${p.name||'Unknown player'}`);
      if(before.offerCount!==index || before.offerLimit<players.length)
        throw new Error('Trade offer already contains players or has insufficient room. No more players were selected.');

      const clicked=await page.evaluate(tradeCardAction,{player:{
        name:p.name,
        position:p.position,
        rating:p.rating,
        salary:p.salary,
        price:p.price
      },action:'click'}).catch(()=>false);
      if(!clicked)throw new Error(`Trade player could not be selected: ${p.name||'Unknown player'}`);

      let changed=null;
      const deadline=Date.now()+3500;
      while(Date.now()<deadline){
        const after=await this._offerCardState(page,p).catch(()=>null);
        if(after && after.signature!==before.signature && after.offerCount===index+1){
          changed=after.signature;
          break;
        }
        await sleep(100);
      }
      if(!changed)throw new Error(`Trade selection did not change the player card: ${p.name||'Unknown player'}`);
      proof.set(identityOf(p),changed);
    }
  }
  async _verifyOffer(page,own){
    const proof=this.offerProofs?.get(page);
    if(!proof || proof.size!==own.length || own.some(p=>!proof.has(identityOf(p))))
      throw new Error('Trade offer does not match the verified selection clicks.');
    if(!own.length){
      const summary=await page.evaluate(readOwnTradeOfferCount);
      if(!summary || summary.count!==0)
        throw new Error('The Trade offer contains an unexpected player before agreement.');
    }
    for(const p of own){
      const current=await this._offerCardState(page,p);
      if(!current || current.signature!==proof.get(identityOf(p)) || current.offerCount!==own.length)
        throw new Error(`Trade offer selection changed before agreement: ${p.name||p.imagePath}`);
    }
    // Presence on the roster alone is never used as proof of a selected offer.
    return true;
  }
  async _agree(page,account){
    const team=this.runtime.homeSnapshots?.[account.id]?.teamName||this._profile(account.id)?.teamName;
    if(!team)throw new Error(`Cannot identify the Trade agreement button for ${account.name}.`);
    const button=page.getByRole('button',{name:new RegExp(`^${escapeRegExp(team)}\\s+agrees to trade$`,'i')}).first();
    if(!(await button.isVisible().catch(()=>false))||!(await button.isEnabled().catch(()=>false)))
      throw new Error(`Own Trade agreement button is not available for ${team}.`);
    await button.click();
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      const cls=await button.getAttribute('class').catch(()=>'');
      const pressed=await button.getAttribute('aria-pressed').catch(()=>'');
      if(/green/i.test(cls||'')||pressed==='true')return;
      await sleep(100);
    }
    throw new Error(`${team} agreement was not confirmed.`);
  }
  async _waitTradeConfirmReady(page,sideId,mainId){
    const sideTeam=this.runtime.homeSnapshots?.[sideId]?.teamName||this._profile(sideId)?.teamName;
    const mainTeam=this.runtime.homeSnapshots?.[mainId]?.teamName||this._profile(mainId)?.teamName;
    if(!sideTeam||!mainTeam)throw new Error('Trade participants are missing before confirmation.');
    const agreements=page.getByRole('button',{name:/agrees to trade/i});
    const labels=(await agreements.allTextContents()).map(clean);
    if(labels.length!==2 || labels[0].toLowerCase()!==`${sideTeam} agrees to trade`.toLowerCase() ||
       labels[1].toLowerCase()!==`${mainTeam} agrees to trade`.toLowerCase())
      throw new Error('Trade agreement order does not match Side (top) and Main (bottom).');
    const confirm=page.getByRole('button',{name:/^Confirm Trade$/i}).first();
    const until=Date.now()+30000;
    do{
      const classes=await Promise.all([agreements.nth(0).getAttribute('class'),agreements.nth(1).getAttribute('class')]);
      if(classes.every(value=>/green/i.test(value||'')) && await confirm.isEnabled().catch(()=>false))return confirm;
      await sleep(150);
    }while(Date.now()<until);
    throw new Error('Both Trade agreements and the Side Confirm Trade button did not become active.');
  }
  async _waitHomeAfterTrade(accountId,page){
    const end=Date.now()+120000;
    let stable=0;
    while(Date.now()<end){
      const tradeVisible=await page.getByText('Trade Desk',{exact:true}).first().isVisible().catch(()=>false);
      const homeVisible=await page.locator(HOME_AGENT).first().isVisible().catch(()=>false);
      stable=homeVisible&&!tradeVisible?stable+1:0;
      if(stable>=2){await this.accountProfile.captureStadium(accountId,page).catch(()=>{});return true;}
      await sleep(250);
    }
    throw new Error(`Trade was confirmed but ${this._account(accountId)?.name||accountId} did not return Home in time.`);
  }

  _ledger(type,data){const id=`${type}:${data.accountId||data.from||''}:${data.to||''}:${identityOf(data.player)}`;if(this.runtime.ledger.some(e=>e.id===id))return;this.runtime.ledger.push({id,type,at:new Date().toISOString(),...data,player:{name:data.player?.name||'',imagePath:data.player?.imagePath||'',price:data.player?.price??null}});this._recomputeResults();this._save();}
  _recomputeResults(){if(!this.runtime)return;for(const row of this.runtime.results||[]){const id=row.accountId;const snap=this.runtime.homeSnapshots?.[id];if(snap?.tk!=null){row.currentTk=snap.tk;if(row.startTk!=null)row.tkDelta=snap.tk-row.startTk;}row.cardsMade=this.runtime.ledger.filter(e=>e.type==='make-card'&&e.accountId===id).length;const finalSet=new Set((snap?.players||[]).map(identityOf));if(row.isMain){const made=row.cardsMade;const retainedScout=this.runtime.ledger.filter(e=>e.type==='scout-acquire'&&e.accountId===id&&finalSet.has(identityOf(e.player))).length;row.gainedPlayers=made+retainedScout;}else{const inbound=this.runtime.ledger.filter(e=>e.type==='trade-transfer'&&e.to===id).length;const retainedScout=this.runtime.ledger.filter(e=>e.type==='scout-acquire'&&e.accountId===id&&finalSet.has(identityOf(e.player))).length;row.gainedPlayers=inbound+retainedScout;}}}
  _setRowStatus(id,status){const r=this._resultRow(id);if(r)r.status=status;}
}

module.exports = { AutoTradeService, readMakeBenchTiles, selectMakeBenchTile,
  matchMakeConfirmation, readStadiumStartingFive, readOwnTradePlayers };
