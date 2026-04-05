import { beforeEach, describe, expect, it, vi } from 'vitest';

type StreamEventMessage = {
  type: string;
  conversation_id?: string;
  msg_id?: string;
  data?: unknown;
};

type SignalEventMessage = {
  type: string;
  conversation_id?: string;
  msg_id?: string;
  data?: unknown;
};

type CapturedAcpAgentConfig = {
  onStreamEvent?: (message: StreamEventMessage) => void;
  onSignalEvent?: (message: SignalEventMessage) => Promise<void>;
};

const { mockGetConversation, mockUpdateConversation, capturedAgentConfigs } = vi.hoisted(() => ({
  mockGetConversation: vi.fn(),
  mockUpdateConversation: vi.fn(),
  capturedAgentConfigs: [] as CapturedAcpAgentConfig[],
}));

type MockAcpAgentInstance = {
  isConnected: boolean;
  hasActiveSession: boolean;
  sendMessage: ReturnType<typeof vi.fn>;
  getModelInfo: ReturnType<typeof vi.fn>;
  getSessionState: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  cancelPrompt: ReturnType<typeof vi.fn>;
  enableYoloMode: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

const capturedAgentInstances: MockAcpAgentInstance[] = [];

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

vi.mock('@/common/chat/chatLib', () => ({
  transformMessage: vi.fn((message: StreamEventMessage) => ({
    id: message.msg_id || 'mock-message-id',
    msg_id: message.msg_id || 'mock-message-id',
    type: message.type === 'content' ? 'text' : message.type,
    position: 'left',
    conversation_id: message.conversation_id || 'test-conv',
    content:
      typeof message.data === 'string'
        ? { content: message.data }
        : ((message.data as Record<string, unknown> | null) ?? { content: '' }),
    createdAt: Date.now(),
  })),
  extractTextFromMessage: vi.fn((message: { content?: { content?: string } }) => message.content?.content || ''),
}));

vi.mock('@process/channels/agent/ChannelEventBus', () => ({
  channelEventBus: { emitAgentMessage: vi.fn() },
}));

vi.mock('@process/team/teamEventBus', () => ({
  teamEventBus: { emit: vi.fn() },
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
  nextTickToLocalFinish: vi.fn((callback: () => void) => callback()),
}));

vi.mock('@process/utils/previewUtils', () => ({
  handlePreviewOpenEvent: vi.fn(() => false),
}));

vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: { setProcessing: vi.fn() },
}));

vi.mock('@process/services/cron/SkillSuggestWatcher', () => ({
  skillSuggestWatcher: { onFinish: vi.fn() },
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
  extractTextFromMessage: vi.fn((message: { content?: { content?: string } }) => message.content?.content || ''),
  processCronInMessage: vi.fn(),
}));

vi.mock('@process/task/ThinkTagDetector', () => ({
  extractAndStripThinkTags: vi.fn((value: string) => ({
    thinking: '',
    content: value,
  })),
}));

vi.mock('@process/task/CronCommandDetector', () => ({
  hasCronCommands: vi.fn(() => false),
}));

vi.mock('@process/task/agentUtils', () => ({
  prepareFirstMessageWithSkillsIndex: vi.fn(async (content: string) => content),
  buildSystemInstructions: vi.fn(async () => undefined),
}));

vi.mock('@process/agent/acp', () => ({
  AcpAgent: class {
    isConnected = true;
    hasActiveSession = true;
    constructor(config: CapturedAcpAgentConfig) {
      capturedAgentConfigs.push(config);
      capturedAgentInstances.push(this as unknown as MockAcpAgentInstance);
    }
    sendMessage = vi.fn(async () => ({ success: true }));
    getModelInfo = vi.fn(() => null);
    getSessionState = vi.fn(() => null);
    start = vi.fn(async () => {});
    stop = vi.fn();
    kill = vi.fn(async () => {});
    cancelPrompt = vi.fn();
    enableYoloMode = vi.fn(async () => {});
    on = vi.fn().mockReturnThis();
  },
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

function getLatestAgentHandlers(): Required<Pick<CapturedAcpAgentConfig, 'onStreamEvent' | 'onSignalEvent'>> {
  const latest = capturedAgentConfigs.at(-1);
  if (!latest?.onStreamEvent || !latest.onSignalEvent) {
    throw new Error('Expected AcpAgent to capture onStreamEvent and onSignalEvent handlers');
  }
  return {
    onStreamEvent: latest.onStreamEvent,
    onSignalEvent: latest.onSignalEvent,
  };
}

function getLatestAgentInstance(): MockAcpAgentInstance {
  const latest = capturedAgentInstances.at(-1);
  if (!latest) {
    throw new Error('Expected AcpAgent instance to be created');
  }
  return latest;
}

describe('AcpAgentManager active turn status lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedAgentConfigs.length = 0;
    capturedAgentInstances.length = 0;
    mockGetConversation.mockReturnValue({
      success: true,
      data: {
        id: 'test-conv',
        type: 'acp',
        extra: {
          backend: 'claude',
        },
      },
    });
  });

  it('keeps status running after streamed content until finish arrives', async () => {
    const manager = createManager();
    await manager.initAgent();
    manager.status = 'running';

    const { onStreamEvent, onSignalEvent } = getLatestAgentHandlers();

    onStreamEvent({
      type: 'content',
      conversation_id: 'test-conv',
      msg_id: 'content-1',
      data: 'Hello from ACP',
    });

    expect(manager.status).toBe('running');

    await onSignalEvent({
      type: 'finish',
      conversation_id: 'test-conv',
      msg_id: 'finish-1',
      data: null,
    });

    expect(manager.status).toBe('finished');
  });

  it('keeps status running for non-terminal agent status updates', async () => {
    const manager = createManager();
    await manager.initAgent();
    manager.status = 'running';

    const { onStreamEvent } = getLatestAgentHandlers();

    onStreamEvent({
      type: 'agent_status',
      conversation_id: 'test-conv',
      msg_id: 'status-session-active',
      data: {
        backend: 'claude',
        status: 'session_active',
        agentName: 'Claude',
      },
    });

    expect(manager.status).toBe('running');
  });

  it('marks the task finished on terminal agent status updates', async () => {
    const manager = createManager();
    await manager.initAgent();
    manager.status = 'running';

    const { onStreamEvent } = getLatestAgentHandlers();

    onStreamEvent({
      type: 'agent_status',
      conversation_id: 'test-conv',
      msg_id: 'status-disconnected',
      data: {
        backend: 'claude',
        status: 'disconnected',
        agentName: 'Claude',
        disconnectCode: 9,
        disconnectSignal: 'SIGTERM',
      },
    });

    expect(manager.status).toBe('finished');
  });

  it('treats auth_required as a terminal task status update', async () => {
    const manager = createManager();
    await manager.initAgent();
    manager.status = 'running';

    const { onStreamEvent } = getLatestAgentHandlers();

    onStreamEvent({
      type: 'agent_status',
      conversation_id: 'test-conv',
      msg_id: 'status-auth-required',
      data: {
        backend: 'claude',
        status: 'auth_required',
        agentName: 'Claude',
      },
    });

    expect(manager.status).toBe('finished');
  });

  it('marks the task running again when a new turn starts', async () => {
    const manager = createManager();
    await manager.initAgent();
    manager.status = 'finished';

    const { onStreamEvent } = getLatestAgentHandlers();

    onStreamEvent({
      type: 'start',
      conversation_id: 'test-conv',
      msg_id: 'start-1',
      data: null,
    });

    expect(manager.status).toBe('running');
  });

  it('delegates stop to cancelPrompt and relies on the terminal finish signal to clear running state', async () => {
    const manager = createManager();
    await manager.initAgent();
    manager.status = 'running';

    const agent = getLatestAgentInstance();
    const { onSignalEvent } = getLatestAgentHandlers();

    await manager.stop();
    expect(agent.cancelPrompt).toHaveBeenCalledTimes(1);
    expect(manager.status).toBe('running');

    await onSignalEvent({
      type: 'finish',
      conversation_id: 'test-conv',
      msg_id: 'finish-after-stop',
      data: null,
    });

    expect(manager.status).toBe('finished');
  });
});
