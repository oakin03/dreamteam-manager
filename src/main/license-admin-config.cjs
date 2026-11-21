// Owner PANEL settings — exists ONLY in the full edition. The public build pipeline DELETES this
// file (and license-admin-secret.cjs) for the pro and basic editions.
//   SUPABASE_URL  the project URL (same project as the license function)
//   ADMIN_TOKEN   read from license-admin-secret.cjs, which is gitignored so the token never reaches
//                 the (public) repository. Without that file the panel shows "not configured".
//   FUNCTION      the admin Edge Function name
let secret = {};
try { secret = require('./license-admin-secret.cjs'); } catch { /* not set up on this machine */ }

module.exports = {
  SUPABASE_URL: 'https://xjjusiwdggqsoymiiwlh.supabase.co',
  ADMIN_TOKEN: secret.ADMIN_TOKEN || '',
  FUNCTION: 'license-admin'
};
