import { useState } from 'react';
import { filOf } from '../i18n-fil';

// Account roles (user 2026-10-31). Main, "2. Main" and Side are fixed (never renamed or
// deleted, only recoloured); Turnuva comes ready and the user adds more as needed. Every
// role but Main counts as Side for the automations; "2. Main" is the main account while
// there is no Main. Main / 2. Main are stored in the account profile, the others on the
// account (no role = Side).
const api = window.dreamteam;
export const ROLE_COLORS = [
  '#e5484d', '#f76b15', '#ffb224', '#f5d90a', '#99d52a', '#46a758', '#30a46c', '#12a594',
  '#05a2c2', '#0091ff', '#3e63dd', '#5b5bd6', '#6e56cf', '#8e4ec6', '#ab4aba', '#d6409f',
  '#e93d82', '#ad7f58', '#978365', '#8b8d98', '#687076', '#1c2024', '#b8860b', '#7c4dff',
  '#00b8a9', '#ff6f91'
];
const FIXED = [
  { id: 'main', name: 'Main', color: '#e5484d' },
  { id: 'main2', name: '2. Main', color: '#f76b15' },
  { id: 'side', name: 'Side', color: '#8b8d98' }
];
const DEFAULT_CUSTOM = [{ id: 'tournament', name: 'Turnuva', color: '#0091ff' }];

export const ROLE_TEXT = {
  tr: {
    role: 'Rol', roles: 'Roller', manage: 'Rolleri düzenle', add: 'Rol ekle', newRole: 'Yeni rol', del: 'Sil', fixed: 'sabit', color: 'Renk', save: 'Kaydet', cancel: 'İptal',
    hint: 'Main, 2. Main ve Side silinemez, adı değişmez; yalnızca rengi seçilir. Main dışındaki tüm roller diğer otomasyonlarda Side sayılır. 2. Main, Main hesap yokken main olarak çalışır.',
    startRoles: 'Rol seç', startBtn: 'Seçili rolleri başlat ({n})', startHint: 'Sadece seçtiğin rollerdeki hesaplar başlatılır; Side, Main ve 2. Main dışındaki bütün hesapları kapsar.', none: 'Rol seçilmedi',
    deleteAsk: '"{name}" rolü silinsin mi? Bu roldeki hesaplar Side olur.'
  },
  en: {
    role: 'Role', roles: 'Roles', manage: 'Edit roles', add: 'Add role', newRole: 'New role', del: 'Delete', fixed: 'fixed', color: 'Colour', save: 'Save', cancel: 'Cancel',
    hint: 'Main, 2. Main and Side cannot be deleted or renamed; only their colour is chosen. Every role but Main counts as Side for the other automations. 2. Main works as the main account while there is no Main.',
    startRoles: 'Pick roles', startBtn: 'Start selected roles ({n})', startHint: 'Only the accounts in the roles you pick are started; Side covers every account except Main and 2. Main.', none: 'No role picked',
    deleteAsk: 'Delete the role "{name}"? Its accounts become Side.'
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

// All roles: the fixed ones (colours may be changed) first, then the user's.
export function roleDefs(settings) {
  const saved = Array.isArray(settings?.accountRoleDefs) ? settings.accountRoleDefs : null;
  const byId = Object.fromEntries((saved || []).map(r => [r.id, r]));
  const fixed = FIXED.map(r => ({ ...r, color: byId[r.id]?.color || r.color, fixed: true }));
  const custom = (saved ? saved.filter(r => !FIXED.some(f => f.id === r.id)) : DEFAULT_CUSTOM).map(r => ({ ...r, fixed: false }));
  return [...fixed, ...custom];
}

// The role of an account: Main / 2. Main from the profile, else its own, else Side.
export function roleOf(account, profile, defs) {
  if (!account) return 'side';
  if (profile?.realMainAccountId === account.id) return 'main';
  if (profile?.secondMainId === account.id) return 'main2';
  return account.role && defs.some(d => d.id === account.role) ? account.role : 'side';
}

export function RolePill({ def, small = false }) {
  if (!def) return null;
  return <span className={`role-pill${small ? ' small' : ''}`} style={{ '--role': def.color }}><i />{def.name}</span>;
}

// Role picker in an account row.
export function RoleSelect({ account, profile, defs, toast, refresh }) {
  const current = roleOf(account, profile, defs);
  const def = defs.find(d => d.id === current);
  return <label className="role-select" style={{ '--role': def?.color }}>
    <i />
    <select value={current} onChange={async e => { try { await api.accounts.setRole(account.id, e.target.value); await refresh?.(); } catch (err) { toast?.(err.message, 'error'); } }}>
      {defs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  </label>;
}

function ColorGrid({ value, onPick }) {
  return <div className="role-colors">{ROLE_COLORS.map(c => <button type="button" key={c} className={c === value ? 'on' : ''} style={{ background: c }} aria-label={c} onClick={() => onPick(c)} />)}</div>;
}

export function RoleManager({ settings, lang, Modal, onClose, toast, refresh }) {
  const x = ROLE_TEXT[lang] || ROLE_TEXT.tr;
  const [rows, setRows] = useState(() => roleDefs(settings));
  const [open, setOpen] = useState(null);
  const set = (id, patch) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const add = () => {
    const id = `r${Date.now().toString(36)}`;
    const used = new Set(rows.map(r => r.color));
    setRows(rs => [...rs, { id, name: x.newRole, color: ROLE_COLORS.find(c => !used.has(c)) || ROLE_COLORS[0], fixed: false }]);
    setOpen(id);
  };
  const remove = r => { if (window.confirm(fill(x.deleteAsk, { name: r.name }))) setRows(rs => rs.filter(z => z.id !== r.id)); };
  const save = async () => {
    try {
      const clean = rows.map(r => ({ id: r.id, name: r.fixed ? r.name : (String(r.name).trim() || x.newRole), color: r.color }));
      await api.settings.update({ accountRoleDefs: clean });
      await refresh?.();
      onClose();
    } catch (e) { toast?.(e.message, 'error'); }
  };
  return <Modal title={x.roles} onClose={onClose} width={560}>
    <p className="muted-text role-hint">{x.hint}</p>
    <div className="role-list">
      {rows.map(r => <div key={r.id} className="role-row">
        <button type="button" className="role-swatch" style={{ background: r.color }} title={x.color} onClick={() => setOpen(open === r.id ? null : r.id)} />
        {r.fixed ? <b>{r.name}</b> : <input value={r.name} maxLength={20} onChange={e => set(r.id, { name: e.target.value })} />}
        {r.fixed ? <span className="muted-text small">{x.fixed}</span> : <button type="button" className="btn ghost small danger-text" onClick={() => remove(r)}>{x.del}</button>}
        {open === r.id && <ColorGrid value={r.color} onPick={c => set(r.id, { color: c })} />}
      </div>)}
    </div>
    <div className="modal-actions"><button type="button" className="btn ghost" onClick={add}>+ {x.add}</button><span className="sp" /><button type="button" className="btn ghost" onClick={onClose}>{x.cancel}</button><button type="button" className="btn primary" onClick={save}>{x.save}</button></div>
  </Modal>;
}

// Auto Play: start only the accounts of the picked roles (remembered on this computer).
export function RoleStart({ state, lang, busy, onStart }) {
  const x = ROLE_TEXT[lang] || ROLE_TEXT.tr;
  const defs = roleDefs(state.settings);
  const profile = state.accountProfile || {};
  const [picked, setPicked] = useState(() => { try { return JSON.parse(localStorage.getItem('ap.startRoles') || '[]'); } catch { return []; } });
  const [open, setOpen] = useState(false);
  const toggle = id => setPicked(p => { const next = p.includes(id) ? p.filter(z => z !== id) : [...p, id]; try { localStorage.setItem('ap.startRoles', JSON.stringify(next)); } catch {} return next; });
  const valid = picked.filter(id => defs.some(d => d.id === id));
  // Side = every account but Main / 2. Main
  const ids = state.accounts.filter(a => { const r = roleOf(a, profile, defs); return valid.includes(r) || (valid.includes('side') && r !== 'main' && r !== 'main2'); }).map(a => a.id);
  return <span className="role-start" title={x.startHint}>
    <button type="button" className="btn ghost" onClick={() => setOpen(o => !o)}>{valid.length ? valid.map(id => <RolePill key={id} small def={defs.find(d => d.id === id)} />) : x.startRoles} ▾</button>
    {open && <div className="role-start-menu" onMouseLeave={() => setOpen(false)}>{defs.map(d => <label key={d.id}><input type="checkbox" checked={valid.includes(d.id)} onChange={() => toggle(d.id)} /><RolePill def={d} /></label>)}</div>}
    <button type="button" className="btn" disabled={busy || !ids.length} onClick={() => onStart(ids)}>▶ {fill(x.startBtn, { n: ids.length })}</button>
  </span>;
}
