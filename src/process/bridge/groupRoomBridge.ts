/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'os';
import { groupRoom } from '@/common/adapter/ipcBridge';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { IConversationService } from '@process/services/IConversationService';
import type { IAgentFactory } from '@process/task/IAgentFactory';
import { GroupRoomService } from '@process/services/groupRoom';
import { GroupRoomOrchestrator } from '@process/services/groupRoom/GroupRoomOrchestrator';

type GroupRoomRunHandle = {
  start: (input: string, userMsgId: string) => Promise<void>;
  teardown: () => Promise<void>;
};

const activeOrchestrators = new Map<string, GroupRoomRunHandle>();

/**
 * Initialize Group Room IPC Bridge.
 * Registers handlers for the 4 provider channels (create / get / sendMessage / stop).
 * The 3 emitter channels (responseStream / memberChanged / turnCompleted) are push-only
 * and do NOT need handler registration here — callers emit them directly when needed.
 */
export function initGroupRoomBridge(
  db: ISqliteDriver,
  conversationService: IConversationService,
  agentFactory: IAgentFactory
): void {
  const service = new GroupRoomService(db);

  // ==================== group-room.create ====================

  groupRoom.create.provider(async ({ name, desc, hostBackend, hostConversationId }) => {
    try {
      // When the caller does not supply a hostConversationId, automatically create a
      // new conversation so the host agent has a context to run in.
      let resolvedHostConversationId = hostConversationId;
      if (!resolvedHostConversationId) {
        // Parse hostBackend: supports 'backend' and 'backend:customAgentId' formats.
        // Examples: 'claude', 'gemini', 'custom:my-agent', 'remote:xxx'
        const [backendType, customAgentId] = hostBackend.includes(':')
          ? (hostBackend.split(':', 2) as [string, string])
          : ([hostBackend, undefined] as [string, undefined]);

        // Map backendType to an AgentType.
        const agentType =
          backendType === 'gemini'
            ? ('gemini' as const)
            : backendType === 'remote'
              ? ('remote' as const)
              : backendType === 'codex'
                ? ('codex' as const)
                : backendType === 'openclaw-gateway'
                  ? ('openclaw-gateway' as const)
                  : backendType === 'nanobot'
                    ? ('nanobot' as const)
                    : ('acp' as const);

        const conv = await conversationService.createConversation({
          type: agentType,
          name,
          // Gemini requires a model object; supply a minimal placeholder so the
          // factory can build the workspace without a real provider selection.
          model: {
            id: '',
            platform: agentType === 'gemini' ? ('gemini-with-google-auth' as const) : ('' as never),
            name: '',
            baseUrl: '',
            apiKey: '',
            useModel: 'default',
          },
          extra: {
            // acp-type agents: pass backendType as backend, plus customAgentId when present
            backend: agentType === 'acp' ? (backendType as never) : undefined,
            customAgentId: agentType === 'acp' ? customAgentId : undefined,
            // remote agents: customAgentId is stored as remoteAgentId
            remoteAgentId: agentType === 'remote' ? customAgentId : undefined,
          },
        });
        resolvedHostConversationId = conv.id;
      }

      // userId is fixed to the system default for now (single-user desktop app).
      // Will be updated when multi-user support lands.
      const room = service.createRoom({
        userId: 'system_default_user',
        name,
        description: desc,
        hostConversationId: resolvedHostConversationId,
      });

      // Back-patch the host conversation's extra with groupRoomId and workspace
      // so the renderer can navigate to /group-room/:id on click, and the
      // orchestrator can resolve the working directory.
      await conversationService.updateConversation(
        resolvedHostConversationId,
        {
          extra: {
            groupRoomId: room.id,
            workspace: os.homedir(),
          },
        } as never,
        true // mergeExtra
      );

      return {
        success: true,
        data: {
          id: room.id,
          name: room.name,
          hostConversationId: room.hostConversationId,
        },
      };
    } catch (error) {
      console.error('[GroupRoomBridge] create error:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ==================== group-room.get ====================

  groupRoom.get.provider(async ({ roomId }) => {
    try {
      let result = service.getRoom(roomId);

      if (!result) {
        return { success: false, msg: 'room not found' };
      }

      // Recover stale persisted state after app restart.
      // If no orchestrator is alive for this room, "running" should not block input.
      if (result.room.status === 'running' && !activeOrchestrators.has(roomId)) {
        service.updateRoomStatus(roomId, 'idle');
        result = service.getRoom(roomId);
      }

      if (!result) {
        return { success: false, msg: 'room not found' };
      }

      // Include persisted messages so the frontend can restore history on refresh
      const messages = service.getMessagesByRoom(roomId);

      return {
        success: true,
        data: {
          id: result.room.id,
          name: result.room.name,
          status: result.room.status,
          members: result.members,
          messages,
        },
      };
    } catch (error) {
      console.error('[GroupRoomBridge] get error:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ==================== group-room.send-message ====================

  groupRoom.sendMessage.provider(async ({ roomId, input, msg_id }) => {
    try {
      const msgId = service.addMessage({
        roomId,
        senderType: 'user',
        senderId: null,
        msgKind: 'user_input',
        content: input,
        refMessageId: msg_id,
        status: 'finish',
      });

      // Guard: prevent concurrent runs for the same room
      const existing = service.getRoom(roomId);
      if (!existing) {
        return { success: false, msg: 'room not found' };
      }
      if (existing.room.status === 'running') {
        return { success: false, msg: 'room is already running' };
      }

      const orchestrator = new GroupRoomOrchestrator(roomId, db, conversationService, agentFactory);
      activeOrchestrators.set(roomId, orchestrator);
      void orchestrator
        .start(input, msgId)
        .catch((err: unknown) => {
          console.error('[GroupRoomBridge] orchestrator error:', err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          activeOrchestrators.delete(roomId);
        });

      return { success: true, data: { msg_id: msgId } };
    } catch (error) {
      console.error('[GroupRoomBridge] sendMessage error:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ==================== group-room.delete ====================

  groupRoom.delete.provider(async ({ roomId }) => {
    try {
      // Tear down any running orchestrator first
      const orchestrator = activeOrchestrators.get(roomId);
      if (orchestrator) {
        await orchestrator.teardown();
        activeOrchestrators.delete(roomId);
      }

      service.deleteRoom(roomId);
      return { success: true };
    } catch (error) {
      console.error('[GroupRoomBridge] delete error:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ==================== group-room.stop ====================

  groupRoom.stop.provider(async ({ roomId }) => {
    try {
      const orchestrator = activeOrchestrators.get(roomId);
      if (orchestrator) {
        await orchestrator.teardown();
        activeOrchestrators.delete(roomId);
      } else {
        // No active orchestrator — just update DB status
        service.updateRoomStatus(roomId, 'paused');
      }
      return { success: true };
    } catch (error) {
      console.error('[GroupRoomBridge] stop error:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // responseStream, memberChanged, turnCompleted are emitters (main → renderer push).
  // They are NOT registered here. Use groupRoom.responseStream.emit(...) etc. at call sites.
}
