# Phase 4: Electron Shell Refactor

**Depends on:** Phase 2 (ApiClient) + Phase 3 (Server restructure)

## Objective

Transform Electron from "the application" into a thin shell that:

1. Spawns the backend server as a child process
2. Opens a BrowserWindow pointed at `ws://localhost:PORT`
3. Manages app lifecycle (tray, menu, deep links, auto-update)
4. Has minimal code — easy to maintain, easy to drop if going pure Web

## Current State

`src/index.ts` is a 300+ line Electron main process that:

- Initializes all backend services inline (`initializeProcess()`)
- Registers all IPC bridge handlers (`initAllBridges()`)
- Creates BrowserWindow with custom frame
- Manages tray, menu, deep links, zoom, single instance lock
- Optionally starts WebUI server
- Runs Sentry, shell env detection, Chromium config

**Everything runs in a single Node.js process** — Electron main = backend.

## Target State

```
src/electron/
├── main.ts                # Entry point — spawn server + create window
├── preload.ts             # Minimal — just pass server URL
├── handlers/              # Electron-only endpoint handlers
│   ├── dialog.ts          # Native file picker (electron.dialog)
│   ├── windowControls.ts  # Minimize/maximize/close/isMaximized
│   ├── shell.ts           # Open external URL, show in folder
│   └── update.ts          # electron-updater auto-update
├── lifecycle/             # App lifecycle management
│   ├── singleInstance.ts  # Single instance lock + deep link relay
│   ├── tray.ts            # System tray
│   ├── appMenu.ts         # Application menu
│   └── deepLink.ts        # Protocol URL handling
└── utils/
    ├── chromiumConfig.ts  # Chromium flags
    ├── shellEnv.ts        # Shell environment detection
    └── zoom.ts            # Zoom factor management
```

## Architecture

```
┌── Electron Process ──────────────────────────┐
│                                               │
│  main.ts                                      │
│  ├─ spawn server process (port=random)        │
│  ├─ wait for server ready                     │
│  ├─ create BrowserWindow                      │
│  │   └─ loads renderer (Vite build output)    │
│  ├─ register Electron-only handlers           │
│  │   (dialog, window controls, shell, update) │
│  ├─ setup tray, menu, deep links              │
│  └─ on quit: kill server process              │
│                                               │
│  preload.ts                                   │
│  └─ exposes: { serverUrl, getPathForFile }    │
│                                               │
│  Server Process (child_process)               │
│  └─ src/server/index.ts                       │
│      ├─ HTTP on localhost:PORT                 │
│      ├─ WebSocket on localhost:PORT            │
│      └─ all business logic                    │
│                                               │
│  BrowserWindow (Renderer)                     │
│  └─ src/renderer/                             │
│      └─ ApiClient → ws://localhost:PORT       │
│                                               │
└───────────────────────────────────────────────┘
```

## Implementation

### Step 1: Simplified `main.ts`

```typescript
// src/electron/main.ts
import { app, BrowserWindow } from 'electron'
import { fork } from 'child_process'
import path from 'path'
import { setupSingleInstance } from './lifecycle/singleInstance'
import { createOrUpdateTray } from './lifecycle/tray'
import { setupApplicationMenu } from './lifecycle/appMenu'
import { registerElectronHandlers } from './handlers'
import { findFreePort } from './utils/port'

let serverProcess: ReturnType<typeof fork> | null = null
let mainWindow: BrowserWindow | null = null

// Single instance lock
if (!setupSingleInstance()) {
  app.quit()
} else {
  app.whenReady().then(startApp)
}

async function startApp() {
  // 1. Find a free port
  const port = await findFreePort()

  // 2. Spawn backend server
  serverProcess = fork(
    path.join(__dirname, '../server/index.js'),
    ['--port', String(port)],
    { stdio: 'pipe' }
  )

  // 3. Wait for server to be ready
  await waitForServer(`http://localhost:${port}/api`)

  // 4. Create window
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalData: { serverUrl: `ws://localhost:${port}` },
    },
  })

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  // 5. Register Electron-only handlers (dialog, shell, etc.)
  registerElectronHandlers(mainWindow, port)

  // 6. Setup tray and menu
  createOrUpdateTray(mainWindow)
  setupApplicationMenu(mainWindow)
}

app.on('before-quit', () => {
  serverProcess?.kill()
})
```

### Step 2: Minimal `preload.ts`

```typescript
// src/electron/preload.ts
import { contextBridge, webUtils } from 'electron'

// Receive server URL from main process
const serverUrl = (process as any).argv
  .find((a: string) => a.startsWith('--server-url='))
  ?.split('=')[1]

contextBridge.exposeInMainWorld('electronConfig', {
  serverUrl,
  // Only Electron-specific API: drag-and-drop file path
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})
```

Compare with current `preload.ts` (80 lines, exposes `emit`, `on`, multiple direct IPC calls) — this is ~10 lines.

### Step 3: Electron-Only Handlers

Some features only exist in Electron desktop and have no Web equivalent:

```typescript
// src/electron/handlers/dialog.ts
import { ipcMain, dialog, BrowserWindow } from 'electron'

export function registerDialogHandlers(win: BrowserWindow) {
  ipcMain.handle('electron:show-open-dialog', async (_event, options) => {
    const result = await dialog.showOpenDialog(win, options)
    return result.filePaths
  })
}
```

```typescript
// src/electron/handlers/windowControls.ts
import { ipcMain, BrowserWindow } from 'electron'

export function registerWindowControlHandlers(win: BrowserWindow) {
  ipcMain.handle('electron:minimize', () => win.minimize())
  ipcMain.handle('electron:maximize', () => {
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle('electron:close', () => win.close())
  ipcMain.handle('electron:is-maximized', () => win.isMaximized())
}
```

These use a separate `electron:` prefix to distinguish from backend endpoints. The frontend's `platformAdapter` calls these via IPC (not WebSocket).

**How the frontend calls Electron-only APIs:**

```typescript
// src/renderer/utils/platformAdapter.ts
export const platformAdapter = {
  async showOpenDialog(options: OpenDialogOptions): Promise<string[] | undefined> {
    if (window.electronConfig) {
      // Electron: use IPC directly (few calls, not worth routing through WS)
      return window.electron.ipcRenderer.invoke('electron:show-open-dialog', options)
    }
    // Web: use <input type="file"> fallback
    return showWebFilePicker(options)
  },

  minimize(): void {
    if (window.electronConfig) {
      window.electron.ipcRenderer.invoke('electron:minimize')
    }
  },

  // ... other Electron-only APIs
}
```

**Note:** These few Electron IPC calls (~5-6 total) are fine to keep as IPC. They are Electron-specific by nature and don't need to go through WebSocket. The key principle is: **business logic goes through WebSocket, platform features go through IPC.**

### Step 4: Lifecycle Modules

Move existing lifecycle code from `src/index.ts` and `src/process/utils/`:

| Current location | → Electron location |
|---|---|
| `src/index.ts` (single instance lock) | `src/electron/lifecycle/singleInstance.ts` |
| `src/process/utils/tray.ts` | `src/electron/lifecycle/tray.ts` |
| `src/process/utils/appMenu.ts` | `src/electron/lifecycle/appMenu.ts` |
| `src/process/utils/deepLink.ts` | `src/electron/lifecycle/deepLink.ts` |
| `src/process/utils/configureChromium.ts` | `src/electron/utils/chromiumConfig.ts` |
| `src/process/utils/shellEnv.ts` | `src/electron/utils/shellEnv.ts` |
| `src/process/utils/zoom.ts` | `src/electron/utils/zoom.ts` |

### Step 5: Update Build Config

```typescript
// electron.vite.config.ts
export default defineConfig({
  main: {
    entry: 'src/electron/main.ts',   // was: src/index.ts
  },
  preload: {
    entry: 'src/electron/preload.ts', // was: src/preload.ts
  },
  renderer: {
    root: 'src/renderer/',
  },
})
```

Add a separate server build target:

```typescript
// Server is built separately (not through electron-vite)
// package.json scripts:
{
  "build:server": "tsup src/server/index.ts --format esm --outDir dist-server",
  "build:electron": "electron-vite build",
  "build": "bun run build:server && bun run build:electron"
}
```

### Step 6: Clean Up

After migration:

```bash
# These should be empty / removed:
rm src/index.ts              # replaced by src/electron/main.ts
rm src/preload.ts            # replaced by src/electron/preload.ts
rm -rf src/process/          # fully migrated to src/server/ + src/electron/

# Verify separation
ls src/
# Expected: common/ (thin), electron/, renderer/, server/

# Verify no cross-contamination
grep -r "from 'electron'" src/server/   # must return nothing
grep -r "from 'electron'" src/renderer/ # must return nothing (except type declarations)
```

## Final Directory Structure

```
src/
├── electron/              # Electron shell (~20 files)
│   ├── main.ts
│   ├── preload.ts
│   ├── handlers/
│   ├── lifecycle/
│   └── utils/
├── renderer/              # Frontend React SPA (~428 files)
│   ├── api/               # ApiClient (new in Phase 2)
│   ├── pages/
│   ├── components/
│   ├── hooks/
│   ├── services/
│   ├── styles/
│   └── utils/
├── server/                # Backend Node.js server (~300 files)
│   ├── router/            # WsRouter (new in Phase 3)
│   ├── handlers/          # endpoint handlers
│   ├── http/              # Express + WebSocket
│   ├── services/
│   ├── agent/
│   ├── channels/
│   ├── extensions/
│   ├── task/
│   ├── worker/
│   └── utils/
└── common/                # Minimal shared runtime (if any remains)

packages/
└── protocol/              # Shared types + wire protocol (Phase 1)
```

## Deployment Modes

After separation, the frontend can be either Electron or a web browser. The backend is always the standalone server.

```
Mode 1: Electron Desktop
┌─ Electron ─────────────────────────┐
│ main.ts → spawn server process     │
│ BrowserWindow → ws://localhost:PORT │
└────────────────────────────────────┘

Mode 2: Web (Self-Hosted)
┌─ Browser ──────────────┐   ┌─ Server ─────────────┐
│ React SPA              │──▶│ bun dist-server/...   │
│ ws://server-host:PORT  │   │ HTTP + WebSocket      │
└────────────────────────┘   └───────────────────────┘

Mode 3: Development
┌─ Browser ──────────────┐   ┌─ Dev Server ──────────┐
│ Vite HMR               │──▶│ bun dev:server        │
│ ws://localhost:PORT     │   │                       │
└────────────────────────┘   └───────────────────────┘
```

The frontend is always the same React SPA code. The backend is always `src/server/`. The only difference is how they connect.

## Scripts Cleanup

### Scripts to remove

| Script | Reason |
|--------|--------|
| `cli` | Duplicate of `start` |
| `webui` | Replaced by standalone `server:start` |
| `webui:remote` | Replaced by `server:start:remote` |
| `webui:prod` | Replaced by `server:start` with `NODE_ENV=production` |
| `webui:prod:remote` | Same as above with `ALLOW_REMOTE=true` |
| `resetpass` | Replaced by `server:resetpass` (no Electron needed) |
| `server:start:prod` | Merge into `server:start` (env var controls mode) |
| `server:start:prod:remote` | Merge into `server:start:remote` |
| `server:resetpass:prod` | Merge into `server:resetpass` |
| `package` | Duplicate of `dist` |
| `make` | Duplicate of `dist` |
| `build-mac`, `build-mac:arm64`, `build-mac:x64` | Use `dist:mac` instead |
| `build-win`, `build-win:arm64`, `build-win:x64` | Use `dist:win` instead |
| `build-deb` | Use `dist:linux` instead |

### Target scripts

```jsonc
{
  "scripts": {
    // === Development ===
    "dev": "electron-vite dev",
    "dev:server": "bun src/server/index.ts",
    "dev:renderer": "vite dev --config vite.renderer.config.ts",

    // === Build ===
    "build": "bun run build:server && electron-vite build",
    "build:server": "node scripts/build-server.mjs",
    "build:renderer": "vite build --config vite.renderer.config.ts",

    // === Distribution (Electron) ===
    "dist": "node scripts/build-with-builder.js",
    "dist:mac": "node scripts/build-with-builder.js auto --mac",
    "dist:win": "node scripts/build-with-builder.js auto --win",
    "dist:linux": "node scripts/build-with-builder.js auto --linux",

    // === Standalone Server ===
    "server:start": "bun dist-server/server.mjs",
    "server:start:remote": "ALLOW_REMOTE=true bun dist-server/server.mjs",
    "server:resetpass": "bun dist-server/server.mjs --resetpass",

    // === Code Quality ===
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "i18n:types": "node scripts/generate-i18n-types.js",

    // === Testing ===
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test --config playwright.config.ts",

    // === Misc ===
    "prepare": "husky",
    "postinstall": "node scripts/postinstall.js"
  }
}
```

**Reduction:** 37 scripts → 22 scripts. Clean separation between dev, build, dist, server, and tooling.

### Dependencies to consider splitting

After separation, dependencies naturally split into three groups:

| Group | Examples | Where |
|---|---|---|
| **Frontend only** | react, react-dom, @arco-design/web-react, @icon-park/react, i18next, unocss | `src/renderer/` devDep or separate workspace |
| **Backend only** | express, ws, better-sqlite3, @anthropic-ai/sdk, openai, grammy, sharp | `src/server/` |
| **Electron only** | electron, electron-builder, electron-updater, electron-squirrel-startup | `src/electron/` devDep |
| **Shared** | typescript, vitest, @aionui/protocol | root |

This split is optional but reduces install size for server-only deployments (no need to install React, Arco, etc.).

## Acceptance Criteria

- [ ] `src/electron/main.ts` spawns server as child process, creates BrowserWindow
- [ ] `src/electron/preload.ts` only exposes `serverUrl` and `getPathForFile`
- [ ] Electron-only handlers (~5) registered via IPC with `electron:` prefix
- [ ] All lifecycle code moved from `src/process/utils/` to `src/electron/lifecycle/`
- [ ] `src/index.ts` and `src/preload.ts` removed (replaced)
- [ ] `src/process/` directory fully removed
- [ ] Build produces three outputs: electron main, renderer, server
- [ ] Electron desktop app works: spawns server, connects via WebSocket
- [ ] Standalone server works: `bun run server`
- [ ] Web mode works: browser connects to standalone server

## Notes

- The Electron shell should remain ~20 files. If it grows larger, something is wrong — business logic is leaking in.
- `src/common/` may survive as a very thin shared utilities layer, or be fully absorbed into `packages/protocol` + `src/server/`. Evaluate after Phase 3.
- The `electron-squirrel-startup` and Sentry integration stay in `src/electron/`.
- Auto-update (`electron-updater`) is Electron-only and lives in `src/electron/handlers/update.ts`.
