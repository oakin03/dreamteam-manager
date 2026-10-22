// Pure Star Card synthesis rules (no I/O). A "stack" is one inventory row:
// { inventoryId, itemId, playerId, name, level, quantity, noTeam, x }.
// Team or No Team comes from the game (starCardTeamAssignment), X players are never used.
const LEVELS = [1, 2, 3, 4];   // synthesis from level L to L+1

// One `starcard:userStarCards` inventory row → stack (null for anything that is not a usable card).
function stackFrom(row) {
  const item = row?.item || {};
  const p = item.linkedPlayer || {};
  const level = Number(item.level);
  const quantity = Number(row?.quantity ?? 1);
  const playerId = item.linkedPlayerId || p.id;
  if (!playerId || !(level >= 1) || !(quantity > 0)) return null;
  return {
    inventoryId: row.id,
    itemId: row.itemId || item.id,
    playerId,
    name: String(p.visualName || p.name || '').trim(),
    rating: p.rating || null,
    level,
    quantity,
    noTeam: !(Array.isArray(p.starCardTeamAssignment) && p.starCardTeamAssignment.length),
    x: p.type === 'XPLAYER' || String(p.rating).toUpperCase() === 'X'
  };
}

function stacksFrom(inventory) { return (inventory || []).map(stackFrom).filter(Boolean); }

// Team players: a stack with at least 4 cards of the same player at `level`.
// Every group of 4 is one synthesis (9 cards → 2).
function teamCandidates(stacks, level) {
  return stacks.filter(s => !s.x && !s.noTeam && s.level === level && s.quantity >= 4)
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
}

// No Team players: the game lists them by quantity (most first), then alphabetically;
// the first four different players in that order are used. null = fewer than 4 left.
function noTeamPick(stacks, level) {
  const list = stacks.filter(s => !s.x && s.noTeam && s.level === level && s.quantity >= 1)
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (seen.has(s.playerId)) continue;
    seen.add(s.playerId);
    out.push(s);
    if (out.length === 4) return out;
  }
  return null;
}

// The four cards sent to the game: one entry per card.
function selectedCards(stacks) {
  return stacks.map(s => ({ inventoryId: s.inventoryId, itemId: s.itemId, linkedPlayerId: s.playerId, level: s.level }));
}

module.exports = { LEVELS, stackFrom, stacksFrom, teamCandidates, noTeamPick, selectedCards };
