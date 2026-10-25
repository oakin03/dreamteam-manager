import React, { Children, cloneElement, isValidElement, useState } from 'react';

// Drop-in <table> that sorts by any column: click a header (again to flip). It reads
// the cells' rendered text, so existing tables need no extra data:
// numbers ("44.465", "7.200 / 7.000", "+20", "2/3", "12%") sort as numbers, dates
// ("23.10.2026 21:00") and times ("21:01:47") chronologically, the rest by text (tr).
// Empty / "—" cells always go last. A row whose first cell spans columns (a detail row)
// stays under the row above it. Headers with their own onClick, empty headers and
// `data-nosort` headers are left alone. Rows drawn by a component pass sortValues.

const flat = node => Children.toArray(node);

// Visible text of a React node (inputs: their value; badges: their children).
export function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isValidElement(node)) {
    const p = node.props || {};
    if (p['data-sort'] != null) return String(p['data-sort']);
    if (node.type === 'input' || node.type === 'select') return p.type === 'checkbox' ? (p.checked ? '1' : '0') : String(p.value ?? '');
    if (p.children != null) return textOf(p.children);
    return String(p.value ?? p.title ?? p.label ?? p.name ?? p.role?.name ?? '');
  }
  return '';
}

const DATE_RE = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

// Comparable key: [kind, value] with kind 0 = number, 1 = text, 2 = empty.
export function sortKey(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s || s === '—' || s === '-' || s === '–') return [2, 0];
  const d = DATE_RE.exec(s);
  if (d) return [0, Date.UTC(+d[3], +d[2] - 1, +d[1], +(d[4] || 0), +(d[5] || 0), +(d[6] || 0))];
  const t = TIME_RE.exec(s);
  if (t) return [0, (+t[1]) * 3600 + (+t[2]) * 60 + (+(t[3] || 0))];
  const m = /^[^\d\-+]{0,4}([-+]?\d[\d.,]*)/.exec(s);
  if (m) {
    let n = m[1];
    if (/^[-+]?\d+[.,]\d{1,2}$/.test(n) && !/^[-+]?\d{1,3}[.,]\d{3}$/.test(n)) n = n.replace(',', '.');
    else n = n.replace(/[.,]/g, '');
    const v = Number(n);
    if (Number.isFinite(v)) return [0, v];
  }
  return [1, s.toLocaleLowerCase('tr')];
}

function compare(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[0] === 0) return a[1] - b[1];
  if (a[0] === 1) return a[1].localeCompare(b[1], 'tr', { numeric: true });
  return 0;
}

const cellsOf = row => (isValidElement(row) ? flat(row.props.children).filter(isValidElement) : []);
const isDetailRow = row => { const c = cellsOf(row); return c.length > 0 && Number(c[0].props.colSpan) > 1; };

export default function SortTable({ children, className, ...rest }) {
  const [sort, setSort] = useState(null); // { col, dir: 1 | -1 }
  const parts = flat(children);
  const head = parts.find(p => isValidElement(p) && p.type === 'thead');
  const body = parts.find(p => isValidElement(p) && p.type === 'tbody');
  if (!head || !body) return <table className={className} {...rest}>{children}</table>;

  const headRow = flat(head.props.children).find(isValidElement);
  const ths = headRow ? flat(headRow.props.children).filter(isValidElement) : [];
  const hasControl = node => flat(node).some(n => isValidElement(n) && (['input', 'select', 'button'].includes(n.type) || (n.props?.children != null && hasControl(n.props.children))));
  const sortable = th => !th.props.onClick && th.props['data-nosort'] == null && !hasControl(th.props.children) && textOf(th.props.children).trim() !== '';
  const toggle = col => setSort(s => (s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }));
  const newThs = ths.map((th, col) => {
    // A header with its own sorting (the page sorts its data): that sort takes over.
    if (th.props.onClick) return cloneElement(th, { key: th.key ?? col, onClick: e => { setSort(null); th.props.onClick(e); } });
    if (!sortable(th)) return th;
    const active = sort?.col === col;
    return cloneElement(th, {
      key: th.key ?? col,
      className: `${th.props.className || ''} st-sortable${active ? ' st-active' : ''}`.trim(),
      onClick: () => toggle(col),
      title: th.props.title,
      children: <>{th.props.children}<span className="st-arrow">{active ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span></>
    });
  });
  const newHead = cloneElement(head, {}, cloneElement(headRow, {}, newThs));

  let rows = flat(body.props.children);
  if (sort) {
    // Group detail rows with the row above, sort the groups, keep ties in their order.
    const groups = [];
    for (const r of rows) {
      if (groups.length && isDetailRow(r)) groups[groups.length - 1].rows.push(r);
      // A row drawn by its own component passes its values as sortValues={[...]} (one per column).
      else groups.push({ rows: [r], key: sortKey(Array.isArray(r.props?.sortValues) ? r.props.sortValues[sort.col] : textOf(cellsOf(r)[sort.col]?.props.children)) });
    }
    groups.forEach((g, i) => { g.i = i; });
    groups.sort((a, b) => {
      const ea = a.key[0] === 2, eb = b.key[0] === 2;
      if (ea !== eb) return ea ? 1 : -1;
      return compare(a.key, b.key) * sort.dir || a.i - b.i;
    });
    rows = groups.flatMap(g => g.rows);
  }
  return <table className={className} {...rest}>{newHead}{cloneElement(body, {}, rows)}</table>;
}
