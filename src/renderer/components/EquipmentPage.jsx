import { useEffect, useMemo, useRef, useState } from 'react';

const api = window.dreamteam;
// Orders as the game shows them: rarity low → high in Craft / Convert / materials,
// high → low in bag filters; Craft's type tabs and the bag / collection slots differ.
const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];
const RARITIES_DESC = [...RARITIES].reverse();
const TYPES = ['JERSEY', 'PANTS', 'SLEEVES', 'HEADBAND', 'SHOES'];          // Craft tabs
const SLOT_ORDER = ['HEADBAND', 'JERSEY', 'SLEEVES', 'PANTS', 'SHOES'];     // bag & collections
const CRAFT_TYPES = [...TYPES, 'MATERIAL', 'USABLE'];
const ENCHANTABLE = new Set(['EPIC', 'LEGENDARY', 'MYTHIC']);
const rank = r => RARITIES.indexOf(r);
// Bag order: equipped first (by roster, then slot), then rarity high → low, then + high → low.
const bagOrder = (a, b) => (b.equipped - a.equipped)
  || (a.equipped ? (a.playerIndex - b.playerIndex) || SLOT_ORDER.indexOf(a.type) - SLOT_ORDER.indexOf(b.type) : 0)
  || rank(b.rarity) - rank(a.rarity) || b.level - a.level;
// Material recipes in a rarity: Fabric, then Refine Stone, then the rest.
const materialOrder = r => /Fabric$/.test(r.name) ? 0 : /Refine Stone$/.test(r.name) ? 1 : 2;
const rarityName = r => r ? r.charAt(0) + r.slice(1).toLowerCase() : '';
const typeName = r => r ? r.charAt(0) + r.slice(1).toLowerCase() : '';
const num = v => v == null ? '—' : Number(v).toLocaleString();
// Game rarity colours: Common white, Uncommon green, Rare blue, Epic purple, Legendary yellow, Mythic red.
const RARITY_EMOJI = { COMMON: '⚪', UNCOMMON: '🟢', RARE: '🔵', EPIC: '🟣', LEGENDARY: '🟡', MYTHIC: '🔴' };
function Dot({ rarity }) { return rarity ? <i className={`eq-dot d-${rarity.toLowerCase()}`} title={rarityName(rarity)} /> : null; }

const TEXT = {
  tr: {
    title: 'Ekipman', subtitle: 'Çanta, materyaller, güçlendirme ve koleksiyonlar',
    pickAccount: 'Hesap seç', scan: 'Tara', close: 'Kapat', stop: 'Durdur', noAccount: 'Başlamak için sağ üstten bir hesap seç.',
    tabGear: 'Ekipmanlar', tabMaterials: 'Materyaller', tabConvert: 'Convert', tabCraft: 'Craft', tabEnchant: 'Enchant', tabEnhance: 'Enhance', tabRefine: 'Refine', tabCollections: 'Koleksiyonlar',
    name: 'Ad', rarity: 'Nadirlik', type: 'Tür', level: '+', refine: 'Refine', enchant: 'Enchant', equippedBy: 'Kuşanan', inBag: 'Çantada', all: 'Hepsi', equipped: 'Kuşanılı', notEquipped: 'Kuşanılmamış',
    fabric: 'Fabric', stone: 'Refine Stone', ore: 'Refine Ore', scroll: 'Scroll of Enhancement', other: 'Diğer materyaller',
    convertHint: '5 Fabric → 1 Refine Stone (aynı nadirlik)', conversions: 'Dönüşüm adedi', willUse: '{fabric} Fabric harcanır, {stone} Refine Stone gelir', convert: 'Dönüştür', max: 'En fazla',
    craftGear: 'Ekipman üret', craftMaterial: 'Materyal yükselt', count: 'Adet', craft: 'Üret', needs: 'Gerekenler', have: 'var', exclusive: 'Oyuncuya özel',
    pickItem: 'Ekipman seç', current: 'Şu an', successRate: 'Başarı', oneTry: '1 kez bas', untilLevel: '+{level} olana kadar bas', target: 'Hedef',
    enchantHint: 'Sadece Epic, Legendary ve Mythic ekipman. Her deneme 1 Scroll of Enhancement harcar; değerler rastgele değişir.', noRecipes: 'Bu tür ve nadirlikte tarif yok.', doEnchant: 'Enchant', lastEnchant: 'Son sonuç: %{pct} · ATK {off} · DEF {def}',
    enhanceHint: 'Her deneme ekipmanın nadirliğindeki Refine Stone\'u harcar. Başarısız deneme seviyeyi düşürmez.', eventRewards: 'Etkinlik ödülü alınan basma: {count}',
    refineHint: 'Refine Ore harcar. Yüksek seviyelerde başarısız olursa seviye düşebilir.', nextRefine: 'Sonraki: Refine {level} · başarı %{rate} · {cost} Ore · düşme şansı %{down}', doRefine: 'Refine',
    setsDone: 'Tamamlanan', setsOpen: 'Devam eden', setsReady: 'Teslime hazır', search: 'Ara', bonus: 'Bonus', status: 'Durum', register: 'Teslim et', prepare: 'Hazırla',
    complete: 'Tamamlandı', ready: '{count} parça teslime hazır', open: '{done}/{total} teslim edildi',
    pieceHint: 'Tıkla: sadece bu parçayı hazırla ve teslim et', planTitle: '{name} hazırlanacak', planCraft: 'Üretilecek', planEnhance: 'Basılacak', planMaterials: 'Harcanacak materyal', planShort: 'Yetersiz', planMissing: 'Tarifi yok', planRun: 'Başlat', planNothing: 'Üretim veya basma gerekmiyor, doğrudan teslim edilecek.', cancel: 'Vazgeç',
    planWarn: 'Teslim edilen ekipmanlar çantadan silinir. Kuşanılmış ekipmanlar kullanılmaz.',
    scannedAt: 'Son tarama {time}', jobs: { scan: 'Taranıyor', convert: 'Dönüştürülüyor', craft: 'Üretiliyor', enchant: 'Enchant', enhance: 'Basılıyor', refine: 'Refine', register: 'Teslim ediliyor', prepare: 'Set hazırlanıyor' }
  },
  en: {
    title: 'Equipment', subtitle: 'Bag, materials, strengthening and collections',
    pickAccount: 'Select account', scan: 'Scan', close: 'Close', stop: 'Stop', noAccount: 'Pick an account at the top right to start.',
    tabGear: 'Equipment', tabMaterials: 'Materials', tabConvert: 'Convert', tabCraft: 'Craft', tabEnchant: 'Enchant', tabEnhance: 'Enhance', tabRefine: 'Refine', tabCollections: 'Collections',
    name: 'Name', rarity: 'Rarity', type: 'Type', level: '+', refine: 'Refine', enchant: 'Enchant', equippedBy: 'Equipped by', inBag: 'In bag', all: 'All', equipped: 'Equipped', notEquipped: 'Not equipped',
    fabric: 'Fabric', stone: 'Refine Stone', ore: 'Refine Ore', scroll: 'Scroll of Enhancement', other: 'Other materials',
    convertHint: '5 Fabric → 1 Refine Stone (same rarity)', conversions: 'Conversions', willUse: 'Uses {fabric} Fabric, gives {stone} Refine Stone', convert: 'Convert', max: 'Max',
    craftGear: 'Craft equipment', craftMaterial: 'Upgrade materials', count: 'Count', craft: 'Craft', needs: 'Needs', have: 'owned', exclusive: 'Player exclusive',
    pickItem: 'Select equipment', current: 'Now', successRate: 'Success', oneTry: 'Enhance once', untilLevel: 'Enhance until +{level}', target: 'Target',
    enchantHint: 'Epic, Legendary and Mythic gear only. Each try uses 1 Scroll of Enhancement; the values change randomly.', noRecipes: 'No recipes for this type and rarity.', doEnchant: 'Enchant', lastEnchant: 'Last result: {pct}% · ATK {off} · DEF {def}',
    enhanceHint: 'Each try uses a Refine Stone of the item\'s rarity. A failed try keeps the level.', eventRewards: 'Tries with an event reward: {count}',
    refineHint: 'Uses Refine Ore. At high levels a failure can lower the level.', nextRefine: 'Next: Refine {level} · {rate}% success · {cost} Ore · {down}% downgrade', doRefine: 'Refine',
    setsDone: 'Completed', setsOpen: 'In progress', setsReady: 'Ready to register', search: 'Search', bonus: 'Bonus', status: 'Status', register: 'Register', prepare: 'Prepare',
    complete: 'Completed', ready: '{count} piece(s) ready', open: '{done}/{total} registered',
    pieceHint: 'Click: prepare and register only this piece', planTitle: 'Prepare {name}', planCraft: 'Craft', planEnhance: 'Enhance', planMaterials: 'Materials used', planShort: 'Not enough', planMissing: 'No recipe', planRun: 'Start', planNothing: 'Nothing to craft or enhance; it will be registered directly.', cancel: 'Cancel',
    planWarn: 'Registered equipment leaves the bag. Equipped gear is never used.',
    scannedAt: 'Last scan {time}', jobs: { scan: 'Scanning', convert: 'Converting', craft: 'Crafting', enchant: 'Enchanting', enhance: 'Enhancing', refine: 'Refining', register: 'Registering', prepare: 'Preparing set' }
  }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

// Account picker: opens on click, closes on an outside click or a selection.
function AccountMenu({ accounts, value, onPick, label, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const current = accounts.find(a => a.id === value);
  return <div className="eq-menu" ref={ref}>
    <button className="btn ghost eq-menu-button" disabled={disabled} onClick={() => setOpen(o => !o)}>{current?.name || label} <span className="eq-caret">▾</span></button>
    {open && <div className="eq-menu-list">{accounts.map(a => <button key={a.id} className={a.id === value ? 'active' : ''} onClick={() => { setOpen(false); onPick(a.id); }}>{a.name}</button>)}</div>}
  </div>;
}

function ItemSelect({ gear, value, onChange, x }) {
  const groups = useMemo(() => {
    const sorted = [...gear].sort(bagOrder);
    const out = [];
    for (const g of sorted) {
      const label = g.equippedBy || x.inBag;
      if (out.at(-1)?.label !== label) out.push({ label, items: [] });
      out.at(-1).items.push(g);
    }
    return out;
  }, [gear, x.inBag]);
  const text = g => `${RARITY_EMOJI[g.rarity] || ''} ${g.name} +${g.level} · R${g.refine}${g.hasEnchant ? ` · E%${g.enchantPct}` : ''}`;
  return <select className="eq-item-select" value={value || ''} onChange={e => onChange(e.target.value || null)}>
    <option value="">{x.pickItem}</option>
    {groups.map(grp => <optgroup key={grp.label} label={grp.label}>{grp.items.map(g => <option key={g.id} value={g.id}>{text(g)}</option>)}</optgroup>)}
  </select>;
}

const enchantText = g => g.hasEnchant ? `%${g.enchantPct}${g.enchantOffense ? ` · ATK ${g.enchantOffense}` : ''}${g.enchantDefense ? ` · DEF ${g.enchantDefense}` : ''}` : '—';

export default function EquipmentPage({ state, t, toast, msgText }) {
  const x = TEXT[t.lang] || TEXT.en;
  const eq = state.equipment || {};
  const gear = eq.gear || [];
  const m = eq.materials;
  const busy = Boolean(eq.job);
  const [tab, setTab] = useState('gear');
  const [recipes, setRecipes] = useState([]);
  const [selected, setSelected] = useState(null);
  const run = async fn => { try { return await fn(); } catch (e) { toast(e.message, 'error'); } };

  useEffect(() => { if (eq.hasRecipes && !recipes.length) api.equipment.recipes().then(setRecipes).catch(() => {}); }, [eq.hasRecipes]);
  useEffect(() => { if (selected && !gear.some(g => g.id === selected)) setSelected(null); }, [gear, selected]);

  const pick = id => run(() => api.equipment.open(id));
  const statusText = eq.job ? `${x.jobs[eq.job] || eq.job}${eq.step ? ` · ${msgText(t, `eqstep.${eq.step}`, eq.stepParams || {}, '')}` : ''}` : eq.error ? eq.error : eq.scannedAt ? fill(x.scannedAt, { time: new Date(eq.scannedAt).toLocaleTimeString() }) : '';

  const tabs = [['gear', x.tabGear], ['materials', x.tabMaterials], ['convert', x.tabConvert], ['craft', x.tabCraft], ['enchant', x.tabEnchant], ['enhance', x.tabEnhance], ['refine', x.tabRefine], ['collections', x.tabCollections]];
  return <div className="page equipment-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar">
        <AccountMenu accounts={state.accounts} value={eq.accountId} onPick={pick} label={x.pickAccount} disabled={busy} />
        <button className="btn primary" disabled={!eq.accountId || busy} onClick={() => run(() => api.equipment.scan())}>{x.scan}</button>
        {busy && <button className="btn danger-soft" onClick={() => run(() => api.equipment.stop())}>{x.stop}</button>}
        <button className="btn ghost" disabled={!eq.accountId} onClick={() => run(() => api.equipment.close())}>{x.close}</button>
      </div>
    </div>
    {!eq.accountId ? <div className="panel empty-state">{x.noAccount}</div> : <>
      {statusText && <div className="trade-status"><span className={`pill ${busy ? 'warn' : eq.error ? 'bad' : 'ok'}`}><i />{statusText}</span></div>}
      <div className="market-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
      {!m ? null : <>
        {tab === 'gear' && <GearTab gear={gear} x={x} onSelect={id => { setSelected(id); }} selected={selected} />}
        {tab === 'materials' && <MaterialsTab m={m} x={x} />}
        {tab === 'convert' && <ConvertTab m={m} x={x} busy={busy} run={run} />}
        {tab === 'craft' && <CraftTab recipes={recipes} m={m} gear={gear} x={x} busy={busy} run={run} />}
        {tab === 'enchant' && <EnchantTab gear={gear} m={m} x={x} busy={busy} run={run} selected={selected} setSelected={setSelected} last={eq.lastResult} />}
        {tab === 'enhance' && <EnhanceTab gear={gear} m={m} x={x} busy={busy} run={run} selected={selected} setSelected={setSelected} eventRewards={eq.eventRewards} />}
        {tab === 'refine' && <RefineTab gear={gear} m={m} x={x} busy={busy} run={run} selected={selected} setSelected={setSelected} />}
        {tab === 'collections' && <CollectionsTab sets={eq.collections || []} x={x} busy={busy} run={run} />}
      </>}
    </>}
  </div>;
}

function GearTab({ gear, x, onSelect, selected }) {
  const [f, setF] = useState({ type: '', rarity: '', equipped: '' });
  const rows = gear.filter(g => (!f.type || g.type === f.type) && (!f.rarity || g.rarity === f.rarity) && (!f.equipped || (f.equipped === 'yes') === g.equipped))
    .sort(bagOrder);
  return <>
    <div className="eq-filters">
      <select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="">{x.type}: {x.all}</option>{SLOT_ORDER.map(v => <option key={v} value={v}>{typeName(v)}</option>)}</select>
      <select value={f.rarity} onChange={e => setF({ ...f, rarity: e.target.value })}><option value="">{x.rarity}: {x.all}</option>{RARITIES_DESC.map(v => <option key={v} value={v}>{RARITY_EMOJI[v]} {rarityName(v)}</option>)}</select>
      <select value={f.equipped} onChange={e => setF({ ...f, equipped: e.target.value })}><option value="">{x.all}</option><option value="yes">{x.equipped}</option><option value="no">{x.notEquipped}</option></select>
      <span className="eq-count">{rows.length} / {gear.length}</span>
    </div>
    <div className="panel table-panel"><table><thead><tr><th>{x.name}</th><th>{x.rarity}</th><th>{x.type}</th><th>{x.level}</th><th>{x.refine}</th><th>{x.enchant}</th><th>{x.equippedBy}</th></tr></thead>
      <tbody>{rows.map(g => <tr key={g.id} className={selected === g.id ? 'selected-row-soft' : ''} onClick={() => onSelect(g.id)}>
        <td><span className="eq-name"><Dot rarity={g.rarity} /><b>{g.name}</b></span></td><td><span className={`eq-rarity r-${g.rarity.toLowerCase()}`}>{rarityName(g.rarity)}</span></td><td>{typeName(g.type)}</td>
        <td><b>+{g.level}</b></td><td>{g.refine}</td><td>{enchantText(g)}</td><td>{g.equippedBy ? <span className="pill ok"><i />{g.equippedBy}</span> : <span className="muted-text">{x.inBag}</span>}</td>
      </tr>)}</tbody></table></div>
  </>;
}

function MaterialsTab({ m, x }) {
  return <>
    <div className="eq-cards"><div className="eq-card"><span>{x.ore}</span><b>{num(m.ore)}</b></div><div className="eq-card"><span>{x.scroll}</span><b>{num(m.scroll)}</b></div></div>
    <div className="panel table-panel"><table><thead><tr><th>{x.rarity}</th><th>{x.fabric}</th><th>{x.stone}</th></tr></thead>
      <tbody>{RARITIES.map(r => <tr key={r}><td><span className="eq-name"><Dot rarity={r} /><span className={`eq-rarity r-${r.toLowerCase()}`}>{rarityName(r)}</span></span></td><td>{num(m.fabric[r] || 0)}</td><td>{num(m.stone[r] || 0)}</td></tr>)}</tbody></table></div>
    {m.other?.length > 0 && <><h3 className="section-title">{x.other}</h3><div className="panel table-panel"><table><tbody>{m.other.map(o => <tr key={o.name}><td>{o.name}</td><td>{num(o.quantity)}</td></tr>)}</tbody></table></div></>}
  </>;
}

function ConvertTab({ m, x, busy, run }) {
  const [rarity, setRarity] = useState('COMMON');
  const [n, setN] = useState(1);
  const max = Math.floor((m.fabric[rarity] || 0) / 5);
  const count = Math.max(1, Math.min(max, Math.floor(Number(n) || 1)));
  return <div className="panel eq-form">
    <p className="eq-hint">{x.convertHint}</p>
    <div className="eq-row">
      <label><span>{x.rarity}</span><select value={rarity} onChange={e => setRarity(e.target.value)}>{RARITIES.map(r => <option key={r} value={r}>{RARITY_EMOJI[r]} {rarityName(r)} · {num(m.fabric[r] || 0)} {x.fabric}</option>)}</select></label>
      <label><span>{x.conversions}</span><input type="number" min="1" max={max} value={n} onChange={e => setN(e.target.value)} /></label>
      <button className="btn ghost" onClick={() => setN(max)} disabled={!max}>{x.max} ({max})</button>
      <button className="btn primary" disabled={busy || !max} onClick={() => run(() => window.dreamteam.equipment.convert(rarity, count))}>{x.convert}</button>
    </div>
    <p className="eq-hint">{fill(x.willUse, { fabric: count * 5, stone: count })} · {x.stone}: {num(m.stone[rarity] || 0)}</p>
  </div>;
}

const haveOf = (ing, m, gear) => {
  const mm = ing.name?.match(/^(\w+) (Fabric|Refine Stone)$/);
  if (mm && RARITIES.includes(mm[1].toUpperCase())) return (mm[2] === 'Fabric' ? m.fabric : m.stone)[mm[1].toUpperCase()] || 0;
  if (TYPES.includes(ing.type)) return gear.filter(g => g.itemId === ing.itemId && !g.equipped && g.level >= ing.level).length;
  return m.other?.find(o => o.name === ing.name)?.quantity || 0;
};

function Ingredients({ recipe, count, m, gear, x }) {
  return <div className="eq-ingredients">{x.needs}: {recipe.ingredients.map(i => {
    const need = i.quantity * count; const have = haveOf(i, m, gear);
    return <span key={i.itemId} className={have >= need ? 'ok' : 'bad'}><Dot rarity={i.rarity} />{need} × {i.name}{i.level ? ` +${i.level}` : ''} ({num(have)} {x.have})</span>;
  })}</div>;
}

function CraftTab({ recipes, m, gear, x, busy, run }) {
  const [type, setType] = useState('JERSEY');
  const [rarity, setRarity] = useState('COMMON');
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState({});
  const list = recipes.filter(r => r.type === type && r.rarity === rarity && (!search || r.name.toLowerCase().includes(search.toLowerCase())));
  if (type === 'MATERIAL') list.sort((a, b) => materialOrder(a) - materialOrder(b));
  const all = recipes.filter(r => r.type === type && r.rarity === rarity).length;
  return <>
    <div className="panel eq-form">
      <div className="eq-tabrow"><span>{x.type}</span>{CRAFT_TYPES.map(v => <button key={v} className={type === v ? 'active' : ''} onClick={() => { setType(v); setSearch(''); }}>{typeName(v)}</button>)}</div>
      <div className="eq-tabrow"><span>{x.rarity}</span>{RARITIES.map(v => <button key={v} className={`${rarity === v ? 'active' : ''} t-${v.toLowerCase()}`} onClick={() => { setRarity(v); setSearch(''); }}><Dot rarity={v} />{rarityName(v)}</button>)}</div>
      {all > 8 && <div className="eq-row"><label><span>{x.search}</span><input value={search} onChange={e => setSearch(e.target.value)} /></label><span className="eq-count">{list.length} / {all}</span></div>}
    </div>
    <div className="panel table-panel"><table><tbody>
      {!list.length && <tr><td className="muted-text">{x.noRecipes}</td></tr>}
      {list.map(r => {
        const c = Math.max(1, Math.floor(Number(counts[r.id]) || 1));
        const max = Math.min(500, ...r.ingredients.map(i => Math.floor(haveOf(i, m, gear) / i.quantity)));
        return <tr key={r.id}>
          <td><span className="eq-name"><Dot rarity={r.rarity} /><b>{r.name}</b></span>{r.exclusive && <span className="muted-text"> · {x.exclusive}</span>}</td>
          <td><Ingredients recipe={r} count={c} m={m} gear={gear} x={x} /></td>
          <td className="actions"><input className="eq-small" type="number" min="1" value={counts[r.id] ?? 1} onChange={e => setCounts({ ...counts, [r.id]: e.target.value })} /> <button className="btn ghost" disabled={max < 1} onClick={() => setCounts({ ...counts, [r.id]: Math.max(1, max) })}>{x.max}</button> <button className="btn primary" disabled={busy || c > max} onClick={() => run(() => window.dreamteam.equipment.craft(r.id, c))}>{x.craft}</button></td>
        </tr>;
      })}
    </tbody></table></div>
  </>;
}

function EnchantTab({ gear, m, x, busy, run, selected, setSelected, last }) {
  const g = gear.find(i => i.id === selected);
  return <div className="panel eq-form">
    <p className="eq-hint">{x.enchantHint} · {x.scroll}: <b>{num(m.scroll)}</b></p>
    <div className="eq-row"><ItemSelect gear={gear.filter(i => ENCHANTABLE.has(i.rarity))} value={selected} onChange={setSelected} x={x} />
      <button className="btn primary" disabled={busy || !g || !ENCHANTABLE.has(g.rarity) || !m.scroll} onClick={() => run(() => window.dreamteam.equipment.enchant(g.id))}>{x.doEnchant}</button></div>
    {g && <p>{x.current}: <b>{enchantText(g)}</b></p>}
    {last?.kind === 'enchant' && last.id === selected && <p className="eq-hint">{fill(x.lastEnchant, { pct: last.pct ?? 0, off: last.off ?? 0, def: last.def ?? 0 })}</p>}
  </div>;
}

function EnhanceTab({ gear, m, x, busy, run, selected, setSelected, eventRewards }) {
  const g = gear.find(i => i.id === selected);
  const [rate, setRate] = useState(null);
  const [target, setTarget] = useState('');
  useEffect(() => { setRate(null); if (g) window.dreamteam.equipment.enhanceRate(g.id).then(r => setRate(r.successRate)).catch(() => {}); }, [g?.id, g?.level]);
  const goal = Math.max((g?.level || 0) + 1, Number(target) || 0);
  return <div className="panel eq-form">
    <p className="eq-hint">{x.enhanceHint}{eventRewards ? ` · ${fill(x.eventRewards, { count: eventRewards })}` : ''}</p>
    <div className="eq-row"><ItemSelect gear={gear} value={selected} onChange={setSelected} x={x} /></div>
    {g && <>
      <p>{x.current}: <b>+{g.level}</b> · {x.successRate}: <b>{rate == null ? '…' : `%${rate}`}</b> · {rarityName(g.rarity)} {x.stone}: <b>{num(m.stone[g.rarity] || 0)}</b></p>
      <div className="eq-row">
        <button className="btn primary" disabled={busy || rate === 0} onClick={() => run(() => window.dreamteam.equipment.enhance(g.id, null))}>{x.oneTry}</button>
        <label><span>{x.target}</span><input type="number" min={g.level + 1} max="12" value={target} placeholder={`+${g.level + 1}`} onChange={e => setTarget(e.target.value)} /></label>
        <button className="btn success" disabled={busy || rate === 0} onClick={() => run(() => window.dreamteam.equipment.enhance(g.id, goal))}>{fill(x.untilLevel, { level: goal })}</button>
      </div>
    </>}
  </div>;
}

function RefineTab({ gear, m, x, busy, run, selected, setSelected }) {
  const g = gear.find(i => i.id === selected);
  const [details, setDetails] = useState(null);
  useEffect(() => { setDetails(null); if (g) window.dreamteam.equipment.refineDetails(g.id).then(setDetails).catch(() => {}); }, [g?.id, g?.refine]);
  const next = details?.next;
  return <div className="panel eq-form">
    <p className="eq-hint">{x.refineHint} · {x.ore}: <b>{num(m.ore)}</b></p>
    <div className="eq-row"><ItemSelect gear={gear} value={selected} onChange={setSelected} x={x} />
      <button className="btn primary" disabled={busy || !g || !next || details?.isMaxLevel || m.ore < (next?.stoneCost || 1)} onClick={() => run(() => window.dreamteam.equipment.refine(g.id))}>{x.doRefine}</button></div>
    {g && <p>{x.current}: <b>Refine {g.refine}</b>{next ? ` · ${fill(x.nextRefine, { level: next.level, rate: next.successRate, cost: next.stoneCost, down: next.downgradeChance })}` : ''}</p>}
  </div>;
}

function CollectionsTab({ sets, x, busy, run }) {
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState(null);
  const rows = sets.filter(s => (!search || s.name.toLowerCase().includes(search.toLowerCase()) || s.items.some(i => i.name.toLowerCase().includes(search.toLowerCase())))
    && (!filter || (filter === 'done' ? s.completed : filter === 'ready' ? !s.completed && s.available.length > 0 : !s.completed)));
  const bonusText = b => Object.entries(b).filter(([, v]) => v).map(([k, v]) => `+${v}% ${k.toUpperCase()}`).join(' · ');
  const openPlan = (id, slot = null) => run(async () => setPlan({ id, ...(await window.dreamteam.equipment.plan(id, slot)) }));
  return <>
    <div className="eq-filters">
      <select value={filter} onChange={e => setFilter(e.target.value)}><option value="">{x.all} ({sets.length})</option><option value="open">{x.setsOpen}</option><option value="done">{x.setsDone} ({sets.filter(s => s.completed).length})</option><option value="ready">{x.setsReady}</option></select>
      <input placeholder={x.search} value={search} onChange={e => setSearch(e.target.value)} />
      <span className="eq-count">{rows.length}</span>
    </div>
    <div className="panel table-panel"><table><thead><tr><th>{x.name}</th><th>{x.bonus}</th><th>{x.tabGear}</th><th>{x.status}</th><th></th></tr></thead>
      <tbody>{rows.map(s => <tr key={s.id}>
        <td><b>{s.name}</b></td><td className="eq-bonus">{bonusText(s.bonus)}</td>
        <td><div className="eq-set-items">{[...s.items].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)).map(i => { const done = s.registered.includes(i.slot); return <button type="button" key={i.slot} disabled={done || busy} title={done ? '' : x.pieceHint} onClick={() => openPlan(s.id, i.slot)} className={`eq-chip ${done ? 'done' : s.available.includes(i.slot) ? 'ready' : ''}`}><Dot rarity={i.rarity} />{i.name}{i.minLevel ? ` +${i.minLevel}` : ''}</button>; })}</div></td>
        <td>{s.completed ? <span className="pill ok"><i />{x.complete}</span> : s.available.length ? <span className="pill warn"><i />{fill(x.ready, { count: s.available.length })}</span> : <span className="pill muted"><i />{fill(x.open, { done: s.registered.length, total: s.items.length })}</span>}</td>
        <td className="actions">{!s.completed && <>{s.available.length > 0 && <button className="btn ghost" disabled={busy} onClick={() => run(() => window.dreamteam.equipment.register(s.id))}>{x.register}</button>}<button className="btn primary" disabled={busy} onClick={() => openPlan(s.id)}>{x.prepare}</button></>}</td>
      </tr>)}</tbody></table></div>
    {plan && <PlanModal plan={plan} x={x} onClose={() => setPlan(null)} onRun={() => { const { id, slot } = plan; setPlan(null); run(() => window.dreamteam.equipment.prepare(id, slot)); }} />}
  </>;
}

function PlanModal({ plan, x, onClose, onRun }) {
  const crafts = plan.steps.filter(s => s.kind === 'craft');
  const enhances = plan.steps.filter(s => s.kind === 'enhance');
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal" style={{ maxWidth: 560 }}>
      <div className="modal-head"><b>{fill(x.planTitle, { name: plan.set })}</b><button className="icon-btn" onClick={onClose}>×</button></div>
      <div className="eq-plan">
        <p className="eq-hint">{x.planWarn}</p>
        {!crafts.length && !enhances.length && <p>{x.planNothing}</p>}
        {crafts.length > 0 && <p><b>{x.planCraft}:</b> {crafts.map(s => s.name).join(', ')}</p>}
        {enhances.length > 0 && <p><b>{x.planEnhance}:</b> {enhances.map(s => `${s.name} +${s.from} → +${s.to}`).join(', ')}</p>}
        {Object.keys(plan.materials).length > 0 && <p><b>{x.planMaterials}:</b> {Object.entries(plan.materials).map(([n, q]) => `${q} × ${n}`).join(', ')}</p>}
        {plan.short.length > 0 && <p className="eq-bad"><b>{x.planShort}:</b> {plan.short.map(s => `${s.name} ${s.have}/${s.need}`).join(', ')}</p>}
        {plan.missing.length > 0 && <p className="eq-bad"><b>{x.planMissing}:</b> {plan.missing.map(s => s.name).join(', ')}</p>}
      </div>
      <div className="modal-actions"><button className="btn ghost" onClick={onClose}>{x.cancel}</button><button className="btn primary" disabled={!plan.ok} onClick={onRun}>{x.planRun}</button></div>
    </div>
  </div>;
}
