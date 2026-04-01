# Phase 4b: Build Config + Scripts Cleanup

**Depends on:** Phase 4a (Electron shell)
**Parent doc:** [phase-4-electron.md](phase-4-electron.md) Step 5-6
**Branch:** `zynx/feat/frontend-backend-separation`

## Context

Phase 4a created the thin Electron shell. This final session updates build config,
cleans up scripts, removes legacy code, and performs end-to-end verification.

## Scope

### 1. Update build config

In `electron.vite.config.ts`:

```typescript
export default defineConfig({
  main: { entry: 'src/electron/main.ts' },      // was: src/index.ts
  preload: { entry: 'src/electron/preload.ts' }, // was: src/preload.ts
  renderer: { root: 'src/renderer/' },
});
```

Add separate server build:

```json
{
  "build:server": "tsup src/server/index.ts --format esm --outDir dist-server"
}
```

### 2. Clean up package.json scripts

**Remove (~15 scripts):**

| Script                 | Reason                                          |
| ---------------------- | ----------------------------------------------- |
| `cli`                  | Duplicate of `start`                            |
| `webui`                | Replaced by `server:start`                      |
| `webui:remote`         | Replaced by `server:start:remote`               |
| `webui:prod`           | Replaced by `server:start` + `NODE_ENV`         |
| `webui:prod:remote`    | Same + `ALLOW_REMOTE=true`                      |
| `resetpass`            | Replaced by `server:resetpass`                   |
| `server:start:prod`    | Merge into `server:start`                       |
| `server:start:prod:remote` | Merge into `server:start:remote`            |
| `server:resetpass:prod` | Merge into `server:resetpass`                  |
| `package`, `make`      | Duplicate of `dist`                             |
| `build-mac`, etc.      | Use `dist:mac` instead                          |
| `build-win`, etc.      | Use `dist:win` instead                          |
| `build-deb`            | Use `dist:linux` instead                        |

**Target: 37 scripts -> 22 scripts.** See [phase-4-electron.md](phase-4-electron.md) "Scripts Cleanup" for full target list.

### 3. Remove legacy files

```bash
rm src/index.ts        # replaced by src/electron/main.ts
rm src/preload.ts      # replaced by src/electron/preload.ts
rm -rf src/process/    # fully migrated to src/server/ + src/electron/
```

### 4. Final verification

```bash
# Directory structure
ls src/
# Expected: common/ (thin), electron/, renderer/, server/

# No cross-contamination
grep -r "from 'electron'" src/server/    # must return nothing
grep -r "from 'electron'" src/renderer/  # must return nothing
grep -r "@office-ai/platform" src/renderer/  # must return nothing

# Build all targets
bun run build:server
bun run build          # electron-vite build

# Test all modes
bunx tsc --noEmit
bun run test

# Manual verification
bun run dev            # Electron desktop mode
bun run dev:server     # Standalone server mode
```

## Implementation Steps

1. Update electron.vite.config.ts entry points
2. Add server build script (tsup or esbuild)
3. Clean up package.json scripts (remove 15, consolidate)
4. Remove `src/index.ts`, `src/preload.ts`, `src/process/`
5. Verify final directory structure
6. Run full build + test suite
7. Manual test: Electron desktop, Web mode, Dev mode
8. Commit

## Acceptance Criteria

- [ ] Build produces three outputs: electron main, renderer, server
- [ ] `src/index.ts` and `src/preload.ts` removed
- [ ] `src/process/` directory fully removed
- [ ] Package.json scripts cleaned: 37 -> ~22
- [ ] Electron desktop mode works
- [ ] Standalone server mode works (`bun run server:start`)
- [ ] Web mode works (browser connects to standalone server)
- [ ] Development mode works (`bun run dev`)
- [ ] All tests pass
- [ ] Zero `electron` imports in `src/server/` and `src/renderer/`

## Final Directory Structure

```
src/
├── electron/      # Electron shell (~20 files)
├── renderer/      # Frontend React SPA (~428 files)
├── server/        # Backend Node.js server (~300 files)
└── common/        # Minimal shared runtime (if any remains)

packages/
└── protocol/      # Shared types + wire protocol (Phase 1)
```
