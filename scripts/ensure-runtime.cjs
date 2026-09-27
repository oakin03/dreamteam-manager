const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function runNode(script, args = [], extraEnv = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    windowsHide: false
  });
  return result.status === 0;
}

function ensureElectron() {
  let pkg;
  try {
    pkg = require.resolve('electron/package.json');
  } catch {
    throw new Error('Electron package is missing. Run: npm install');
  }

  const electronDir = path.dirname(pkg);
  const pathFile = path.join(electronDir, 'path.txt');
  const installScript = path.join(electronDir, 'install.js');

  const ready = () => {
    if (!fs.existsSync(pathFile)) return false;
    const rel = fs.readFileSync(pathFile, 'utf8').trim();
    if (!rel) return false;
    return fs.existsSync(path.join(electronDir, 'dist', rel));
  };

  if (ready()) {
    console.log('[runtime] Electron OK.');
    return;
  }

  console.log('[runtime] Electron binary is missing/incomplete. Repairing automatically...');
  if (!fs.existsSync(installScript)) {
    throw new Error('Electron install script was not found. Delete node_modules and run npm install again.');
  }

  if (!runNode(installScript)) {
    throw new Error('Electron download/installation failed. Check internet access and try: npm run repair-runtime');
  }

  if (!ready()) {
    throw new Error('Electron installer finished, but electron.exe is still missing.');
  }
  console.log('[runtime] Electron repaired successfully.');
}

function ensurePlaywrightChromium() {
  // IMPORTANT: BrowserService deliberately uses a hermetic Playwright install
  // (PLAYWRIGHT_BROWSERS_PATH=0) so the app never depends on the user's Chrome,
  // Opera or a machine-global Playwright cache. The installer must use the SAME
  // setting, otherwise it can report a browser in %LOCALAPPDATA% while the app
  // searches node_modules/playwright-core/.local-browsers.
  const hermeticEnv = { PLAYWRIGHT_BROWSERS_PATH: '0' };
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

  let chromium;
  let playwrightEntry;
  try {
    ({ chromium } = require('playwright'));
    playwrightEntry = require.resolve('playwright');
  } catch {
    throw new Error('Playwright package is missing. Run: npm install');
  }

  // Newer Playwright versions do not export "playwright/cli". Resolve cli.js
  // from the package root instead.
  const cli = path.join(path.dirname(playwrightEntry), 'cli.js');
  if (!fs.existsSync(cli)) {
    throw new Error('Playwright CLI was not found at: ' + cli);
  }

  console.log('[runtime] Verifying hermetic Playwright Chromium + headless shell...');

  // `install chromium` installs both the regular Chromium build (visible mode)
  // and chromium-headless-shell (default headless mode). It is idempotent: when
  // the matching binaries are already present it only verifies them.
  if (!runNode(cli, ['install', 'chromium', '--no-remove'], hermeticEnv)) {
    throw new Error('Playwright Chromium installation failed. Check internet access and try: npm run repair-runtime');
  }

  const executable = chromium.executablePath();
  if (!executable || !fs.existsSync(executable)) {
    throw new Error('Playwright installer finished, but the hermetic Chromium executable is still missing.');
  }

  console.log('[runtime] Playwright Chromium + headless shell OK.');
}

try {
  ensureElectron();
  ensurePlaywrightChromium();
} catch (error) {
  console.error('\n[runtime] ERROR:', error.message || error);
  process.exit(1);
}
