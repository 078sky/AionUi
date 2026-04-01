# Phase 2b: Bridge Consumer Migration

**Depends on:** Phase 2a (ApiClient core)
**Parent doc:** [phase-2-api-client.md](phase-2-api-client.md) Step 2-3
**Branch:** `zynx/feat/frontend-backend-separation`

## Context

Phase 2a created `ApiClient` with `request()` and `on()` methods.
This session replaces all direct bridge calls in the renderer with ApiClient calls.

## Scope

### Part 1: Replace `window.electronAPI` (9 files, 25 uses)

| File                          | Uses | Migration                              |
| ----------------------------- | ---- | -------------------------------------- |
| `WebuiModalContent.tsx`       | 12   | `api.request('webui.*', ...)`          |
| `WeixinConfigForm.tsx`        | 5    | `api.request(...)` + `api.on(...)`     |
| `useWorkspaceDragImport.ts`   | 2    | `platformAdapter.getPathForFile()`     |
| `AuthContext.tsx`              | 1    | `platformAdapter.isElectron()`         |
| `platform.ts`                 | 1    | `platformAdapter.isElectron()`         |
| `main.tsx`                    | 1    | Platform detection                     |
| `ConversationSearchPopover`   | 1    | `platformAdapter.getPathForFile()`     |
| `useMinimapPanel.ts`          | 1    | `platformAdapter.getPathForFile()`     |
| `HTMLRenderer.tsx`            | 1    | `platformAdapter.isElectron()`         |

### Part 2: Replace ipcBridge imports (46 files)

Migrate by domain, in this order:

| Domain            | Files | Endpoints                 | Priority |
| ----------------- | ----- | ------------------------- | -------- |
| `conversation`    | 12    | 15 providers + 4 emitters | High     |
| `acpConversation` | 8     | 12 providers              | High     |
| `fs`              | 10    | 20+ providers             | Medium   |
| `extensions`      | 4     | 12 providers + 1 emitter  | Medium   |
| `channel`         | 4     | 8 providers + 3 emitters  | Medium   |
| `cron`            | 3     | 5 providers + 4 emitters  | Low      |
| `mode`            | 3     | 4 providers               | Low      |
| `webui`           | 2     | 6 providers + 2 emitters  | Low      |
| Others            | 10    | various                   | Low      |

**Pattern:**

```typescript
// Before
import { conversation } from '@/common/adapter/ipcBridge';
const result = await conversation.get({ id });

// After
import { useApi } from '@renderer/api';
const api = useApi();
const result = await api.request('get-conversation', { id });
```

## Implementation Steps

1. Migrate `window.electronAPI` usages (9 files)
2. Migrate `conversation` domain (12 files)
3. Migrate `acpConversation` domain (8 files)
4. Migrate `fs` domain (10 files)
5. Migrate `extensions` + `channel` domains (8 files)
6. Migrate remaining domains (8 files)
7. Verify: `grep -r "from.*common/adapter" src/renderer/` — should return nothing
8. Verify: `grep -r "electronAPI" src/renderer/` — should only be in platformAdapter
9. `bunx tsc --noEmit` + `bun run test`
10. Commit per domain batch

## Acceptance Criteria

- [ ] All 46 files migrated from ipcBridge to ApiClient
- [ ] All 9 files migrated from window.electronAPI to platformAdapter + ApiClient
- [ ] `grep -r "from.*common/adapter" src/renderer/` returns nothing
- [ ] `grep -r "electronAPI" src/renderer/` only in platformAdapter.ts
- [ ] Build passes, tests pass
