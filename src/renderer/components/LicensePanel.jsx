import { useEffect, useState, useCallback } from 'react';

// Owner license panel — FULL edition only (the build pipeline stubs this file out of pro/basic).
// Shows who uses the app, on which device (an anonymous fingerprint + a name you type), which
// edition, and lets you approve / block / name / remove a device and manage keys.
const api = () => window.dreamteam?.licenseAdmin;
const short = s => (s ? String(s).slice(0, 10) + '…' : '—');
const when = s => (s ? new Date(s).toLocaleString('tr-TR') : '—');
const EDN = { pro: 'Pro', basic: 'Düz' };

export default function LicensePanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ key: '', label: '', edition: 'basic', expiresAt: '', maxMachines: 1, requireApproval: false });

  const load = useCallback(async () => {
    setErr('');
    const a = api();
    if (!a) { setErr('Panel bu derlemede yok.'); return; }
    const r = await a.overview();
    if (r?.ok) setData(r); else setErr(r?.error === 'not-configured' ? 'Lisans sunucusu (Supabase) henüz ayarlanmadı.' : (r?.error || 'Yüklenemedi'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async fn => { setBusy(true); try { const r = await fn(); if (r && r.ok === false) setErr(r.error || 'Hata'); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const create = () => act(async () => { if (!form.key.trim()) return { ok: false, error: 'Anahtar gir' }; const p = { ...form, maxMachines: Number(form.maxMachines) || 1, expiresAt: form.expiresAt || null }; const r = await api().createLicense(p); if (r?.ok) setForm({ key: '', label: '', edition: 'basic', expiresAt: '', maxMachines: 1, requireApproval: false }); return r; });

  const machinesByKey = k => (data?.machines || []).filter(m => m.key === k);

  return <div className="page license-panel">
    <div className="page-title"><div><h1>Lisanslar</h1><span className="subtitle">Kim, hangi cihazda, hangi sürüm · onayla / engelle / adlandır</span></div>
      <div className="toolbar"><button className="btn ghost" disabled={busy} onClick={load}>Yenile</button></div>
    </div>
    {err && <div className="panel empty-state bad-text">{err}</div>}

    <div className="panel eq-form" style={{ marginBottom: 14 }}>
      <b>Yeni lisans</b>
      <div className="eq-row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input placeholder="Anahtar (ör. ALI-2026-XXXX)" value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} />
        <input placeholder="Etiket / kişi" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
        <select value={form.edition} onChange={e => setForm(f => ({ ...f, edition: e.target.value }))}><option value="basic">Düz</option><option value="pro">Pro</option></select>
        <label style={{ fontSize: 12 }}>Cihaz sınırı <input type="number" min="1" style={{ width: 60 }} value={form.maxMachines} onChange={e => setForm(f => ({ ...f, maxMachines: e.target.value }))} /></label>
        <label style={{ fontSize: 12 }} title="Boş = süresiz">Bitiş <input type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} /></label>
        <label className="switchline" style={{ fontSize: 12 }}><input type="checkbox" checked={form.requireApproval} onChange={e => setForm(f => ({ ...f, requireApproval: e.target.checked }))} /> Yeni cihaz onay bek: </label>
        <button className="btn primary" disabled={busy} onClick={create}>Ekle</button>
      </div>
    </div>

    {(data?.licenses || []).map(l => {
      const ms = machinesByKey(l.key);
      return <div className="panel" key={l.key} style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b>{l.label || '(etiketsiz)'}</b>
          <code style={{ fontSize: 12 }}>{l.key}</code>
          <span className="pill">{EDN[l.edition] || l.edition}</span>
          {l.revoked ? <span className="pill bad"><i />iptal</span> : <span className="pill ok"><i />aktif</span>}
          <span style={{ fontSize: 12, color: 'var(--d-mut)' }}>cihaz {ms.length}/{l.max_machines} · {l.expires_at ? `bitiş ${when(l.expires_at)}` : 'süresiz'}{l.require_approval ? ' · onay gerekli' : ''}</span>
          <span className="sp" style={{ flex: 1 }} />
          <button className="btn ghost small" disabled={busy} onClick={() => act(() => api().updateLicense({ key: l.key, revoked: !l.revoked }))}>{l.revoked ? 'Geri aç' : 'İptal et'}</button>
          <button className="btn ghost small" disabled={busy} onClick={() => act(() => api().updateLicense({ key: l.key, max_machines: (l.max_machines || 1) + 1 }))}>+1 cihaz</button>
          <button className="btn danger-soft small" disabled={busy} onClick={() => { if (confirm(`"${l.key}" silinsin mi? Cihazları da silinir.`)) act(() => api().deleteLicense(l.key)); }}>Sil</button>
        </div>
        {ms.length > 0 && <table className="sort-table" style={{ marginTop: 8 }}><thead><tr><th>Cihaz adı</th><th>Parmak izi</th><th>Sürüm</th><th>Son görülme</th><th>Durum</th><th></th></tr></thead>
          <tbody>{ms.map(m => <tr key={m.id}>
            <td><input defaultValue={m.label || ''} placeholder="(adlandır)" style={{ width: 130 }} onBlur={e => { if (e.target.value !== (m.label || '')) act(() => api().machine({ id: m.id, label: e.target.value })); }} /></td>
            <td title={m.machine}><code style={{ fontSize: 11 }}>{short(m.machine)}</code></td>
            <td>{EDN[m.edition] || m.edition || '—'}</td>
            <td style={{ fontSize: 12 }}>{when(m.last_seen)}</td>
            <td>{m.blocked ? <span className="pill bad"><i />engelli</span> : l.require_approval && !m.approved ? <span className="pill warn"><i />onay bekliyor</span> : <span className="pill ok"><i />açık</span>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {l.require_approval && !m.approved && <button className="btn success small" disabled={busy} onClick={() => act(() => api().machine({ id: m.id, approved: true }))}>Onayla</button>}
              <button className="btn ghost small" disabled={busy} onClick={() => act(() => api().machine({ id: m.id, blocked: !m.blocked }))}>{m.blocked ? 'Engeli kaldır' : 'Engelle'}</button>
              <button className="btn danger-soft small" disabled={busy} onClick={() => { if (confirm('Bu cihaz silinsin mi? (kişi yeni bir bilgisayarda etkinleştirebilir)')) act(() => api().machine({ id: m.id, delete: true })); }}>Sil</button>
            </td>
          </tr>)}</tbody></table>}
      </div>;
    })}
    {data && !(data.licenses || []).length && <div className="panel empty-state">Henüz lisans yok. Yukarıdan ekle.</div>}
  </div>;
}
