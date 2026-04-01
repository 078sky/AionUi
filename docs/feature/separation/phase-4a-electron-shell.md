# Phase 4a: Electron Thin Shell

**Depends on:** Phase 2c (frontend complete) + Phase 3d (Electron isolated)
**Parent doc:** [phase-4-electron.md](phase-4-electron.md) Step 1-4
**Branch:** `zynx/feat/frontend-backend-separation`

## Context

Phase 2 created the frontend ApiClient (WebSocket-based).
Phase 3 restructured the backend into `src/server/` and isolated Electron code into `src/electron/`.
This session transforms `src/index.ts` into a thin Electron shell that spawns the server as a child process.

## Scope

### 1. New `src/electron/main.ts`

Replace the current `src/index.ts` (300+ lines, inlines all backend initialization)
with a thin launcher:

```typescript
// src/electron/main.ts
// 1. Find a free port
// 2. Spawn backend server as child process
// 3. Wait for server ready
// 4. Create BrowserWindow -> ws://localhost:PORT
// 5. Register Electron-only handlers (dialog, shell, windowControls, update)
// 6. Setup tray, menu, deep links
// 7. On quit: kill server process
```

See [phase-4-electron.md](phase-4-electron.md) "Step 1: Simplified main.ts" for full code reference.

### 2. New `src/electron/preload.ts`

Replace current `src/preload.ts` (80 lines, exposes emit/on/multiple IPC) with ~10 lines:

```typescript
contextBridge.exposeInMainWorld('electronConfig', {
  serverUrl,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
```

### 3. Electron-only handlers with `electron:` prefix

The ~5-6 Electron-only handlers (dialog, windowControls, shell, update)
use `electron:` IPC prefix, separate from WebSocket business logic.

Frontend calls these via `platformAdapter` (created in Phase 2a).

### 4. Lifecycle module migration

Move lifecycle code from old `src/index.ts`:

| Functionality        | -> File                                   |
| -------------------- | ----------------------------------------- |
| Single instance lock | `src/electron/lifecycle/singleInstance.ts` |
| Tray icon            | Already in `src/electron/lifecycle/tray.ts` (Phase 3d) |
| App menu             | Already in `src/electron/lifecycle/appMenu.ts` (Phase 3d) |
| Deep links           | Already in `src/electron/lifecycle/deepLink.ts` (Phase 3d) |

## Implementation Steps

1. Create `src/electron/main.ts` — thin launcher
2. Create `src/electron/preload.ts` — minimal preload
3. Create `src/electron/lifecycle/singleInstance.ts`
4. Wire Electron-only handlers with `electron:` prefix
5. Verify Electron app starts: spawns server, connects via WebSocket
6. `bunx tsc --noEmit` + `bun run test`
7. Commit

## Acceptance Criteria

- [ ] `src/electron/main.ts` spawns server as child process, creates BrowserWindow
- [ ] `src/electron/preload.ts` only exposes `serverUrl` and `getPathForFile`
- [ ] Electron-only handlers (~5-6) registered via IPC with `electron:` prefix
- [ ] All lifecycle code in `src/electron/lifecycle/`
- [ ] Electron desktop app works: spawn server -> connect via WebSocket -> UI works
- [ ] Build passes, tests pass
