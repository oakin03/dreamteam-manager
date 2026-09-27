const crypto = require('crypto');

const DEFAULT_ROLES = [
  { id: 'sellable', name: 'Satılabilir', builtIn: true, color: '#2f855a' },
  { id: 'card', name: 'Kart', builtIn: true, color: '#c0392b' }
];

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

const STAR_CARD_SELECTOR = 'img[alt="Star Card"], img[src*="/ui/star_card.webp"]';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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
function resolvePlayer(players, subject, { requirePortrait = false } = {}) {
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
    // A Scout portrait absent from Cards is often an older player. Never
    // transfer a role from a different portrait with the same abbreviated name.
    if (requirePortrait) return null;
  }
  const exact = normalizeName(subject?.name);
  if (!exact) return null;
  const exactMatches = pool.filter(p => normalizeName(p.name) === exact);
  if (exactMatches.length) return unique(exactMatches);
  if (requirePortrait) return null;
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

function targetCostForStar(currentStar) {
  const star = Math.max(0, Number(currentStar || 0));
  if (star === 0) return 1;
  if (star === 1) return 4;
  return 4 ** star;
}

function directNextProgress(actualStars, rawCount) {
  const stars = Math.max(0, Math.min(5, Number(actualStars || 0)));
  const current = Math.max(0, Number(rawCount || 0));
  if (stars >= 5) return { actualStars: stars, targetStars: null, current, required: null, ready: false, maxed: true };
  const required = targetCostForStar(stars);
  return { actualStars: stars, targetStars: stars + 1, current, required, ready: current >= required, guaranteed: stars < 2 };
}

function cardProgress(actualStars, rawCount) {
  let stars = Math.max(0, Math.min(5, Number(actualStars || 0)));
  let remaining = Math.max(0, Number(rawCount || 0));
  const actual = stars;

  // 0★ -> 1★ and 1★ -> 2★ are guaranteed. For display purposes we can
  // virtually consume cards through those two stages. From 2★ upward a
  // synthesis can fail, so we never project past the actual star level.
  while (stars < 2 && stars < 5) {
    const need = targetCostForStar(stars);
    if (remaining < need) {
      return {
        actualStars: actual,
        projectedStars: stars,
        targetStars: stars + 1,
        current: remaining,
        required: need,
        ready: false,
        guaranteed: true
      };
    }
    remaining -= need;
    stars += 1;
  }

  if (stars >= 5) {
    return {
      actualStars: actual,
      projectedStars: stars,
      targetStars: null,
      current: remaining,
      required: null,
      ready: false,
      guaranteed: false,
      maxed: true
    };
  }

  const required = targetCostForStar(stars);
  return {
    actualStars: actual,
    projectedStars: stars,
    targetStars: stars + 1,
    current: remaining,
    required,
    ready: remaining >= required,
    guaranteed: false
  };
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
function readActivateTeamPanel() {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const heading = [...document.querySelectorAll('h3')].find(el => clean(el.textContent) === 'Select Team');
  if (!heading) return null;
  let panel = heading.parentElement;
  // The pager lives in the header row while the team buttons live one level
  // higher. Require both so we do not stop at the header and accidentally
  // report an empty team list.
  while (panel && !(
    panel.querySelector('button[aria-label="Next page"], button[aria-label="Previous page"]') &&
    panel.querySelector('img[src*="/LOGOS/"]')
  )) panel = panel.parentElement;
  if (!panel) return null;
  const pagerText = [...panel.querySelectorAll('span')].map(el => clean(el.textContent)).find(v => /^\d+\s*\/\s*\d+$/.test(v)) || '';
  const pm = pagerText.match(/(\d+)\s*\/\s*(\d+)/);
  const buttons = [...panel.querySelectorAll('button')].filter(b => b.querySelector('img[src*="/LOGOS/"]'));
  const teams = buttons.map((button, index) => {
    const img = button.querySelector('img[src*="/LOGOS/"]');
    const texts = [...button.querySelectorAll('div,span')].map(el => clean(el.textContent)).filter(Boolean);
    const code = texts.find(v => /^[A-Z0-9]{2,4}$/.test(v)) || '';
    return {
      index,
      name: clean(img?.getAttribute('alt')),
      imagePath: img?.getAttribute('src') || '',
      code,
      selected: button.getAttribute('aria-pressed') === 'true'
    };
  });
  return { current: pm ? Number(pm[1]) : 1, total: pm ? Number(pm[2]) : 1, teams };
}

function readActivatePlayerTiles() {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const backgrounds = [...document.querySelectorAll('main img[alt="Card Background"]')];
  const cards = [];
  const seen = new Set();
  for (const bg of backgrounds) {
    const card = bg.closest('.aspect-square');
    if (!card || seen.has(card)) continue;
    seen.add(card);
    const imgs = [...card.querySelectorAll('img')];
    const playerImg = imgs.find(img => clean(img.getAttribute('alt')) && clean(img.getAttribute('alt')) !== 'Card Background' && /players\//i.test(img.getAttribute('src') || ''));
    if (!playerImg) continue;
    const texts = [...card.querySelectorAll('div,span')].map(el => clean(el.textContent)).filter(Boolean);
    const grade = texts.find(v => /^(S\+|S|S-|A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|N)$/.test(v)) || '';
    const starSpans = [...card.querySelectorAll('span')].filter(el => clean(el.textContent) === '★');
    const stars = starSpans.filter(el => /text-amber-400/.test(el.className || '')).length;
    cards.push({
      index: cards.length,
      name: clean(playerImg.getAttribute('alt')),
      imagePath: playerImg.getAttribute('src') || '',
      grade,
      stars
    });
  }
  return cards;
}

function readActivateSelected() {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const marker = [...document.querySelectorAll('div')].find(el => clean(el.textContent) === 'Selected Player');
  if (!marker) return null;
  let root = marker.parentElement;
  while (root && !/\bProgress\b/.test(clean(root.textContent))) root = root.parentElement;
  if (!root) return null;

  const nameEl = [...root.querySelectorAll('span')].find(el => /text-base/.test(el.className || '') && clean(el.textContent));
  const detailEl = [...root.querySelectorAll('span')].find(el => /text-xs/.test(el.className || '') && /•/.test(clean(el.textContent)));
  const detail = clean(detailEl?.textContent);
  const dm = detail.match(/^(.+?)\s*•\s*([A-Z0-9]{2,4})$/);
  const starSpans = [...root.querySelectorAll('span')].filter(el => clean(el.textContent) === '★');
  const stars = starSpans.filter(el => /text-amber-400/.test(el.className || '')).length;
  return {
    name: clean(nameEl?.textContent),
    position: dm ? clean(dm[1]).replace(/\s/g, '') : '',
    team: dm ? dm[2] : '',
    stars
  };
}

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

function readCardSpotlight() {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const heading = [...document.querySelectorAll('h3')].find(el => clean(el.textContent) === 'Card Spotlight');
  if (!heading) return null;
  let root = heading.parentElement;
  while (root && !/Player Details/i.test(clean(root.textContent))) root = root.parentElement;
  if (!root) return null;

  const valueFor = label => {
    const labelEl = [...root.querySelectorAll('span')].find(el => clean(el.textContent).toLowerCase() === String(label).toLowerCase());
    if (!labelEl) return '';
    const row = labelEl.parentElement;
    const siblings = [...(row?.children || [])];
    const value = siblings.find(el => el !== labelEl);
    return clean(value?.textContent);
  };

  const name = valueFor('Linked Player');
  const position = valueFor('Position');
  const team = valueFor('Team');
  const allText = clean(root.textContent);
  const lm = allText.match(/\bLevel\s*(\d+)\b/i);
  const selectedImg = [...root.querySelectorAll('img')].find(img => clean(img.getAttribute('alt')) === name && /players\//i.test(img.getAttribute('src') || ''));
  return {
    name,
    position,
    team,
    level: lm ? Number(lm[1]) : null,
    imagePath: selectedImg?.getAttribute('src') || ''
  };
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

class CardsService {
  constructor({ store, credentials = null, browserService = null, activity, accountProfile = null, onChanged }) {
    this.store = store;
    this.credentials = credentials;
    this.browser = browserService;
    this.activity = activity;
    this.accountProfile = accountProfile;
    this.onChanged = onChanged;
    this.runtime = { status: 'idle', message: '', scannedTeams: 0, scannedPlayers: 0, inventoryCards: 0 };
    this.scanning = false;
    this._ensureDefaults();
  }

  _ensureDefaults() {
    const roles = normalizeRoles(this.store.getCardRoles());
    this.store.saveCardRoles(roles);
    const data = normalizeData(this.store.getCards());
    this.store.saveCards(data);
    const metadata = normalizeMetadata(this.store.getCardMetadata());
    this.store.saveCardMetadata(metadata);
  }

  _roles() {
    return normalizeRoles(this.store.getCardRoles());
  }

  _metadata() { return normalizeMetadata(this.store.getCardMetadata()); }
  _data() { return normalizeData(this.store.getCards()); }

  _playerView(player, metadata, roles) {
    const meta = metadata.players[player.key] || {};
    const roleIds = Array.isArray(meta.roleIds) ? meta.roleIds : [];
    return {
      ...player,
      progress: cardProgress(player.stars, player.cardCount),
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
    const players = Object.values(data.players).map(p => this._playerView(p, metadata, roles));
    const activePlayers = players.filter(p => p.active !== false);
    const teamMap = new Map();

    for (const player of activePlayers) {
      const team = String(player.team || '—').trim() || '—';
      if (!teamMap.has(team)) teamMap.set(team, []);
      teamMap.get(team).push(player);
    }

    const teams = [...teamMap.entries()].map(([team, teamPlayers]) => {
      const star = teamPlayers.length ? Math.min(...teamPlayers.map(p => Math.max(0, Number(p.stars || 0)))) : 0;
      const blockers = teamPlayers.filter(p => Number(p.stars || 0) === star);
      return {
        team,
        star,
        playerCount: teamPlayers.length,
        blockerCount: blockers.length,
        blockers: blockers.map(p => ({
          key: p.key,
          name: p.name,
          stars: p.stars,
          progress: directNextProgress(p.stars, p.cardCount),
          raisesTeamIfUpgraded: blockers.length === 1
        }))
      };
    }).sort((a, b) => a.team.localeCompare(b.team));

    this._snapshot = {
      scannerReady: Boolean(this.browser && this.credentials && this.accountProfile),
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

  _log(account, level, message) {
    this.activity?.add({ level, accountId: account.id, accountName: account.name, message });
  }

  addRole(name, color = CUSTOM_ROLE_COLORS[0]) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Rol adı gerekli.');
    const roles = this._roles();
    const role = {
      id: `role-${crypto.randomUUID()}`,
      name: clean,
      builtIn: false,
      color: normalizeRoleColor(color, CUSTOM_ROLE_COLORS[roles.length % CUSTOM_ROLE_COLORS.length])
    };
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
    for (const meta of Object.values(metadata.players)) {
      if (Array.isArray(meta.roleIds)) meta.roleIds = meta.roleIds.filter(x => x !== id);
    }
    this.store.saveCardMetadata(metadata);
    this.onChanged?.();
    return true;
  }

  setPlayerRoles(playerKey, roleIds) {
    const data = this._data();
    if (!data.players[playerKey]) throw new Error('Oyuncu bulunamadı.');
    const valid = new Set(this._roles().map(r => r.id));
    const metadata = this._metadata();
    const old = metadata.players[playerKey] || {};
    metadata.players[playerKey] = {
      ...old,
      roleIds: [...new Set((roleIds || []).filter(id => valid.has(id)))],
      updatedAt: new Date().toISOString()
    };
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
    // Reset is intentionally stronger than Refresh: remove player-role mappings
    // and followed teams too, but keep the role definitions themselves.
    const metadata = this._metadata();
    metadata.players = {};
    metadata.trackedTeams = [];
    this.store.saveCardMetadata(metadata);
    this._setRuntime({ status: 'idle', message: '', scannedTeams: 0, scannedPlayers: 0, inventoryCards: 0 });
    return true;
  }

  // Season-safe merge. Refresh replaces the active game-derived snapshot, while
  // roles live in card-metadata.json and are migrated when the same player gets
  // a new key (for example after a roster/team/image-path update).
  syncPlayers(incomingPlayers) {
    if (!Array.isArray(incomingPlayers)) throw new Error('Kart oyuncu listesi geçersiz.');
    const keys=new Set();
    for(const incoming of incomingPlayers){
      const key=incoming.key||playerKeyOf(incoming);
      if(keys.has(key))throw new Error(`Kart taramasında iki oyuncu aynı kimlikle bulundu (${key}). Roller korunarak tarama durduruldu.`);
      keys.add(key);
    }
    const data = this._data();
    const metadata = this._metadata();
    const now = new Date().toISOString();
    const previousEntries = Object.entries(data.players);
    for (const player of Object.values(data.players)) player.active = false;

    for (const incoming of incomingPlayers) {
      const key = incoming.key || playerKeyOf(incoming);
      let previousKey = key;
      let previous = data.players[key] || null;

      if (!previous && incoming.name) {
        const sameName = previousEntries.filter(([, p]) => normalizeName(p?.name) === normalizeName(incoming.name));
        const incomingWithName = incomingPlayers.filter(p => normalizeName(p?.name) === normalizeName(incoming.name));
        // Migrate an old role only for a unique full name. Initials such as
        // S. Curry can describe several people and must never move roles.
        if (sameName.length === 1 && incomingWithName.length === 1 &&
            normalizeName(incoming.name).split(' ')[0].length > 1) {
          previousKey = sameName[0][0];
          previous = sameName[0][1];
        }
      }

      previous = previous || {};
      data.players[key] = {
        ...previous,
        ...incoming,
        key,
        position: incoming.position || previous.position || '',
        team: incoming.team || previous.team || '',
        teamName: incoming.teamName || previous.teamName || '',
        grade: incoming.grade || previous.grade || '',
        stars: Math.max(0, Number(incoming.stars ?? incoming.cardStars ?? previous.stars ?? 0)),
        cardCount: Math.max(0, Number(incoming.cardCount ?? incoming.count ?? previous.cardCount ?? 0)),
        active: true,
        firstSeenAt: previous.firstSeenAt || now,
        lastSeenAt: now
      };

      if (previousKey !== key) {
        const oldMeta = metadata.players[previousKey];
        if (oldMeta && !metadata.players[key]) metadata.players[key] = { ...oldMeta, migratedAt: now };
        delete data.players[previousKey];
        delete metadata.players[previousKey];
      }
    }

    data.updatedAt = now;
    this.store.saveCards(data);
    this.store.saveCardMetadata(metadata);
    this.onChanged?.();
    return this.snapshot();
  }

  async _waitActivateSelected(page, expectedName, expectedStars, timeoutMs = 2500) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const info = await page.evaluate(readActivateSelected).catch(() => null);
      if (info?.name && normalizeName(info.name) === normalizeName(expectedName)) {
        if (expectedStars == null || Number(info.stars) === Number(expectedStars)) return info;
      }
      await sleep(40);
    }
    return null;
  }

  async _waitSpotlight(page, expectedName, expectedLevel, timeoutMs = 2500) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const info = await page.evaluate(readCardSpotlight).catch(() => null);
      if (info?.name && normalizeName(info.name) === normalizeName(expectedName)) {
        if (!expectedLevel || Number(info.level) === Number(expectedLevel)) return info;
      }
      await sleep(40);
    }
    return null;
  }

  async _waitTeamPage(page, expected, timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const state = await page.evaluate(readActivateTeamPanel).catch(() => null);
      if (state?.current === expected) return state;
      await sleep(80);
    }
    throw new Error(`Star Cards takım sayfası ${expected} yüklenemedi.`);
  }

  async _waitTeamSelected(page, teamName, timeoutMs = 4000) {
    const end = Date.now() + timeoutMs;
    const img = page.getByRole('img', { name: teamName, exact: true }).first();
    const button = img.locator('xpath=ancestor::button[1]');
    while (Date.now() < end) {
      const pressed = await button.getAttribute('aria-pressed').catch(() => null);
      if (pressed === 'true') return true;
      await sleep(50);
    }
    return false;
  }

  _assertScanDeadline() {
    if (this._scanDeadline && Date.now() > this._scanDeadline) {
      throw new Error('Cards taraması 10 dakikayı aştığı için durduruldu. Tarama takılmış olabilir.');
    }
  }

  async _waitMyPage(page, expected, timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const state = await page.evaluate(readMyPlayerPager).catch(() => null);
      if (state?.current === expected) return state;
      await sleep(80);
    }
    throw new Error(`My Player Card sayfası ${expected} yüklenemedi.`);
  }

  async _waitActivateTeamPanelReady(page, timeoutMs = 30000) {
    const end = Date.now() + timeoutMs;
    let lastState = null;
    while (Date.now() < end) {
      lastState = await page.evaluate(readActivateTeamPanel).catch(() => null);
      if (lastState?.teams?.length) return lastState;
      await sleep(120);
    }
    return lastState;
  }

  async _openStarCards(session, account) {
    const page = session.page;
    try {
      await this.browser.normalizeToStadium(session, (level, message) => this._log(account, level, message));
    } catch {
      await page.goto('https://www.dreamteamph.com/main', { waitUntil: 'domcontentloaded' });
      await this.browser.waitForMain(page, { timeoutMs: 150000, log: (level, message) => this._log(account, level, message) });
    }
    await this.accountProfile?.captureStadium(account.id, page).catch(() => {});

    // The Star Card control is a button wrapping img[alt="Star Card"].
    // Click the button itself, then wait for the Star Cards shell to render.
    const starCardImg = page.locator(STAR_CARD_SELECTOR).first();
    await starCardImg.waitFor({ state: 'visible', timeout: 60000 });
    const starCardButton = starCardImg.locator('xpath=ancestor::button[1]');
    if (await starCardButton.count()) await starCardButton.click();
    else await starCardImg.click();
    this._log(account, 'info', 'Star Cards button clicked.');

    await page.locator('nav[aria-label="Star card sections"]').first().waitFor({ state: 'visible', timeout: 60000 });

    // The navigation appears before the Activate/team grid on some machines.
    // Do not start scanning until the actual team panel has rendered.
    const activateButton = page.locator('nav[aria-label="Star card sections"] button').filter({ hasText: 'Activate' }).first();
    if (!(await activateButton.getAttribute('aria-current').catch(() => null))) {
      await activateButton.click();
    }

    let panel = await this._waitActivateTeamPanelReady(page, 30000);
    if (!panel?.teams?.length) {
      // One retry handles React transitions where the tab shell appears but
      // the Activate body did not mount on the first click.
      await activateButton.click().catch(() => {});
      panel = await this._waitActivateTeamPanelReady(page, 15000);
    }
    if (!panel?.teams?.length) {
      throw new Error('Star Cards açıldı ancak takım listesi yüklenmedi.');
    }
    this._log(account, 'info', `Star Cards ready · team page ${panel.current}/${panel.total} · ${panel.teams.length} teams.`);
  }

  async _scanActivate(page, account) {
    const activateButton = page.locator('nav[aria-label="Star card sections"] button').filter({ hasText: 'Activate' }).first();
    if (!(await activateButton.getAttribute('aria-current').catch(() => null))) {
      await activateButton.click({ timeout: 5000 });
    }

    let panel = await this._waitActivateTeamPanelReady(page, 20000);
    if (!panel?.teams?.length) throw new Error('Star Cards takım listesi bulunamadı.');
    while (panel.current > 1) {
      this._assertScanDeadline();
      const prev = page.getByRole('button', { name: 'Previous page' }).first();
      await prev.click({ timeout: 5000 });
      panel = await this._waitTeamPage(page, panel.current - 1);
    }

    const seen = new Map();
    let scannedTeams = 0;
    this._log(account, 'info', 'Cards Activate taraması başladı · ilk 2 takım sayfası.');

    for (let targetPage = 1; targetPage <= 2; targetPage++) {
      this._assertScanDeadline();
      panel = await this._waitTeamPage(page, targetPage);
      const teams = panel.teams || [];
      if (!teams.length) throw new Error(`Star Cards takım sayfası ${targetPage} boş okundu; mevcut kart verisi değiştirilmedi.`);

      for (const team of teams) {
        this._assertScanDeadline();
        const teamImg = page.getByRole('img', { name: team.name, exact: true }).first();
        const teamButton = teamImg.locator('xpath=ancestor::button[1]');
        const wasSelected = (await teamButton.getAttribute('aria-pressed').catch(() => null)) === 'true';
        const beforeTiles = await page.evaluate(readActivatePlayerTiles).catch(() => []);
        const beforeSignature = beforeTiles.map(x => `${x.name}|${x.stars}`).join('||');

        await teamButton.scrollIntoViewIfNeeded().catch(() => {});
        if (!wasSelected) await teamButton.click({ timeout: 5000 });

        const selected = await this._waitTeamSelected(page, team.name, 4000);
        if (!selected) throw new Error(`${team.code || team.name} takım seçimi doğrulanamadı.`);

        let tiles = await page.evaluate(readActivatePlayerTiles).catch(() => []);
        const waitEnd = Date.now() + 2500;
        while (Date.now() < waitEnd) {
          const signature = tiles.map(x => `${x.name}|${x.stars}`).join('||');
          if (tiles.length && (wasSelected || signature !== beforeSignature)) break;
          await sleep(60);
          tiles = await page.evaluate(readActivatePlayerTiles).catch(() => []);
        }
        if (!tiles.length) throw new Error(`${team.code || team.name} oyuncuları okunamadı; mevcut kart verisi değiştirilmedi.`);

        // Fast path: the Activate cards already contain name, grade, current
        // stars and image. The selected team gives us the team identity. The
        // old code clicked every player and waited for the detail panel, which
        // could turn a complete scan into a 30-60 minute job.
        for (const tile of tiles) {
          const player = {
            name: tile.name,
            team: team.code || team.name,
            teamName: team.name || '',
            position: '',
            grade: tile.grade || '',
            stars: Math.max(0, Number(tile.stars || 0)),
            imagePath: tile.imagePath || '',
            slug: imageSlug(tile.imagePath || '') || undefined,
            cardCount: 0,
            inventoryLevels: {}
          };
          player.key = playerKeyOf(player);
          seen.set(`${player.key}|name:${compactName(player.name)}`, player);
        }

        scannedTeams += 1;
        this._setRuntime({
          status: 'scanning',
          message: `Activate · ${team.code || team.name} · ${scannedTeams} takım`,
          scannedTeams,
          scannedPlayers: seen.size
        });
        this._log(account, 'info', `Cards Activate · ${team.code || team.name} · ${tiles.length} oyuncu.`);
      }

      if (targetPage === 1) {
        const next = page.getByRole('button', { name: 'Next page' }).first();
        if (!(await next.isEnabled().catch(() => false))) throw new Error('Star Cards ikinci takım sayfasına geçilemiyor.');
        await next.click({ timeout: 5000 });
        await this._waitTeamPage(page, 2);
      }
    }

    const found=disambiguatePlayerKeys([...seen.values()]);
    this._log(account, 'info', `Cards Activate tamamlandı · ${scannedTeams} takım · ${seen.size} oyuncu.`);
    return found;
  }

  async _scanMyPlayerCards(page, account) {
    const tab = page.locator('nav[aria-label="Star card sections"] button').filter({ hasText: 'My Player Card' }).first();
    await tab.click({ timeout: 5000 });
    await page.getByText('My Star Cards', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });

    // Lv 1/Lv 2/... are filters. Keep All selected and use only the bottom pager.
    const allButton = page.getByRole('button', { name: 'All', exact: true }).first();
    if (await allButton.isVisible().catch(() => false)) await allButton.click({ timeout: 5000 });

    let pager = await page.evaluate(readMyPlayerPager).catch(() => null);
    if (!pager) throw new Error('My Player Card sayfalaması bulunamadı.');
    while (pager.current > 1) {
      this._assertScanDeadline();
      const prev = page.getByRole('button', { name: 'Previous page' }).last();
      await prev.click({ timeout: 5000 });
      pager = await this._waitMyPage(page, pager.current - 1);
    }

    const inventory = new Map();
    let inventoryCards = 0;
    this._log(account, 'info', `My Player Card taraması başladı · ${pager.total} sayfa.`);

    while (true) {
      this._assertScanDeadline();
      pager = await page.evaluate(readMyPlayerPager).catch(() => null);
      if (!pager) throw new Error('My Player Card sayfa bilgisi okunamadı.');

      let tiles = await page.evaluate(readMyPlayerCardTiles).catch(() => []);
      const waitEnd = Date.now() + 2500;
      while (!tiles.length && Date.now() < waitEnd) {
        await sleep(60);
        tiles = await page.evaluate(readMyPlayerCardTiles).catch(() => []);
      }
      if (!tiles.length) throw new Error(`My Player Card ${pager.current}/${pager.total} boş okundu; mevcut kart verisi değiştirilmedi.`);

      // Fast path: each tile already contains player name, card level and xN.
      // No per-card click is necessary to calculate the raw-card equivalent.
      for (const tile of tiles) {
        const level = Math.max(1, Math.min(5, Number(tile.level || 1)));
        const quantity = Math.max(1, Number(tile.quantity || 1));
        const equivalent = quantity * (4 ** (level - 1));
        const identity = {
          name: tile.name,
          imagePath: tile.imagePath || '',
          slug: imageSlug(tile.imagePath || '') || undefined
        };
        // The same portrait can be used by two different players. Aggregate
        // copies of one player's card by portrait AND name.
        const key = `${playerKeyOf(identity)}|name:${compactName(identity.name)}`;
        let entry = inventory.get(key);
        if (!entry) {
          entry = {
            key,
            name: identity.name,
            imagePath: identity.imagePath,
            position: '',
            teamName: '',
            rawEquivalent: 0,
            levels: {}
          };
          inventory.set(key, entry);
        }
        entry.rawEquivalent += equivalent;
        entry.levels[level] = Number(entry.levels[level] || 0) + quantity;
        inventoryCards += quantity;
      }

      this._setRuntime({
        status: 'scanning',
        message: `My Player Card · ${pager.current}/${pager.total}`,
        inventoryCards
      });
      this._log(account, 'info', `My Player Card · ${pager.current}/${pager.total} · ${tiles.length} kart satırı.`);

      if (pager.current >= pager.total || pager.nextDisabled) break;
      const next = page.getByRole('button', { name: 'Next page' }).last();
      await next.click({ timeout: 5000 });
      await this._waitMyPage(page, pager.current + 1);
    }

    this._log(account, 'info', `My Player Card tamamlandı · ${inventoryCards} kart · ${inventory.size} oyuncu.`);
    return [...inventory.values()];
  }

  _mergeActivateAndInventory(activatePlayers, inventoryEntries) {
    const byKey = new Map(inventoryEntries.map(x => [x.key, x]));
    const used = new Set();
    return activatePlayers.map(player => {
      let inv = byKey.get(player.key) || null;
      if (!inv) inv = resolvePlayer(inventoryEntries.filter(x => !used.has(x.key)), player);
      if (inv && used.has(inv.key)) inv = null;
      if (inv) used.add(inv.key);
      return {
        ...player,
        cardCount: Math.max(0, Number(inv?.rawEquivalent || 0)),
        inventoryLevels: inv?.levels || {},
        inventoryTeamName: inv?.teamName || null,
        inventoryPosition: inv?.position || null
      };
    });
  }

  async refresh() {
    if (this.scanning) throw new Error('Kart taraması zaten çalışıyor.');
    if (!this.browser || !this.credentials || !this.accountProfile) throw new Error('Kart tarayıcı servisi hazır değil.');
    const account = this._mainAccount();
    if (this.browser.isFeatureLocked(account.id)) {
      throw new Error('Ana hesap şu anda başka bir tarayıcı işlemi tarafından kullanılıyor. Önce o işlemi kapatıp Kartları yenile.');
    }
    const owner = `cards:${account.id}`;
    let auth = null;
    this.scanning = true;
    this._scanDeadline = Date.now() + (10 * 60 * 1000);
    this._setRuntime({ status: 'starting', message: 'Star Cards açılıyor…', scannedTeams: 0, scannedPlayers: 0, inventoryCards: 0 });
    this._log(account, 'info', 'Cards scan starting…');

    try {
      auth = await this.browser.authenticate(account, {
        login: account.login,
        password: this.credentials.decryptSecret(account.passwordEncrypted)
      }, { visible: false, keepOpen: true, owner, log: (level, message) => this._log(account, level, message) });

      this.browser.lockFeature(account.id, 'cards');
      await this._openStarCards(auth.session, account);
      this._setRuntime({ status: 'scanning', message: 'Activate · takım 1/2' });
      const activatePlayers = await this._scanActivate(auth.session.page, account);
      this._setRuntime({ status: 'scanning', message: 'My Player Card açılıyor…' });
      const inventory = await this._scanMyPlayerCards(auth.session.page, account);
      const merged = this._mergeActivateAndInventory(activatePlayers, inventory);

      const result = this.syncPlayers(merged);
      this._setRuntime({ status: 'done', message: `${merged.length} oyuncu`, scannedPlayers: merged.length });
      this._log(account, 'success', `Cards scan completed · ${merged.length} players · ${inventory.length} card identities.`);
      return result;
    } catch (error) {
      this._setRuntime({ status: 'error', message: error.message });
      this._log(account, 'error', `Cards: ${error.message}`);
      throw error;
    } finally {
      this.browser.unlockFeature(account.id, 'cards');
      if (auth?.owner) await this.browser.release(account.id, auth.owner, { closeWhenUnused: true }).catch(() => {});
      this.scanning = false;
      this._scanDeadline = null;
      this.onChanged?.();
    }
  }

  findForScout(agent) {
    const snap = this.snapshot();
    const active = snap.players.filter(p => p.active !== false);
    const player = resolvePlayer(active, agent, { requirePortrait: true });
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

module.exports = { CardsService, DEFAULT_ROLES, cardProgress, directNextProgress, playerKeyOf, namesMatch, resolvePlayer, disambiguatePlayerKeys, readMyPlayerPager, readMyPlayerCardTiles };
