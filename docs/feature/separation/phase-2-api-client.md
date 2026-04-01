# Phase 2: Frontend ApiClient

**Depends on:** Phase 1 (packages/protocol)

## Objective

Replace all `@office-ai/platform` bridge library usage in the frontend with a thin `ApiClient` that speaks the standard WebSocket + HTTP protocol defined in Phase 1.

After this phase:

- Frontend has **zero dependency** on `@office-ai/platform`
- Frontend communicates with backend via `ApiClient` using standard JSON WebSocket
- Same code works in Electron desktop and Web browser — no `window.electronAPI` branching
- All 46 files importing `ipcBridge` are migrated

## ApiClient Design

### Core Client

```
src/renderer/api/
├── client.ts              # ApiClient class (WebSocket + HTTP)
├── types.ts               # Client-specific types (re-exports from @aionui/protocol)
├── hooks.ts               # useApiClient() React hook
└── index.ts               # re-exports
```

The `ApiClient` wraps the wire protocol:

```typescript
// src/renderer/api/client.ts
import type { EndpointMap, EventMap, WsRequest, WsResponse, WsEvent } from '@aionui/protocol'

class ApiClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, { resolve: Function; reject: Function; timer: number }>()
  private listeners = new Map<string, Set<Function>>()
  private messageQueue: WsRequest[] = []
  private reconnectDelay = 500

  constructor(private serverUrl: string) {}

  // === Provider (request/response) ===

  async request<K extends keyof EndpointMap>(
    name: K,
    data: EndpointMap[K]['request']
  ): Promise<EndpointMap[K]['response']> {
    const id = crypto.randomUUID()
    const message: WsRequest = { type: 'request', id, name, data }
    this.send(message)
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timeout: ${name}`))
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  // === Emitter (subscribe to server push) ===

  on<K extends keyof EventMap>(
    name: K,
    callback: (data: EventMap[K]) => void
  ): () => void {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set())
    }
    this.listeners.get(name)!.add(callback)
    return () => this.listeners.get(name)?.delete(callback)
  }

  // === Connection management ===

  connect(): void { /* WebSocket connect with reconnect logic */ }
  disconnect(): void { /* clean close */ }

  private send(message: WsRequest): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      this.messageQueue.push(message)
    }
  }

  private handleMessage(raw: string): void {
    const msg = JSON.parse(raw)
    if (msg.type === 'response') {
      const pending = this.pending.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(new Error(msg.error))
        else pending.resolve(msg.data)
      }
    } else if (msg.type === 'event') {
      this.listeners.get(msg.name)?.forEach(cb => cb(msg.data))
    }
  }
}
```

### React Integration

```typescript
// src/renderer/api/hooks.ts
import { createContext, useContext } from 'react'

const ApiClientContext = createContext<ApiClient | null>(null)

export const ApiClientProvider = ApiClientContext.Provider

export function useApi() {
  const client = useContext(ApiClientContext)
  if (!client) throw new Error('ApiClient not initialized')
  return client
}
```

Usage in `main.tsx`:

```typescript
const serverUrl = window.electronConfig?.serverUrl
  ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`

const client = new ApiClient(serverUrl)
client.connect()

root.render(
  <ApiClientProvider value={client}>
    <App />
  </ApiClientProvider>
)
```

### Connection Features

The ApiClient must replicate existing `browser.ts` behavior:

- **Message queue:** Buffer messages while WebSocket is connecting
- **Reconnection:** Exponential backoff (500ms → 8s max), same as current
- **Heartbeat:** Respond to server `ping` with `pong`
- **Auth expiration:** Handle `auth-expired` event, redirect to `/login`
- **Auth failure:** Handle close code 1008, redirect to `/login`

## Migration Plan

### Step 1: Create ApiClient

Create `src/renderer/api/` with the client, hooks, and provider setup.

### Step 2: Replace `window.electronAPI` (9 files, 25 uses)

Current direct Electron IPC calls bypass the bridge library:

| File | Usage | Migration |
|---|---|---|
| `WebuiModalContent.tsx` (12 uses) | `webuiResetPassword`, `webuiGetStatus`, `webuiChangePassword`, `webuiChangeUsername`, `webuiGenerateQRToken` | Replace with `api.request('webui.reset-password', ...)` etc. |
| `WeixinConfigForm.tsx` (5 uses) | `weixinLoginStart`, `weixinLoginOnQR`, `weixinLoginOnScanned`, `weixinLoginOnDone` | Replace with `api.request('weixin:login:start')` + `api.on(...)` |
| `useWorkspaceDragImport.ts` (2 uses) | `getPathForFile` | Not available in Web — provide fallback |
| `AuthContext.tsx` (1 use) | `electronAPI` existence check | Replace with `window.electronConfig` check |
| `platform.ts` (1 use) | `electronAPI` existence check | Replace with `window.electronConfig` check |
| `main.tsx` (1 use) | `electronAPI` existence check | Replace with platform detection |
| `ConversationSearchPopover.tsx` (1 use) | `getPathForFile` | Not available in Web — provide fallback |
| `useMinimapPanel.ts` (1 use) | `getPathForFile` | Not available in Web — provide fallback |
| `HTMLRenderer.tsx` (1 use) | Platform detection | Replace with `window.electronConfig` check |

For `getPathForFile` (drag-and-drop file path): This is an Electron-only API. Create a platform adapter:

```typescript
// src/renderer/utils/platformAdapter.ts
export const platformAdapter = {
  getPathForFile(file: File): string | null {
    // Electron: use preload API
    if (window.electronConfig?.getPathForFile) {
      return window.electronConfig.getPathForFile(file)
    }
    // Web: not available (use upload endpoint instead)
    return null
  },
  isElectron(): boolean {
    return !!window.electronConfig
  }
}
```

### Step 3: Replace ipcBridge imports (46 files)

Each file currently imports from `@/common/adapter/ipcBridge` and calls bridge methods directly:

```typescript
// Before
import { conversation, fs, acpConversation } from '@/common/adapter/ipcBridge'
const result = await conversation.get({ id: conversationId })

// After
import { useApi } from '@renderer/api'
const api = useApi()
const result = await api.request('get-conversation', { id: conversationId })
```

**Migration strategy by domain:**

| Domain | Files | Endpoint count | Priority |
|---|---|---|---|
| `conversation` | 12 | 15 providers + 4 emitters | High (core feature) |
| `acpConversation` | 8 | 12 providers | High |
| `fs` | 10 | 20+ providers | Medium |
| `extensions` | 4 | 12 providers + 1 emitter | Medium |
| `channel` | 4 | 8 providers + 3 emitters | Medium |
| `cron` | 3 | 5 providers + 4 emitters | Low |
| `mode` | 3 | 4 providers | Low |
| `webui` | 2 | 6 providers + 2 emitters | Low |
| Others | 10 | various | Low |

Migrate domain by domain, starting with `conversation` (most impactful).

### Step 4: Replace `@/common/*` imports (183 files, 280 imports)

These are type imports. After Phase 1 moved types to `@aionui/protocol`, bulk-replace:

```typescript
// Before
import type { TChatConversation } from '@/common/config/storage'
import type { AcpBackend } from '@/common/types/acpTypes'
import type { TMessage } from '@/common/chat/chatLib'

// After
import type { TChatConversation } from '@aionui/protocol/config'
import type { AcpBackend } from '@aionui/protocol/types'
import type { TMessage } from '@aionui/protocol/chat'
```

This is largely mechanical — a codemod or find-and-replace.

### Step 5: Remove `@/common/adapter/browser.ts` dependency

After all bridge calls are replaced with ApiClient, the renderer no longer needs:

- `src/common/adapter/browser.ts` (WebSocket bridge adapter)
- `@office-ai/platform` dependency in renderer build

### Step 6: Verify

```bash
# Ensure no remaining bridge imports in renderer
grep -r "from.*common/adapter" src/renderer/  # should return nothing
grep -r "electronAPI" src/renderer/            # should only be in platformAdapter.ts
grep -r "@office-ai/platform" src/renderer/    # should return nothing

bunx tsc --noEmit
bun run test
```

## Acceptance Criteria

- [ ] `src/renderer/api/` exists with `ApiClient`, `useApi()` hook, `ApiClientProvider`
- [ ] `ApiClient` supports: request/response, event subscription, reconnection, heartbeat, auth expiration
- [ ] All 46 files migrated from `ipcBridge` imports to `ApiClient`
- [ ] All 9 files migrated from `window.electronAPI` to `platformAdapter` + `ApiClient`
- [ ] All 183 files migrated from `@/common/*` types to `@aionui/protocol/*`
- [ ] `@/common/adapter/browser.ts` is no longer imported by renderer
- [ ] `@office-ai/platform` is not in renderer's dependency tree
- [ ] Build passes, tests pass
- [ ] Electron desktop mode works (connects via WebSocket to local backend)
- [ ] Web mode works (connects via WebSocket to remote backend)

## Notes

- The `ApiClient` is intentionally simple (~100-150 lines). All the complexity of the current `browser.ts` (reconnect, queue, heartbeat, auth) is preserved but cleaner.
- Type safety is ensured by the `EndpointMap` and `EventMap` from `@aionui/protocol` — typos in endpoint names are compile-time errors.
- During the transition, the backend still accepts both old format (`{ name, data }`) and new format (`{ type, id, name, data }`), so frontend migration can happen incrementally.
