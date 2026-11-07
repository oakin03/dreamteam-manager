// Development helper: keeps the project's .mcp.json in sync with the app's
// accounts so Claude Code gets one Playwright MCP server per account
// (pw-<name>). Each server has its own profile under <dataDir>/mcp-profiles,
// so several can run at once and none of them touches the app's own
// browser-profiles. A new MCP profile is seeded once from the app profile so
// it starts already logged in.
//
// The game kicks the older session when the same account opens /main twice
// (socket "duplicateLogin"), so one account must not be used by the app and
// its MCP browser at the same time. Different accounts never conflict.
//
// Runs from the Electron main process (dev only) and from `npm run mcp:sync`.
//
// Only the accounts named in <projectRoot>/.mcp-accounts.json get a server
// (user 2026-11-07: Claude Code and Copilot start every server in .mcp.json at
// once; 141 accounts = 282 node processes, ~27 GB, the PC paged to disk). The
// file is made with DEFAULT_ACCOUNTS when missing; add or remove names there
// and run `npm run mcp:sync` (or `npm run mcp:sync -- --add Name`).
// MCP profiles of accounts left out are kept, so adding one back is instant.
const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVER_PREFIX = 'pw-';
const SKIP_ON_SEED = new Set([
  'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile', 'LOCK',
  'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'GrShaderCache', 'GraphiteDawnCache', 'ShaderCache', 'GPUPersistentCache',
  'Crashpad', 'component_crx_cache', 'extensions_crx_cache'
]);

const ALLOW_FILE = '.mcp-accounts.json';
const DEFAULT_ACCOUNTS = ['Trophy', 'Trophy9', 'Trophy10', 'Yozgt66ers', 'Pipelne1', 'Pipelne2', 'Pipelne19'];
const norm = v => String(v || '').trim().toLowerCase();

// The names (case-insensitive) that get a server; the file is created when missing.
function allowedNames(projectRoot, add = []) {
  const file = path.join(projectRoot, ALLOW_FILE);
  let list = null;
  try { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); list = Array.isArray(raw) ? raw : raw.accounts; } catch {}
  const missing = !Array.isArray(list);
  if (missing) list = [...DEFAULT_ACCOUNTS];
  const extra = add.filter(n => !list.some(x => norm(x) === norm(n)));
  if (missing || extra.length) {
    list = [...list, ...extra];
    fs.writeFileSync(file, `${JSON.stringify({ note: 'Accounts that get a Playwright MCP server (pw-<name>) in .mcp.json. Keep it short: every server is a running process.', accounts: list }, null, 2)}
`, 'utf8');
  }
  return new Set(list.map(norm));
}

function defaultDataDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'dreamteam-manager', 'DreamTeamAutomator');
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'account';
}

function chromiumExecutable() {
  // Same hermetic Chromium the app uses, so seeded profiles stay compatible.
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
  return require('playwright').chromium.executablePath();
}

function serverNames(accounts) {
  const used = new Set();
  return accounts.map(account => {
    const base = `${SERVER_PREFIX}${slug(account.name || account.login)}`;
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
    used.add(name);
    return name;
  });
}

async function seedProfile(appProfile, mcpProfile) {
  if (fs.existsSync(mcpProfile) || !fs.existsSync(appProfile)) return false;
  try {
    await fs.promises.cp(appProfile, mcpProfile, {
      recursive: true,
      filter: src => !SKIP_ON_SEED.has(path.basename(src))
    });
    return true;
  } catch (err) {
    // A half-copied profile would never be retried; drop it.
    await fs.promises.rm(mcpProfile, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function syncMcpConfig({ projectRoot, dataDir = defaultDataDir(), accounts, add = [] } = {}) {
  if (!accounts) {
    const file = path.join(dataDir, 'accounts.json');
    accounts = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  }
  // a copy: accounts added while this runs (bulk creation) wait for the next sync
  const allAccounts = [...accounts];
  const allowed = allowedNames(projectRoot, add);
  accounts = allAccounts.filter(a => allowed.has(norm(a.name)) || allowed.has(norm(a.login)));
  const configFile = path.join(projectRoot, '.mcp.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch {}
  const servers = {};
  // Keep servers that were added by hand; only pw-* entries are managed here.
  for (const [name, value] of Object.entries(config.mcpServers || {})) {
    if (!name.startsWith(SERVER_PREFIX)) servers[name] = value;
  }

  const cli = path.join(projectRoot, 'node_modules', '@playwright', 'mcp', 'cli.js');
  const executable = chromiumExecutable();
  const mcpRoot = path.join(dataDir, 'mcp-profiles');
  const names = serverNames(accounts);
  const seeded = [];
  const errors = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const profile = path.join(mcpRoot, account.id);
    servers[names[i]] = {
      command: 'node',
      args: [
        cli,
        '--user-data-dir', profile,
        '--executable-path', executable,
        '--viewport-size', '1440x900',
        '--init-script', path.join(__dirname, 'mcp-tab-session.js'),
        '--output-dir', path.join(mcpRoot, '_output', names[i])
      ]
    };
    try {
      if (await seedProfile(path.join(dataDir, 'browser-profiles', account.id), profile)) seeded.push(names[i]);
    } catch (err) {
      // the app's browser has the profile open (a login running): seeded at a later sync
      if (err.code === 'EBUSY' || err.code === 'EPERM') continue;
      errors.push(`${names[i]}: ${err.message}`);
    }
  }

  // Profiles of removed accounts are no longer referenced.
  const ids = new Set(allAccounts.map(a => a.id));
  if (fs.existsSync(mcpRoot)) {
    for (const entry of fs.readdirSync(mcpRoot)) {
      if (entry !== '_output' && !ids.has(entry)) {
        await fs.promises.rm(path.join(mcpRoot, entry), { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  const next = { ...config, mcpServers: servers };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  let previous = '';
  try { previous = fs.readFileSync(configFile, 'utf8'); } catch {}
  if (text !== previous) fs.writeFileSync(configFile, text, 'utf8');
  return { changed: text !== previous, servers: names, seeded, errors };
}

module.exports = { syncMcpConfig, defaultDataDir };

if (require.main === module) {
  const args = process.argv.slice(2);
  const add = [];
  for (let i = args.indexOf('--add'); i >= 0 && i + 1 < args.length; i = args.indexOf('--add', i + 2)) add.push(args[i + 1]);
  const dataDir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--add');
  syncMcpConfig({ projectRoot: path.join(__dirname, '..', '..', '..'), dataDir: dataDir || defaultDataDir(), add })
    .then(result => {
      console.log(`[mcp] ${result.servers.length} server(s): ${result.servers.join(', ')}`);
      if (result.seeded.length) console.log(`[mcp] seeded from app profile: ${result.seeded.join(', ')}`);
      for (const err of result.errors) console.warn(`[mcp] seed failed ${err}`);
      console.log(result.changed ? '[mcp] .mcp.json updated - restart Claude Code to load it.' : '[mcp] .mcp.json already up to date.');
    })
    .catch(err => { console.error('[mcp] sync failed:', err); process.exitCode = 1; });
}
