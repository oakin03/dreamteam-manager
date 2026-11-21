// What leaving a module out of a shared edition means, per module id (src/shared/features.json lists
// which edition leaves out which module). Three layers, all applied to the STAGED copy only:
//   1. the `@strip(...)` markers in the source remove the module's code (see strip.cjs);
//   2. `services` / `files`: whole files of the module are deleted (paths relative to the repo root);
//      `stubs`: renderer components replaced by an empty component;
//   3. `forbidden`: none of these may be left anywhere in the stripped source, or the build stops.
//      They are code identifiers / IPC channel names, so a leftover means leftover code or a
//      dangling reference to something removed.
// Only list files used by that ONE module — a shared file must never be deleted.
module.exports = {
  // the owner's license panel: full edition only
  licenses: {
    stubs: ['src/renderer/components/LicensePanel.jsx'],
    forbidden: ['LicensePanel', 'licenseAdmin', 'license-admin', 'LicenseAdmin', 'ADMIN_TOKEN']
  },
  // Auto Buy (the page, its watch list, the Trading Hall / Oyuncular hooks, the watch alerts).
  // buy-service.cjs stays: Trading Hall buys, bulk buy, selling and the bought list use it.
  autobuy: {
    files: ['src/main/services/watch-alerts.cjs'],
    stubs: ['src/renderer/components/AutoBuyPage.jsx'],
    forbidden: ['AutoBuyPage', 'startAutoBuy', 'autoBuyDone', 'watchAlerts', 'buy:add-watch', 'buy:update-watch', 'buy:add-range',
      'buy:remove-watch', 'buy:set-config', 'buy:start-auto', 'buy:stop-auto', '_autoLoop', 'startAuto(', 'addWatch', 'abState', 'tagCounts']
  },
  // Scout Avcısı (the Scout tab itself stays: the page shows only Scout)
  scoutHunter: {
    files: ['src/main/services/scout-hunter.cjs'],
    stubs: ['src/renderer/components/HunterPage.jsx'],
    forbidden: ['ScoutHunter', 'services/scout-hunter', 'HunterPage', "'hunter:", 'api.hunter', 'toggleHunt', 'resumeIfRunning']
  },
  // Rotasyon (match control during the game modes)
  rotation: {
    files: ['src/main/services/match-control.cjs'],
    stubs: ['src/renderer/components/RotationPanel.jsx'],
    forbidden: ['MatchControl', 'matchControl', 'RotationPanel', 'RotationModes', 'RotationLive', "'rotation:", 'api.rotation']
  },
  // Turnuva: everything except the registration (live tab, level check, tournament rotation)
  tournamentExtras: {
    files: ['src/main/services/tournament-live.cjs', 'src/main/services/tournament-level-service.cjs'],
    stubs: ['src/renderer/components/TournamentLiveTab.jsx', 'src/renderer/components/TournamentLevelTab.jsx'],
    forbidden: ['TournamentLive', 'tournamentLive', 'TournamentLevel', 'tournamentLevel', "'tlive:", "'tournament-level:", 'api.tlive']
  },
  // Hesap oluştur (bulk account creation): pro keeps it, basic leaves it out (user 2026-11-21)
  signup: {
    files: ['src/main/services/signup-service.cjs'],
    stubs: ['src/renderer/components/SignupPanel.jsx'],
    forbidden: ['SignupService', 'SignupModal', 'SignupProgress', 'SIGNUP_TEXT', "'signup:", 'runSignupJob', 'setSignupOpen', 'api.signup']
  },
  // Auto Play's daily plan (daily stop / tournament / PVP lines) and the scheduler behind it ("Zamanla")
  dailyPlan: {
    files: ['src/main/services/autoplay-stop.cjs', 'src/main/services/scheduler.cjs'],
    stubs: ['src/renderer/components/AutoPlayStopBar.jsx'],
    forbidden: ['AutoPlayStop', 'SchedulerService', 'BUILTIN_TASKS', 'registerBuiltin', 'ScheduleModal', 'setScheduleOpen', "'schedules:",
      'api.schedules', 'addDailySchedule', 'scheduleText']
  }
};
