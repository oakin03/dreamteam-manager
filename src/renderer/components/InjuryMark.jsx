// NBA injury mark after a player's name, everywhere (ESPN injury list, read at 11:00 TR by
// the main process, see injury-service.cjs). Red + = out, orange + = day-to-day / back soon;
// the return date on hover. Matched by name only: the game's team can be wrong.
import { filOf } from '../i18n-fil';

const TEXT = {
  tr: { out: 'Sakat', soon: 'Kısa süreli sakat', back: 'Dönüş: {d}', noDate: 'Dönüş tarihi belli değil' },
  en: { out: 'Injured', soon: 'Short-term injury', back: 'Back: {d}', noDate: 'Return date unknown' },
  get fil() { return filOf(this.en); }
};

// same as normName in the main process (value-predict-service / injury-service)
export function normName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.']/g, '').trim().replace(/(\s+(jr|sr|ii|iii|iv|v))+$/, '').replace(/[^a-z]/g, '');
}

let players = {};
let lang = 'tr';
// App calls this on every render with state.injuries and the language
export function setInjuryData(snapshot, language) {
  players = snapshot?.players || {};
  lang = TEXT[language] ? language : 'en';
}
export const injuryOf = name => (name ? players[normName(name)] || null : null);

export default function InjuryMark({ name }) {
  const i = injuryOf(name);
  if (!i) return null;
  const x = TEXT[lang];
  const date = i.returnDate ? new Date(i.returnDate).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null;
  const title = [`${i.level === 'soon' ? x.soon : x.out} (${i.status || '—'})`, date ? x.back.replace('{d}', date) : x.noDate, i.type].filter(Boolean).join(' · ');
  return <span className={`inj-mark ${i.level}`} title={title} aria-label={title}>+</span>;
}
