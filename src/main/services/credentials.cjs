const { safeStorage } = require('electron');

function encryptSecret(text) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure storage is not available on this system.');
  }
  return safeStorage.encryptString(String(text)).toString('base64');
}

function decryptSecret(encoded) {
  if (!encoded) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure storage is not available on this system.');
  }
  return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
}

module.exports = { encryptSecret, decryptSecret };
