const crypto = require('crypto');
const { GameSocket } = require('./game-socket.cjs');

const DEFAULT_ROLES = [
  { id: 'sellable', name: 'Satılabilir', builtIn: true, color: '#2f855a' },
  { id: 'card', name: 'Kart', builtIn: true, color: '#c0392b' }
];

const MODIFIED_TEAM = 'MOD'; // the Cards page group of players with a user-given team

// The team a player counts for: the user's choice first, then the game's.
function effectiveTeamOf(player, customTeam) {
  if (customTeam === 'NONE') return null;
  if (customTeam) return customTeam;
  return player?.noTeam || player?.x ? null : (player?.team && player.team !== 'No Team' ? player.team : null);
}

const CUSTOM_ROLE_COLORS = ['#2563eb','#7c3aed','#d97706','#0f766e','#db2777','#4f46e5','#ea580c','#475569'];

function normalizeRoleColor(value, fallback = CUSTOM_ROLE_COLORS[0]) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
}

function normalizeRoles(raw) {
  const source = Array.isArray(raw) && raw.length ? raw : DEFAULT_ROLES;
  return source.map((role, index) => {
    const id = String(role?.id || `role-${index}`);
    const builtIn = role?.builtIn === true || id === 'sellable' || id === 'card';
    const fixed = id === 'sellable' ? '#2f855a' : id === 'card' ? '#c0392b' : null;
    return {
      ...role,
      id,
      name: String(role?.name || id).trim(),
      builtIn,
      color: fixed || normalizeRoleColor(role?.color, CUSTOM_ROLE_COLORS[index % CUSTOM_ROLE_COLORS.length])
    };
  });
}


function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactName(value) { return normalizeName(value).replace(/\s+/g, ''); }

function imageSlug(value) {
  const raw = String(value || '').split('?')[0];
  const last = raw.split('/').pop() || '';
  const slug = last.replace(/\.(webp|png|jpe?g)$/i, '').toLowerCase();
  if (!slug || ['no-face', 'noface', 'cardbg', 'avatar'].includes(slug)) return '';
  return slug;
}

function playerKeyOf(player) {
  const explicit = player?.playerId || player?.id || player?.externalId || player?.gameId;
  if (explicit) return `id:${String(explicit).trim()}`;
  const slug = player?.slug || imageSlug(player?.imagePath || player?.image || player?.src);
  if (slug && !['no-face', 'noface', 'cardbg'].includes(String(slug).toLowerCase())) return `slug:${String(slug).toLowerCase()}`;
  const name = compactName(player?.name);
  if (name) return `name:${name}`;
  return `unknown:${crypto.randomUUID()}`;
}

function namesMatch(a, b) {
  const aa = normalizeName(a);
  const bb = normalizeName(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const parse = value => value.split(' ').filter(Boolean);
  const pa = parse(aa), pb = parse(bb);
  const shortMatchesLong = (short, long) => {
    if (short.length < 2 || long.length < 2) return false;
    const first = short[0].replace(/\.$/, '');
    const last = short[short.length - 1];
    return first.length === 1 && long[0].startsWith(first) && long[long.length - 1] === last;
  };
  return shortMatchesLong(pa, pb) || shortMatchesLong(pb, pa);
}

// Team and grade change in game; neither is a player identity. The player
// portrait slug is shared by Cards, Scout and the Home roster. If it is
// missing or has changed, only an unambiguous name match is safe.
function resolvePlayer(players, subject) {
  const pool = (players || []).filter(p => p.active !== false);
  const unique = matches => matches.length === 1 ? matches[0] : null;
  const explicit = subject?.playerId || subject?.externalId || subject?.gameId;
  if (explicit) return unique(pool.filter(p => String(p.playerId || p.externalId || p.gameId || p.id || '') === String(explicit)));
  const slug = imageSlug(subject?.imagePath || subject?.image || subject?.src) ||
    (String(subject?.slug || '').replace(/^slug:/, '').toLowerCase());
  if (slug) {
    const imageMatches = pool.filter(p => (p.slug || imageSlug(p.imagePath || p.image || p.src)) === slug);
    if (imageMatches.length === 1) {
      const match=imageMatches[0];
      return !subject?.name || !match.name || namesMatch(match.name,subject.name) ? match : null;
    }
    if (imageMatches.length > 1) {
      const exactName=normalizeName(subject?.name);
      if (!exactName) return null;
      const exactMatches=imageMatches.filter(p=>normalizeName(p.name)===exactName);
      if (exactMatches.length) return unique(exactMatches);
      return unique(imageMatches.filter(p=>namesMatch(p.name,subject.name)));
    }
  }
  const exact = normalizeName(subject?.name);
  if (!exact) return null;
  const exactMatches = pool.filter(p => normalizeName(p.name) === exact);
  if (exactMatches.length) return unique(exactMatches);
  return unique(pool.filter(p => namesMatch(p.name, subject.name)));
}

function disambiguatePlayerKeys(players) {
  const groups=new Map();
  for(const player of players){
    const key=player.key||playerKeyOf(player);
    groups.set(key,(groups.get(key)||0)+1);
  }
  const seen=new Set();
  return players.map(player=>{
    const base=player.key||playerKeyOf(player);
    const name=compactName(player.name);
    if(groups.get(base)>1 && !name)
      throw new Error(`Kart oyuncularının ortak görseli var, isimleri okunamadı (${base}). Tarama kayıtları değiştirmedi.`);
    const key=groups.get(base)>1?`${base}|name:${name}`:base;
    if(seen.has(key))throw new Error(`İki kart oyuncusu güvenli biçimde ayrılamadı (${key}). Roller korunarak tarama durduruldu.`);
    seen.add(key);
    return {...player,key};
  });
}

function normalizeData(raw) {
  const result = { version: 2, updatedAt: raw?.updatedAt || null, players: {} };
  const source = Array.isArray(raw) ? raw : Array.isArray(raw?.players) ? raw.players : Object.values(raw?.players || {});
  for (const player of source) {
    if (!player || typeof player !== 'object') continue;
    const key = player.key || playerKeyOf(player);
    result.players[key] = {
      ...player,
      key,
      stars: Math.max(0, Number(player.stars ?? player.cardStars ?? 0)),
      cardCount: Math.max(0, Number(player.cardCount ?? player.count ?? 0)),
      active: player.active !== false
    };
  }
  return result;
}

function normalizeMetadata(raw) {
  return {
    version: 2,
    players: raw?.players && typeof raw.players === 'object' ? raw.players : {},
    trackedTeams: Array.isArray(raw?.trackedTeams) ? raw.trackedTeams : []
  };
}

// Everything below is executed inside the game page through page.evaluate().
// Keep these helpers self-contained: they must not reference Node-side helpers.
function readMyPlayerCardTiles() {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const playerPath = image => {
    let src = image?.getAttribute('src') || '';
    if (src.includes('/_next/image')) {
      try { src = new URL(src, location.href).searchParams.get('url') || src; } catch {}
    }
    const path=src.replace(/^https?:\/\/[^/]+/i,'').split('?')[0];
    return /^\/?players\//i.test(path)?`/${path.replace(/^\/+/, '')}`:'';
  };
  const backgrounds = [...document.querySelectorAll('main .aspect-square img[alt="Card Background"]')];
  const cards = [];
  const seen = new Set();
  for (const bg of backgrounds) {
    const card = bg.closest('.aspect-square');
    if (!card || seen.has(card)) continue;
    seen.add(card);
    const imgs = [...card.querySelectorAll('img')];
    const playerImg = imgs.find(img => clean(img.getAttribute('alt')) && clean(img.getAttribute('alt')) !== 'Card Background' && playerPath(img));
    if (!playerImg) continue;
    const allText = clean(card.textContent);
    const qm = allText.match(/[×x]\s*(\d+)/i);
    const quantity = qm ? Math.max(1, Number(qm[1])) : 1;
    const starSpans = [...card.querySelectorAll('span')].filter(el => clean(el.textContent) === '★');
    const level = Math.max(1, starSpans.filter(el => /text-amber-400/.test(el.className || '')).length || 1);
    const texts = [...card.querySelectorAll('div,span')].map(el => clean(el.textContent)).filter(Boolean);
    const grade = texts.find(v => /^(S\+|S|S-|A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|N)$/.test(v)) || '';
    cards.push({
      index: cards.length,
      name: clean(playerImg.getAttribute('alt')),
      imagePath: playerPath(playerImg),
      level,
      quantity,
      grade
    });
  }
  return cards;
}

function readMyPlayerPager() {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const heading = [...document.querySelectorAll('h2')].find(el => clean(el.textContent) === 'My Star Cards');
  if (!heading) return null;
  let root = heading.parentElement;
  while (root && !root.querySelector('button[aria-label="Next page"], button[aria-label="Previous page"]')) root = root.parentElement;
  if (!root) return null;
  const texts = [...root.querySelectorAll('span')].map(el => clean(el.textContent));
  const pager = texts.find(v => /^\d+\s*\/\s*\d+$/.test(v));
  const m = pager?.match(/(\d+)\s*\/\s*(\d+)/);
  const next = root.querySelector('button[aria-label="Next page"]');
  const prev = root.querySelector('button[aria-label="Previous page"]');
  return {
    current: m ? Number(m[1]) : 1,
    total: m ? Number(m[2]) : 1,
    nextDisabled: !next || next.disabled || next.getAttribute('aria-disabled') === 'true',
    prevDisabled: !prev || prev.disabled || prev.getAttribute('aria-disabled') === 'true'
  };
}

// ---------- Star card rules ----------
// Activating a card uses it up and sets the player's stars to the card's
// level, so a 0★ player is taken straight to 2★ with one L2 card, and a 1★
// player gains nothing toward 2★ from the card already used. Cards are
// counted in L1 equivalents (L1=1, L2=4, L3=16 …): 4 cards of the same
// player synthesize into that player's next level card. Up to 2★ this is
// certain; from 2★ upward a synthesis can fail (75%).
const LEVEL_WEIGHT = level => 4 ** (Math.max(1, Number(level)) - 1);
function cardEquivalent(levels) {
  return Object.entries(levels || {}).reduce((sum, [level, qty]) => sum + LEVEL_WEIGHT(level) * Math.max(0, Number(qty) || 0), 0);
}

function cardProgress(actualStars, levelsOrCount) {
  const stars = Math.max(0, Math.min(5, Number(actualStars || 0)));
  const current = typeof levelsOrCount === 'number' ? Math.max(0, levelsOrCount) : cardEquivalent(levelsOrCount);
  if (stars >= 5) return { actualStars: stars, targetStars: null, current, required: null, ready: false, guaranteed: false, maxed: true };
  const targetStars = stars < 2 ? 2 : stars + 1;
  const required = LEVEL_WEIGHT(targetStars);
  return { actualStars: stars, projectedStars: stars, targetStars, current, required, ready: current >= required, guaranteed: targetStars <= 2 };
}
const directNextProgress = cardProgress;

class CardsService {
  constructor({ store, activity, accountProfile = null, sessions = null, createSocket, onChanged, rosterConcurrency = 4 }) {
    this.store = store;
    this.activity = activity;
    this.accountProfile = accountProfile;
    this.sessions = sessions;
    this.createSocket = createSocket;
    this.onChanged = onChanged;
    this.rosterConcurrency = rosterConcurrency;
    this.runtime = { status: 'idle', message: '', step: null, stepParams: {}, scannedTeams: 0, scannedPlayers: 0, inventoryCards: 0 };
    this.scanning = false;
    this._ensureDefaults();
  }

  _ensureDefaults() {
    this.store.saveCardRoles(normalizeRoles(this.store.getCardRoles()));
    this.store.saveCards(normalizeData(this.store.getCards()));
    this.store.saveCardMetadata(normalizeMetadata(this.store.getCardMetadata()));
  }

  _roles() { return normalizeRoles(this.store.getCardRoles()); }
  _metadata() { return normalizeMetadata(this.store.getCardMetadata()); }
  _data() { return normalizeData(this.store.getCards()); }

  _playerView(player, metadata, roles) {
    const meta = metadata.players[player.key] || {};
    const roleIds = Array.isArray(meta.roleIds) ? meta.roleIds : [];
    return {
      ...player,
      // A team the user gave this player (e.g. a No Team player → LAL). Auto Trade
      // treats the player as on that team; this page lists it under "Değiştirilmiş".
      customTeam: meta.customTeam || null,
      // The team that counts (Auto Trade): "NONE" = removed from its team.
      effectiveTeam: effectiveTeamOf(player, meta.customTeam),
      progress: player.noTeam ? null : cardProgress(player.stars, player.cards || player.cardCount),
      roleIds,
      roles: roleIds.map(id => roles.find(r => r.id === id)).filter(Boolean)
    };
  }

  snapshot() {
    const revision = typeof this.store.revision === 'function'
      ? [this.store.revision('cards'), this.store.revision('cardMetadata'), this.store.revision('cardRoles')].join(':')
      : null;
    if (revision !== null && this._snapshotRevision === revision) return { ...this._snapshot, scanRuntime: { ...this.runtime } };
    const data = this._data();
    const metadata = this._metadata();
    const roles = this._roles();
    const players = Object.values(data.players).filter(p => p.active !== false).map(p => this._playerView(p, metadata, roles));
    const teamMap = new Map();
    for (const player of players) {
      if (player.noTeam && !player.customTeam) continue;
      const team = player.customTeam ? MODIFIED_TEAM : (String(player.team || '—').trim() || '—');
      if (!teamMap.has(team)) teamMap.set(team, { players: [], teamName: player.customTeam ? 'Değiştirilmiş' : (player.teamName || team), teamId: player.customTeam ? null : (player.teamId ?? null) });
      teamMap.get(team).players.push(player);
    }
    const teams = [...teamMap.entries()].map(([team, entry]) => {
      const teamPlayers = entry.players;
      const star = teamPlayers.length ? Math.min(...teamPlayers.map(p => Math.max(0, Number(p.stars || 0)))) : 0;
      const blockers = teamPlayers.filter(p => Number(p.stars || 0) === star);
      return {
        team, teamName: entry.teamName, teamId: entry.teamId, x: team === 'X', modified: team === MODIFIED_TEAM,
        star,
        playerCount: teamPlayers.length,
        blockerCount: blockers.length,
        readyCount: blockers.filter(p => p.progress?.ready).length,
        blockers: blockers.map(p => ({ key: p.key, name: p.name, stars: p.stars, progress: p.progress, raisesTeamIfUpgraded: blockers.length === 1 }))
      };
    }).sort((a, b) => (a.modified - b.modified) || (a.x - b.x) || a.team.localeCompare(b.team));

    this._snapshot = {
      scannerReady: Boolean(this.sessions && this.accountProfile),
      updatedAt: data.updatedAt,
      players,
      roles,
      trackedTeams: metadata.trackedTeams,
      teams
    };
    this._snapshotRevision = revision;
    return { ...this._snapshot, scanRuntime: { ...this.runtime } };
  }

  _setRuntime(patch) {
    Object.assign(this.runtime, patch);
    this.onChanged?.();
  }

  _accountById(id) {
    const account = this.store.getAccounts().find(a => a.id === id);
    if (!account) throw new Error('Ana hesap bulunamadı.');
    return account;
  }

  _mainAccount() {
    const mainId = this.accountProfile?.snapshot?.().mainAccountId || this.store.getAccountProfile()?.mainAccountId;
    if (!mainId) throw new Error('Önce Ana Hesap seçmelisin.');
    return this._accountById(mainId);
  }

  _log(account, level, message, code = null, params = null) {
    this.activity?.add({ level, accountId: account?.id || 'cards', accountName: account?.name || '', taskName: 'Cards', message, code, params });
  }

  addRole(name, color = CUSTOM_ROLE_COLORS[0]) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Rol adı gerekli.');
    const roles = this._roles();
    const role = { id: `role-${crypto.randomUUID()}`, name: clean, builtIn: false, color: normalizeRoleColor(color, CUSTOM_ROLE_COLORS[roles.length % CUSTOM_ROLE_COLORS.length]) };
    roles.push(role);
    this.store.saveCardRoles(roles);
    this.onChanged?.();
    return role;
  }

  updateRole(id, patch) {
    const roles = this._roles();
    const role = roles.find(r => r.id === id);
    if (!role) throw new Error('Rol bulunamadı.');
    const payload = typeof patch === 'string' ? { name: patch } : (patch || {});
    if (payload.name != null) {
      const clean = String(payload.name || '').trim();
      if (!clean) throw new Error('Rol adı gerekli.');
      role.name = clean;
    }
    if (!role.builtIn && payload.color != null) role.color = normalizeRoleColor(payload.color, role.color);
    if (role.id === 'sellable') role.color = '#2f855a';
    if (role.id === 'card') role.color = '#c0392b';
    this.store.saveCardRoles(roles);
    this.onChanged?.();
    return role;
  }

  deleteRole(id) {
    const roles = this._roles();
    if (!roles.some(r => r.id === id)) return true;
    this.store.saveCardRoles(roles.filter(r => r.id !== id));
    const metadata = this._metadata();
    for (const meta of Object.values(metadata.players)) if (Array.isArray(meta.roleIds)) meta.roleIds = meta.roleIds.filter(x => x !== id);
    this.store.saveCardMetadata(metadata);
    this.onChanged?.();
    return true;
  }

  setPlayerRoles(playerKey, roleIds) {
    const data = this._data();
    if (!data.players[playerKey]) throw new Error('Oyuncu bulunamadı.');
    const valid = new Set(this._roles().map(r => r.id));
    const metadata = this._metadata();
    metadata.players[playerKey] = { ...(metadata.players[playerKey] || {}), roleIds: [...new Set((roleIds || []).filter(id => valid.has(id)))], updatedAt: new Date().toISOString() };
    this.store.saveCardMetadata(metadata);
    this.onChanged?.();
    return true;
  }

  // Roles by player id for any game player (the Oyuncular page lists more players
  // than the Cards page); the same record the Cards page reads.
  setRolesById(playerId, roleIds) {
    const key = `id:${String(playerId || '').trim()}`;
    if (key === 'id:') throw new Error('Oyuncu bulunamadı.');
    const valid = new Set(this._roles().map(r => r.id));
    const metadata = this._metadata();
    metadata.players[key] = { ...(metadata.players[key] || {}), roleIds: [...new Set((roleIds || []).filter(id => valid.has(id)))], updatedAt: new Date().toISOString() };
    this.store.saveCardMetadata(metadata);
    this.onChanged?.();
    return true;
  }

  // team: an abbreviation like "LAL" (give a team), "NONE" (take it out of its
  // team = No Team), or null (undo: back to the game's own team).
  setCustomTeam(playerKey, team) {
    const metadata = this._metadata();
    const value = team ? String(team).trim().toUpperCase() : null;
    if (value && (value === MODIFIED_TEAM || value === 'X')) throw new Error('Bu takım atanamaz.');
    const entry = { ...(metadata.players[playerKey] || {}) };
    if (value) entry.customTeam = value; else delete entry.customTeam;
    entry.updatedAt = new Date().toISOString();
    metadata.players[playerKey] = entry;
    this.store.saveCardMetadata(metadata);
    this.onChanged?.();
    return true;
  }

  setTrackedTeams(teams) {
    const metadata = this._metadata();
    metadata.trackedTeams = [...new Set((teams || []).map(x => String(x).trim()).filter(Boolean))];
    this.store.saveCardMetadata(metadata);
    this.onChanged?.();
    return metadata.trackedTeams;
  }

  resetData() {
    this.store.saveCards({ version: 2, updatedAt: null, players: {} });
    // Reset is stronger than Refresh: player roles and followed teams go too,
    // the role definitions stay.
    const metadata = this._metadata();
    metadata.players = {};
    metadata.trackedTeams = [];
    this.store.saveCardMetadata(metadata);
    this._setRuntime({ status: 'idle', message: '', step: null, scannedTeams: 0, scannedPlayers: 0, inventoryCards: 0 });
    return true;
  }

  // Replaces the game-derived player list. Roles live in card-metadata.json
  // under the player key ("id:<playerId>"). Roles saved under an older key
  // (portrait slug, per-level No Team keys) move to the new key once, when
  // exactly one scanned player claims that old key.
  syncPlayers(incomingPlayers) {
    if (!Array.isArray(incomingPlayers)) throw new Error('Kart oyuncu listesi geçersiz.');
    const keys = new Set();
    for (const incoming of incomingPlayers) {
      const key = incoming.key || playerKeyOf(incoming);
      if (keys.has(key)) throw new Error(`Kart taramasında iki oyuncu aynı kimlikle bulundu (${key}). Roller korunarak tarama durduruldu.`);
      keys.add(key);
    }
    const data = this._data();
    const metadata = this._metadata();
    const now = new Date().toISOString();
    const claims = new Map();
    for (const incoming of incomingPlayers) for (const legacy of incoming.legacyKeys || []) claims.set(legacy, (claims.get(legacy) || 0) + 1);
    let migrated = 0;
    const next = {};
    for (const incoming of incomingPlayers) {
      const key = incoming.key || playerKeyOf(incoming);
      const previous = data.players[key] || {};
      const { legacyKeys = [], ...clean } = incoming;
      next[key] = { ...previous, ...clean, key, active: true, firstSeenAt: previous.firstSeenAt || now, lastSeenAt: now };
      if (!metadata.players[key]?.roleIds?.length) {
        const legacy = legacyKeys.find(old => claims.get(old) === 1 && metadata.players[old]?.roleIds?.length);
        if (legacy) {
          metadata.players[key] = { ...metadata.players[legacy], migratedFrom: legacy, migratedAt: now };
          migrated++;
        }
      }
    }
    for (const incoming of incomingPlayers) for (const legacy of incoming.legacyKeys || []) if (claims.get(legacy) === 1) delete metadata.players[legacy];
    // Second pass for old keys no player claimed (a changed portrait, or the
    // oldest "name:" keys): move the role only when the full name points to
    // exactly one non-X player that has no role yet.
    const byName = new Map();
    for (const incoming of incomingPlayers) {
      if (incoming.x) continue;
      const name = normalizeName(incoming.name);
      if (name) byName.set(name, byName.has(name) ? null : incoming);
    }
    for (const [oldKey, meta] of Object.entries(metadata.players)) {
      if (oldKey.startsWith('id:') || !meta?.roleIds?.length) continue;
      const oldName = data.players[oldKey]?.name || (oldKey.startsWith('name:') ? oldKey.slice(5) : '');
      const target = byName.get(normalizeName(oldName));
      if (!target) continue;
      const key = target.key || playerKeyOf(target);
      if (metadata.players[key]?.roleIds?.length) continue;
      metadata.players[key] = { ...meta, migratedFrom: oldKey, migratedAt: now };
      delete metadata.players[oldKey];
      migrated++;
    }
    // Players that disappeared from the game stay (inactive) so their roles survive a season change.
    for (const [key, player] of Object.entries(data.players)) {
      if (!next[key] && key.startsWith('id:')) next[key] = { ...player, active: false };
    }
    data.players = next;
    data.updatedAt = now;
    this.store.saveCards(data);
    this.store.saveCardMetadata(metadata);
    this.onChanged?.();
    this._lastMigrated = migrated;
    return this.snapshot();
  }

  // ---------- Scan over the game's socket ----------
  async _fetchAll(account, signal) {
    const session = await this.sessions.get(account, { owner: 'cards', log: (level, message) => this._log(account, level, message) });
    const userId = session.userId;
    const open = () => GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
    const main = await open();
    const sockets = [main];
    try {
      this._setRuntime({ status: 'scanning', step: 'teams', stepParams: {} });
      const teams = (await main.call('starcard:getTeams', { userId }, 'starcard:teams', { signal }))?.teams || [];
      if (!teams.length) throw new Error('No star card teams in the reply.');
      this._setRuntime({ step: 'inventory', stepParams: {} });
      const inventory = (await main.call('starcard:getUserStarCards', { userId }, 'starcard:userStarCards', { timeoutMs: 30000, signal }))?.inventory || [];
      // Rosters in parallel over a few sockets (each socket answers in order).
      while (sockets.length < Math.min(this.rosterConcurrency, teams.length)) sockets.push(await open());
      const rosters = new Map();
      let next = 0;
      await Promise.all(sockets.map(async socket => {
        while (next < teams.length) {
          const team = teams[next++];
          const reply = await socket.call('starcard:getTeamRoster', { teamId: team.id, userId }, 'starcard:teamRoster', { signal });
          if (Number(reply?.teamId) !== Number(team.id)) throw new Error(`Roster reply for team ${team.id} did not match.`);
          rosters.set(team.id, reply.players || []);
          this._setRuntime({ step: 'rosters', stepParams: { done: rosters.size, total: teams.length }, scannedTeams: rosters.size });
        }
      }));
      return { teams, inventory, rosters };
    } finally {
      for (const socket of sockets) socket.close();
    }
  }

  async refresh() {
    if (this.scanning) throw new Error('Kart taraması zaten çalışıyor.');
    if (!this.sessions || !this.accountProfile) throw new Error('Kart tarayıcı servisi hazır değil.');
    const account = this._mainAccount();
    this.scanning = true;
    const startedAt = Date.now();
    this._setRuntime({ status: 'starting', step: 'login', stepParams: {}, message: '', scannedTeams: 0, scannedPlayers: 0, inventoryCards: 0 });
    this._log(account, 'info', 'Cards scan starting…', 'cd.started');
    try {
      const { teams, inventory, rosters } = await this._fetchAll(account, null);
      const players = buildCardPlayers(teams, inventory, rosters);
      const result = this.syncPlayers(players);
      const counts = {
        players: players.filter(p => !p.noTeam).length,
        noTeam: players.filter(p => p.noTeam).length,
        cards: inventory.reduce((sum, c) => sum + (Number(c.quantity) || 1), 0),
        teams: teams.length,
        seconds: Math.round((Date.now() - startedAt) / 100) / 10,
        migrated: this._lastMigrated || 0
      };
      this._setRuntime({ status: 'done', step: 'done', stepParams: counts, message: `${counts.players} oyuncu`, scannedPlayers: players.length, inventoryCards: counts.cards });
      this._log(account, 'success', `Cards scan completed · ${counts.teams} teams · ${counts.players} players · ${counts.noTeam} No Team · ${counts.cards} cards · ${counts.seconds}s.`, 'cd.done', counts);
      if (counts.migrated) this._log(account, 'info', `${counts.migrated} player role(s) moved to the new player ids.`, 'cd.migrated', { count: counts.migrated });
      return result;
    } catch (error) {
      this._setRuntime({ status: 'error', step: 'error', stepParams: { error: error.message }, message: error.message });
      this._log(account, 'error', `Cards: ${error.message}`, 'cd.failed', { error: error.message });
      throw error;
    } finally {
      this.scanning = false;
      this.onChanged?.();
    }
  }

  // Scout agents come from the socket with the game's player id; only that id matches.
  findForScout(agent) {
    if (!agent?.playerId) return null;
    const snap = this.snapshot();
    const player = snap.players.find(p => p.active !== false && !p.noTeam && p.playerId === agent.playerId);
    if (!player) return null;
    const team = snap.teams.find(t => t.team === player.team);
    const blocker = team?.blockers?.find(b => b.key === player.key);
    return {
      key: player.key,
      team: player.team || null,
      stars: Number(player.stars || 0),
      cardCount: Number(player.cardCount || 0),
      progress: player.progress,
      roleIds: player.roleIds,
      roles: player.roles,
      teamStar: team?.star ?? null,
      teamBlockerCount: team?.blockerCount ?? null,
      teamCritical: Boolean(blocker),
      raisesTeamIfUpgraded: Boolean(blocker?.raisesTeamIfUpgraded)
    };
  }
}

// One entry per roster player (keyed by playerId) plus one per No Team card
// owner. Stars come from the roster, cards from the inventory by playerId.
function buildCardPlayers(teams, inventory, rosters) {
  const teamById = new Map(teams.map(t => [Number(t.id), t]));
  const owned = new Map();
  for (const stack of inventory) {
    const item = stack.item || {};
    const linked = item.linkedPlayer || {};
    const playerId = item.linkedPlayerId || linked.id;
    if (!playerId) continue;
    if (!owned.has(playerId)) owned.set(playerId, { levels: {}, item, linked });
    const entry = owned.get(playerId);
    const level = Number(item.level) || 1;
    entry.levels[level] = (entry.levels[level] || 0) + (Number(stack.quantity) || 1);
  }
  const players = [];
  const seen = new Set();
  for (const [teamId, roster] of rosters) {
    const team = teamById.get(Number(teamId)) || {};
    for (const row of roster) {
      const p = row.player || {};
      const playerId = row.playerId || p.id;
      if (!playerId || seen.has(playerId)) continue;
      seen.add(playerId);
      const cards = owned.get(playerId)?.levels || {};
      const slug = imageSlug(p.avatarUrl);
      players.push({
        key: `id:${playerId}`, playerId, name: p.name || '', grade: p.rating || '', position: p.position || '',
        type: p.type || null, x: p.type === 'XPLAYER',
        team: team.abbreviation || String(teamId), teamName: team.name || '', teamId: Number(teamId),
        stars: Math.max(0, Number(row.currentLevel) || 0), cardsUsed: Number(row.totalCardsUsed) || 0,
        cards, cardCount: cardEquivalent(cards), inventoryLevels: cards,
        imagePath: p.avatarUrl || '', slug: slug || undefined,
        // Older saves keyed normal players by portrait slug.
        legacyKeys: slug && p.type !== 'XPLAYER' ? [`slug:${slug}`] : []
      });
    }
  }
  for (const [playerId, entry] of owned) {
    if (seen.has(playerId)) continue;
    const linked = entry.linked;
    if ((linked.starCardTeamAssignment || []).length) continue;
    const slug = imageSlug(entry.item.icon);
    const levels = Object.keys(entry.levels);
    players.push({
      key: `id:${playerId}`, playerId, name: linked.name || entry.item.name || '', grade: linked.rating || '', position: linked.position || '',
      type: linked.type || null, x: linked.type === 'XPLAYER', noTeam: true,
      team: 'No Team', teamName: 'No Team', teamId: null, stars: null,
      cards: entry.levels, cardCount: cardEquivalent(entry.levels), inventoryLevels: entry.levels,
      imagePath: entry.item.icon || '', slug: slug || undefined,
      legacyKeys: slug ? [`slug:${slug}`, ...levels.map(level => `slug:${slug}|no-team-star:${level}`)] : []
    });
  }
  return players;
}

module.exports = { CardsService, effectiveTeamOf, MODIFIED_TEAM, DEFAULT_ROLES, cardProgress, directNextProgress, cardEquivalent, buildCardPlayers, playerKeyOf, namesMatch, resolvePlayer, disambiguatePlayerKeys, readMyPlayerPager, readMyPlayerCardTiles };
