// License server settings — used by the PUBLIC build only. The full edition never reads this.
// Fill these in once the Supabase project exists (the app will guide you):
//   SUPABASE_URL      the project URL, e.g. https://abcd1234.supabase.co
//   SUPABASE_ANON_KEY the project's anon/public key (safe to ship: it can only call the function)
//   FUNCTION          the Edge Function name that checks licenses (default 'license')
// While these are empty the public build refuses to start (no license server = no run), which is
// the intended behaviour. The anon key is NOT a secret: all real authority stays in the Edge
// Function with the service-role key, which is never shipped.
module.exports = {
  SUPABASE_URL: 'https://xjjusiwdggqsoymiiwlh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_w5rkNOqjmwTybxR9te65mw_j3E1U-O7',
  FUNCTION: 'license',
  // How often to re-check while the app runs (ms). 0 disables periodic checks.
  RECHECK_MS: 30 * 60 * 1000
};
