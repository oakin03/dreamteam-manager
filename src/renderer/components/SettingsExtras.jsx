import { useEffect, useState } from 'react';
import { filOf } from '../i18n-fil';
import { isExcluded } from '../edition';

const api = window.dreamteam;

// Sidebar pages: id → [icon, label key in the app texts].
// When a new service is added, add it here AND to NAV_DEFAULT: a saved layout that
// does not know the page yet gets it in its default list automatically.
export const PAGE_META = {
  home: ['home', 'commandCenter'], accounts: ['accounts', 'accounts'], social: ['chat', 'socialPage'],
  autoplay: ['play', 'autoplay'], autotrade: ['swap', 'autoTrade'], cardfactory: ['cards', 'cardFactoryPage'], daily: ['calendar', 'dailyPage'], office: ['hall', 'officePage'], autobuy: ['cart', 'autoBuyPage'], tournament: ['trophy', 'tournament'], tktransfer: ['transfer', 'tkPage'],
  players: ['chart', 'playersPage'], draft: ['target', 'draftPage'], cards: ['cards', 'cards'], equipment: ['shirt', 'equipment'], bag: ['bag', 'bagPage'], hunter: ['scout', 'hunterPage'],
  market: ['market', 'market'], trade: ['hall', 'trade'],
  activity: ['activity', 'activity'], guide: ['book', 'guide'], settings: ['settings', 'settings'],
  // Owner license panel — full edition only (features.json excludes it from pro/basic).
  licenses: ['accounts', 'licensesPanel']
};
// basic edition: Scout Avcısı is left out, the page shows only Scout under the name Scout
//@only(basic) PAGE_META.hunter = ['scout', 'scout'];
// Pages that became tabs of another page (user 2026-11-13): links to them open the tab.
export const PAGE_ALIAS = { pvp: ['daily', 'pvp'], tower: ['daily', 'tower'], scout: ['hunter', 'scout'], valuepredict: ['players', 'vp'], anesthesia: ['bag', 'injury'] };
// The default lists (a null heading = no title). nameKey is translated; a saved
// layout stores the user's own names.
export const NAV_DEFAULT = [
  { id: 'top', nameKey: null, items: ['home', 'accounts', 'social'] },
  // the user's own order of 2026-11-13 (PVP and Tower are tabs of Günlük İşler, Scout a tab of Scout
  // Avcısı, Değer Tahmini a tab of Oyuncular since then)
  { id: 'automation', nameKey: 'navAutomation', items: ['autoplay', 'autotrade', 'cardfactory', 'autobuy', 'hunter', 'daily', 'office', 'tournament', 'tktransfer'] },
  { id: 'players', nameKey: 'navPlayers', items: ['players', 'draft', 'cards', 'equipment', 'bag'] },
  { id: 'market', nameKey: 'navMarket', items: ['market', 'trade'] },
  { id: 'app', nameKey: 'navApp', items: ['activity', 'guide', 'licenses', 'settings'] }
];

const defaultLayout = t => NAV_DEFAULT.map(g => ({ id: g.id, name: g.nameKey ? t[g.nameKey] : '', items: [...g.items] }));

// Saved layout (or the default) cleaned up: unknown pages dropped, duplicates removed,
// pages missing from it (new services) added to their default list.
export function normalizeLayout(saved, t) {
  const base = Array.isArray(saved) && saved.length ? saved : defaultLayout(t);
  const seen = new Set();
  // In the public edition, a module left out (src/shared/features.json) is dropped everywhere:
  // the sidebar and the Settings layout editor. In the full edition isExcluded is always false.
  const ok = id => PAGE_META[id] && !isExcluded(id);
  const groups = base.map(g => ({ id: g.id || Math.random().toString(36).slice(2), name: String(g.name ?? ''), items: (g.items || []).filter(id => ok(id) && !seen.has(id) && seen.add(id)) }));
  for (const def of NAV_DEFAULT) for (const id of def.items) {
    if (seen.has(id) || !ok(id)) continue;
    seen.add(id);
    (groups.find(g => g.id === def.id) || groups[groups.length - 1]).items.push(id);
  }
  return groups;
}

// Sidebar structure for App: [[heading, [[page, icon, label]...]]...]
export function buildNav(saved, t) {
  return normalizeLayout(saved, t).filter(g => g.items.length).map(g => [g.name || null, g.items.map(id => [id, PAGE_META[id][0], t[PAGE_META[id][1]] || id])]);
}

const TEXT = {
  tr: {
    navTitle: 'Menü düzeni', navHint: 'Sayfayı basılı tutup sürükleyerek sırala ya da başka listeye taşı; listeyi ⋮⋮ tutamacından sürükle. Başlığı boş bırakılan liste başlıksız görünür.', dragItem: 'Basılı tutup sürükle', dragGroup: 'Listeyi sürükle', emptyList: 'Sayfaları buraya bırak',
    groupName: 'Liste adı', noTitle: '(başlıksız)', moveTo: 'Taşı…', up: 'Yukarı', down: 'Aşağı', groupUp: 'Listeyi yukarı', groupDown: 'Listeyi aşağı', addGroup: 'Yeni liste', removeGroup: 'Listeyi sil', removeHint: 'Listedeki sayfalar ilk listeye taşınır', save: 'Kaydet', reset: 'Varsayılana dön', saved: 'Menü kaydedildi', resetDone: 'Menü varsayılana döndü', newGroup: 'Yeni liste',
    factoryTitle: 'Fabrika ayarları', factoryHint: 'Uygulamayı kurulduğu ilk haline döndürür: bütün ayarlar, kayıtlı veriler (kartlar, roller, oyuncular, raporlar…), zamanlanmış görevler, aktivite kayıtları ve oyun oturumları silinir. Uygulama ardından yeniden başlar.',
    factoryButton: 'Fabrika ayarlarına dön', factoryConfirm: 'Her şey silinecek ve uygulama yeniden başlayacak. Emin misin?', keepPasswords: 'Kayıtlı şifreleri koru', keepHint: 'İşaretliyse hesaplar ve kayıtlı giriş bilgileri (Trading Hall ve Player Market hesabı dahil) silinmez; işaretli değilse onlar da silinir.', cancel: 'Vazgeç', confirm: 'Evet, sıfırla', resetting: 'Sıfırlanıyor…'
  },
  en: {
    navTitle: 'Menu layout', navHint: 'Press and drag a page to sort it or move it to another list; drag a list by its ⋮⋮ handle. A list with an empty title shows without a heading.', dragItem: 'Press and drag', dragGroup: 'Drag the list', emptyList: 'Drop pages here',
    groupName: 'List name', noTitle: '(no title)', moveTo: 'Move to…', up: 'Up', down: 'Down', groupUp: 'List up', groupDown: 'List down', addGroup: 'New list', removeGroup: 'Delete list', removeHint: 'Its pages move to the first list', save: 'Save', reset: 'Reset to default', saved: 'Menu saved', resetDone: 'Menu reset to default', newGroup: 'New list',
    factoryTitle: 'Factory reset', factoryHint: 'Brings the app back to a fresh install: all settings, saved data (cards, roles, players, reports…), scheduled tasks, activity logs and game sessions are deleted. The app restarts afterwards.',
    factoryButton: 'Factory reset', factoryConfirm: 'Everything will be deleted and the app will restart. Are you sure?', keepPasswords: 'Keep saved passwords', keepHint: 'Ticked: accounts and saved logins (including the Trading Hall and Player Market accounts) are kept; unticked: they are deleted too.', cancel: 'Cancel', confirm: 'Yes, reset', resetting: 'Resetting…'
  },
  get fil() { return filOf(this.en); }
};

export function NavEditor({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const [groups, setGroups] = useState(() => normalizeLayout(state.settings?.navLayout, t));
  useEffect(() => { setGroups(normalizeLayout(state.settings?.navLayout, t)); }, [JSON.stringify(state.settings?.navLayout || null), t.lang]);
  const label = id => t[PAGE_META[id][1]] || id;
  const upd = fn => setGroups(g => { const n = g.map(v => ({ ...v, items: [...v.items] })); fn(n); return n; });
  // Press, hold and drag (user 2026-11-13, like Auto Buy's account order): a page onto another
  // page (also in another list) or onto a list's empty end; a list by its handle onto another list.
  const [drag, setDrag] = useState(null);   // { kind: 'item', id } | { kind: 'group', gid }
  const [over, setOver] = useState(null);   // 'i:<id>' | 'g:<gid>' | 'end:<gid>'
  const dropItem = (id, gid, beforeId = null) => upd(n => {
    const from = n.find(g => g.items.includes(id)); if (!from) return;
    from.items.splice(from.items.indexOf(id), 1);
    const to = n.find(g => g.id === gid); if (!to) return;
    const at = beforeId ? to.items.indexOf(beforeId) : -1;
    if (at < 0) to.items.push(id); else to.items.splice(at, 0, id);
  });
  const dropGroup = (gid, beforeGid) => upd(n => { const i = n.findIndex(g => g.id === gid); const [g] = n.splice(i, 1); const j = n.findIndex(v => v.id === beforeGid); n.splice(j < 0 ? n.length : j, 0, g); });
  const end = () => { setDrag(null); setOver(null); };
  const dragProps = (data, key, onDrop) => ({
    draggable: true,
    onDragStart: e => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', key); } catch {} setDrag(data); },
    onDragOver: e => { if (!drag) return; e.preventDefault(); e.stopPropagation(); if (over !== key) setOver(key); },
    onDrop: e => { e.preventDefault(); e.stopPropagation(); if (drag) onDrop(drag); end(); },
    onDragEnd: end
  });
  const removeGroup = gi => upd(n => { if (n.length < 2) return; const [g] = n.splice(gi, 1); n[0].items.push(...g.items); });
  const save = async layout => { try { await api.settings.update({ navLayout: layout }); toast(layout ? x.saved : x.resetDone, 'success'); } catch (e) { toast(e.message, 'error'); } };
  return <div className="panel setting-card nav-editor">
    <b>{x.navTitle}</b><span className="muted-text">{x.navHint}</span>
    <div className="nav-groups">{groups.map((g, gi) => <div key={g.id} className={`nav-group-edit ${drag?.kind === 'group' && over === 'g:' + g.id && drag.gid !== g.id ? 'drop-here' : ''} ${drag?.kind === 'group' && drag.gid === g.id ? 'dragging' : ''}`}
      onDragOver={e => { if (!drag) return; e.preventDefault(); const k = (drag.kind === 'group' ? 'g:' : 'end:') + g.id; if (over !== k) setOver(k); }}
      onDrop={e => { e.preventDefault(); if (drag?.kind === 'group') dropGroup(drag.gid, g.id); else if (drag?.kind === 'item') dropItem(drag.id, g.id); end(); }}>
      <div className="nav-group-head">
        <span className="nav-grip" title={x.dragGroup} {...dragProps({ kind: 'group', gid: g.id }, 'g:' + g.id, d => (d.kind === 'group' ? dropGroup(d.gid, g.id) : dropItem(d.id, g.id, g.items[0] || null)))}>⋮⋮</span>
        <input value={g.name} placeholder={x.noTitle} aria-label={x.groupName} onChange={e => upd(n => { n[gi].name = e.target.value; })} />
        <button className="icon-btn danger" title={`${x.removeGroup} · ${x.removeHint}`} disabled={groups.length < 2} onClick={() => removeGroup(gi)}>×</button>
      </div>
      {g.items.map(id => <div key={id} title={x.dragItem} className={`nav-item-edit ${drag?.kind === 'item' && drag.id === id ? 'dragging' : ''} ${drag?.kind === 'item' && over === 'i:' + id && drag.id !== id ? 'drop-here' : ''}`}
        {...dragProps({ kind: 'item', id }, 'i:' + id, d => (d.kind === 'item' ? dropItem(d.id, g.id, id) : dropGroup(d.gid, g.id)))}>
        <span>{label(id)}</span><span className="nav-grip" aria-hidden="true">⋮⋮</span>
      </div>)}
      {!g.items.length && <div className={`nav-empty ${over === 'end:' + g.id ? 'drop-here' : ''}`}>{x.emptyList}</div>}
    </div>)}</div>
    <div className="nav-editor-actions">
      <button className="btn ghost" onClick={() => setGroups(g => [...g, { id: Math.random().toString(36).slice(2), name: x.newGroup, items: [] }])}>+ {x.addGroup}</button>
      <button className="btn ghost" onClick={() => { setGroups(normalizeLayout(null, t)); save(null); }}>{x.reset}</button>
      <button className="btn primary" onClick={() => save(groups)}>{x.save}</button>
    </div>
  </div>;
}

export function FactoryReset({ t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const [keep, setKeep] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await api.app.factoryReset({ keepPasswords: keep }); } catch (e) { setBusy(false); toast(e.message, 'error'); } };
  return <div className="panel setting-card factory-card">
    <b>{x.factoryTitle}</b><span className="muted-text">{x.factoryHint}</span>
    <label className="factory-keep"><input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /><span>{x.keepPasswords}</span></label>
    <small className="muted-text">{x.keepHint}</small>
    {!confirm ? <button className="btn danger-soft" onClick={() => setConfirm(true)}>{x.factoryButton}</button>
      : <div className="factory-confirm"><b>{x.factoryConfirm}</b><div><button className="btn ghost" disabled={busy} onClick={() => setConfirm(false)}>{x.cancel}</button><button className="btn danger" disabled={busy} onClick={go}>{busy ? x.resetting : x.confirm}</button></div></div>}
  </div>;
}

const BEHAVIOR = {
  tr: { title: 'Uygulama davranışı', tray: 'Pencere kapatılınca sistem tepsisinde çalışmaya devam et', trayHint: 'Çarpıya basınca uygulama kapanmaz; saat yanındaki DT simgesinden açılır. Tamamen kapatmak için simgeye sağ tıklayıp Çıkış.', login: 'Windows açılınca DreamTeam Manager\'ı başlat', loginHint: 'Yalnızca uygulama açılır; hiçbir servis kendiliğinden başlamaz.' },
  en: { title: 'App behaviour', tray: 'Keep running in the system tray when the window is closed', trayHint: 'The close button does not quit; open it again from the DT icon next to the clock. Right-click the icon → Quit to exit.', login: 'Start DreamTeam Manager with Windows', loginHint: 'Only the app opens; no service starts by itself.' },
  get fil() { return filOf(this.en); }
};
export function AppBehavior({ state, t }) {
  const x = BEHAVIOR[t.lang] || BEHAVIOR.en;
  const s = state.settings || {};
  const set = patch => api.settings.update(patch).catch(() => {});
  return <div className="panel setting-card behavior-card">
    <b>{x.title}</b>
    <label className="behavior-row"><input type="checkbox" checked={Boolean(s.closeToTray)} onChange={e => set({ closeToTray: e.target.checked })} /><span><b>{x.tray}</b><small>{x.trayHint}</small></span></label>
    <label className="behavior-row"><input type="checkbox" checked={Boolean(s.openAtLogin)} onChange={e => set({ openAtLogin: e.target.checked })} /><span><b>{x.login}</b><small>{x.loginHint}</small></span></label>
  </div>;
}

// Veri temizliği (user 2026-11-21): how old the browser caches / old logs may get before the daily
// cleanup removes them, and a button to clean now. Passwords, settings and the license are never touched.
const CLEAN = {
  tr: { title: 'Veri temizliği', hint: 'Her gün tarayıcı önbellekleri, silinmiş hesapların tarayıcı profilleri ve eski kayıtlar silinir. Şifreler, hesaplar, ayarlar, kartlar, roller ve lisans asla silinmez; hesapların tarayıcı girişleri de korunur.', days: 'Şundan eskileri sil', d15: '15 gün', d30: '30 gün', off: 'Kapalı (kayıtlar 30 gün tutulur)', run: 'Şimdi temizle', running: 'Temizleniyor…', last: 'Son temizlik: {at} · {mb} MB yer açıldı', never: 'Henüz temizlik yapılmadı.', done: '{mb} MB yer açıldı' },
  en: { title: 'Data cleanup', hint: 'Every day the browser caches, the browser profiles of removed accounts and old logs are deleted. Passwords, accounts, settings, cards, roles and the license are never deleted; the accounts stay signed in in their browsers.', days: 'Delete what is older than', d15: '15 days', d30: '30 days', off: 'Off (logs are kept 30 days)', run: 'Clean now', running: 'Cleaning…', last: 'Last cleanup: {at} · {mb} MB freed', never: 'No cleanup yet.', done: '{mb} MB freed' },
  get fil() { return filOf(this.en); }
};
export function DataCleanupCard({ state, t, toast }) {
  const x = CLEAN[t.lang] || CLEAN.en;
  const dc = state.dataCleanup || {};
  const days = dc.days ?? 15;
  const last = dc.last;
  const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
  const mbOf = b => Math.round((Number(b) || 0) / 1048576);
  const setDays = v => api.dataCleanup.setDays(Number(v)).catch(e => toast(e.message, 'error'));
  const run = async () => { try { const r = await api.dataCleanup.run(); if (r) toast(fill(x.done, { mb: mbOf(r.freed) }), 'success'); } catch (e) { toast(e.message, 'error'); } };
  return <div className="panel setting-card behavior-card">
    <b>{x.title}</b>
    <span className="muted-text">{x.hint}</span>
    <label className="behavior-row"><span><b>{x.days}</b></span><select value={days} onChange={e => setDays(e.target.value)}><option value={15}>{x.d15}</option><option value={30}>{x.d30}</option><option value={0}>{x.off}</option></select></label>
    <div><button className="btn ghost" disabled={dc.running} onClick={run}>{dc.running ? x.running : x.run}</button></div>
    <small className="muted-text">{last ? fill(x.last, { at: new Date(last.at).toLocaleString(), mb: mbOf(last.freed) }) : x.never}</small>
  </div>;
}
