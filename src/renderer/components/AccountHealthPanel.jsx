import { useEffect, useRef, useState } from 'react';
import SortTable from './SortTable';

const api = window.dreamteam;
const num = v => v == null ? '—' : Number(v).toLocaleString();
const TEXT = {
  tr: {
    title: 'Hesap sağlığı', hint: '10 dakikada bir kontrol edilir', refresh: 'Şimdi kontrol et', checking: 'Kontrol ediliyor…', account: 'Hesap', salary: 'Maaş / Sınır', roster: 'Kadro', tk: 'TK', status: 'Durum', ok: 'Sorun yok', none: 'Henüz kontrol edilmedi.', onlyIssues: 'Yalnızca sorunlu hesaplar', allGood: 'Bütün hesaplar sorunsuz.',
    limits: 'Uyarı sınırları', lowTk: 'TK bunun altındaysa uyar', nearCap: 'Maaş sınırının yüzde kaçında uyar', rosterWarn: 'Kadro bu sayıya ulaşınca uyar', save: 'Kaydet', reset: 'Varsayılana dön', saved: 'Uyarı sınırları kaydedildi', defaultsHint: 'Kaydettiğin değerler yeni varsayılan olur.',
    issue: { overCap: 'Maaş sınırı aşıldı', nearCap: 'Maaş sınırına yakın', rosterFull: 'Kadro dolu', lowTk: 'TK az', autoPlayError: 'Auto Play hatası' }
  },
  en: {
    title: 'Account health', hint: 'checked every 10 minutes', refresh: 'Check now', checking: 'Checking…', account: 'Account', salary: 'Salary / Cap', roster: 'Roster', tk: 'TK', status: 'Status', ok: 'No problems', none: 'Not checked yet.', onlyIssues: 'Only accounts with problems', allGood: 'Every account is fine.',
    limits: 'Warning limits', lowTk: 'Warn when TK is below', nearCap: 'Warn at this % of the salary cap', rosterWarn: 'Warn when the roster reaches', save: 'Save', reset: 'Reset to default', saved: 'Warning limits saved', defaultsHint: 'The values you save become the new default.',
    issue: { overCap: 'Over the salary cap', nearCap: 'Close to the salary cap', rosterFull: 'Roster full', lowTk: 'Low TK', autoPlayError: 'Auto Play error' }
  }
};

const FALLBACK = { lowTk: 5000, nearCapPct: 97, rosterWarn: 11 };

// Gear popover: the warning limits, saved to settings.healthLimits (the last saved
// values stay as the default from then on).
function LimitsPopover({ h, x, toast, onClose }) {
  const current = { ...FALLBACK, ...(h.limits || {}) };
  const [form, setForm] = useState({ lowTk: current.lowTk, nearCapPct: current.nearCapPct, rosterWarn: current.rosterWarn });
  const ref = useRef(null);
  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.health-gear')) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);
  const save = async limits => {
    try { await api.settings.update({ healthLimits: limits }); toast(x.saved, 'success'); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  const field = (key, label, props) => <label key={key}><span>{label}</span><input type="number" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} {...props} /></label>;
  return <div className="health-limits" ref={ref}>
    <b>{x.limits}</b>
    {field('lowTk', x.lowTk, { min: 0, step: 1000 })}
    {field('nearCapPct', x.nearCap, { min: 1, max: 100, step: 1 })}
    {field('rosterWarn', x.rosterWarn, { min: 1, max: h.limits?.rosterMax || 11, step: 1 })}
    <small className="muted-text">{x.defaultsHint}</small>
    <div className="health-limits-actions">
      <button className="btn ghost small" onClick={() => save(null)}>{x.reset}</button>
      <button className="btn primary small" onClick={() => save({ lowTk: Number(form.lowTk), nearCapPct: Number(form.nearCapPct), rosterWarn: Number(form.rosterWarn) })}>{x.save}</button>
    </div>
  </div>;
}

// Home: salary cap, roster, TK and Auto Play problems per account; over-cap first.
export default function AccountHealthPanel({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const h = state.accountHealth || { rows: [] };
  const [only, setOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [gear, setGear] = useState(false);
  const rank = r => (r.issues || []).reduce((n, i) => Math.max(n, i.level === 'bad' ? 2 : 1), 0);
  const rows = [...(h.rows || [])].sort((a, b) => rank(b) - rank(a) || String(a.name).localeCompare(String(b.name)));
  const shown = only ? rows.filter(r => r.issues?.length) : rows;
  const refresh = async () => { setBusy(true); try { await api.health.refresh(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } };
  const bad = rows.filter(r => r.issues?.some(i => i.level === 'bad')).length;
  return <>
    <h3 className="section-title">{x.title} {bad > 0 && <span className="health-bad-count">{bad}</span>}<small>{h.checkedAt ? `${new Date(h.checkedAt).toLocaleTimeString()} · ${x.hint}` : x.hint}</small></h3>
    <div className="panel health-panel">
      <div className="health-head"><label><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} />{x.onlyIssues}</label><div className="health-tools"><button className="btn ghost small" disabled={busy || h.busy} onClick={refresh}>{busy || h.busy ? x.checking : x.refresh}</button><button className={`icon-btn health-gear${gear ? ' active' : ''}`} title={x.limits} aria-label={x.limits} onClick={() => setGear(g => !g)}>⚙</button>{gear && <LimitsPopover h={h} x={x} toast={toast} onClose={() => setGear(false)} />}</div></div>
      {!rows.length ? <p className="muted-text">{x.none}</p> : !shown.length ? <p className="health-ok">✓ {x.allGood}</p> :
        <div className="health-table-wrap"><SortTable><thead><tr><th>{x.account}</th><th>{x.salary}</th><th>{x.roster}</th><th>{x.tk}</th><th>{x.status}</th></tr></thead>
          <tbody>{shown.map(r => { const over = r.issues?.some(i => i.kind === 'overCap'); return <tr key={r.accountId} className={over ? 'health-over' : ''}>
            <td><b>{r.name}</b>{r.level ? <small className="cell-sub">Lv {r.level}</small> : null}</td>
            <td className={over ? 'bad-text' : ''}><b>{num(r.used)}</b> / {num(r.cap)}</td>
            <td className={r.roster >= (h.limits?.rosterWarn || h.limits?.rosterMax || 11) ? 'warn-text' : ''}>{r.roster ?? '—'}/{h.limits?.rosterMax || 11}</td>
            <td className={r.tk != null && r.tk < (h.limits?.lowTk || 5000) ? 'warn-text' : ''}>{num(r.tk)}</td>
            <td><div className="health-issues">{r.issues?.length ? r.issues.map(i => <span key={i.kind} className={`pill ${i.level === 'bad' ? 'bad' : 'warn'}`} title={i.message || ''}><i />{x.issue[i.kind] || i.kind}</span>) : <span className="pill ok"><i />{x.ok}</span>}</div></td>
          </tr>; })}</tbody></SortTable></div>}
    </div>
  </>;
}
