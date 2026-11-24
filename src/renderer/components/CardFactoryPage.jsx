import { useEffect, useState } from 'react';
import SortTable from './SortTable';
import { filOf } from '../i18n-fil';
import { GroupedPicks, useGroupedRows, groupRowOf, sumOf } from './AccountGroups';

const api = window.dreamteam;

// Kart Fabrikası (user 2026-11-24): a target account gets N cheap players from side accounts and
// turns every one into a star card.
const TEXT = {
  tr: {
    title: 'Kart Fabrikası', subtitle: 'Yan hesaplar ucuz oyuncu alır, hedef hesaba verir, hedef hepsini karta çevirir',
    target: 'Hedef hesap', chooseTarget: 'Hedef hesabı seç…', maxPrice: 'Maksimum fiyat (TK)', goal: 'Kaç oyuncu', parallel: 'Aynı anda yan hesap',
    sides: 'Yan hesaplar', selectAll: 'Tümünü seç', clear: 'Temizle', sidesN: '{n} yan hesap seçili',
    hint: 'Scout fiyatı maksimum fiyat ve altındaki her oyuncu alınır (rol bakılmaz; Satılabilir / Stok / ekstra kart rolü yok). Her hesap kendi Scout’unu, ücretsiz yenilemelerini (Callback eşyası kullanılmaz) ve arkadaşlarının Scout’larını kullanır; yer kalırsa diğer hesaplarımızı arkadaş ekleyip onların Scout’larından da alır. Kadrosu dolan yan hesap hedefe takas eder (odalar sırayla), hedef kadrosu dolunca karta çevirir. Hedef de kendi Scout’undan alır. Sadece bu servisin aldığı oyuncular takas edilir ve karta çevrilir.',
    tk: 'TK kontrolü', tkCheck: 'TK’yı kontrol et', tkOk: 'Hedefte {funds} TK var · kalan {remaining} oyuncu için en fazla {need} TK gerekiyor · yeterli', tkShort: 'Hedefte {funds} TK var · kalan {remaining} oyuncu için en fazla {need} TK gerekiyor · yetmiyor (~{covers} oyuncuya yeter). Başlatılmaz.',
    start: 'Başlat', cont: 'Kaldığı yerden devam ({made}/{goal})', fresh: 'Baştan başla', freshAsk: 'Sayaç 0’dan başlayacak ({made} yapılmıştı). Emin misin?', stop: 'Durdur', yes: 'Evet', cancel: 'Vazgeç',
    progress: '{made} / {goal} kart', onTarget: 'hedefte karta çevrilmeyi bekleyen: {n}', onSides: 'yan hesaplarda takas bekleyen: {n}', rate: 'saatte ~{n} kart', eta: 'tahmini kalan süre ~{t}',
    status: { idle: 'Hazır', running: 'Çalışıyor', stopped: 'Durduruldu', error: 'Hata', done: 'Tamamlandı' },
    step: { waiting: 'Scout’ların yenilenmesi bekleniyor ({t})', makeWait: 'Karta çevirme sırası bekleniyor (oyun dakikada ~10’a izin veriyor)' },
    acc: { account: 'Hesap', role: 'Rol', status: 'Durum', signed: 'Alınan', traded: 'Hedefe verilen', spent: 'Harcanan TK', note: 'Not', target: 'Hedef', side: 'Yan' },
    st: { waiting: 'Sırada', opening: 'Açılıyor', scouting: 'Scout', trading: 'Takas', converting: 'Karta çevriliyor', open: 'Açık', error: 'Hata' },
    note: { full: 'kadrosu dolu', noFunds: 'TK yetmiyor' },
    needTarget: 'Hedef hesabı seç', needSides: 'En az bir yan hesap seç', needNums: 'Fiyat ve oyuncu sayısını gir',
    resetCount: 'Sayacı sıfırla', hours: 'sa', mins: 'dk'
  },
  en: {
    title: 'Card Factory', subtitle: 'Side accounts sign cheap players, give them to the target, the target turns them all into cards',
    target: 'Target account', chooseTarget: 'Choose the target…', maxPrice: 'Max price (TK)', goal: 'How many players', parallel: 'Side accounts at once',
    sides: 'Side accounts', selectAll: 'Select all', clear: 'Clear', sidesN: '{n} side account(s) chosen',
    hint: 'Every player with a Scout price at or under the max price is signed (no roles; no Satılabilir / Stok / extra card role). Every account uses its own Scout, its free callbacks (no Callback items) and its friends’ Scouts; with room left it befriends our other accounts and signs off their Scouts too. A side with a full roster trades to the target (one room after another), the target turns a full bench into cards. The target signs off its own Scout too. Only players this service signed are traded and made into cards.',
    tk: 'TK check', tkCheck: 'Check TK', tkOk: 'The target has {funds} TK · the remaining {remaining} players need up to {need} TK · enough', tkShort: 'The target has {funds} TK · the remaining {remaining} players need up to {need} TK · not enough (~{covers} players). It does not start.',
    start: 'Start', cont: 'Continue ({made}/{goal})', fresh: 'Start from 0', freshAsk: 'The count starts again at 0 ({made} were made). Sure?', stop: 'Stop', yes: 'Yes', cancel: 'Cancel',
    progress: '{made} / {goal} cards', onTarget: 'on the target waiting for Make: {n}', onSides: 'on sides waiting for a trade: {n}', rate: '~{n} cards an hour', eta: '~{t} left',
    status: { idle: 'Ready', running: 'Running', stopped: 'Stopped', error: 'Error', done: 'Done' },
    step: { waiting: 'Waiting for the Scouts to refresh ({t})', makeWait: 'Waiting for a Make turn (the game allows ~10 a minute)' },
    acc: { account: 'Account', role: 'Role', status: 'Status', signed: 'Signed', traded: 'Given to target', spent: 'TK spent', note: 'Note', target: 'Target', side: 'Side' },
    st: { waiting: 'Queued', opening: 'Opening', scouting: 'Scout', trading: 'Trading', converting: 'Making cards', open: 'Open', error: 'Error' },
    note: { full: 'roster full', noFunds: 'not enough TK' },
    needTarget: 'Choose the target account', needSides: 'Choose at least one side account', needNums: 'Enter the price and the count',
    resetCount: 'Reset the count', hours: 'h', mins: 'min'
  },
  get fil() { return filOf(this.en); }
};
const fill = (s, p = {}) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? ''));

export default function CardFactoryPage({ state, t, toast, msgText }) {
  const x = TEXT[t.lang] || TEXT.en;
  const cf = state.cardFactory || {};
  const accounts = state.accounts || [];
  const running = Boolean(cf.running);
  const saved = cf.config || {};
  const [form, setForm] = useState(() => ({ targetId: saved.targetId || '', sideIds: saved.sideIds || [], maxPrice: saved.maxPrice ?? 70, goal: saved.goal ?? 1000, parallel: saved.parallel ?? 10 }));
  const [tk, setTk] = useState(null);
  const [ask, setAsk] = useState(false);
  const grp = useGroupedRows('cf-rows');
  const set = patch => { const next = { ...form, ...patch }; setForm(next); setTk(null); api.cardFactory.config(patch).catch(() => {}); };
  const sides = form.sideIds.filter(id => id !== form.targetId && accounts.some(a => a.id === id));
  const problem = !form.targetId ? x.needTarget : !sides.length ? x.needSides : !(Number(form.maxPrice) >= 1 && Number(form.goal) >= 1) ? x.needNums : null;
  const cfg = () => ({ ...form, sideIds: sides, maxPrice: Number(form.maxPrice), goal: Number(form.goal), parallel: Number(form.parallel) });
  const check = async () => { try { setTk(await api.cardFactory.tkCheck(cfg())); } catch (e) { toast(e.message, 'error'); } };
  const start = async fresh => {
    setAsk(false);
    try {
      const r = await api.cardFactory.start(cfg(), fresh);
      if (r?.tkShort) { setTk(r.tkShort); toast(fill(x.tkShort, r.tkShort), 'error'); }
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { setTk(null); }, [cf.made]);
  const run = cf.run;
  const made = cf.made || 0;
  const goal = Number(run?.config?.goal || form.goal) || 0;
  const pct = goal ? Math.min(100, Math.round(made / goal * 100)) : 0;
  const dur = h => (h >= 1 ? `${Math.floor(h)} ${x.hours} ${Math.round((h % 1) * 60)} ${x.mins}` : `${Math.round(h * 60)} ${x.mins}`);
  const name = id => accounts.find(a => a.id === id)?.name || id;
  const rows = run ? Object.values(run.accounts || {}).map(r => ({ ...r, name: name(r.id) })) : [];
  const targetRow = rows.filter(r => r.role === 'target');
  const sideRows = rows.filter(r => r.role !== 'target');
  const row = r => <tr key={r.id} className={['scouting', 'trading', 'converting', 'opening'].includes(r.status) ? 'dp-live' : ''}>
    <td><b>{r.name}</b></td><td>{r.role === 'target' ? x.acc.target : x.acc.side}</td>
    <td className={r.status === 'error' ? 'bad-text' : ''}>{x.st[r.status] || r.status}</td>
    <td className="num">{r.signed || 0}</td><td className="num">{r.traded || 0}</td><td className="num">{r.spent || 0}</td>
    <td className="muted-text">{x.note[r.note] || r.note || ''}</td>
  </tr>;
  const stepText = run?.status === 'running' && run.step ? fill(x.step[run.step] || '', { t: run.stepParams?.at ? new Date(run.stepParams.at).toLocaleTimeString() : '' }) : '';

  return <div className="page card-factory">
    <div className="page-title"><div><h1>{x.title}</h1><span className="subtitle">{x.subtitle}</span></div>
      <div className="toolbar">
        {running ? <button className="btn danger-soft" onClick={() => api.cardFactory.stop().catch(e => toast(e.message, 'error'))}>{x.stop}</button> : <>
          <button className="btn primary" disabled={Boolean(problem) || (made > 0 && made >= Number(form.goal))} title={problem || ''} onClick={() => start(false)}>{made > 0 ? fill(x.cont, { made, goal: form.goal }) : x.start}</button>
          {made > 0 && <button className="btn ghost" disabled={Boolean(problem)} onClick={() => setAsk(true)}>{x.fresh}</button>}
        </>}
      </div>
    </div>

    {ask && <div className="modal-backdrop" onClick={() => setAsk(false)}><div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
      <p>{fill(x.freshAsk, { made })}</p>
      <div className="modal-actions"><button className="btn ghost" onClick={() => setAsk(false)}>{x.cancel}</button><button className="btn danger-soft" autoFocus onClick={() => start(true)}>{x.yes}</button></div>
    </div></div>}

    <div className="panel cf-progress">
      <div className="cf-progress-head">
        <span className={`pill ${run?.status === 'error' ? 'bad' : running ? 'ok' : 'muted'}`}><i />{x.status[running ? 'running' : run?.status || 'idle'] || run?.status}</span>
        <b>{fill(x.progress, { made, goal })}</b>
        <span className="muted-text">{fill(x.onTarget, { n: cf.onTarget || 0 })} · {fill(x.onSides, { n: cf.onSides || 0 })}</span>
        {run?.ratePerHour ? <span className="muted-text">{fill(x.rate, { n: run.ratePerHour })}{run.etaHours != null ? ' · ' + fill(x.eta, { t: dur(run.etaHours) }) : ''}</span> : null}
      </div>
      <div className="cf-bar"><i style={{ width: `${pct}%` }} /></div>
      {stepText && <small className="muted-text">{stepText}</small>}
      {run?.status === 'error' && run.error && <span className="bad-text">{msgText ? msgText(t, run.error.code || 'cf.failed', { ...(run.error.params || {}), error: run.error.message }, run.error.message) : run.error.message}</span>}
    </div>

    <div className="panel cf-form">
      <div className="cf-fields">
        <label><span>{x.target}</span><select value={form.targetId} disabled={running} onChange={e => set({ targetId: e.target.value })}><option value="">{x.chooseTarget}</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label><span>{x.maxPrice}</span><input type="number" min="1" value={form.maxPrice} disabled={running} onChange={e => set({ maxPrice: e.target.value })} /></label>
        <label><span>{x.goal}</span><input type="number" min="1" value={form.goal} disabled={running} onChange={e => set({ goal: e.target.value })} /></label>
        <label><span>{x.parallel}</span><input type="number" min="1" max="20" value={form.parallel} disabled={running} onChange={e => set({ parallel: e.target.value })} /></label>
      </div>
      <small className="muted-text">{x.hint}</small>
      <div className="cf-tk"><b>{x.tk}</b> <button className="btn ghost small" disabled={!form.targetId || running} onClick={check}>{x.tkCheck}</button>
        {tk && (tk.ok ? <span className="good-text">{fill(x.tkOk, tk)}</span> : tk.funds != null ? <span className="bad-text">{fill(x.tkShort, tk)}</span> : null)}</div>
    </div>

    <div className="panel cf-sides">
      <div className="cf-sides-head"><b>{x.sides}</b> <small className="muted-text">{fill(x.sidesN, { n: sides.length })}</small>
        <button className="chip" disabled={running} onClick={() => set({ sideIds: sides.length === accounts.filter(a => a.id !== form.targetId).length ? [] : accounts.filter(a => a.id !== form.targetId).map(a => a.id) })}>{sides.length === accounts.filter(a => a.id !== form.targetId).length ? x.clear : x.selectAll}</button></div>
      <div className="pvp-picks"><GroupedPicks storeKey="cf-sides" accounts={accounts.filter(a => a.id !== form.targetId)} selected={sides} disabled={running} onSet={ids => set({ sideIds: ids })} render={a => <button key={a.id} type="button" disabled={running} className={sides.includes(a.id) ? 'selected' : ''} onClick={() => set({ sideIds: sides.includes(a.id) ? sides.filter(v => v !== a.id) : [...sides, a.id] })}><span>{a.name}</span></button>} /></div>
    </div>

    {rows.length > 0 && <div className="panel table-panel"><SortTable><thead><tr><th>{x.acc.account}</th><th>{x.acc.role}</th><th>{x.acc.status}</th><th>{x.acc.signed}</th><th>{x.acc.traded}</th><th>{x.acc.spent}</th><th>{x.acc.note}</th></tr></thead>
      <tbody>{targetRow.map(row)}{grp(sideRows, row, groupRowOf(7, g => <><td /><td /><td className="num">{sumOf(g, r => r.signed)}</td><td className="num">{sumOf(g, r => r.traded)}</td><td className="num">{sumOf(g, r => r.spent)}</td><td /></>))}</tbody></SortTable></div>}
  </div>;
}
