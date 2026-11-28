import { Fragment, useState } from 'react';

// Accounts with the same name prefix (the name without its trailing number: Pipelne1…50,
// Trophy…Trophy10) shown as one group that opens and closes (user 2026-10-31: 50 accounts
// are not looked at one by one). Groups need GROUP_MIN accounts; the rest stay single.
// Which groups are open is remembered on this computer, per list.
const GROUP_MIN = 3;
export const prefixOf = name => String(name || '').replace(/\d+$/, '').trim().toLocaleLowerCase('tr') || String(name || '').toLocaleLowerCase('tr');

// The user's account order (Accounts page, drag and drop; user 2026-11-28: every table and every
// account choice shows the accounts in that order). App sets it from the account list on every
// render; tables and picks sort by it (rows by accountId / id, or by account name).
let ORDER = { byId: new Map(), byName: new Map() };
export function setAccountOrder(accounts) {
  const byId = new Map(); const byName = new Map();
  (accounts || []).forEach((a, i) => { byId.set(a.id, i); byName.set(String(a.name || '').toLocaleLowerCase('tr'), i); });
  ORDER = { byId, byName };
}
export const orderOf = r => ORDER.byId.get(r?.accountId) ?? ORDER.byId.get(r?.id) ?? ORDER.byName.get(String(r?.accountName ?? r?.name ?? '').toLocaleLowerCase('tr')) ?? 1e9;
// stable: rows of one account keep their own order
export const byAccountOrder = list => (list || []).map((r, i) => [r, i]).sort((a, b) => (orderOf(a[0]) - orderOf(b[0])) || (a[1] - b[1])).map(x => x[0]);

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
  return <>{groupAccounts(byAccountOrder(accounts)).map(item => {
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
  return (accounts, renderRow, renderGroup) => groupAccounts(byAccountOrder(accounts)).flatMap(item => {
    if (item.account) return [renderRow(item.account)];
    const isOpen = open.includes(item.key);
    return [renderGroup(item, { open: isOpen, toggle: () => toggleOpen(item.key) }), ...(isOpen ? item.accounts.map(renderRow) : [])];
  });
}

export const sumOf = (accounts, fn) => accounts.reduce((s, a) => s + (Number(fn(a)) || 0), 0);

// The group row of a plain table (user 2026-11-11: every account table groups): the name opens
// the group; `cells(accounts)` may add summary cells after it, otherwise the name spans `cols`.
export const groupRowOf = (cols, cells = null) => (g, { open, toggle }) => <tr key={g.key} className="grp-row">
  <td className="grp-name" onClick={toggle} colSpan={cells ? 1 : cols}><i className="grp-arrow">{open ? '▾' : '▸'}</i><b>{g.label}</b> <small className="muted-text">{g.accounts.length}</small></td>
  {cells ? cells(g.accounts) : null}
</tr>;
// rows that carry { accountId, name } → the { id, name } shape the grouping reads
export const asAccounts = rows => (rows || []).map(r => ({ ...r, id: r.accountId ?? r.id, name: r.name }));

// Drag and drop of the Accounts page (user 2026-11-28): a group (or a single account) moves as one
// block among the others; inside an open group its accounts move among themselves. `commit(ids)`
// gets the whole new order.
export function useAccountDrag(ids, items, commit) {
  const [drag, setDrag] = useState(null); // { kind: 'top' | 'in', key, group }
  const [over, setOver] = useState(null);
  const blockOf = item => (item.account ? [item.account.id] : item.accounts.map(a => a.id));
  const moveTop = (fromKey, toKey) => {
    const blocks = items.map(i => ({ key: i.key, ids: blockOf(i) }));
    const from = blocks.findIndex(b => b.key === fromKey);
    const to = blocks.findIndex(b => b.key === toKey);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved);
    const placed = new Set(blocks.flatMap(b => b.ids));
    commit([...blocks.flatMap(b => b.ids), ...ids.filter(id => !placed.has(id))]);
  };
  const moveIn = (groupKey, fromId, toId) => {
    const group = items.find(i => i.key === groupKey);
    if (!group?.accounts) return;
    const list = group.accounts.map(a => a.id);
    const from = list.indexOf(fromId); const to = list.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
    // the group's places in the whole order stay; its accounts fill them in the new order
    const slots = ids.map((id, i) => (list.includes(id) ? i : -1)).filter(i => i >= 0);
    const next = [...ids];
    slots.forEach((slot, k) => { next[slot] = list[k]; });
    commit(next);
  };
  const end = () => { setDrag(null); setOver(null); };
  const handle = (kind, key, group = null) => ({
    draggable: true,
    onDragStart: e => { e.stopPropagation(); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); } catch {} setDrag({ kind, key, group }); },
    onDragEnd: end
  });
  const target = (kind, key, group = null) => ({
    onDragOver: e => { if (drag && drag.kind === kind && drag.group === group) { e.preventDefault(); if (over !== key) setOver(key); } },
    onDrop: e => {
      if (!drag || drag.kind !== kind || drag.group !== group) return;
      e.preventDefault();
      if (drag.key !== key) { if (kind === 'top') moveTop(drag.key, key); else moveIn(group, drag.key, key); }
      end();
    },
    className: over === key && drag && drag.key !== key ? 'drop-target' : ''
  });
  return {
    topHandle: key => handle('top', key), topRow: key => target('top', key),
    inHandle: (group, id) => handle('in', id, group), inRow: (group, id) => target('in', id, group),
    dragging: Boolean(drag)
  };
}
