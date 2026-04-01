# Phase 3b: Large Bridge Migration

**Depends on:** Phase 3a (WsRouter + small bridges)
**Parent doc:** [phase-3-server.md](phase-3-server.md) Step 3 (large bridges)
**Branch:** `zynx/feat/frontend-backend-separation`

## Context

Phase 3a established the WsRouter and migration pattern with small bridges.
This session migrates the large, complex bridge files.

## Scope

| Bridge file                  | Size  | -> Handler                          | Endpoints                 |
| ---------------------------- | ----- | ----------------------------------- | ------------------------- |
| `conversationBridge.ts`      | ~med  | `handlers/conversation.ts`          | 15 providers + 4 emitters |
| `acpConversationBridge.ts`   | ~med  | `handlers/acpConversation.ts`       | 12 providers              |
| `fsBridge.ts`                | 54KB  | `handlers/fs/` (split)              | 20+ providers             |
| `modelBridge.ts`             | 46KB  | `handlers/model/` (split)           | 4 providers               |
| `channelBridge.ts`           | ~med  | `handlers/channel.ts`               | 8 providers + 3 emitters  |
| `extensionsBridge.ts`        | ~med  | `handlers/extensions.ts`            | 12 providers + 1 emitter  |
| `webuiBridge.ts`             | ~med  | `handlers/webui.ts`                 | 6 providers + 2 emitters  |
| Other remaining bridges      | ~sml  | `handlers/*.ts`                     | various                   |

### Large file split strategy

**fsBridge.ts (54KB) -> `handlers/fs/`:**

```
handlers/fs/
├── index.ts           # registerFsHandlers() — delegates to sub-modules
├── fileOps.ts         # read, write, copy, remove, zip, metadata
├── skillOps.ts        # skill CRUD (read/write/delete skill files)
└── assistantOps.ts    # assistant rule/skill operations
```

**modelBridge.ts (46KB) -> `handlers/model/`:**

```
handlers/model/
├── index.ts           # registerModelHandlers()
├── providers.ts       # provider CRUD, model listing
├── mcpServers.ts      # MCP server management
└── config.ts          # config storage operations
```

## Implementation Steps

1. Migrate conversationBridge (15p + 4e) — straightforward, keep as single file
2. Migrate acpConversationBridge (12p) — straightforward
3. Split and migrate fsBridge (54KB -> fs/ directory with 3-4 sub-modules)
4. Split and migrate modelBridge (46KB -> model/ directory with 3 sub-modules)
5. Migrate channelBridge, extensionsBridge, webuiBridge
6. Migrate any remaining bridge files
7. Update `handlers/index.ts` to register all new handlers
8. Verify: `bunx tsc --noEmit` + `bun run test`
9. Commit per domain

## Acceptance Criteria

- [ ] All 43 bridge files converted to handler files using WsRouter
- [ ] fsBridge (54KB) split into `handlers/fs/` with clear sub-modules
- [ ] modelBridge (46KB) split into `handlers/model/` with clear sub-modules
- [ ] `handlers/index.ts` registers all handlers
- [ ] Handler logic unchanged — only registration mechanism changed
- [ ] Build passes, tests pass
