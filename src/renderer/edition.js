// The renderer's view of the build edition and which modules are hidden.
// __DT_EDITION__ is injected by Vite (see vite.config.js); it is 'full' unless the public build set
// DT_EDITION. The excluded list per edition comes from src/shared/features.json.
import features from '../shared/features.json';

// eslint-disable-next-line no-undef
export const EDITION = typeof __DT_EDITION__ !== 'undefined' ? __DT_EDITION__ : 'full';
export const isFull = EDITION === 'full';
export const isPro = EDITION === 'pro';
export const isBasic = EDITION === 'basic';

const EXCLUDED = new Set((features.excludedByEdition && features.excludedByEdition[EDITION]) || []);

// A page/module id that must not appear in this edition.
export function isExcluded(id) {
  return EXCLUDED.has(id);
}
