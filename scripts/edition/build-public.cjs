// Builds a SHARED edition (pro or basic): feature-filtered, with the whole renderer + main process
// code protected (excluded modules' code physically removed, main bytecode-compiled, renderer &
// task scripts obfuscated, Electron fuses flipped incl. asar-integrity, license check on). The
// user's own `npm run dist` (full edition) is untouched.
//   node scripts/edition/build-public.cjs pro      (or basic)
// Output: release-public/<edition>/DreamTeamManager-<Edition>-Setup.exe
const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const EDITION = (process.argv[2] || 'basic').toLowerCase();
if (!['pro', 'basic'].includes(EDITION)) { console.error('edition must be "pro" or "basic"'); process.exit(1); }
// --check: strip + verify + build the renderer, then stop (no obfuscation, bytecode or installer)
const CHECK_ONLY = process.argv.includes('--check');

const ROOT = path.resolve(__dirname, '..', '..');
const STAGE = path.join(ROOT, 'build-public', EDITION);
const OUT = path.join(ROOT, 'release-public', EDITION);
const rootPkg = require(path.join(ROOT, 'package.json'));
const features = require(path.join(ROOT, 'src', 'shared', 'features.json'));
const moduleMap = require('./module-map.cjs');
const { stripTree, findForbidden } = require('./strip.cjs');
const electronVersion = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;

// full-only files (owner panel backend + admin token) never go to a shared edition
const FULL_ONLY = ['src/main/license-admin-ipc.cjs', 'src/main/services/license-admin.cjs', 'src/main/license-admin-config.cjs', 'src/main/license-admin-secret.cjs'];
const EDITION_META = {
  pro: { appId: 'com.dreamteam.automator.pro', productName: 'DreamTeam Manager Pro', artifact: 'DreamTeamManager-Pro-Setup.${ext}' },
  basic: { appId: 'com.dreamteam.automator.basic', productName: 'DreamTeam Manager', artifact: 'DreamTeamManager-Basic-Setup.${ext}' }
};

const run = (cmd, args, opts = {}) => {
  console.log('\n>', path.basename(String(cmd)), args.join(' '));
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.status !== 0) { console.error('FAILED:', cmd); process.exit(r.status || 1); }
};
const node = process.execPath;
const electronBin = require(path.join(ROOT, 'node_modules', 'electron'));
const rmrf = p => fs.rmSync(p, { recursive: true, force: true });
const cp = (from, to) => fs.cpSync(from, to, { recursive: true });
const stub = f => fs.writeFileSync(f, /\.jsx?$/.test(f) ? 'export default function Excluded() { return null; }\n' : '"use strict";\nmodule.exports = {};\n');

console.log(`=== DreamTeam Manager — ${EDITION} build ===`);
const excluded = (features.excludedByEdition && features.excludedByEdition[EDITION]) || [];
console.log('Excluded modules:', excluded.length ? excluded.join(', ') : '(none)');

// 1. clean + prebuild
rmrf(path.join(ROOT, 'build-public', EDITION));
fs.mkdirSync(STAGE, { recursive: true });
run(node, ['scripts/ensure-runtime.cjs']);
run(node, ['scripts/quiz-bundle.cjs']);

// 2. stage the whole source tree (so the renderer is built from a copy we can trim)
cp(path.join(ROOT, 'src'), path.join(STAGE, 'src'));
cp(path.join(ROOT, 'default-tasks'), path.join(STAGE, 'default-tasks'));
cp(path.join(ROOT, 'index.html'), path.join(STAGE, 'index.html'));
cp(path.join(ROOT, 'vite.config.js'), path.join(STAGE, 'vite.config.js'));

// 3. flag the edition in the staged copy
fs.writeFileSync(path.join(STAGE, 'src', 'main', 'edition.cjs'),
  `module.exports = { EDITION: '${EDITION}', isFull: false, isPro: ${EDITION === 'pro'}, isBasic: ${EDITION === 'basic'}, isLicensed: true };\n`);

// 4. remove full-only files (owner panel + admin token)
for (const rel of FULL_ONLY) rmrf(path.join(STAGE, rel));

// 5. remove the code of the modules this edition leaves out:
//    a) the @strip / @only markers in the source (strip.cjs)
const stripped = stripTree(path.join(STAGE, 'src'), EDITION);
console.log(`  markers: ${stripped.lines} line(s) removed in ${stripped.files} file(s)`);
//    b) whole files of those modules, and their renderer components replaced by an empty one
for (const id of excluded) {
  const m = moduleMap[id];
  if (!m) { console.error(`! module "${id}" is in features.json but not in module-map.cjs`); process.exit(1); }
  for (const rel of m.files || []) { rmrf(path.join(STAGE, rel)); console.log('  dropped', rel); }
  for (const rel of m.stubs || []) { const p = path.join(STAGE, rel); if (fs.existsSync(p)) { stub(p); console.log('  stubbed', rel); } }
}
//    c) nothing of them may be left: no identifier, no IPC channel, no dangling reference
const forbidden = excluded.flatMap(id => moduleMap[id].forbidden || []);
const hits = findForbidden(path.join(STAGE, 'src'), forbidden);
if (hits.length) { console.error(`! ${hits.length} leftover(s) of the removed modules:\n  ${hits.join('\n  ')}`); process.exit(1); }
//    d) every main-process file still parses
const cjsFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? cjsFiles(path.join(dir, e.name)) : e.name.endsWith('.cjs') ? [path.join(dir, e.name)] : []);
for (const f of cjsFiles(path.join(STAGE, 'src', 'main'))) {
  const r = spawnSync(node, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('! syntax error after stripping:', f, '\n', r.stderr); process.exit(1); }
}
console.log(`  check: ${forbidden.length} forbidden token(s) absent, main process parses`);

// 6. node_modules junction (needed by vite and electron-builder)
const stageModules = path.join(STAGE, 'node_modules');
if (!fs.existsSync(stageModules)) execSync(`mklink /J "${stageModules}" "${path.join(ROOT, 'node_modules')}"`, { shell: 'cmd.exe' });

// 7. build the renderer from the staged (trimmed) source, then obfuscate it
run(node, [path.join(STAGE, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
  cwd: STAGE, env: { ...process.env, DT_EDITION: EDITION }
});
if (CHECK_ONLY) { console.log(`
=== ${EDITION} check passed (staged in ${STAGE}) ===`); process.exit(0); }
run(node, ['scripts/edition/obfuscate.cjs', 'browser:' + path.join(STAGE, 'dist', 'assets')]);

// 8. bytecode-compile the staged main process (under Electron's V8)
run(electronBin, ['scripts/edition/compile-bytecode.cjs', path.join(STAGE, 'src', 'main')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: path.join(ROOT, 'node_modules') }
});

// 9. obfuscate the task scripts (outside the asar, so no bytecode there)
run(node, ['scripts/edition/obfuscate.cjs', 'node:' + path.join(STAGE, 'default-tasks')]);

// 10. staged package.json: runtime deps only + bytenode; renderer source is NOT shipped (only dist)
const pkg = {
  // its own name, so its data folder (userData) and single-instance lock never mix with the full
  // edition on the same PC; pro and basic share it, so moving from basic to pro keeps the data
  name: 'dreamteam-manager-client', version: rootPkg.version, private: true,
  description: rootPkg.description, author: rootPkg.author, license: rootPkg.license,
  main: 'src/main/main.cjs',
  dependencies: { ...rootPkg.dependencies, bytenode: require(path.join(ROOT, 'node_modules', 'bytenode', 'package.json')).version }
};
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// 11. package with electron-builder (programmatic), fuses flipped in afterPack
const builder = require(path.join(ROOT, 'node_modules', 'electron-builder'));
const { Platform, Arch } = builder;
const afterPack = require('./afterPack.cjs').default;
const absIcon = path.join(ROOT, 'build', 'icon.ico');
const meta = EDITION_META[EDITION];
const win = { ...rootPkg.build.win, icon: absIcon };
const nsis = { ...rootPkg.build.nsis, installerIcon: absIcon, uninstallerIcon: absIcon, shortcutName: meta.productName };

builder.build({
  projectDir: STAGE,
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  config: {
    appId: meta.appId,
    productName: meta.productName,
    artifactName: meta.artifact,
    electronVersion,
    directories: { output: OUT },
    files: ['dist/**/*', 'src/main/**/*', 'package.json'],
    extraResources: rootPkg.build.extraResources,
    asarUnpack: rootPkg.build.asarUnpack,
    win, nsis, afterPack
  }
}).then(res => {
  console.log(`\n=== ${EDITION} build done ===`);
  for (const f of res) console.log(' ', f);
  process.exit(0);
}).catch(err => { console.error('electron-builder failed:', err); process.exit(1); });
