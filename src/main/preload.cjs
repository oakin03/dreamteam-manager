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
  buy: {
    buy: (accountId, ticket) => ipcRenderer.invoke('buy:buy', { accountId, ticket }),
    sell: (entryId, price, currency) => ipcRenderer.invoke('buy:sell', { entryId, price, currency }),
    cheapest: (query) => ipcRenderer.invoke('buy:cheapest', query),
    removeBought: (ids) => ipcRenderer.invoke('buy:remove-bought', ids),
    addWatch: (players) => ipcRenderer.invoke('buy:add-watch', players),
    updateWatch: (id, patch) => ipcRenderer.invoke('buy:update-watch', { id, patch }),
    removeWatch: (ids) => ipcRenderer.invoke('buy:remove-watch', ids),
    setConfig: (patch) => ipcRenderer.invoke('buy:set-config', patch),
    startAuto: (options) => ipcRenderer.invoke('buy:start-auto', options),
    stopAuto: () => ipcRenderer.invoke('buy:stop-auto')
  },
  activityArchive: {
    days: () => ipcRenderer.invoke('activity:days'),
    day: (day) => ipcRenderer.invoke('activity:day', day),
    search: (text) => ipcRenderer.invoke('activity:search', text),
    openFolder: () => ipcRenderer.invoke('activity:open-folder'),
    exportReport: () => ipcRenderer.invoke('activity:export'),
    summary: (day) => ipcRenderer.invoke('summary:day', day)
  },
  health: {
    refresh: () => ipcRenderer.invoke('health:refresh')
  },
  app: {
    factoryReset: (options) => ipcRenderer.invoke('app:factory-reset', options),
    pauseAll: () => ipcRenderer.invoke('app:pause-all'),
    resumeAll: () => ipcRenderer.invoke('app:resume-all')
  },
  synthesis: {
    start: (options) => ipcRenderer.invoke('synthesis:start', options),
    stop: () => ipcRenderer.invoke('synthesis:stop')
  },
  tower: {
    start: (accountIds) => ipcRenderer.invoke('tower:start', accountIds),
    stop: (accountIds) => ipcRenderer.invoke('tower:stop', accountIds)
  },
  goup: {
    start: (accountIds, options = {}) => ipcRenderer.invoke('goup:start', { accountIds, ...options }),
    stop: () => ipcRenderer.invoke('goup:stop'),
    status: (accountIds) => ipcRenderer.invoke('goup:status', accountIds)
  },
  quiz: {
    start: (accountIds) => ipcRenderer.invoke('quiz:start', accountIds),
    stop: () => ipcRenderer.invoke('quiz:stop'),
    answer: (accountId, letter) => ipcRenderer.invoke('quiz:answer', { accountId, letter })
  },
  cheer: {
    send: (fromIds, targetId) => ipcRenderer.invoke('cheer:send', { fromIds, targetId })
  },
  chat: {
    start: (config) => ipcRenderer.invoke('chat:start', config),
    stop: () => ipcRenderer.invoke('chat:stop')
  },
  pvp: {
    start: (accountIds) => ipcRenderer.invoke('pvp:start', accountIds),
    stop: () => ipcRenderer.invoke('pvp:stop'),
    status: (accountIds) => ipcRenderer.invoke('pvp:status', accountIds)
  },
  draft: {
    watch: () => ipcRenderer.invoke('draft:watch'),
    unwatch: () => ipcRenderer.invoke('draft:unwatch'),
    join: (accountId, slot) => ipcRenderer.invoke('draft:join', { accountId, slot }),
    pick: (accountId, playerId) => ipcRenderer.invoke('draft:pick', { accountId, playerId }),
    listPlayers: (accountId, items) => ipcRenderer.invoke('draft:list-players', { accountId, items }),
    clearDrafted: (accountId) => ipcRenderer.invoke('draft:clear-drafted', accountId)
  },
  players: {
    refresh: () => ipcRenderer.invoke('players:refresh'),
    setRoles: (playerId, roleIds) => ipcRenderer.invoke('players:set-roles', { playerId, roleIds })
  },
  accounts: {
    add: (payload) => ipcRenderer.invoke('accounts:add', payload),
    update: (id, patch) => ipcRenderer.invoke('accounts:update', { id, patch }),
    reorder: (ids) => ipcRenderer.invoke('accounts:reorder', ids),
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
    scan: (accountIds) => ipcRenderer.invoke('market:scan', accountIds),
    claim: (accountIds) => ipcRenderer.invoke('market:claim', accountIds),
    loadRelist: (accountIds) => ipcRenderer.invoke('market:load-relist', accountIds),
    relist: (items, options) => ipcRenderer.invoke('market:relist', items, options),
    clearRelist: () => ipcRenderer.invoke('market:clear-relist'),
    stop: () => ipcRenderer.invoke('market:stop')
  },
  autoTrade: {
    preflight: (options) => ipcRenderer.invoke('auto-trade:preflight', options),
    start: (options) => ipcRenderer.invoke('auto-trade:start', options),
    pause: () => ipcRenderer.invoke('auto-trade:pause'),
    resume: () => ipcRenderer.invoke('auto-trade:resume'),
    stop: () => ipcRenderer.invoke('auto-trade:stop'),
    continue: () => ipcRenderer.invoke('auto-trade:continue'),
    reset: () => ipcRenderer.invoke('auto-trade:reset'),
    resetCards: () => ipcRenderer.invoke('auto-trade:reset-cards'),
    respondListing: (items) => ipcRenderer.invoke('auto-trade:respond-listing', items),
    listPlayers: (accountId, items) => ipcRenderer.invoke('auto-trade:list-players', { accountId, items }),
    attention: (kind) => ipcRenderer.invoke('auto-trade:attention', kind)
  },
  equipment: {
    open: (accountId) => ipcRenderer.invoke('equipment:open', accountId),
    scan: () => ipcRenderer.invoke('equipment:scan'),
    close: () => ipcRenderer.invoke('equipment:close'),
    stop: () => ipcRenderer.invoke('equipment:stop'),
    recipes: () => ipcRenderer.invoke('equipment:recipes'),
    convert: (rarity, conversions) => ipcRenderer.invoke('equipment:convert', { rarity, conversions }),
    craft: (recipeId, count) => ipcRenderer.invoke('equipment:craft', { recipeId, count }),
    enchant: (inventoryId) => ipcRenderer.invoke('equipment:enchant', inventoryId),
    enhance: (inventoryId, target) => ipcRenderer.invoke('equipment:enhance', { inventoryId, target }),
    enhanceRate: (inventoryId) => ipcRenderer.invoke('equipment:enhance-rate', inventoryId),
    refineDetails: (inventoryId) => ipcRenderer.invoke('equipment:refine-details', inventoryId),
    refine: (inventoryId) => ipcRenderer.invoke('equipment:refine', inventoryId),
    register: (collectionId) => ipcRenderer.invoke('equipment:register', collectionId),
    plan: (collectionId, slot) => ipcRenderer.invoke('equipment:plan', collectionId, slot),
    prepare: (collectionId, slot) => ipcRenderer.invoke('equipment:prepare', collectionId, slot)
  },
  tournament: {
    start: (accountIds) => ipcRenderer.invoke('tournament:start', accountIds),
    stop: () => ipcRenderer.invoke('tournament:stop'),
    refresh: () => ipcRenderer.invoke('tournament:refresh')
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
    setTrackedTeams: (teams) => ipcRenderer.invoke('cards:set-tracked-teams', teams),
    setCustomTeam: (playerKey, team) => ipcRenderer.invoke('cards:set-custom-team', { playerKey, team })
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
  daily: {
    claimRewards: (accountIds) => ipcRenderer.invoke('daily:claim-rewards', accountIds),
    refreshTasks: (accountIds) => ipcRenderer.invoke('daily:refresh-tasks', accountIds)
  },
  settings: {
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    openDataFolder: () => ipcRenderer.invoke('settings:open-data-folder')
  },
  activity: { clear: () => ipcRenderer.invoke('activity:clear') }
});
