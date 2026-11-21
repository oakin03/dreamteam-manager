// Edition markers: physically removes code from a STAGED copy of the source for a shared edition.
// The source tree itself is never changed; in the full edition the markers are plain comments.
//
//   some code            // @strip(basic)          → this line is deleted in the basic build
//   <Jsx/>{/* @strip(pro,basic) */}                  → deleted in pro and basic
//   // @strip-begin(basic)  …lines…  // @strip-end   → the whole block (markers included) is deleted
//   //@only(basic) const x = 1;                       → in basic the line becomes `const x = 1;`,
//                                                       everywhere else it stays a comment
//   {/*@only(basic) <Scout/> */}                      → the same for a JSX child (own line)
//
// Block markers do not nest. A marker that is left unbalanced stops the build.
const fs = require('fs');
const path = require('path');

const EXT = new Set(['.js', '.jsx', '.cjs', '.mjs']);
const listHas = (list, edition) => list.split(',').map(s => s.trim()).includes(edition);

function stripText(src, edition, file = '?') {
  const out = [];
  let skipping = null; // line number where the open block started
  let removed = 0;
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const begin = /@strip-begin\(([^)]*)\)/.exec(line);
    if (begin) {
      if (skipping != null) throw new Error(`${file}:${i + 1} @strip-begin inside an open block (line ${skipping})`);
      if (listHas(begin[1], edition)) { skipping = i + 1; removed++; continue; }
      // a block for another edition: keep it, but remember to skip its end marker check
      out.push(line);
      continue;
    }
    if (/@strip-end\b/.test(line)) {
      if (skipping != null) { skipping = null; removed++; continue; }
      out.push(line);
      continue;
    }
    if (skipping != null) { removed++; continue; }
    const one = /@strip\(([^)]*)\)/.exec(line);
    if (one && listHas(one[1], edition)) { removed++; continue; }
    const only = /^(\s*)\/\/@only\(([^)]*)\) ?(.*)$/.exec(line);
    if (only && listHas(only[2], edition)) { out.push(only[1] + only[3]); continue; }
    // JSX children: {/*@only(basic) <Thing/> */}
    const onlyJsx = /^(\s*)\{\/\*@only\(([^)]*)\) (.*) \*\/\}\s*$/.exec(line);
    if (onlyJsx && listHas(onlyJsx[2], edition)) { out.push(onlyJsx[1] + onlyJsx[3]); continue; }
    out.push(line);
  }
  if (skipping != null) throw new Error(`${file}: @strip-begin at line ${skipping} has no @strip-end`);
  return { text: out.join('\n'), removed };
}

function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, files); }
    else if (EXT.has(path.extname(e.name))) files.push(p);
  }
  return files;
}

// Strip every source file under `dir` for `edition`. Returns { files, lines } changed.
function stripTree(dir, edition) {
  let files = 0; let lines = 0;
  for (const f of walk(dir)) {
    const src = fs.readFileSync(f, 'utf8');
    if (!/@strip|@only\(/.test(src)) continue;
    const { text, removed } = stripText(src, edition, path.relative(dir, f));
    if (text !== src.replace(/\r\n/g, '\n')) { fs.writeFileSync(f, text); files++; lines += removed; }
  }
  return { files, lines };
}

// Every token must be gone from the stripped tree (catches leftover code AND dangling references
// to something that was removed). Returns a list of "file:line token" hits.
function findForbidden(dir, tokens) {
  const hits = [];
  if (!tokens.length) return hits;
  for (const f of walk(dir)) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => { for (const t of tokens) if (line.includes(t)) hits.push(`${path.relative(dir, f)}:${i + 1} ${t}`); });
  }
  return hits;
}

module.exports = { stripText, stripTree, findForbidden };
