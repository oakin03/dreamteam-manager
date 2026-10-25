import { useEffect, useState } from 'react';
import { filOf } from '../i18n-fil';

const api = window.dreamteam;
const TEXT = {
  tr: {
    plan: 'Günlük plan', planHint: 'her gün TR saatiyle', off: 'Kapalı',
    title: 'Günlük durdurma', enable: 'Auto Play\'i her gün durdur', at: 'saat', tr: '(TR)', resume: 'Sonra yeniden başlat', hint: 'Turnuvalar her gün 15:00\'te (TR) başlıyor; o sırada Auto Play maç oynuyorsa turnuva maçı hükmen kaybediliyor. Bu saatte çalışan bütün Auto Play\'ler durdurulur.',
    today: 'Bugün {time}\'te {n} hesap durduruldu', resumed: 'Bugün {time}\'te yeniden başlatıldı', next: 'Sıradaki durdurma: {time} (TR)',
    tnEnable: 'Turnuva kaydını her gün otomatik başlat', tnHint: 'Bu saatte zamanlayıcıya bir "Turnuva kaydı" görevi eklenir: seçili hesaplardaki diğer görevler geçici olarak durdurulur, turnuva kaydı açılana kadar beklenir, kayıt bitince durdurulan görevler yeniden başlatılır. Hesaplar: Turnuva sayfasında en son seçilenler (seçim yoksa hepsi).',
    tnToday: 'Bugün {time}\'te başlatıldı', tnNext: 'Sıradaki kayıt: {time} (TR)', tnAccounts: '{n} hesap',
    pvpEnable: 'PVP görevini her gün otomatik başlat', pvpHint: 'Bu saatte zamanlayıcıya bir "PVP Arena" görevi eklenir: seçili hesaplarda çalışan diğer görevler geçici olarak durdurulur, maçtaki hesabın maçı bitene kadar beklenir, her hesap günlük 10 hakkını bitirene kadar oynar, sonra durdurulan görevler yeniden başlatılır. Hesaplar: PVP sayfasında en son seçilenler (seçim yoksa hepsi).', pvpNext: 'Sıradaki PVP: {time} (TR) · arena kapalıysa açılınca başlar'
  },
  en: {
    plan: 'Daily plan', planHint: 'every day, TR time', off: 'Off',
    title: 'Daily stop', enable: 'Stop Auto Play every day', at: 'at', tr: '(TR)', resume: 'Start again at', hint: 'Tournaments start every day at 15:00 (TR); an account still in an Auto Play match loses its tournament match by forfeit. Every running Auto Play is stopped at this time.',
    today: 'Today {n} account(s) were stopped at {time}', resumed: 'Started again today at {time}', next: 'Next stop: {time} (TR)',
    tnEnable: 'Start tournament registration every day', tnHint: 'At this time a "Tournament registration" task is added to the scheduler: other tasks on the chosen accounts are paused, it waits until registration opens, and when registration is done the paused tasks start again. Accounts: the last selection on the Tournament page (all when none).',
    tnToday: 'Started today at {time}', tnNext: 'Next registration: {time} (TR)', tnAccounts: '{n} account(s)',
    pvpEnable: 'Start the PVP task every day', pvpHint: 'At this time a "PVP Arena" task is added to the scheduler: other tasks on the chosen accounts are paused, an account in a match is waited for, every account plays until its 10 daily attempts are used, then the paused tasks start again. Accounts: the last selection on the PVP page (all when none).', pvpNext: 'Next PVP: {time} (TR) · starts when the arena opens'
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const trToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());

// One column of the "daily plan" card: a switch, the time and what happens next.
function PlanColumn({ on, onToggle, title, time, onTime, sub, hint, extra }) {
  return <div className={'ap-plan-col' + (on ? ' on' : '')} title={hint}>
    <button type="button" role="switch" aria-checked={on} aria-label={title} className="ap-switch" onClick={onToggle}><i /></button>
    <div className="ap-plan-txt"><b>{title}</b><small>{sub}</small>{extra}</div>
    <input type="time" value={time} onChange={e => onTime(e.target.value)} aria-label={title} />
  </div>;
}

function useSaved(state, key, defaults) {
  const saved = { ...defaults, ...(state.settings?.[key] || {}) };
  const [cfg, setCfg] = useState(saved);
  useEffect(() => { setCfg(saved); }, [JSON.stringify(state.settings?.[key] || {})]);
  const save = patch => { const next = { ...cfg, ...patch }; setCfg(next); api.settings.update({ [key]: next }).catch(() => {}); };
  return [cfg, save];
}

// Auto Play page: the daily stop (default 14:55 TR, before the 15:00 tournament) with an
// optional restart, and the daily tournament registration and PVP lines. Saved at once.
export default function AutoPlayStopBar({ state, t }) {
  const x = TEXT[t.lang] || TEXT.en;
  const [stop, saveStop] = useSaved(state, 'autoPlayStop', { enabled: false, stopAt: '14:55', resumeEnabled: false, resumeAt: '16:00' });
  const [tn, saveTn] = useSaved(state, 'dailyTournament', { enabled: true, at: '15:48' });
  const [pvp, savePvp] = useSaved(state, 'dailyPvp', { enabled: true, at: '05:01' });
  const st = state.settings?.autoPlayStopState || {};
  const today = trToday();
  const all = (state.accounts || []).map(a => a.id);
  const count = key => (state.settings?.[key] || []).filter(id => all.includes(id)).length || all.length;
  const stopSub = st.stopDate === today
    ? fill(x.today, { n: (st.stopped?.length ?? 0) || '0', time: stop.stopAt }) + (st.resumeDate === today ? ' · ' + fill(x.resumed, { time: stop.resumeAt }) : '')
    : stop.enabled ? fill(x.next, { time: stop.stopAt }) : x.off;
  const lineSub = (cfg, stateKey, nextText, accountsKey) => {
    const done = state.settings?.[stateKey]?.date === today;
    return [done ? fill(x.tnToday, { time: cfg.at }) : cfg.enabled ? fill(nextText, { time: cfg.at }) : x.off, fill(x.tnAccounts, { n: count(accountsKey) })].join(' · ');
  };
  return <div className="panel ap-plan">
    <div className="ap-plan-head"><b>{x.plan}</b><span>{x.planHint}</span></div>
    <div className="ap-plan-grid">
      <PlanColumn on={stop.enabled} onToggle={() => saveStop({ enabled: !stop.enabled })} title={x.enable} time={stop.stopAt} onTime={v => saveStop({ stopAt: v })} sub={stopSub} hint={x.hint}
        extra={<label className="ap-plan-resume"><input type="checkbox" disabled={!stop.enabled} checked={stop.resumeEnabled} onChange={e => saveStop({ resumeEnabled: e.target.checked })} /><span>{x.resume}</span><input type="time" disabled={!stop.enabled || !stop.resumeEnabled} value={stop.resumeAt} onChange={e => saveStop({ resumeAt: e.target.value })} /></label>} />
      <PlanColumn on={tn.enabled} onToggle={() => saveTn({ enabled: !tn.enabled })} title={x.tnEnable} time={tn.at} onTime={v => saveTn({ at: v })} sub={lineSub(tn, 'dailyTournamentState', x.tnNext, 'tournamentAccountIds')} hint={x.tnHint} />
      <PlanColumn on={pvp.enabled} onToggle={() => savePvp({ enabled: !pvp.enabled })} title={x.pvpEnable} time={pvp.at} onTime={v => savePvp({ at: v })} sub={lineSub(pvp, 'dailyPvpState', x.pvpNext, 'pvpAccountIds')} hint={x.pvpHint} />
    </div>
  </div>;
}
