import { useMemo, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import InjuryMark from './InjuryMark';
import RatingBadge from './RatingBadge';
import { BoughtList } from './BuyParts';

// Scout Avcısı (user 2026-11-13): watches every Scout board (our accounts and their friends), signs
// the players of this list and lists them on the market at Auto Trade's prices.
const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const num = v => (v == null || v === '' ? '—' : Number(v).toLocaleString());

const TEXT = {
  tr: {
    title: 'Scout Avcısı', subtitle: 'Hesapların ve arkadaşlarının Scout\'unda listendeki oyuncuları alır, hemen pazara koyar · başka hiçbir işi durdurmaz',
    start: 'Başlat', stop: 'Durdur', running: 'Çalışıyor', idle: 'Durdu', boards: '{n} Scout izleniyor', lastScan: 'Son tarama {t}',
    list: 'Aranan oyuncular', add: 'Oyuncu ekle…', empty: 'Listeye oyuncu ekle.', player: 'Oyuncu', value: 'Değer', price: 'Liste fiyatı', priceDisc: '%5 indirimliyse',
    lv30: 'Lv30+ hesap alsın', lv30Hint: 'Seçiliyse oyuncuyu yalnızca 30. seviye ve üstü bir hesap alır (%5 maaş indirimi şansı). Kendi hesabımızın Scout\'undaysa ve uygun arkadaş yoksa TK\'sı yeten bir Lv30+ hesap onunla arkadaş olur.',
    qty: 'Adet', qtyHint: 'Boş = sınırsız', bought: 'Alınan', active: 'Aktif', remove: 'Sil', resetBought: 'Sıfırla', noPrice: 'Fiyat yok', fired: 'İndirimsizse kovulur',
    warnings: 'Alınamayanlar', clear: 'Temizle', noWarnings: 'Uyarı yok.',
    mainToSide: 'Mainden aldıklarını yan hesaba aktar (harcayıcılar öncelikli)', mainToSideHint: 'Main bir oyuncu alınca oyuncu takasla bir yan hesaba verilir (önce Harcayıcılar, sonra diğer yan hesaplar; kadrosu dolu ya da oyuncuya zaten sahip olan hesap atlanır) ve pazara o yan hesap Auto Trade fiyatından koyar. Takas olmazsa Main kendisi listeler.',
    useFree: 'Günlük yenileme haklarını kullan', useFreeHint: 'Seçili hesapların kendi Scout\'unda listedeki oyunculardan biri yoksa, hesabın günlük ücretsiz yenileme hakkıyla Scout yenilenir ve yeni liste hemen kontrol edilir.',
    useItems: 'Callback eşyalarını kullan', useItemsHint: 'Seçili hesaplarda ücretsiz haklar bittikten sonra Callback eşyası kullanılarak Scout yenilenir. Eşya bitene kadar kullanılır.',
    accountsN: '{n} hesap', edit: 'Hesapları seç', pickTitle: 'Hangi hesaplarda kullanılsın?', selectAllAcc: 'Tümünü seç', selectNone: 'Hiçbiri', saveAcc: 'Kaydet', accSearch: 'Hesap ara…',
    editPrice: 'Fiyatı düzenle', priceTitle: '{name} · fiyat', priceNote: 'Auto Trade fiyatlandırmasına kaydedilir; Auto Trade de bu fiyatı kullanır.', fireOpt: 'İndirimsizse kov (yalnızca %5 indirimli fiyat kullanılır)',
    reasons: { noLv30: 'Bu Scout\'un sahibinin TK\'sı yeten Lv30+ arkadaşı yok', noBuyer: 'Alabilecek hesap yok', noFriend: 'Bu Scout\'un sahibi bizden değil ve hiçbir hesabımız onun arkadaşı değil', error: 'Hata' }, why: { TK: 'hesabın TK\'sı yetmiyor', busy: 'hesap başka işte', full: 'hesabın kadrosu dolu', owned: 'hesapta oyuncu zaten var', unread: 'hesap okunamadı' },
    from: '{owner} Scout\'u', listed: 'Pazara konanlar', listedHint: 'Scout Avcısı\'nın aldığı ve pazara koyduğu oyuncular; fiyatı buradan değiştirebilirsin.',
    askTitle: 'Fiyatı olmayan oyuncular', askText: 'Bu oyuncuların Auto Trade fiyatlandırmasında fiyatı yok. Alınınca hangi fiyattan pazara konsunlar? (Auto Trade fiyatlandırmasına da kaydedilir.)', askNormal: 'Normal fiyat', askDisc: '%5 indirimle alınırsa', save: 'Kaydet ve başlat', cancel: 'Vazgeç',
    how: [
      'Hesaplarının kendi Scout\'larını ve arkadaş listelerindeki herkesin Scout\'unu okur (giriş yapmadan, kimse oyundan atılmaz). Scout her 30 dakikada yenilenir; yenilendiği anda tekrar bakılır.',
      'Listedeki oyuncu görülünce: Scout bizim hesabımızınsa ve TK\'sı yetiyorsa o alır; yetmezse TK\'sı yeten bir arkadaş hesabımız alır; o da yoksa TK\'sı yeten bir hesabımız onunla arkadaş olup alır. Başka birinin Scout\'undan yalnızca onun arkadaşı olan hesabımız alabilir; uygun hesap yoksa alınmaz, "Alınamayanlar"a yazılır.',
      '"Lv30+ hesap alsın" seçiliyse aynı kurallar yalnızca 30+ hesaplarla uygulanır. Ana hesap mevcut arkadaşlıklarıyla ve kendi Scout\'uyla alabilir; ana hesabın arkadaş listesi değiştirilmez.',
      'Alınan oyuncu hemen Auto Trade fiyatlandırmasındaki fiyatla pazara konur (%5 indirimle alındıysa indirimli fiyatla). Fiyatı olmayan oyuncular Başlat\'ta sorulur. Secret oyuncular fiyatlarından tanınır.',
      'Auto Trade\'in o an kullandığı ya da Auto Play\'i tarayıcıda çalışan hesaplar alıcı olmaz. Uygulama yeniden açılınca kaldığı yerden devam eder.',
      '"Günlük yenileme haklarını kullan" ve "Callback eşyalarını kullan" varsayılan olarak kapalı. Açınca hangi hesaplarda kullanılacağını seçersin. Seçili bir hesabın kendi Scout\'unda listedeki oyunculardan biri yoksa önce ücretsiz hakla, haklar bitince (izin verildiyse) Callback eşyasıyla Scout yenilenir; her taramada hesap başına en fazla bir yenileme.',
      'Fiyatların yanındaki ✎ ile fiyat buradan değiştirilir; değişiklik Auto Trade fiyatlandırmasına yazılır, Auto Trade de aynı fiyatı kullanır.'
    ]
  },
  en: {
    title: 'Scout Hunter', subtitle: 'Signs the players of your list on the Scout of your accounts and their friends and lists them at once · pauses nothing',
    start: 'Start', stop: 'Stop', running: 'Running', idle: 'Stopped', boards: '{n} Scouts watched', lastScan: 'Last scan {t}',
    list: 'Players wanted', add: 'Add a player…', empty: 'Add players to the list.', player: 'Player', value: 'Value', price: 'List price', priceDisc: 'If signed 5% off',
    lv30: 'Lv30+ account signs', lv30Hint: 'When ticked only a level 30+ account signs it (5% salary cut chance). On our own account\'s Scout with no fitting friend, a Lv30+ account with the TK befriends it.',
    qty: 'Qty', qtyHint: 'Empty = no limit', bought: 'Signed', active: 'On', remove: 'Remove', resetBought: 'Reset', noPrice: 'No price', fired: 'Fired if not 5% off',
    warnings: 'Not signed', clear: 'Clear', noWarnings: 'No warnings.',
    mainToSide: "Give Main's signings to a side account (spenders first)", mainToSideHint: 'When Main signs a player, it is traded to a side account (spenders first, then the other sides; a full roster or one that has the player already is skipped) and that side lists it at the Auto Trade price. When the trade fails Main lists it itself.',
    useFree: 'Use the daily refreshes', useFreeHint: "When a chosen account's own Scout has no player of the list, the account's free daily refresh renews its Scout and the new list is checked at once.",
    useItems: 'Use Callback items', useItemsHint: 'On the chosen accounts a Callback item renews the Scout once the free refreshes are used up. Items are used until none is left.',
    accountsN: '{n} account(s)', edit: 'Choose accounts', pickTitle: 'On which accounts?', selectAllAcc: 'Select all', selectNone: 'None', saveAcc: 'Save', accSearch: 'Search accounts…',
    editPrice: 'Edit price', priceTitle: '{name} · price', priceNote: "Saved to Auto Trade's pricing; Auto Trade uses this price too.", fireOpt: 'Fire if not 5% off (only the 5%-off price is used)',
    reasons: { noLv30: 'The owner of this Scout has no Lv30+ friend with the TK', noBuyer: 'No account could sign it', noFriend: 'The owner of this Scout is not ours and none of our accounts is its friend', error: 'Error' }, why: { TK: 'short of TK', busy: 'busy in another job', full: 'roster full', owned: 'already has the player', unread: 'not read' },
    from: "{owner}'s Scout", listed: 'Listed', listedHint: 'Players Scout Hunter signed and listed; change their price here.',
    askTitle: 'Players without a price', askText: "These players have no price in Auto Trade's pricing. At what price should they be listed once signed? (Saved to Auto Trade's pricing too.)", askNormal: 'Normal price', askDisc: 'If signed 5% off', save: 'Save and start', cancel: 'Cancel',
    how: [
      'Reads the Scout of your accounts and of everyone on their friend lists (without signing in, nobody is signed out). A Scout renews every 30 minutes; it is read again right then.',
      'When a player of the list shows up: on our account\'s Scout that account signs it when it has the TK; otherwise a friend account of ours with the TK; otherwise an account of ours with the TK befriends it and signs. From someone else\'s Scout only our accounts that are their friends can sign; with none it is not signed and goes to "Not signed".',
      'With "Lv30+ account signs" the same rules use level 30+ accounts only. Main may sign over its existing friendships and its own Scout; Main\'s friends list is never changed.',
      'A signed player is listed at once at its Auto Trade price (the discounted one when signed 5% off). Players without a price are asked at Start. Secret players are recognised by their price.',
      'An account Auto Trade is using, or whose Auto Play runs in the browser, does not sign. After an app restart it goes on by itself.',
      '"Use the daily refreshes" and "Use Callback items" are off by default. Turning one on asks which accounts may use it. When a chosen account\'s own Scout has no player of the list, its Scout is renewed with a free refresh first and, once those are used up (if allowed), with a Callback item; at most one renewal per account per scan.',
      'The ✎ next to the prices changes the price here; it is written to Auto Trade\'s pricing and Auto Trade uses the same price.'
    ]
  },
  get fil() { return filOf(this.en); }
};

export default function HunterPage({ state, t, toast, scout = null, tab: openTab = null }) {
  const x = TEXT[t.lang] || TEXT.en;
  const [tab, setTab] = useState(openTab === 'scout' ? 'scout' : 'hunter');
  const tabs = <div className="dp-tabs"><button className={tab === 'hunter' ? 'active' : ''} onClick={() => setTab('hunter')}>{x.title}</button><button className={tab === 'scout' ? 'active' : ''} onClick={() => setTab('scout')}>Scout</button></div>;
  const h = state.hunter || { watch: [], warnings: [], stats: {} };
  const pricing = state.autoTrade2?.pricing || { players: {}, defaults: {} };
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState(null);       // { rows: [{ id, name, price, currency, discPrice, discCurrency }] }
  const rf = h.refresh || { free: false, items: false, freeAccounts: [], itemAccounts: [] };
  const [picker, setPicker] = useState(null);  // { kind: 'free' | 'items', ids: Set, enable: bool }
  const [pq, setPq] = useState('');
  const accounts = state.accounts || [];
  const openPicker = (kind, enable) => { setPq(''); setPicker({ kind, enable, ids: new Set(kind === 'free' ? rf.freeAccounts : rf.itemAccounts) }); };
  const toggleOpt = (kind, on) => { if (on) openPicker(kind, true); else run(() => api.hunter.setRefresh({ [kind]: false })); };
  const savePicker = () => run(async () => { const ids = [...picker.ids]; await api.hunter.setRefresh({ [picker.kind]: ids.length > 0, [picker.kind === 'free' ? 'freeAccounts' : 'itemAccounts']: ids }); setPicker(null); });
  const [edit, setEdit] = useState(null);      // { id, name, price, currency, discPrice, discCurrency, fireNoDisc }
  const openEdit = w => { const pr = priceOf(w.playerId); setEdit({ id: w.playerId, name: w.name, price: pr.price ? String(pr.price) : '', currency: pr.currency || 'TIX', discPrice: pr.discPrice ? String(pr.discPrice) : '', discCurrency: pr.discCurrency || pr.currency || 'TIX', fireNoDisc: Boolean(pr.fireNoDisc) }); };
  const saveEdit = () => run(async () => {
    const e = edit; const players = { ...(pricing.players || {}) };
    const cur = { ...(players[e.id] || {}) };
    const n = v => (Number(v) >= 1 ? Math.floor(Number(v)) : null);
    if (n(e.price)) { cur.price = n(e.price); cur.currency = e.currency; } else { delete cur.price; }
    if (n(e.discPrice)) { cur.discPrice = n(e.discPrice); cur.discCurrency = e.discCurrency; } else { delete cur.discPrice; delete cur.discCurrency; }
    cur.fireNoDisc = Boolean(e.fireNoDisc);
    players[e.id] = cur;
    await api.autoTrade.savePricing({ defaults: pricing.defaults, players });
    setEdit(null);
  });
  const run = async fn => { try { await fn(); } catch (e) { toast(e.message, 'error'); } };
  const live = useMemo(() => new Map((state.players?.players || []).map(p => [p.id, p])), [state.players]);
  const suggestions = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const have = new Set(h.watch.map(w => w.playerId));
    return (state.players?.players || []).filter(p => !have.has(p.id) && p.name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, h.watch, state.players]);
  const priceOf = id => pricing.players?.[id] || {};
  const missing = h.watch.filter(w => w.enabled !== false && !priceOf(w.playerId).price && !priceOf(w.playerId).fireNoDisc);
  const start = () => {
    if (missing.length) setAsk({ rows: missing.map(w => ({ id: w.playerId, name: w.name, price: '', currency: 'TIX', discPrice: '', discCurrency: 'TIX' })) });
    else run(() => api.hunter.start());
  };
  const saveAndStart = () => run(async () => {
    const bad = ask.rows.find(r => !(Number(r.price) >= 1));
    if (bad) throw new Error(`${bad.name}: ${x.askNormal}?`);
    const players = { ...(pricing.players || {}) };
    for (const r of ask.rows) players[r.id] = { ...(players[r.id] || {}), price: Math.floor(Number(r.price)), currency: r.currency, ...(Number(r.discPrice) >= 1 ? { discPrice: Math.floor(Number(r.discPrice)), discCurrency: r.discCurrency } : {}) };
    await api.autoTrade.savePricing({ defaults: pricing.defaults, players });
    setAsk(null);
    await api.hunter.start();
  });
  const setRow = (i, patch) => setAsk(a => ({ rows: a.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const fmtPrice = (p, c) => (p ? `${num(p)} ${c || ''}` : null);

  // tabs under the title, like Günlük İşler (user 2026-11-13)
  if (tab === 'scout') return <div className="page hunter-page"><div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div></div>{tabs}<div className="embedded-page">{scout}</div></div>;
  return <div className="page hunter-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar">{h.running ? <button className="btn danger-soft" onClick={() => run(() => api.hunter.stop())}>{x.stop}</button>
        : <button className="btn primary" disabled={!h.watch.some(w => w.enabled !== false)} onClick={start}>{x.start}</button>}</div></div>

    {tabs}
    <div className={`panel ab-status ${h.running ? 'ok' : 'muted'}`}>
      <span className={`pill ${h.running ? 'ok' : 'muted'}`}><i />{h.running ? x.running : x.idle}</span>
      {h.running && <span>{fill(x.boards, { n: h.stats?.boards || 0 })}</span>}
      {h.stats?.lastScanAt && <span className="muted-text">{fill(x.lastScan, { t: new Date(h.stats.lastScanAt).toLocaleTimeString() })}</span>}
    </div>

    <div className="panel hunter-refresh">
      <div className="hunter-opt"><label title={x.mainToSideHint}><input type="checkbox" checked={h.mainToSide !== false} onChange={e => api.hunter.setOption({ mainToSide: e.target.checked }).catch(err => toast(err.message, 'error'))} /> <b>{x.mainToSide}</b></label></div>
      {[['free', x.useFree, x.useFreeHint, rf.free, rf.freeAccounts], ['items', x.useItems, x.useItemsHint, rf.items, rf.itemAccounts]].map(([k, label, hint, on, ids]) => <div key={k} className="hunter-opt">
        <label title={hint}><input type="checkbox" checked={Boolean(on)} onChange={e => toggleOpt(k, e.target.checked)} /> <b>{label}</b></label>
        {on && <span className="muted-text"> · {fill(x.accountsN, { n: ids.length })} <button className="link-btn" onClick={() => openPicker(k, false)}>{x.edit}</button></span>}
        <div><small className="muted-text">{hint}</small></div>
      </div>)}
    </div>

    <h3 className="section-title">{x.list}</h3>
    <div className="ab-add"><input placeholder={x.add} value={q} onChange={e => setQ(e.target.value)} />
      {suggestions.length > 0 && <div className="ab-sugg">{suggestions.map(p => <button key={p.id} onClick={() => run(async () => { await api.hunter.add([p]); setQ(''); })}><b>{p.name}</b><InjuryMark name={p.name} /><small>{p.team} · {p.position} · {p.rating} · {num(p.value)}</small></button>)}</div>}
    </div>
    <div className="panel table-panel">{h.watch.length ? <SortTable><thead><tr><th>{x.active}</th><th>{x.player}</th><th>{x.value}</th><th>{x.price}</th><th>{x.priceDisc}</th><th title={x.lv30Hint}>{x.lv30}</th><th title={x.qtyHint}>{x.qty}</th><th>{x.bought}</th><th></th></tr></thead>
      <tbody>{h.watch.map(w => { const p = live.get(w.playerId); const pr = priceOf(w.playerId); return <tr key={w.playerId} className={w.enabled === false ? 'muted-row' : ''}>
        <td><input type="checkbox" checked={w.enabled !== false} onChange={e => run(() => api.hunter.update(w.playerId, { enabled: e.target.checked }))} /></td>
        <td><b>{w.name}</b><InjuryMark name={w.name} /> <span className="muted-text">{p?.team || w.team} · {p?.position || w.position}</span> <RatingBadge grade={p?.rating || w.rating} mini /></td>
        <td className="num">{num(p?.value)}</td>
        <td>{pr.fireNoDisc ? <span className="muted-text">{x.fired}</span> : fmtPrice(pr.price, pr.currency) || <span className="warn-text">{x.noPrice}</span>} <button className="link-btn" title={x.editPrice} onClick={() => openEdit(w)}>✎</button></td>
        <td>{fmtPrice(pr.discPrice, pr.discCurrency || pr.currency) || '—'} <button className="link-btn" title={x.editPrice} onClick={() => openEdit(w)}>✎</button></td>
        <td title={x.lv30Hint}><input type="checkbox" checked={Boolean(w.lv30)} onChange={e => run(() => api.hunter.update(w.playerId, { lv30: e.target.checked }))} /></td>
        <td><input className="eq-small" type="number" min="1" placeholder="∞" defaultValue={w.qty ?? ''} onBlur={e => { const v = e.target.value; if (String(v) !== String(w.qty ?? '')) run(() => api.hunter.update(w.playerId, { qty: v })); }} /></td>
        <td className="num">{w.bought || 0}{w.bought ? <> <button className="link-btn" onClick={() => run(() => api.hunter.update(w.playerId, { resetBought: true }))}>{x.resetBought}</button></> : null}</td>
        <td className="actions"><button className="btn ghost small" onClick={() => run(() => api.hunter.remove([w.playerId]))}>{x.remove}</button></td>
      </tr>; })}</tbody></SortTable> : <div className="empty">{x.empty}</div>}</div>

    <div className="at2-section-head"><h3 className="section-title">{x.warnings}</h3>{h.warnings?.length > 0 && <button className="btn ghost small" onClick={() => run(() => api.hunter.clearWarnings())}>{x.clear}</button>}</div>
    <div className="panel table-panel">{h.warnings?.length ? <SortTable><thead><tr><th>{t.lang === 'tr' ? 'Zaman' : 'Time'}</th><th>{x.player}</th><th>Scout</th><th>{t.lang === 'tr' ? 'Sebep' : 'Reason'}</th></tr></thead>
      <tbody>{h.warnings.map((w, i) => <tr key={i}><td>{new Date(w.at).toLocaleTimeString()}</td><td><b>{w.player}</b>{w.price ? <small className="muted-text"> · {num(w.price)} TK</small> : null}</td><td>{fill(x.from, { owner: w.owner })}</td><td className="warn-text">{x.reasons[w.reason] || w.reason}{w.detail ? ` · ${w.reason === 'error' ? w.detail : String(w.detail).split(' · ').map(p => { const [k, n] = p.split(' '); const why = x.why || {}; return why[k] && n ? `${n} ${why[k]}` : p; }).join(' · ')}` : ''}</td></tr>)}</tbody></SortTable>
      : <p className="muted-text dp-pad">{x.noWarnings}</p>}</div>

    <BoughtList state={state} lang={t.lang} toast={toast} source="scout" title={x.listed} hint={x.listedHint} />

    <details className="panel pvp-how"><summary>{t.lang === 'tr' ? 'Nasıl çalışır?' : 'How does it work?'}</summary><ul>{x.how.map(l => <li key={l}>{l}</li>)}</ul></details>

    {picker && <div className="modal-backdrop" onClick={() => setPicker(null)}><div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
      <div className="modal-head"><b>{x.pickTitle}</b> <span className="muted-text">· {picker.kind === 'free' ? x.useFree : x.useItems}</span></div>
      <div className="toolbar"><input className="guide-search" placeholder={x.accSearch} value={pq} onChange={e => setPq(e.target.value)} />
        <button className="btn ghost small" onClick={() => setPicker(p => ({ ...p, ids: new Set(accounts.map(a => a.id)) }))}>{x.selectAllAcc}</button>
        <button className="btn ghost small" onClick={() => setPicker(p => ({ ...p, ids: new Set() }))}>{x.selectNone}</button>
        <span className="muted-text">{fill(x.accountsN, { n: picker.ids.size })}</span></div>
      <div className="acc-pick-list" style={{ maxHeight: 360, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 4 }}>
        {accounts.filter(a => !pq.trim() || a.name.toLowerCase().includes(pq.trim().toLowerCase())).map(a => <label key={a.id} className="check-row"><input type="checkbox" checked={picker.ids.has(a.id)} onChange={e => setPicker(p => { const ids = new Set(p.ids); if (e.target.checked) ids.add(a.id); else ids.delete(a.id); return { ...p, ids }; })} /> {a.name}</label>)}
      </div>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setPicker(null)}>{x.cancel}</button><button className="btn primary" onClick={savePicker}>{x.saveAcc}</button></div>
    </div></div>}

    {edit && <div className="modal-backdrop" onClick={() => setEdit(null)}><div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
      <div className="modal-head"><b>{fill(x.priceTitle, { name: edit.name })}</b></div>
      <p className="muted-text">{x.priceNote}</p>
      <label className="check-row"><input type="checkbox" checked={edit.fireNoDisc} onChange={e => setEdit(v => ({ ...v, fireNoDisc: e.target.checked }))} /> {x.fireOpt}</label>
      <div className="at2-row">
        <label><span>{x.price}</span><span><input className="eq-small" type="number" min="1" disabled={edit.fireNoDisc} value={edit.fireNoDisc ? '' : edit.price} onChange={e => setEdit(v => ({ ...v, price: e.target.value }))} /> <select disabled={edit.fireNoDisc} value={edit.currency} onChange={e => setEdit(v => ({ ...v, currency: e.target.value }))}><option>TIX</option><option>APK</option></select></span></label>
        <label><span>{x.priceDisc}</span><span><input className="eq-small" type="number" min="1" value={edit.discPrice} onChange={e => setEdit(v => ({ ...v, discPrice: e.target.value }))} /> <select value={edit.discCurrency} onChange={e => setEdit(v => ({ ...v, discCurrency: e.target.value }))}><option>TIX</option><option>APK</option></select></span></label>
      </div>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setEdit(null)}>{x.cancel}</button><button className="btn primary" onClick={saveEdit}>{x.saveAcc}</button></div>
    </div></div>}

    {ask && <div className="modal-backdrop" onClick={() => setAsk(null)}><div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
      <div className="modal-head"><b>{x.askTitle}</b></div>
      <p className="muted-text">{x.askText}</p>
      <SortTable><thead><tr><th>{x.player}</th><th>{x.askNormal}</th><th>{x.askDisc}</th></tr></thead><tbody>{ask.rows.map((r, i) => <tr key={r.id}>
        <td><b>{r.name}</b></td>
        <td><input className="eq-small" type="number" min="1" value={r.price} onChange={e => setRow(i, { price: e.target.value })} /> <select value={r.currency} onChange={e => setRow(i, { currency: e.target.value })}><option>TIX</option><option>APK</option></select></td>
        <td><input className="eq-small" type="number" min="1" value={r.discPrice} onChange={e => setRow(i, { discPrice: e.target.value })} /> <select value={r.discCurrency} onChange={e => setRow(i, { discCurrency: e.target.value })}><option>TIX</option><option>APK</option></select></td>
      </tr>)}</tbody></SortTable>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setAsk(null)}>{x.cancel}</button><button className="btn primary" onClick={saveAndStart}>{x.save}</button></div>
    </div></div>}
  </div>;
}
