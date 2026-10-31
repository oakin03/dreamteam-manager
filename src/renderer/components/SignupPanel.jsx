import { useState } from 'react';
import { filOf } from '../i18n-fil';

// Bulk account creation (user 2026-10-31): prefix + count + one password + one logo.
const api = window.dreamteam;
const AVATARS = 15;
export const SIGNUP_TEXT = {
  tr: {
    open: 'Hesap oluştur', title: 'Toplu hesap oluştur', prefix: 'Ön ek', count: 'Hesap sayısı', password: 'Şifre (hepsi için)', logo: 'Logo (hepsi için)', parallel: 'Aynı anda', start: 'Oluştur', cancel: 'İptal', stop: 'Durdur',
    hint: 'Takım adı = ön ek + sıra numarası (büyük harfler korunur), mail = aynısı küçük harfle @ temp-mail.io. Takım adı oyunda 4–10 harf/rakam olmalı. Numara, bu ön ekle daha önce kullanılan en yüksek numaradan devam eder; oyunda alınmış olanlar atlanır. Uygulama kapanırsa iş bir sonraki açılışta kaldığı yerden sürer.',
    after: 'Her hesapta: rastgele X oyuncusuyla takım kurulur, logo seçilir, Günlük rutine eklenir ve Auto Play başlatılır (Daily Signin, 600 gün, görevler ve Friendly Match rutinle yapılır).',
    preview: 'Örnek: {team} · {mail}@…', running: 'Hesaplar oluşturuluyor · {done}/{count}', finished: '{n} hesap oluşturuldu', stoppedWith: 'Durdu: {error}',
    steps: { name: 'ad kontrolü', mail: 'mail', register: 'kayıt', team: 'takım', logo: 'logo', start: 'başlatılıyor' },
    status: { working: 'sürüyor', done: 'tamam', error: 'hata', skipped: 'atlandı (ad alınmış)' }
  },
  en: {
    open: 'Create accounts', title: 'Create accounts in bulk', prefix: 'Prefix', count: 'Number of accounts', password: 'Password (for all)', logo: 'Logo (for all)', parallel: 'At the same time', start: 'Create', cancel: 'Cancel', stop: 'Stop',
    hint: 'Team name = prefix + number (capitals kept), mail = the same in lower case @ temp-mail.io. A team name must be 4–10 letters/digits in the game. Numbering goes on after the highest number used with this prefix; names taken in the game are skipped. If the app closes, the job goes on at the next start.',
    after: 'On every account: a team is built with a random X player, the logo is set, the account joins the daily routine and Auto Play starts (Daily Signin, 600-day, tasks and the Friendly Match run with the routine).',
    preview: 'Example: {team} · {mail}@…', running: 'Creating accounts · {done}/{count}', finished: '{n} account(s) created', stoppedWith: 'Stopped: {error}',
    steps: { name: 'name check', mail: 'mail', register: 'sign up', team: 'team', logo: 'logo', start: 'starting' },
    status: { working: 'running', done: 'done', error: 'error', skipped: 'skipped (name taken)' }
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

export function SignupModal({ lang, Modal, onClose, toast, state }) {
  const x = SIGNUP_TEXT[lang] || SIGNUP_TEXT.tr;
  const [form, setForm] = useState({ prefix: '', count: 5, password: '', avatar: 14, parallel: 5 });
  // the preview number: after the highest one this prefix used
  const re = form.prefix ? new RegExp(`^${form.prefix}(\\d+)$`, 'i') : null;
  const nextNo = 1 + Math.max(0, Number(state?.settings?.signupNumbers?.[form.prefix.toLowerCase()]) || 0, ...(state?.accounts || []).map(a => Number(re?.exec(String(a.name))?.[1] || 0)));
  const ok = /^[a-zA-Z0-9]+$/.test(form.prefix) && form.prefix.length + String(form.count).length <= 10 && Number(form.count) >= 1 && form.password.length >= 6;
  const submit = async e => {
    e.preventDefault();
    try { await api.signup.create({ ...form, count: Number(form.count) }); onClose(); } catch (err) { toast(err.message, 'error'); }
  };
  return <Modal title={x.title} onClose={onClose} width={560}>
    <form className="form" onSubmit={submit}>
      <p className="muted-text">{x.hint}</p>
      <div className="form-row">
        <label><span>{x.prefix}</span><input autoFocus required maxLength={9} value={form.prefix} onChange={e => setForm({ ...form, prefix: e.target.value.replace(/[^a-zA-Z0-9]/g, '') })} /></label>
        <label><span>{x.count}</span><input type="number" min="1" max="50" required value={form.count} onChange={e => setForm({ ...form, count: e.target.value })} /></label>
        <label><span>{x.parallel}</span><select value={form.parallel} onChange={e => setForm({ ...form, parallel: Number(e.target.value) })}>{[1, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
      {form.prefix && <small className="muted-text">{fill(x.preview, { team: `${form.prefix}${nextNo}`, mail: `${form.prefix}${nextNo}`.toLowerCase() })}</small>}
      <label><span>{x.password}</span><input type="password" required minLength={6} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
      <div className="signup-logos"><span>{x.logo}</span><div>{Array.from({ length: AVATARS }, (_, i) => i + 1).map(n => <button type="button" key={n} className={form.avatar === n ? 'on' : ''} onClick={() => setForm({ ...form, avatar: n })}><img src={`https://www.dreamteamph.com/avatar/avatar${n}.webp`} alt={`Logo ${n}`} /></button>)}</div></div>
      <p className="muted-text small">{x.after}</p>
      <div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>{x.cancel}</button><button className="btn primary" disabled={!ok}>{x.start}</button></div>
    </form>
  </Modal>;
}

// Progress of the last / running bulk creation.
export function SignupProgress({ run, lang }) {
  const x = SIGNUP_TEXT[lang] || SIGNUP_TEXT.tr;
  if (!run || (!run.running && !run.rows?.length)) return null;
  const created = run.rows.filter(r => r.status === 'done').length;
  return <div className="panel signup-progress">
    <div className="signup-head">
      <b>{run.running ? fill(x.running, { done: created, count: run.count }) : fill(x.finished, { n: created })}</b>
      {run.running && <button className="btn danger-soft small" onClick={() => api.signup.stop()}>{x.stop}</button>}
      {!run.running && run.error && <span className="bad-text">{fill(x.stoppedWith, { error: run.error })}</span>}
    </div>
    <div className="signup-rows">{run.rows.map(r => <span key={r.teamName} className={`signup-row ${r.status}`} title={r.error || r.email || ''}><b>{r.teamName}</b> {r.status === 'working' ? (x.steps[r.step] || r.step) : x.status[r.status] || r.status}</span>)}</div>
  </div>;
}
