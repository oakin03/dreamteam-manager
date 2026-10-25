// Daily summary from one day of the Activity archive: what the automations did.
// Works on log codes (and, for old Quick Play entries without a code, the message).
function summarize(entries) {
  const s = {
    quickPlay: 0, pvp: 0, towerWins: 0, towerLosses: 0,
    sales: 0, salesApk: 0, salesTix: 0, relisted: 0,
    bought: 0, spentApk: 0, spentTix: 0,
    synthOk: 0, synthFail: 0, draftPicks: 0,
    atSigned: 0, atConverted: 0, atTrades: 0,
    errors: 0, warnings: 0, perAccount: {}
  };
  const acc = name => (s.perAccount[name] ||= { quickPlay: 0, pvp: 0, towerWins: 0, bought: 0, sales: 0 });
  for (const e of entries || []) {
    const p = e.params || {};
    if (e.level === 'error') s.errors++;
    if (e.level === 'warning') s.warnings++;
    const who = e.accountName || '';
    if (e.code === 'qp.started' || (!e.code && /^Quick Play started/.test(e.message || ''))) { s.quickPlay++; if (who) acc(who).quickPlay++; continue; }
    switch (e.code) {
      case 'pvp.matchStarted': s.pvp++; if (who) acc(who).pvp++; break;
      case 'tw.won': s.towerWins++; if (who) acc(who).towerWins++; break;
      case 'tw.lost': s.towerLosses++; break;
      case 'mk.claimed': s.sales++; if (p.currency === 'TIX') s.salesTix += Number(p.payout) || 0; else s.salesApk += Number(p.payout) || 0; if (who) acc(who).sales++; break;
      case 'mk.relisted': s.relisted++; break;
      case 'by.bought': s.bought++; if (p.currency === 'TIX') s.spentTix += Number(p.price) || 0; else s.spentApk += Number(p.price) || 0; if (who) acc(who).bought++; break;
      case 'sy.ok': s.synthOk++; break;
      case 'sy.fail': s.synthFail++; break;
      case 'df.picked': s.draftPicks++; break;
      case 'at2.signed': s.atSigned++; break;
      case 'at2.converted': s.atConverted += Number(p.count) || 0; break;
      case 'at2.traded': s.atTrades++; break;
      default: break;
    }
  }
  return s;
}

module.exports = { summarize };
