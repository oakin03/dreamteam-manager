// After every player list update (11:05 TR): Auto Buy watch-list players that fell to
// their Base, or lost at least DROP_PCT of their value, are reported once a day with a
// Windows notification and an Activity entry.
const DROP_PCT = 10;

function watchAlerts(watch, players, previousById) {
  const byId = new Map(players.map(p => [p.id, p]));
  const out = [];
  for (const w of watch || []) {
    if (w.enabled === false) continue;
    const p = byId.get(w.playerId);
    if (!p) continue;
    const prev = previousById.get(p.id);
    const pct = p.previous ? Math.round((p.change / p.previous) * 1000) / 10 : 0;
    const becameBase = p.isBase && !(prev?.isBase);
    const dropped = p.change < 0 && -pct >= DROP_PCT;
    if (becameBase || dropped) out.push({ playerId: p.id, name: p.name, value: p.value, base: p.base, change: p.change, pct, becameBase, dropped });
  }
  return out;
}

module.exports = { watchAlerts, DROP_PCT };
