const crypto = require('crypto');
class ActivityService {
  constructor(store, onChanged) {
    this.store = store;
    this.onChanged = onChanged;
  }

  list() {
    return this.store.getActivity();
  }

  // `code` + `params` let the page show the entry in the selected language;
  // `message` stays as the English fallback.
  add({ level = 'info', accountId = null, accountName = '', taskId = null, taskName = '', message, alertType = null, code = null, params = null }) {
    const settings = this.store.getSettings();
    const max = Number(settings.maxActivityEntries || 500);
    const items = this.store.getActivity();
    items.unshift({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      level,
      accountId,
      accountName,
      taskId,
      taskName,
      message: String(message),
      alertType: alertType || null,
      ...(code ? { code, params: params || {} } : {})
    });
    this.store.saveActivity(items.slice(0, max));
    this.onChanged?.();
  }

  clear() {
    this.store.saveActivity([]);
    this.onChanged?.();
  }
}

module.exports = { ActivityService };
