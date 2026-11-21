import { useState } from 'react';
import { filOf } from '../i18n-fil';

// "Seçili hesapların ilerlemesini sıfırla" (user 2026-11-20), under the Elite Ascent and Professional
// tables: asks first with the list of accounts, then resets all of them at the same time.
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const TEXT = {
  tr: {
    btn: 'Seçili hesapların ilerlemesini sıfırla ({n})', title: 'İlerleme sıfırlansın mı?', sure: 'Emin misin? Bu geri alınamaz.',
    ascent: 'Aşağıdaki {n} hesap Elite Ascent\'te 1. kata döner.', pro: 'Aşağıdaki {n} hesabın Professional ilerlemesi silinir: konferans seçimi ve 82 maçlık yeni sezon baştan başlar.',
    yes: 'Evet, sıfırla', cancel: 'Vazgeç', busy: 'Sıfırlanıyor…', ok: '{n} hesap sıfırlandı', fail: '{n} hesap sıfırlanamadı', running: 'Önce durdur', none: 'Önce hesap seç'
  },
  en: {
    btn: 'Reset the progress of the selected accounts ({n})', title: 'Reset the progress?', sure: 'Are you sure? This cannot be undone.',
    ascent: 'The {n} account(s) below go back to floor 1 of Elite Ascent.', pro: 'The Professional progress of the {n} account(s) below is deleted: the conference choice and a new 82-game season start over.',
    yes: 'Yes, reset', cancel: 'Cancel', busy: 'Resetting…', ok: '{n} account(s) reset', fail: '{n} account(s) could not be reset', running: 'Stop it first', none: 'Select accounts first'
  },
  get fil() { return filOf(this.en); }
};

export default function ResetProgress({ lang, kind, ids, accounts, running, onReset, toast }) {
  const x = TEXT[lang] || TEXT.en;
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const names = ids.map(id => accounts.find(a => a.id === id)?.name).filter(Boolean);
  const go = async () => {
    setAsk(false); setBusy(true);
    try {
      const r = await onReset(ids);
      const res = Object.values(r?.results || {});
      const ok = res.filter(v => v.ok).length, bad = res.length - ok;
      if (ok) toast(fill(x.ok, { n: ok }), 'success');
      if (bad) toast(fill(x.fail, { n: bad }) + (res.find(v => !v.ok)?.error ? ` · ${res.find(v => !v.ok).error}` : ''), 'error');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return <div className="panel pg-bar reset-progress">
    <span className="sp" />
    <button className="btn danger-soft" disabled={busy || running || !ids.length} title={running ? x.running : !ids.length ? x.none : ''} onClick={() => setAsk(true)}>{busy ? x.busy : fill(x.btn, { n: ids.length })}</button>
    {ask && <div className="modal-backdrop" onClick={() => setAsk(false)}><div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
      <h3>{x.title}</h3>
      <p>{fill(kind === 'pro' ? x.pro : x.ascent, { n: names.length })}</p>
      <ul className="fire-list">{names.map(n => <li key={n}><b>{n}</b></li>)}</ul>
      <p className="bad-text">{x.sure}</p>
      <div className="modal-actions"><button className="btn ghost" autoFocus onClick={() => setAsk(false)}>{x.cancel}</button><button className="btn danger" onClick={go}>{x.yes}</button></div>
    </div></div>}
  </div>;
}
