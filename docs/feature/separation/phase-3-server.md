# Phase 3: Backend Restructure

**Depends on:** Phase 1 (packages/protocol)
**Can run in parallel with:** Phase 2

## Objective

Restructure `src/process/` into `src/server/` — a clean standalone backend that:

1. Implements the wire protocol from Phase 1 (request/response with `id`)
2. Has a clear `WsRouter` that replaces the bridge handler pattern
3. Is fully independent of Electron (no electron imports)
4. Can be built and deployed as a standalone Node.js server

## Current State

```
src/process/                    # Mixed: business logic + Electron coupling
├── index.ts                    # Process bootstrap (initializeProcess)
├── bridge/                     # 43 files — IPC bridge handlers
│   ├── index.ts                # initAllBridges() — wires 30+ modules
│   ├── conversationBridge.ts   # bridge.handle() registrations
│   ├── fsBridge.ts             # 54KB — large
│   └── ...
├── services/                   # Business logic (database, cron, etc.)
├── agent/                      # Agent management (acp, codex, gemini, etc.)
├── channels/                   # IM platform integrations
├── extensions/                 # Extension system
├── task/                       # Worker task management
├── webserver/                  # Express HTTP + WebSocket server
│   ├── adapter.ts              # WebSocket ↔ bridge adapter
│   └── websocket/              # WebSocketManager
├── worker/                     # Fork workers
├── resources/                  # Static resources
└── utils/                      # Utilities (some Electron-dependent)
```

**Problems:**

- `bridge/` files use `@office-ai/platform` bridge library to register handlers
- `src/process/utils/` has Electron-specific code mixed with pure Node.js utilities
- `webserver/adapter.ts` acts as glue between WebSocket and bridge emitter
- `src/index.ts` (Electron main) directly calls `initializeProcess()`

## Target State

```
src/server/                     # Pure Node.js backend — no Electron
├── index.ts                    # Server bootstrap
├── handlers/                   # WsRouter handlers (renamed from bridge/)
│   ├── index.ts                # registerAllHandlers()
│   ├── conversation.ts         # conversation endpoint handlers
│   ├── fs.ts                   # filesystem handlers
│   └── ...
├── router/                     # WebSocket message router
│   ├── WsRouter.ts             # name → handler dispatch
│   └── types.ts
├── http/                       # Express HTTP server
│   ├── index.ts                # server setup
│   ├── routes/                 # REST API routes
│   ├── middleware/              # auth, rate-limit, etc.
│   └── websocket/              # WebSocketManager
├── services/                   # Business logic (unchanged)
├── agent/                      # Agent management (unchanged)
├── channels/                   # IM integrations (unchanged)
├── extensions/                 # Extension system (unchanged)
├── task/                       # Worker management (unchanged)
├── worker/                     # Fork workers (unchanged)
├── resources/                  # Static resources (unchanged)
└── utils/                      # Pure Node.js utilities
```

## Key Changes

### 1. WsRouter — Replace Bridge Library

The bridge library (`@office-ai/platform`) does two things:

- **`bridge.handle(name, fn)`**: register a handler for a named endpoint
- **`bridge.emit(name, data)`**: push an event to all connected clients

Replace with a `WsRouter`:

```typescript
// src/server/router/WsRouter.ts
import type { EndpointMap, EventMap, WsRequest, WsResponse, WsEvent } from '@aionui/protocol'

type Handler<K extends keyof EndpointMap> = (
  data: EndpointMap[K]['request']
) => Promise<EndpointMap[K]['response']>

class WsRouter {
  private handlers = new Map<string, Handler<any>>()
  private broadcaster: ((message: string) => void) | null = null

  // Register a handler for an endpoint
  handle<K extends keyof EndpointMap>(name: K, handler: Handler<K>): void {
    this.handlers.set(name, handler)
  }

  // Dispatch incoming WebSocket message
  async dispatch(raw: string): Promise<string | null> {
    const msg = JSON.parse(raw)

    // New protocol: { type: 'request', id, name, data }
    if (msg.type === 'request') {
      const handler = this.handlers.get(msg.name)
      if (!handler) {
        return JSON.stringify({
          type: 'response', id: msg.id,
          error: `Unknown endpoint: ${msg.name}`
        })
      }
      try {
        const result = await handler(msg.data)
        return JSON.stringify({ type: 'response', id: msg.id, data: result })
      } catch (err) {
        return JSON.stringify({
          type: 'response', id: msg.id,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    // Legacy protocol: { name, data } — backward compat during transition
    if (msg.name && !msg.type) {
      const handler = this.handlers.get(msg.name)
      if (handler) {
        const result = await handler(msg.data)
        // Legacy doesn't expect a response message (bridge handles internally)
        return null
      }
    }

    return null
  }

  // Push event to all connected clients
  emit<K extends keyof EventMap>(name: K, data: EventMap[K]): void {
    if (this.broadcaster) {
      this.broadcaster(JSON.stringify({ type: 'event', name, data }))
    }
  }

  setBroadcaster(fn: (message: string) => void): void {
    this.broadcaster = fn
  }
}
```

### 2. Handler Migration — bridge.handle → router.handle

Each bridge file registers handlers using the bridge library. Convert to WsRouter:

```typescript
// Before (src/process/bridge/conversationBridge.ts)
import { bridge } from '@office-ai/platform'

export function initConversationBridge(service: IConversationService) {
  bridge.handle('create-conversation', async (data) => {
    return service.create(data)
  })
  bridge.handle('get-conversation', async (data) => {
    return service.get(data.id)
  })
  // ... 15 more handlers
}

// After (src/server/handlers/conversation.ts)
import type { WsRouter } from '../router/WsRouter'

export function registerConversationHandlers(
  router: WsRouter,
  service: IConversationService
) {
  router.handle('create-conversation', async (data) => {
    return service.create(data)
  })
  router.handle('get-conversation', async (data) => {
    return service.get(data.id)
  })
  // ... 15 more handlers (logic unchanged)
}
```

**The handler logic stays exactly the same.** Only the registration mechanism changes.

### 3. Event Emission — bridge.emit → router.emit

Currently bridge modules push events to clients via:

```typescript
// Before
import { bridge } from '@office-ai/platform'
bridge.emit('chat.response.stream', responseData)

// After
import { router } from '../router'
router.emit('chat.response.stream', responseData)
```

The `router` instance is passed as a dependency or accessed via a singleton.

### 4. Electron Code Isolation

Move all Electron-specific code out of `src/server/`:

| File | Contains | Action |
|---|---|---|
| `utils/configureChromium.ts` | Electron app flags | → `src/electron/` |
| `bridge/dialogBridge.ts` | `electron.dialog` | → `src/electron/` or skip in standalone |
| `bridge/windowControlsBridge.ts` | `BrowserWindow` ops | → `src/electron/` |
| `bridge/updateBridge.ts` | `electron-updater` | → `src/electron/` |
| `bridge/shellBridge.ts` | `electron.shell` (partial) | Keep standalone variant, move Electron part |

**Rule:** `src/server/` must have zero `electron` imports. Verify with:

```bash
grep -r "from 'electron'" src/server/  # must return nothing
grep -r "require('electron')" src/server/  # must return nothing
```

### 5. Server Entry Point

Simplify `src/server.ts` (current standalone entry):

```typescript
// src/server/index.ts
import { WsRouter } from './router/WsRouter'
import { createHttpServer } from './http'
import { registerAllHandlers } from './handlers'
import { initServices } from './services'

export async function startServer(options: {
  port: number
  allowRemote?: boolean
}): Promise<void> {
  // 1. Initialize services (database, extensions, channels)
  const services = await initServices()

  // 2. Create router and register all handlers
  const router = new WsRouter()
  registerAllHandlers(router, services)

  // 3. Start HTTP + WebSocket server
  const { server, wss } = await createHttpServer({
    port: options.port,
    allowRemote: options.allowRemote,
    router,
  })

  // 4. Wire WebSocket to router
  router.setBroadcaster((msg) => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg)
    })
  })
}
```

## Implementation Steps

### Step 1: Create src/server/ directory

```bash
mkdir -p src/server/{router,handlers,http}
```

### Step 2: Implement WsRouter

Create `src/server/router/WsRouter.ts` and `src/server/router/types.ts`.

### Step 3: Migrate handlers (domain by domain)

For each of the 43 bridge files, create a corresponding handler file:

| Bridge file | → Handler file | Endpoints |
|---|---|---|
| `conversationBridge.ts` | `handlers/conversation.ts` | 15 providers + 4 emitters |
| `acpConversationBridge.ts` | `handlers/acpConversation.ts` | 12 providers |
| `fsBridge.ts` (54KB!) | `handlers/fs.ts` (split if needed) | 20+ providers |
| `modelBridge.ts` (46KB!) | `handlers/model.ts` (split if needed) | 4 providers |
| `channelBridge.ts` | `handlers/channel.ts` | 8 providers + 3 emitters |
| `extensionsBridge.ts` | `handlers/extensions.ts` | 12 providers + 1 emitter |
| `webuiBridge.ts` | `handlers/webui.ts` | 6 providers + 2 emitters |
| `cronBridge.ts` | `handlers/cron.ts` | 5 providers + 4 emitters |
| `databaseBridge.ts` | `handlers/database.ts` | 3 providers |
| `authBridge.ts` | `handlers/auth.ts` | 3 providers |
| Other bridges (~20) | `handlers/*.ts` | Various |

**Migration order:** Start with small, simple bridges (cronBridge, databaseBridge) to establish the pattern, then tackle large ones (fsBridge, modelBridge).

For the large files (fsBridge 54KB, modelBridge 46KB), consider splitting:

```
handlers/fs/
├── index.ts           # registerFsHandlers()
├── fileOps.ts         # read, write, copy, remove
├── skillOps.ts        # skill CRUD operations
└── assistantOps.ts    # assistant rule/skill operations
```

### Step 4: Move services, agents, channels, etc.

```bash
# These directories move as-is (internal structure unchanged)
mv src/process/services  src/server/services
mv src/process/agent     src/server/agent
mv src/process/channels  src/server/channels
mv src/process/extensions src/server/extensions
mv src/process/task      src/server/task
mv src/process/worker    src/server/worker
mv src/process/resources src/server/resources
```

Update all internal import paths (`@process/` → `@server/`).

### Step 5: Restructure HTTP server

```bash
mv src/process/webserver/routes     src/server/http/routes
mv src/process/webserver/middleware src/server/http/middleware
mv src/process/webserver/auth       src/server/http/auth
mv src/process/webserver/websocket  src/server/http/websocket
```

Remove `webserver/adapter.ts` — its role is replaced by `WsRouter`.

### Step 6: Isolate Electron code

Create `src/electron/` and move Electron-specific bridge handlers:

```
src/electron/
├── main.ts               # BrowserWindow, app lifecycle (from src/index.ts)
├── preload.ts            # contextBridge (from src/preload.ts)
├── handlers/             # Electron-only handlers
│   ├── dialog.ts         # native file dialog
│   ├── windowControls.ts # minimize/maximize/close
│   ├── update.ts         # electron-updater
│   └── shell.ts          # electron.shell.openExternal
└── utils/
    ├── tray.ts
    ├── appMenu.ts
    ├── deepLink.ts
    └── zoom.ts
```

### Step 7: Update path aliases

In `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@server/*": ["./src/server/*"],
      "@electron/*": ["./src/electron/*"],
      "@aionui/protocol": ["./packages/protocol/src"],
      "@aionui/protocol/*": ["./packages/protocol/src/*"]
    }
  }
}
```

Remove `@process/*` alias after migration is complete.

### Step 8: Update build config

In `electron.vite.config.ts` (or equivalent):

- Main process entry: `src/electron/main.ts`
- Preload entry: `src/electron/preload.ts`
- Server entry: `src/server/index.ts`
- Renderer entry: `src/renderer/main.tsx`

### Step 9: Verify

```bash
# No electron imports in server
grep -r "from 'electron'" src/server/   # must return nothing

# No bridge library in server (except during transition)
grep -r "@office-ai/platform" src/server/   # should be zero when done

# Build and test
bunx tsc --noEmit
bun run test
```

## Acceptance Criteria

- [ ] `src/server/` directory structure established
- [ ] `WsRouter` implemented with type-safe dispatch
- [ ] All 43 bridge files converted to handler files using `WsRouter`
- [ ] `WsRouter` supports both new protocol (`{ type, id, name, data }`) and legacy format
- [ ] `src/server/` has zero `electron` imports
- [ ] `src/electron/` contains all Electron-specific code
- [ ] `src/process/` no longer exists (fully migrated)
- [ ] Path aliases updated (`@server/*`, `@electron/*`)
- [ ] Standalone server (`bun run server`) works
- [ ] Build passes, tests pass

## Notes

- **Handler logic is unchanged** — this phase is about restructuring, not rewriting business logic
- Large bridge files (fsBridge 54KB, modelBridge 46KB) should be split during migration — good opportunity to improve code organization
- The `@office-ai/platform` bridge library can be removed from the server once all handlers are migrated to `WsRouter`
- `src/common/` will still exist for adapter runtime code needed by the Electron main process during transition; it can be fully removed after Phase 4
