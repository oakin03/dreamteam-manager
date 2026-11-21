// Obfuscates .cjs/.js files in the given files/dirs (used for the renderer bundle and the
// default-tasks scripts, which live outside the asar and so cannot be bytecode-loaded). Settings
// are conservative so nothing breaks: no control-flow flattening, no dead code, no self-defending.
const fs = require('fs');
const path = require('path');
const JO = require('javascript-obfuscator');

// Shared, safe-ish hardening. Self-defending makes the code resist being reformatted/debugged.
const BASE = {
  compact: true,
  deadCodeInjection: false,
  selfDefending: true,
  renameGlobals: false,
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  numbersToExpressions: true,
  simplify: true,
  sourceMap: false
};
// The renderer is a big bundle: keep control-flow flattening OFF (it would bloat/slow it a lot).
// The small task scripts can take the heavier flattening for more strength.
const OPTS_BY_TARGET = {
  browser: { ...BASE, target: 'browser', controlFlowFlattening: false },
  node: { ...BASE, target: 'node', controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.75 }
};

let done = 0, failed = 0;
function one(file, target) {
  try {
    const code = fs.readFileSync(file, 'utf8');
    const out = JO.obfuscate(code, OPTS_BY_TARGET[target] || OPTS_BY_TARGET.node).getObfuscatedCode();
    fs.writeFileSync(file, out);
    done++;
  } catch (e) {
    failed++;
    console.warn('  obfuscate skipped (kept minified):', path.basename(file), '-', e.message);
  }
}
function walk(p, target) {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const n of fs.readdirSync(p)) walk(path.join(p, n), target); return; }
  if (/\.(cjs|js)$/.test(p)) one(p, target);
}

// args: pairs of "target:path" where target is 'node' or 'browser'
for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf(':');
  const target = arg.slice(0, i);
  const p = arg.slice(i + 1);
  if (fs.existsSync(p)) walk(p, target === 'browser' ? 'browser' : 'node');
}
console.log(`obfuscate: ${done} file(s), ${failed} skipped`);
