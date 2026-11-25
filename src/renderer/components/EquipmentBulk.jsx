import useDismiss from './useDismiss';
import { useEffect, useMemo, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import { GroupedPicks, useGroupedRows, groupRowOf, asAccounts } from './AccountGroups';

// Equipment page additions (user 2026-11-13): materials upgraded on many accounts at once,
// several pieces strengthened in a row, gear put on / taken off roster players, and one skill
// plan put on many accounts at once.
const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];
const SLOTS = ['HEADBAND', 'JERSEY', 'SLEEVES', 'PANTS', 'SHOES'];
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const cap = s => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');
const RARITY_EMOJI = { COMMON: '⚪', UNCOMMON: '🟢', RARE: '🔵', EPIC: '🟣', LEGENDARY: '🟡', MYTHIC: '🔴' };
const TIER_EMOJI = { PRIMARY: '🔵', INTERMEDIATE: '🟣', SUPERIOR: '🔴' };
export const levelOf = (state, id) => Number(state.accountProfile?.accounts?.[id]?.level) || null;

const TEXT = {
  tr: {
    accounts: 'Hesaplar ({n})', all: 'Tümünü seç', none: 'Seçimi temizle', stop: 'Durdur',
    matTitle: 'Toplu materyal yükseltme', matHint: 'Seçili hesapların hepsinde aynı anda: her adımda yapılabilen en fazla sayıda üretilir (tek seferde en fazla 100, aralarda oyunun bekleme süresi). Uncommon\'daki tarif Common\'ı Uncommon yapar, Rare\'deki Uncommon\'ı Rare yapar.',
    from: 'Başlangıç', to: 'Hedef', kinds: 'Materyal', matRun: '{from} → {to} yükselt ({n} hesap)', matRes: { upgraded: 'yükseltildi', nothing: 'yükseltilecek yok', error: 'hata', stopped: 'durduruldu', skipped: 'atlandı' },
    progress: '{done}/{total} · {account}', result: 'Sonuç',
    manyTitle: { enhance: 'Toplu basma', refine: 'Toplu refine', enchant: 'Toplu enchant' },
    manyHint: { enhance: 'İşaretli ekipmanlar sırayla hedef + seviyeye kadar basılır (oyunun bekleme süresine uyulur). Bir ekipmanın taşı biterse iş orada durur.', refine: 'İşaretli ekipmanlar sırayla hedef refine seviyesine kadar refine edilir. Yüksek seviyelerde başarısız deneme seviyeyi düşürebilir; Ore biterse iş durur.', enchant: 'İşaretli ekipmanlar sırayla, enchant yüzdesi hedefe ulaşana ya da ekipman başına scroll sınırı dolana kadar enchant edilir (değerler rastgele).' },
    target: { enhance: 'Hedef +', refine: 'Hedef refine', enchant: 'Hedef %' }, maxTries: 'Ekipman başına en fazla scroll', manyRun: 'Seçilileri yap ({n})',
    manyRes: { ok: 'tamam', already: 'zaten hedefte', noStone: 'taş bitti', noOre: 'Ore bitti', noScroll: 'scroll bitti', notReached: 'hedefe ulaşmadı', notEnchantable: 'enchant edilemez', max: 'en üst seviye', missing: 'bulunamadı', error: 'hata' },
    name: 'Ad', level: '+', refine: 'Refine', enchant: 'Enchant', equippedBy: 'Kuşanan', inBag: 'Çantada', selectAll: 'Tümünü seç',
    rosterTitle: 'Kadro · ekipman tak / çıkar', quick: 'Hızlı kuşan', quickAll: 'Herkese hızlı kuşan', offPlayer: 'Hepsini çıkar', offAll: 'Tüm kadrodan çıkar', offAllAsk: 'Bütün oyunculardaki bütün ekipmanlar çıkarılacak. Emin misin?', yes: 'Evet', cancel: 'Vazgeç', empty: '— boş —', pick: 'Tak…', bench: 'Yedek',
    rosterHint: 'Bir slotta çantadaki aynı türden ekipmanı seçince takılır, × ile çıkarılır. “Hızlı kuşan” oyundaki Quick Equip ile aynıdır (en iyi ekipmanları takar).',
    planTitle: 'Ortak yetenek planı (toplu)', planHint: 'Her mevki için 1., 2. ve 3. seçenek. Buton seçili hesapların hepsinde aynı anda: önce her oyuncuya mevkisine en uygun konteyneri verir (1. yoksa 2., o da yoksa 3.; aynı seçenekte üst renk önce: 🔴 > 🟣 > 🔵; hiçbiri yoksa herhangi biri). Sonra günlük 2 ücretsiz shuffle\'ı kimsenin kullanmadığı çöp konteynerlerde kullanır ve daha iyisi çıkarsa oyuncudan eskisini söküp yenisini verir. Ücretli shuffle ve bilet asla kullanılmaz.',
    planNote: 'Bütün yetenekler her seviyede çıkabilir; renk (derece) rastgele gelir. Ücretsiz shuffle 🔴 SUPERIOR vermez, en fazla 🟣. Bir konteynerin açık bütün slotları sayılır (40. seviyede biletle açılan 2. slot dahil).',
    choice: '{n}. seçenek', noSkill: '—', planRun: 'Seçili hesaplarda uygula ({n})', planSave: 'Planı kaydet', saved: 'Plan kaydedildi', only30: 'Sadece 30. seviye ve üstü hesaplar listelenir.',
    autoRes: { queued: 'sırada', running: 'çalışıyor', done: 'tamam', error: 'hata', lowLevel: '30. seviye altı', noPlayers: 'oyuncu yok', stopped: 'durduruldu' },
    player: 'Oyuncu', pos: 'Mevki', skill: 'Yetenek', got: '{hit}/{total} oyuncu seçtiğin yetenekte · {shuffles} shuffle · {changes} değişiklik',
    disTitle: 'Toplu dismantle', disHint: 'Seçili hesapların hepsinde aynı anda, çantadaki (takılı olmayan) ekipmanlardan İKİ sınırın da altında kalanlar parçalanır. Örnek: +7 ve Epic seçilirse en fazla +6 ve en fazla Rare olanlar gider; +8 Rare ya da +5 Epic kalır. Takılı ekipmana dokunulmaz.',
    disPlus: '+ sınırı (bu ve üstü kalır)', disRarity: 'Nadirlik sınırı (bu ve üstü kalır)', disWhat: 'Parçalanacak: en fazla +{p} ve en fazla {r}', disRun: 'Dismantle ({n} hesap)', disAsk: 'Seçili {n} hesapta en fazla +{p} ve en fazla {r} olan, takılı olmayan bütün ekipmanlar parçalanacak. Bu işlem geri alınamaz. Emin misin?', disYes: 'Evet, parçala',
    disPreview: 'Açık hesapta ({acc}) bu ayarla {n} parça gider', disRes: { dismantled: 'parçalandı', nothing: 'parçalanacak yok', error: 'hata', stopped: 'durduruldu', skipped: 'atlandı' }
  },
  en: {
    accounts: 'Accounts ({n})', all: 'Select all', none: 'Clear selection', stop: 'Stop',
    matTitle: 'Bulk material upgrade', matHint: 'On every chosen account at the same time: each step crafts as many as it can (at most 100 a craft, with the game\'s cooldown in between). The recipe under Uncommon turns Common into Uncommon, the one under Rare turns Uncommon into Rare.',
    from: 'From', to: 'To', kinds: 'Material', matRun: 'Upgrade {from} → {to} ({n} account(s))', matRes: { upgraded: 'upgraded', nothing: 'nothing to upgrade', error: 'error', stopped: 'stopped', skipped: 'skipped' },
    progress: '{done}/{total} · {account}', result: 'Result',
    manyTitle: { enhance: 'Bulk enhance', refine: 'Bulk refine', enchant: 'Bulk enchant' },
    manyHint: { enhance: 'The ticked pieces are enhanced one after the other up to the target + level (the game\'s cooldown is kept). If a piece runs out of stone the run stops there.', refine: 'The ticked pieces are refined one after the other up to the target refine level. At high levels a failed try can lower the level; the run stops when the Ore runs out.', enchant: 'The ticked pieces are enchanted one after the other until the enchant % reaches the target or the scroll limit per piece is used (the values are random).' },
    target: { enhance: 'Target +', refine: 'Target refine', enchant: 'Target %' }, maxTries: 'Max scrolls per piece', manyRun: 'Do the ticked ({n})',
    manyRes: { ok: 'done', already: 'already there', noStone: 'out of stone', noOre: 'out of Ore', noScroll: 'out of scrolls', notReached: 'target not reached', notEnchantable: 'cannot be enchanted', max: 'max level', missing: 'not found', error: 'error' },
    name: 'Name', level: '+', refine: 'Refine', enchant: 'Enchant', equippedBy: 'Equipped by', inBag: 'In bag', selectAll: 'Select all',
    rosterTitle: 'Roster · put on / take off gear', quick: 'Quick equip', quickAll: 'Quick equip everyone', offPlayer: 'Take all off', offAll: 'Take off the whole roster', offAllAsk: 'Every piece of gear on every player will be taken off. Are you sure?', yes: 'Yes', cancel: 'Cancel', empty: '— empty —', pick: 'Put on…', bench: 'Bench',
    rosterHint: 'Pick a bag item of the same type in a slot to put it on; × takes it off. “Quick equip” is the game\'s Quick Equip (puts on the best gear).',
    planTitle: 'Common skill plan (bulk)', planHint: 'A 1st, 2nd and 3rd choice for each position. The button, on every chosen account at the same time: first gives each player the container that fits his position best (the 1st, else the 2nd, else the 3rd; within a choice the higher colour first: 🔴 > 🟣 > 🔵; with none of them any container). Then it uses the 2 free daily shuffles on spare containers nobody uses and, when something better comes up, takes the old one off the player and gives him the new one. Paid shuffles and tickets are never used.',
    planNote: 'Every skill can come at any level; the colour (tier) is random. A free shuffle never gives 🔴 SUPERIOR, at most 🟣. All open slots of a container count (the 2nd slot opened with tickets at level 40 too).',
    choice: 'Choice {n}', noSkill: '—', planRun: 'Apply on the chosen accounts ({n})', planSave: 'Save plan', saved: 'Plan saved', only30: 'Only accounts at level 30 and above are listed.',
    autoRes: { queued: 'queued', running: 'running', done: 'done', error: 'error', lowLevel: 'below level 30', noPlayers: 'no players', stopped: 'stopped' },
    player: 'Player', pos: 'Position', skill: 'Skill', got: '{hit}/{total} player(s) on a chosen skill · {shuffles} shuffle(s) · {changes} change(s)',
    disTitle: 'Bulk dismantle', disHint: 'On every chosen account at the same time, the bag pieces (not worn) below BOTH limits are dismantled. Example: with +7 and Epic, pieces up to +6 and up to Rare go; a +8 Rare or a +5 Epic stays. Worn gear is never touched.',
    disPlus: '+ limit (this and above stay)', disRarity: 'Rarity limit (this and above stay)', disWhat: 'Dismantled: up to +{p} and up to {r}', disRun: 'Dismantle ({n} account(s))', disAsk: 'On the {n} chosen account(s) every piece not worn, up to +{p} and up to {r}, will be dismantled. This cannot be undone. Are you sure?', disYes: 'Yes, dismantle',
    disPreview: 'On the open account ({acc}) this setting takes {n} piece(s)', disRes: { dismantled: 'dismantled', nothing: 'nothing to dismantle', error: 'error', stopped: 'stopped', skipped: 'skipped' }
  },
  get fil() { return filOf(this.en); }
};
const useX = t => TEXT[t.lang] || TEXT.en;

function AccountPicker({ accounts, ids, setIds, x, storeKey, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return <div className="eq-batch-accounts" ref={ref}>
    <button className="btn ghost" disabled={disabled} onClick={() => setOpen(o => !o)}>{fill(x.accounts, { n: ids.length })} ▾</button>
    {open && <div className="eq-batch-menu">
      <button className="btn ghost small" onClick={() => setIds(ids.length === accounts.length ? [] : accounts.map(a => a.id))}>{ids.length === accounts.length ? x.none : x.all}</button>
      <GroupedPicks storeKey={storeKey} accounts={accounts} selected={ids} onSet={setIds} render={a => <label key={a.id}><input type="checkbox" checked={ids.includes(a.id)} onChange={() => setIds(ids.includes(a.id) ? ids.filter(v => v !== a.id) : [...ids, a.id])} />{a.name}</label>} />
    </div>}
  </div>;
}

// Craft → Material: every chosen account at once.
export function MaterialBatch({ state, t, toast, accountId, batch, busy }) {
  const x = useX(t);
  const accounts = state.accounts || [];
  const [ids, setIds] = useState(() => (accountId ? [accountId] : []));
  const [from, setFrom] = useState('COMMON');
  const [to, setTo] = useState('RARE');
  const [kinds, setKinds] = useState(['Fabric', 'Refine Stone']);
  const running = Boolean(batch?.running);
  const mine = batch?.mode === 'materials';
  const toggleKind = k => setKinds(v => (v.includes(k) ? v.filter(i => i !== k) : [...v, k]));
  const run = () => api.equipment.materials({ accountIds: ids, kinds, from, to }).catch(e => toast(e.message, 'error'));
  return <div className="panel eq-form">
    <b>{x.matTitle}</b>
    <p className="eq-hint">{x.matHint}</p>
    <div className="eq-row">
      <AccountPicker accounts={accounts} ids={ids} setIds={setIds} x={x} storeKey="eq-materials" disabled={running} />
      <label><span>{x.from}</span><select value={from} onChange={e => setFrom(e.target.value)}>{RARITIES.slice(0, -1).map(r => <option key={r} value={r}>{RARITY_EMOJI[r]} {cap(r)}</option>)}</select></label>
      <label><span>{x.to}</span><select value={to} onChange={e => setTo(e.target.value)}>{RARITIES.slice(1).map(r => <option key={r} value={r} disabled={RARITIES.indexOf(r) <= RARITIES.indexOf(from)}>{RARITY_EMOJI[r]} {cap(r)}</option>)}</select></label>
      <span className="eq-kinds">{['Fabric', 'Refine Stone'].map(k => <label key={k}><input type="checkbox" checked={kinds.includes(k)} onChange={() => toggleKind(k)} />{k}</label>)}</span>
      {running ? <><span className="pill warn"><i />{fill(x.progress, { done: batch.done, total: batch.total, account: batch.account || '' })}</span><button className="btn danger-soft" onClick={() => api.equipment.batchStop()}>{x.stop}</button></>
        : <button className="btn primary" disabled={busy || !ids.length || !kinds.length || RARITIES.indexOf(to) <= RARITIES.indexOf(from)} onClick={run}>{fill(x.matRun, { from: cap(from), to: cap(to), n: ids.length })}</button>}
    </div>
    {mine && batch.results?.length > 0 && <div className="eq-batch-result"><b>{x.result}</b><div>{batch.results.map((r, i) => <span key={i} className={`eq-batch-row ${r.result === 'upgraded' ? 'ok' : r.result === 'error' ? 'bad' : ''}`}>{r.account}: {x.matRes[r.result] || r.result}{r.detail ? ` (${r.detail})` : ''}</span>)}</div></div>}
  </div>;
}

// Enhance / Refine / Enchant: several pieces in a row.
export function ManyPanel({ mode, gear, t, busy, last }) {
  const x = useX(t);
  const [picked, setPicked] = useState(() => new Set());
  const [target, setTarget] = useState(mode === 'enhance' ? '7' : mode === 'refine' ? '3' : '20');
  const [maxTries, setMaxTries] = useState('10');
  const rows = useMemo(() => gear.filter(g => mode !== 'enchant' || ['EPIC', 'LEGENDARY', 'MYTHIC'].includes(g.rarity))
    .sort((a, b) => (b.equipped - a.equipped) || RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || b.level - a.level), [gear, mode]);
  useEffect(() => { setPicked(p => new Set([...p].filter(id => rows.some(r => r.id === id)))); }, [rows]);
  const toggle = id => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = rows.length > 0 && rows.every(r => picked.has(r.id));
  const ordered = rows.filter(r => picked.has(r.id)).map(r => r.id);
  const value = g => (mode === 'refine' ? g.refine : mode === 'enchant' ? `%${g.enchantPct}` : `+${g.level}`);
  const res = last?.kind === 'many' && last.mode === mode ? last : null;
  return <div className="panel eq-form">
    <b>{x.manyTitle[mode]}</b>
    <p className="eq-hint">{x.manyHint[mode]}</p>
    <div className="eq-row">
      <label><span>{x.target[mode]}</span><input type="number" min="1" max={mode === 'enhance' ? 12 : 100} value={target} onChange={e => setTarget(e.target.value)} /></label>
      {mode === 'enchant' && <label><span>{x.maxTries}</span><input type="number" min="1" value={maxTries} onChange={e => setMaxTries(e.target.value)} /></label>}
      <button className="btn primary" disabled={busy || !ordered.length || !(Number(target) >= 1)} onClick={() => api.equipment.many({ ids: ordered, mode, target: Number(target), maxTries: Number(maxTries) }).catch(() => {})}>{fill(x.manyRun, { n: ordered.length })}</button>
    </div>
    {res?.rows?.length > 0 && <div className="eq-batch-result"><b>{x.result}{res.running ? ' …' : ''}</b><div>{res.rows.map((r, i) => <span key={i} className={`eq-batch-row ${['ok', 'already'].includes(r.result) ? 'ok' : ['error', 'noStone', 'noOre', 'noScroll'].includes(r.result) ? 'bad' : ''}`}>{r.name}: {r.from ?? '?'} → {r.to ?? '?'} · {x.manyRes[r.result] || r.result}{r.detail ? ` (${r.detail})` : ''}</span>)}</div></div>}
    <div className="table-panel"><SortTable><thead><tr><th className="select-col"><input type="checkbox" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(rows.map(r => r.id)))} aria-label={x.selectAll} /></th><th>{x.name}</th><th>{x.target[mode].replace(/^[^ ]+ /, '')}</th><th>{x.equippedBy}</th></tr></thead>
      <tbody>{rows.map(g => <tr key={g.id} onClick={() => toggle(g.id)} className={picked.has(g.id) ? 'selected-row-soft' : ''}>
        <td className="select-col"><input type="checkbox" checked={picked.has(g.id)} onChange={() => toggle(g.id)} onClick={e => e.stopPropagation()} /></td>
        <td>{RARITY_EMOJI[g.rarity]} <b>{g.name}</b> <span className="muted-text">+{g.level} · R{g.refine}{g.hasEnchant ? ` · %${g.enchantPct}` : ''}</span></td>
        <td><b>{value(g)}</b></td>
        <td>{g.equippedBy || <span className="muted-text">{x.inBag}</span>}</td>
      </tr>)}</tbody></SortTable></div>
  </div>;
}

// Roster: put gear on / take it off.
export function RosterTab({ roster, gear, t, busy, toast }) {
  const x = useX(t);
  const [ask, setAsk] = useState(false);
  const byId = useMemo(() => new Map(gear.map(g => [g.id, g])), [gear]);
  const free = type => gear.filter(g => g.type === type && !g.equipped).sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || b.level - a.level);
  const run = p => p.catch(e => toast(e.message, 'error'));
  return <>
    <div className="panel pg-bar"><b>{x.rosterTitle}</b><span className="sp" />
      <button className="btn ghost" disabled={busy || !roster.length} onClick={() => run(api.equipment.quickEquip(null))}>{x.quickAll}</button>
      <button className="btn danger-soft" disabled={busy || !roster.length} onClick={() => setAsk(true)}>{x.offAll}</button>
    </div>
    <p className="eq-hint">{x.rosterHint}</p>
    {ask && <div className="panel eq-confirm"><span className="bad-text">{x.offAllAsk}</span><button className="btn ghost" onClick={() => setAsk(false)}>{x.cancel}</button><button className="btn danger" onClick={() => { setAsk(false); run(api.equipment.unequipAll()); }}>{x.yes}</button></div>}
    <div className="panel table-panel"><SortTable><thead><tr><th>{x.player}</th>{SLOTS.map(s => <th key={s}>{cap(s)}</th>)}<th /></tr></thead>
      <tbody>{roster.map(p => <tr key={p.playerId}>
        <td><b>{p.name}</b><small className="cell-sub">{p.slot || x.bench} · {p.position} {p.rating}</small></td>
        {SLOTS.map(s => { const g = p.gear[s] ? byId.get(p.gear[s]) : null; return <td key={s} className="eq-slot-cell">
          {g ? <span className="eq-on">{RARITY_EMOJI[g.rarity]} {g.name} +{g.level}<button className="link-btn" disabled={busy} title="×" onClick={() => run(api.equipment.unequip(p.playerId, s))}>×</button></span>
            : <select value="" disabled={busy || !free(s).length} onChange={e => e.target.value && run(api.equipment.equip(p.playerId, e.target.value))}><option value="">{free(s).length ? x.pick : x.empty}</option>{free(s).map(i => <option key={i.id} value={i.id}>{RARITY_EMOJI[i.rarity]} {i.name} +{i.level} R{i.refine}</option>)}</select>}
        </td>; })}
        <td className="actions"><button className="btn ghost small" disabled={busy} onClick={() => run(api.equipment.quickEquip([p.playerId]))}>{x.quick}</button><button className="btn ghost small" disabled={busy || !Object.values(p.gear).some(Boolean)} onClick={() => run(api.equipment.unequip(p.playerId, null))}>{x.offPlayer}</button></td>
      </tr>)}</tbody></SortTable></div>
  </>;
}

// Skills: one plan, many accounts at once (level 30+ only).
export function SkillPlan({ state, t, toast }) {
  const x = useX(t);
  const sk = state.skills || {};
  const accounts = (state.accounts || []).filter(a => (levelOf(state, a.id) || 0) >= 30);
  const [catalog, setCatalog] = useState([]);
  const [plan, setPlan] = useState(() => sk.plan || Object.fromEntries(POSITIONS.map(p => [p, [null, null, null]])));
  const [ids, setIds] = useState([]);
  useEffect(() => { api.skills?.catalog?.().then(c => setCatalog(c.skills || [])).catch(() => {}); }, []);
  useEffect(() => { if (sk.plan) setPlan(sk.plan); }, [JSON.stringify(sk.plan || null)]);
  const set = (pos, i, g) => setPlan(p => { const row = [...(p[pos] || [null, null, null])]; row[i] = g || null; return { ...p, [pos]: row }; });
  const running = Boolean(sk.auto?.running);
  const grpSk = useGroupedRows('skill-auto');
  const groups = ['OFFENSIVE', 'DEFENSIVE', 'UTILITY'];
  return <div className="panel eq-form sk-plan">
    <b>{x.planTitle}</b>
    <p className="eq-hint">{x.planHint}</p>
    <p className="eq-hint">{x.planNote}</p>
    <div className="table-panel"><SortTable><thead><tr><th>{x.pos}</th>{[1, 2, 3].map(n => <th key={n}>{fill(x.choice, { n })}</th>)}</tr></thead>
      <tbody>{POSITIONS.map(pos => <tr key={pos}><td><b>{pos}</b></td>{[0, 1, 2].map(i => <td key={i}><select value={plan[pos]?.[i] || ''} disabled={running} onChange={e => set(pos, i, e.target.value)}>
        <option value="">{x.noSkill}</option>
        {groups.map(gr => <optgroup key={gr} label={cap(gr)}>{catalog.filter(c => c.category === gr).map(c => <option key={c.group} value={c.group} title={c.effect}>{c.name} · {c.effect}</option>)}</optgroup>)}
      </select></td>)}</tr>)}</tbody></SortTable></div>
    <div className="eq-row">
      <AccountPicker accounts={accounts} ids={ids.filter(id => accounts.some(a => a.id === id))} setIds={setIds} x={x} storeKey="sk-plan" disabled={running} />
      <small className="muted-text">{x.only30}</small>
      <span className="sp" />
      <button className="btn ghost" disabled={running} onClick={() => api.settings.update({ skillPlan: plan }).then(() => toast(x.saved, 'success')).catch(e => toast(e.message, 'error'))}>{x.planSave}</button>
      {running ? <button className="btn danger-soft" onClick={() => api.skills.autoStop()}>{x.stop}</button>
        : <button className="btn primary" disabled={!ids.length} onClick={() => api.skills.auto(ids, plan).catch(e => toast(e.message, 'error'))}>{fill(x.planRun, { n: ids.length })}</button>}
    </div>
    {sk.auto?.rows?.length > 0 && <div className="table-panel"><SortTable><thead><tr><th>{x.player}</th><th>{x.result}</th></tr></thead>
      <tbody>{grpSk(asAccounts(sk.auto.rows), r => <tr key={r.accountId}>
        <td><b>{r.name}</b></td>
        <td><span className={`pill ${r.status === 'done' ? 'ok' : r.status === 'error' ? 'bad' : r.status === 'running' ? 'warn' : 'muted'}`}><i />{x.autoRes[r.status] || r.status}</span>
          {r.status === 'done' && <> <span className="muted-text">{fill(x.got, { hit: (r.players || []).filter(p => p.choice).length, total: (r.players || []).length, shuffles: r.shuffles, changes: r.changes })}</span>
            <div className="sk-got">{(r.players || []).map(p => <span key={p.name} className={p.choice ? 'ok' : ''}>{p.pos} {p.name}: {TIER_EMOJI[p.tier] || ''} {p.skill}{p.choice ? ` (${p.choice})` : ''}</span>)}</div></>}
          {r.error && <small className="bad-text"> {r.error}</small>}</td>
      </tr>, groupRowOf(2, g => <td className="muted-text">{g.filter(r => r.status === 'done').length}/{g.length}{g.some(r => r.status === 'error') ? <span className="bad-text"> · {g.filter(r => r.status === 'error').length} ✗</span> : ''}</td>))}</tbody></SortTable></div>}
  </div>;
}

// Dismantle (user 2026-11-18): every chosen account at once; pieces below both limits go.
export function DismantleBatch({ state, t, toast, accountId, batch, busy, gear = [] }) {
  const x = useX(t);
  const accounts = state.accounts || [];
  const [ids, setIds] = useState(() => (accountId ? [accountId] : []));
  const [plus, setPlus] = useState('7');
  const [rarity, setRarity] = useState('EPIC');
  const [ask, setAsk] = useState(false);
  const running = Boolean(batch?.running);
  const mine = batch?.mode === 'dismantle';
  const p = Math.floor(Number(plus));
  const okLimits = p >= 1 && RARITIES.indexOf(rarity) >= 1;
  const below = RARITIES[RARITIES.indexOf(rarity) - 1];
  const preview = okLimits ? gear.filter(g => !g.equipped && g.level < p && RARITIES.indexOf(g.rarity) < RARITIES.indexOf(rarity)).length : 0;
  const openName = accounts.find(a => a.id === accountId)?.name;
  const run = () => { setAsk(false); api.equipment.dismantle({ accountIds: ids, maxPlus: p, maxRarity: rarity }).catch(e => toast(e.message, 'error')); };
  return <div className="panel eq-form">
    <b>{x.disTitle}</b>
    <p className="eq-hint">{x.disHint}</p>
    <div className="eq-row">
      <AccountPicker accounts={accounts} ids={ids} setIds={setIds} x={x} storeKey="eq-dismantle" disabled={running} />
      <label><span>{x.disPlus}</span><input type="number" min="1" max="30" value={plus} disabled={running} onChange={e => setPlus(e.target.value)} /></label>
      <label><span>{x.disRarity}</span><select value={rarity} disabled={running} onChange={e => setRarity(e.target.value)}>{RARITIES.slice(1).map(r => <option key={r} value={r}>{RARITY_EMOJI[r]} {cap(r)}</option>)}</select></label>
      {running ? <><span className="pill warn"><i />{fill(x.progress, { done: batch.done, total: batch.total, account: batch.account || '' })}</span><button className="btn danger-soft" onClick={() => api.equipment.batchStop()}>{x.stop}</button></>
        : <button className="btn danger" disabled={busy || !ids.length || !okLimits} onClick={() => setAsk(true)}>{fill(x.disRun, { n: ids.length })}</button>}
    </div>
    {okLimits && <p className="muted-text">{fill(x.disWhat, { p: p - 1, r: cap(below) })}{openName ? ` · ${fill(x.disPreview, { acc: openName, n: preview })}` : ''}</p>}
    {ask && <div className="panel eq-confirm"><span className="bad-text">{fill(x.disAsk, { n: ids.length, p: p - 1, r: cap(below) })}</span><button className="btn ghost" onClick={() => setAsk(false)}>{x.cancel}</button><button className="btn danger" onClick={run}>{x.disYes}</button></div>}
    {mine && batch.results?.length > 0 && <div className="eq-batch-result"><b>{x.result}</b><div>{batch.results.map((r, i) => <span key={i} className={`eq-batch-row ${r.result === 'dismantled' ? 'ok' : r.result === 'error' ? 'bad' : ''}`}>{r.account}: {x.disRes[r.result] || r.result}{r.detail ? ` (${r.detail})` : ''}</span>)}</div></div>}
  </div>;
}
