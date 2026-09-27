const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./store.cjs');

function copyRecursive(src, dest, overwrite = false) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(from, to, overwrite);
    else if (overwrite || !fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

class TaskRegistry {
  constructor({ taskDir, bundledTaskDir }) {
    this.taskDir = taskDir;
    this.bundledTaskDir = bundledTaskDir;
    this.tasks = new Map();
    ensureDir(taskDir);
    // Bundled default tasks are application code and must be refreshed on updates.
    // User-created plugin folders remain untouched.
    if (fs.existsSync(bundledTaskDir)) {
      for (const entry of fs.readdirSync(bundledTaskDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        copyRecursive(path.join(bundledTaskDir, entry.name), path.join(taskDir, entry.name), true);
      }
    }
    this.refresh();
  }

  refresh() {
    this.tasks.clear();
    ensureDir(this.taskDir);
    for (const entry of fs.readdirSync(this.taskDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(this.taskDir, entry.name);
      const manifestPath = path.join(dir, 'manifest.json');
      const codePath = path.join(dir, 'index.cjs');
      if (!fs.existsSync(manifestPath) || !fs.existsSync(codePath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!manifest.id || !manifest.name) throw new Error('manifest id/name missing');
        this.tasks.set(manifest.id, { ...manifest, dir, codePath, loadError: null });
      } catch (error) {
        this.tasks.set(`broken:${entry.name}`, { id: `broken:${entry.name}`, name: entry.name, version: '?', description: 'Task could not be loaded', dir, codePath, loadError: error.message });
      }
    }
    return this.list();
  }

  list() { return [...this.tasks.values()].map(({ codePath, dir, ...task }) => task); }
  get(id) { return this.tasks.get(id) || null; }
  load(id) {
    const entry = this.tasks.get(id);
    if (!entry) throw new Error(`Task not found: ${id}`);
    if (entry.loadError) throw new Error(entry.loadError);
    delete require.cache[require.resolve(entry.codePath)];
    const plugin = require(entry.codePath);
    if (!plugin || typeof plugin.prepare !== 'function' || typeof plugin.run !== 'function') throw new Error('Task plugin must export prepare(ctx) and run(ctx, prepared).');
    return { plugin, manifest: entry };
  }
}

module.exports = { TaskRegistry };
