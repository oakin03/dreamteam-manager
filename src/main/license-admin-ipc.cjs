// Owner license panel IPC — exists ONLY in the full edition. The build pipeline deletes this file
// (and the admin client + token it uses) for pro/basic, so none of the panel's code is compiled
// into those builds.
const { LicenseAdmin } = require('./services/license-admin.cjs');

function register(ipcMain) {
  const admin = new LicenseAdmin(require('./license-admin-config.cjs'));
  ipcMain.handle('licenseAdmin:overview', async () => admin.overview());
  ipcMain.handle('licenseAdmin:createLicense', async (_e, p) => admin.createLicense(p));
  ipcMain.handle('licenseAdmin:updateLicense', async (_e, p) => admin.updateLicense(p));
  ipcMain.handle('licenseAdmin:deleteLicense', async (_e, key) => admin.deleteLicense(key));
  ipcMain.handle('licenseAdmin:machine', async (_e, p) => admin.machine(p));
}

module.exports = { register };
