# Phase 3d: Electron Code Isolation + Data Directory

**Depends on:** Phase 3c (directory restructure)
**Parent doc:** [phase-3-server.md](phase-3-server.md) Step 6, 8-9
**Branch:** `zynx/feat/frontend-backend-separation`

## Context

Phase 3c moved all business logic to `src/server/`. Some Electron-specific code
still lives in `src/process/` (or was moved to `src/server/` and needs extraction).
This session isolates all Electron code and unifies the data directory strategy.

## Scope

### Part 1: Isolate Electron code

Move Electron-specific handlers and utilities to `src/electron/`:

| Current location                         | -> Electron location                      |
| ---------------------------------------- | ----------------------------------------- |
| `bridge/dialogBridge.ts`                 | `src/electron/handlers/dialog.ts`         |
| `bridge/windowControlsBridge.ts`         | `src/electron/handlers/windowControls.ts` |
| `bridge/updateBridge.ts`                 | `src/electron/handlers/update.ts`         |
| `bridge/shellBridge.ts` (Electron part)  | `src/electron/handlers/shell.ts`          |
| `utils/configureChromium.ts`             | `src/electron/utils/chromiumConfig.ts`    |
| `utils/tray.ts`                          | `src/electron/lifecycle/tray.ts`          |
| `utils/appMenu.ts`                       | `src/electron/lifecycle/appMenu.ts`       |
| `utils/deepLink.ts`                      | `src/electron/lifecycle/deepLink.ts`      |
| `utils/shellEnv.ts`                      | `src/electron/utils/shellEnv.ts`          |
| `utils/zoom.ts`                          | `src/electron/utils/zoom.ts`              |

**Target structure:**

```
src/electron/
├── handlers/
│   ├── dialog.ts
│   ├── windowControls.ts
│   ├── shell.ts
│   └── update.ts
├── lifecycle/
│   ├── tray.ts
│   ├── appMenu.ts
│   └── deepLink.ts
└── utils/
    ├── chromiumConfig.ts
    ├── shellEnv.ts
    └── zoom.ts
```

### Part 2: Data directory unification

Change `NodePlatformServices.ts` default from `~/.aionui-server` to `~/.aionui`:

```typescript
// Before
getDataDir: () => process.env.DATA_DIR ?? path.join(os.homedir(), '.aionui-server'),

// After
const isDev = process.env.NODE_ENV === 'development';
const suffix = isDev ? '-dev' : '';
getDataDir: () => process.env.DATA_DIR ?? path.join(os.homedir(), `.aionui${suffix}`),
```

**Final strategy:**

| Mode             | Data dir        | Config dir          |
| ---------------- | --------------- | ------------------- |
| Electron release | `~/.aionui`     | `~/.aionui-config`  |
| Electron dev     | `~/.aionui-dev` | `~/.aionui-config-dev` |
| Server release   | `~/.aionui`     | `~/.aionui-config`  |
| Server dev       | `~/.aionui-dev` | `~/.aionui-config-dev` |
| Custom override  | `DATA_DIR=...`  | `CONFIG_DIR=...`    |

### Part 3: Update build config

In `electron.vite.config.ts`:

- Main process entry: `src/electron/main.ts` (will be created in Phase 4a)
- For now, ensure `src/index.ts` still works but imports from new locations

## Implementation Steps

1. Create `src/electron/` directory structure
2. Move Electron-specific handlers (dialog, windowControls, update, shell)
3. Move lifecycle utilities (tray, appMenu, deepLink)
4. Move Electron utilities (chromiumConfig, shellEnv, zoom)
5. Update all imports referencing moved files
6. Update data directory strategy in NodePlatformServices.ts
7. Verify: `grep -r "from 'electron'" src/server/` — must return nothing
8. Verify: `bunx tsc --noEmit` + `bun run test`
9. Commit

## Acceptance Criteria

- [ ] `src/server/` has zero `electron` imports
- [ ] `src/electron/` contains all Electron-specific code
- [ ] Data directory unified: server uses `~/.aionui` by default
- [ ] `src/process/` can be removed (or is empty)
- [ ] Build passes, tests pass
