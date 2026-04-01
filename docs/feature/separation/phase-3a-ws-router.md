# Phase 3a: WsRouter + Small Bridge Migration

**Depends on:** Phase 1 (packages/protocol) — Done
**Parent doc:** [phase-3-server.md](phase-3-server.md) Step 1-3 (small bridges)
**Branch:** `zynx/feat/frontend-backend-separation`

## Context

Phase 1 created `EndpointMap` (200 endpoints) and `EventMap` (33 events) in `@aionui/protocol`.
This session implements the backend `WsRouter` and migrates small bridges to establish the pattern.

## Deliverables

### 1. Implement WsRouter

```
src/server/router/
├── WsRouter.ts    # name -> handler dispatch, type-safe
└── types.ts       # Handler type definitions
```

**WsRouter requirements:**

- `handle<K>(name, handler)` — register endpoint handler, type-safe via `EndpointMap`
- `dispatch(raw)` — parse WebSocket message, route to handler, return response
- `emit<K>(name, data)` — broadcast event to all clients, type-safe via `EventMap`
- `setBroadcaster(fn)` — wire WebSocket broadcast function
- Support both new protocol (`{ type, id, name, data }`) and legacy (`{ name, data }`)

See [phase-3-server.md](phase-3-server.md) "WsRouter" section for full code reference.

### 2. Migrate small bridges (~10 files)

Start with simple, low-risk bridges to establish the migration pattern:

| Bridge file              | -> Handler file              | Endpoints          |
| ------------------------ | ---------------------------- | ------------------ |
| `cronBridge.ts`          | `handlers/cron.ts`           | 5 providers + 4 emitters |
| `databaseBridge.ts`      | `handlers/database.ts`       | 3 providers        |
| `authBridge.ts`          | `handlers/auth.ts`           | 3 providers        |
| `notificationBridge.ts`  | `handlers/notification.ts`   | 1 provider         |
| `previewBridge.ts`       | `handlers/preview.ts`        | various            |
| `updateBridge.ts`        | `handlers/update.ts`         | various            |
| `taskBridge.ts`          | `handlers/task.ts`           | 2 providers        |
| `starOfficeBridge.ts`    | `handlers/starOffice.ts`     | 1 provider         |
| `speechBridge.ts`        | `handlers/speech.ts`         | various            |
| `protocolBridge.ts`      | `handlers/protocol.ts`       | various            |

**Migration pattern:**

```typescript
// Before (src/process/bridge/cronBridge.ts)
import { bridge } from '@office-ai/platform';
export function initCronBridge(service) {
  bridge.handle('cron.list-jobs', async () => service.listJobs());
}

// After (src/server/handlers/cron.ts)
import type { WsRouter } from '../router/WsRouter';
export function registerCronHandlers(router: WsRouter, service) {
  router.handle('cron.list-jobs', async () => service.listJobs());
}
```

Handler logic stays exactly the same. Only the registration mechanism changes.

### 3. Create handler registry

```typescript
// src/server/handlers/index.ts
export function registerAllHandlers(router: WsRouter, services: Services) {
  registerCronHandlers(router, services.cron);
  registerDatabaseHandlers(router, services.database);
  // ... etc
}
```

## Implementation Steps

1. Create `src/server/router/WsRouter.ts`
2. Create `src/server/router/types.ts`
3. Migrate cronBridge -> handlers/cron.ts
4. Migrate databaseBridge -> handlers/database.ts
5. Migrate authBridge -> handlers/auth.ts
6. Migrate remaining small bridges (~7 files)
7. Create `handlers/index.ts` registry
8. Verify: `bunx tsc --noEmit` + `bun run test`
9. Commit per batch

## Acceptance Criteria

- [ ] `src/server/router/WsRouter.ts` implemented with type-safe dispatch
- [ ] WsRouter supports both new and legacy protocol formats
- [ ] ~10 small bridges migrated to `src/server/handlers/`
- [ ] `handlers/index.ts` registers all migrated handlers
- [ ] Build passes, tests pass
- [ ] Migration pattern documented and validated for Phase 3b
