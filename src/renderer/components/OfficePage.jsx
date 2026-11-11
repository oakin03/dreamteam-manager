import { Fragment, useEffect, useState } from 'react';
import { filOf } from '../i18n-fil';
import SortTable from './SortTable';
import { useGroupedRows } from './AccountGroups';
import Big3AutoTab from './Big3AutoTab';

const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

const TEXT = {
  tr: {
    title: 'Ofis', subtitle: 'Koç ve Big Three · bilet hiçbir zaman harcanmaz',
    tabs: { coach: 'Koç', big3: 'Big Three', big3auto: 'Big 3 otomatik' },
    read: 'Durumu oku', reading: 'Okunuyor…', readHint: 'Hesapların koç, taktik ve Big3 bilgisi okunur. Oyun isterse hesaba kısa süreliğine bağlanılır.',
    account: 'Hesap', auto: 'Otomatik', autoShort: 'Oto', autoHint: 'İşaretli hesaplarda uygulama 10 dakikada bir bakar: biten antrenmanı alır, ücretsiz hak varsa yenisini başlatır.',
    run: 'Şimdi çalıştır', notRead: 'Okunmadı', busy: 'Çalışıyor…', left: '{t} kaldı', ready: 'Bitti · alınacak', none: '—', restart: 'Bu bölüm uygulama yeniden başlatılınca çalışır.',
    coach: {
      coach: 'Koç', none: 'Seçilmedi', offense: 'Hücum stratejisi', defense: 'Savunma stratejisi', cards: 'Master kart', today: 'Bugün', training: 'Antrenman',
      inspect: 'Koçları incele', hide: 'Kapat', current: 'Şu anki koç', select: 'Bu koçu seç', trainable: 'Antrenmana uygun', notTrainable: 'Antrenman yazmaz (SUPERFINE gerekir)', maxed: 'En üst seviye',
      firstFree: 'İlk koç ücretsiz. {name} seçilsin mi? Sonradan değiştirmek Change Coach Card ister.',
      change: '{name} seçilecek. Koçu değiştirmek 1 Change Coach Card harcar ve eğitimdeki stratejileri 4000 XP\'ye düşürür. Elinde {n} kart var. Devam edilsin mi?',
      tactics: 'Bu hesabın taktikleri', tOffense: 'Hücum taktikleri', tDefense: 'Savunma taktikleri', tName: 'Taktik', tLevel: 'Seviye', tXp: 'XP', tBoost: 'Uyum bonusu', tBeats: 'Yener', tLoses: 'Yenilir', tActive: 'Aktif', tNotLearned: 'öğrenilmedi',
      noTactics: 'Taktik ayrıntıları için "Durumu oku" (uygulama yeniden başlatıldıktan sonra).',
      how: ['Antrenman 3 saat sürer, 1 Strategy Master Card harcar ve koçun iki stratejisine +20 XP verir.', 'XP yalnızca SUPERFINE (4000 XP) ve üstü stratejilere yazılır; MASTER (6000) en üst seviye. Eğitilecek strateji yoksa kart harcanmaz.', 'Günde 2 ücretsiz hak var; sonrakiler bilet ister, uygulama onları hiç kullanmaz.', 'Koç yalnızca "Koçları incele" içindeki "Bu koçu seç" düğmesiyle ve onayınla seçilir.'],
      results: { started: 'Antrenman başladı', training: 'Antrenman sürüyor', noCoach: 'Önce koç seç', nothing: 'Eğitilecek strateji yok (SUPERFINE gerekir)', noCard: 'Master kart yok', noFree: 'Bugünkü ücretsiz haklar bitti' }
    },
    big3: {
      modes: { magic: 'Magic Team (lig üçlüsü)', super: 'Super Big 3 (kendi üçlün)' },
      team: 'Takım (üçlü)', level: 'Seviye', bonus: 'Bonus', points: '{n} puan', attempts: 'Hak', active: 'Aktif', training: 'Antrenman',
      activate: 'Aktifleştir', deactivate: 'Kapat', off: '+Hücum', def: '+Savunma', magicNote: 'Lv 15 sonrası: Günlük İşler → Big 3 (Magic Team) ödülü gerekir',
      trio: 'Üçlü', pickPlayers: 'Oyuncu seç', create: 'Super Big 3 oluştur', save: 'Kaydet', cancel: 'Vazgeç', choose3: '3 oyuncu seç ({n}/3)', loading: 'Kadro okunuyor…', notCreated: 'Oluşturulmadı',
      resetWarn: 'Super Big 3 üçlüsünü değiştirmek bütün ilerlemesini sıfırlar: seviye, XP, bonuslar ve süren antrenman. Devam edilsin mi?',
      how: ['Normal antrenman 3 saatte 300 beceri XP verir; her seviye 1000 XP. Günde 3 normal hak var (Big3 ve Super Big 3 ortak).', 'Yoğun antrenman ve antrenmanı erken bitirmek 50 bilet ister; uygulama bunları hiç kullanmaz.', 'Her yeni seviye 1 bonus puanı verir; +Hücum / +Savunma ile harcanır.', 'Aynı anda yalnızca biri aktif olur: Magic Team üçlüsü ya da Super Big 3. Magic Team maçları için üçlü 15. seviyede ve aktif olmalı.', 'Super Big 3 kadrondan seçtiğin 3 oyuncudan oluşur; üçlüyü değiştirmek ilerlemeyi sıfırlar (sorulur).'],
      results: { started: 'Antrenman başladı', training: 'Antrenman sürüyor', max: 'Bu seviyede antrenman yok', otherTraining: 'Başka bir üçlü antrenmanda', noAttempts: 'Bugünkü normal haklar bitti', noTeam: 'Önce takım seç / oluştur' }
    }
  },
  en: {
    title: 'Office', subtitle: 'Coach and Big Three · tickets are never spent',
    tabs: { coach: 'Coach', big3: 'Big Three', big3auto: 'Big 3 automatic' },
    read: 'Read status', reading: 'Reading…', readHint: 'Reads the coach, tactics and Big3 of the accounts. If the game asks for it, the account is signed in for a moment.',
    account: 'Account', auto: 'Automatic', autoShort: 'Auto', autoHint: 'On ticked accounts the app looks every 10 minutes: it claims a finished training and starts a new one when a free attempt is left.',
    run: 'Run now', notRead: 'Not read', busy: 'Working…', left: '{t} left', ready: 'Done · to claim', none: '—', restart: 'This part works after the app is restarted.',
    coach: {
      coach: 'Coach', none: 'None', offense: 'Offense strategy', defense: 'Defense strategy', cards: 'Master cards', today: 'Today', training: 'Training',
      inspect: 'Inspect coaches', hide: 'Close', current: 'Current coach', select: 'Choose this coach', trainable: 'Trainable', notTrainable: 'Gets no training XP (SUPERFINE needed)', maxed: 'Top level',
      firstFree: 'The first coach is free. Choose {name}? Changing later needs a Change Coach Card.',
      change: '{name} will be chosen. Changing the coach uses 1 Change Coach Card and drops the strategies in training back to 4000 XP. You have {n} card(s). Continue?',
      tactics: 'Tactics of this account', tOffense: 'Offense tactics', tDefense: 'Defense tactics', tName: 'Tactic', tLevel: 'Level', tXp: 'XP', tBoost: 'Match bonus', tBeats: 'Beats', tLoses: 'Loses to', tActive: 'Active', tNotLearned: 'not learned',
      noTactics: 'For the tactic details use "Read status" (after the app is restarted).',
      how: ['A training takes 3 hours, uses 1 Strategy Master Card and gives +20 XP to both strategies of the coach.', 'XP only goes to strategies at SUPERFINE (4000 XP) or above; MASTER (6000) is the top. With nothing to train no card is used.', 'There are 2 free attempts a day; the next ones cost tickets and the app never uses them.', 'A coach is only chosen with the "Choose this coach" button in "Inspect coaches", after you confirm.'],
      results: { started: 'Training started', training: 'Training in progress', noCoach: 'Choose a coach first', nothing: 'No strategy to train (SUPERFINE needed)', noCard: 'No Master Card', noFree: "Today's free attempts are used" }
    },
    big3: {
      modes: { magic: 'Magic Team (league trio)', super: 'Super Big 3 (your own trio)' },
      team: 'Team (trio)', level: 'Level', bonus: 'Bonus', points: '{n} point(s)', attempts: 'Attempts', active: 'Active', training: 'Training',
      activate: 'Activate', deactivate: 'Turn off', off: '+Offense', def: '+Defense', magicNote: 'After Lv 15: the Magic Team prize (Daily → Big 3) is needed',
      trio: 'Trio', pickPlayers: 'Choose players', create: 'Create Super Big 3', save: 'Save', cancel: 'Cancel', choose3: 'Choose 3 players ({n}/3)', loading: 'Reading the roster…', notCreated: 'Not created',
      resetWarn: 'Changing the Super Big 3 trio resets all of its progress: level, XP, bonuses and a running training. Continue?',
      how: ['A normal training gives 300 skill XP in 3 hours; a level is 1000 XP. There are 3 normal attempts a day (shared by Big3 and Super Big 3).', 'Intensive training and finishing early cost 50 tickets; the app never uses them.', 'Every new level gives 1 bonus point, spent with +Offense / +Defense.', 'Only one is active at a time: the Magic Team trio or the Super Big 3. Magic Team matches need the trio at level 15 and active.', 'The Super Big 3 is made of 3 players you choose from your roster; changing the trio resets its progress (asked first).'],
      results: { started: 'Training started', training: 'Training in progress', max: 'No training at this level', otherTraining: 'Another trio is training', noAttempts: "Today's normal attempts are used", noTeam: 'Choose / create a team first' }
    }
  },
  get fil() { return filOf(this.en); }
};

const leftText = (iso, x) => {
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return x.ready;
  const m = Math.ceil(ms / 60000);
  return fill(x.left, { t: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` });
};
const strat = s => s ? `${s.name} · ${s.level} ${Number(s.xp || 0).toLocaleString()}` : '—';
const pct = v => `${Math.round((Number(v) || 0) * 1000) / 10}%`;

// The 8 coaches with what they train on this account; a coach is chosen only with its button.
function CoachDetail({ a, info, x, busy, act }) {
  const c = info?.coach;
  if (!c) return <div className="muted-text">{x.notRead}</div>;
  const byId = {};
  for (const s of [...(info.strategies?.offense || []), ...(info.strategies?.defense || [])]) byId[s.id] = s;
  const stratLine = (label, s) => {
    const full = byId[s?.id] || {};
    return <div className="of-strat"><small>{label}</small><b>{s?.name || '—'}</b><span>{s?.level || '—'} · {Number(s?.xp || 0).toLocaleString()} XP{full.boost ? ` · ${pct(full.boost)}` : ''}</span>
      <em className={s?.maxed ? 'muted-text' : s?.trainable ? 'good-text' : 'muted-text'}>{s?.maxed ? x.coach.maxed : s?.trainable ? x.coach.trainable : x.coach.notTrainable}</em></div>;
  };
  const choose = k => {
    const msg = c.selectedCoachId ? fill(x.coach.change, { name: k.name, n: c.cards?.change ?? 0 }) : fill(x.coach.firstFree, { name: k.name });
    if (window.confirm(msg)) act(() => api.office.selectCoach(a.id, k.id));
  };
  const tactics = (list, title) => <div className="of-tactics"><b>{title}</b><table><thead><tr><th>{x.coach.tName}</th><th>{x.coach.tLevel}</th><th>{x.coach.tXp}</th><th>{x.coach.tBoost}</th><th>{x.coach.tBeats}</th><th>{x.coach.tLoses}</th></tr></thead>
    <tbody>{list.map(s => <tr key={s.id} className={s.active ? 'on' : s.learned ? '' : 'off'}><td>{s.active ? '● ' : ''}{s.name}{!s.learned && <small className="muted-text"> · {x.coach.tNotLearned}</small>}</td><td>{s.level}</td><td className="num">{s.xp.toLocaleString()}</td><td className="num">{pct(s.boost)}</td><td><small>{s.beats.join(', ')}</small></td><td><small>{s.losesTo.join(', ')}</small></td></tr>)}</tbody></table></div>;
  return <div className="of-detail">
    <div className="of-coaches">{c.coaches.map(k => <div key={k.id} className={`of-coach ${k.id === c.selectedCoachId ? 'current' : ''}`}>
      <div className="of-coach-head"><b>{k.name}</b>{k.id === c.selectedCoachId && <span className="pill ok"><i />{x.coach.current}</span>}</div>
      {k.description && <p>{k.description}</p>}
      {stratLine(x.coach.offense, k.offense)}{stratLine(x.coach.defense, k.defense)}
      {k.id !== c.selectedCoachId && <button className="btn ghost small" disabled={busy} onClick={() => choose(k)}>{x.coach.select}</button>}
    </div>)}</div>
    <h4 className="of-sub">{x.coach.tactics}</h4>
    {info.strategies ? <div className="of-tactics-grid">{tactics(info.strategies.offense, x.coach.tOffense)}{tactics(info.strategies.defense, x.coach.tDefense)}</div> : <div className="muted-text">{x.coach.noTactics}</div>}
  </div>;
}

// Choosing the 3 roster players of the Super Big 3.
function SuperPicker({ a, info, x, act, toast, onClose }) {
  const [players, setPlayers] = useState(null);
  const [picked, setPicked] = useState(() => (info?.superBig3?.players || []).map(p => p.id));
  useEffect(() => {
    if (!api.office?.superPlayers) { toast(x.restart, 'error'); onClose(); return; }
    api.office.superPlayers(a.id).then(setPlayers).catch(e => { toast(e.message, 'error'); onClose(); });
  }, [a.id]);
  const exists = Boolean(info?.superBig3?.exists);
  const toggle = id => setPicked(p => p.includes(id) ? p.filter(v => v !== id) : p.length < 3 ? [...p, id] : p);
  const save = async () => {
    if (exists && !window.confirm(x.big3.resetWarn)) return;
    await act(() => api.office.superSet(a.id, picked));
    onClose();
  };
  return <div className="of-detail">
    {!players ? <div className="muted-text">{x.big3.loading}</div> : <>
      <b>{fill(x.big3.choose3, { n: picked.length })}</b>
      <div className="of-pick">{players.map(p => <label key={p.id} className={picked.includes(p.id) ? 'on' : ''}><input type="checkbox" checked={picked.includes(p.id)} disabled={!picked.includes(p.id) && picked.length >= 3} onChange={() => toggle(p.id)} /><b>{p.name}</b><small>{[p.position, p.rating].filter(Boolean).join(' · ')}</small></label>)}</div>
      <div className="modal-actions"><button className="btn ghost" onClick={onClose}>{x.big3.cancel}</button><button className="btn primary" disabled={picked.length !== 3} onClick={save}>{exists ? x.big3.save : x.big3.create}</button></div>
    </>}
  </div>;
}

export default function OfficePage({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const [tab, setTab] = useState(() => state.settings?.officeTab || 'coach');
  const [mode, setMode] = useState(() => state.settings?.officeBig3Mode || 'magic');
  const [open, setOpen] = useState(null); // accountId whose detail row is open
  const choose = id => { setTab(id); setOpen(null); api.settings.update({ officeTab: id }).catch(() => {}); };
  const chooseMode = id => { setMode(id); setOpen(null); api.settings.update({ officeBig3Mode: id }).catch(() => {}); };
  const accounts = state.accounts || [];
  const o = state.office || { info: {}, busy: [], auto: { coach: [], big3: {} } };
  const busy = new Set(o.busy || []);
  const [reading, setReading] = useState(false);
  const grp = useGroupedRows('office-' + tab + (tab === 'big3' ? '-' + mode : ''));
  const read = async () => {
    if (!api.office) return;
    setReading(true);
    try { await api.office.status(accounts.map(a => a.id)); } catch (e) { toast(e.message, 'error'); } finally { setReading(false); }
  };
  const coachAuto = o.auto?.coach || [];
  const big3Auto = o.auto?.big3 || {};
  const superAuto = o.auto?.superBig3 || state.settings?.officeSuperAuto || [];
  const setCoachAuto = ids => api.settings.update({ officeCoachAuto: ids }).catch(e => toast(e.message, 'error'));
  const setBig3Auto = map => api.settings.update({ officeBig3Auto: map }).catch(e => toast(e.message, 'error'));
  const setSuperAuto = ids => api.settings.update({ officeSuperAuto: ids }).catch(e => toast(e.message, 'error'));
  const act = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg, 'success'); return r; } catch (e) { toast(e.message, 'error'); } };
  const runTick = async (fn, results) => { const r = await act(fn); if (r?.result) toast(results[r.result] || r.result, r.result === 'started' ? 'success' : 'info'); };
  const toggleOpen = id => setOpen(v => v === id ? null : id);

  const coachRow = a => {
    const info = o.info?.[a.id];
    const c = info?.coach;
    const tr = c?.training;
    return <Fragment key={a.id}><tr className={open === a.id ? 'selected-row-soft' : ''}>
      <td className="select-col"><input type="checkbox" checked={coachAuto.includes(a.id)} onChange={() => setCoachAuto(coachAuto.includes(a.id) ? coachAuto.filter(i => i !== a.id) : [...coachAuto, a.id])} aria-label={x.auto + ' · ' + a.name} /></td>
      <td><b>{a.name}</b></td>
      <td>{c ? <span className="of-coach-cell">{c.coachName || <span className="muted-text">{x.coach.none}</span>}<button className="link-btn" onClick={() => toggleOpen(a.id)}>{open === a.id ? x.coach.hide : x.coach.inspect}</button></span> : <span className="muted-text">{x.notRead}</span>}</td>
      <td className={c?.offense?.trainable ? 'good-text' : ''}>{strat(c?.offense)}</td>
      <td className={c?.defense?.trainable ? 'good-text' : ''}>{strat(c?.defense)}</td>
      <td className="num">{c ? c.cards.master : '—'}</td>
      <td className="num">{c ? `${c.today.used}/${c.today.free}` : '—'}</td>
      <td>{tr ? leftText(tr.endsAt, x) : (c ? x.none : '')}</td>
      <td className="actions"><button className="btn ghost small" disabled={busy.has(a.id) || !api.office} onClick={() => runTick(() => api.office.coachTick(a.id), x.coach.results)}>{busy.has(a.id) ? x.busy : x.run}</button></td>
    </tr>{open === a.id && <tr className="of-detail-row"><td colSpan={9}><CoachDetail a={a} info={info} x={x} busy={busy.has(a.id)} act={act} /></td></tr>}</Fragment>;
  };

  const big3Row = a => {
    const b = o.info?.[a.id]?.big3;
    const p = b?.progress;
    const teamId = big3Auto[a.id] || b?.teamId || '';
    const autoOn = Boolean(big3Auto[a.id]);
    const points = Number(p?.availablePoints) || 0;
    return <tr key={a.id}>
      <td className="select-col"><input type="checkbox" checked={autoOn} disabled={!teamId} onChange={() => { const m = { ...big3Auto }; if (autoOn) delete m[a.id]; else m[a.id] = teamId; setBig3Auto(m); }} aria-label={x.auto + ' · ' + a.name} /></td>
      <td><b>{a.name}</b></td>
      <td>{b ? <select value={teamId} disabled={busy.has(a.id)} onChange={e => { const id = e.target.value; if (autoOn) setBig3Auto({ ...big3Auto, [a.id]: id }); if (id) act(() => api.office.readTeam(a.id, id)); }}>
        <option value="">—</option>{b.teams.map(tm => <option key={tm.id} value={tm.id}>{tm.ownsTrio ? '● ' : ''}{tm.team}{tm.level ? ` · Lv ${tm.level}` : ''}</option>)}</select> : <span className="muted-text">{x.notRead}</span>}</td>
      <td className="num">{p ? <>Lv {p.level}<small className="cell-sub">{Number(p.xp || 0)}/1000 XP</small>{Number(p.level) >= 15 && !p.magic?.claimedAt && <small className="cell-sub warn-text">{x.big3.magicNote}</small>}</> : '—'}</td>
      <td>{p ? <>+{Number(p.offenseBonus) || 0}% / +{Number(p.defenseBonus) || 0}%{points > 0 && <span className="of-points"><small>{fill(x.big3.points, { n: points })}</small><button className="btn ghost small" disabled={busy.has(a.id)} onClick={() => act(() => api.office.bonus(a.id, teamId, 'offense'))}>{x.big3.off}</button><button className="btn ghost small" disabled={busy.has(a.id)} onClick={() => act(() => api.office.bonus(a.id, teamId, 'defense'))}>{x.big3.def}</button></span>}</> : '—'}</td>
      <td className="num">{b?.attempts ? `${b.attempts.left}/${b.attempts.max}` : '—'}</td>
      <td>{p?.trainingEnd ? leftText(p.trainingEnd, x) : (b ? x.none : '')}</td>
      <td>{b ? <>{b.activeType === 'BIG3' ? 'BIG3' : x.none} <button className="btn ghost small" disabled={busy.has(a.id)} onClick={() => act(() => api.office.setActive(a.id, b.activeType !== 'BIG3'))}>{b.activeType === 'BIG3' ? x.big3.deactivate : x.big3.activate}</button></> : ''}</td>
      <td className="actions"><button className="btn ghost small" disabled={busy.has(a.id) || !teamId} onClick={() => runTick(() => api.office.big3Tick(a.id, teamId), x.big3.results)}>{busy.has(a.id) ? x.busy : x.run}</button></td>
    </tr>;
  };

  const superRow = a => {
    const info = o.info?.[a.id];
    const s = info?.superBig3;
    const p = s?.progress;
    const autoOn = superAuto.includes(a.id);
    const points = Number(p?.availablePoints) || 0;
    const activeSuper = info?.big3?.activeType === 'SUPERBIG3';
    const ready = Boolean(api.office?.superTick);
    return <Fragment key={a.id}><tr className={open === a.id ? 'selected-row-soft' : ''}>
      <td className="select-col"><input type="checkbox" checked={autoOn} disabled={!s?.exists} onChange={() => setSuperAuto(autoOn ? superAuto.filter(i => i !== a.id) : [...superAuto, a.id])} aria-label={x.auto + ' · ' + a.name} /></td>
      <td><b>{a.name}</b></td>
      <td>{!info ? <span className="muted-text">{x.notRead}</span> : !s ? <span className="muted-text">{x.restart}</span> : s.exists ? s.players.map(pl => pl.name).join(', ') : <span className="muted-text">{x.big3.notCreated}</span>}</td>
      <td className="num">{p ? <>Lv {p.level}<small className="cell-sub">{p.xp}/1000 XP</small></> : '—'}</td>
      <td>{p ? <>+{p.offenseBonus}% / +{p.defenseBonus}%{points > 0 && <span className="of-points"><small>{fill(x.big3.points, { n: points })}</small><button className="btn ghost small" disabled={busy.has(a.id)} onClick={() => act(() => api.office.superBonus(a.id, 'offense'))}>{x.big3.off}</button><button className="btn ghost small" disabled={busy.has(a.id)} onClick={() => act(() => api.office.superBonus(a.id, 'defense'))}>{x.big3.def}</button></span>}</> : '—'}</td>
      <td className="num">{s?.attempts ? `${s.attempts.left}/${s.attempts.max}` : '—'}</td>
      <td>{p?.trainingEnd ? leftText(p.trainingEnd, x) : (s ? x.none : '')}</td>
      <td>{s?.exists ? <>{activeSuper ? 'SUPER' : x.none} <button className="btn ghost small" disabled={busy.has(a.id) || !ready} onClick={() => act(() => api.office.superActive(a.id, !activeSuper))}>{activeSuper ? x.big3.deactivate : x.big3.activate}</button></> : ''}</td>
      <td className="actions"><button className="btn ghost small" disabled={busy.has(a.id) || !info} onClick={() => toggleOpen(a.id)}>{open === a.id ? x.big3.cancel : s?.exists ? x.big3.pickPlayers : x.big3.create}</button> <button className="btn ghost small" disabled={busy.has(a.id) || !s?.exists || !ready} onClick={() => runTick(() => api.office.superTick(a.id), x.big3.results)}>{busy.has(a.id) ? x.busy : x.run}</button></td>
    </tr>{open === a.id && <tr className="of-detail-row"><td colSpan={9}><SuperPicker a={a} info={info} x={x} act={act} toast={toast} onClose={() => setOpen(null)} /></td></tr>}</Fragment>;
  };

  const groupRow = (cols, autoOf, setAuto) => (g, { open: isOpen, toggle }) => {
    const ids = g.accounts.map(a => a.id);
    const on = ids.filter(autoOf).length;
    return <tr key={g.key} className="grp-row"><td className="select-col"><input type="checkbox" checked={on === ids.length} ref={el => { if (el) el.indeterminate = on > 0 && on < ids.length; }} onChange={() => setAuto(ids, on !== ids.length)} aria-label={g.label} /></td><td className="grp-name" onClick={toggle}><i className="grp-arrow">{isOpen ? '▾' : '▸'}</i><b>{g.label}</b> <small className="muted-text">{on}/{ids.length}</small></td><td colSpan={cols - 2} onClick={toggle} /></tr>;
  };
  const setCoachGroup = (ids, on) => setCoachAuto(on ? [...new Set([...coachAuto, ...ids])] : coachAuto.filter(i => !ids.includes(i)));
  const setBig3Group = (ids, on) => { const m = { ...big3Auto }; for (const id of ids) { const tid = o.info?.[id]?.big3?.teamId; if (on && tid) m[id] = m[id] || tid; else if (!on) delete m[id]; } setBig3Auto(m); };
  const setSuperGroup = (ids, on) => setSuperAuto(on ? [...new Set([...superAuto, ...ids.filter(id => o.info?.[id]?.superBig3?.exists)])] : superAuto.filter(i => !ids.includes(i)));

  const section = tab === 'coach' ? x.coach : x.big3;
  const big3Head = first => <thead><tr><th className="select-col" title={x.autoHint}>{x.autoShort}</th><th>{x.account}</th><th>{first}</th><th>{x.big3.level}</th><th>{x.big3.bonus}</th><th>{x.big3.attempts}</th><th>{x.big3.training}</th><th>{x.big3.active}</th><th /></tr></thead>;
  return <div className="page office-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div></div>
    <div className="dp-tabs">{Object.keys(x.tabs).map(id => <button key={id} className={tab === id ? 'active' : ''} onClick={() => choose(id)}>{x.tabs[id]}</button>)}</div>
    {tab === 'big3auto' && <Big3AutoTab state={state} t={t} toast={toast} />}
    {tab !== 'big3auto' && <div className="panel pg-bar"><span className="pg-hint">{x.autoHint}</span><span className="sp" /><span className="pg-hint">{x.readHint}</span><button className="btn primary" disabled={reading || !api.office} onClick={read}>{reading ? x.reading : x.read}</button></div>}
    {tab === 'coach' && <div className="panel table-panel dp-table"><SortTable><thead><tr><th className="select-col" title={x.autoHint}>{x.autoShort}</th><th>{x.account}</th><th>{x.coach.coach}</th><th>{x.coach.offense}</th><th>{x.coach.defense}</th><th>{x.coach.cards}</th><th>{x.coach.today}</th><th>{x.coach.training}</th><th /></tr></thead>
      <tbody>{grp(accounts, coachRow, groupRow(9, id => coachAuto.includes(id), setCoachGroup))}</tbody></SortTable></div>}
    {tab === 'big3' && <>
      <div className="ap-seg of-modes">{Object.keys(x.big3.modes).map(id => <button key={id} className={mode === id ? 'active' : ''} onClick={() => chooseMode(id)}>{x.big3.modes[id]}</button>)}</div>
      {mode === 'magic' && <div className="panel table-panel dp-table"><SortTable>{big3Head(x.big3.team)}
        <tbody>{grp(accounts, big3Row, groupRow(9, id => Boolean(big3Auto[id]), setBig3Group))}</tbody></SortTable></div>}
      {mode === 'super' && <div className="panel table-panel dp-table"><SortTable>{big3Head(x.big3.trio)}
        <tbody>{grp(accounts, superRow, groupRow(9, id => superAuto.includes(id), setSuperGroup))}</tbody></SortTable></div>}
    </>}
    {tab !== 'big3auto' && <details className="panel pvp-how"><summary>{t.lang === 'tr' ? 'Nasıl çalışır?' : 'How does it work?'}</summary><ul>{section.how.map(l => <li key={l}>{l}</li>)}</ul></details>}
  </div>;
}
