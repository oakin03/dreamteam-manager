// Runs UNDER Electron (ELECTRON_RUN_AS_NODE=1) so the bytecode matches the app's V8.
// For every .cjs/.js file under <root> it writes a sibling <name>.jsc (V8 bytecode) and replaces
// the original file with a one-line loader stub. File names stay; the logic becomes bytecode.
const bytenode = require('bytenode');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) { console.error('usage: compile-bytecode <dir>'); process.exit(1); }

const stub = (base, ext) => `"use strict";\nrequire("bytenode");\nmodule.exports = require("./${base}.jsc");\n`;

async function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules') continue; await walk(p); continue; }
    const ext = path.extname(e.name);
    if (ext !== '.cjs' && ext !== '.js') continue;
    const base = e.name.slice(0, -ext.length);
    const out = path.join(dir, base + '.jsc');
    await bytenode.compileFile({ filename: p, output: out });
    fs.writeFileSync(p, stub(base, ext));
  }
}

walk(root).then(() => { console.log('bytecode: done', root); process.exit(0); })
  .catch(err => { console.error('bytecode failed:', err); process.exit(1); });
