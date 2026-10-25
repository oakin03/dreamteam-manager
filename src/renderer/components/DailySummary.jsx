import { useEffect, useState } from 'react';
import SortTable from './SortTable';

const api = window.dreamteam;
const num = v => Number(v || 0).toLocaleString();
const TEXT = {
  tr: {
    title: 'Günlük özet', hint: 'Aktivite arşivinden hesaplanır', refresh: 'Yenile', none: 'Bu gün için kayıt yok.',
    quickPlay: 'Auto Play maçı', pvp: 'PVP maçı', tower: 'Kule (G/M)', sales: 'Toplanan satış', relisted: 'Tekrar listelenen', bought: 'Satın alınan', spent: 'Harcanan', synth: 'Sentez (başarılı/başarısız)', draft: 'Draft seçimi', autoTrade: 'Auto Trade (alınan/kart/takas)', problems: 'Hata / uyarı',
    perAccount: 'Hesap başına', account: 'Hesap'
  },
  en: {
    title: 'Daily summary', hint: 'calculated from the Activity archive', refresh: 'Refresh', none: 'No entries for this day.',
    quickPlay: 'Auto Play matches', pvp: 'PVP matches', tower: 'Tower (W/L)', sales: 'Sales claimed', relisted: 'Relisted', bought: 'Bought', spent: 'Spent', synth: 'Synthesis (ok/failed)', draft: 'Draft picks', autoTrade: 'Auto Trade (signed/cards/trades)', problems: 'Errors / warnings',
    perAccount: 'Per account', account: 'Account'
  }
};

// Home: one day of work at a glance (default: today), any archived day selectable.
export default function DailySummary({ t }) {
  const x = TEXT[t.lang] || TEXT.en;
  const [data, setData] = useState(null);
  const load = day => api.activityArchive?.summary(day).then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!data) return null;
  const s = data.summary;
  const tiles = [
    [x.quickPlay, num(s.quickPlay)], [x.pvp, num(s.pvp)], [x.tower, `${num(s.towerWins)} / ${num(s.towerLosses)}`],
    [x.sales, `${num(s.sales)} · ${num(s.salesApk)} APK${s.salesTix ? ` · ${num(s.salesTix)} TIX` : ''}`], [x.relisted, num(s.relisted)],
    [x.bought, num(s.bought)], [x.spent, `${num(s.spentApk)} APK${s.spentTix ? ` · ${num(s.spentTix)} TIX` : ''}`],
    [x.synth, `${num(s.synthOk)} / ${num(s.synthFail)}`], [x.draft, num(s.draftPicks)], [x.autoTrade, `${num(s.atSigned)} / ${num(s.atConverted)} / ${num(s.atTrades)}`],
    [x.problems, `${num(s.errors)} / ${num(s.warnings)}`]
  ];
  const accounts = Object.entries(s.perAccount || {}).sort((a, b) => a[0].localeCompare(b[0]));
  return <>
    <h3 className="section-title">{x.title}<small>{x.hint}</small></h3>
    <div className="panel daily-summary">
      <div className="ds-head">{(data.days || []).length > 0 && <select value={data.day || ''} onChange={e => load(e.target.value)}>{data.days.map(d => <option key={d} value={d}>{d}</option>)}</select>}<button className="btn ghost small" onClick={() => load(data.day)}>{x.refresh}</button></div>
      {!data.day ? <p className="muted-text">{x.none}</p> : <>
        <div className="ds-tiles">{tiles.map(([k, v]) => <div key={k} className="ds-tile"><span>{k}</span><b>{v}</b></div>)}</div>
        {accounts.length > 0 && <details className="ds-accounts"><summary>{x.perAccount}</summary><SortTable><thead><tr><th>{x.account}</th><th>{x.quickPlay}</th><th>{x.pvp}</th><th>{x.tower}</th><th>{x.bought}</th><th>{x.sales}</th></tr></thead>
          <tbody>{accounts.map(([n, a]) => <tr key={n}><td><b>{n}</b></td><td>{a.quickPlay}</td><td>{a.pvp}</td><td>{a.towerWins}</td><td>{a.bought}</td><td>{a.sales}</td></tr>)}</tbody></SortTable></details>}
      </>}
    </div>
  </>;
}
