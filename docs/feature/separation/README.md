# Frontend-Backend Separation

## Goal

Split AionUi into an independent frontend and backend with a language-agnostic communication protocol, laying the foundation for a future Rust backend migration.

**Current state:**

- Electron app where renderer (React) and main process (Node.js) communicate via `@office-ai/platform` bridge library
- `src/server.ts` already runs as a standalone Node.js server (no Electron)
- `src/common/adapter/browser.ts` already uses WebSocket to talk to the backend
- ~200 bridge endpoints (Provider + Emitter) defined in `src/common/adapter/ipcBridge.ts`

**Target state:**

- Frontend: pure React SPA, communicates via standard WebSocket + HTTP
- Backend (`src/server/`): Node.js service, exposes standard WebSocket + REST APIs
- Electron: thin shell that spawns the backend process and opens a BrowserWindow
- `@office-ai/platform` bridge library: no longer used by frontend
- Same protocol works for Web mode, Electron desktop, and future Rust backend

## Architecture

```
┌─────────────────────────────────────────────────┐
│              packages/protocol                   │
│  - Wire protocol spec (JSON over WebSocket)     │
│  - TypeScript types (shared by frontend & Node)  │
│  - REST endpoint definitions                     │
└─────────────────┬───────────────────────────────┘
                  │
       ┌──────────┼──────────┐
       ▼                     ▼
┌─────────────┐       ┌──────────────┐
│ src/renderer │       │ src/server   │
│ (Frontend)   │       │ (Backend)    │
│              │       │              │
│ ApiClient ───┼─WS/HTTP─┤ WsRouter    │
│              │       │ REST routes  │
└─────────────┘       └──────────────┘
                           │
                    ┌──────┴──────┐
                    │ src/electron │
                    │ (Thin shell) │
                    └─────────────┘
```

All three deployment modes use the same protocol:

| Mode | Frontend | Backend | Transport |
|------|----------|---------|-----------|
| Electron desktop | BrowserWindow | Local process (spawned by Electron) | ws://localhost:PORT |
| Web (self-hosted) | Browser | Remote server | wss://host:PORT |
| Development | Browser (Vite dev) | Local dev server | ws://localhost:PORT |

## Coupling Analysis (Current)

| Dependency | Count | Files | Impact |
|---|---|---|---|
| renderer → `@/common/adapter/ipcBridge` | 46 imports | 46 files | API contract — replace with protocol types |
| renderer → `@/common/*` (types, config, utils) | 280 imports | 183 files | Shared types — move to `packages/protocol` |
| renderer → `@process/*` | 8 imports | 7 files | Channel types only — move to protocol |
| renderer → `window.electronAPI` | 25 uses | 9 files | Abstract behind `PlatformAdapter` |
| Bridge endpoints (Provider) | 200 | — | Convert to WS request/response |
| Bridge endpoints (Emitter) | 33 | — | Convert to WS server-push events |

## Implementation Phases

Each phase is designed to be completed in a single session.

| Phase | Document | Description | Dependency |
|---|---|---|---|
| 1 | [phase-1-protocol.md](phase-1-protocol.md) | Create `packages/protocol` — wire protocol + shared types | None |
| 2 | [phase-2-api-client.md](phase-2-api-client.md) | Frontend ApiClient — replace bridge library calls | Phase 1 |
| 3 | [phase-3-server.md](phase-3-server.md) | Backend restructure — `src/process` → `src/server` | Phase 1 |
| 4 | [phase-4-electron.md](phase-4-electron.md) | Electron shell refactor — thin launcher | Phase 2 + 3 |

Phase 2 and Phase 3 can be worked on **in parallel** after Phase 1 is complete.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo structure | Monorepo (no split) | Same team, Electron needs both |
| Backend name | `server` (not app/backend) | Clear, maps to `src/server.ts` |
| Communication | WebSocket + HTTP (no IPC) | Language-agnostic, Rust-compatible |
| Electron comm | Also WebSocket (localhost) | Unified with Web mode; Rust backend can't use IPC |
| Protocol format | JSON `{ type, id, name, data }` | Compatible with current wire format, adds request ID |
| bridge library | Phase out from frontend first | Backend keeps it during transition, drops when moving to Rust |
| Shared types | `packages/protocol` npm workspace | Both frontend and backend import from here |

## Out of Scope

- Rust backend implementation (separate future effort)
- Extension system redesign
- Database migration
- New features or API additions
