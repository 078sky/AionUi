# Phase 2c: Type Import Migration + Cleanup

**Depends on:** Phase 2b (bridge migration)
**Parent doc:** [phase-2-api-client.md](phase-2-api-client.md) Step 4-6
**Branch:** `zynx/feat/frontend-backend-separation`

## Context

Phase 1 moved types to `@aionui/protocol` and created re-export shims in the original files.
Phase 2b replaced all runtime bridge calls with ApiClient.
This session completes the migration by updating all type import paths.

## Scope

### Part 1: Bulk-replace type imports (183 files, 280 imports)

```typescript
// Before
import type { TChatConversation } from '@/common/config/storage';
import type { AcpBackend } from '@/common/types/acpTypes';
import type { TMessage } from '@/common/chat/chatLib';

// After
import type { TChatConversation } from '@aionui/protocol/config';
import type { AcpBackend } from '@aionui/protocol/types';
import type { TMessage } from '@aionui/protocol/chat';
```

**Import path mapping:**

| Old path                            | New path                       |
| ----------------------------------- | ------------------------------ |
| `@/common/config/storage`           | `@aionui/protocol/config`     |
| `@/common/types/acpTypes`           | `@aionui/protocol/types`      |
| `@/common/types/preview`            | `@aionui/protocol/types`      |
| `@/common/types/speech`             | `@aionui/protocol/types`      |
| `@/common/types/fileSnapshot`       | `@aionui/protocol/types`      |
| `@/common/types/conversion`         | `@aionui/protocol/types`      |
| `@/common/types/database`           | `@aionui/protocol/types`      |
| `@/common/update/updateTypes`       | `@aionui/protocol/types`      |
| `@/common/chat/chatLib`             | `@aionui/protocol/chat`       |
| `@/common/chat/slash/types`         | `@aionui/protocol/chat`       |
| `@/common/adapter/ipcBridge` (type) | `@aionui/protocol/endpoints`  |
| `@process/channels/types`           | `@aionui/protocol/types`      |
| `@process/agent/remote/types`       | `@aionui/protocol/types`      |

This is largely mechanical — can use find-and-replace or a codemod script.

### Part 2: Remove browser.ts dependency

After all bridge calls and type imports are migrated, verify renderer no longer needs:

- `src/common/adapter/browser.ts` (WebSocket bridge adapter)
- `@office-ai/platform` dependency in renderer build

### Part 3: Clean up re-export shims

The Phase 1 re-export shims in original files (`src/common/types/*.ts`) can remain
as backward compat for any non-renderer consumers (process code). But verify they're
consistent with protocol package.

## Implementation Steps

1. Write or run codemod for `@/common/config/storage` -> `@aionui/protocol/config`
2. Write or run codemod for `@/common/types/*` -> `@aionui/protocol/types`
3. Write or run codemod for `@/common/chat/*` -> `@aionui/protocol/chat`
4. Write or run codemod for `@/common/adapter/ipcBridge` type imports -> `@aionui/protocol`
5. Write or run codemod for `@process/channels/types` -> `@aionui/protocol/types`
6. Verify: `grep -r "@/common/" src/renderer/` — type imports should be zero
7. Verify: `grep -r "@office-ai/platform" src/renderer/` — should return nothing
8. `bunx tsc --noEmit` + `bun run test`
9. Commit

## Acceptance Criteria

- [ ] All 183 files migrated from `@/common/*` types to `@aionui/protocol/*`
- [ ] `@/common/adapter/browser.ts` no longer imported by renderer
- [ ] `@office-ai/platform` not in renderer's dependency tree
- [ ] Build passes, tests pass
