// Init script for the per-account Playwright MCP browsers (see mcp-sync.cjs).
// DreamTeam's login page sets sessionStorage.tabSession and /main signs out
// when it is missing, so a restarted browser would drop a still-valid session.
if (/(^|\.)dreamteamph\.com$/.test(location.hostname)) {
  try { sessionStorage.setItem('tabSession', 'active'); } catch {}
}
