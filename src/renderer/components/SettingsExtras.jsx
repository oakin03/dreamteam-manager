import { useEffect, useState } from 'react';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;

// Sidebar pages: id → [icon, label key in the app texts].
// When a new service is added, add it here AND to NAV_DEFAULT: a saved layout that
// does not know the page yet gets it in its default list automatically.
export const PAGE_META = {
  home: ['home', 'commandCenter'], accounts: ['accounts', 'accounts'], social: ['chat', 'socialPage'],
  autoplay: ['play', 'autoplay'], autotrade: ['swap', 'autoTrade'], pvp: ['sword', 'pvpPage'], daily: ['calendar', 'dailyPage'], tower: ['tower', 'towerPage'], autobuy: ['cart', 'autoBuyPage'], tournament: ['trophy', 'tournament'],
  scout: ['scout', 'scout'], players: ['chart', 'playersPage'], draft: ['target', 'draftPage'], cards: ['cards', 'cards'], equipment: ['shirt', 'equipment'],
  market: ['market', 'market'], trade: ['hall', 'trade'],
  activity: ['activity', 'activity'], guide: ['book', 'guide'], settings: ['settings', 'settings']
};
// The default lists (a null heading = no title). nameKey is translated; a saved
// layout stores the user's own names.
export const NAV_DEFAULT = [
  { id: 'top', nameKey: null, items: ['home', 'accounts', 'social'] },
  { id: 'automation', nameKey: 'navAutomation', items: ['autoplay', 'autotrade', 'pvp', 'tower', 'daily', 'autobuy', 'tournament'] },
  { id: 'players', nameKey: 'navPlayers', items: ['scout', 'players', 'draft', 'cards', 'equipment'] },
  { id: 'market', nameKey: 'navMarket', items: ['market', 'trade'] },
  { id: 'app', nameKey: 'navApp', items: ['activity', 'guide', 'settings'] }
];

const defaultLayout = t => NAV_DEFAULT.map(g => ({ id: g.id, name: g.nameKey ? t[g.nameKey] : '', items: [...g.items] }));

// Saved layout (or the default) cleaned up: unknown pages dropped, duplicates removed,
// pages missing from it (new services) added to their default list.
export function normalizeLayout(saved, t) {
  const base = Array.isArray(saved) && saved.length ? saved : defaultLayout(t);
  const seen = new Set();
  const groups = base.map(g => ({ id: g.id || Math.random().toString(36).slice(2), name: String(g.name ?? ''), items: (g.items || []).filter(id => PAGE_META[id] && !seen.has(id) && seen.add(id)) }));
  for (const def of NAV_DEFAULT) for (const id of def.items) {
    if (seen.has(id)) continue;
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
    navTitle: 'Menü düzeni', navHint: 'Sol menüdeki listelerin adlarını, sırasını ve hangi sayfanın hangi listede duracağını değiştir. Başlığı boş bırakılan liste başlıksız görünür.',
    groupName: 'Liste adı', noTitle: '(başlıksız)', moveTo: 'Taşı…', up: 'Yukarı', down: 'Aşağı', groupUp: 'Listeyi yukarı', groupDown: 'Listeyi aşağı', addGroup: 'Yeni liste', removeGroup: 'Listeyi sil', removeHint: 'Listedeki sayfalar ilk listeye taşınır', save: 'Kaydet', reset: 'Varsayılana dön', saved: 'Menü kaydedildi', resetDone: 'Menü varsayılana döndü', newGroup: 'Yeni liste',
    factoryTitle: 'Fabrika ayarları', factoryHint: 'Uygulamayı kurulduğu ilk haline döndürür: bütün ayarlar, kayıtlı veriler (kartlar, roller, oyuncular, raporlar…), zamanlanmış görevler, aktivite kayıtları ve oyun oturumları silinir. Uygulama ardından yeniden başlar.',
    factoryButton: 'Fabrika ayarlarına dön', factoryConfirm: 'Her şey silinecek ve uygulama yeniden başlayacak. Emin misin?', keepPasswords: 'Kayıtlı şifreleri koru', keepHint: 'İşaretliyse hesaplar ve kayıtlı giriş bilgileri (Trading Hall ve Player Market hesabı dahil) silinmez; işaretli değilse onlar da silinir.', cancel: 'Vazgeç', confirm: 'Evet, sıfırla', resetting: 'Sıfırlanıyor…'
  },
  en: {
    navTitle: 'Menu layout', navHint: 'Change the names and order of the sidebar lists and which page sits in which list. A list with an empty title shows without a heading.',
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
  const moveItem = (gi, ii, d) => upd(n => { const it = n[gi].items; const j = ii + d; if (j < 0 || j >= it.length) return; [it[ii], it[j]] = [it[j], it[ii]]; });
  const moveTo = (gi, ii, target) => upd(n => { const [id] = n[gi].items.splice(ii, 1); n[target].items.push(id); });
  const moveGroup = (gi, d) => upd(n => { const j = gi + d; if (j < 0 || j >= n.length) return; [n[gi], n[j]] = [n[j], n[gi]]; });
  const removeGroup = gi => upd(n => { if (n.length < 2) return; const [g] = n.splice(gi, 1); n[0].items.push(...g.items); });
  const save = async layout => { try { await api.settings.update({ navLayout: layout }); toast(layout ? x.saved : x.resetDone, 'success'); } catch (e) { toast(e.message, 'error'); } };
  return <div className="panel setting-card nav-editor">
    <b>{x.navTitle}</b><span className="muted-text">{x.navHint}</span>
    <div className="nav-groups">{groups.map((g, gi) => <div key={g.id} className="nav-group-edit">
      <div className="nav-group-head">
        <input value={g.name} placeholder={x.noTitle} aria-label={x.groupName} onChange={e => upd(n => { n[gi].name = e.target.value; })} />
        <button className="icon-btn" title={x.groupUp} disabled={gi === 0} onClick={() => moveGroup(gi, -1)}>↑</button>
        <button className="icon-btn" title={x.groupDown} disabled={gi === groups.length - 1} onClick={() => moveGroup(gi, 1)}>↓</button>
        <button className="icon-btn danger" title={`${x.removeGroup} · ${x.removeHint}`} disabled={groups.length < 2} onClick={() => removeGroup(gi)}>×</button>
      </div>
      {g.items.map((id, ii) => <div key={id} className="nav-item-edit">
        <span>{label(id)}</span>
        <button className="icon-btn" title={x.up} disabled={ii === 0} onClick={() => moveItem(gi, ii, -1)}>↑</button>
        <button className="icon-btn" title={x.down} disabled={ii === g.items.length - 1} onClick={() => moveItem(gi, ii, 1)}>↓</button>
        <select value="" onChange={e => e.target.value !== '' && moveTo(gi, ii, Number(e.target.value))}><option value="">{x.moveTo}</option>{groups.map((o, oi) => oi !== gi && <option key={o.id} value={oi}>{o.name || x.noTitle}</option>)}</select>
      </div>)}
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
