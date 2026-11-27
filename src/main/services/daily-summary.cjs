// Daily summary from one day of the Activity archive: what every system did (user 2026-11-25:
// "her sistemi ekle, kaç draft yapıldı, pazara kaç oyuncu eklendi…").
// Works on log codes (and, for Quick Play entries without a code, the message).
// STATS: key -> { codes, count?(params) = how much one entry adds (default 1), sums?: { name: fn } }.
const n = v => Number(v) || 0;
const isTix = p => String(p?.currency || '').toUpperCase() === 'TIX';
const STATS = {
  // matches
  quickPlay: { codes: ['qp.started', 'qp.own'] },
  pvp: { codes: ['pvp.matchStarted'] },
  towerWins: { codes: ['tw.won'] },
  towerLosses: { codes: ['tw.lost'] },
  goUp: { codes: ['gu.matchDone'] },
  bossPlayed: { codes: ['bo.matchStarted'] },
  bossWon: { codes: ['bo.matchWon'] },
  ascentPlayed: { codes: ['ea.matchStarted'] },
  ascentWon: { codes: ['ea.matchWon'] },
  proPlayed: { codes: ['pf.matchStarted'] },
  proWon: { codes: ['pf.matchWon'] },
  tournamentRegistered: { codes: ['tn.registered'] },
  tournamentWon: { codes: ['tl.won'] },
  tournamentLost: { codes: ['tl.lost'] },
  rotationMatches: { codes: ['rt.attached'] },
  rotationSubs: { codes: ['rt.sub'], count: p => n(p.count) || 1 },
  // market
  sales: { codes: ['mk.claimed'], sums: { apk: p => (isTix(p) ? 0 : n(p.payout)), tix: p => (isTix(p) ? n(p.payout) : 0) } },
  listed: { codes: ['at2.listed', 'df.listed', 'sh.listed', 'by.listed'], ok: p => !p?.error },
  relisted: { codes: ['mk.relisted'] },
  removed: { codes: ['mk.removed'] },
  fired: { codes: ['mk.fired', 'at2.fired', 'at2.firedNoDisc', 'df.fired', 'sh.fired'] },
  marketScans: { codes: ['mk.scanned'] },
  hallScans: { codes: ['th.done'] },
  // buying, Auto Trade, transfers
  bought: { codes: ['by.bought'], sums: { apk: p => (isTix(p) ? 0 : n(p.price)), tix: p => (isTix(p) ? n(p.price) : 0) } },
  hunterBought: { codes: ['sh.bought'], sums: { apk: p => (isTix(p) ? 0 : n(p.price)), tix: p => (isTix(p) ? n(p.price) : 0) } },
  atSigned: { codes: ['at2.signed', 'at2.friendSigned', 'at2.spenderSigned', 'at2.secretSigned'] },
  atConverted: { codes: ['at2.converted'], count: p => n(p.count) },
  boughtConverted: { codes: ['by.converted'] },
  atTrades: { codes: ['at2.traded', 'at2.spenderTraded'] },
  tkRounds: { codes: ['tk.round'] },
  apkTransfers: { codes: ['apk.done'], sums: { apk: p => n(p.apk), tix: p => n(p.tix) } },
  friendsAdded: { codes: ['fn.added'] },
  // draft
  draftRooms: { codes: ['df.joined', 'ad.joined'] },
  draftPicks: { codes: ['df.picked'] },
  autoDraftPools: { codes: ['ad.pool'], count: p => n(p.count) },
  draftCarded: { codes: ['df.carded'], count: p => n(p.count) || 1 },
  draftToMain: { codes: ['df.toMain', 'df.toSpender', 'df.handedAT'], count: p => n(p.count) || (Array.isArray(p.names) ? p.names.length : 1) },
  // cards
  synthOk: { codes: ['sy.ok'] },
  synthFail: { codes: ['sy.fail'] },
  big3: { codes: ['b3.started'] },
  skillShuffles: { codes: ['sk.shuffled'] },
  skillsLearned: { codes: ['sk.learned'] },
  cardsOpened: { codes: ['bg.cardOpened'] },
  // equipment
  eqCrafted: { codes: ['eq.crafted'], count: p => n(p.count) || 1 },
  eqEnhanced: { codes: ['eq.enhanced'] },
  eqEnhanceFailed: { codes: ['eq.enhanceFailed'] },
  eqConverted: { codes: ['eq.converted'] },
  eqDismantled: { codes: ['eq.dismantled'], count: p => n(p.count) || 1 },
  eqSets: { codes: ['eq.setCompleted'] },
  // daily
  quiz: { codes: ['qz.done'], ok: p => !p?.error },
  dailyReward: { codes: ['dw.claimed'] },
  dailyRewardDone: { codes: ['dw.completed'] },
  dailySlot: { codes: ['ds.spun'] },
  signIn: { codes: ['dr.signIn'] },
  friendly: { codes: ['dr.fmDone'] },
  groupMatch: { codes: ['dr.gmDone'] },
  taskRewards: { codes: ['dr.rewardsClaimed'], count: p => n(p.count) || 1 },
  donated: { codes: ['dr.donated'], sums: { amount: p => n(p.amount) } },
  stadiumLevels: { codes: ['st.levelUp'] },
  // accounts
  accountsCreated: { codes: ['su.registered'] },
  injuries: { codes: ['inj.blocked'] },
  injuriesCleared: { codes: ['inj.cleared'] },
  friendRequests: { codes: ['so.newRequest'] },
  messages: { codes: ['so.newMessage'] },
  chatSent: { codes: ['cs.summary'], count: p => n(p.sent) },
  gameOutages: { codes: ['gh.down'] }
};
const BY_CODE = new Map();
for (const [key, spec] of Object.entries(STATS)) for (const c of spec.codes) BY_CODE.set(c, [...(BY_CODE.get(c) || []), key]);
// the per-account table
const ACCOUNT_KEYS = ['quickPlay', 'pvp', 'towerWins', 'goUp', 'draftPicks', 'listed', 'bought', 'sales', 'quiz', 'dailyReward'];

// what one entry of `code` adds (the tally of counted-only entries uses the same rule)
function amountOf(code, params = {}) {
  const keys = BY_CODE.get(code);
  if (!keys) return 1;
  const spec = STATS[keys[0]];
  return spec.count ? spec.count(params) : 1;
}

// counted-only entries of the day (logs/YYYY-MM-DD.tally.json)
function addTally(s, tally) {
  for (const [code, c] of Object.entries(tally?.codes || {})) {
    for (const key of BY_CODE.get(code) || []) {
      s.stats[key].n += Number(c.n) || 0;
      const seen = (s._acc[key] ||= new Set());
      for (const [name, v] of Object.entries(c.acc || {})) {
        seen.add(name);
        if (ACCOUNT_KEYS.includes(key)) {
          const a = (s.perAccount[name] ||= Object.fromEntries(ACCOUNT_KEYS.map(k => [k, 0])));
          a[key] += Number(v) || 0;
        }
      }
    }
  }
}

function createSummary() {
  const s = { errors: 0, warnings: 0, stats: {}, perAccount: {}, _acc: {} };
  for (const key of Object.keys(STATS)) s.stats[key] = { n: 0, accounts: 0, sums: {} };
  return s;
}

function addEntry(s, e) {
  if (!e) return;
  if (e.level === 'error') s.errors++;
  if (e.level === 'warning') s.warnings++;
  const code = e.code || (/^Quick Play started/.test(e.message || '') ? 'qp.started' : null);
  const keys = code && BY_CODE.get(code);
  if (!keys) return;
  const p = e.params || {};
  const who = e.accountName || '';
  for (const key of keys) {
    const spec = STATS[key];
    if (spec.ok && !spec.ok(p)) continue;
    const add = spec.count ? spec.count(p) : 1;
    const st = s.stats[key];
    st.n += add;
    for (const [name, fn] of Object.entries(spec.sums || {})) st.sums[name] = (st.sums[name] || 0) + fn(p);
    if (who) {
      const seen = (s._acc[key] ||= new Set());
      seen.add(who);
      if (ACCOUNT_KEYS.includes(key)) {
        const a = (s.perAccount[who] ||= Object.fromEntries(ACCOUNT_KEYS.map(k => [k, 0])));
        a[key] += add;
      }
    }
  }
}

function finishSummary(s) {
  for (const [key, set] of Object.entries(s._acc)) s.stats[key].accounts = set.size;
  delete s._acc;
  // the fields the older page and tests read
  const st = s.stats;
  Object.assign(s, {
    quickPlay: st.quickPlay.n, pvp: st.pvp.n, towerWins: st.towerWins.n, towerLosses: st.towerLosses.n,
    sales: st.sales.n, salesApk: st.sales.sums.apk || 0, salesTix: st.sales.sums.tix || 0, relisted: st.relisted.n,
    bought: st.bought.n, spentApk: st.bought.sums.apk || 0, spentTix: st.bought.sums.tix || 0,
    synthOk: st.synthOk.n, synthFail: st.synthFail.n, draftPicks: st.draftPicks.n,
    atSigned: st.atSigned.n, atConverted: st.atConverted.n, atTrades: st.atTrades.n
  });
  return s;
}

function summarize(entries) {
  const s = createSummary();
  for (const e of entries || []) addEntry(s, e);
  return finishSummary(s);
}

// A day's file read line by line (a day of 1141 accounts is 60+ MB: never read it in one piece).
async function summarizeFile(file) {
  const fs = require('fs');
  const readline = require('readline');
  const s = createSummary();
  try { addTally(s, JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.tally.json'), 'utf8'))); } catch {}
  if (!fs.existsSync(file)) return finishSummary(s);
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let i = 0;
  for await (const line of rl) {
    if (!line) continue;
    try { addEntry(s, JSON.parse(line)); } catch {}
    if (++i % 20000 === 0) await new Promise(r => setImmediate(r)); // let the app breathe
  }
  return finishSummary(s);
}

module.exports = { summarize, summarizeFile, STATS, ACCOUNT_KEYS, amountOf, addTally };
