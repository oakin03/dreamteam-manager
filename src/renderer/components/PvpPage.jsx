import { useEffect, useState } from 'react';
import PvpPanel from './PvpPanel';

const api = window.dreamteam;
const TEXT = {
  tr: {
    title: 'PVP Arena', subtitle: 'Seçili hesaplar günlük PVP hakları bitene kadar maç yapar',
    accounts: 'Hesaplar', selectAll: 'Tümünü seç', clear: 'Seçimi temizle', start: 'PVP Başlat ({n})', stop: 'Durdur', check: 'Durumu yenile', checking: 'Kontrol ediliyor…',
    arena: 'Arena', open: 'Açık', closed: 'Kapalı', next: { morning: 'Sonraki oturum: sabah 05:00 (TR)', evening: 'Sonraki oturum: akşam 17:00 (TR)' }, unknown: 'Bilinmiyor', checkedAt: 'Son kontrol {t}', attempts: 'Kalan hak',
    how: 'Nasıl çalışır?',
    howLines: [
      'Arena oyunda her gün 17:00 ve 05:00\'te (TR) açılır ama saat sınırı yoktur; açık olup olmadığı oyundan okunur.',
      'Her hesap "maç bul → maç bitsin → tekrar bul" döngüsüyle günlük 10 hakkı bitene kadar oynar. Haklar 19:10\'da yenilenir.',
      'Hesap zaten bir maçtaysa o maçın bitmesi beklenir, sonra PVP denenir.',
      'Arena kapalıysa ya da oyun içinde kapanırsa o hesap "PVP şu an aktif değil" diye durur; diğer hesaplar devam eder.',
      'Başlatırken seçili hesaplarda çalışan Auto Play durdurulur ve PVP bitince yeniden başlatılır.',
      'Aynı görevi Auto Play sayfasındaki "Zamanla" ile belirli bir saate de kurabilirsin.'
    ]
  },
  en: {
    title: 'PVP Arena', subtitle: 'The selected accounts play until their daily PVP attempts are used up',
    accounts: 'Accounts', selectAll: 'Select all', clear: 'Clear selection', start: 'Start PVP ({n})', stop: 'Stop', check: 'Refresh status', checking: 'Checking…',
    arena: 'Arena', open: 'Open', closed: 'Closed', next: { morning: 'Next session: morning 05:00 (TR)', evening: 'Next session: evening 17:00 (TR)' }, unknown: 'Unknown', checkedAt: 'Last check {t}', attempts: 'Attempts left',
    how: 'How does it work?',
    howLines: [
      'The arena opens every day at 17:00 and 05:00 (TR) but there is no time gate: whether it is open is read from the game.',
      'Each account loops "find a match → let it end → find again" until its 10 daily attempts are used. Attempts reset at 19:10.',
      'If an account is already in a match, PVP waits for it to end first.',
      'If the arena is closed or closes during the run, that account stops with "PVP is not active right now"; the others continue.',
      'On start, Auto Play running on the selected accounts is stopped and started again when PVP is over.',
      'The same task can be set for a time with "Schedule" on the Auto Play page.'
    ]
  }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');

export default function PvpPage({ state, t, toast, refresh }) {
  const x = TEXT[t.lang] || TEXT.en;
  const pvp = state.pvp || {};
  const accounts = state.accounts || [];
  const [ids, setIds] = useState(() => (state.settings?.pvpAccountIds || accounts.map(a => a.id)).filter(id => accounts.some(a => a.id === id)));
  const [checking, setChecking] = useState(false);
  const running = Boolean(pvp.running);
  const st = pvp.status;
  const save = next => { setIds(next); api.settings.update({ pvpAccountIds: next }).catch(() => {}); };
  const toggle = id => save(ids.includes(id) ? ids.filter(v => v !== id) : [...ids, id]);
  const check = async () => { setChecking(true); try { await api.pvp.status(accounts.map(a => a.id)); } catch (e) { toast(e.message, 'error'); } finally { setChecking(false); } };
  useEffect(() => { check(); }, []);
  const act = async fn => { try { await fn(); await refresh?.(); } catch (e) { toast(e.message, 'error'); } };
  const arenaTone = st?.active === true ? 'ok' : st?.active === false ? 'bad' : 'muted';

  return <div className="page pvp-page">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar">
        <button className="btn ghost" disabled={checking} onClick={check}>{checking ? x.checking : x.check}</button>
        {running ? <button className="btn danger-soft" onClick={() => act(() => api.pvp.stop())}>{x.stop}</button>
          : <button className="btn primary" disabled={!ids.length} onClick={() => act(() => api.pvp.start(ids))}>{fill(x.start, { n: ids.length })}</button>}
      </div></div>

    <div className="pvp-status">
      <div className={`panel pvp-arena ${arenaTone}`}><span>{x.arena}</span><b>{st?.active === true ? x.open : st?.active === false ? x.closed : x.unknown}</b>{st?.active === false && x.next[st.nextSession] && <em>{x.next[st.nextSession]}</em>}{st?.checkedAt && <small>{fill(x.checkedAt, { t: new Date(st.checkedAt).toLocaleTimeString() })}</small>}</div>
      <div className="panel pvp-accounts">
        <div className="pvp-accounts-head"><b>{x.accounts}</b><button className="chip" disabled={running} onClick={() => save(ids.length === accounts.length ? [] : accounts.map(a => a.id))}>{ids.length === accounts.length ? x.clear : x.selectAll}</button></div>
        <div className="pvp-picks">{accounts.map(a => { const n = st?.attempts?.[a.id]; return <button key={a.id} type="button" disabled={running} className={ids.includes(a.id) ? 'selected' : ''} onClick={() => toggle(a.id)}>
          <span>{a.name}</span><em className={n === 0 ? 'zero' : ''} title={x.attempts}>{n == null ? '—' : `${n}/10`}</em></button>; })}</div>
      </div>
    </div>

    <PvpPanel pvp={pvp} lang={t.lang} />

    <details className="panel pvp-how"><summary>{x.how}</summary><ul>{x.howLines.map(l => <li key={l}>{l}</li>)}</ul></details>
  </div>;
}
