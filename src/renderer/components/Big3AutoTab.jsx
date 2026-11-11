import { useEffect, useMemo, useState } from 'react';
import { filOf } from '../i18n-fil';
import SortTable from './SortTable';

// Office → "Big 3 otomatik" (user 2026-11-09): scan the accounts, set up their Big 3 (league trio /
// existing Super Big 3 / a new Super Big 3 of the best three starters), and the training that
// runs by itself (3 free a day, level 10 at most) with the bonus choice per account.
const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

const TEXT = {
  tr: {
    autoTitle: 'Antrenmanları otomatik yap', autoHint: 'Uygulama açıkken çalışır (Daily Reward gibi, Auto Play gerekmez, başka işi durdurmaz). Aktif Big 3 / Super Big 3\'ü olan her hesapta antrenman süresi bitince alır, bonus puanını verir ve günün ücretsiz hakkı varsa yenisini başlatır. 10. seviyede durur. Haklar bitince 19:10 sıfırlanmasını bekler.',
    scan: 'Takımları tara', scanning: 'Taranıyor… {done}/{total}', setup: 'Aktifleştir ({n})', setting: 'Aktifleştiriliyor…', selectAll: 'Tümünü seç', clear: 'Seçimi kaldır',
    account: 'Hesap', magic: 'Magic üçlüsü', super: 'Super Big 3', plan: 'Plan', active: 'Aktif', level: 'Seviye', attempts: 'Hak', training: 'Antrenman', bonus: 'Bonus', status: 'Durum',
    plans: { big3: 'Big 3 aktifleştir · {team}', superKeep: 'Mevcut Super Big 3 aktifleştir', superCreate: 'Super Big 3 kur: {players}', none: 'Uygun kadro yok', error: 'Okunamadı' },
    hm: '{h} sa {m} dk', mOnly: '{m} dk', done: 'Hazır', none: '—', notScanned: 'Taranmadı', offense: 'Atak', defense: 'Defans', left: '{t} kaldı', points: '{n} puan',
    st: { training: 'Antrenmanda', max: 'Seviye 10 · antrenman yok', noAttempts: 'Bugünkü haklar bitti', inactive: 'Big 3 aktif değil', error: 'Hata', working: 'Çalışıyor' },
    scanHint: 'Tarama oturum açmadan okur. Aktifleştir yalnızca seçili ve henüz hazır olmayan hesaplara uygulanır.',
    how: [
      'Tara: hesabın bir lig üçlüsü (Magic Team için uygun Big 3) varsa o aktifleştirilir. Yoksa Super Big 3\'ü varsa olduğu gibi kullanılır; en iyi üç oyuncusu seçili olmasa bile bozulmaz. Super Big 3\'ü olmayan hesapta ilk 5\'in en iyi 3 oyuncusuyla (atak + defans) Super Big 3 kurulur ve aktifleştirilir.',
      'Antrenman günde 3 kez ücretsiz, her biri 3 saat. Yoğun antrenman ve erken bitirme bilet istediği için hiç kullanılmaz. 10. seviyeden sonra antrenman denenmez (15\'e antrenmanla çıkılmaz).',
      'Her seviye 1 bonus puanı verir (%1 atak ya da defans). Varsayılan atak; hesap başına seçebilirsin. Seçimi değiştirince verilmiş puanlar ücretsiz sıfırlanıp yeni seçime aktarılır.'
    ]
  },
  en: {
    autoTitle: 'Train automatically', autoHint: 'Runs while the app is open (like Daily Reward: no Auto Play needed, nothing else is paused). On every account with an active Big 3 / Super Big 3 it claims a training when its time is over, puts the bonus point and starts the next one when a free attempt is left. It stops at level 10. With no attempts left it waits for the 19:10 reset.',
    scan: 'Scan teams', scanning: 'Scanning… {done}/{total}', setup: 'Activate ({n})', setting: 'Activating…', selectAll: 'Select all', clear: 'Clear selection',
    account: 'Account', magic: 'Magic trio', super: 'Super Big 3', plan: 'Plan', active: 'Active', level: 'Level', attempts: 'Attempts', training: 'Training', bonus: 'Bonus', status: 'Status',
    plans: { big3: 'Activate Big 3 · {team}', superKeep: 'Activate the existing Super Big 3', superCreate: 'Build Super Big 3: {players}', none: 'No suitable lineup', error: 'Could not be read' },
    hm: '{h} h {m} min', mOnly: '{m} min', done: 'Ready', none: '—', notScanned: 'Not scanned', offense: 'Offense', defense: 'Defense', left: '{t} left', points: '{n} points',
    st: { training: 'Training', max: 'Level 10 · no training', noAttempts: "Today's attempts used", inactive: 'No Big 3 active', error: 'Error', working: 'Working' },
    scanHint: 'The scan reads without signing in. Activate is applied only to the selected accounts that are not ready yet.',
    how: [
      'Scan: an account that owns a league trio (a Big 3 fit for the Magic Team) gets that one activated. Otherwise its Super Big 3 is used as it is, even when it is not its best three. An account without one gets a Super Big 3 of the 3 best starters (offense + defense), activated.',
      'Training is free 3 times a day, 3 h each. Intensive training and early finish cost tickets, so they are never used. From level 10 no training is tried (15 is not reached by training).',
      'Every level gives 1 bonus point (+1% offense or defense). Offense by default; choose per account. Changing the choice resets the given points (free) and moves them to the new choice.'
    ]
  },
  get fil() { return filOf(this.en); }
};

function leftOf(end, x) {
  const ms = Date.parse(end || '') - Date.now();
  if (!(ms > 0)) return null;
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return fill(x.left, { t: h ? fill(x.hm, { h, m }) : fill(x.mOnly, { m }) });
}

export default function Big3AutoTab({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const b = state.big3 || { enabled: true, accounts: {}, scan: { rows: {} }, bonus: {} };
  const accounts = state.accounts || [];
  const rows = b.scan?.rows || {};
  const [sel, setSel] = useState(() => new Set());
  const [, setNow] = useState(0);
  useEffect(() => { const iv = setInterval(() => setNow(n => n + 1), 30000); return () => clearInterval(iv); }, []);
  const ready = id => rows[id] && !rows[id].done && ['big3', 'superKeep', 'superCreate'].includes(rows[id].plan);
  const actionable = useMemo(() => accounts.filter(a => ready(a.id)).map(a => a.id), [accounts, rows]);
  const picked = actionable.filter(id => sel.has(id));
  const allOn = actionable.length > 0 && actionable.every(id => sel.has(id));
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const act = async fn => { try { await fn(); } catch (e) { toast(e.message, 'error'); } };
  const planText = r => {
    if (!r) return <span className="muted-text">{x.notScanned}</span>;
    if (r.done) return <span className="good-text">{x.done}</span>;
    const txt = fill(x.plans[r.plan] || r.plan, { team: r.trio?.team || '', players: (r.best || []).map(p => p.name).join(', ') });
    return <span className={r.plan === 'error' || r.status === 'error' ? 'bad-text' : r.plan === 'none' ? 'muted-text' : ''} title={r.error || ''}>{txt}{r.status === 'working' ? ' …' : ''}{r.status === 'error' ? ` · ${r.error}` : ''}</span>;
  };
  return <>
    <div className="panel pg-bar">
      <label className="switchline"><input type="checkbox" checked={b.enabled !== false} onChange={e => act(() => api.big3.enable(e.target.checked))} /><b>{x.autoTitle}</b></label>
      <span className="pg-hint">{x.autoHint}</span>
    </div>
    <div className="panel pg-bar">
      <button className="btn" disabled={b.scan?.busy} onClick={() => act(() => api.big3.scan(accounts.map(a => a.id)))}>{b.scan?.busy ? fill(x.scanning, { done: b.scan.done || 0, total: b.scan.total || 0 }) : x.scan}</button>
      <button className="chip" disabled={!actionable.length} onClick={() => setSel(allOn ? new Set() : new Set(actionable))}>{allOn ? x.clear : x.selectAll}</button>
      <span className="pg-hint">{x.scanHint}</span>
      <span className="sp" />
      <button className="btn primary" disabled={b.setupBusy || !picked.length} onClick={() => act(() => api.big3.setup(picked))}>{b.setupBusy ? x.setting : fill(x.setup, { n: picked.length })}</button>
    </div>
    <div className="panel table-panel dp-table"><SortTable>
      <thead><tr><th className="select-col"><input type="checkbox" checked={allOn} disabled={!actionable.length} onChange={() => setSel(allOn ? new Set() : new Set(actionable))} aria-label={x.selectAll} /></th><th>{x.account}</th><th>{x.magic}</th><th>{x.super}</th><th>{x.plan}</th><th>{x.active}</th><th>{x.level}</th><th>{x.attempts}</th><th>{x.training}</th><th>{x.bonus}</th><th>{x.status}</th></tr></thead>
      <tbody>{accounts.map(a => {
        const r = rows[a.id];
        const s = b.accounts?.[a.id] || {};
        const type = s.type ?? r?.type;
        const end = leftOf(s.trainingEnd, x);
        return <tr key={a.id} className={sel.has(a.id) ? 'selected-row-soft' : ''}>
          <td className="select-col"><input type="checkbox" disabled={!ready(a.id)} checked={sel.has(a.id)} onChange={() => toggle(a.id)} aria-label={a.name} /></td>
          <td><b>{a.name}</b></td>
          <td>{r?.trio ? `${r.trio.team} · Lv ${r.trio.level}` : r ? x.none : ''}</td>
          <td>{r?.superBig3 ? `${r.superBig3.players.join(', ')} · Lv ${r.superBig3.level}` : r ? x.none : ''}</td>
          <td>{planText(r)}</td>
          <td>{type === 'BIG3' ? 'Big 3' : type === 'SUPERBIG3' ? 'Super' : x.none}</td>
          <td className="num">{s.level != null ? `${s.level}/${b.maxLevel || 10}` : '—'}{s.points ? <small className="muted-text"> · {fill(x.points, { n: s.points })}</small> : null}</td>
          <td className="num">{s.attemptsLeft != null && s.type ? `${s.attemptsLeft}/3` : '—'}</td>
          <td>{end || (s.type ? x.none : '')}</td>
          <td><select value={b.bonus?.[a.id] || 'offense'} onChange={e => act(() => api.big3.bonus(a.id, e.target.value))}><option value="offense">{x.offense}{s.offense ? ` · ${s.offense}%` : ''}</option><option value="defense">{x.defense}{s.defense ? ` · ${s.defense}%` : ''}</option></select></td>
          <td className={s.status === 'error' ? 'bad-text' : s.status === 'training' ? 'good-text' : ''} title={s.message || ''}>{(b.working || []).includes(a.id) ? x.st.working : x.st[s.status] || ''}</td>
        </tr>;
      })}</tbody>
    </SortTable></div>
    <details className="panel pvp-how"><summary>{t.lang === 'tr' ? 'Nasıl çalışır?' : 'How does it work?'}</summary><ul>{x.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}
