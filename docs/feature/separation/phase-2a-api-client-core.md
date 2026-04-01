# Phase 2a: ApiClient Core

**Depends on:** Phase 1 (packages/protocol) — Done
**Parent doc:** [phase-2-api-client.md](phase-2-api-client.md) Step 1
**Branch:** `zynx/feat/frontend-backend-separation`

## Context

Phase 1 created `packages/protocol` with wire protocol types (`WsRequest`, `WsResponse`, `WsEvent`),
`EndpointMap` (200 endpoints), `EventMap` (33 events), and `IBridgeResponse<D>`.

This session creates the frontend `ApiClient` that speaks the wire protocol,
plus a `platformAdapter` for Electron-only APIs.

## Deliverables

### 1. Create `src/renderer/api/`

```
src/renderer/api/
├── client.ts       # ApiClient class (WebSocket + HTTP)
├── types.ts        # Client-specific types (re-exports from @aionui/protocol)
├── hooks.ts        # useApi() React hook + ApiClientProvider
└── index.ts        # re-exports
```

**ApiClient requirements:**

- `request<K>(name, data)` — type-safe request/response using `EndpointMap`
- `on<K>(name, callback)` — type-safe event subscription using `EventMap`
- `connect()` / `disconnect()` — WebSocket lifecycle
- Message queue: buffer messages while WebSocket is connecting
- Reconnection: exponential backoff (500ms -> 8s max)
- Heartbeat: respond to server `ping` with `pong`
- Auth expiration: handle `auth-expired` event, redirect to `/login`
- Auth failure: handle close code 1008, redirect to `/login`
- Timeout: 30s per request, reject with error

See [phase-2-api-client.md](phase-2-api-client.md) "ApiClient Design" section for full code reference.

### 2. Create `src/renderer/utils/platformAdapter.ts`

Encapsulate Electron-only APIs behind a platform-agnostic interface:

```typescript
export const platformAdapter = {
  getPathForFile(file: File): string | null { ... },
  isElectron(): boolean { ... },
};
```

### 3. Wire into React app

Update `src/renderer/main.tsx` (or equivalent entry point):

```typescript
const serverUrl = window.electronConfig?.serverUrl
  ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
const client = new ApiClient(serverUrl);
client.connect();

root.render(
  <ApiClientProvider value={client}>
    <App />
  </ApiClientProvider>
);
```

## Implementation Steps

1. Create `src/renderer/api/client.ts` — ApiClient class
2. Create `src/renderer/api/types.ts` — re-export protocol types
3. Create `src/renderer/api/hooks.ts` — useApi() + context
4. Create `src/renderer/api/index.ts` — barrel export
5. Create `src/renderer/utils/platformAdapter.ts`
6. Wire ApiClientProvider into app entry point
7. Verify: `bunx tsc --noEmit` + `bun run test`
8. Commit

## Acceptance Criteria

- [ ] `src/renderer/api/` exists with ApiClient, useApi(), ApiClientProvider
- [ ] ApiClient supports: request/response, event subscription, reconnection, heartbeat, auth
- [ ] `platformAdapter` handles `getPathForFile` and `isElectron()`
- [ ] ApiClientProvider wired into app entry
- [ ] Build passes, tests pass
- [ ] No existing behavior broken (ApiClient added alongside existing bridge, not replacing yet)
