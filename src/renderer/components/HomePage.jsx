import DailySummary from './DailySummary';

// The first page (user 2026-11-25): only the Daily Summary — the accounts table, account health,
// systems and player lists of the old Command Center were taken off.
export default function HomePage({ t }) {
  return <div className="page cc-page"><DailySummary t={t} /></div>;
}
