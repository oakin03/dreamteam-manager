// Several targets at once (user 2026-11-28): the chosen accounts are split among the targets so
// every target gets an even share of each role (Satılabilir, Dummy, Side, Turnuva…). Within a role
// the accounts go round the targets in turn; the next role starts where the last one stopped, so
// the totals stay even too. Returns { [targetId]: [ids] } (a target may get none).
function splitByRole(ids, targets, roleOf = () => 'side') {
  const out = Object.fromEntries(targets.map(t => [t, []]));
  if (!targets.length) return out;
  const byRole = new Map();
  for (const id of ids) {
    if (targets.includes(id)) continue;
    const role = roleOf(id) || 'side';
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(id);
  }
  let k = 0;
  for (const list of byRole.values()) {
    for (const id of list) { out[targets[k % targets.length]].push(id); k++; }
  }
  return out;
}

module.exports = { splitByRole };
