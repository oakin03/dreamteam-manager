import { useEffect, useState } from 'react';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

const TEXT = {
  tr: {
    read: 'Yetenekleri oku', reading: 'Okunuyor…', hint: 'Okumak ve değiştirmek için hesaba kısa süreliğine bağlanılır; o hesap oyunda açıksa oradan çıkış yapılır.',
    learn: 'Yetenekleri öğren (11 konteyner)', learnHint: '30. seviyeden sonra bir kez yapılır.', none: 'Bu hesapta henüz yetenek yok.',
    container: 'Konteyner {n}', player: 'Oyuncu', noPlayer: '— atanmamış —', shuffle: 'Shuffle', freeLeft: 'Bugün {n}/{m} ücretsiz shuffle',
    noFree: 'Bugünkü ücretsiz shuffle bitti (sonrakiler bilet ister, uygulama kullanmaz).', closed: 'Lv {lv}', empty: 'Boş',
    lock: 'Kilitle (shuffle değiştirmez)', unlock: 'Kilidi aç', level: 'Hesap seviyesi {lv}', tiers: { PRIMARY: 'Birincil', INTERMEDIATE: 'Orta', SUPERIOR: 'Üstün' },
    shuffled: 'Shuffle yapıldı', how: ['Her konteyner bir oyuncuya atanır; yetenekleri o oyuncuya maçta etki eder.', 'Shuffle konteynerdeki kilitsiz yetenekleri yeniden dağıtır; günde 2 ücretsiz hak var ve ücretsiz shuffle SUPERIOR yetenek vermez.', 'Kilitli yetenek shuffle\'da değişmez. Slotlar 30 · 40 · 50 · 60 · 70. seviyelerde açılır; bilet ile slot açma kullanılmaz.']
  },
  en: {
    read: 'Read skills', reading: 'Reading…', hint: 'Reading and changing signs in to the account for a moment; if it is open in the game it is signed out there.',
    learn: 'Learn skills (11 containers)', learnHint: 'Done once, from level 30.', none: 'This account has no skills yet.',
    container: 'Container {n}', player: 'Player', noPlayer: '— not assigned —', shuffle: 'Shuffle', freeLeft: '{n}/{m} free shuffles today',
    noFree: "Today's free shuffles are used (the next ones cost tickets; the app never uses them).", closed: 'Lv {lv}', empty: 'Empty',
    lock: 'Lock (a shuffle keeps it)', unlock: 'Unlock', level: 'Account level {lv}', tiers: { PRIMARY: 'Primary', INTERMEDIATE: 'Intermediate', SUPERIOR: 'Superior' },
    shuffled: 'Shuffled', how: ['Every container is assigned to a player; its skills work for that player in matches.', 'A shuffle deals the unlocked skills of a container again; there are 2 free shuffles a day and a free shuffle never gives a SUPERIOR skill.', 'A locked skill stays in a shuffle. Slots open at levels 30 · 40 · 50 · 60 · 70; opening slots with tickets is never used.']
  },
  get fil() { return filOf(this.en); }
};
const SLOT_LEVELS = [30, 40, 50, 60, 70];

export default function SkillsTab({ accountId, accounts, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setView(null); }, [accountId]);
  const run = async (fn, ok) => {
    if (!api.skills) return;
    setBusy(true);
    try { const v = await fn(); if (v) setView(prev => ({ ...prev, ...v })); if (ok) toast(ok, 'success'); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  if (!accountId) return null;
  const name = accounts.find(a => a.id === accountId)?.name || '';
  return <div className="sk-tab">
    <div className="panel pg-bar">
      <b>{name}</b>{view?.level != null && <span className="muted-text">{fill(x.level, { lv: view.level })}</span>}
      {view && <span className={`pill ${view.freeShuffles > 0 ? 'ok' : 'muted'}`}><i />{fill(x.freeLeft, { n: view.freeShuffles, m: view.maxFreeShuffles })}</span>}
      <span className="sp" /><span className="pg-hint">{x.hint}</span>
      <button className="btn primary" disabled={busy || !api.skills} onClick={() => run(() => api.skills.view(accountId))}>{busy ? x.reading : x.read}</button>
    </div>
    {view && !view.containers?.length && <div className="panel empty-state">{x.none} <button className="btn ghost" disabled={busy || (view.level != null && view.level < 30)} title={x.learnHint} onClick={() => run(() => api.skills.learn(accountId))}>{x.learn}</button></div>}
    {view?.containers?.length > 0 && <div className="sk-grid">{view.containers.map(c => <div key={c.id} className="panel sk-card">
      <div className="sk-head"><b>{fill(x.container, { n: c.number })}</b>
        <select value={c.player?.playerId || ''} disabled={busy} onChange={e => run(() => api.skills.assign(accountId, c.id, e.target.value || null))} title={x.player}>
          <option value="">{x.noPlayer}</option>
          {c.player && !(view.players || []).some(p => p.playerId === c.player.playerId) && <option value={c.player.playerId}>{c.player.name}{c.player.rating ? ` (${c.player.rating})` : ''}</option>}
          {(view.players || []).map(p => <option key={p.playerId} value={p.playerId}>{p.name}{p.rating ? ` (${p.rating})` : ''}</option>)}
        </select>
      </div>
      <div className="sk-slots">{c.slots.map(s => <div key={s.slot} className={`sk-slot ${s.open ? '' : 'closed'} ${s.skill ? 'tier-' + String(s.skill.tier || '').toLowerCase() : ''}`} title={s.skill?.description || ''}>
        {!s.open ? <span className="muted-text">{fill(x.closed, { lv: SLOT_LEVELS[s.slot - 1] ?? '?' })}</span> : s.skill ? <>
          <b>{s.skill.name}</b><small>{x.tiers[s.skill.tier] || s.skill.tier} · {s.skill.category}</small>
          <button className={`sk-lock ${s.locked ? 'on' : ''}`} disabled={busy} title={s.locked ? x.unlock : x.lock} onClick={() => run(() => api.skills.lock(accountId, c.id, s.slot, !s.locked))}>{s.locked ? '🔒' : '🔓'}</button>
        </> : <span className="muted-text">{x.empty}</span>}
      </div>)}</div>
      <button className="btn ghost small" disabled={busy || !(view.freeShuffles > 0) || c.slots.every(s => !s.open || s.locked)} title={view.freeShuffles > 0 ? '' : x.noFree} onClick={() => run(() => api.skills.shuffle(accountId, c.id), x.shuffled)}>{x.shuffle}</button>
    </div>)}</div>}
    <details className="panel pvp-how"><summary>{t.lang === 'tr' ? 'Nasıl çalışır?' : 'How does it work?'}</summary><ul>{x.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </div>;
}
