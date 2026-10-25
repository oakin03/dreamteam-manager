import { useEffect, useState } from 'react';

const api = window.dreamteam;
const TEXT = {
  tr: {
    title: 'Günlük durdurma', enable: 'Auto Play\'i her gün durdur', at: 'saat', tr: '(TR)', resume: 'Sonra yeniden başlat', hint: 'Turnuvalar her gün 15:00\'te (TR) başlıyor; o sırada Auto Play maç oynuyorsa turnuva maçı hükmen kaybediliyor. Bu saatte çalışan bütün Auto Play\'ler durdurulur.',
    today: 'Bugün {time}\'te {n} hesap durduruldu', resumed: 'Bugün {time}\'te yeniden başlatıldı', next: 'Sıradaki durdurma: {time} (TR)',
    tnEnable: 'Turnuva kaydını her gün otomatik başlat', tnHint: 'Bu saatte zamanlayıcıya bir "Turnuva kaydı" görevi eklenir: seçili hesaplardaki diğer görevler geçici olarak durdurulur, turnuva kaydı açılana kadar beklenir, kayıt bitince durdurulan görevler yeniden başlatılır. Hesaplar: Turnuva sayfasında en son seçilenler (seçim yoksa hepsi).',
    tnToday: 'Bugün {time}\'te başlatıldı', tnNext: 'Sıradaki kayıt: {time} (TR)', tnAccounts: '{n} hesap',
    pvpEnable: 'PVP görevini her gün otomatik başlat', pvpHint: 'Bu saatte zamanlayıcıya bir "PVP Arena" görevi eklenir: seçili hesaplarda çalışan diğer görevler geçici olarak durdurulur, maçtaki hesabın maçı bitene kadar beklenir, her hesap günlük 10 hakkını bitirene kadar oynar, sonra durdurulan görevler yeniden başlatılır. Hesaplar: PVP sayfasında en son seçilenler (seçim yoksa hepsi).', pvpNext: 'Sıradaki PVP: {time} (TR)'
  },
  en: {
    title: 'Daily stop', enable: 'Stop Auto Play every day', at: 'at', tr: '(TR)', resume: 'Start again at', hint: 'Tournaments start every day at 15:00 (TR); an account still in an Auto Play match loses its tournament match by forfeit. Every running Auto Play is stopped at this time.',
    today: 'Today {n} account(s) were stopped at {time}', resumed: 'Started again today at {time}', next: 'Next stop: {time} (TR)',
    tnEnable: 'Start tournament registration every day', tnHint: 'At this time a "Tournament registration" task is added to the scheduler: other tasks on the chosen accounts are paused, it waits until registration opens, and when registration is done the paused tasks start again. Accounts: the last selection on the Tournament page (all when none).',
    tnToday: 'Started today at {time}', tnNext: 'Next registration: {time} (TR)', tnAccounts: '{n} account(s)',
    pvpEnable: 'Start the PVP task every day', pvpHint: 'At this time a "PVP Arena" task is added to the scheduler: other tasks on the chosen accounts are paused, an account in a match is waited for, every account plays until its 10 daily attempts are used, then the paused tasks start again. Accounts: the last selection on the PVP page (all when none).', pvpNext: 'Next PVP: {time} (TR)'
  }
};
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
const trToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());

// One daily line (tournament registration, PVP): tick = runs every day at the time.
function DailyLine({ state, x, icon, settingsKey, stateKey, accountsKey, defaults, label, hint, nextText }) {
  const saved = { ...defaults, ...(state.settings?.[settingsKey] || {}) };
  const [cfg, setCfg] = useState(saved);
  useEffect(() => { setCfg(saved); }, [JSON.stringify(state.settings?.[settingsKey] || {})]);
  const save = patch => { const next = { ...cfg, ...patch }; setCfg(next); api.settings.update({ [settingsKey]: next }).catch(() => {}); };
  const done = state.settings?.[stateKey]?.date === trToday();
  const all = (state.accounts || []).map(a => a.id);
  const chosen = (state.settings?.[accountsKey] || []).filter(id => all.includes(id));
  return <div className={`panel ap-stop ${cfg.enabled ? 'on' : ''}`} title={hint}>
    <span className="ap-stop-icon">{icon}</span>
    <label className="ap-stop-main"><input type="checkbox" checked={cfg.enabled} onChange={e => save({ enabled: e.target.checked })} /><b>{label}</b></label>
    <span>{x.at}</span><input type="time" value={cfg.at} onChange={e => save({ at: e.target.value })} /><span className="muted-text">{x.tr}</span>
    <span className="ap-stop-sep" />
    <span className="muted-text">{fill(x.tnAccounts, { n: chosen.length || all.length })}</span>
    <span className="ap-stop-status">{done ? fill(x.tnToday, { time: cfg.at }) : cfg.enabled ? fill(nextText, { time: cfg.at }) : ''}</span>
  </div>;
}

// Auto Play page: daily stop (default 14:55 TR, before the 15:00 tournament) and an
// optional restart time. Saved in the settings right away.
export default function AutoPlayStopBar({ state, t }) {
  const x = TEXT[t.lang] || TEXT.en;
  const saved = { enabled: false, stopAt: '14:55', resumeEnabled: false, resumeAt: '16:00', ...(state.settings?.autoPlayStop || {}) };
  const [cfg, setCfg] = useState(saved);
  useEffect(() => { setCfg(saved); }, [JSON.stringify(state.settings?.autoPlayStop || {})]);
  const save = patch => { const next = { ...cfg, ...patch }; setCfg(next); api.settings.update({ autoPlayStop: next }).catch(() => {}); };
  const st = state.settings?.autoPlayStopState || {};
  const today = trToday();
  return <div className="ap-stop-rows"><div className={`panel ap-stop ${cfg.enabled ? 'on' : ''}`} title={x.hint}>
    <span className="ap-stop-icon">⏰</span>
    <label className="ap-stop-main"><input type="checkbox" checked={cfg.enabled} onChange={e => save({ enabled: e.target.checked })} /><b>{x.enable}</b></label>
    <span>{x.at}</span><input type="time" value={cfg.stopAt} onChange={e => save({ stopAt: e.target.value })} /><span className="muted-text">{x.tr}</span>
    <span className="ap-stop-sep" />
    <label><input type="checkbox" disabled={!cfg.enabled} checked={cfg.resumeEnabled} onChange={e => save({ resumeEnabled: e.target.checked })} />{x.resume}</label>
    <input type="time" disabled={!cfg.enabled || !cfg.resumeEnabled} value={cfg.resumeAt} onChange={e => save({ resumeAt: e.target.value })} />
    <span className="ap-stop-status">{st.stopDate === today ? fill(x.today, { n: (st.stopped?.length ?? 0) || '0', time: cfg.stopAt }) + (st.resumeDate === today ? ' · ' + fill(x.resumed, { time: cfg.resumeAt }) : '') : cfg.enabled ? fill(x.next, { time: cfg.stopAt }) : ''}</span>
  </div>
  <DailyLine state={state} x={x} icon="🏆" settingsKey="dailyTournament" stateKey="dailyTournamentState" accountsKey="tournamentAccountIds" defaults={{ enabled: true, at: '15:48' }} label={x.tnEnable} hint={x.tnHint} nextText={x.tnNext} />
  <DailyLine state={state} x={x} icon="⚔️" settingsKey="dailyPvp" stateKey="dailyPvpState" accountsKey="pvpAccountIds" defaults={{ enabled: true, at: '05:01' }} label={x.pvpEnable} hint={x.pvpHint} nextText={x.pvpNext} />
  </div>;
}
