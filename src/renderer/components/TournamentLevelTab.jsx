import { filOf } from '../i18n-fil';
import SortTable from './SortTable';

// Turnuva → "Seviye kontrolü" (user 2026-11-09): registered accounts whose level grew past the
// tournament's band are shown; a fitting account of ours takes the seat (quit + register at once).
const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

const TEXT = {
  tr: {
    check: 'Kontrol et', checkSwap: 'Kontrol et ve değiştir', checking: 'Kontrol ediliyor…',
    auto: 'Otomatik (30 dakikada bir kontrol et ve değiştir)',
    hint: 'Kayıtlı olduğu turnuvanın seviyesini geçen hesap, turnuva başlayınca maçı 25-0 kaybeder. Bu hesaplar burada uyarıyla görünür; o turnuvaya uygun ve kayıtlı olmayan bir hesabımız varsa uygun olmayan çıkar, uygun olan hemen kaydolur.',
    last: 'Son kontrol {t} · {acc} hesap · {reg} hesap kayıtlı', never: 'Henüz kontrol edilmedi.', none: 'Seviyesi uymayan kayıtlı hesap yok.',
    tournament: 'Turnuva', band: 'Seviye', players: 'Oyuncu', wrong: 'Seviyesi uymayan', swaps: 'Değişecek', stay: 'Yerine hesap yok · kayıtlı kalır',
    history: 'Yapılan değişiklikler', time: 'Saat', out: 'Çıkan', in: 'Giren', result: 'Sonuç', ok: 'Tamam', fail: 'Olmadı',
    how: [
      'Sadece kayıtları hâlâ açık olan turnuvalara bakılır. Seviyeler oturum açmadan okunur.',
      'Uygun olmayan hesap kadar uygun hesap yoksa fazlası turnuvada kayıtlı kalır. Uygun hesap fazlaysa hesap sırasına göre seçilir.',
      'Değişimde iki hesabın bağlantısı önceden açılır; biri çıkar çıkmaz diğeri kaydolur ki boşalan yeri başkası almasın.',
      '"Kontrol et" yalnızca gösterir; "Kontrol et ve değiştir" ve otomatik kontrol değişimi de yapar. Kayıt çalışırken otomatik kontrol bekler.'
    ]
  },
  en: {
    check: 'Check', checkSwap: 'Check and swap', checking: 'Checking…',
    auto: 'Automatic (check and swap every 30 minutes)',
    hint: 'An account whose level went past the band of the tournament it registered for loses its match 25-0 when the tournament starts. Such accounts show here with a warning; when an account of ours fits that tournament and is not in it, the wrong one leaves and the fitting one registers at once.',
    last: 'Last check {t} · {acc} accounts · {reg} registered', never: 'Not checked yet.', none: 'No registered account outside its level.',
    tournament: 'Tournament', band: 'Level', players: 'Players', wrong: 'Wrong level', swaps: 'Swaps', stay: 'No account to take the seat · stays registered',
    history: 'Swaps made', time: 'Time', out: 'Left', in: 'Joined', result: 'Result', ok: 'Done', fail: 'Failed',
    how: [
      'Only tournaments whose registration is still open are looked at. Levels are read without signing in.',
      'With fewer fitting accounts than wrong ones the rest stay registered. With more fitting accounts they are taken in the account order.',
      'For a swap both connections are opened first; the fitting account registers the moment the other one leaves, so nobody else takes the seat.',
      '"Check" only shows; "Check and swap" and the automatic check also swap. The automatic check waits while registration runs.'
    ]
  },
  get fil() { return filOf(this.en); }
};

export default function TournamentLevelTab({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const s = state.tournamentLevel || { rows: [], swaps: [], auto: true };
  const run = swap => api.tournamentLevel.check(swap).catch(e => toast(e.message, 'error'));
  return <>
    <div className="panel pg-bar">
      <button className="btn" disabled={s.busy} onClick={() => run(false)}>{s.busy ? x.checking : x.check}</button>
      <button className="btn primary" disabled={s.busy} onClick={() => run(true)}>{x.checkSwap}</button>
      <label className="switchline"><input type="checkbox" checked={s.auto !== false} onChange={e => api.tournamentLevel.setAuto(e.target.checked).catch(err => toast(err.message, 'error'))} /><span>{x.auto}</span></label>
    </div>
    <div className="panel pg-bar"><span className="pg-hint">{x.hint}</span></div>
    {s.error && <div className="panel pl-error">{s.error}</div>}
    <div className="panel table-panel">
      <div className="dp-table-head"><b>{s.at ? fill(x.last, { t: new Date(s.at).toLocaleString(), acc: s.checked?.accounts ?? '—', reg: s.checked?.registered ?? '—' }) : x.never}</b></div>
      {s.at && !s.rows.length ? <p className="good-text dp-pad">{x.none}</p> : s.rows.length > 0 && <SortTable>
        <thead><tr><th>{x.tournament}</th><th>{x.band}</th><th>{x.players}</th><th>{x.wrong}</th><th>{x.swaps}</th><th>{x.stay}</th></tr></thead>
        <tbody>{s.rows.map(r => <tr key={r.eventId}>
          <td><b>{r.name}</b></td><td>{r.band}</td><td className="num">{r.count}/{r.max}</td>
          <td className="bad-text">{r.wrong.map(w => <span key={w.id} className="tl-warn" title={`Lv ${w.level}`}>⚠ {w.name} · Lv {w.level}</span>)}</td>
          <td>{r.pairs.map((p, i) => <div key={i}>{p.out} → <b>{p.in}</b> (Lv {p.inLevel})</div>)}</td>
          <td>{r.stay.join(', ')}</td>
        </tr>)}</tbody>
      </SortTable>}
    </div>
    {s.swaps?.length > 0 && <div className="panel table-panel">
      <div className="dp-table-head"><b>{x.history}</b></div>
      <SortTable><thead><tr><th>{x.time}</th><th>{x.tournament}</th><th>{x.out}</th><th>{x.in}</th><th>{x.result}</th></tr></thead>
        <tbody>{s.swaps.map((w, i) => <tr key={i}><td>{new Date(w.at).toLocaleTimeString()}</td><td>{w.event}</td><td>{w.out} (Lv {w.outLevel})</td><td>{w.in} (Lv {w.inLevel})</td><td className={w.ok ? 'good-text' : 'bad-text'}>{w.ok ? x.ok : `${x.fail} · ${w.message}`}</td></tr>)}</tbody>
      </SortTable></div>}
    <details className="panel pvp-how"><summary>{t.lang === 'tr' ? 'Nasıl çalışır?' : 'How does it work?'}</summary><ul>{x.how.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>;
}
