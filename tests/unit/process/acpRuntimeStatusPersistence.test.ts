import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetConversation, mockUpdateConversation } = vi.hoisted(() => ({
  mockGetConversation: vi.fn(),
  mockUpdateConversation: vi.fn(),
}));

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    paths: { isPackaged: () => false, getAppPath: () => null },
    worker: {
      fork: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        postMessage: vi.fn(),
        kill: vi.fn(),
      })),
    },
  }),
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: vi.fn(() => ({})),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { responseStream: { emit: vi.fn() } },
    conversation: {
      confirmation: {
        add: { emit: vi.fn() },
        update: { emit: vi.fn() },
        remove: { emit: vi.fn() },
      },
      responseStream: { emit: vi.fn() },
    },
  },
}));

vi.mock('@process/channels/agent/ChannelEventBus', () => ({
  channelEventBus: { emitAgentMessage: vi.fn() },
}));

vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(async () => ({
    getConversation: mockGetConversation,
    updateConversation: mockUpdateConversation,
  })),
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
}));

vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
  addOrUpdateMessage: vi.fn(),
  nextTickToLocalFinish: vi.fn(),
}));

vi.mock('@process/utils/previewUtils', () => ({
  handlePreviewOpenEvent: vi.fn(),
}));

vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: { setProcessing: vi.fn() },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: { getInstance: () => ({ getAcpAdapters: () => [] }) },
}));

vi.mock('@/common/utils', () => ({
  parseError: vi.fn((error: unknown) => String(error)),
  uuid: vi.fn(() => 'mock-uuid'),
}));

vi.mock('@process/task/MessageMiddleware', () => ({
  extractTextFromMessage: vi.fn(),
  processCronInMessage: vi.fn(),
}));

vi.mock('@process/task/ThinkTagDetector', () => ({
  stripThinkTags: vi.fn((value: string) => value),
}));

vi.mock('@process/task/CronCommandDetector', () => ({
  hasCronCommands: vi.fn(() => false),
}));

vi.mock('@process/task/agentUtils', () => ({
  prepareFirstMessageWithSkillsIndex: vi.fn(async (content: string) => content),
  buildSystemInstructions: vi.fn(async () => undefined),
}));

vi.mock('@process/agent/acp', () => ({
  AcpAgent: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn(async () => ({ success: true })),
    getModelInfo: vi.fn(() => null),
    getSessionState: vi.fn(() => null),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    kill: vi.fn(async () => {}),
    on: vi.fn().mockReturnThis(),
  })),
}));

import AcpAgentManager from '@process/task/AcpAgentManager';

function createManager(): InstanceType<typeof AcpAgentManager> {
  return new AcpAgentManager({
    conversation_id: 'test-conv',
    backend: 'claude',
    workspace: '/tmp/test-workspace',
    agentName: 'Claude',
  });
}

function setBootstrapState(
  manager: InstanceType<typeof AcpAgentManager>,
  state: { bootstrapping: boolean; isFirstMessage: boolean }
): void {
  (manager as unknown as { bootstrapping: boolean }).bootstrapping = state.bootstrapping;
  (manager as unknown as { isFirstMessage: boolean }).isFirstMessage = state.isFirstMessage;
}

describe('AcpAgentManager runtime status persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConversation.mockReturnValue({
      success: true,
      data: {
        id: 'test-conv',
        type: 'acp',
        extra: {
          backend: 'claude',
          lastAcpStatus: {
            backend: 'claude',
            status: 'disconnected',
            agentName: 'Claude',
            disconnectCode: 42,
            disconnectSignal: 'SIGTERM',
            updatedAt: 1234,
          },
        },
      },
    });
  });

  it('keeps the persisted disconnected status while bootstrap is only connected/authenticated', async () => {
    const manager = createManager();

    await (
      manager as unknown as {
        saveAcpRuntimeStatus: (status: {
          backend: 'claude';
          status: 'connected' | 'authenticated';
          agentName?: string;
        }) => Promise<void>;
      }
    ).saveAcpRuntimeStatus({
      backend: 'claude',
      status: 'connected',
      agentName: 'Claude',
    });

    await (
      manager as unknown as {
        saveAcpRuntimeStatus: (status: {
          backend: 'claude';
          status: 'connected' | 'authenticated';
          agentName?: string;
        }) => Promise<void>;
      }
    ).saveAcpRuntimeStatus({
      backend: 'claude',
      status: 'authenticated',
      agentName: 'Claude',
    });

    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it('ignores bootstrap terminal noise before the first user turn', async () => {
    const manager = createManager();
    setBootstrapState(manager, {
      bootstrapping: true,
      isFirstMessage: true,
    });

    await (
      manager as unknown as {
        saveAcpRuntimeStatus: (status: {
          backend: 'claude';
          status: 'disconnected';
          agentName?: string;
          disconnectCode?: number | null;
          disconnectSignal?: string | null;
        }) => Promise<void>;
      }
    ).saveAcpRuntimeStatus({
      backend: 'claude',
      status: 'disconnected',
      agentName: 'Claude',
      disconnectCode: 7,
      disconnectSignal: 'SIGTERM',
    });

    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it('clears the persisted disconnected status only after session_active is confirmed', async () => {
    const manager = createManager();

    await (
      manager as unknown as {
        saveAcpRuntimeStatus: (status: {
          backend: 'claude';
          status: 'session_active';
          agentName?: string;
        }) => Promise<void>;
      }
    ).saveAcpRuntimeStatus({
      backend: 'claude',
      status: 'session_active',
      agentName: 'Claude',
    });

    expect(mockUpdateConversation).toHaveBeenCalledWith('test-conv', {
      extra: {
        backend: 'claude',
      },
    });
  });

  it('still clears stale terminal hydration when bootstrap reaches session_active before the first user turn', async () => {
    const manager = createManager();
    setBootstrapState(manager, {
      bootstrapping: true,
      isFirstMessage: true,
    });

    await (
      manager as unknown as {
        saveAcpRuntimeStatus: (status: {
          backend: 'claude';
          status: 'session_active';
          agentName?: string;
        }) => Promise<void>;
      }
    ).saveAcpRuntimeStatus({
      backend: 'claude',
      status: 'session_active',
      agentName: 'Claude',
    });

    expect(mockUpdateConversation).toHaveBeenCalledWith('test-conv', {
      extra: {
        backend: 'claude',
      },
    });
  });

  it('persists disconnected diagnostics for later hydration', async () => {
    const manager = createManager();

    await (
      manager as unknown as {
        saveAcpRuntimeStatus: (status: {
          backend: 'claude';
          status: 'disconnected';
          agentName?: string;
          disconnectCode?: number | null;
          disconnectSignal?: string | null;
        }) => Promise<void>;
      }
    ).saveAcpRuntimeStatus({
      backend: 'claude',
      status: 'disconnected',
      agentName: 'Claude',
      disconnectCode: 9,
      disconnectSignal: 'SIGKILL',
    });

    expect(mockUpdateConversation).toHaveBeenCalledWith('test-conv', {
      extra: {
        backend: 'claude',
        lastAcpStatus: {
          backend: 'claude',
          status: 'disconnected',
          agentName: 'Claude',
          disconnectCode: 9,
          disconnectSignal: 'SIGKILL',
          updatedAt: expect.any(Number),
        },
      },
    });
  });

  it('persists bootstrap terminal failures after the first user turn', async () => {
    const manager = createManager();
    setBootstrapState(manager, {
      bootstrapping: true,
      isFirstMessage: false,
    });

    await (
      manager as unknown as {
        saveAcpRuntimeStatus: (status: {
          backend: 'claude';
          status: 'auth_required';
          agentName?: string;
        }) => Promise<void>;
      }
    ).saveAcpRuntimeStatus({
      backend: 'claude',
      status: 'auth_required',
      agentName: 'Claude',
    });

    expect(mockUpdateConversation).toHaveBeenCalledWith('test-conv', {
      extra: {
        backend: 'claude',
        lastAcpStatus: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
          updatedAt: expect.any(Number),
        },
      },
    });
  });

  it('persists auth_required for thread-level hydration', async () => {
    const manager = createManager();

    await (
      manager as unknown as {
        saveAcpRuntimeStatus: (status: {
          backend: 'claude';
          status: 'auth_required';
          agentName?: string;
        }) => Promise<void>;
      }
    ).saveAcpRuntimeStatus({
      backend: 'claude',
      status: 'auth_required',
      agentName: 'Claude',
    });

    expect(mockUpdateConversation).toHaveBeenCalledWith('test-conv', {
      extra: {
        backend: 'claude',
        lastAcpStatus: {
          backend: 'claude',
          status: 'auth_required',
          agentName: 'Claude',
          updatedAt: expect.any(Number),
        },
      },
    });
  });
});
