/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { capturedAgentConfigs } = vi.hoisted(() => ({
  capturedAgentConfigs: [] as Array<Record<string, unknown>>,
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));
vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => undefined),
  },
}));
vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(async () => ({
    getConversation: vi.fn(() => ({ success: false })),
    updateConversation: vi.fn(),
  })),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      responseStream: {
        emit: vi.fn(),
      },
    },
  },
}));
vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
  addOrUpdateMessage: vi.fn(),
  nextTickToLocalFinish: vi.fn((cb: () => void) => cb()),
}));
vi.mock('@process/channels/agent/ChannelEventBus', () => ({
  channelEventBus: {
    emitAgentMessage: vi.fn(),
  },
}));
vi.mock('@process/team/teamEventBus', () => ({
  teamEventBus: {
    emit: vi.fn(),
  },
}));
vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: {
    setProcessing: vi.fn(),
  },
}));
vi.mock('@process/extensions', () => ({
  ExtensionRegistry: {
    getInstance: vi.fn(() => ({ getAll: vi.fn(() => []), getAcpAdapters: vi.fn(() => []) })),
  },
}));
vi.mock('@process/utils/previewUtils', () => ({
  handlePreviewOpenEvent: vi.fn(() => false),
}));
vi.mock('@process/task/codexConfig', () => ({
  getCodexSandboxModeForSessionMode: vi.fn(() => 'workspace-write'),
  writeCodexSandboxMode: vi.fn(async () => undefined),
}));
vi.mock('@process/services/cron/SkillSuggestWatcher', () => ({
  skillSuggestWatcher: { maybeSuggestForConversation: vi.fn() },
}));
vi.mock('@process/task/CronCommandDetector', () => ({
  hasCronCommands: vi.fn(() => false),
}));
vi.mock('@process/task/ThinkTagDetector', () => ({
  extractAndStripThinkTags: vi.fn((content: string) => ({ thinking: '', content })),
}));
vi.mock('@process/task/agentUtils', () => ({
  prepareFirstMessageWithSkillsIndex: vi.fn(async (content: string) => content),
}));
vi.mock('@process/task/MessageMiddleware', () => ({
  extractTextFromMessage: vi.fn(() => ''),
  processCronInMessage: vi.fn((message: unknown) => message),
}));
vi.mock('@/common/utils', () => ({
  parseError: vi.fn((error: unknown) => error),
  uuid: vi.fn(() => 'test-uuid'),
}));
vi.mock('@/common/chat/chatLib', async () => {
  const actual = await vi.importActual<object>('@/common/chat/chatLib');
  return {
    ...actual,
    transformMessage: vi.fn(() => null),
  };
});

vi.mock('@process/agent/acp', () => ({
  AcpAgent: class {
    constructor(config: Record<string, unknown>) {
      capturedAgentConfigs.push(config);
    }
    async start() {}
    async setMode() {
      return { success: true };
    }
    async setModelByConfigOption() {}
    getModelInfo() {
      return null;
    }
    getConfigOptions() {
      return [];
    }
  },
}));

vi.mock('@process/task/BaseAgentManager', () => ({
  default: class {
    conversation_id = '';
    status: string | undefined;
    workspace = '';
    protected confirmations: Array<{ id: string; callId: string }> = [];
    protected emitter: {
      emitConfirmationAdd: ReturnType<typeof vi.fn>;
      emitConfirmationUpdate: ReturnType<typeof vi.fn>;
      emitConfirmationRemove: ReturnType<typeof vi.fn>;
    };
    protected yoloMode = false;
    protected _lastActivityAt = Date.now();
    constructor(_type: string, data: Record<string, unknown>, emitter: any) {
      this.conversation_id = String(data.conversation_id ?? '');
      this.workspace = String(data.workspace ?? '');
      this.emitter = emitter;
    }
    isYoloMode() {
      return false;
    }
    protected addConfirmation(data: { id: string; callId: string }) {
      this.confirmations.push(data);
      this.emitter.emitConfirmationAdd(this.conversation_id, data);
    }
    protected removeConfirmationByCallId(callId: string) {
      const confirmation = this.confirmations.find((item) => item.callId === callId);
      this.confirmations = this.confirmations.filter((item) => item.callId !== callId);
      if (confirmation) {
        this.emitter.emitConfirmationRemove(this.conversation_id, confirmation.id);
      }
    }
    getConfirmations() {
      return this.confirmations;
    }
  },
}));

vi.mock('@process/task/IpcAgentEventEmitter', () => ({
  IpcAgentEventEmitter: class {
    emitConfirmationAdd = vi.fn();
    emitConfirmationUpdate = vi.fn();
    emitConfirmationRemove = vi.fn();
  },
}));

import AcpAgentManager from '../../../src/process/task/AcpAgentManager';

describe('AcpAgentManager permission invalidation wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedAgentConfigs.length = 0;
  });

  it('removes a stale confirmation when the ACP agent invalidates the pending permission request', async () => {
    const manager = new AcpAgentManager({
      conversation_id: 'conv-acp',
      backend: 'claude',
      workspace: '/tmp/workspace',
    });

    await (manager as any).initAgent();

    (manager as any).addConfirmation({
      id: 'conf-1',
      callId: 'call-1',
      options: [],
    });

    expect(manager.getConfirmations()).toHaveLength(1);

    const createdConfig = capturedAgentConfigs[0] as {
      onPermissionRequestInvalidated?: (callId: string, reason: string) => void;
    };
    expect(createdConfig.onPermissionRequestInvalidated).toBeTypeOf('function');

    createdConfig.onPermissionRequestInvalidated?.('call-1', 'timeout');

    expect(manager.getConfirmations()).toHaveLength(0);
    expect(
      ((manager as any).emitter as { emitConfirmationRemove: ReturnType<typeof vi.fn> }).emitConfirmationRemove
    ).toHaveBeenCalledWith('conv-acp', 'conf-1');
  });
});
