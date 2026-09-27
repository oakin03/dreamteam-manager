# Task Plugin API (v0.1)

Her task bir klasördür:

```text
task-name/
  manifest.json
  index.cjs
```

`manifest.json` en az `id`, `name`, `version`, `description` içermelidir.

`index.cjs` şu fonksiyonları export eder:

```js
async function prepare(ctx) { ... }
async function run(ctx, prepared) { ... }
async function disposePrepared(prepared, ctx) { ... } // opsiyonel

module.exports = { prepare, run, disposePrepared };
```

## ctx

Plugin aşağıdaki kontrollü runtime araçlarını alır:

- `ctx.account` — id, name, login, visibleBrowser (password içermez)
- `ctx.credentials()` — çalışma anında decrypt edilen login/password
- `ctx.signal` — AbortSignal
- `ctx.sleep(ms)` — Stop ile kesilebilen sleep
- `ctx.log(level, message)` — `info | success | warning | error`
- `ctx.setState(patch)` — status/message/nextActionAt vb.
- `ctx.browser` — login/navigation browser servisi
- `ctx.socket.create(url, options)` — uygulamanın Socket.IO client factory'si
- `ctx.config` — task config
- `ctx.visibleBrowser`
- `ctx.forceFresh`

Yeni tasklar ana Electron/React uygulamasına import edilmez; Task Registry klasörü dinamik tarar.
