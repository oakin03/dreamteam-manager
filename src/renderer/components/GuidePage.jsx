import { useMemo, useState } from 'react';
import { filOf } from '../i18n-fil';
import { GUIDE_TR } from './guide-tr';
import { GUIDE_EN } from './guide-en';

// "Rehber": the user manual of the app. Every section says what a page is for, how to
// use it step by step, its buttons, how it works, tips and what to do when it goes wrong.
// The texts live in guide-tr.js / guide-en.js (Filipino is looked up from the English).
const GUIDE = { tr: GUIDE_TR, en: GUIDE_EN, get fil() { return filOf(GUIDE_EN); } };
const localeOf = lang => (lang === 'tr' ? 'tr-TR' : lang === 'fil' ? 'fil-PH' : 'en-US');

export default function GuidePage({ t, initial }) {
  const g = GUIDE[t.lang] || GUIDE.en;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(initial || g.sections[0].id);
  const list = useMemo(() => {
    const s = q.trim().toLocaleLowerCase(localeOf(t.lang));
    if (!s) return g.sections;
    return g.sections.filter(sec => JSON.stringify(sec).toLocaleLowerCase(localeOf(t.lang)).includes(s));
  }, [q, g, t.lang]);
  const cur = list.find(s => s.id === open) || list[0];
  const h = g.head;
  return <div className="page guide-page">
    <div className="page-title"><div><h1>{g.title}</h1><span className="subtitle">{g.subtitle}</span></div><div className="toolbar"><input className="guide-search" placeholder={g.search} value={q} onChange={e => setQ(e.target.value)} /></div></div>
    <div className="panel guide-intro">{g.intro}</div>
    <div className="guide-layout">
      <nav className="panel guide-nav">{list.map(s => <button key={s.id} className={cur?.id === s.id ? 'active' : ''} onClick={() => setOpen(s.id)}><span>{s.icon}</span>{s.name}</button>)}{!list.length && <p className="muted-text">{g.empty}</p>}</nav>
      {cur && <article className="panel guide-body">
        <h2><span>{cur.icon}</span>{cur.name}</h2>
        <h4>{h.what}</h4><p>{cur.what}</p>
        {cur.steps?.length > 0 && <><h4>{h.steps}</h4><ol className="guide-steps">{cur.steps.map(s => <li key={s}>{s}</li>)}</ol></>}
        {cur.buttons?.length > 0 && <><h4>{h.buttons}</h4><dl>{cur.buttons.map(([b, d]) => <div key={b}><dt>{b}</dt><dd>{d}</dd></div>)}</dl></>}
        {cur.rules?.length > 0 && <><h4>{h.rules}</h4><ul>{cur.rules.map(r => <li key={r}>{r}</li>)}</ul></>}
        {cur.tips?.length > 0 && <><h4>{h.tips}</h4><ul className="guide-tips">{cur.tips.map(tip => <li key={tip}>{tip}</li>)}</ul></>}
        {cur.problems?.length > 0 && <><h4>{h.problems}</h4><dl className="guide-problems">{cur.problems.map(([p, a]) => <div key={p}><dt>{p}</dt><dd>{a}</dd></div>)}</dl></>}
      </article>}
    </div>
  </div>;
}
