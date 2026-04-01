# Phase 1: Create `packages/protocol`

## Objective

Extract a language-agnostic protocol package from `src/common/` that defines:

1. Wire protocol specification (JSON over WebSocket)
2. All TypeScript types shared between frontend and backend
3. REST endpoint definitions

This package has **zero runtime dependencies** — it only contains types, constants, and the protocol spec.

## Wire Protocol

### WebSocket Messages

Three message types, all JSON-encoded:

```typescript
// Client → Server: request (replaces bridge.buildProvider)
type WsRequest = {
  type: 'request'
  id: string         // UUID, correlates with response
  name: string       // endpoint name, e.g. "chat.send.message"
  data: unknown      // request payload
}

// Server → Client: response to a request
type WsResponse = {
  type: 'response'
  id: string         // matches the request id
  data: unknown      // response payload
  error?: string     // error message if request failed
}

// Server → Client: push event (replaces bridge.buildEmitter)
type WsEvent = {
  type: 'event'
  name: string       // event name, e.g. "chat.response.stream"
  data: unknown      // event payload
}

// Heartbeat (keep existing behavior)
// Server sends: { name: 'ping' }
// Client replies: { name: 'pong', data: { timestamp } }
```

**Backward compatibility:** The existing wire format is `{ name, data }` without `type` or `id`. During the transition, the backend should handle both old and new formats:

- If message has `type: 'request'` → new protocol, respond with `{ type: 'response', id }`
- If message has no `type` → legacy format, handle as before (bridge library behavior)

### REST Endpoints

Stateless operations use HTTP (already partially implemented in `src/process/webserver/routes/`):

```
# Auth (existing)
POST   /api/auth/login
POST   /api/auth/refresh

# File operations (existing)
POST   /api/upload
GET    /api/directory/*

# Future REST candidates (currently WS-only):
GET    /api/conversations
GET    /api/conversations/:id
DELETE /api/conversations/:id
GET    /api/agents
GET    /api/models
GET    /api/extensions
GET    /api/cron/jobs
```

REST migration is optional and incremental — WebSocket handles everything during the transition.

## Package Structure

```
packages/protocol/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # re-exports everything
│   ├── wire.ts                  # WsRequest, WsResponse, WsEvent types
│   ├── endpoints/               # endpoint definitions by domain
│   │   ├── index.ts
│   │   ├── conversation.ts      # conversation endpoint types
│   │   ├── application.ts       # application endpoint types
│   │   ├── fs.ts                # filesystem endpoint types
│   │   ├── auth.ts              # auth endpoint types
│   │   ├── model.ts             # model/provider endpoint types
│   │   ├── agent.ts             # ACP/Gemini/Codex agent types
│   │   ├── channel.ts           # channel/IM platform types
│   │   ├── extensions.ts        # extension system types
│   │   ├── cron.ts              # cron job types
│   │   ├── database.ts          # database query types
│   │   ├── webui.ts             # WebUI management types
│   │   ├── mcp.ts               # MCP service types
│   │   ├── update.ts            # update/auto-update types
│   │   ├── preview.ts           # preview/document types
│   │   ├── window.ts            # window controls types
│   │   ├── settings.ts          # system settings types
│   │   └── notification.ts      # notification types
│   ├── types/                   # shared domain types (from src/common/types/)
│   │   ├── index.ts
│   │   ├── acpTypes.ts
│   │   ├── conversion.ts
│   │   ├── database.ts
│   │   ├── fileSnapshot.ts
│   │   ├── preview.ts
│   │   └── speech.ts
│   ├── chat/                    # chat types (from src/common/chat/)
│   │   ├── chatLib.ts           # TMessage, IConfirmation, etc.
│   │   └── slash/
│   │       └── types.ts
│   └── config/                  # shared config types (from src/common/config/)
│       ├── storage.ts           # TChatConversation, IProvider, IMcpServer, etc.
│       └── i18n-config.json
```

## Implementation Steps

### Step 1: Create workspace package

```bash
# In project root
mkdir -p packages/protocol/src
```

Create `packages/protocol/package.json`:

```json
{
  "name": "@aionui/protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*/index.ts"
  }
}
```

Update root `package.json` to add workspace:

```json
{
  "workspaces": ["packages/*"]
}
```

### Step 2: Define wire protocol types

Create `packages/protocol/src/wire.ts` with the message types above.

### Step 3: Extract endpoint types from ipcBridge.ts

The current `src/common/adapter/ipcBridge.ts` (1164 lines) mixes:

- Type definitions (pure types — move to protocol)
- `bridge.buildProvider()` / `bridge.buildEmitter()` calls (runtime — keep in backend)

For each domain namespace in ipcBridge.ts, extract:

| ipcBridge namespace | → protocol file | Types to extract |
|---|---|---|
| `conversation` | `endpoints/conversation.ts` | ISendMessageParams, ICreateConversationParams, IResponseMessage, IConversationTurnCompletedEvent, etc. |
| `application` | `endpoints/application.ts` | ICdpStatus, ICdpConfig |
| `fs` | `endpoints/fs.ts` | IDirOrFile, IFileMetadata |
| `dialog` | `endpoints/fs.ts` | (merged with fs) |
| `mode` | `endpoints/model.ts` | (model/provider types) |
| `acpConversation` | `endpoints/agent.ts` | AcpBackend, AcpModelInfo related |
| `channel` | `endpoints/channel.ts` | IChannelPairingRequest, IChannelSession, etc. |
| `extensions` | `endpoints/extensions.ts` | IExtensionInfo, IExtensionPermissionSummary, etc. |
| `cron` | `endpoints/cron.ts` | ICronJob, ICronSchedule, ICreateCronJobParams |
| `webui` | `endpoints/webui.ts` | IWebUIStatus |
| `mcpService` | `endpoints/mcp.ts` | (MCP types) |
| `update`, `autoUpdate` | `endpoints/update.ts` | (update types — already in src/common/update/) |
| `preview`, `document`, `pptPreview`, `wordPreview`, `excelPreview` | `endpoints/preview.ts` | PreviewContentType, etc. |
| `windowControls` | `endpoints/window.ts` | (simple void types) |
| `systemSettings` | `endpoints/settings.ts` | (simple types) |
| `notification` | `endpoints/notification.ts` | INotificationOptions |
| `database` | `endpoints/database.ts` | (message search types) |

Additionally, define an **endpoint registry** — a type-safe map of endpoint names to request/response types:

```typescript
// packages/protocol/src/endpoints/registry.ts
export type EndpointMap = {
  'chat.send.message': { request: ISendMessageParams; response: IBridgeResponse }
  'create-conversation': { request: ICreateConversationParams; response: TChatConversation }
  'get-conversation': { request: { id: string }; response: TChatConversation }
  // ... all 200 endpoints
}

export type EventMap = {
  'chat.response.stream': IResponseMessage
  'conversation.turn.completed': IConversationTurnCompletedEvent
  'conversation.list-changed': IConversationListChangedEvent
  // ... all 33 events
}
```

This registry enables type-safe ApiClient on the frontend.

### Step 4: Move shared types

Move these files from `src/common/` to `packages/protocol/src/`:

| From | To |
|---|---|
| `src/common/types/acpTypes.ts` | `packages/protocol/src/types/acpTypes.ts` |
| `src/common/types/conversion.ts` | `packages/protocol/src/types/conversion.ts` |
| `src/common/types/database.ts` | `packages/protocol/src/types/database.ts` |
| `src/common/types/fileSnapshot.ts` | `packages/protocol/src/types/fileSnapshot.ts` |
| `src/common/types/preview.ts` | `packages/protocol/src/types/preview.ts` |
| `src/common/types/speech.ts` | `packages/protocol/src/types/speech.ts` |
| `src/common/chat/chatLib.ts` (types only) | `packages/protocol/src/chat/chatLib.ts` |
| `src/common/chat/slash/types.ts` | `packages/protocol/src/chat/slash/types.ts` |
| `src/common/config/storage.ts` (types only) | `packages/protocol/src/config/storage.ts` |
| `src/common/config/i18n-config.json` | `packages/protocol/src/config/i18n-config.json` |
| `src/common/update/updateTypes.ts` | `packages/protocol/src/types/update.ts` |
| `src/common/utils/protocolDetector.ts` (types only) | `packages/protocol/src/types/protocol.ts` |
| `src/process/channels/types.ts` (7 renderer imports) | `packages/protocol/src/types/channel.ts` |
| `src/process/agent/remote/types.ts` (renderer imports) | `packages/protocol/src/types/remoteAgent.ts` |

**Important:** Some of these files contain both types and runtime code. Only move the type definitions. Keep runtime code in place and have it import from `@aionui/protocol`.

### Step 5: Update imports

After moving types, update imports across the codebase:

```typescript
// Before
import type { TChatConversation } from '@/common/config/storage'
import type { AcpBackend } from '@/common/types/acpTypes'

// After
import type { TChatConversation } from '@aionui/protocol/config'
import type { AcpBackend } from '@aionui/protocol/types'
```

Configure path alias in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@aionui/protocol": ["./packages/protocol/src"],
      "@aionui/protocol/*": ["./packages/protocol/src/*"]
    }
  }
}
```

### Step 6: Verify build

```bash
bunx tsc --noEmit   # no type errors
bun run test         # tests pass
```

## Acceptance Criteria

- [ ] `packages/protocol/` exists as a workspace package
- [ ] Wire protocol types defined (`WsRequest`, `WsResponse`, `WsEvent`)
- [ ] All shared types moved from `src/common/` (no renderer → process imports remain)
- [ ] Endpoint registry (`EndpointMap`, `EventMap`) covers all 200+ Provider and 33 Emitter endpoints
- [ ] `src/common/adapter/ipcBridge.ts` only contains `bridge.buildProvider()` / `bridge.buildEmitter()` calls, importing types from `@aionui/protocol`
- [ ] All existing imports updated (renderer, process, common)
- [ ] Build passes (`bunx tsc --noEmit`)
- [ ] Tests pass (`bun run test`)

## Notes

- `@aionui/protocol` has no runtime dependencies — it's types + constants only
- The `IBridgeResponse<T>` pattern (`{ success, data?, msg? }`) is kept as-is — it's a good generic response wrapper
- `src/common/` will still exist after this phase but will be significantly thinner (only adapter runtime code, platform detection, and utilities with Node/DOM dependencies)
