import { useEffect, useMemo, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import RatingBadge from './RatingBadge';

// Çanta → Anestezi (user 2026-11-18): the injured players of every roster, Anesthesia on the ticked
// ones (every account at once), the bench swap, and the automatic fixes of the injury guard.
const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

const TEXT = {
  tr: {
    scan: 'Kadroları oku', scanning: 'Okunuyor…', readAt: 'Okundu: {time}',
    autoSwap: 'Sakat ilk beş oyuncuyu sağlam yedekle otomatik değiştir', autoSwapHint: 'Bir maç sakatlık yüzünden başlamazsa ilk beşteki sakat oyuncu yedekteki sağlam bir oyuncuyla (aynı mevkiyi oynayabilen önce) değiştirilir; iyileşince yerine geri konur.',
    autoHeal: 'Anesteziyi otomatik kullan', autoHealHint: 'Seçili hesaplarda maç sakatlık yüzünden başlamazsa ilk beşteki sakat oyuncuya Anestezi kullanılır (yedekle değiştirmeden önce).', accountsN: '{n} hesap', pick: 'Hesapları seç',
    pickTitle: 'Anestezi hangi hesaplarda otomatik kullanılsın?', search: 'Hesap ara…', selectAll: 'Tümünü seç', none: 'Hiçbiri', save: 'Kaydet', cancel: 'Vazgeç',
    waiting: 'Sakatlık yüzünden bekleyen hesaplar', waitingRow: '{acc} · {names} · {source}',
    account: 'Hesap', player: 'Oyuncu', role: 'Yer', starter: 'İlk beş', bench: 'Yedek', status: 'Durum', anes: 'Anestezi',
    injured: 'Sakat', healed: 'İyileştirildi · {until}', healedNoTime: 'İyileştirildi', noItem: 'Anestezi yok',
    qty: 'Oyuncu başına adet', healSel: 'Seçililere Anestezi kullan ({n})', swapSel: 'Seçili hesaplarda yedekle değiştir ({n})', selAll: 'Tümünü seç', clearSel: 'Seçimi kaldır', onlyStarters: 'Sadece ilk beş',
    healAsk: '{n} oyuncuya oyuncu başına {q} Anestezi kullanılacak ({a} hesap). Devam edilsin mi?', yes: 'Evet, kullan',
    healedOk: '{n} oyuncu iyileştirildi', healFail: '{n} oyuncu iyileştirilemedi', swapOk: '{n} hesapta yedekle değiştirildi', swapNone: '{n} hesapta sağlam yedek yok',
    empty: 'Okunan kadrolarda sakat oyuncu yok.', notRead: 'Kadrolar henüz okunmadı.',
    view: 'Sakat hesapları sırayla aç ({n})', viewHint: 'Hesaplar görünür tarayıcıda, kayıtlı şifreyle açılır; bir pencereyi kapatınca sıradaki açılır. Açık hesabın diğer işleri (Auto Play vb.) pencere kapanana kadar bekler. Satır seçtiysen o hesaplar, seçmediysen ilk beşinde sakat oyuncu olan hesaplar açılır.', atOnce: 'Aynı anda', viewStop: 'Durdur', viewOpen: 'Açık: {list}', viewQueue: 'Sırada {n} hesap', opening: 'açılıyor', open: 'açık', viewError: 'açılamadı',
    how: [
      'Oyunda ilk beşte iyileştirilmemiş sakat oyuncu varken hiçbir maç başlamıyor (Auto Play, Dostluk Maçı, Go-up, PVP, Elite Ascent, Daily Boss, Kule…).',
      'Uygulama artık bunu tanıyor: hata bir kez kaydedilir, o hesap maçları bekletir (her birkaç saniyede bir yeniden denemez). Önce otomatik çözüm denenir: sakat oyuncu sağlam bir yedekle değiştirilir (açıksa) ya da seçili hesaplarda Anestezi kullanılır. Çözülemezse hesap burada "bekleyen" olarak görünür; birkaç dakikada bir tekrar bakılır, sakatlık geçince ya da iyileştirince maçlar kendiliğinden devam eder.',
      'Elle: sakat oyuncuları seç (Tümünü seç / Sadece ilk beş), "Seçililere Anestezi kullan" seçili hesapların hepsinde aynı anda kullanır. Hesapta Anestezi yoksa satırda "Anestezi yok" yazar ve seçilemez. Anestezi iyileştirmesi geçicidir; süresi bitince oyuncu yine sakat sayılır.',
      'Yedekle değiştirilen oyuncu iyileşince ilk beşe geri konur (bu arada kadro başka şekilde değiştiyse dokunulmaz).'
    ]
  },
  en: {
    scan: 'Read rosters', scanning: 'Reading…', readAt: 'Read: {time}',
    autoSwap: 'Swap an injured starter for a healthy bench player automatically', autoSwapHint: 'When a match does not start because of an injury, the injured starter is swapped for a healthy bench player (one who plays that position first); it goes back once healthy.',
    autoHeal: 'Use Anesthesia automatically', autoHealHint: 'On the chosen accounts, when a match does not start because of an injury, Anesthesia is used on the injured starter (before swapping).', accountsN: '{n} account(s)', pick: 'Choose accounts',
    pickTitle: 'On which accounts is Anesthesia used automatically?', search: 'Search accounts…', selectAll: 'Select all', none: 'None', save: 'Save', cancel: 'Cancel',
    waiting: 'Accounts waiting because of an injury', waitingRow: '{acc} · {names} · {source}',
    account: 'Account', player: 'Player', role: 'Place', starter: 'Starter', bench: 'Bench', status: 'Status', anes: 'Anesthesia',
    injured: 'Injured', healed: 'Healed · {until}', healedNoTime: 'Healed', noItem: 'No Anesthesia',
    qty: 'Per player', healSel: 'Use Anesthesia on selected ({n})', swapSel: 'Swap with bench on selected accounts ({n})', selAll: 'Select all', clearSel: 'Clear selection', onlyStarters: 'Starters only',
    healAsk: '{q} Anesthesia per player will be used on {n} player(s) ({a} account(s)). Go on?', yes: 'Yes, use',
    healedOk: '{n} player(s) healed', healFail: '{n} player(s) could not be healed', swapOk: 'Swapped with the bench on {n} account(s)', swapNone: 'No healthy bench player on {n} account(s)',
    empty: 'No injured player in the rosters read.', notRead: 'The rosters are not read yet.',
    view: 'Open injured accounts one by one ({n})', viewHint: 'The accounts open in a visible browser with the saved password; closing a window opens the next one. The open account\'s other jobs (Auto Play etc.) wait until its window is closed. With rows ticked those accounts open, otherwise the accounts with an injured starter.', atOnce: 'At once', viewStop: 'Stop', viewOpen: 'Open: {list}', viewQueue: '{n} account(s) waiting', opening: 'opening', open: 'open', viewError: 'could not open',
    how: [
      'The game starts no match while a starter is injured and not healed (Auto Play, Friendly Match, Go-up, PVP, Elite Ascent, Daily Boss, Tower…).',
      'The app now knows it: the refusal is logged once and that account holds its matches (no retry every few seconds). An automatic fix is tried first: the injured player is swapped for a healthy bench player (when on) or Anesthesia is used on the chosen accounts. When nothing works the account shows here as waiting; it is checked again every few minutes and the matches go on by themselves once the player is healed or healthy.',
      'By hand: tick the injured players (Select all / Starters only); "Use Anesthesia on selected" uses it on all those accounts at once. An account without Anesthesia shows "No Anesthesia" on the row and cannot be ticked. Anesthesia heals for a while; when it runs out the player counts as injured again.',
      'A player swapped to the bench goes back to the starting five once healthy (unless the lineup was changed otherwise meanwhile).'
    ]
  },
  get fil() { return filOf(this.en); }
};

export default function InjuryTab({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const inj = state.injuryGuard || { teams: {}, blocked: {}, settings: {}, busy: [] };
  const accounts = state.accounts || [];
  const accName = id => accounts.find(a => a.id === id)?.name || id;
  const st = inj.settings || {};
  const busy = new Set(inj.busy || []);
  const [sel, setSel] = useState(() => new Set());
  const [qty, setQty] = useState(1);
  const [ask, setAsk] = useState(null);
  const [picker, setPicker] = useState(null);
  const [pq, setPq] = useState('');
  useEffect(() => { if (api.injury && !Object.keys(inj.teams || {}).length && !inj.reading) api.injury.scan().catch(() => {}); }, []);
  const rows = useMemo(() => {
    const out = [];
    for (const [aid, team] of Object.entries(inj.teams || {})) for (const p of team.players || []) if (p.injured) out.push({ ...p, accountId: aid, anesthesia: team.anesthesia || 0, key: aid + ':' + p.id });
    return out.sort((a, b) => (b.hurt - a.hurt) || (b.starter - a.starter) || accName(a.accountId).localeCompare(accName(b.accountId)));
  }, [inj.teams, accounts]);
  const can = r => r.anesthesia > 0 && !busy.has(r.accountId);
  const picked = rows.filter(r => sel.has(r.key) && can(r));
  const pickedAcc = [...new Set(picked.map(r => r.accountId))];
  const allOn = rows.filter(can).length > 0 && rows.filter(can).every(r => sel.has(r.key));
  const toggle = k => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const heal = async () => {
    setAsk(null);
    try {
      const r = await api.injury.heal(picked.map(p => ({ accountId: p.accountId, playerId: p.id })), Number(qty) || 1);
      const res = Object.values(r?.results || {}).flat();
      const ok = res.filter(v => v.ok).length, bad = res.length - ok;
      if (ok) toast(fill(x.healedOk, { n: ok }), 'success');
      if (bad) toast(fill(x.healFail, { n: bad }) + (res.find(v => !v.ok)?.error ? ` · ${res.find(v => !v.ok).error}` : ''), 'error');
      setSel(new Set());
    } catch (e) { toast(e.message, 'error'); }
  };
  const swapAccs = [...new Set(rows.filter(r => sel.has(r.key) && r.hurt && r.starter).map(r => r.accountId))];
  const swap = async () => {
    try {
      const r = await api.injury.swap(swapAccs);
      const res = Object.values(r?.results || {});
      const ok = res.filter(v => v.ok).length;
      if (ok) toast(fill(x.swapOk, { n: ok }), 'success');
      if (res.length - ok) toast(fill(x.swapNone, { n: res.length - ok }) + (res.find(v => v.error)?.error ? ` · ${res.find(v => v.error).error}` : ''), 'error');
    } catch (e) { toast(e.message, 'error'); }
  };
  const set = patch => api.injury.settings(patch).catch(e => toast(e.message, 'error'));
  const viewer = state.injuryViewer || { open: [], queue: [], max: 3 };
  const [atOnce, setAtOnce] = useState(3);
  const viewIds = (() => {
    const ticked = [...new Set(rows.filter(r => sel.has(r.key)).map(r => r.accountId))];
    if (ticked.length) return ticked;
    return [...new Set([...rows.filter(r => r.hurt && r.starter).map(r => r.accountId), ...Object.keys(inj.blocked || {})])];
  })();
  const viewing = viewer.open.length > 0 || viewer.queue.length > 0;
  const blocked = Object.entries(inj.blocked || {});
  const readAt = Object.values(inj.teams || {}).map(v => v.readAt).filter(Boolean).sort().pop();

  return <>
    {ask && <div className="modal-backdrop" onClick={() => setAsk(null)}><div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
      <p>{fill(x.healAsk, { n: picked.length, q: qty, a: pickedAcc.length })}</p>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setAsk(null)}>{x.cancel}</button><button className="btn primary" autoFocus onClick={heal}>{x.yes}</button></div>
    </div></div>}
    {picker && <div className="modal-backdrop" onClick={() => setPicker(null)}><div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
      <h3>{x.pickTitle}</h3>
      <input className="ab-list-search" placeholder={x.search} value={pq} onChange={e => setPq(e.target.value)} />
      <div className="toolbar"><button className="chip" onClick={() => setPicker(new Set(accounts.map(a => a.id)))}>{x.selectAll}</button><button className="chip" onClick={() => setPicker(new Set())}>{x.none}</button></div>
      <div className="check-list" style={{ maxHeight: 320, overflow: 'auto', display: 'grid', gap: 4 }}>{accounts.filter(a => !pq || a.name.toLowerCase().includes(pq.toLowerCase())).map(a => <label key={a.id} className="check-row"><input type="checkbox" checked={picker.has(a.id)} onChange={() => setPicker(s => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} />{a.name}{inj.teams?.[a.id] ? <small className="muted-text"> · {inj.teams[a.id].anesthesia || 0}</small> : null}</label>)}</div>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setPicker(null)}>{x.cancel}</button><button className="btn primary" onClick={() => { const ids = [...picker]; set({ autoHeal: ids.length > 0, healAccounts: ids }); setPicker(null); }}>{x.save}</button></div>
    </div></div>}

    <div className="panel hunter-refresh">
      <label className="hunter-opt" title={x.autoSwapHint}><input type="checkbox" checked={st.autoSwap !== false} onChange={e => set({ autoSwap: e.target.checked })} />{x.autoSwap}</label>
      <label className="hunter-opt" title={x.autoHealHint}><input type="checkbox" checked={Boolean(st.autoHeal)} onChange={e => { if (e.target.checked) { setPq(''); setPicker(new Set(st.healAccounts || [])); } else set({ autoHeal: false }); }} />{x.autoHeal}{st.autoHeal && <> · <button className="btn ghost small" onClick={() => { setPq(''); setPicker(new Set(st.healAccounts || [])); }}>{fill(x.accountsN, { n: (st.healAccounts || []).length })}</button></>}</label>
    </div>

    {blocked.length > 0 && <div className="panel"><b>{x.waiting}</b><ul className="fire-list">{blocked.map(([id, b]) => <li key={id}>{fill(x.waitingRow, { acc: accName(id), names: (b.names || []).join(', '), source: b.source || '' })}</li>)}</ul></div>}

    <div className="panel pg-bar" title={x.viewHint}>
      <label className="check-row">{x.atOnce} <select value={atOnce} onChange={e => setAtOnce(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <button className="btn primary" disabled={!viewIds.length} onClick={() => api.injury.viewStart(viewIds, atOnce).catch(e => toast(e.message, 'error'))}>{fill(x.view, { n: viewIds.length })}</button>
      {viewing && <button className="btn ghost" onClick={() => api.injury.viewStop().catch(e => toast(e.message, 'error'))}>{x.viewStop}</button>}
      {viewer.open.length > 0 && <span className="muted-text">{fill(x.viewOpen, { list: viewer.open.map(o => `${o.name} (${o.status === 'error' ? x.viewError : o.status === 'open' ? x.open : x.opening})`).join(', ') })}</span>}
      {viewer.queue.length > 0 && <span className="muted-text">{fill(x.viewQueue, { n: viewer.queue.length })}</span>}
    </div>
    <div className="panel pg-bar">
      <button className="btn ghost" disabled={inj.reading} onClick={() => api.injury.scan().catch(e => toast(e.message, 'error'))}>{inj.reading ? x.scanning : x.scan}</button>
      {readAt && <span className="muted-text">{fill(x.readAt, { time: new Date(readAt).toLocaleTimeString() })}</span>}
      <button className="chip" onClick={() => setSel(allOn ? new Set() : new Set(rows.filter(can).map(r => r.key)))}>{allOn ? x.clearSel : x.selAll}</button>
      <button className="chip" onClick={() => setSel(new Set(rows.filter(r => can(r) && r.starter && r.hurt).map(r => r.key)))}>{x.onlyStarters}</button>
      <span className="sp" />
      <label className="check-row">{x.qty} <input className="eq-small" type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} /></label>
      <button className="btn ghost" disabled={!swapAccs.length} onClick={swap}>{fill(x.swapSel, { n: swapAccs.length })}</button>
      <button className="btn primary" disabled={!picked.length} onClick={() => setAsk(true)}>{fill(x.healSel, { n: picked.length })}</button>
    </div>
    <div className="panel table-panel">{!Object.keys(inj.teams || {}).length ? <p className="muted-text">{x.notRead}</p> : !rows.length ? <p className="muted-text">{x.empty}</p> : <SortTable>
      <thead><tr><th className="select-col" /><th>{x.account}</th><th>{x.player}</th><th>{x.role}</th><th>{x.status}</th><th>{x.anes}</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.key} className={sel.has(r.key) ? 'selected-row-soft' : ''}>
        <td className="select-col"><input type="checkbox" disabled={!can(r)} checked={sel.has(r.key)} onChange={() => toggle(r.key)} aria-label={r.name} /></td>
        <td><b>{accName(r.accountId)}</b>{inj.blocked?.[r.accountId] && <span className="pill bad"><i />⏸</span>}</td>
        <td><b>{r.name}</b> <span className="muted-text">{r.position}</span> <RatingBadge grade={r.rating} mini /></td>
        <td>{r.starter ? <span className="pill warn"><i />{x.starter}</span> : <span className="muted-text">{x.bench}</span>}</td>
        <td>{r.hurt ? <span className="pill bad"><i />{x.injured}</span> : <span className="pill ok"><i />{r.healedUntil ? fill(x.healed, { until: new Date(r.healedUntil).toLocaleString() }) : x.healedNoTime}</span>}</td>
        <td className="num">{r.anesthesia > 0 ? r.anesthesia : <span className="bad-text">{x.noItem}</span>}</td>
      </tr>)}</tbody>
    </SortTable>}</div>
    <details className="panel pvp-how"><summary>{t.lang === 'tr' ? 'Nasıl çalışır?' : 'How does it work?'}</summary><ul>{x.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}
