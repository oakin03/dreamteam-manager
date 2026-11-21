// Which build this is. THREE editions:
//   'full'  = the user's own build: NO license, NO code protection, EVERY feature, and the owner
//             license PANEL. This is what `npm run dev` and `npm run dist` produce, and what this
//             source file always says.
//   'pro'   = shared build with more features. License on, code protected, panel absent.
//   'basic' = shared build with fewer features (the "düz"/plain one). License on, code protected.
// Each shared edition is built SEPARATELY and its missing modules' code is physically left out, so
// nobody can turn basic into pro or full by flipping a flag — the code simply is not there.
// The public build pipeline (scripts/edition/build-public.cjs) overwrites this one file on a STAGED
// COPY to the edition it is building. This source file stays 'full', so the user's own build/dev
// are never affected.
const ALL = ['full', 'pro', 'basic'];
const raw = process.env.DT_EDITION_OVERRIDE;
const EDITION = ALL.includes(raw) ? raw : 'full';
module.exports = {
  EDITION,
  isFull: EDITION === 'full',
  isPro: EDITION === 'pro',
  isBasic: EDITION === 'basic',
  // a shared (distributed) edition needs the license check; full never does
  isLicensed: EDITION !== 'full'
};
