# Phase 3c: Directory Restructure

**Depends on:** Phase 3b (all bridges migrated)
**Parent doc:** [phase-3-server.md](phase-3-server.md) Step 4-5, 7
**Branch:** `zynx/feat/frontend-backend-separation`

## Context

Phase 3a-3b migrated all bridge handlers to `src/server/handlers/`.
This session moves the remaining `src/process/` subdirectories into `src/server/`
and updates all import paths.

## Scope

### Part 1: Move directories

```bash
# These directories move as-is (internal structure unchanged)
src/process/services    -> src/server/services
src/process/agent       -> src/server/agent
src/process/channels    -> src/server/channels
src/process/extensions  -> src/server/extensions
src/process/task        -> src/server/task
src/process/worker      -> src/server/worker
src/process/resources   -> src/server/resources
```

### Part 2: Restructure HTTP server

```bash
src/process/webserver/routes     -> src/server/http/routes
src/process/webserver/middleware -> src/server/http/middleware
src/process/webserver/auth       -> src/server/http/auth
src/process/webserver/websocket  -> src/server/http/websocket
```

Remove `webserver/adapter.ts` — its role is replaced by WsRouter.

### Part 3: Update path aliases

In `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@server/*": ["./src/server/*"],
      "@aionui/protocol": ["./packages/protocol/src"],
      "@aionui/protocol/*": ["./packages/protocol/src/*"]
    }
  }
}
```

### Part 4: Update all internal imports

Replace `@process/` with `@server/` across the codebase.
This is largely mechanical — find-and-replace.

## Implementation Steps

1. Move `services/`, `agent/`, `channels/`, `extensions/`, `task/`, `worker/`, `resources/`
2. Restructure `webserver/` -> `http/`, remove adapter.ts
3. Update tsconfig.json path aliases
4. Bulk-replace `@process/` -> `@server/` in all files
5. Fix any remaining broken imports
6. Verify: `bunx tsc --noEmit` + `bun run test`
7. Commit

## Acceptance Criteria

- [ ] `src/process/` only contains Electron-specific code (to be moved in 3d)
- [ ] All business logic lives in `src/server/`
- [ ] `@server/*` path alias works
- [ ] `@process/*` alias can be removed (or points to minimal remaining code)
- [ ] webserver/adapter.ts removed
- [ ] Build passes, tests pass
