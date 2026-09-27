const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dreamteam', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('app:state', handler);
    return () => ipcRenderer.removeListener('app:state', handler);
  },
  onAutoTradeHotkey: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('auto-trade:hotkey', handler);
    return () => ipcRenderer.removeListener('auto-trade:hotkey', handler);
  },
  accounts: {
    add: (payload) => ipcRenderer.invoke('accounts:add', payload),
    update: (id, patch) => ipcRenderer.invoke('accounts:update', { id, patch }),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    start: (id) => ipcRenderer.invoke('accounts:start', id),
    stop: (id) => ipcRenderer.invoke('accounts:stop', id),
    selectTask: (id, taskId) => ipcRenderer.invoke('accounts:select-task', { id, taskId }),
    setMain: (id) => ipcRenderer.invoke('accounts:set-main', id)
  },
  scout: {
    open: (accountId) => ipcRenderer.invoke('scout:open', accountId),
    refresh: (accountId) => ipcRenderer.invoke('scout:refresh', accountId),
    callback: (accountId) => ipcRenderer.invoke('scout:callback', accountId),
    sign: (accountId, playerKey) => ipcRenderer.invoke('scout:sign', { accountId, playerKey }),
    close: (accountId) => ipcRenderer.invoke('scout:close', accountId)
  },
  market: {
    open: (accountId) => ipcRenderer.invoke('market:open', accountId),
    claim: (accountId) => ipcRenderer.invoke('market:claim', accountId),
    close: (accountId) => ipcRenderer.invoke('market:close', accountId)
  },
  autoTrade: {
    preflight: (options) => ipcRenderer.invoke('auto-trade:preflight', options),
    start: (options) => ipcRenderer.invoke('auto-trade:start', options),
    pause: () => ipcRenderer.invoke('auto-trade:pause'),
    resume: () => ipcRenderer.invoke('auto-trade:resume'),
    resumeSide: (sideId) => ipcRenderer.invoke('auto-trade:resume-side', sideId),
    reconcilePending: () => ipcRenderer.invoke('auto-trade:reconcile-pending'),
    stop: () => ipcRenderer.invoke('auto-trade:stop'),
    reset: () => ipcRenderer.invoke('auto-trade:reset')
  },
  trade: {
    saveAccount: (payload) => ipcRenderer.invoke('trade:save-account', payload),
    start: (options) => ipcRenderer.invoke('trade:start', options),
    stop: () => ipcRenderer.invoke('trade:stop'),
    clear: () => ipcRenderer.invoke('trade:clear')
  },
  cards: {
    refresh: () => ipcRenderer.invoke('cards:refresh'),
    reset: () => ipcRenderer.invoke('cards:reset'),
    addRole: (name, color) => ipcRenderer.invoke('cards:add-role', { name, color }),
    updateRole: (id, patch) => ipcRenderer.invoke('cards:update-role', { id, patch }),
    deleteRole: (id) => ipcRenderer.invoke('cards:delete-role', id),
    setPlayerRoles: (playerKey, roleIds) => ipcRenderer.invoke('cards:set-player-roles', { playerKey, roleIds }),
    setTrackedTeams: (teams) => ipcRenderer.invoke('cards:set-tracked-teams', teams)
  },
  tasks: {
    refresh: () => ipcRenderer.invoke('tasks:refresh'),
    openFolder: () => ipcRenderer.invoke('tasks:open-folder')
  },
  schedules: {
    add: (payload) => ipcRenderer.invoke('schedules:add', payload),
    remove: (id) => ipcRenderer.invoke('schedules:remove', id),
    toggle: (id, enabled) => ipcRenderer.invoke('schedules:toggle', { id, enabled })
  },
  settings: {
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    openDataFolder: () => ipcRenderer.invoke('settings:open-data-folder')
  },
  activity: { clear: () => ipcRenderer.invoke('activity:clear') }
});
