import { useEffect, useMemo, useState } from 'react';
import { filOf } from '../i18n-fil';
import { GroupedPicks, orderOf } from './AccountGroups';
import { RotationModes } from './RotationPanel';

// Turnuva → Canlı (user 2026-11-13): one table of every account of ours in the tournament, updated
// live. A row opens to the matches from round 1: the opponent and the score (green = we won, red =
// we lost). Through / knocked out is shown on every row. Props for the ticked accounts on top,
// rotation per account (all on by default), the accounts whose Auto Play stops by itself at 14:54.
const api = window.dreamteam;
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const TYPE = { TK: 'TK', TICKET: 'TIX', APK: 'APK', STONE: 'Stone', MATERIALS: 'Fabric', STAR: '', EXCLUSIVE: 'Essence' };
const amountOf = (n, type) => `${Number(n).toLocaleString('tr-TR')} ${TYPE[type] ?? type ?? ''}`.trim();
const clock = s => (s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const TEXT = {
  tr: {
    auto: 'Otomatik hesaplar', autoHint: 'Seçili hesapların Auto Play\'i her gün {at}\'te kendiliğinden durur; elenince ya da turnuva bitince Auto Play yeniden başlar.',
    selectAll: 'Tümünü seç', clear: 'Seçimi kaldır', save: 'Kaydet',
    none: 'Şu an süren bir turnuvada hesabın yok. Turnuva her gün 15:00\'te başlar; başlayınca burası kendiliğinden dolar.',
    account: 'Hesap', event: 'Turnuva', round: 'Tur', opponent: 'Rakip', score: 'Skor', period: 'Periyot', state: 'Durum', rotation: 'Rotasyon',
    st: { playing: 'Maçta', through: 'Devam ediyor', out: 'Elendi · {round}. tur', outNoRound: 'Elendi', champion: 'Şampiyon' },
    props: 'Seçilenlere prop bas ({n})', propsHint: 'Günlük İşler\'deki Prop gibi: devre arasında ilk 5\'e prop basar. Rotasyon açıksa prop sadece maça başlayan as beşliye basılır; aslar devre arasından önce sahaya döndürülür.', propsStarted: '{n} hesapta prop başlatıldı',
    next: '{round}. tur {time} sonra', roundOf: 'Tur {round}/{total}', left: 'Kalan takım {left}/{all}', ours: 'Bizden devam eden {left}/{all}', earned: 'Tur geçen {n} hesabın kazandığı ödül: {amount}', stoppedAt: 'Bugün {n} hesabın Auto Play\'i durduruldu', over: 'Bitti', doneForUs: 'Bizim için bitti',
    walk: '25-0 biten maçlar ({n})', walkOurs: 'bizim', rotAll: 'Hepsinde aç', rotNone: 'Hepsinde kapat',
    rotStats: '{subs} değişiklik · {to} mola · {tac} taktik', rotHint: 'İşaretli hesapların turnuva maçlarında rotasyon çalışır (varsayılan hepsi).',
    matchRow: '{round}. tur', live: 'canlı', walkover: '25-0 hükmen', noMatches: 'Henüz maç yok.', open: 'Turları göster', selectRows: 'Hepsini seç'
  },
  en: {
    auto: 'Automatic accounts', autoHint: 'The Auto Play of the ticked accounts stops by itself every day at {at}; once knocked out, or when the tournament ends, Auto Play starts again.',
    selectAll: 'Select all', clear: 'Clear selection', save: 'Save',
    none: 'No account of yours is in a running tournament. The tournament starts every day at 15:00; this fills by itself then.',
    account: 'Account', event: 'Tournament', round: 'Round', opponent: 'Opponent', score: 'Score', period: 'Quarter', state: 'State', rotation: 'Rotation',
    st: { playing: 'Playing', through: 'Still in', out: 'Out · round {round}', outNoRound: 'Out', champion: 'Champion' },
    props: 'Props on the ticked ({n})', propsHint: 'Like Props in Daily tasks: puts props on the starters at halftime. With rotation on, only the starting five get them; the aces are put back on court before halftime.', propsStarted: 'Props started on {n} account(s)',
    next: 'Round {round} in {time}', roundOf: 'Round {round}/{total}', left: 'Teams left {left}/{all}', ours: 'Ours still in {left}/{all}', earned: 'Reward won so far by {n} account(s) through: {amount}', stoppedAt: 'Auto Play of {n} account(s) stopped today', over: 'Over', doneForUs: 'Over for us',
    walk: 'Games ended 25-0 ({n})', walkOurs: 'ours', rotAll: 'On for all', rotNone: 'Off for all',
    rotStats: '{subs} sub(s) · {to} timeout(s) · {tac} tactic(s)', rotHint: 'The tournament matches of the ticked accounts get the rotation (all by default).',
    matchRow: 'Round {round}', live: 'live', walkover: '25-0 walkover', noMatches: 'No match yet.', open: 'Show rounds', selectRows: 'Select all'
  },
  get fil() { return filOf(this.en); }
};

const stateOf = r => r.champion ? 'champion' : r.out ? 'out' : r.live ? 'playing' : 'through';

export default function TournamentLiveTab({ state, t, toast }) {
  const x = TEXT[t.lang] || TEXT.en;
  const tl = state.tournamentLive || { autoIds: [], rotationOff: [], events: [], rows: [] };
  const accounts = state.accounts || [];
  const [auto, setAuto] = useState(null);
  const autoIds = auto ?? tl.autoIds ?? [];
  const [sel, setSel] = useState(() => new Set());
  const [open, setOpen] = useState(() => new Set());
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  // still in first, then by name
  const rows = useMemo(() => [...(tl.rows || [])].sort((a, b) => (a.out - b.out) || (b.live - a.live) || (orderOf(a) - orderOf(b))), [tl.rows]);
  const toggle = (setter, id) => setter(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const props = async () => {
    const ids = [...sel];
    await Promise.all(ids.map(id => api.props.run(id).catch(e => toast(`${accounts.find(a => a.id === id)?.name || id}: ${e.message}`, 'error'))));
    toast(fill(x.propsStarted, { n: ids.length }), 'success');
  };
  const rot = new Map((state.rotation?.live || []).map(r => [r.accountId, r]));
  const setRot = (ids, on) => api.tlive.setRotation(ids, on).catch(e => toast(e.message, 'error'));
  const liveIds = rows.filter(r => !r.out).map(r => r.accountId);

  return <>
    {(tl.events || []).map(e => { const left = e.endsAt ? Math.max(0, Math.round((e.endsAt - now) / 1000)) : null; const done = e.over || e.doneForUs; return <div key={e.id} className={`panel ab-status ${done ? 'muted' : 'ok'} tl-event`}>
      <span className={`pill ${done ? 'muted' : 'ok'}`}><i />{e.name}{e.minLevel != null && e.maxLevel != null ? ` (${e.minLevel}-${e.maxLevel})` : ''}</span>
      {e.over ? <b>{x.over}</b> : e.doneForUs ? <b>{x.doneForUs}</b> : null}
      {!done && e.round != null && <span>{fill(x.roundOf, { round: e.round, total: e.totalRounds || '?' })}</span>}
      {!done && left != null && left > 0 && <b className="tl-next">{fill(x.next, { round: e.nextRound ?? (e.round || 0) + 1, time: clock(left) })}</b>}
      {e.ours > 0 && <span className={e.oursLeft ? 'good-text' : 'bad-text'}>{fill(x.ours, { left: e.oursLeft, all: e.ours })}</span>}
      {e.players > 0 && <span className="muted-text">{fill(x.left, { left: e.left, all: e.players })}</span>}
      {e.earners > 0 && <b className="good-text">{fill(x.earned, { n: e.earners, amount: e.type === 'STAR' || e.rewardType === 'STAR' ? e.earners : amountOf(e.earned, e.rewardType) })}</b>}
      {e.walkovers?.length > 0 && <details className="tl-walk"><summary>{fill(x.walk, { n: e.walkovers.length })}</summary>
        <div>{e.walkovers.map((w, i) => <span key={i} className={w.ours ? 'ours' : ''}>{fill(x.matchRow, { round: w.round })} · <b>{w.winner}</b> 25-0 {w.loser}{w.ours ? ` (${x.walkOurs})` : ''}</span>)}</div></details>}
    </div>; })}

    <div className="panel table-panel dp-table">
      <div className="pg-bar tl-bar">
        <button className="btn primary" disabled={!sel.size} title={x.propsHint} onClick={props}>{fill(x.props, { n: sel.size })}</button>
        <button className="chip" disabled={!liveIds.length} onClick={() => setSel(new Set(liveIds))}>{x.selectRows}</button>
        <span className="sp" />
        <span className="muted-text" title={x.rotHint}>{x.rotation}:</span>
        <button className="chip" disabled={!rows.length} onClick={() => setRot(rows.map(r => r.accountId), true)}>{x.rotAll}</button>
        <button className="chip" disabled={!rows.length} onClick={() => setRot(rows.map(r => r.accountId), false)}>{x.rotNone}</button>
      </div>
      {rows.length ? <table className="tl-table"><thead><tr><th className="select-col" /><th /><th>{x.account}</th><th>{x.state}</th><th>{x.round}</th><th>{x.opponent}</th><th>{x.score}</th><th>{x.period}</th><th title={x.rotHint}>{x.rotation}</th></tr></thead>
        <tbody>{rows.map(r => { const st = stateOf(r); const ro = rot.get(r.accountId); const isOpen = open.has(r.accountId + r.eventId); const win = r.score != null && r.oppScore != null && r.done ? (r.won ? 'w' : 'l') : ''; return [
          <tr key={r.accountId + r.eventId} className={`tl-row ${st === 'playing' ? 'dp-live' : ''} ${r.out ? 'tl-out' : ''}`} onClick={() => toggle(setOpen, r.accountId + r.eventId)}>
            <td className="select-col" onClick={e => e.stopPropagation()}><input type="checkbox" disabled={r.out} checked={sel.has(r.accountId)} onChange={() => toggle(setSel, r.accountId)} /></td>
            <td className="tl-arrow" title={x.open}>{isOpen ? '▾' : '▸'}</td>
            <td><b>{r.name}</b><small className="cell-sub">{r.event}</small></td>
            <td><span className={`pill ${st === 'out' ? 'bad' : st === 'playing' ? 'warn' : 'ok'}`}><i />{st === 'out' ? (r.outRound ? fill(x.st.out, { round: r.outRound }) : x.st.outNoRound) : x.st[st]}</span></td>
            <td className="num">{r.round ?? '—'}{r.totalRounds ? `/${r.totalRounds}` : ''}</td>
            <td>{r.opponent || '—'}</td>
            <td className={`num tl-score ${win}`}><b>{r.score ?? '—'}</b> – {r.oppScore ?? '—'}{r.live && <i className="dp-dot" title={x.live} />}</td>
            <td>{r.halftime ? 'HT' : r.quarter ? `Q${r.quarter} ${r.timeLeft || ''}` : '—'}</td>
            <td onClick={e => e.stopPropagation()}><label className="tl-rot"><input type="checkbox" checked={r.rotation !== false} onChange={e => setRot([r.accountId], e.target.checked)} />{ro && <small>{fill(x.rotStats, { subs: ro.subs, to: ro.timeoutsUsed, tac: ro.strategies })}</small>}</label>
              {ro && !ro.off && <button className="link-btn" title="×" onClick={() => api.rotation.stop(r.accountId).catch(err => toast(err.message, 'error'))}>×</button>}</td>
          </tr>,
          isOpen && <tr key={r.accountId + r.eventId + '-h'} className="tl-detail"><td colSpan={9}>
            {(r.history || []).length ? <div className="tl-matches">{r.history.map(h => <div key={h.round} className={`tl-match ${h.won === true ? 'w' : h.won === false ? 'l' : 'live'}`}>
              <span className="tl-r">{fill(x.matchRow, { round: h.round })}</span>
              <span className="tl-o">{h.opp || '—'}</span>
              <b className="tl-s">{h.my ?? '—'} – {h.their ?? '—'}</b>
              <small>{h.walkover ? x.walkover : h.live ? `${x.live}${h.quarter ? ` · Q${h.quarter} ${h.timeLeft || ''}` : ''}` : ''}</small>
            </div>)}</div> : <span className="muted-text">{x.noMatches}</span>}
          </td></tr>
        ]; })}</tbody></table> : <p className="muted-text dp-pad">{x.none}</p>}
    </div>

    <div className="panel dp-section">
      <div className="dp-table-head dp-flush"><b>{x.auto}</b>
        <span className="sp" />
        <button className="chip" onClick={() => setAuto(autoIds.length === accounts.length ? [] : accounts.map(a => a.id))}>{autoIds.length === accounts.length ? x.clear : x.selectAll}</button>
        {auto && <button className="btn primary small" onClick={() => api.tlive.setAuto(auto).then(() => setAuto(null)).catch(e => toast(e.message, 'error'))}>{x.save}</button>}
      </div>
      <small className="muted-text">{fill(x.autoHint, { at: tl.stopAt || '14:54' })}</small>
      <div className="pvp-picks"><GroupedPicks storeKey="tlive-auto" accounts={accounts} selected={autoIds} onSet={ids => setAuto(ids)} render={a => <button key={a.id} type="button" className={autoIds.includes(a.id) ? 'selected' : ''} onClick={() => setAuto(autoIds.includes(a.id) ? autoIds.filter(i => i !== a.id) : [...autoIds, a.id])}><span>{a.name}</span></button>} /></div>
      {tl.stopped?.items?.length > 0 && <small className="muted-text">{fill(x.stoppedAt, { n: tl.stopped.items.length })}</small>}
    </div>

    <RotationModes state={state} t={t} toast={toast} only={['tournament']} />
  </>;
}
