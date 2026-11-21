// electron-builder afterPack hook for the public build: flips Electron fuses so the packaged app
// cannot be run as plain Node, cannot be inspected, ignores NODE_OPTIONS, only loads its app from
// the asar, and VALIDATES the asar's integrity (a swapped/edited asar then refuses to start). This
// runs after packing and before signing, so the signature stays valid.
// If a build ever fails to start, set DT_NO_ASAR_INTEGRITY=1 to drop the integrity fuse.
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  const name = context.packager.appInfo.productFilename;
  const plat = context.electronPlatformName;
  const exe = plat === 'win32' ? path.join(context.appOutDir, `${name}.exe`)
    : plat === 'darwin' ? path.join(context.appOutDir, `${name}.app`)
    : path.join(context.appOutDir, name.toLowerCase());
  const fuses = {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: plat === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  };
  if (!process.env.DT_NO_ASAR_INTEGRITY) fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] = true;
  await flipFuses(exe, fuses);
  console.log('afterPack: fuses flipped on', path.basename(exe), process.env.DT_NO_ASAR_INTEGRITY ? '(no asar-integrity)' : '(with asar-integrity)');
};
