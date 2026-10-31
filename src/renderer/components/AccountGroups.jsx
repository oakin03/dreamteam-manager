import { Fragment, useState } from 'react';

// Accounts with the same name prefix (the name without its trailing number: Pipelne1…50,
// Trophy…Trophy10) shown as one group that opens and closes (user 2026-10-31: 50 accounts
// are not looked at one by one). Groups need GROUP_MIN accounts; the rest stay single.
// Which groups are open is remembered on this computer, per list.
const GROUP_MIN = 3;
export const prefixOf = name => String(name || '').replace(/\d+$/, '').trim().toLocaleLowerCase('tr') || String(name || '').toLocaleLowerCase('tr');

// [{ key, label, accounts:[...] } | { key, account }] in the order the accounts come in
// (a group sits where its first account is).
export function groupAccounts(accounts) {
  const byPrefix = new Map();
  for (const a of accounts) { const p = prefixOf(a.name); if (!byPrefix.has(p)) byPrefix.set(p, []); byPrefix.get(p).push(a); }
  const out = [];
  const done = new Set();
  for (const a of accounts) {
    const p = prefixOf(a.name);
    const list = byPrefix.get(p);
    if (list.length >= GROUP_MIN) {
      if (done.has(p)) continue;
      done.add(p);
      out.push({ key: `g:${p}`, label: String(list[0].name).replace(/\d+$/, '').trim() || list[0].name, accounts: list });
    } else out.push({ key: a.id, account: a });
  }
  return out;
}

function useOpenGroups(storeKey) {
  const key = `grp.open.${storeKey}`;
  const [open, setOpen] = useState(() => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } });
  const toggle = k => setOpen(o => { const next = o.includes(k) ? o.filter(x => x !== k) : [...o, k]; try { localStorage.setItem(key, JSON.stringify(next)); } catch {} return next; });
  return [open, toggle];
}

// Pick lists (chips / buttons): `render(account)` draws one account as before; a group is a
// chip with a tri-state box (all of the group on / off) and an arrow that opens it.
// `multi = false` (one account at a time, e.g. Social): the group has no box.
export function GroupedPicks({ accounts, selected = [], onSet, render, storeKey = 'picks', disabled = false, isPickable = () => true, multi = true }) {
  const [open, toggleOpen] = useOpenGroups(storeKey);
  return <>{groupAccounts(accounts).map(item => {
    if (item.account) return <Fragment key={item.key}>{render(item.account)}</Fragment>;
    const pickable = item.accounts.filter(isPickable);
    const on = pickable.filter(a => selected.includes(a.id)).length;
    const all = pickable.length > 0 && on === pickable.length;
    const isOpen = open.includes(item.key);
    const setAll = () => {
      const ids = pickable.map(a => a.id);
      onSet(all ? selected.filter(id => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
    };
    return <Fragment key={item.key}>
      <span className={`grp-chip ${on ? 'on' : ''} ${isOpen ? 'open' : ''}`}>
        {multi && <input type="checkbox" disabled={disabled || !pickable.length} checked={all} ref={el => { if (el) el.indeterminate = on > 0 && !all; }} onChange={setAll} aria-label={item.label} />}
        <button type="button" onClick={() => toggleOpen(item.key)}><b>{item.label}</b> <small>{multi ? `${on}/${item.accounts.length}` : item.accounts.length}</small> <i>{isOpen ? '▾' : '▸'}</i></button>
      </span>
      {isOpen && <span className="grp-items">{item.accounts.map(a => <Fragment key={a.id}>{render(a)}</Fragment>)}</span>}
    </Fragment>;
  })}</>;
}

// Table rows, as one flat list (sortable tables need plain <tr> children): a closed group is
// one row drawn by `renderGroup(group, { open, toggle })` (its key must be group.key); an
// open one shows that row and then every account row (`renderRow(account)`).
export function useGroupedRows(storeKey = 'rows') {
  const [open, toggleOpen] = useOpenGroups(storeKey);
  return (accounts, renderRow, renderGroup) => groupAccounts(accounts).flatMap(item => {
    if (item.account) return [renderRow(item.account)];
    const isOpen = open.includes(item.key);
    return [renderGroup(item, { open: isOpen, toggle: () => toggleOpen(item.key) }), ...(isOpen ? item.accounts.map(renderRow) : [])];
  });
}

export const sumOf = (accounts, fn) => accounts.reduce((s, a) => s + (Number(fn(a)) || 0), 0);
